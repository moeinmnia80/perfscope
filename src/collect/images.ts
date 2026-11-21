import { getEngine, type ImagePlan, type ImageUsageIn } from "../engine";
import type { Finding } from "../types";
import { chunked, fileName, isOwn, kb, selectorOf } from "./dom";
import { ownerOf } from "./react";

type Usage = {
  el: HTMLImageElement;
  src: string;
  group: number;
  selector: string;
  owner?: string;
  w: number;
  h: number;
  top: number;
  above: boolean;
  lcp: boolean;
};

export type Measured = { bytes: number; type: string };
const measuredCache = new Map<string, Measured>();

const formatCode = (type: string, src: string) => {
  const t = type.toLowerCase();
  if (t.includes("jpeg") || t.includes("jpg") || /\.jpe?g(\?|$)/i.test(src)) return 1;
  if (t.includes("png") || /\.png(\?|$)/i.test(src)) return 2;
  if (t.includes("webp") || /\.webp(\?|$)/i.test(src)) return 3;
  if (t.includes("avif") || /\.avif(\?|$)/i.test(src)) return 4;
  if (t.includes("gif") || /\.gif(\?|$)/i.test(src)) return 5;
  if (t.includes("svg") || /\.svg(\?|$)/i.test(src)) return 6;
  return 0;
};
const formatName = (c: number) => ["unknown", "JPEG", "PNG", "WebP", "AVIF", "GIF", "SVG"][c] ?? "unknown";

/** Bytes from the browser's own resource timing; 0 means "cross-origin without Timing-Allow-Origin" or served from cache. */
const timingBytes = (src: string) => {
  const e = performance.getEntriesByName(src, "resource").at(-1) as PerformanceResourceTiming | undefined;
  return e ? e.encodedBodySize || e.transferSize || 0 : 0;
};

/** Exact size and type of an image by downloading it (the browser cache usually answers). Capped to 12 MB. */
export const measureImage = async (src: string): Promise<Measured | undefined> => {
  const hit = measuredCache.get(src);
  if (hit) return hit;
  try {
    const res = await fetch(src, { cache: "force-cache" });
    if (!res.ok) return undefined;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > 12_000_000) return undefined;
    const blob = await res.blob();
    const m = { bytes: blob.size, type: blob.type };
    measuredCache.set(src, m);
    return m;
  } catch {
    return undefined; // cross-origin without CORS
  }
};

const isLazy = (el: HTMLImageElement) => el.loading === "lazy";
const hasBox = (el: HTMLImageElement) => {
  if (el.getAttribute("width") && el.getAttribute("height")) return true;
  const cs = getComputedStyle(el);
  return (!!cs.aspectRatio && cs.aspectRatio !== "auto") || !!el.style.aspectRatio;
};

export type ImageScan = { findings: Finding[]; count: number; plans: Map<string, ImagePlan>; usagesBySrc: Map<string, Usage[]> };

