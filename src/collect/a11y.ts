import { getEngine } from "../engine";
import type { Finding } from "../types";
import { chunked, isOwn, selectorOf } from "./dom";
import { ownerOf } from "./react";

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
};

const name = (el: Element): string => {
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
    if (t) return t;
  }
  const text = (el.textContent ?? "").trim();
  if (text) return text;
  const img = el.querySelector("img[alt]:not([alt=''])") as HTMLImageElement | null;
  if (img) return img.alt;
  const svgTitle = el.querySelector("svg title")?.textContent?.trim();
  if (svgTitle) return svgTitle;
  return el.getAttribute("title")?.trim() ?? "";
};

const parseColor = (c: string): [number, number, number, number] | null => {
  const m = c.match(/rgba?\(([^)]+)\)/) ?? c.match(/color\(srgb ([^)]+)\)/);
  if (!m) return null;
  const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
  if (p.length < 3 || p.some(Number.isNaN)) return null;
  const f = c.startsWith("color(") ? 255 : 1;
  return [p[0]! * f, p[1]! * f, p[2]! * f, p[3] ?? 1];
};

/** effective background: walk up until an opaque color; give up (null) on gradients/images, to avoid false alarms */
const backgroundOf = (el: Element): [number, number, number] | null => {
  let layers: [number, number, number, number][] = [];
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const cs = getComputedStyle(cur);
    if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
    const c = parseColor(cs.backgroundColor);
    if (c && c[3] > 0) {
      layers.push(c);
      if (c[3] >= 0.99) break;
    }
  }
  let [r, g, b] = [255, 255, 255];
  for (const [lr, lg, lb, la] of layers.reverse()) { r = lr * la + r * (1 - la); g = lg * la + g * (1 - la); b = lb * la + b * (1 - la); }
  return [r, g, b];
};

