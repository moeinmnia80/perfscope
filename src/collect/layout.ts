import { getEngine } from "../engine";
import type { Finding } from "../types";
import type { FrameEntry, ShiftEntry } from "./vitals";
import { chunked, fileName, isOwn, ms, nodeId, selectorOf } from "./dom";
import { ownerOf } from "./react";

/* ------------------------------------------------------------------ layout shifts (CLS) */

export function shiftFindings(shifts: ShiftEntry[], skipFontText: boolean): Finding[] {
  const by = new Map<string, { value: number; count: number; el: WeakRef<Element>; tag: string; selector: string }>();
  for (const s of shifts) {
    const share = s.value / Math.max(s.nodes.length, 1);
    for (const n of s.nodes) {
      if (skipFontText && n.isText) continue;
      const cur = by.get(n.selector);
      if (cur) { cur.value += share; cur.count++; }
      else by.set(n.selector, { value: share, count: 1, el: n.el, tag: n.tag, selector: n.selector });
    }
  }
  return [...by.values()]
    .filter((x) => x.value >= 0.005)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)
    .map((x): Finding => {
      const el = x.el.deref();
      const owner = el ? ownerOf(el) : undefined;
      const hint =
        x.tag === "img" || x.tag === "video" ? ["Reserve the box: width + height attributes (or aspect-ratio).", `<${x.tag} width="800" height="450" …>`]
        : x.tag === "iframe" ? ["Give the embed a fixed height or aspect-ratio before it loads.", `iframe { aspect-ratio: 16 / 9; width: 100% }`]
        : ["Content was inserted above existing content. Reserve its space (min-height / skeleton), or insert it below the viewport.", `.slot { min-height: 120px; }`];
      return {
        id: `cls:${x.selector}`, category: "layout", severity: x.value > 0.1 ? "high" : x.value > 0.025 ? "medium" : "low",
        elements: [x.el],
        short: `${owner ? `<${owner}> ` : ""}${x.selector} shifted the page (CLS +${x.value.toFixed(3)}, ${x.count}×): ${hint[0]}`,
        where: `${owner ? `<${owner}> › ` : ""}${x.selector}`,
        facts: [["layout shift", `+${x.value.toFixed(3)}`], ["times", String(x.count)], ["element", `<${x.tag}>`]],
        fix: hint[0]!, after: hint[1],
      };
    });
}

/* ------------------------------------------------------------------ forced reflow (Long Animation Frames) */