export async function scanImages(lcpEl: Element | undefined, onProgress?: () => void): Promise<ImageScan> {
  const imgs = [...document.images].filter((i) => !isOwn(i) && i.currentSrc && i.complete && i.naturalWidth > 0);
  const dpr = window.devicePixelRatio || 1;
  const groupIds = new Map<string, number>();
  const usages: Usage[] = [];

  await chunked(imgs, (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return; // hidden or tracking pixel
    const src = el.currentSrc;
    const g = groupIds.get(src) ?? (groupIds.set(src, groupIds.size + 1), groupIds.size);
    usages.push({
      el, src, group: g, selector: selectorOf(el), owner: ownerOf(el),
      w: r.width, h: r.height, top: r.top + scrollY, above: r.top + scrollY < innerHeight * 1.1, lcp: el === lcpEl,
    });
  });

  // exact bytes: resource timing first, then a real download for the ones it could not size (bounded, 3 at a time)
  const bytes = new Map<string, Measured>();
  const missing: string[] = [];
  for (const src of groupIds.keys()) {
    const b = timingBytes(src);
    if (b) bytes.set(src, { bytes: b, type: measuredCache.get(src)?.type ?? "" });
    else if (!src.startsWith("data:")) missing.push(src);
  }
  const queue = missing.slice(0, 24);
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const m = await measureImage(s);
        if (m) bytes.set(s, m);
      }
    }),
  );
  onProgress?.();

  const engine = getEngine();
  const inputs: ImageUsageIn[] = usages.map((u) => {
    const m = bytes.get(u.src);
    return {
      group: u.group, cssW: u.w, cssH: u.h, naturalW: u.el.naturalWidth, naturalH: u.el.naturalHeight,
      bytes: m?.bytes ?? 0, format: formatCode(m?.type ?? "", u.src), dpr, above: u.above, lcp: u.lcp,
    };
  });
  const plans = new Map<string, ImagePlan>();
  const planList = engine.imagePlan(inputs);
  const bySrc = new Map<string, Usage[]>();
  for (const u of usages) (bySrc.get(u.src) ?? bySrc.set(u.src, []).get(u.src)!).push(u);
  for (const [src, g] of groupIds) {
    const p = planList.find((x) => x.group === g);
    if (p) plans.set(src, p);
  }

  const findings: Finding[] = [];
  for (const [src, list] of bySrc) {
    const plan = plans.get(src)!;
    const m = bytes.get(src);
    const fmt = formatCode(m?.type ?? "", src);
    const first = list[0]!;
    const name = fileName(src);
    const els = list.map((u) => new WeakRef(u.el as Element));
    const where = `${first.owner ? `<${first.owner}> › ` : ""}${first.selector}${list.length > 1 ? ` (+${list.length - 1} more)` : ""}`;
    const natW = first.el.naturalWidth;
    const natH = first.el.naturalHeight;
    const image = {
      src, naturalW: natW, naturalH: natH, targetW: plan.targetW, targetH: plan.targetH,
      bytes: m?.bytes ?? 0, estBytes: plan.estBytes, format: formatName(fmt),
      usages: list.map((u) => ({ selector: u.selector, owner: u.owner, w: Math.round(u.w), h: Math.round(u.h) })),
    };
    const baseFacts: [string, string][] = [
      ["file", name],
      ["natural", `${natW}×${natH}px`],
      ["shown at (largest)", `${Math.round(plan.maxW)}×${Math.round(plan.maxH)} css px · ${dpr.toFixed(1)}x screen`],
      ["used", `${list.length} place${list.length > 1 ? "s" : ""}`],
    ];
    if (m?.bytes) baseFacts.push(["size", `${kb(m.bytes)} · ${formatName(fmt)}`]);
    const isNext = /\/_next\/image/.test(src);

    // 1. oversized
    const tooBig = natW > plan.targetW * 1.2 && natW - plan.targetW >= 48;
    if (tooBig) {
      const save = plan.savings;
      const sev = save > 250_000 || natW > plan.targetW * 3 ? "high" : save > 60_000 ? "medium" : "low";
      findings.push({
        id: `img-size:${src}`, category: "images", severity: sev, elements: els, image,
        short: `Resize ${name} ${natW}→${plan.targetW}px${save ? ` (≈ −${kb(save)})` : ""}.${list.length > 1 ? ` Reference: its largest of ${list.length} uses.` : ""}`,
        where, facts: [...baseFacts, ["target", `${plan.targetW}×${plan.targetH}px`], ...(save ? [["saves", `≈ ${kb(save)} (${Math.round((save / (m?.bytes || 1)) * 100)}%)`] as [string, string]] : [])],
        fix: isNext
          ? `Set a correct \`sizes\` on this next/image (the largest use is ${Math.round(plan.maxW)}px) or lower the source size to ${plan.targetW}px.`
          : `Export it at ${plan.targetW}px wide (${plan.targetW * 2 > natW ? "that is already 2x" : "2x of the largest use"}), or serve several widths with srcset + sizes.`,
        before: `<img src="${name}" ${isNext ? "" : `width="${natW}" `}…>`,
        after: isNext ? `<Image src="…" width={${Math.round(plan.maxW)}} height={${Math.round(plan.maxH)}} sizes="${Math.round(plan.maxW)}px" />` : `<img src="${name.replace(/(\.\w+)$/, `-${plan.targetW}$1`)}" width="${Math.round(plan.maxW)}" height="${Math.round(plan.maxH)}" …>`,
      });
    }

    // 2. format
    if ((fmt === 1 || fmt === 2 || fmt === 5) && (m?.bytes ?? 0) > 30_000) {
      const est = Math.round((m!.bytes * (fmt === 1 ? 0.28 : 0.5)));
      findings.push({
        id: `img-format:${src}`, category: "images", severity: m!.bytes > 300_000 ? "medium" : "low", elements: els, image,
        short: `Serve ${name} as WebP/AVIF (≈ −${kb(est)}).`,
        where, facts: [...baseFacts, ["format", formatName(fmt)]],
        fix: `${formatName(fmt)} compresses worse than WebP/AVIF at the same quality. Convert once, or let the framework image component do it.`,
        before: `<img src="${name}">`, after: `<picture><source srcset="${name.replace(/\.\w+$/, ".avif")}" type="image/avif"><img src="${name.replace(/\.\w+$/, ".webp")}"></picture>`,
      });
    }

    // 3. loading priority
    const lcpUse = list.find((u) => u.lcp);
    if (lcpUse) {
      const el = lcpUse.el;
      const problems: string[] = [];
      if (isLazy(el)) problems.push("it is lazy-loaded");
      if (el.fetchPriority !== "high" && !el.hasAttribute("data-nimg")) problems.push("no fetchpriority=\"high\"");
      if (el.hasAttribute("data-nimg") && el.getAttribute("fetchpriority") !== "high" && isLazy(el)) problems.push("next/image without `priority`");
      if (problems.length) {
        findings.push({
          id: `img-lcp:${src}`, category: "images", severity: "high", elements: [new WeakRef(el as Element)], image,
          short: `${name} is the LCP image and ${problems[0]}: ${el.hasAttribute("data-nimg") ? "add priority" : "remove loading=lazy, add fetchpriority=\"high\""}.`,
          where: `${lcpUse.owner ? `<${lcpUse.owner}> › ` : ""}${lcpUse.selector}`,
          facts: [...baseFacts, ["role", "Largest Contentful Paint element"], ["problem", problems.join(", ")]],
          fix: "The browser must start downloading the LCP image immediately. Lazy loading delays it until layout; high priority moves it to the front of the queue.",
          before: `<img src="${name}" loading="lazy">`, after: el.hasAttribute("data-nimg") ? `<Image src="…" priority />` : `<img src="${name}" fetchpriority="high">`,
        });
      }
    } else {
      const eager = list.filter((u) => !u.above && !isLazy(u.el) && !u.lcp);
      if (eager.length && (m?.bytes ?? 0) + (natW > 600 ? 40_000 : 0) > 15_000) {
        const e = eager[0]!;
        findings.push({
          id: `img-lazy:${src}`, category: "images", severity: "low", elements: eager.map((u) => new WeakRef(u.el as Element)), image,
          short: `${name} is below the fold: add loading="lazy".`,
          where: `${e.owner ? `<${e.owner}> › ` : ""}${e.selector}`,
          facts: [...baseFacts, ["position", `${Math.round(e.top)}px from the top (screen ${innerHeight}px)`]],
          fix: "Off-screen images should not compete with what the visitor sees first. Native lazy loading needs no JavaScript.",
          before: `<img src="${name}">`, after: `<img src="${name}" loading="lazy" decoding="async">`,
        });
      }
    }

    // 4. layout shift: no reserved box
    const shifty = list.find((u) => !hasBox(u.el));
    if (shifty) {
      findings.push({
        id: `img-box:${src}:${shifty.selector}`, category: "layout", severity: "medium", elements: [new WeakRef(shifty.el as Element)], image,
        short: `${name} has no width/height: the page jumps when it loads. Add width="${natW}" height="${natH}" or aspect-ratio.`,
        where: `${shifty.owner ? `<${shifty.owner}> › ` : ""}${shifty.selector}`,
        facts: baseFacts,
        fix: "With both attributes the browser reserves the right box before the file arrives (CSS `height:auto` keeps it responsive).",
        before: `<img src="${name}">`, after: `<img src="${name}" width="${natW}" height="${natH}">`,
      });
    }

    // 5. upscaled (blurry)
    if (plan.maxW > natW * 1.15 && fmt !== 6) {
      findings.push({
        id: `img-up:${src}`, category: "images", severity: "low", elements: els, image,
        short: `${name} is shown ${Math.round(plan.maxW)}px wide but is only ${natW}px: it will look soft.`,
        where, facts: baseFacts,
        fix: `Provide a source at least ${Math.round(plan.maxW * Math.min(dpr, 2))}px wide, or a vector (SVG) if it is a logo or icon.`,
      });
    }

    // 6. weight alone
    if (!tooBig && (m?.bytes ?? 0) > 400_000) {
      findings.push({
        id: `img-heavy:${src}`, category: "images", severity: m!.bytes > 1_000_000 ? "high" : "medium", elements: els, image,
        short: `${name} weighs ${kb(m!.bytes)} at the right size: compress it harder.`,
        where, facts: baseFacts,
        fix: "Re-encode with quality 70–80 (or AVIF). Photos rarely need more.",
      });
    }
  }
  return { findings, count: usages.length, plans, usagesBySrc: bySrc };
}

/** Re-encode an image in the page at its target size, in the browser, so the developer can download the exact result. */
export async function optimizeImage(src: string, targetW: number, type: "image/webp" | "image/avif" | "image/jpeg" = "image/webp", quality = 0.8): Promise<{ blob: Blob; w: number; h: number } | { error: string }> {
  try {
    const res = await fetch(src, { cache: "force-cache" });
    const bmp = await createImageBitmap(await res.blob());
    const w = Math.min(targetW, bmp.width);
    const h = Math.round((bmp.height * w) / bmp.width);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await canvas.convertToBlob({ type, quality });
    return { blob, w, h };
  } catch {
    return { error: "This image is cross-origin without CORS headers, so the browser will not let perfscope read its pixels. Download the original and convert it locally." };
  }
}
