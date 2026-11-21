import { getEngine, loadEngine } from "./engine";
import { scanA11y } from "./collect/a11y";
import { scanBest } from "./collect/best";
import { domStats, ChurnWatcher, animationFindings, paintFindings, reflowFindings, shiftFindings } from "./collect/layout";
import { scanFonts } from "./collect/fonts";
import { scanImages } from "./collect/images";
import { ReactProbe, hasReact, snapshotComponents } from "./collect/react";
import { VitalsCollector } from "./collect/vitals";
import { isOwn, ms, yieldToMain } from "./collect/dom";
import type { ComponentStat, Finding, Report, Settings } from "./types";

type Listener = (r: Report | undefined, scanning: boolean) => void;

const RANK = { high: 0, medium: 1, low: 2 } as const;

/**
 * The brain: owns the observers, decides WHEN to scan (idle, after load, on route change, on demand),
 * and assembles one Report. It never scans while the tab is hidden, never twice at once, and every
 * scan is cut into ≤ 6 ms slices that yield to input.
 */
export class Scope {
  readonly vitals = new VitalsCollector();
  readonly react = new ReactProbe();
  readonly churn = new ChurnWatcher();
  report?: Report;
  scanning = false;
  private listeners = new Set<Listener>();
  private timer = 0;
  private pending = false;
  private lastPath = "";
  private unhook: (() => void)[] = [];
  private startedAt = performance.now();

  constructor(public settings: Settings) {}

  start() {
    void loadEngine();
    this.react.attach();
    this.vitals.start();
    if (this.settings.watchMutations) this.churn.attach();
    this.lastPath = location.pathname;

    // route changes (history API + back/forward): old shifts and component stats belong to the old page
    const wrap = (k: "pushState" | "replaceState") => {
      const orig = history[k];
      history[k] = function (this: History, ...a: Parameters<History["pushState"]>) {
        const r = orig.apply(this, a);
        queueMicrotask(() => scope.onRoute());
        return r;
      } as typeof orig;
      this.unhook.push(() => (history[k] = orig));
    };
    const scope = this;
    wrap("pushState");
    wrap("replaceState");
    const pop = () => this.onRoute();
    addEventListener("popstate", pop);
    this.unhook.push(() => removeEventListener("popstate", pop));

    const onLoad = () => this.schedule(1800);
    if (document.readyState === "complete") onLoad();
    else addEventListener("load", onLoad, { once: true });

    const vis = () => { if (!document.hidden && this.pending) this.schedule(300); };
    document.addEventListener("visibilitychange", vis);
    this.unhook.push(() => document.removeEventListener("visibilitychange", vis));
  }

  stop() {
    this.vitals.stop();
    this.churn.detach();
    clearTimeout(this.timer);
    this.unhook.forEach((f) => f());
    this.unhook = [];
    this.listeners.clear();
  }

  setWatch(on: boolean) {
    if (on) this.churn.attach();
    else this.churn.detach();
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit() {
    this.listeners.forEach((l) => l(this.report, this.scanning));
  }

  private onRoute() {
    if (location.pathname === this.lastPath) return;
    this.lastPath = location.pathname;
    this.vitals.reset();
    this.react.reset();
    this.churn.reset();
    this.schedule(1200); // let the new page render and settle first
  }

  /** Debounced: many requests in a row cost one scan. */
  schedule(delay = 400) {
    clearTimeout(this.timer);
    this.pending = true;
    this.timer = window.setTimeout(() => void this.scan(), delay);
  }

  async scan(): Promise<Report | undefined> {
    if (this.scanning) return this.report;
    if (document.hidden) { this.pending = true; return this.report; }
    this.pending = false;
    this.scanning = true;
    this.emit();
    const t0 = performance.now();
    const reactCost0 = this.react.cost;
    try {
      await loadEngine();
      await yieldToMain();
      const v = this.vitals.snapshot();
      const lcpEl = this.vitals.lcp?.el?.deref();
      const findings: Finding[] = [];

      const imgs = await scanImages(lcpEl);
      findings.push(...imgs.findings);
      await yieldToMain();

      const fonts = scanFonts(this.vitals.shifts, this.vitals.lcp?.ms);
      findings.push(...fonts.findings);
      const fontSwap = fonts.findings.some((f) => f.id === "font-swap-shift");
      findings.push(...shiftFindings(this.vitals.shifts, fontSwap));
      findings.push(...reflowFindings(this.vitals.frames));
      findings.push(...animationFindings());
      await yieldToMain();

      findings.push(...(await paintFindings()));
      findings.push(...this.churn.findings());
      await yieldToMain();

      findings.push(...(await scanA11y()));
      findings.push(...scanBest());

      // components
      let components: ComponentStat[] = [];
      let reactTiming: Report["reactTiming"] = "no-react";
      if (this.react.commits > 0 && this.react.hasDurations) {
        components = this.react.stats();
        reactTiming = "live";
      } else if (hasReact()) {
        const snap = snapshotComponents();
        components = snap.stats;
        reactTiming = snap.ok ? "snapshot" : "unavailable";
      }
      findings.push(...componentFindings(components, reactTiming));

      // ordering: severity, then a stable id
      findings.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.id.localeCompare(b.id));

      const engine = getEngine();
      const score = engine.score(v.lcp?.ms ?? NaN, v.cls, v.inp ?? NaN, innerWidth < 800);
      const d = domStats();
      const selfMs = performance.now() - t0 + (this.react.cost - reactCost0);
      this.report = {
        at: Date.now(), url: location.pathname, findings,
        vitals: { ...v, score: Number.isNaN(score) ? undefined : score },
        components: components.sort((a, b) => b.totalMs - a.totalMs), reactTiming, engine: engine.kind, selfMs,
        stats: { nodes: d.nodes, depth: d.depth, images: imgs.count, fonts: fonts.count },
      };
    } catch (e) {
      console.warn("[perfscope] scan failed:", e);
    } finally {
      this.scanning = false;
      this.emit();
    }
    return this.report;
  }
}

