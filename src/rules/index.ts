import type { Finding, Rule, RouteSnapshot, ComponentNode, ImageInfo, RenderWhy } from '../types.js';

// ------------------------------------------------------------------ small helpers
const kb = (b: number) => (b / 1024).toFixed(0) + 'KB';
const flat = (n: ComponentNode[]): ComponentNode[] => n.flatMap((x) => [x, ...flat(x.children)]);
const short = (s: string, n = 48) => (s.length > n ? '…' + s.slice(-n) : s);
const loc = (owner: string | undefined, sel: string | undefined, fallback = '') =>
  [owner && `<${owner}>`, sel ?? fallback].filter(Boolean).join(' › ');
const safeName = (n: string) => n.replace(/\W/g, '') || 'Section';
const SLOW_4G = (1.6 * 1024 * 1024) / 8; // bytes per second
const secs = (bytes: number) => (bytes / SLOW_4G).toFixed(1) + 's';
const tick = '`';

/** A readable label for a component. Minified names are meaningless, so show what it renders instead. */
const label = (n: ComponentNode) =>
  n.minified ? `a component that renders <${n.hint ?? 'element'}> (name minified: "${n.name}")` : `<${n.name}>`;
const whereOf = (n: ComponentNode) => (n.minified ? `‹minified ${n.name}› ${n.hint ?? ''}`.trim() : `<${n.name}>`);

// --- tiny HTML helpers so we can show a realistic "before / after" for <img> tags
const tidy = (html = '') =>
  html
    .replace(/\s(srcset|sizes|style|data-nimg|decoding)="[^"]*"/g, '')
    .replace(/\s(src|href)="([^"]{50,})"/g, (_m, a, v) => ` ${a}="${short(v, 40)}"`);
const addAttr = (tag: string, attr: string) => tag.replace(/\s*\/?>\s*$/, ` ${attr}>`);
const dropAttr = (tag: string, name: string) => tag.replace(new RegExp(`\\s${name}(="[^"]*")?`, 'i'), '');

// ------------------------------------------------------------------ image diagnosis
interface Diag {
  needed: number; // pixels the screen really needs: CSS width x devicePixelRatio
  wasted: number; // estimated bytes that are not needed
  vw: number; // how much of the viewport width the image occupies (for `sizes`)
  mime: string;
  fmt: string;
  dpr: number;
  inner: string; // the real source URL (unwrapped from /_next/image?url=...)
  optimized: boolean; // served through the next/image optimizer
  servedW?: number;
  tmdb?: { size: string; file: string };
}