export function reflowFindings(frames: FrameEntry[]): Finding[] {
  const by = new Map<string, { forced: number; count: number; max: number; fn: string; source: string; invoker: string }>();
  for (const f of frames) {
    for (const s of f.scripts) {
      if (s.forced < 4) continue;
      const k = `${s.source}|${s.fn}`;
      const cur = by.get(k);
      if (cur) { cur.forced += s.forced; cur.count++; cur.max = Math.max(cur.max, s.forced); }
      else by.set(k, { forced: s.forced, count: 1, max: s.forced, fn: s.fn, source: s.source, invoker: s.invoker });
    }
  }
  const out: Finding[] = [...by.values()]
    .sort((a, b) => b.forced - a.forced)
    .slice(0, 4)
    .map((s) => ({
      id: `reflow:${s.source}:${s.fn}`, category: "layout" as const, severity: s.forced > 50 ? "high" as const : s.forced > 16 ? "medium" as const : "low" as const,
      short: `Forced reflow: ${s.fn || "anonymous function"} (${fileName(s.source)}) spent ${ms(s.forced)} reading layout right after changing the DOM, ${s.count}×. Batch reads before writes.`,
      where: `${s.fn || "(anonymous)"} · ${fileName(s.source)}`,
      facts: [["forced layout total", ms(s.forced)], ["worst call", ms(s.max)], ["frames", String(s.count)], ["trigger", s.invoker || "-"]],
      fix: "Reading offsetWidth, getBoundingClientRect(), scrollTop … after a write makes the browser lay the page out immediately. Do all reads first, then all writes (or use ResizeObserver / requestAnimationFrame).",
      before: `el.style.width = "10px";\nconst h = el.offsetHeight; // forced layout\nel.style.height = h + "px";`,
      after: `const h = el.offsetHeight; // read\nrequestAnimationFrame(() => {\n  el.style.width = "10px"; // write\n  el.style.height = h + "px";\n});`,
    }));
  const slow = frames.filter((f) => f.duration > 120);
  if (slow.length && !out.length) {
    const worst = slow.reduce((a, b) => (b.duration > a.duration ? b : a));
    out.push({
      id: "slow-frame", category: "layout", severity: worst.duration > 300 ? "high" : "medium",
      short: `${slow.length} slow frame${slow.length > 1 ? "s" : ""} (worst ${ms(worst.duration)}, ${ms(worst.blocking)} blocking input): split the long script.`,
      where: worst.scripts[0] ? `${worst.scripts[0].fn || "(anonymous)"} · ${fileName(worst.scripts[0].source)}` : "main thread",
      facts: [["worst frame", ms(worst.duration)], ["blocking input", ms(worst.blocking)]],
      fix: "Break the work into smaller tasks (await scheduler.yield()) or move it to a Worker.",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ repaint / reflow cost of animations and CSS */

const LAYOUT_PROPS = /^(width|height|min-|max-|top|left|right|bottom|margin|padding|border-(top|right|bottom|left)?-?width|font-size|line-height|letter-spacing|flex|grid|gap|inset|display|position)/;
const PAINT_PROPS = /^(background|color|box-shadow|text-shadow|border-(color|radius)|outline|filter|backdrop-filter|clip-path|mask|fill|stroke|opacity$)/;
const camel = (p: string) => p.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

/** Animations that are running RIGHT NOW and what they force the browser to redo each frame. */
export function animationFindings(): Finding[] {
  const out: Finding[] = [];
  let list: Animation[] = [];
  try { list = document.getAnimations(); } catch { return out; }
  const seen = new Set<string>();
  for (const a of list) {
    const eff = a.effect as KeyframeEffect | null;
    const target = eff?.target as Element | null | undefined;
    if (!eff || !target || isOwn(target) || a.playState !== "running") continue;
    let props = new Set<string>();
    try {
      for (const kf of eff.getKeyframes()) for (const k of Object.keys(kf)) if (!["offset", "easing", "composite", "computedOffset"].includes(k)) props.add(camel(k));
    } catch { continue; }
    const layout = [...props].filter((p) => LAYOUT_PROPS.test(p));
    const paint = [...props].filter((p) => PAINT_PROPS.test(p) && p !== "opacity");
    if (!layout.length && !paint.length) continue;
    const sel = selectorOf(target);
    const key = sel + [...props].join();
    if (seen.has(key)) continue;
    seen.add(key);
    const name = (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "animation";
    const owner = ownerOf(target);
    if (layout.length) {
      out.push({
        id: `anim-layout:${key}`, category: "layout", severity: "high", elements: [new WeakRef(target)],
        short: `${sel} animates ${layout.slice(0, 3).join(", ")} (${name}): layout runs every frame. Use transform (translate/scale) instead.`,
        where: `${owner ? `<${owner}> › ` : ""}${sel}`, facts: [["animated", layout.join(", ")], ["type", a.constructor.name]],
        fix: "Animating geometry forces style → layout → paint → composite on each frame, and moves neighbors. `transform` and `opacity` skip layout and paint and run on the compositor.",
        before: `@keyframes ${name} { to { left: 200px; width: 300px } }`, after: `@keyframes ${name} { to { transform: translateX(200px) scaleX(1.5) } }`,
      });
    } else {
      out.push({
        id: `anim-paint:${key}`, category: "paint", severity: paint.some((p) => /filter|shadow|backdrop/.test(p)) ? "medium" : "low", elements: [new WeakRef(target)],
        short: `${sel} repaints every frame while animating ${paint.slice(0, 3).join(", ")} (${name}). Animate transform/opacity, or fade a pseudo-element that holds the final look.`,
        where: `${owner ? `<${owner}> › ` : ""}${sel}`, facts: [["animated", paint.join(", ")]],
        fix: "Paint properties can't run on the compositor. For a box-shadow, put the shadow on a ::after and animate its opacity. For a background color, cross-fade two layers.",
        before: `.card:hover { box-shadow: 0 20px 40px #0006 }`, after: `.card::after { content:""; position:absolute; inset:0; box-shadow:0 20px 40px #0006; opacity:0; transition:opacity .2s }\n.card:hover::after { opacity:1 }`,
      });
    }
  }
  return out;
}

/** CSS that makes the browser repaint or re-layout more than it must: `transition: all`, huge blurs, will-change spam. */
export async function paintFindings(): Promise<Finding[]> {
  const out: Finding[] = [];
  const all = [...document.body.querySelectorAll("*")].filter((e) => !isOwn(e)) as HTMLElement[];
  const sample = all.length > 2500 ? all.filter((_, i) => i % Math.ceil(all.length / 2500) === 0) : all;
  const area = innerWidth * innerHeight;
  const heavy: { el: HTMLElement; what: string; a: number }[] = [];
  const transAll: HTMLElement[] = [];
  const willChange: HTMLElement[] = [];

  await chunked(sample, (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none") return;
    if (cs.transitionProperty === "all" && cs.transitionDuration !== "0s") transAll.push(el);
    if (cs.willChange !== "auto" && /transform|opacity|filter|left|top|width|height/.test(cs.willChange)) willChange.push(el);
    const bf = cs.backdropFilter && cs.backdropFilter !== "none" ? cs.backdropFilter : cs.filter !== "none" && /blur/.test(cs.filter) ? cs.filter : "";
    if (bf) {
      const r = el.getBoundingClientRect();
      const a = (Math.min(r.width, innerWidth) * Math.min(r.height, innerHeight)) / area;
      if (a > 0.12) heavy.push({ el, what: bf, a });
    }
  });

  heavy.sort((a, b) => b.a - a.a).slice(0, 3).forEach((h) => {
    out.push({
      id: `paint-blur:${selectorOf(h.el)}`, category: "paint", severity: h.a > 0.5 ? "high" : "medium", elements: [new WeakRef(h.el as Element)],
      short: `${selectorOf(h.el)} blurs ${Math.round(h.a * 100)}% of the screen (${h.what.split("(")[0]}): costly on every scroll/animation frame. Shrink the area or the radius.`,
      where: selectorOf(h.el), facts: [["effect", h.what], ["covers", `${Math.round(h.a * 100)}% of viewport`]],
      fix: "Blur is repainted whenever anything behind it moves. Limit it to small surfaces (nav, a card), lower the radius, or use a flat translucent color on large areas.",
    });
  });
  if (transAll.length) {
    out.push({
      id: "paint-transition-all", category: "paint", severity: transAll.length > 12 ? "medium" : "low", elements: transAll.slice(0, 8).map((e) => new WeakRef(e as Element)),
      short: `${transAll.length} element${transAll.length > 1 ? "s use" : " uses"} transition: all (e.g. ${selectorOf(transAll[0]!)}): it animates layout properties by accident. List the properties.`,
      where: selectorOf(transAll[0]!), facts: [["elements", String(transAll.length)]],
      fix: "`all` includes width, height, margin… so any class change can trigger an animated reflow. Name only what you mean.",
      before: `transition: all .3s;`, after: `transition: transform .3s, opacity .3s, background-color .3s;`,
    });
  }
  if (willChange.length > 8) {
    out.push({
      id: "paint-will-change", category: "paint", severity: "medium", elements: willChange.slice(0, 8).map((e) => new WeakRef(e as Element)),
      short: `${willChange.length} elements have will-change set permanently: each holds its own GPU layer (memory). Set it only while animating.`,
      where: selectorOf(willChange[0]!), facts: [["elements", String(willChange.length)]],
      fix: "Add will-change on hover/intersect and remove it after the animation ends.",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ JS-driven mutation churn */

export class ChurnWatcher {
  private mo?: MutationObserver;
  private events: [number, number][] = [];
  private refs = new Map<number, WeakRef<Element>>();
  private start() {}
  attach() {
    if (this.mo || typeof MutationObserver === "undefined") return;
    this.mo = new MutationObserver((list) => {
      const t = performance.now();
      for (const m of list) {
        const el = (m.target.nodeType === 3 ? m.target.parentElement : (m.target as Element)) as Element | null;
        if (!el || isOwn(el)) continue;
        const id = nodeId(el);
        this.events.push([id, t]);
        if (!this.refs.has(id)) this.refs.set(id, new WeakRef(el));
      }
      if (this.events.length > 6000) this.events.splice(0, this.events.length - 4000); // ring buffer
    });
    this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"], characterData: true, subtree: true });
    void this.start;
  }
  detach() {
    this.mo?.disconnect();
    this.mo = undefined;
  }
  reset() {
    this.events = [];
    this.refs.clear();
  }
  findings(): Finding[] {
    if (!this.events.length) return [];
    const cutoff = performance.now() - 15_000;
    const recent = this.events.filter((e) => e[1] > cutoff);
    const rows = getEngine().churn(recent);
    return rows
      .filter((r) => r.perSecond >= 25)
      .sort((a, b) => b.perSecond - a.perSecond)
      .slice(0, 4)
      .flatMap((r) => {
        const el = this.refs.get(r.id)?.deref();
        if (!el) return [];
        const sel = selectorOf(el);
        const owner = ownerOf(el);
        return [{
          id: `churn:${sel}`, category: "paint" as const, severity: r.perSecond > 50 ? "high" as const : "medium" as const, elements: [new WeakRef(el)],
          short: `${sel} is rewritten ${r.perSecond}× per second from JavaScript (style/class/text): every write can mean style + layout + paint. Drive it with transform / a CSS variable / WAAPI.`,
          where: `${owner ? `<${owner}> › ` : ""}${sel}`, facts: [["writes per second (peak)", String(r.perSecond)], ["writes observed", String(r.count)]],
          fix: "Per-frame inline style updates (scroll handlers, mouse followers) are the usual cause. Move the value into one CSS variable on an ancestor and let CSS use it with `transform`, or use the Web Animations API.",
          before: `onScroll: el.style.top = y + "px"`, after: `onScroll: el.style.setProperty("--y", y + "px")  /* .el { transform: translate3d(0, var(--y), 0) } */`,
        }];
      });
  }
}

/* ------------------------------------------------------------------ DOM size: layout cost is proportional to it */

export function domStats() {
  const all = document.body ? document.body.getElementsByTagName("*") : ([] as unknown as HTMLCollectionOf<Element>);
  let depth = 0, widest = 0, widestEl: Element | null = null;
  const stack: [Element, number][] = document.body ? [[document.body, 1]] : [];
  while (stack.length) {
    const [el, d] = stack.pop()!;
    if (isOwn(el)) continue;
    depth = Math.max(depth, d);
    if (el.children.length > widest) { widest = el.children.length; widestEl = el; }
    for (const c of el.children) stack.push([c, d + 1]);
  }
  return { nodes: all.length, depth, widest, widestEl };
}