/** Top components by self time, plus the ones that re-render for nothing. Ranking is done by the Rust core. */
function componentFindings(list: ComponentStat[], mode: Report["reactTiming"]): Finding[] {
  const out: Finding[] = [];
  if (mode === "unavailable") {
    out.push({
      id: "react-prod", category: "components", severity: "low",
      short: "React durations are unavailable: this looks like a production build. Run the dev server to see per-component time.",
      where: "react", facts: [], fix: "React only measures render time in development and profiling builds.",
    });
    return out;
  }
  if (!list.length) return out;
  const engine = getEngine();
  const top = engine.topK(list.map((c) => c.totalMs), 5).map((i) => list[i]!).filter((c) => c.totalMs >= 1);
  for (const c of top) {
    const avg = c.totalMs / Math.max(c.renders, 1);
    out.push({
      id: `component:${c.name}`, category: "components", severity: c.totalMs > 50 || c.maxMs > 16 ? "high" : c.totalMs > 15 ? "medium" : "low",
      elements: c.element ? [c.element] : undefined,
      short: `<${c.name}> cost ${ms(c.totalMs)} over ${c.renders} render${c.renders > 1 ? "s" : ""} (worst ${ms(c.maxMs)})${c.wasted > c.renders * 0.5 && c.renders > 2 ? `, ${c.wasted} of them for nothing: wrap in React.memo.` : c.maxMs > 16 ? ": it blocks a frame. Memoize the heavy part or split it." : "."}`,
      where: `<${c.name}>`,
      facts: [["total self time", ms(c.totalMs)], ["renders", String(c.renders)], ["average", ms(avg)], ["worst", ms(c.maxMs)], ["re-rendered with unchanged props/state", `${c.wasted} (${Math.round((c.wasted / Math.max(c.renders, 1)) * 100)}%)`], ...(c.props.length ? [["props that changed", c.props.join(", ")] as [string, string]] : [])],
      fix: c.wasted > c.renders * 0.5 ? "Most renders are caused by the parent, not by this component's own data. React.memo it (and stabilise callback/object props with useCallback/useMemo), or let React Compiler do it." : "Find what is expensive inside: a big list, a derived value, a heavy effect. useMemo the computation, virtualise the list, or move state down.",
      before: `export function ${c.name}(props) { … }`, after: `export const ${c.name} = React.memo(function ${c.name}(props) { … });`,
    });
  }
  const storm = list.filter((c) => c.renders >= 25 && c.wasted / c.renders > 0.7 && !top.includes(c)).sort((a, b) => b.renders - a.renders)[0];
  if (storm) {
    out.push({
      id: `render-storm:${storm.name}`, category: "components", severity: "medium", elements: storm.element ? [storm.element] : undefined,
      short: `<${storm.name}> re-rendered ${storm.renders}× and ${storm.wasted} times nothing of its own changed: React.memo / move state down.`,
      where: `<${storm.name}>`, facts: [["renders", String(storm.renders)], ["wasted", String(storm.wasted)]],
      fix: "Parent state changes re-render every child by default. Memoize it or keep the changing state closer to where it is used.",
    });
  }
  return out;
}

export { isOwn };
