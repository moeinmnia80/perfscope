import { beforeEach, describe, expect, it } from "vitest";
declare const process: { env: Record<string, string | undefined> };
import { scanA11y } from "../src/collect/a11y";
import { scanBest } from "../src/collect/best";
import { animationFindings, domStats, reflowFindings, shiftFindings } from "../src/collect/layout";
import { scanFonts } from "../src/collect/fonts";
import { scanImages } from "../src/collect/images";
import { selectorOf } from "../src/collect/dom";
import { ReactProbe } from "../src/collect/react";
import { init } from "../src/index";

const rect = (el: Element, w: number, h: number, top = 0) =>
  Object.defineProperty(el, "getBoundingClientRect", { value: () => ({ width: w, height: h, top, left: 0, right: w, bottom: top + h, x: 0, y: top, toJSON() {} }) });

const img = (src: string, nat: [number, number], shown: [number, number], top = 0, attrs: Record<string, string> = {}) => {
  const el = document.createElement("img");
  el.src = src;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  Object.defineProperty(el, "currentSrc", { value: src });
  Object.defineProperty(el, "complete", { value: true });
  Object.defineProperty(el, "naturalWidth", { value: nat[0] });
  Object.defineProperty(el, "naturalHeight", { value: nat[1] });
  rect(el, shown[0], shown[1], top);
  document.body.append(el);
  return el;
};

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  document.body.innerHTML = "";
  document.documentElement.lang = "";
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  performance.clearResourceTimings?.();
  Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
});

describe("images", () => {
  it("uses the LARGEST of several uses as the reference and says the exact target size", async () => {
    const a = img("http://localhost/hero.jpg", [3840, 2560], [300, 200], 2000, { alt: "a" });
    img("http://localhost/hero.jpg", [3840, 2560], [640, 427], 2400, { alt: "b" });
    // pretend resource timing knows the size
    performance.getEntriesByName = ((n: string) => (n.endsWith("hero.jpg") ? [{ encodedBodySize: 900_000, transferSize: 900_000 }] : [])) as never;
    const r = await scanImages(undefined);
    const size = r.findings.find((f) => f.id.startsWith("img-size"))!;
    expect(size).toBeTruthy();
    expect(size.image!.targetW).toBe(1280); // 640 css px * 2
    expect(size.short).toMatch(/3840→1280px/);
    expect(size.short).toMatch(/largest of 2 uses/);
    expect(size.image!.usages).toHaveLength(2);
    void a;
  });

  it("LCP image: lazy-loaded -> high severity, asks for fetchpriority", async () => {
    const el = img("http://localhost/lcp.webp", [1200, 600], [1200, 600], 0, { loading: "lazy", alt: "x", width: "1200", height: "600" });
    performance.getEntriesByName = (() => [{ encodedBodySize: 80_000, transferSize: 80_000 }]) as never;
    const r = await scanImages(el);
    const f = r.findings.find((x) => x.id.startsWith("img-lcp"))!;
    expect(f.severity).toBe("high");
    expect(f.short).toMatch(/LCP image/);
    expect(f.short).toMatch(/fetchpriority/);
  });

  it("below the fold + eager -> lazy; above the fold non-LCP is left alone", async () => {
    img("http://localhost/below.png", [800, 600], [400, 300], 2500, { alt: "x", width: "800", height: "600" });
    img("http://localhost/above.png", [800, 600], [400, 300], 100, { alt: "x", width: "800", height: "600" });
    performance.getEntriesByName = (() => [{ encodedBodySize: 60_000, transferSize: 60_000 }]) as never;
    const r = await scanImages(undefined);
    const lazies = r.findings.filter((f) => f.id.startsWith("img-lazy"));
    expect(lazies).toHaveLength(1);
    expect(lazies[0]!.short).toMatch(/below\.png/);
  });

  it("missing width/height is reported as a layout shift risk", async () => {
    img("http://localhost/nobox.png", [400, 300], [400, 300], 0, { alt: "x" });
    performance.getEntriesByName = (() => []) as never;
    const r = await scanImages(undefined);
    expect(r.findings.some((f) => f.id.startsWith("img-box") && f.category === "layout")).toBe(true);
  });
});

