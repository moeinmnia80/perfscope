import type { ComponentStat } from "../types";

/* A very small React fiber reader. Field names are React's internals (stable since 16.8):
   tag, type, return, child, sibling, flags, subtreeFlags, alternate, memoizedProps, memoizedState,
   actualDuration, selfBaseDuration, stateNode. */

type Fiber = {
  tag: number; type: unknown; return: Fiber | null; child: Fiber | null; sibling: Fiber | null;
  flags: number; subtreeFlags?: number; alternate: Fiber | null;
  memoizedProps: Record<string, unknown> | null; memoizedState: unknown;
  actualDuration?: number; selfBaseDuration?: number; stateNode: unknown;
};
type Hook = { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevHook };
type DevHook = {
  supportsFiber?: boolean;
  renderers?: Map<number, unknown>;
  inject?: (r: unknown) => number;
  onCommitFiberRoot?: (id: number, root: { current: Fiber }, priority?: unknown, didError?: boolean) => void;
  onCommitFiberUnmount?: (...a: unknown[]) => void;
  onPostCommitFiberRoot?: (...a: unknown[]) => void;
  checkDCE?: (...a: unknown[]) => void;
  __perfscope?: boolean;
};

const FUNCTION = 0, CLASS = 1, FORWARD_REF = 11, MEMO = 14, SIMPLE_MEMO = 15, HOST = 5;
const PERFORMED_WORK = 1;
const isComponent = (t: number) => t === FUNCTION || t === CLASS || t === FORWARD_REF || t === MEMO || t === SIMPLE_MEMO;

const nameOf = (f: Fiber): string | undefined => {
  const t = f.type as { displayName?: string; name?: string; render?: { displayName?: string; name?: string }; type?: { displayName?: string; name?: string } } | null;
  if (!t) return undefined;
  const n = t.displayName || t.name || t.render?.displayName || t.render?.name || t.type?.displayName || t.type?.name;
  return n && n.length > 1 && n !== "Anonymous" ? n : undefined;
};

const shallowChangedKeys = (a: Record<string, unknown> | null, b: Record<string, unknown> | null): string[] => {
  if (!a || !b) return [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of keys) if (k !== "children" && !Object.is(a[k], b[k])) out.push(k);
  return out;
};

/** Did a hook-based component change state of its own? (hooks with an update queue are useState/useReducer) */
const stateChanged = (cur: Fiber, prev: Fiber): boolean => {
  if (cur.tag === CLASS) return cur.memoizedState !== prev.memoizedState;
  let a = cur.memoizedState as { memoizedState: unknown; queue: unknown; next: unknown } | null;
  let b = prev.memoizedState as typeof a;
  for (let i = 0; a && b && i < 24; i++, a = a.next as typeof a, b = b.next as typeof b) {
    if (a.queue && !Object.is(a.memoizedState, b.memoizedState)) return true;
  }
  return false;
};

export const getHook = () => (globalThis as unknown as Hook).__REACT_DEVTOOLS_GLOBAL_HOOK__;

/** The first host DOM node a component renders (to highlight it). */
const hostOf = (f: Fiber): Element | undefined => {
  let cur: Fiber | null = f;
  for (let i = 0; cur && i < 200; i++) {
    if (cur.tag === HOST && cur.stateNode instanceof Element) return cur.stateNode;
    cur = cur.child;
  }
  return undefined;
};

type Acc = { renders: number; total: number; max: number; last: number; wasted: number; causes: Record<string, number>; props: Map<string, number>; el?: WeakRef<Element> };

/**
 * Per-commit accounting through the DevTools hook. `actualDuration` is React's own measurement of a
 * fiber's render time (development and profiling builds only); we subtract the children to get SELF time.
 * The handler is sampled and time-boxed so it can never become the thing it is measuring.
 */
export class ReactProbe {
  private acc = new Map<string, Acc>();
  commits = 0;
  private seen = 0;
  private selfCost = 0;
  private skip = 1;
  hasDurations = false;
  attached = false;
  /** time spent inside our own commit handler, ms */
  get cost() {
    return this.selfCost;
  }

  attach() {
    if (this.attached) return;
    const g = globalThis as unknown as Hook;
    const hook: DevHook = (g.__REACT_DEVTOOLS_GLOBAL_HOOK__ ??= { supportsFiber: true, renderers: new Map(), inject: () => 1, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {} } as DevHook);
    const prev = hook.onCommitFiberRoot;
    hook.onCommitFiberRoot = (id, root, ...rest) => {
      try {
        prev?.call(hook, id, root, ...rest);
      } catch {
        /* another tool's hook must not break ours */
      }
      this.onCommit(root);
    };
    hook.__perfscope = true;
    this.attached = true;
  }

  private onCommit(root: { current: Fiber }) {
    this.commits++;
    if (++this.seen % this.skip) return; // adaptive sampling
    const t0 = performance.now();
    try {
      this.walk(root.current, 0);
    } catch {
      /* internals changed: stay silent, the overlay reports "unavailable" */
    }
    const dt = performance.now() - t0;
    this.selfCost += dt;
    // keep our own share under ~4 ms per commit on average: back off when we are not
    if (dt > 4) this.skip = Math.min(this.skip * 2, 16);
    else if (dt < 1 && this.skip > 1) this.skip--;
  }

