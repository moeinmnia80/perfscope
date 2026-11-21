import type { Vitals } from "../types";
import { isOwn, selectorOf } from "./dom";

export type ShiftEntry = {
  value: number;
  time: number;
  nodes: { el: WeakRef<Element>; selector: string; tag: string; isText: boolean }[];
};
export type FrameEntry = {
  start: number;
  duration: number;
  blocking: number;
  forced: number;
  scripts: { source: string; fn: string; forced: number; duration: number; invoker: string }[];
};

/**
 * Passive observers only: they cost nothing between events and are the same ones DevTools uses.
 * Everything is kept in small bounded buffers.
 */
export class VitalsCollector {
  lcp?: { ms: number; el?: WeakRef<Element>; url?: string; size: number };
  cls = 0;
  fcp?: number;
  longTasks = 0;
  inp?: number;
  shifts: ShiftEntry[] = [];
  frames: FrameEntry[] = [];
  private observers: PerformanceObserver[] = [];
  private interactions = new Map<number, number>();

  start() {
    const watch = (type: string, cb: (list: PerformanceObserverEntryList) => void, opts: PerformanceObserverInit = {}) => {
      try {
        const po = new PerformanceObserver(cb);
        po.observe({ type, buffered: true, ...opts } as PerformanceObserverInit);
        this.observers.push(po);
      } catch {
        /* entry type not supported in this browser */
      }
    };

    watch("largest-contentful-paint", (l) => {
      const e = l.getEntries().at(-1) as (PerformanceEntry & { element?: Element; url?: string; size: number; renderTime: number; loadTime: number }) | undefined;
      if (e) this.lcp = { ms: e.renderTime || e.loadTime || e.startTime, el: e.element ? new WeakRef(e.element) : undefined, url: e.url || undefined, size: e.size };
    });

    watch("layout-shift", (l) => {
      for (const e of l.getEntries() as unknown as {
        value: number; hadRecentInput: boolean; startTime: number;
        sources?: { node?: Node | null }[];
      }[]) {
        if (e.hadRecentInput) continue;
        this.cls += e.value; // sum is a close upper bound of the worst session window: simple and stable in dev
        const nodes = (e.sources ?? [])
          .map((s) => s.node)
          .filter((n): n is Node => !!n)
          .map((n) => {
            const isText = n.nodeType === 3;
            const el = (isText ? n.parentElement : (n as Element)) as Element | null;
            return el && !isOwn(el) ? { el: new WeakRef(el), selector: selectorOf(el), tag: el.tagName.toLowerCase(), isText } : null;
          })
          .filter((x): x is NonNullable<typeof x> => !!x);
        if (nodes.length) {
          this.shifts.push({ value: e.value, time: e.startTime, nodes });
          if (this.shifts.length > 60) this.shifts.shift();
        }
      }
    });

    watch("paint", (l) => {
      const p = l.getEntries().find((x) => x.name === "first-contentful-paint");
      if (p) this.fcp = p.startTime;
    });

    watch("longtask", (l) => {
      this.longTasks += l.getEntries().length;
    });

    // Long Animation Frames (Chromium): says how much of a slow frame was FORCED style/layout and which script did it
    watch("long-animation-frame", (l) => {
      for (const e of l.getEntries() as unknown as {
        startTime: number; duration: number; blockingDuration?: number;
        scripts?: { sourceURL: string; sourceFunctionName: string; forcedStyleAndLayoutDuration: number; duration: number; invoker: string }[];
      }[]) {
        const scripts = (e.scripts ?? []).map((s) => ({
          source: s.sourceURL, fn: s.sourceFunctionName, forced: s.forcedStyleAndLayoutDuration, duration: s.duration, invoker: s.invoker,
        }));
        this.frames.push({ start: e.startTime, duration: e.duration, blocking: e.blockingDuration ?? 0, forced: scripts.reduce((a, s) => a + s.forced, 0), scripts });
        if (this.frames.length > 40) this.frames.shift();
      }
    });

    // Interaction latency (INP-style): the worst interaction seen so far, grouped by interactionId
    watch("event", (l) => {
      for (const e of l.getEntries() as unknown as { interactionId?: number; duration: number }[]) {
        if (!e.interactionId) continue;
        this.interactions.set(e.interactionId, Math.max(this.interactions.get(e.interactionId) ?? 0, e.duration));
        if (this.interactions.size > 80) this.interactions.delete(this.interactions.keys().next().value!);
      }
      const all = [...this.interactions.values()].sort((a, b) => b - a);
      this.inp = all.length ? all[Math.min(Math.floor(all.length / 50), all.length - 1)] : undefined;
    }, { durationThreshold: 40 } as PerformanceObserverInit);
  }

  stop() {
    this.observers.forEach((o) => o.disconnect());
    this.observers = [];
  }

  /** a new route: shifts and long frames belong to the old page */
  reset() {
    this.shifts = [];
    this.frames = [];
    this.cls = 0;
    this.longTasks = 0;
    this.interactions.clear();
    this.inp = undefined;
  }

  snapshot(): Omit<Vitals, "score"> {
    const el = this.lcp?.el?.deref();
    return {
      lcp: this.lcp ? { ms: this.lcp.ms, selector: el ? selectorOf(el) : undefined, url: this.lcp.url, size: this.lcp.size } : undefined,
      cls: Math.round(this.cls * 1000) / 1000,
      inp: this.inp,
      fcp: this.fcp,
      longTasks: this.longTasks,
    };
  }
}