const diagnose = (i: ImageInfo, s: RouteSnapshot): Diag => {
  const dpr = s.viewport?.dpr ?? 1;
  const vwPx = s.viewport?.w ?? 390;
  const needed = Math.ceil(i.renderedW * dpr);
  const ratio = i.naturalW ? Math.min(1, needed / i.naturalW) : 1;
  const mime = s.network.find((n) => n.url === i.src)?.mime ?? '';
  let inner = i.src;
  let optimized = false;
  let servedW: number | undefined;
  try {
    const u = new URL(i.src);
    if (u.pathname.startsWith('/_next/image')) {
      optimized = true;
      inner = u.searchParams.get('url') ?? i.src;
      servedW = Number(u.searchParams.get('w')) || undefined;
    }
  } catch { /* relative url */ }
  const m = inner.match(/image\.tmdb\.org\/t\/p\/(w\d+|original)(\/[^?#]+)/);
  return {
    needed, dpr, mime, inner, optimized, servedW,
    fmt: mime.replace('image/', '') || 'unknown',
    wasted: Math.round(i.bytes * (1 - ratio * ratio)),
    vw: Math.max(1, Math.round((i.renderedW / vwPx) * 100)),
    tmdb: m ? { size: m[1], file: m[2] } : undefined,
  };
};

/** pick the smallest size of a CDN ladder that still covers `needed` pixels */
const ladderPick = (ladder: number[], needed: number) => ladder.find((w) => w >= needed) ?? ladder[ladder.length - 1];

const imgFacts = (i: ImageInfo, d: Diag, s: RouteSnapshot): [string, string][] => [
  ['Shown as', `${i.renderedW}×${i.displayH ?? '?'} CSS px, so this ${d.dpr}x screen needs about ${d.needed}px width`],
  ['Downloaded', `${i.naturalW}×${i.naturalH ?? '?'}px ${d.fmt}, ${kb(i.bytes)}${d.servedW ? ` (optimizer picked w=${d.servedW})` : ''}`],
  ['Wasted', `about ${kb(d.wasted)} (${i.bytes ? Math.round((d.wasted / i.bytes) * 100) : 0}% of this file)`],
  ['Time on Slow 4G', `${secs(i.bytes)} for this one image`],
  ['Responsive hints', `sizes="${i.sizesAttr ?? 'missing (browser assumes 100vw)'}", srcset ${i.hasSrcset ? 'present' : 'missing'}`],
  ['Position', `${i.aboveFold ? 'above the fold' : 'below the fold'} (y=${i.y ?? '?'}px, screen height ${s.viewport?.h ?? '?'}px)`],
];

// ------------------------------------------------------------------ lists
const virtualizeLists: Rule = (s) =>
  s.lists
    .filter((l) => l.items >= 50)
    .map((l): Finding => ({
      id: 'virtualize-list',
      title: 'Render only the visible part of long lists',
      severity: l.items > 150 ? 'high' : 'medium',
      impact: 'Memory',
      route: s.route,
      where: loc(l.owner, l.selector),
      facts: [
        ['Items in the DOM', String(l.items)],
        ['List height', `${l.heightPx}px`],
        ['On screen at once', `about ${Math.max(1, Math.ceil((s.viewport?.h ?? 844) / Math.max(1, l.heightPx / l.items)))} items`],
      ],
      evidence: `${l.items} identical children inside ${l.selector}`,
      why: `${l.items} items are in the DOM at once, but the user sees only a few of them. Layout cost and memory grow with the number of nodes.`,
      fix: 'Virtualize the list, or paginate / use infinite query.',
      before: `{movies.map((m) => (\n  <MovieCard key={m.id} movie={m} />\n))}`,
      after: `const parentRef = useRef<HTMLDivElement>(null);\nconst rowVirtualizer = useVirtualizer({\n  count: movies.length,\n  getScrollElement: () => parentRef.current,\n  estimateSize: () => 320,\n  overscan: 4,\n});\n\n<div ref={parentRef} style={{ height: '100vh', overflow: 'auto' }}>\n  <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>\n    {rowVirtualizer.getVirtualItems().map((v) => (\n      <div key={v.key} style={{ position: 'absolute', top: 0, transform: \`translateY(\${v.start}px)\` }}>\n        <MovieCard movie={movies[v.index]} />\n      </div>\n    ))}\n  </div>\n</div>`,
      steps: [
        { kind: 'check', text: `Open ${l.owner ? tick + l.owner + tick : 'the component that renders this list'} and find the ${tick}.map()${tick} that renders all ${l.items} items.` },
        { kind: 'add', text: `Install the library: ${tick}npm i @tanstack/react-virtual${tick}.` },
        { kind: 'replace', text: `Replace the plain ${tick}.map()${tick} with ${tick}useVirtualizer${tick} as shown in "After".` },
        { kind: 'check', text: 'If the data comes from an API, server-side pagination is even cheaper than virtualizing.' },
      ],
    }));

// ------------------------------------------------------------------ images
const images: Rule = (s) => {
  const raw: Finding[] = [];
  const meta = new WeakMap<Finding, { bytes: number; wasted: number }>();
  let cur = { bytes: 0, wasted: 0 };
  const push = (f: Finding) => { raw.push(f); meta.set(f, cur); };
  const lcpSrc = s.lcpElement?.src;

  for (const i of s.images) {
    const d = diagnose(i, s);
    cur = { bytes: i.bytes, wasted: d.wasted };
    const where = loc(i.owner, i.selector, short(i.src));
    const tag = tidy(i.html);
    const alt = i.alt ?? '';
    const isLcp = !!lcpSrc && i.src === lcpSrc;
    const common = { route: s.route, where, evidence: tag || undefined, asset: short(i.src, 80) };
    const facts = imgFacts(i, d, s);

    // 1. below the fold but loaded eagerly
    if (!i.aboveFold && !i.lazy && !isLcp)
      push({
        ...common, facts, id: 'img-lazy', title: 'Lazy-load images that are below the fold', severity: i.bytes > 100_000 ? 'high' : 'medium', impact: 'Network',
        why: `This image is ${Math.round((i.y ?? 0) - (s.viewport?.h ?? 0))}px below the first screen, yet its ${kb(i.bytes)} are downloaded immediately and compete with the images the user actually sees.`,
        fix: 'Add loading="lazy" (next/image does this by default).',
        ...(i.nextImage
          ? {
              before: `<Image src={…} alt="${alt}" priority />   // or loading="eager"`,
              after: `<Image src={…} alt="${alt}" />`,
              steps: [
                { kind: 'check', text: `Open ${i.owner ? tick + i.owner + tick : 'the component'} and find this <Image>.` },
                { kind: 'remove', text: `Remove the ${tick}priority${tick} prop (or ${tick}loading="eager"${tick}). Only the main image above the fold needs it.` },
              ],
            }
          : {
              before: tag,
              after: addAttr(tag, 'loading="lazy"'),
              steps: [
                { kind: 'add', text: `Add ${tick}loading="lazy"${tick} to this <img>.` },
                { kind: 'replace', text: `Better: replace ${tick}<img>${tick} with ${tick}next/image${tick}: lazy by default, and it fixes size and format too.` },
              ],
            }),
      });

    // 2. image file much larger than the box (accounting for the screen's pixel ratio)
    if (d.needed > 0 && i.naturalW > d.needed * 1.25 && d.wasted > 4096) {
      const sev = d.wasted > 100_000 ? 'high' : d.wasted > 20_000 ? 'medium' : 'low';
      const base = { ...common, facts, id: 'img-oversized', title: 'Serve images at the size they are displayed', severity: sev as Finding['severity'], impact: 'Network' };
      const why = `The browser downloaded ${i.naturalW}px but only ${d.needed}px are needed. About ${kb(d.wasted)} of ${kb(i.bytes)} is wasted${isLcp ? ', and this is the LCP image so it delays the whole page' : ''}.`;

      if (d.tmdb && d.tmdb.size !== 'none') {
        // TMDB serves fixed widths: pick the smallest that covers the screen
        const portrait = (i.naturalH ?? 0) >= i.naturalW;
        const ladder = portrait ? [92, 154, 185, 342, 500, 780] : [300, 780, 1280];
        const target = ladderPick(ladder, d.needed);
        const from = `https://image.tmdb.org/t/p/${d.tmdb.size}${d.tmdb.file}`;
        const to = `https://image.tmdb.org/t/p/w${target}${d.tmdb.file}`;
        push({
          ...base, why,
          fix: `Request ${tick}w${target}${tick} from TMDB instead of ${tick}${d.tmdb.size}${tick}.`,
          before: from,
          after: i.nextImage
            ? `${to}\n\n<Image src={url} alt="${alt}" sizes="${d.vw}vw" … />`
            : to,
          steps: [
            { kind: 'check', text: `Search your code for ${tick}image.tmdb.org/t/p/${tick} and find where this URL is built.` },
            { kind: 'replace', text: `Replace ${tick}${d.tmdb.size}${tick} with ${tick}w${target}${tick} (${portrait ? 'poster' : 'backdrop'} sizes: ${ladder.map((w) => 'w' + w).join(', ')}; ${tick}w${target}${tick} is the smallest that covers ${d.needed}px).` },
            ...(i.nextImage ? [{ kind: 'add' as const, text: `Add ${tick}sizes="${d.vw}vw"${tick} so next/image also picks a small file.` }] : []),
          ],
        });
      } else if (i.nextImage) {
        const sizes = i.sizesAttr ? `${tick}sizes="${i.sizesAttr}"${tick} is too large for this layout` : `no ${tick}sizes${tick} prop, so the browser assumes the image is 100vw wide`;
        push({
          ...base, why,
          fix: `Add ${tick}sizes="${d.vw}vw"${tick} to this <Image>.`,
          before: `<Image src={…} alt="${alt}" fill />        // ${i.sizesAttr ? `sizes="${i.sizesAttr}"` : 'no sizes'}`,
          after: `<Image src={…} alt="${alt}" fill sizes="${d.vw}vw" />`,
          steps: [
            { kind: 'check', text: `Diagnosis: ${sizes}; the optimizer therefore served ${d.servedW ?? i.naturalW}px.` },
            { kind: 'add', text: `Add ${tick}sizes="${d.vw}vw"${tick}. It is computed from the real layout: this image fills about ${d.vw}% of the screen width. For a responsive grid use e.g. ${tick}(max-width: 768px) 50vw, 20vw${tick}.` },
            { kind: 'check', text: `Remove ${tick}unoptimized${tick} if it is set, otherwise Next serves the original file.` },
          ],
        });
      } else if (/res\.cloudinary\.com/.test(d.inner)) {
        push({
          ...base, why, fix: `Add a width transformation (${tick}w_${d.needed},f_auto,q_auto${tick}) to the Cloudinary URL.`,
          before: d.inner,
          after: d.inner.replace('/upload/', `/upload/w_${d.needed},f_auto,q_auto/`),
          steps: [{ kind: 'replace', text: `Insert ${tick}w_${d.needed},f_auto,q_auto${tick} after ${tick}/upload/${tick}. ${tick}f_auto${tick} also serves WebP/AVIF.` }],
        });
      } else if (/images\.unsplash\.com|\.imgix\.net/.test(d.inner)) {
        const bare = d.inner.split('?')[0];
        push({
          ...base, why, fix: `Add ${tick}?w=${d.needed}&q=75&auto=format${tick} to the image URL.`,
          before: d.inner, after: `${bare}?w=${d.needed}&q=75&auto=format`,
          steps: [{ kind: 'replace', text: `Request exactly ${d.needed}px with ${tick}w=${d.needed}${tick}; ${tick}auto=format${tick} serves WebP/AVIF.` }],
        });
      } else {
        const w1 = i.renderedW, w2 = i.renderedW * 2;
        push({
          ...base, why,
          fix: `Export a ${d.needed}px version (and a 1x version) and describe them with srcset + sizes.`,
          before: tag,
          after: tag.replace(/\ssrc="[^"]*"/, '').replace(/<img/i, '<img') .replace(/\s*\/?>\s*$/, ` src="photo-${w2}.webp" srcset="photo-${w1}.webp ${w1}w, photo-${w2}.webp ${w2}w" sizes="${d.vw}vw">`),
          steps: [
            { kind: 'replace', text: `Resize the source file to ${w2}px wide (that is ${d.dpr}x of its ${w1}px box) instead of ${i.naturalW}px.` },
            { kind: 'add', text: `Add ${tick}srcset${tick} with ${w1}w and ${w2}w versions and ${tick}sizes="${d.vw}vw"${tick}.` },
            { kind: 'replace', text: `Or replace ${tick}<img>${tick} with ${tick}next/image${tick}, which generates all of this automatically.` },
          ],
        });
      }
    }

    // 2b. old formats that are big enough to matter
    if (/image\/(jpeg|png|gif)/.test(d.mime) && i.bytes > 30_000)
      push({
        ...common, facts, id: 'img-format', title: 'Serve images in modern formats (WebP / AVIF)', severity: i.bytes > 150_000 ? 'medium' : 'low', impact: 'Network',
        why: `Delivered as ${d.fmt} (${kb(i.bytes)}). WebP and AVIF are usually 25-50% smaller at the same quality.`,
        fix: d.tmdb ? 'TMDB only serves JPEG: load these through next/image to get WebP/AVIF.' : 'Let next/image convert to AVIF/WebP, or export the file in a modern format.',
        ...(i.nextImage
          ? {
              before: `<Image src={…} alt="${alt}" unoptimized />\n\n// next.config.js has no "formats"`,
              after: `<Image src={…} alt="${alt}" />\n\n// next.config.js\nimages: { formats: ['image/avif', 'image/webp'] }`,
              steps: [
                { kind: 'remove', text: `Remove the ${tick}unoptimized${tick} prop if it is there; it turns optimization off.` },
                { kind: 'add', text: `Add ${tick}images: { formats: ['image/avif', 'image/webp'] }${tick} to ${tick}next.config.js${tick}.` },
                { kind: 'check', text: `If the image is on another domain, allow it in ${tick}images.remotePatterns${tick}.` },
              ],
            }
          : {
              before: tag,
              after: tag.replace(/<img/i, '<Image').replace(/\s*\/?>\s*$/, ' />'),
              steps: [
                { kind: 'replace', text: `Replace ${tick}<img>${tick} with ${tick}next/image${tick}: it serves WebP/AVIF automatically${d.tmdb ? ' (add image.tmdb.org to remotePatterns)' : ''}.` },
                { kind: 'check', text: 'Or convert the file yourself (e.g. squoosh.app) and use the .webp / .avif version.' },
              ],
            }),
      });

    // 3. no reserved space -> layout shift
    if (!i.hasSize)
      push({
        ...common, facts, id: 'img-no-size', title: 'Reserve space for images to avoid layout shift', severity: 'low', impact: 'CLS',
        why: `The image has no width/height, so the page jumps by ${i.displayH ?? '?'}px when it finishes loading (Cumulative Layout Shift).`,
        fix: 'Set width and height, or use `fill` inside a container with an aspect ratio.',
        ...(i.nextImage
          ? {
              before: `<Image src={…} alt="${alt}" />`,
              after: `<Image src={…} alt="${alt}" width={${i.naturalW || 300}} height={${i.naturalH || 450}} />`,
              steps: [
                { kind: 'add', text: `Add ${tick}width${tick} and ${tick}height${tick} props (the real file size is fine; CSS controls the displayed size).` },
                { kind: 'check', text: `Or use ${tick}fill${tick} and give the parent ${tick}relative aspect-[2/3]${tick}.` },
              ],
            }
          : {
              before: tag,
              after: addAttr(tag, `width="${i.naturalW}" height="${i.naturalH ?? ''}"`),
              steps: [{ kind: 'add', text: `Add ${tick}width="${i.naturalW}" height="${i.naturalH ?? '…'}"${tick} to the <img>, or an ${tick}aspect-ratio${tick} in CSS.` }],
            }),
      });

    // 4. the image the browser really measured as LCP
    if (isLcp && s.vitals.lcp > 2500 && i.fetchPriority !== 'high') {
      const lazyLcp = i.loadingAttr === 'lazy';
      push({
        ...common, id: 'lcp-priority', title: 'Load the main image first', severity: 'high', impact: 'LCP',
        facts: [
          ['LCP', `${Math.round(s.vitals.lcp)}ms (good is under 2500ms)`],
          ['LCP element', `this image, ${kb(i.bytes)} ${d.fmt}`],
          ['Priority hints', `fetchpriority=${i.fetchPriority || 'auto'}, loading=${i.loadingAttr ?? 'default'}`],
          ['Download alone', `about ${secs(i.bytes)} on Slow 4G`],
          ['Server (TTFB)', s.vitals.ttfb ? `${Math.round(s.vitals.ttfb)}ms` : 'unknown'],
        ],
        why: `The browser measured THIS image as the Largest Contentful Paint. ${lazyLcp ? 'It is marked loading="lazy", so the browser waits before even starting to download it.' : 'It is not marked as important, so the browser discovers and downloads it late.'}`,
        fix: 'Add `priority` (next/image) or `fetchpriority="high"` to this image.',
        ...(i.nextImage
          ? {
              before: `<Image src={…} alt="${alt}" />`,
              after: `<Image src={…} alt="${alt}" priority />`,
              steps: [
                { kind: 'add', text: `Add the ${tick}priority${tick} prop to this <Image>. Next then preloads it and removes lazy-loading.` },
                { kind: 'check', text: 'Use it on one or two images per page only; if everything is priority, nothing is.' },
              ],
            }
          : {
              before: tag,
              after: addAttr(dropAttr(tag, 'loading'), 'fetchpriority="high"'),
              steps: [
                ...(lazyLcp ? [{ kind: 'remove' as const, text: `Remove ${tick}loading="lazy"${tick}. A lazy image can never be a fast LCP.` }] : []),
                { kind: 'add', text: `Add ${tick}fetchpriority="high"${tick}.` },
              ],
            }),
      });
    }
  }

  // One card per PROBLEM PATTERN, not per file: 60 posters in the same grid are one fix, not 60.
  const groups = new Map<string, Finding[]>();
  for (const f of raw) {
    const k = `${f.id}|${f.where}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const rank = { high: 3, medium: 2, low: 1 } as const;
  const weightOf = (f: Finding) => {
    const m = meta.get(f)!;
    return f.id === 'img-oversized' ? m.wasted : f.id === 'img-lazy' ? m.bytes : f.id === 'img-format' ? m.bytes * 0.3 : 0;
  };
  const out: Finding[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) { out.push(g[0]); continue; }
    const rep = [...g].sort((x, y) => weightOf(y) - weightOf(x))[0];
    const total = g.reduce((a, f) => a + weightOf(f), 0);
    const label = { 'img-oversized': 'Wasted in total', 'img-lazy': 'Downloaded too early', 'img-format': 'Could be saved' }[rep.id];
    out.push({
      ...rep,
      where: `${rep.where}  (${g.length} images)`,
      severity: g.reduce((a, f) => (rank[f.severity] > rank[a] ? f.severity : a), rep.severity),
      facts: [
        ['Images with this problem', `${g.length}, all rendered by ${rep.where}`],
        ...(label ? ([[label, kb(total)]] as [string, string][]) : []),
        ['Example below', `the worst one: ${rep.asset}`],
        ...(rep.facts ?? []),
      ],
    });
  }
  return out;
};

// ------------------------------------------------------------------ preconnect to the image host
const preconnect: Rule = (s) => {
  const src = s.lcpElement?.src;
  if (!src) return [];
  let origin: string, own: string;
  try { origin = new URL(src).origin; own = new URL(s.url).origin; } catch { return []; }
  if (origin === own || (s.preconnects ?? []).includes(origin)) return [];
  const bytes = s.network.filter((n) => n.url.startsWith(origin)).reduce((a, b) => a + b.bytes, 0);
  return [{
    id: 'preconnect',
    title: 'Connect early to the image server',
    severity: 'medium',
    impact: 'LCP',
    route: s.route,
    where: origin,
    facts: [
      ['Origin', origin],
      ['LCP image is hosted there', 'yes'],
      ['Data loaded from it', kb(bytes)],
      ['Cost of a new connection', 'about 3 round trips (DNS + TCP + TLS), roughly 450ms on Slow 4G'],
    ],
    why: 'The LCP image comes from another domain. The browser only opens that connection after it finds the image, so the first byte arrives late.',
    fix: `Add ${tick}<link rel="preconnect">${tick} for ${origin}.`,
    before: `<head>\n  …\n</head>`,
    after: `// app/layout.tsx\n<head>\n  <link rel="preconnect" href="${origin}" crossOrigin="anonymous" />\n</head>`,
    steps: [
      { kind: 'add', text: `Add ${tick}<link rel="preconnect" href="${origin}" crossOrigin="anonymous" />${tick} inside ${tick}<head>${tick} of your root layout.` },
      { kind: 'check', text: 'Preconnect only to 1-2 origins that matter; too many connections slow each other down.' },
    ],
  }];
};

// ------------------------------------------------------------------ javascript
const unusedJs: Rule = (s) =>
  s.scripts
    .filter((c) => c.total - c.used > 20_000)
    .map((c): Finding => {
      const file = c.url.split('/').slice(-1)[0];
      return {
        id: 'unused-js', title: 'Load less JavaScript up front', severity: c.total - c.used > 100_000 ? 'high' : 'medium', impact: 'TBT',
        route: s.route, where: file, asset: c.url,
        facts: [
          ['File size', kb(c.total)],
          ['Executed on this route', `${kb(c.used)} (${Math.round((c.used / c.total) * 100)}%)`],
          ['Never executed', kb(c.total - c.used)],
        ],
        evidence: `${kb(c.total)} downloaded, ${kb(c.used)} executed`,
        why: `${Math.round((1 - c.used / c.total) * 100)}% of this file did not run on this route. The browser still downloads and parses all of it.`,
        fix: 'Split heavy, non-critical code with dynamic import.',
        before: `import TrailerModal from './TrailerModal';`,
        after: `import dynamic from 'next/dynamic';\n\nconst TrailerModal = dynamic(() => import('./TrailerModal'), { ssr: false });`,
        steps: [
          { kind: 'check', text: `Find what is inside the file: run ${tick}ANALYZE=true next build${tick} with ${tick}@next/bundle-analyzer${tick}.` },
          { kind: 'replace', text: `For modals, charts, editors, players: replace the static ${tick}import${tick} with ${tick}dynamic(() => import(...))${tick}.` },
          { kind: 'remove', text: 'Remove libraries you only use for one small function (e.g. all of lodash) and import that function directly.' },
        ],
      };
    });

const unusedCss: Rule = (s) =>
  (s.css ?? [])
    .filter((c) => c.total - c.used > 20_000)
    .map((c): Finding => ({
      id: 'unused-css', title: 'Remove CSS that this page does not use', severity: c.total - c.used > 80_000 ? 'high' : 'medium', impact: 'LCP',
      route: s.route, where: c.url.split('/').slice(-1)[0].split('?')[0], asset: c.url,
      facts: [['File size', kb(c.total)], ['Used on this route', `${kb(c.used)} (${Math.round((c.used / c.total) * 100)}%)`]],
      evidence: `${kb(c.total)} of CSS, ${kb(c.used)} used`,
      why: 'CSS blocks rendering. The browser must download and parse all of it before it can paint anything, even rules that never match.',
      fix: 'Ship only the styles this page needs.',
      before: `import 'bootstrap/dist/css/bootstrap.css'; // whole framework`,
      after: `// Tailwind: make sure "content" only lists your real source folders\ncontent: ['./src/**/*.{ts,tsx}']`,
      steps: [
        { kind: 'remove', text: 'Remove global CSS frameworks or icon fonts you only use a little of.' },
        { kind: 'check', text: `Tailwind: check ${tick}content${tick} in ${tick}tailwind.config${tick} so unused classes are purged.` },
        { kind: 'replace', text: 'Prefer CSS Modules or Tailwind over one huge global stylesheet.' },
      ],
    }));

// ------------------------------------------------------------------ components
const heavyComponents: Rule = (s) =>
  flat(s.tree)
    .filter((n) => n.domNodes > 400 && !n.aboveFold && n.rect && !n.count)
    .map((n): Finding => {
      const name = n.minified ? 'Section' : safeName(n.name);
      return {
        id: 'defer-below-fold', title: 'Do not render heavy sections before they are needed', severity: 'medium', impact: 'Render',
        route: s.route, where: whereOf(n),
        facts: [['Component', label(n)], ['DOM nodes', String(n.domNodes)], ['Starts at', `${n.rect!.y}px (first screen is ${s.viewport?.h ?? 844}px)`]],
        evidence: `${label(n)} renders ${n.domNodes} DOM nodes, ${n.rect!.y}px from the top`,
        why: 'This section is far below the first screen but is rendered together with everything else, slowing the first paint.',
        fix: 'Mount it only when it is near the viewport.',
        before: `<${name} />`,
        after: `import dynamic from 'next/dynamic';\nimport { useInView } from 'react-intersection-observer';\n\nconst ${name} = dynamic(() => import('./${name}'));\n\nconst [ref, inView] = useInView({ triggerOnce: true, rootMargin: '300px' });\n\n<div ref={ref} style={{ minHeight: ${n.rect!.h} }}>\n  {inView && <${name} />}\n</div>`,
        steps: [
          ...(n.minified ? [{ kind: 'check' as const, text: `The name is minified. Find the component that renders ${tick}<${n.hint}>${tick} (or rebuild without name mangling, see the note in the component graph).` }] : []),
          { kind: 'add', text: `Install ${tick}react-intersection-observer${tick} (or write a small IntersectionObserver hook).` },
          { kind: 'replace', text: `Wrap the component in a div with ${tick}ref${tick} and render it only when ${tick}inView${tick} is true.` },
          { kind: 'add', text: `Keep ${tick}minHeight: ${n.rect!.h}${tick} on the wrapper so the page does not jump when it mounts.` },
        ],
      };
    });

/** Turn "why did it re-render" counts into the right fix. */
const rerenderAdvice = (name: string, w: RenderWhy) => {
  const total = w.props + w.state + w.store + w.context + w.parent || 1;
  const top = Math.max(w.props, w.state, w.store, w.context, w.parent);
  const keys = w.keys.map(([k]) => k);
  const fnKeys = keys.filter((k) => k.endsWith('()')).map((k) => k.slice(0, -2));
  const objKeys = keys.filter((k) => k.endsWith('{}')).map((k) => k.slice(0, -2));
  if (top === w.parent)
    return {
      cause: `${Math.round((w.parent / total) * 100)}% of renders happened only because the parent re-rendered: the props were identical`,
      fix: `Wrap it in ${tick}React.memo${tick}, and find which parent state keeps changing.`,
      before: `export default function ${name}(props) { … }`,
      after: `import { memo } from 'react';\n\nfunction ${name}(props) { … }\nexport default memo(${name});`,
      steps: [
        { kind: 'add' as const, text: `Wrap the component in ${tick}memo(...)${tick}: with equal props React will skip it.` },
        { kind: 'check' as const, text: 'Look at the parent: its state or store subscription changes often. Moving that state down (or selecting less from the store) removes the cause for all its children at once.' },
      ],
    };
  if (top === w.props)
    return {
      cause: `${Math.round((w.props / total) * 100)}% of renders were caused by changed props: ${keys.join(', ') || 'unknown'}`,
      fix: `Keep ${keys.join(', ')} stable between renders.`,
      before: `<${name} ${fnKeys[0] ?? 'onSelect'}={() => select(id)} ${objKeys[0] ?? 'style'}={{ margin: 8 }} />`,
      after: `const ${fnKeys[0] ?? 'onSelect'} = useCallback(() => select(id), [id]);\nconst ${objKeys[0] ?? 'style'} = useMemo(() => ({ margin: 8 }), []);\n\n<${name} ${fnKeys[0] ?? 'onSelect'}={${fnKeys[0] ?? 'onSelect'}} ${objKeys[0] ?? 'style'}={${objKeys[0] ?? 'style'}} />`,
      steps: [
        ...(fnKeys.length ? [{ kind: 'replace' as const, text: `Function props ${fnKeys.map((k) => tick + k + tick).join(', ')} are new on every parent render: wrap them in ${tick}useCallback${tick}.` }] : []),
        ...(objKeys.length ? [{ kind: 'replace' as const, text: `Object/array props ${objKeys.map((k) => tick + k + tick).join(', ')} are re-created each render: use ${tick}useMemo${tick} or move them outside the component.` }] : []),
        { kind: 'add' as const, text: `Then wrap ${tick}${name}${tick} in ${tick}React.memo${tick}; memo only helps once props are stable.` },
      ],
    };
  if (top === w.state)
    return {
      cause: `${Math.round((w.state / total) * 100)}% of renders were caused by its own state (useState/useReducer) changing`,
      fix: 'Move the state that changes often into its own small component.',
      before: `function ${name}() {\n  const [tick, setTick] = useState(0);   // changes many times per second\n  …\n  return <>{tick}<HeavyChildren /></>;      // everything re-renders with it\n}`,
      after: `function Ticker() {\n  const [tick, setTick] = useState(0);   // only this tiny component re-renders\n  …\n  return <span>{tick}</span>;\n}\n\nfunction ${name}() {\n  return <><Ticker /><HeavyChildren /></>;\n}`,
      steps: [
        { kind: 'replace' as const, text: 'Move the frequently changing state (timers, scroll, mouse, typing) into the smallest component that shows it, so the parent and its children stop re-rendering.' },
        { kind: 'check' as const, text: 'If the value is not shown on screen, keep it in a ref (useRef) instead of state.' },
        { kind: 'add' as const, text: 'If the parent must keep the state, wrap its heavy children in React.memo and keep their props stable.' },
      ],
    };
  if (top === w.store)
    return {
      cause: `${Math.round((w.store / total) * 100)}% of renders were caused by an external store (Zustand/Redux) it subscribes to`,
      fix: 'Subscribe to less state: precise selectors.',
      before: `const { user, cart } = useStore();   // re-renders on ANY store change`,
      after: `const userId = useStore((s) => s.user.id);   // re-renders only when id changes`,
      steps: [
        { kind: 'replace' as const, text: `Replace ${tick}useStore()${tick} / ${tick}useSelector(s => s)${tick} with a precise selector such as ${tick}useStore(s => s.user.id)${tick}.` },
        { kind: 'check' as const, text: 'If you select several values from Zustand, use ' + tick + 'useShallow' + tick + ' so an unchanged object does not re-render.' },
      ],
    };
  return {
    cause: `${Math.round((w.context / total) * 100)}% of renders were caused by a context value that changed`,
    fix: 'Split the context or memoize its value.',
    before: `<Ctx.Provider value={{ user, theme }}>…</Ctx.Provider>`,
    after: `const value = useMemo(() => ({ user, theme }), [user, theme]);\n<Ctx.Provider value={value}>…</Ctx.Provider>`,
    steps: [
      { kind: 'replace' as const, text: `Wrap the provider value in ${tick}useMemo${tick} so it only changes when its data changes.` },
      { kind: 'check' as const, text: 'Split one big context into smaller ones (e.g. user vs theme), or use a store with selectors.' },
    ],
  };
};

const rerenders: Rule = (s) => {
  const groups = new Map<string, { n: ComponentNode; instances: number; max: number }>();
  for (const n of flat(s.tree)) {
    if (n.renders <= 10) continue;
    const key = n.minified ? `min:${n.name}:${n.hint}` : n.name;
    const g = groups.get(key);
    const inst = n.count ?? 1;
    if (!g) groups.set(key, { n, instances: inst, max: n.renders });
    else { g.instances += inst; if (n.renders > g.max) { g.max = n.renders; g.n = n; } }
  }
  return [...groups.values()].map(({ n, instances, max }): Finding => {
    const w = n.why ?? { props: 0, state: 0, store: 0, context: 0, parent: max, keys: [] };
    const name = n.minified ? 'Component' : safeName(n.name);
    const a = rerenderAdvice(name, w);
    return {
      id: 'rerender', title: 'Stop components from re-rendering too often',
      severity: max > 40 ? 'high' : 'medium', impact: 'Render', route: s.route, where: whereOf(n),
      facts: [
        ['Component', label(n)],
        ['Re-renders per instance', `up to ${max}`],
        ['Instances', String(instances)],
        ['Why it re-rendered', `parent only: ${w.parent}, props: ${w.props}, own state: ${w.state}, store: ${w.store}, context: ${w.context}`],
        ...(w.keys.length ? [['Props that changed', w.keys.map(([k, c]) => `${k} (${c}x)`).join(', ')] as [string, string]] : []),
      ],
      evidence: `${label(n)}: ${max} re-renders in one instance while the page loaded and scrolled`,
      why: `${a.cause}.`,
      fix: a.fix, before: a.before, after: a.after,
      steps: [
        ...(n.minified ? [{ kind: 'check' as const, text: `The name is minified. Look for the component that renders ${tick}<${n.hint}>${tick}.` }] : []),
        ...a.steps,
      ],
    };
  });
};

// ------------------------------------------------------------------ names notice
const minifiedNames: Rule = (s) => {
  const nodes = flat(s.tree);
  const min = nodes.filter((n) => n.minified);
  if (min.length < 3 || min.length / Math.max(1, nodes.length) < 0.3) return [];
  return [{
    id: 'minified-names', title: 'Component names are minified in this build', severity: 'low', impact: 'Report', route: s.route, where: 'component graph',
    facts: [['Minified components', `${min.length} of ${nodes.length}`], ['Examples', min.slice(0, 5).map((n) => `${n.name} → ${n.hint ?? '?'}`).join(', ')]],
    why: 'The production build renamed components to 1-2 letters ("fp", "a"), so perfscope can only describe them by the HTML element they render.',
    fix: 'Build once with name mangling turned off to get real names.',
    before: `$ next build`,
    after: `$ next build --no-mangling`,
    steps: [
      { kind: 'replace', text: `Run ${tick}next build --no-mangling${tick}, start it, then run perfscope again. Names are readable, numbers stay realistic.` },
      { kind: 'check', text: `Alternative: point perfscope at ${tick}next dev${tick} for the component graph only (names are real, but speed numbers are not).` },
    ],
  }];
};

// ------------------------------------------------------------------ network budgets
const topN = (items: { url: string; bytes: number }[], n = 5) =>
  [...items].sort((a, b) => b.bytes - a.bytes).slice(0, n)
    .map((x) => `${kb(x.bytes).padStart(7)}  ${short(x.url.split('?')[0], 70)}`).join('\n');

const jsBudget: Rule = (s) => {
  const js = s.network.filter((n) => n.type === 'Script');
  const total = js.reduce((a, b) => a + b.bytes, 0);
  if (total <= 170 * 1024) return [];
  return [{
    id: 'js-budget', title: 'Keep total JavaScript under 170 KB', severity: total > 350 * 1024 ? 'high' : 'medium', impact: 'TBT',
    route: s.route, where: 'JavaScript bundle',
    facts: [['Downloaded (compressed)', kb(total)], ['Files', String(js.length)], ['Budget', '170KB'], ['Over budget by', kb(total - 170 * 1024)]],
    evidence: `Biggest files:\n${topN(js)}`,
    why: `${kb(total)} of JavaScript is downloaded. On a mid-range phone every KB also has to be parsed and executed, which blocks taps and delays LCP.`,
    fix: 'Find the biggest libraries, lazy-load them, or replace them with lighter ones.',
    before: `import _ from 'lodash';\nimport moment from 'moment';`,
    after: `import debounce from 'lodash/debounce';\nimport { format } from 'date-fns';\n\n// next.config.js\nexperimental: { optimizePackageImports: ['lucide-react', '@mui/material'] }`,
    steps: [
      { kind: 'check', text: `Run ${tick}ANALYZE=true next build${tick} with ${tick}@next/bundle-analyzer${tick} and open the biggest chunks listed above.` },
      { kind: 'replace', text: `Replace heavy libraries: ${tick}moment${tick} → ${tick}date-fns${tick} or ${tick}dayjs${tick}, whole ${tick}lodash${tick} → single functions.` },
      { kind: 'replace', text: `Load modals, charts, players and editors with ${tick}dynamic(() => import(...))${tick}.` },
      { kind: 'remove', text: `Remove ${tick}"use client"${tick} from components that have no state or events, so they stay on the server.` },
      { kind: 'add', text: `Add ${tick}optimizePackageImports${tick} in ${tick}next.config.js${tick} for icon/UI libraries.` },
    ],
  }];
};

const payload: Rule = (s) => {
  const total = s.network.reduce((a, b) => a + b.bytes, 0);
  if (total <= 1.6 * 1024 * 1024) return [];
  const imgs = s.network.filter((n) => n.type === 'Image').reduce((a, b) => a + b.bytes, 0);
  return [{
    id: 'payload', title: 'Reduce the total page weight', severity: total > 3 * 1024 * 1024 ? 'high' : 'medium', impact: 'Network',
    route: s.route, where: 'all requests',
    facts: [['Total', `${(total / 1024 / 1024).toFixed(1)} MB in ${s.network.length} requests`], ['Images', kb(imgs)], ['Full download on Slow 4G', `about ${secs(total)}`]],
    evidence: `Heaviest requests:\n${topN(s.network)}`,
    why: 'On Slow 4G (about 1.6 Mbps) every 200 KB costs roughly one extra second of loading.',
    fix: 'Shrink the heaviest requests listed above.',
    steps: [
      { kind: 'replace', text: 'Resize and compress images (see the image findings).' },
      { kind: 'remove', text: 'Remove unused fonts, videos or libraries that load on this route.' },
      { kind: 'add', text: 'Lazy-load everything that is not visible on the first screen.' },
    ],
  }];
};

const noCompression: Rule = (s) =>
  s.network
    .filter((n) => ['Script', 'Stylesheet', 'Document'].includes(n.type) && n.bytes > 2048 && n.compressed === false)
    .map((n): Finding => ({
      id: 'no-compression', title: 'Enable text compression (gzip / brotli)', severity: 'high', impact: 'Network',
      route: s.route, where: short(n.url.split('?')[0], 70), asset: n.url,
      facts: [['Sent', `${kb(n.bytes)} with no content-encoding header`], ['With brotli', `about ${kb(n.bytes * 0.25)}`]],
      evidence: `${kb(n.bytes)} sent without a content-encoding header`,
      why: 'This text file is sent uncompressed. gzip or brotli usually cuts JS, CSS and HTML by 70% or more.',
      fix: 'Turn on brotli/gzip on the server or CDN.',
      before: `# response headers\nContent-Type: application/javascript`,
      after: `# response headers\nContent-Type: application/javascript\nContent-Encoding: br`,
      steps: [
        { kind: 'add', text: `Vercel/Netlify compress automatically. On nginx enable ${tick}gzip on;${tick} or the brotli module; on Express use the ${tick}compression${tick} middleware.` },
        { kind: 'check', text: `Check that a proxy or custom server is not stripping the ${tick}Content-Encoding${tick} header.` },
      ],
    }));

const thirdParty: Rule = (s) => {
  let origin: string;
  try { origin = new URL(s.url).origin; } catch { return []; }
  const tp = s.network.filter((n) => n.url.startsWith('http') && !n.url.startsWith(origin) && ['Script', 'Stylesheet'].includes(n.type));
  const bytes = tp.reduce((a, b) => a + b.bytes, 0);
  if (tp.length < 6 && bytes < 100 * 1024) return [];
  const hosts = [...new Set(tp.map((n) => new URL(n.url).hostname))];
  return [{
    id: 'third-party', title: 'Reduce third-party scripts', severity: bytes > 250 * 1024 ? 'high' : 'medium', impact: 'TBT',
    route: s.route, where: hosts.slice(0, 4).join(', '),
    facts: [['Requests', String(tp.length)], ['Size', kb(bytes)], ['Domains', hosts.join(', ')]],
    evidence: `Biggest:\n${topN(tp, 4)}`,
    why: 'Analytics, chat widgets and ad scripts run on the same main thread as your app and you do not control their speed.',
    fix: 'Remove what you do not need and load the rest after the page is interactive.',
    before: `<script src="https://example.com/widget.js"></script>`,
    after: `import Script from 'next/script';\n\n<Script src="https://example.com/widget.js" strategy="lazyOnload" />`,
    steps: [
      { kind: 'remove', text: 'Remove scripts nobody looks at anymore (old analytics, A/B tools).' },
      { kind: 'replace', text: `Replace raw ${tick}<script>${tick} tags with ${tick}next/script${tick} and ${tick}strategy="lazyOnload"${tick}.` },
    ],
  }];
};

const renderBlocking: Rule = (s) => {
  const scripts = (s.blocking ?? []).filter((b) => b.kind === 'script');
  if (!scripts.length) return [];
  return [{
    id: 'render-blocking', title: 'Do not block the first paint with scripts', severity: scripts.length > 1 ? 'high' : 'medium', impact: 'FCP',
    route: s.route, where: '<head>',
    facts: [['Blocking scripts', String(scripts.length)], ['Files', scripts.map((b) => short(b.url.split('?')[0], 40)).join(', ')]],
    why: `${scripts.length} script(s) in <head> have neither async nor defer, so the browser stops rendering until each one is downloaded and run.`,
    fix: 'Add defer (or async), or use next/script.',
    before: `<script src="${short(scripts[0].url.split('?')[0], 50)}"></script>`,
    after: `<script src="${short(scripts[0].url.split('?')[0], 50)}" defer></script>\n\n// or in Next.js\n<Script src="…" strategy="afterInteractive" />`,
    steps: [
      { kind: 'add', text: `Add ${tick}defer${tick} to scripts that need the DOM, ${tick}async${tick} to independent ones (analytics).` },
      { kind: 'replace', text: `In Next.js replace raw tags with ${tick}next/script${tick}.` },
    ],
  }];
};

const cachePolicy: Rule = (s) => {
  let origin: string;
  try { origin = new URL(s.url).origin; } catch { return []; }
  const weak = s.network.filter((n) => {
    if (!n.url.startsWith(origin) || n.url.includes('/_next/image') || n.bytes < 4096) return false;
    if (!['Script', 'Stylesheet', 'Font', 'Image'].includes(n.type)) return false;
    const c = n.cache ?? '';
    const age = Number(c.match(/max-age=(\d+)/)?.[1] ?? 0);
    return !/immutable/.test(c) && age < 7 * 86400;
  });
  if (!weak.length) return [];
  const sample = weak[0].cache;
  return [{
    id: 'cache-policy', title: 'Cache static files for a long time', severity: 'medium', impact: 'Network',
    route: s.route, where: `${weak.length} first-party files`,
    facts: [['Files with a short cache', String(weak.length)], ['Size', kb(weak.reduce((a, b) => a + b.bytes, 0))], ['Example header', sample ? `Cache-Control: ${sample}` : 'no Cache-Control header']],
    evidence: topN(weak),
    why: 'These files can be cached for a year, but the server allows only a short time. Returning visitors download them again.',
    fix: 'Send Cache-Control: public, max-age=31536000, immutable for fingerprinted/static assets.',
    before: `Cache-Control: ${sample ?? '(missing)'}`,
    after: `// next.config.js\nasync headers() {\n  return [{\n    source: '/:all*(svg|jpg|png|webp|avif|woff2)',\n    headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],\n  }];\n}`,
    steps: [
      { kind: 'add', text: `Add the ${tick}headers()${tick} rule above for files in ${tick}/public${tick} (files in ${tick}/_next/static${tick} are already immutable).` },
      { kind: 'check', text: 'Only do this for files whose names change when content changes, or version them.' },
    ],
  }];
};

const fonts: Rule = (s) => {
  const f = s.network.filter((n) => n.type === 'Font');
  const total = f.reduce((a, b) => a + b.bytes, 0);
  const old = f.filter((n) => /ttf|otf|eot|sfnt/.test(n.mime ?? '') || /\.(ttf|otf|eot)(\?|$)/.test(n.url));
  const out: Finding[] = [];
  if (old.length)
    out.push({
      id: 'font-format', title: 'Use WOFF2 fonts', severity: 'medium', impact: 'Network', route: s.route, where: old.map((n) => short(n.url.split('?')[0], 40)).join(', '),
      facts: [['Old-format fonts', String(old.length)], ['Size', kb(old.reduce((a, b) => a + b.bytes, 0))]],
      why: 'TTF/OTF fonts are about 30% larger than WOFF2 and are not compressed by default.',
      fix: 'Convert to WOFF2, or use next/font.',
      before: `@font-face { src: url('/fonts/Brand.ttf') format('truetype'); }`,
      after: `@font-face { src: url('/fonts/Brand.woff2') format('woff2'); font-display: swap; }`,
      steps: [{ kind: 'replace', text: `Convert files to ${tick}.woff2${tick} (e.g. with ${tick}pyftsubset${tick} or an online converter) and update ${tick}@font-face${tick}.` }, { kind: 'check', text: `Or use ${tick}next/font${tick}, which self-hosts WOFF2 subsets automatically.` }],
    });
  if (f.length > 4 || total > 100 * 1024)
    out.push({
      id: 'fonts', title: 'Load fewer and lighter fonts', severity: total > 200 * 1024 ? 'high' : 'medium', impact: 'LCP', route: s.route, where: 'web fonts',
      facts: [['Font files', String(f.length)], ['Total', kb(total)]],
      evidence: topN(f),
      why: 'Text stays invisible or swaps late until fonts arrive, and every file adds a request.',
      fix: 'Keep 1-2 families, only the weights you use, with subsets.',
      before: `import './fonts.css'; // 8 weights`,
      after: `import { Inter } from 'next/font/google';\nconst inter = Inter({ subsets: ['latin'], weight: ['400', '600'], display: 'swap' });`,
      steps: [
        { kind: 'remove', text: 'Remove weights and styles you do not use.' },
        { kind: 'replace', text: `Use ${tick}next/font${tick} with ${tick}subsets${tick} and ${tick}display: 'swap'${tick}.` },
      ],
    });
  return out;
};

// ------------------------------------------------------------------ web vitals
const lcpOther: Rule = (s) => {
  const el = s.lcpElement;
  if (s.vitals.lcp <= 2500) return [];
  const img = el?.src ? s.images.find((i) => i.src === el.src) : undefined;
  if (img && img.fetchPriority !== 'high') return []; // covered by "lcp-priority"
  const what = !el ? 'an unknown element' : el.tag === 'img' ? `the image ${short(el.src ?? '', 50)}` : `<${el.tag}>${el.text ? ` "${el.text}"` : ''}`;
  return [{
    id: 'lcp', title: 'Make the largest element appear sooner', severity: s.vitals.lcp > 3000 ? 'high' : 'medium', impact: 'LCP',
    route: s.route, where: el ? loc(el.owner, el.selector) : 'LCP element',
    facts: [
      ['LCP', `${Math.round(s.vitals.lcp)}ms (good is under 2500ms)`],
      ['LCP element', what],
      ['First paint', s.vitals.fcp ? `${Math.round(s.vitals.fcp)}ms` : 'unknown'],
      ['Server (TTFB)', s.vitals.ttfb ? `${Math.round(s.vitals.ttfb)}ms` : 'unknown'],
      ...(img ? ([['Image', `${kb(img.bytes)}, about ${secs(img.bytes)} on Slow 4G`]] as [string, string][]) : []),
    ],
    evidence: `LCP = ${Math.round(s.vitals.lcp)}ms, element: ${what}`,
    why: `The browser measured ${what} as the LCP. ${img ? 'It is already high priority, so the file itself is probably too big or the server is slow.' : 'It is not an image that can be prioritized, so it usually waits for JavaScript, data or a font.'}`,
    fix: img ? 'Make the file smaller and the server faster.' : 'Render this content on the server and do not wait for client-side fetching.',
    before: `'use client';\nuseEffect(() => {\n  fetch('/api/movie').then(setMovie);   // content appears only after JS + fetch\n}, []);`,
    after: `// page.tsx (Server Component)\nconst movie = await getMovie(id);       // content is already in the HTML\nreturn <Hero movie={movie} />;`,
    steps: img
      ? [
          { kind: 'replace', text: 'Serve a smaller, modern-format file with a correct sizes value (see the image findings).' },
          { kind: 'add', text: `Add ${tick}<link rel="preconnect">${tick} to the image CDN domain.` },
          { kind: 'check', text: 'Check the server response time (TTFB) finding if it is present.' },
        ]
      : [
          { kind: 'remove', text: `Remove ${tick}useEffect${tick} + ${tick}fetch${tick} for content that is visible on the first screen.` },
          { kind: 'replace', text: `Fetch it in a Server Component (or ${tick}generateStaticParams${tick} / ISR) so it arrives in the HTML.` },
          { kind: 'replace', text: `Load fonts with ${tick}next/font${tick} and ${tick}display: "swap"${tick} so text is not hidden.` },
        ],
  }];
};

const vitals: Rule = (s) => {
  const out: Finding[] = [];
  const { fcp = 0, ttfb = 0 } = s.vitals;
  if (fcp > 1800)
    out.push({
      id: 'fcp', title: 'Show the first content sooner', severity: fcp > 3000 ? 'high' : 'medium', impact: 'FCP', route: s.route, where: 'first paint',
      facts: [['First Contentful Paint', `${Math.round(fcp)}ms (good is under 1800ms)`], ['Server (TTFB)', ttfb ? `${Math.round(ttfb)}ms` : 'unknown'], ['Blocking scripts', String((s.blocking ?? []).filter((b) => b.kind === 'script').length)]],
      evidence: `First Contentful Paint = ${Math.round(fcp)}ms`,
      why: `The first text or image appears after ${Math.round(fcp)}ms. The screen is blank until then.`,
      fix: 'Remove render-blocking work: big CSS, blocking scripts, slow server.',
      steps: [
        { kind: 'remove', text: `Remove blocking ${tick}<script>${tick} tags in ${tick}<head>${tick} and big unused CSS.` },
        { kind: 'replace', text: 'Render the first screen on the server so the HTML already contains content.' },
        { kind: 'check', text: 'See the server response (TTFB) and unused CSS findings.' },
      ],
    });
  if (ttfb > 800)
    out.push({
      id: 'ttfb', title: 'Speed up the server response', severity: ttfb > 1800 ? 'high' : 'medium', impact: 'LCP', route: s.route, where: 'server / CDN',
      facts: [['Time to first byte', `${Math.round(ttfb)}ms (good is under 800ms)`]],
      evidence: `Time to first byte = ${Math.round(ttfb)}ms`,
      why: `The server needs ${Math.round(ttfb)}ms to start answering. Everything else waits for it.`,
      fix: 'Cache the page, or move the data fetching closer to the user.',
      before: `export const dynamic = 'force-dynamic'; // rendered on every request`,
      after: `export const revalidate = 60; // cached at the edge, refreshed every 60s`,
      steps: [
        { kind: 'remove', text: `Remove ${tick}force-dynamic${tick} / ${tick}cache: "no-store"${tick} where data can be a minute old.` },
        { kind: 'add', text: `Add ${tick}revalidate${tick} (ISR) or static generation for pages like movie details.` },
        { kind: 'check', text: 'Put the database in the same region as the server (Vercel region vs Neon region).' },
      ],
    });
  if (s.vitals.cls > 0.05)
    out.push({
      id: 'cls', title: 'Remove layout shifts', severity: s.vitals.cls > 0.1 ? 'high' : 'low', impact: 'CLS', route: s.route, where: 'whole page',
      facts: [['CLS', `${s.vitals.cls.toFixed(3)} (good is under 0.1)`], ['Images without size', String(s.images.filter((i) => !i.hasSize).length)]],
      evidence: `CLS = ${s.vitals.cls.toFixed(3)}`,
      why: `Content moves while the page loads. ${s.images.some((i) => !i.hasSize) ? `${s.images.filter((i) => !i.hasSize).length} images have no reserved size, the most common cause.` : ''}`,
      fix: 'Reserve space for images, skeletons and fonts.',
      before: `<img src="/poster.jpg" />\n/* custom font loaded from a <link> */`,
      after: `<Image src="/poster.jpg" width={300} height={450} alt="" />\n\nimport { Inter } from 'next/font/google';\nconst inter = Inter({ subsets: ['latin'], display: 'swap' });`,
      steps: [
        { kind: 'add', text: `Give every image and video a width/height or ${tick}aspect-ratio${tick} (see the image findings).` },
        { kind: 'replace', text: 'Replace spinners with skeletons that have the same size as the final content.' },
        { kind: 'replace', text: `Load fonts with ${tick}next/font${tick} instead of a ${tick}<link>${tick} or ${tick}@import${tick}.` },
      ],
    });
  if (s.vitals.tbt > 200)
    out.push({
      id: 'tbt', title: 'Reduce main-thread blocking', severity: s.vitals.tbt > 600 ? 'high' : 'medium', impact: 'TBT', route: s.route, where: 'main thread',
      facts: [['Total Blocking Time', `${Math.round(s.vitals.tbt)}ms (good is under 200ms)`], ['Long tasks', String(s.vitals.longTasks)]],
      evidence: `Total Blocking Time ≈ ${Math.round(s.vitals.tbt)}ms, ${s.vitals.longTasks} long tasks`,
      why: 'The main thread was blocked, so taps and scrolls feel slow.',
      fix: 'Ship less client JavaScript.',
      before: `'use client';\n\nexport default function Page() { /* static content + one button */ }`,
      after: `// page.tsx (Server Component, no "use client")\nexport default function Page() {\n  return <><StaticContent /><LikeButton /></>;\n}\n\n// LikeButton.tsx\n'use client';\nexport function LikeButton() { … }`,
      steps: [
        { kind: 'remove', text: `Remove ${tick}"use client"${tick} from components that only show data and have no state or events.` },
        { kind: 'add', text: `Keep ${tick}"use client"${tick} only on small leaf components (buttons, forms).` },
        { kind: 'check', text: 'See the JavaScript budget and unused JavaScript findings for big files.' },
      ],
    });
  if (s.domTotal > 800)
    out.push({
      id: 'dom-size', title: 'Reduce the number of DOM elements', severity: s.domTotal > 1400 ? 'high' : 'medium', impact: 'Render', route: s.route, where: 'DOM',
      facts: [['DOM elements', String(s.domTotal)], ['Lighthouse warns above', '800'], ['Lighthouse fails above', '1400']],
      evidence: `${s.domTotal} DOM nodes`,
      why: 'Style and layout calculations get slower with every element.',
      fix: 'Virtualize or paginate lists and remove needless wrapper elements.',
      before: `<div><div><div><span>{title}</span></div></div></div>`,
      after: `<span>{title}</span>`,
      steps: [
        { kind: 'remove', text: `Remove wrapper ${tick}<div>${tick}s that exist only for spacing; use ${tick}gap${tick} or margin on the parent.` },
        { kind: 'replace', text: 'Replace long rendered lists with virtualization or pagination.' },
      ],
    });
  return out;
};

export const rules: Rule[] = [
  virtualizeLists, images, preconnect, unusedJs, unusedCss, heavyComponents, rerenders, minifiedNames,
  lcpOther, vitals, jsBudget, payload, noCompression, thirdParty, renderBlocking, cachePolicy, fonts,
];
export const analyze = (s: RouteSnapshot): Finding[] => rules.flatMap((r) => r(s));
