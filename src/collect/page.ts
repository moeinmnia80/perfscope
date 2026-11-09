import type { Page } from 'playwright';
import { injectHook } from './inject.js';
import type { RouteSnapshot } from '../types.js';

export async function collectRoute(page: Page, origin: string, path: string): Promise<RouteSnapshot> {
  // tsx/esbuild may emit a `__name` helper inside serialized functions; define it in the browser
  await page.addInitScript('window.__name = window.__name || ((f) => f);');

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');

  const reqs = new Map<string, { url: string; type: string }>();
  const network: RouteSnapshot['network'] = [];
  cdp.on('Network.requestWillBeSent', (e: any) => reqs.set(e.requestId, { url: e.request.url, type: e.type }));
  cdp.on('Network.loadingFinished', (e: any) => {
    const r = reqs.get(e.requestId);
    if (r) network.push({ ...r, bytes: e.encodedDataLength });
  });

  await page.addInitScript(injectHook);
  await page.coverage.startJSCoverage({ resetOnNavigation: false });

  await page.goto(origin + path, { waitUntil: 'networkidle' });

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

  const dom = await page.evaluate(() => {
    const w = window as any;
    const vh = innerHeight;

    const nameOf = (t: any): string | null =>
      !t || typeof t === 'string'
        ? null
        : t.displayName || t.name || t.render?.displayName || t.render?.name ||
          t.type?.displayName || t.type?.name || null;
    const TAGS = new Set([0, 1, 11, 14, 15]);
    const firstHost = (f: any): Element | null => {
      for (let c = f; c; c = c.child) if (c.stateNode instanceof Element) return c.stateNode;
      return null;
    };
    const walk = (f: any, depth: number): any[] => {
      const out: any[] = [];
      for (; f; f = f.sibling) {
        const name = TAGS.has(f.tag) ? nameOf(f.type) : null;
        const kids = depth < 40 ? walk(f.child, depth + 1) : [];
        if (!name) { out.push(...kids); continue; }
        const el = firstHost(f);
        const r = el?.getBoundingClientRect();
        out.push({
          name,
          rect: r ? { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) } : null,
          domNodes: el ? el.getElementsByTagName('*').length + 1 : 0,
          renders: w.__PS_RENDERS__?.[name] ?? 0,
          aboveFold: r ? r.top < vh : false,
          children: kids,
        });
      }
      return out;
    };
    const tree = [...(w.__PS_ROOTS__ ?? [])].flatMap((root: any) => walk(root.current.child, 0));

    // --- helpers that tell the developer WHERE an element lives in the source ---

    // "div.card > img.poster": short CSS path. Tailwind classes with : [ ] / are skipped (not valid in selectors).
    const selOf = (el: Element): string => {
      const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/)
        .filter((c) => c && !/[:\[\]\/]/.test(c)).slice(0, 3);
      return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls.map((c) => '.' + c).join('');
    };

    // nearest React component above a DOM element, skipping next/image internals
    const SKIP = new Set(['Image', 'ImageElement', 'ImageComponent', 'Anonymous']);
    const ownerOf = (el: any): string | undefined => {
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      for (let f = key ? el[key] : null; f; f = f.return) {
        if (!TAGS.has(f.tag)) continue;
        const n = nameOf(f.type);
        if (n && !SKIP.has(n)) return n;
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
    const images = [...document.images].map((img) => ({
      src: img.currentSrc || img.src,
      renderedW: Math.round(img.getBoundingClientRect().width),
      naturalW: img.naturalWidth,
      naturalH: img.naturalHeight,
      lazy: img.loading === 'lazy',
      aboveFold: img.getBoundingClientRect().top < vh,
      // next/image with `fill` has no width/height attributes but the parent reserves the space
      hasSize:
        !!(img.getAttribute('width') && img.getAttribute('height')) ||
        img.style.aspectRatio !== '' ||
        img.getAttribute('data-nimg') === 'fill',
      bytes: perf.find((p) => p.name === (img.currentSrc || img.src))?.encodedBodySize ?? 0,
      selector: (img.parentElement ? selOf(img.parentElement) + ' > ' : '') + selOf(img),
      html: img.outerHTML.slice(0, 600),
      alt: img.getAttribute('alt'),
      nextImage: img.hasAttribute('data-nimg'),
      fetchPriority: img.fetchPriority,
      owner: ownerOf(img),
    }));

    return {
      tree,
      lists,
      images,
      vitals: w.__PS_VITALS__,
      domTotal: document.getElementsByTagName('*').length,
    };
  });

  return { route: path, url: origin + path, network, scripts, ...dom };
}