  private walk(root: Fiber, budget: number) {
    let n = 0;
    const stack: Fiber[] = [root];
    while (stack.length && n < 4000) {
      const f = stack.pop()!;
      n++;
      const touched = (f.flags & PERFORMED_WORK) !== 0 || ((f.subtreeFlags ?? 1) & PERFORMED_WORK) !== 0;
      if (!touched && f !== root) continue; // nothing rendered below here: skip the whole subtree
      if (isComponent(f.tag) && f.flags & PERFORMED_WORK) this.record(f);
      if (f.sibling && f !== root) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    void budget;
  }

  private record(f: Fiber) {
    const name = nameOf(f);
    if (!name) return;
    const total = f.actualDuration ?? 0;
    if (total > 0) this.hasDurations = true;
    let kids = 0;
    for (let c = f.child; c; c = c.sibling) kids += c.actualDuration ?? 0;
    const self = Math.max(0, total - kids);
    const prev = f.alternate;
    let cause: ComponentStat["cause"] = "mount";
    let changed: string[] = [];
    if (prev) {
      changed = shallowChangedKeys(prev.memoizedProps, f.memoizedProps);
      cause = changed.length ? "props" : stateChanged(f, prev) ? "state" : "parent";
    }
    let a = this.acc.get(name);
    if (!a) this.acc.set(name, (a = { renders: 0, total: 0, max: 0, last: 0, wasted: 0, causes: {}, props: new Map() }));
    a.renders++;
    a.total += self;
    a.max = Math.max(a.max, self);
    a.last = self;
    a.causes[cause] = (a.causes[cause] ?? 0) + 1;
    if (cause === "parent") a.wasted++;
    for (const k of changed) a.props.set(k, (a.props.get(k) ?? 0) + 1);
    if (!a.el && self > 0) {
      const el = hostOf(f);
      if (el) a.el = new WeakRef(el);
    }
    if (this.acc.size > 600) this.acc.delete(this.acc.keys().next().value!);
  }

  reset() {
    this.acc.clear();
    this.commits = 0;
  }

  stats(): ComponentStat[] {
    return [...this.acc.entries()].map(([name, a]) => {
      const cause = (Object.entries(a.causes).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "mount") as ComponentStat["cause"];
      return {
        name, renders: a.renders, totalMs: a.total, maxMs: a.max, lastMs: a.last, wasted: a.wasted, cause,
        props: [...a.props.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k]) => k),
        element: a.el,
      };
    });
  }
}

/* ------------------------------------------------------------------ element -> component, and a snapshot */

const fiberKey = (el: Element) => Object.keys(el).find((k) => k.startsWith("__reactFiber$"));

/** the nearest named component above a DOM node: `<HeroImage>` */
export const ownerOf = (el: Element): string | undefined => {
  const key = fiberKey(el);
  if (!key) return undefined;
  let f = (el as unknown as Record<string, Fiber>)[key] ?? null;
  for (let i = 0; f && i < 60; i++, f = f.return) {
    if (isComponent(f.tag)) {
      const n = nameOf(f);
      if (n) return n;
    }
  }
  return undefined;
};

/** True when React is on the page (a root container is marked on some element). */
export const hasReact = (): boolean => {
  const body = document.body;
  if (!body) return false;
  const probe = (el: Element) => Object.keys(el).some((k) => k.startsWith("__reactContainer$") || k.startsWith("_reactRootContainer"));
  return probe(body) || probe(document.documentElement) || [...body.children].slice(0, 12).some(probe);
};

/**
 * Snapshot without the hook (React was loaded before perfscope): walk the current tree once and use
 * `selfBaseDuration`, React's estimate of what each component costs to render. No counts, but a real ranking.
 */
export const snapshotComponents = (): { stats: ComponentStat[]; ok: boolean } => {
  const rootEl = [document.body, document.documentElement, ...[...document.body.children].slice(0, 12)].find((el) =>
    el && Object.keys(el).some((k) => k.startsWith("__reactContainer$")),
  );
  if (!rootEl) return { stats: [], ok: false };
  const key = Object.keys(rootEl).find((k) => k.startsWith("__reactContainer$"))!;
  const start = (rootEl as unknown as Record<string, Fiber>)[key];
  if (!start) return { stats: [], ok: false };
  const out = new Map<string, ComponentStat>();
  let n = 0;
  let any = false;
  const stack: Fiber[] = [start];
  while (stack.length && n++ < 20000) {
    const f = stack.pop()!;
    if (f.sibling) stack.push(f.sibling);
    if (f.child) stack.push(f.child);
    if (!isComponent(f.tag)) continue;
    const name = nameOf(f);
    const self = f.selfBaseDuration ?? 0;
    if (!name || self <= 0) continue;
    any = true;
    const cur = out.get(name);
    if (cur) {
      cur.renders++;
      cur.totalMs += self;
      cur.maxMs = Math.max(cur.maxMs, self);
    } else {
      const el = hostOf(f);
      out.set(name, { name, renders: 1, totalMs: self, maxMs: self, lastMs: self, wasted: 0, cause: "mount", props: [], element: el ? new WeakRef(el) : undefined });
    }
  }
  return { stats: [...out.values()], ok: any };
};