export async function scanA11y(): Promise<Finding[]> {
  const out: Finding[] = [];
  const push = (f: Omit<Finding, "category">) => out.push({ category: "a11y", ...f });
  const own = (e: Element) => !isOwn(e);
  const where = (e: Element) => { const o = ownerOf(e); return `${o ? `<${o}> › ` : ""}${selectorOf(e)}`; };

  // page level
  if (!document.documentElement.lang) push({ id: "a11y-lang", severity: "medium", short: `<html> has no lang attribute: screen readers guess the language. Add lang="en" (or yours).`, where: "html", facts: [], fix: "Set the page language so speech and hyphenation use the right rules.", after: `<html lang="en">` });
  const vp = document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "";
  if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?(\D|$)/.test(vp)) push({ id: "a11y-zoom", severity: "high", short: "The viewport disables pinch zoom: low-vision users cannot enlarge the page. Remove user-scalable=no / maximum-scale=1.", where: "meta[name=viewport]", facts: [["content", vp]], fix: "Never block zoom.", after: `<meta name="viewport" content="width=device-width, initial-scale=1">` });
  const h1s = [...document.querySelectorAll("h1")].filter(own);
  if (h1s.length === 0) push({ id: "a11y-h1", severity: "low", short: "The page has no <h1>: add one that names the page.", where: "document", facts: [], fix: "Exactly one h1 gives assistive tech a page title to jump to." });
  if (h1s.length > 1) push({ id: "a11y-h1-many", severity: "low", short: `${h1s.length} <h1> elements: keep one per page and use h2+ below it.`, where: selectorOf(h1s[1]!), elements: h1s.map((e) => new WeakRef(e as Element)), facts: [], fix: "Multiple h1s blur the outline." });
  if (!document.querySelector("main, [role=main]")) push({ id: "a11y-main", severity: "low", short: "No <main> landmark: wrap the primary content so keyboard users can skip to it.", where: "document", facts: [], fix: "Use one <main> per page." });

  // heading order
  const heads = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter((e) => own(e) && visible(e));
  for (let i = 1; i < heads.length; i++) {
    const a = +heads[i - 1]!.tagName[1]!, b = +heads[i]!.tagName[1]!;
    if (b > a + 1) {
      push({ id: `a11y-heading:${selectorOf(heads[i]!)}`, severity: "low", elements: [new WeakRef(heads[i]! as Element)], short: `Heading jumps from <h${a}> to <h${b}> at "${(heads[i]!.textContent ?? "").trim().slice(0, 30)}": do not skip levels.`, where: where(heads[i]!), facts: [], fix: "Use the level for structure, CSS for size." });
      break;
    }
  }

  const els = [...document.body.querySelectorAll("img,a,button,input,select,textarea,iframe,[role=button],[role=link],[tabindex]")].filter((e) => own(e));
  const noAlt: Element[] = [], noName: Element[] = [], noLabel: Element[] = [], small: Element[] = [], posTab: Element[] = [], noTitle: Element[] = [];
  await chunked(els, (el) => {
    const tag = el.tagName;
    if (tag === "IMG") {
      if (!el.hasAttribute("alt") && el.getAttribute("role") !== "presentation" && visible(el)) noAlt.push(el);
      return;
    }
    if (tag === "IFRAME") { if (!el.getAttribute("title") && !el.getAttribute("aria-label")) noTitle.push(el); return; }
    const t = (el as HTMLInputElement).type;
    if (tag === "INPUT" && (t === "hidden" || t === "submit" || t === "button" || t === "reset" || t === "image")) { if (t === "image" && !name(el) && !el.getAttribute("alt")) noName.push(el); return; }
    if (!visible(el)) return;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
      const id = (el as HTMLInputElement).id;
      const labelled = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.closest("label") || (id && document.querySelector(`label[for="${CSS.escape(id)}"]`));
      if (!labelled) noLabel.push(el);
    } else if (tag === "A" || tag === "BUTTON" || el.getAttribute("role") === "button" || el.getAttribute("role") === "link") {
      if (!name(el)) noName.push(el);
      const r = el.getBoundingClientRect();
      const inline = tag === "A" && getComputedStyle(el).display === "inline";
      if (!inline && (r.width < 24 || r.height < 24)) small.push(el);
    }
    if (+(el.getAttribute("tabindex") ?? 0) > 0) posTab.push(el);
  });

  const group = (list: Element[], f: (first: Element, n: number) => Omit<Finding, "category" | "elements">) => {
    if (!list.length) return;
    push({ ...f(list[0]!, list.length), elements: list.slice(0, 12).map((e) => new WeakRef(e)) });
  };
  group(noAlt, (e, n) => ({ id: "a11y-alt", severity: "high", short: `${n} image${n > 1 ? "s have" : " has"} no alt (first: ${selectorOf(e)}): describe it, or alt="" if decorative.`, where: where(e), facts: [["images", String(n)]], fix: "Informative images need a description; decorative ones need alt=\"\" so they are skipped.", before: `<img src="hero.jpg">`, after: `<img src="hero.jpg" alt="Team at the 2026 launch">` }));
  group(noName, (e, n) => ({ id: "a11y-name", severity: "high", short: `${n} link/button${n > 1 ? "s have" : " has"} no accessible name (first: ${where(e)}): add text or aria-label.`, where: where(e), facts: [["controls", String(n)]], fix: "Icon-only controls need a label a screen reader can say.", before: `<button><svg/></button>`, after: `<button aria-label="Close"><svg aria-hidden="true"/></button>` }));
  group(noLabel, (e, n) => ({ id: "a11y-label", severity: "high", short: `${n} form field${n > 1 ? "s have" : " has"} no label (first: ${where(e)}): connect a <label for> or aria-label.`, where: where(e), facts: [["fields", String(n)]], fix: "A placeholder is not a label: it disappears and is not reliably announced.", after: `<label for="email">Email</label>\n<input id="email" type="email">` }));
  group(noTitle, (e, n) => ({ id: "a11y-iframe", severity: "medium", short: `${n} iframe${n > 1 ? "s have" : " has"} no title: add title="…".`, where: where(e), facts: [], fix: "The title is what a screen reader announces for the frame." }));
  group(small, (e, n) => ({ id: "a11y-target", severity: "medium", short: `${n} tap target${n > 1 ? "s are" : " is"} smaller than 24×24 px (first: ${where(e)}): enlarge or add padding (WCAG 2.2).`, where: where(e), facts: [["targets", String(n)], ["first", `${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)}px`]], fix: "Padding grows the hit area without changing the look.", after: `.icon-btn { min-width: 24px; min-height: 24px; padding: 6px; }` }));
  group(posTab, (e, n) => ({ id: "a11y-tabindex", severity: "medium", short: `${n} element${n > 1 ? "s use" : " uses"} tabindex > 0: it breaks natural tab order. Use 0 or -1.`, where: where(e), facts: [], fix: "Fix the DOM order instead of forcing the tab order." }));

  // contrast: sampled, computed by the Rust core in one batch
  const textEls: { el: Element; fg: [number, number, number, number]; size: number; bold: boolean }[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const cands: Element[] = [];
  for (let n = walker.nextNode(), guard = 0; n && guard < 6000; n = walker.nextNode(), guard++) {
    if ((n.nodeValue ?? "").trim().length < 3) continue;
    const p = n.parentElement;
    if (p && own(p) && !["SCRIPT", "STYLE", "NOSCRIPT"].includes(p.tagName) && cands[cands.length - 1] !== p) cands.push(p);
  }
  const step = Math.max(1, Math.ceil(cands.length / 220));
  await chunked(cands.filter((_, i) => i % step === 0), (el) => {
    if (!visible(el) || (el as HTMLInputElement).disabled) return;
    const cs = getComputedStyle(el);
    const fg = parseColor(cs.color);
    if (fg) textEls.push({ el, fg, size: parseFloat(cs.fontSize), bold: +cs.fontWeight >= 700 });
  });
  const rows: number[][] = [], kept: typeof textEls = [];
  for (const t of textEls) {
    const bg = backgroundOf(t.el);
    if (!bg) continue;
    rows.push([...t.fg, ...bg]);
    kept.push(t);
  }
  const ratios = getEngine().contrast(rows);
  const bad = kept.map((t, i) => ({ t, ratio: ratios[i]! })).filter(({ t, ratio }) => ratio < (t.size >= 24 || (t.size >= 18.66 && t.bold) ? 3 : 4.5));
  if (bad.length) {
    bad.sort((a, b) => a.ratio - b.ratio);
    const w = bad[0]!;
    push({
      id: "a11y-contrast", severity: w.ratio < 3 ? "high" : "medium", elements: bad.slice(0, 10).map((b) => new WeakRef(b.t.el)),
      short: `${bad.length} of ${kept.length} sampled text blocks have low contrast (worst ${w.ratio.toFixed(2)}:1 at ${where(w.t.el)}): need 4.5:1 (3:1 for large text).`,
      where: where(w.t.el), facts: [["worst ratio", `${w.ratio.toFixed(2)}:1`], ["affected (sample)", `${bad.length}/${kept.length}`], ["text size", `${Math.round(w.t.size)}px`]],
      fix: "Darken the text or lighten the background until the ratio reaches 4.5:1. Dim grays on dark backgrounds are the usual cause.",
    });
  }
  return out;
}
