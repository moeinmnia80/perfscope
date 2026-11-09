// Runs inside the browser, before any site script.
export function injectHook() {
  const w = window as any;
  w.__PS_ROOTS__ = new Set();
  w.__PS_RENDERS__ = {} as Record<string, number>;

  const nameOf = (t: any): string | null =>
    !t || typeof t === 'string'
      ? null
      : t.displayName || t.name || t.render?.displayName || t.render?.name ||
        t.type?.displayName || t.type?.name || null;

  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]); // fn, class, forwardRef, memo

  const countRenders = (f: any) => {
    while (f) {
      if (COMPONENT_TAGS.has(f.tag) && f.alternate && (f.flags & 1)) {
        const n = nameOf(f.type);
        if (n) w.__PS_RENDERS__[n] = (w.__PS_RENDERS__[n] || 0) + 1;
      }
      countRenders(f.child);
      f = f.sibling;
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
        countRenders(root.current);
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
