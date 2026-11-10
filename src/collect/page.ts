import type { Page } from 'playwright';
import { injectHook } from './inject.js';
import type { RouteSnapshot } from '../types.js';

export interface CollectOptions {
  /** simulate a slow phone/network like Lighthouse (default true) */
  throttle?: boolean;
  desktop?: boolean;
}

export async function collectRoute(
  page: Page,
  origin: string,
  path: string,
  opts: CollectOptions = {},
): Promise<RouteSnapshot> {
  const throttle = opts.throttle ?? true;

  // tsx/esbuild may emit a `__name` helper inside serialized functions; define it in the browser
  await page.addInitScript('window.__name = window.__name || ((f) => f);');

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');

  // Same profiles Lighthouse uses: mobile = Slow 4G + 4x CPU slowdown, desktop = fast cable.
  // Without this a fast dev machine reports a much better LCP/TBT than real users get.
  if (throttle) {
    const p = opts.desktop
      ? { latency: 40, down: (10 * 1024 * 1024) / 8, up: (10 * 1024 * 1024) / 8, cpu: 1 }
      : { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8, cpu: 4 };
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: p.latency,
      downloadThroughput: p.down,
      uploadThroughput: p.up,
    });
  }

  type Req = { url: string; type: string; mime?: string; compressed?: boolean; cache?: string };
  const reqs = new Map<string, Req>();
  const network: RouteSnapshot['network'] = [];
  cdp.on('Network.requestWillBeSent', (e: any) => reqs.set(e.requestId, { url: e.request.url, type: e.type }));
  cdp.on('Network.responseReceived', (e: any) => {
    const r = reqs.get(e.requestId);
    if (!r) return;
    const headers = Object.fromEntries(
      Object.entries(e.response.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
    );
    r.mime = e.response.mimeType;
    r.compressed = /gzip|br|zstd|deflate/i.test(headers['content-encoding'] ?? '');
    r.cache = headers['cache-control'];
  });
  cdp.on('Network.loadingFinished', (e: any) => {
    const r = reqs.get(e.requestId);
    if (r) network.push({ ...r, bytes: e.encodedDataLength });
  });

  await page.addInitScript(injectHook);
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  await page.coverage.startCSSCoverage({ resetOnNavigation: false });

  await page.goto(origin + path, { waitUntil: 'networkidle', timeout: 90_000 });

  // gradual scroll so lazy content and infinite lists load
  await page.evaluate(async () => {
    const step = innerHeight * 0.8;
    for (let y = 0; y < Math.min(document.body.scrollHeight, 8000); y += step) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 250));
    }
    scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle').catch(() => {});

  const coverage = await page.coverage.stopJSCoverage();
  const scripts = coverage
    .filter((c) => c.url.startsWith('http'))
    .map((c) => ({
      url: c.url,
      total: c.source?.length ?? 0,
      used: c.functions.flatMap((f) => f.ranges).reduce((s, r) => s + (r.endOffset - r.startOffset), 0),
    }));
  const cssCoverage = await page.coverage.stopCSSCoverage();
  const css = cssCoverage
    .filter((c) => c.url.startsWith('http') && c.url !== page.url())
    .map((c) => ({
      url: c.url,
      total: c.text?.length ?? 0,
      used: c.ranges.reduce((s, r) => s + (r.end - r.start), 0),
    }));

  const dom = await page.evaluate(() => {
    const w = window as any;
    const vh = innerHeight;

    const nameOf = (t: any): string | null =>
      !t || typeof t === 'string'
        ? null
        : t.displayName || t.name || t.render?.displayName || t.render?.name ||
          t.type?.displayName || t.type?.name || null;
    const TAGS = new Set([0, 1, 11, 15]); // function, class, forwardRef, simple memo

    // Framework / library plumbing the developer did not write: hidden from the graph.
    const INTERNAL = new RegExp(
      '^(Anonymous|Fragment|Suspense|ForwardRef|Provider|Consumer|Image|ImageElement|ImageComponent|Link|LinkComponent|Script|' +
      'Root|ServerRoot|ClientPageRoot|ClientSegmentRoot|HotReload|HistoryUpdater|RuntimeStyles|Head|GlobalError|' +
      'PathnameContextProviderAdapter|RenderFromTemplateContext|ScrollAndFocusHandler|InnerScrollAndFocusHandler|' +
      'SegmentViewNode|SegmentTrieNode|MetadataBoundary|ViewportBoundary|OutletBoundary|AsyncMetadata|AsyncMetadataOutlet|' +
      'AppDevOverlay|ReactDevOverlay|AppRouterAnnouncer|TemplateContext|Dispatcher)$|' +
      '(Boundary|Router|Boundary\\d*)$|^(Inner|Outer)Layout|^(Context|Next)\\.',
    );
    // 1-2 characters = produced by a minifier, not a real name
    const MIN = /^[A-Za-z_$][A-Za-z0-9_$]?$/;

    // "div.card": short CSS-like label. Tailwind classes with : [ ] / are skipped (invalid in selectors).
    const selOf = (el: Element): string => {
      const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/)
        .filter((c) => c && !/[:\[\]\/]/.test(c)).slice(0, 3);
      return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls.map((c) => '.' + c).join('');
    };
    const pathOf = (el: Element) => (el.parentElement ? selOf(el.parentElement) + ' > ' : '') + selOf(el);

    const firstHost = (f: any): Element | null => {
      for (let c = f; c; c = c.child) if (c.stateNode instanceof Element) return c.stateNode;
      return null;
    };

    // merge consecutive identical siblings (200 cards -> one node with count 200)
    const collapse = (nodes: any[]) => {
      const out: any[] = [];
      for (const n of nodes) {
        const last = out[out.length - 1];
        if (last && last.name === n.name && last.hint === n.hint) {
          last.count = (last.count ?? 1) + (n.count ?? 1);
          last.domNodes += n.domNodes;
          if (n.renders > last.renders) { last.renders = n.renders; last.why = n.why; }
        } else out.push(n);
      }
      return out;
    };

    const walk = (f: any, depth: number): any[] => {
      const out: any[] = [];
      for (; f; f = f.sibling) {
        const raw = TAGS.has(f.tag) ? nameOf(f.type) : null;
        const kids = depth < 120 ? walk(f.child, depth + 1) : [];
        if (!raw || INTERNAL.test(raw)) { out.push(...kids); continue; }
        const el = firstHost(f);
        const r = el?.getBoundingClientRect();
        const rc = w.__PS_REC_OF__?.(f);
        const minified = MIN.test(raw);
        const node: any = {
          name: raw,
          minified: minified || undefined,
          hint: minified && el ? selOf(el) : undefined,
          rect: r ? { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) } : null,
          domNodes: el ? el.getElementsByTagName('*').length + 1 : 0,
          renders: rc?.n ?? 0,
          why: rc?.n
            ? { props: rc.props, state: rc.state, store: rc.store, context: rc.context, parent: rc.parent,
                keys: Object.entries(rc.keys).sort((a: any, b: any) => b[1] - a[1]).slice(0, 4) }
            : undefined,
          aboveFold: r ? r.top < vh : false,
          children: collapse(kids),
        };
        // forwardRef/memo wrappers: outer and inner function share a name -> keep one node
        if (kids.length === 1 && kids[0].name === raw) { out.push(kids[0]); continue; }
        out.push(node);
      }
      return out;
    };
    const tree = collapse([...(w.__PS_ROOTS__ ?? [])].flatMap((root: any) => walk(root.current.child, 0)));

    // nearest READABLE component above a DOM element (skips framework internals and minified names)
    const ownerOf = (el: any): string | undefined => {
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      for (let f = key ? el[key] : null; f; f = f.return) {
        if (!TAGS.has(f.tag)) continue;
        const n = nameOf(f.type);
        if (n && !INTERNAL.test(n) && !MIN.test(n)) return n;
      }
      return undefined;
    };

    const lists: any[] = [];
    document.querySelectorAll('body *').forEach((el) => {
      const kids = el.children;
      if (kids.length < 30) return;
      const sig = (k: Element) => k.tagName + '.' + (k.className?.toString().split(' ')[0] ?? '');
      const same = [...kids].filter((k) => sig(k) === sig(kids[0])).length;
      if (same >= 30) {
        lists.push({
          selector:
            el.tagName.toLowerCase() +
            (el.id ? '#' + el.id : '') +
            (el.className ? '.' + el.className.toString().trim().split(/\s+/).slice(0, 2).join('.') : ''),
          items: same,
          heightPx: Math.round(el.getBoundingClientRect().height),
          owner: ownerOf(el),
        });
      }
    });

    const perf = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const images = [...document.images].map((img) => {
      const r = img.getBoundingClientRect();
      return {
        src: img.currentSrc || img.src,
        renderedW: Math.round(r.width),
        displayH: Math.round(r.height),
        naturalW: img.naturalWidth,
        naturalH: img.naturalHeight,
        lazy: img.loading === 'lazy',
        aboveFold: r.top < vh,
        // next/image with `fill` has no width/height attributes but the parent reserves the space
        hasSize:
          !!(img.getAttribute('width') && img.getAttribute('height')) ||
          img.style.aspectRatio !== '' ||
          img.getAttribute('data-nimg') === 'fill',
        bytes: perf.find((p) => p.name === (img.currentSrc || img.src))?.encodedBodySize ?? 0,
        y: Math.round(r.top + scrollY),
        selector: pathOf(img),
        html: img.outerHTML.slice(0, 600),
        alt: img.getAttribute('alt'),
        nextImage: img.hasAttribute('data-nimg'),
        fetchPriority: img.fetchPriority,
        loadingAttr: img.getAttribute('loading'),
        sizesAttr: img.getAttribute('sizes'),
        hasSrcset: !!img.getAttribute('srcset'),
        owner: ownerOf(img),
      };
    });

    // the element the browser really measured as LCP
    const lcpNode = w.__PS_LCP_EL__ as Element | null | undefined;
    const lcpElement = lcpNode
      ? {
          tag: lcpNode.tagName.toLowerCase(),
          src: (lcpNode as HTMLImageElement).currentSrc || undefined,
          selector: pathOf(lcpNode),
          owner: ownerOf(lcpNode),
          text: lcpNode.tagName === 'IMG' ? undefined : (lcpNode.textContent ?? '').trim().slice(0, 60),
        }
      : undefined;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;

    const origins = (sel: string) =>
      [...document.querySelectorAll<HTMLLinkElement>(sel)].flatMap((l) => {
        try { return [new URL(l.href).origin]; } catch { return []; }
      });
    const blocking = [
      ...[...document.querySelectorAll<HTMLScriptElement>('head script[src]:not([async]):not([defer]):not([type=module])')]
        .map((s) => ({ url: s.src, kind: 'script' as const })),
      ...[...document.querySelectorAll<HTMLLinkElement>('head link[rel=stylesheet]')]
        .filter((l) => !l.media || l.media === 'all' || l.media === 'screen')
        .map((l) => ({ url: l.href, kind: 'css' as const })),
    ];

    return {
      lcpElement,
      tree,
      lists,
      images,
      vitals: { ...w.__PS_VITALS__, ttfb: nav?.responseStart ?? 0 },
      domTotal: document.getElementsByTagName('*').length,
      viewport: { w: innerWidth, h: vh, dpr: devicePixelRatio },
      preconnects: [...new Set(origins('link[rel=preconnect],link[rel=dns-prefetch]'))],
      blocking,
    };
  });

  // Resource Timing reports 0 bytes for cross-origin images without a Timing-Allow-Origin header
  // (TMDB, most CDNs). The network layer always knows the real transferred size.
  const bytesByUrl = new Map(network.map((n) => [n.url, n.bytes]));
  for (const i of dom.images) if (!i.bytes) i.bytes = bytesByUrl.get(i.src) ?? 0;

  return { route: path, url: origin + path, network, scripts, css, throttled: throttle, ...dom };
}
