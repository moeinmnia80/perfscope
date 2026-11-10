// Runs inside the browser, before any site script.
export function injectHook() {
  const w = window as any;
  w.__PS_ROOTS__ = new Set();

  const COMPONENT_TAGS = new Set([0, 1, 11, 15]); // function, class, forwardRef, simple memo

  // ---- render counting, per component INSTANCE and with the reason for each render ----
  // (Counting by component name, as before, merged all instances and all minified names.)
  const recs = new WeakMap<object, any>();
  const recOf = (f: any) => recs.get(f) || (f.alternate && recs.get(f.alternate)) || null;
  const rec = (f: any) => {
    let r = recOf(f);
    if (!r) r = { n: 0, props: 0, state: 0, store: 0, context: 0, parent: 0, keys: {} as Record<string, number> };
    recs.set(f, r);
    if (f.alternate) recs.set(f.alternate, r);
    return r;
  };
  w.__PS_REC_OF__ = recOf;

  const isEffect = (m: any) => m && typeof m === 'object' && 'create' in m && 'deps' in m;
  // walk both hook lists in parallel. A hook WITH an update queue is useState/useReducer ("state");
  // a changed hook without one is an external store subscription (zustand, redux: "store").
  const hookChanged = (prev: any, next: any): 'state' | 'store' | false => {
    if (next.tag === 1) return prev.memoizedState !== next.memoizedState ? 'state' : false;
    let a = prev.memoizedState, b = next.memoizedState;
    for (let i = 0; a && b && i < 200; i++, a = a.next, b = b.next) {
      const x = a.memoizedState, y = b.memoizedState;
      if (!Object.is(x, y) && !isEffect(y) && !Array.isArray(y)) // useSyncExternalStore (zustand/redux) also has a `queue`, but it holds getSnapshot instead of dispatch
      return b.queue && !('getSnapshot' in b.queue) ? 'state' : 'store';
    }
    return false;
  };
  const contextChanged = (prev: any, next: any) => {
    let a = prev.dependencies?.firstContext, b = next.dependencies?.firstContext;
    for (; a && b; a = a.next, b = b.next) if (a.memoizedValue !== b.memoizedValue) return true;
    return false;
  };

  // Only descend where children really changed (stale PerformedWork flags on bailed-out subtrees
  // would otherwise be counted again on every commit).
  const countRenders = (f: any) => {
    for (; f; f = f.sibling) {
      const prev = f.alternate;
      if (!prev) continue; // freshly mounted, not a re-render
      if (COMPONENT_TAGS.has(f.tag) && (f.flags & 1)) {
        const r = rec(f);
        r.n++;
        const pp = prev.memoizedProps, np = f.memoizedProps;
        const keys: string[] = [];
        if (pp !== np && pp && np && typeof np === 'object')
          for (const k in np)
            if (k !== 'children' && !Object.is(pp[k], np[k]))
              keys.push(k + (typeof np[k] === 'function' ? '()' : np[k] && typeof np[k] === 'object' ? '{}' : ''));
        if (keys.length) {
          r.props++;
          for (const k of keys) r.keys[k] = (r.keys[k] || 0) + 1;
        } else {
          const hc = hookChanged(prev, f);
          if (hc === 'state') r.state++;
          else if (hc === 'store') r.store++;
          else if (contextChanged(prev, f)) r.context++;
          else r.parent++;
        }
      }
      if (f.child !== prev.child) countRenders(f.child);
    }
  };

  let id = 0;
  Object.defineProperty(w, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
    configurable: true,
    value: {
      supportsFiber: true,
      renderers: new Map(),
      inject(r: any) { this.renderers.set(++id, r); return id; },
      onCommitFiberRoot(_id: number, root: any) {
        w.__PS_ROOTS__.add(root);
        try { countRenders(root.current.child); } catch {}
      },
      onCommitFiberUnmount() {},
      onScheduleFiberRoot() {},
      checkDCE() {},
    },
  });

  w.__PS_VITALS__ = { lcp: 0, cls: 0, longTasks: 0, tbt: 0, fcp: 0 };
  const obs = (type: string, cb: (e: any) => void) => {
    try {
      new PerformanceObserver((l) => l.getEntries().forEach(cb)).observe({ type, buffered: true });
    } catch {}
  };
  obs('largest-contentful-paint', (e) => {
    w.__PS_VITALS__.lcp = e.startTime;
    w.__PS_LCP_EL__ = e.element || null; // the real LCP element
  });
  obs('paint', (e) => { if (e.name === 'first-contentful-paint') w.__PS_VITALS__.fcp = e.startTime; });
  obs('layout-shift', (e) => { if (!e.hadRecentInput) w.__PS_VITALS__.cls += e.value; });
  obs('longtask', (e) => {
    w.__PS_VITALS__.longTasks++;
    w.__PS_VITALS__.tbt += Math.max(0, e.duration - 50);
  });
}
