import type { Finding } from "../types";
import type { ShiftEntry } from "./vitals";
import { fileName, kb } from "./dom";

type FontFile = { url: string; bytes: number; format: string; ms: number };

const fontFiles = (): FontFile[] =>
  (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
    .filter((e) => /\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(e.name) || (e.initiatorType === "css" && /fonts?\./i.test(e.name) && !/\.(css|js)(\?|$)/.test(e.name)))
    .map((e) => ({
      url: e.name,
      bytes: e.encodedBodySize || e.transferSize || 0,
      format: (e.name.match(/\.(woff2|woff|ttf|otf|eot)/i)?.[1] ?? "font").toLowerCase(),
      ms: e.responseEnd,
    }));

/** @font-face rules of same-origin stylesheets: family + font-display + the url used */
const faceRules = () => {
  const out: { family: string; display: string; src: string; weight: string; unicode: boolean }[] = [];
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin stylesheet (e.g. Google Fonts css): not readable
    }
    const walk = (list: CSSRuleList) => {
      for (const r of [...list]) {
        if (r instanceof CSSFontFaceRule) {
          const s = r.style;
          out.push({
            family: s.getPropertyValue("font-family").replace(/["']/g, "").trim(),
            display: s.getPropertyValue("font-display").trim(),
            src: s.getPropertyValue("src"),
            weight: s.getPropertyValue("font-weight").trim(),
            unicode: !!s.getPropertyValue("unicode-range"),
          });
        } else if ("cssRules" in r && (r as CSSGroupingRule).cssRules) walk((r as CSSGroupingRule).cssRules);
      }
    };
    walk(rules);
  }
  return out;
};

export function scanFonts(shifts: ShiftEntry[], lcpTime?: number): { findings: Finding[]; count: number } {
  const findings: Finding[] = [];
  const files = fontFiles();
  const faces = document.fonts ? [...document.fonts] : [];
  const loaded = faces.filter((f) => f.status === "loaded");
  const rules = faceRules();
  const total = files.reduce((a, f) => a + f.bytes, 0);

  for (const f of files) {
    const name = fileName(f.url);
    if (f.format === "ttf" || f.format === "otf" || f.format === "eot" || f.format === "woff") {
      findings.push({
        id: `font-fmt:${f.url}`, category: "fonts", severity: f.bytes > 80_000 ? "medium" : "low",
        short: `${name} is ${f.format.toUpperCase()}${f.bytes ? ` (${kb(f.bytes)})` : ""}: convert to WOFF2 (≈ −30%).`,
        where: name, facts: [["file", name], ["format", f.format.toUpperCase()], ...(f.bytes ? [["size", kb(f.bytes)] as [string, string]] : [])],
        fix: "WOFF2 is supported everywhere and is the smallest format. Serve only WOFF2.",
        before: `src: url(${name}) format("${f.format === "ttf" ? "truetype" : f.format}")`, after: `src: url(${name.replace(/\.\w+$/, ".woff2")}) format("woff2")`,
      });
    }
    if (f.bytes > 100_000) {
      findings.push({
        id: `font-big:${f.url}`, category: "fonts", severity: f.bytes > 250_000 ? "high" : "medium",
        short: `${name} is ${kb(f.bytes)}: subset it to the characters you use (typically −60–90%).`,
        where: name, facts: [["file", name], ["size", kb(f.bytes)]],
        fix: "Cut the font to the Unicode ranges you actually need (Latin, plus your script), or use a variable font instead of several weights.",
        before: `unicode-range: (all)`, after: `unicode-range: U+0000-00FF, U+0131, U+0152-0153;`,
      });
    }
  }

  if (total > 300_000 || files.length > 5) {
    findings.push({
      id: "font-total", category: "fonts", severity: total > 500_000 ? "high" : "medium",
      short: `${files.length} font files, ${kb(total)} in total: drop weights you do not use or switch to one variable font.`,
      where: "document", facts: [["files", String(files.length)], ["total", kb(total)], ["declared faces", String(faces.length)]],
      fix: "Every weight and style is another request. Two or three files is a healthy budget; one variable font often replaces five.",
    });
  }

  // font-display
  const noDisplay = rules.filter((r) => !r.display || r.display === "block" || r.display === "auto");
  for (const r of noDisplay.slice(0, 4)) {
    findings.push({
      id: `font-display:${r.family}:${r.weight}`, category: "fonts", severity: "medium",
      short: `"${r.family}" has no font-display: text stays invisible while it loads. Add font-display: swap (or optional).`,
      where: `@font-face "${r.family}" ${r.weight}`, facts: [["family", r.family], ["font-display", r.display || "(not set → block)"]],
      fix: "`swap` shows fallback text at once; `optional` avoids even the swap shift on slow networks. With Next, next/font does this for you.",
      before: `@font-face { font-family: "${r.family}"; src: … }`, after: `@font-face { font-family: "${r.family}"; src: …; font-display: swap; }`,
    });
  }

  // text reflow caused by a font swap: a layout shift whose source is text, after a font arrived
  const lastFont = Math.max(0, ...files.map((f) => f.ms));
  const textShifts = shifts.filter((s) => s.nodes.some((n) => n.isText || /^(h[1-6]|p|a|span|li|button|label)$/.test(n.tag)) && lastFont > 0 && s.time >= lastFont - 600 && s.time <= lastFont + 800);
  if (textShifts.length) {
    const value = textShifts.reduce((a, s) => a + s.value, 0);
    const first = textShifts[0]!.nodes.find((n) => n.isText || /^(h[1-6]|p|a|span|li|button|label)$/.test(n.tag))!;
    findings.push({
      id: "font-swap-shift", category: "layout", severity: value > 0.1 ? "high" : value > 0.02 ? "medium" : "low",
      elements: textShifts.flatMap((s) => s.nodes.map((n) => n.el)).slice(0, 8),
      short: `Text reflows when the web font arrives (CLS +${value.toFixed(3)}, first: ${first.selector}): match the fallback with size-adjust.`,
      where: first.selector, facts: [["layout shift", value.toFixed(3)], ["cause", "fallback font has different metrics"], ["shifted text", `${textShifts.length} time(s)`]],
      fix: "Make the fallback occupy the same space: `size-adjust`, `ascent-override` on a local fallback face (next/font and Fontaine do this automatically), and preload the font used above the fold.",
      before: `font-family: "Brand", sans-serif;`, after: `@font-face { font-family: "Brand-fallback"; src: local("Arial"); size-adjust: 104%; ascent-override: 92%; }\nfont-family: "Brand", "Brand-fallback", sans-serif;`,
    });
  }

  // preload for the font used by the LCP text / above the fold
  const preloaded = new Set([...document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="font"]')].map((l) => l.href));
  const late = files.filter((f) => !preloaded.has(f.url) && lcpTime && f.ms > lcpTime * 0.6 && f.bytes > 0);
  if (late.length && files.length) {
    const f = late.sort((a, b) => b.bytes - a.bytes)[0]!;
    findings.push({
      id: `font-preload:${f.url}`, category: "fonts", severity: "low",
      short: `${fileName(f.url)} arrives late (${Math.round(f.ms)} ms) and is not preloaded: add <link rel="preload" as="font" crossorigin>.`,
      where: fileName(f.url), facts: [["finished at", `${Math.round(f.ms)} ms`], ["size", kb(f.bytes)]],
      fix: "Fonts are discovered only after the CSS is parsed. Preload the one or two used above the fold.",
      after: `<link rel="preload" href="${fileName(f.url)}" as="font" type="font/woff2" crossorigin>`,
    });
  }

  // declared but never loaded: pure dead weight in the CSS
  const unused = rules.filter((r) => !loaded.some((f) => f.family.replace(/["']/g, "") === r.family) && faces.length);
  if (unused.length >= 2) {
    findings.push({
      id: "font-unused", category: "fonts", severity: "low",
      short: `${unused.length} @font-face rules were never used on this page (${[...new Set(unused.map((u) => u.family))].slice(0, 3).join(", ")}).`,
      where: "stylesheet", facts: [["unused faces", String(unused.length)]],
      fix: "They cost nothing to download, but remove what you do not use so nobody adds it to a page by accident.",
    });
  }
  return { findings, count: files.length };
}