describe("accessibility", () => {
  it("finds missing alt, names, labels, lang, tiny targets", async () => {
    document.body.innerHTML = `<main><img src="a.png"><button><svg></svg></button><input type="text"><a href="#" style="display:block">x</a></main>`;
    document.body.querySelectorAll("*").forEach((e) => rect(e, 10, 10));
    const f = await scanA11y();
    const ids = f.map((x) => x.id);
    expect(ids).toContain("a11y-alt");
    expect(ids).toContain("a11y-name");
    expect(ids).toContain("a11y-label");
    expect(ids).toContain("a11y-lang");
    expect(ids).toContain("a11y-target");
  });

  it("flags low contrast through the engine, ignores good contrast", async () => {
    document.documentElement.lang = "en";
    document.body.innerHTML = `<main><h1>Title</h1><p id="bad" style="color:#777;background:#fff">Low contrast text here</p><p id="ok" style="color:#000;background:#fff">Great contrast text</p></main>`;
    document.body.querySelectorAll("*").forEach((e) => rect(e, 200, 20));
    const f = await scanA11y();
    const c = f.find((x) => x.id === "a11y-contrast")!;
    expect(c).toBeTruthy();
    expect(c.short).toMatch(/1 of 2 sampled/);
  });
});

describe("layout, fonts, best practice", () => {
  it("groups layout shifts per element and explains images vs injected content", () => {
    const el = document.createElement("div");
    el.className = "banner";
    document.body.append(el);
    const node = { el: new WeakRef(el), selector: selectorOf(el), tag: "div", isText: false };
    const f = shiftFindings([{ value: 0.12, time: 1000, nodes: [node] }, { value: 0.05, time: 1500, nodes: [node] }], false);
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("high");
    expect(f[0]!.short).toMatch(/0\.170/);
  });

  it("attributes forced reflow to a function and file", () => {
    const f = reflowFindings([{ start: 0, duration: 120, blocking: 70, forced: 40, scripts: [{ source: "http://x/app.js", fn: "measure", forced: 40, duration: 60, invoker: "click" }] }]);
    expect(f[0]!.short).toMatch(/measure/);
    expect(f[0]!.short).toMatch(/app\.js/);
  });

  it("no running animations -> no findings (jsdom has none)", () => {
    expect(animationFindings()).toEqual([]);
  });

  it("fonts: nothing to report on an empty page", () => {
    expect(scanFonts([], undefined).findings).toEqual([]);
  });

  it("best practice: huge DOM and missing viewport", () => {
    document.body.innerHTML = "<div>" + "<i></i>".repeat(1700) + "</div>";
    const ids = scanBest().map((f) => f.id);
    expect(ids).toContain("dom-size");
    expect(ids).toContain("dom-wide");
    expect(ids).toContain("no-viewport");
    expect(domStats().nodes).toBeGreaterThan(1700);
  });
});

describe("react probe", () => {
  it("attributes self time, detects parent-caused renders and caches nothing it should not", () => {
    const probe = new ReactProbe();
    const g = globalThis as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: { onCommitFiberRoot?: (...a: unknown[]) => void } };
    delete g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    probe.attach();
    const mk = (name: string, props: object, actual: number, child: unknown = null, alt: unknown = null) => ({
      tag: 0, type: { name }, return: null, child, sibling: null, flags: 1, subtreeFlags: 1, alternate: alt, memoizedProps: props, memoizedState: null, actualDuration: actual, selfBaseDuration: actual, stateNode: null,
    });
    const propsSame = { a: 1 };
    const prevChild = mk("Card", { ...propsSame }, 3);
    const child = mk("Card", { ...propsSame }, 6, null, prevChild); // new props object, equal values: parent re-render
    const parent = mk("Page", {}, 10, child);
    g.__REACT_DEVTOOLS_GLOBAL_HOOK__!.onCommitFiberRoot!(1, { current: parent });
    const stats = probe.stats();
    const card = stats.find((s) => s.name === "Card")!;
    expect(card.totalMs).toBe(6);
    expect(card.wasted).toBe(1);
    expect(card.cause).toBe("parent");
    expect(stats.find((s) => s.name === "Page")!.totalMs).toBe(4); // 10 total - 6 in the child
    expect(probe.hasDurations).toBe(true);
  });
});

describe("overlay", () => {
  it("mounts one shadow-DOM host, opens, and cleans up", () => {
    const h = init({ force: true, startOpen: false })!;
    expect(h).toBeTruthy();
    const host = document.getElementById("perfscope-root")!;
    expect(host.shadowRoot).toBeTruthy();
    expect(host.shadowRoot!.querySelector(".launch")).toBeTruthy();
    expect(init({ force: true })).toBe(h); // idempotent
    h.open();
    expect(host.shadowRoot!.querySelector(".ps")!.getAttribute("data-open")).toBe("true");
    expect(host.shadowRoot!.querySelectorAll('[role="tab"]').length).toBe(8);
    h.destroy();
    expect(document.getElementById("perfscope-root")).toBeNull();
  });

  it("is a no-op in production unless forced", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(init()).toBeUndefined();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
