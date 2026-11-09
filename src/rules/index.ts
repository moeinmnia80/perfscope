import type { Finding, Rule, RouteSnapshot, ComponentNode, ImageInfo } from '../types.js';

const kb = (b: number) => (b / 1024).toFixed(0) + 'KB';
const flat = (n: ComponentNode[]): ComponentNode[] => n.flatMap((x) => [x, ...flat(x.children)]);
const short = (s: string, n = 48) => (s.length > n ? '…' + s.slice(-n) : s);
const loc = (owner: string | undefined, sel: string | undefined, fallback = '') =>
  [owner && `<${owner}>`, sel ?? fallback].filter(Boolean).join(' › ');
const safeName = (n: string) => n.replace(/\W/g, '') || 'Section';

// --- tiny HTML helpers so we can show a realistic "before / after" for <img> tags ---
const tidy = (html = '') =>
  html
    .replace(/\s(srcset|sizes|style|data-nimg|decoding)="[^"]*"/g, '')
    .replace(/\s(src|href)="([^"]{50,})"/g, (_m, a, v) => ` ${a}="${short(v, 40)}"`);
const addAttr = (tag: string, attr: string) => tag.replace(/\s*\/?>\s*$/, ` ${attr}>`);
const dropAttr = (tag: string, name: string) => tag.replace(new RegExp(`\\s${name}(="[^"]*")?`, 'i'), '');

// ---------------------------------------------------------------- lists
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
      evidence: `${l.items} identical children inside ${l.selector} (${l.heightPx}px tall)`,
      why: `${l.items} items are in the DOM at once. Layout cost and memory grow with the number of nodes, and the user only sees a few of them.`,
      fix: 'Virtualize the list, or paginate / use infinite query.',
      before: `{movies.map((m) => (\n  <MovieCard key={m.id} movie={m} />\n))}`,
      after: `const parentRef = useRef<HTMLDivElement>(null);\nconst rowVirtualizer = useVirtualizer({\n  count: movies.length,\n  getScrollElement: () => parentRef.current,\n  estimateSize: () => 320,\n  overscan: 4,\n});\n\n<div ref={parentRef} style={{ height: '100vh', overflow: 'auto' }}>\n  <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>\n    {rowVirtualizer.getVirtualItems().map((v) => (\n      <div key={v.key} style={{ position: 'absolute', top: 0, transform: \`translateY(\${v.start}px)\` }}>\n        <MovieCard movie={movies[v.index]} />\n      </div>\n    ))}\n  </div>\n</div>`,
      steps: [
        { kind: 'check', text: `Open ${l.owner ? '`' + l.owner + '`' : 'the component that renders this list'} and find the \`.map()\` that renders all ${l.items} items.` },
        { kind: 'add', text: 'Install the library: `npm i @tanstack/react-virtual`.' },
        { kind: 'replace', text: 'Replace the plain `.map()` with `useVirtualizer` as shown in "After".' },
        { kind: 'check', text: 'If the data comes from an API, paginating on the server is even cheaper than virtualizing.' },
      ],
    }));

// ---------------------------------------------------------------- images
const images: Rule = (s) => {
  const out: Finding[] = [];

  for (const i of s.images) {
    const where = loc(i.owner, i.selector, short(i.src));
    const tag = tidy(i.html);
    const alt = i.alt ?? '';
    const jsx = () => `<Image src={…} alt="${alt}" />`;
    const common = { route: s.route, where, evidence: tag || undefined, asset: short(i.src, 80) };

    // 1. below the fold but eagerly loaded
    if (!i.aboveFold && !i.lazy)
      out.push({
        ...common,
        id: 'img-lazy',
        title: 'Lazy-load images that are below the fold',
        severity: 'medium',
        impact: 'Network',
        why: 'This image is not visible on first load but the browser downloads it immediately, competing with the images the user actually sees.',
        fix: 'Add loading="lazy" (next/image does this by default).',
        ...(i.nextImage
          ? {
              before: `<Image src={…} alt="${alt}" priority />   // or loading="eager"`,
              after: `<Image src={…} alt="${alt}" />`,
              steps: [
                { kind: 'check', text: `Open ${i.owner ? '`' + i.owner + '`' : 'the component'} and find this <Image>.` },
                { kind: 'remove', text: 'Remove the `priority` prop (or `loading="eager"`). Only the main image above the fold should have it.' },
              ],
            }
          : {
              before: tag,
              after: addAttr(tag, 'loading="lazy"'),
              steps: [
                { kind: 'add', text: 'Add `loading="lazy"` to this <img>.' },
                { kind: 'replace', text: 'Better: replace `<img>` with `next/image`, which is lazy by default and also fixes size and format.' },
              ],
            }),
      });

    // 2. image file much bigger than the box it is shown in
    if (i.naturalW > i.renderedW * 2 && i.renderedW > 0)
      out.push({
        ...common,
        id: 'img-oversized',
        title: 'Serve images at the size they are displayed',
        severity: 'medium',
        impact: 'Network',
        why: `The file is ${i.naturalW}px wide but it is shown at ${i.renderedW}px (${kb(i.bytes)} transferred). The extra pixels are downloaded for nothing.`,
        fix: 'Give the image a `sizes` attribute so the browser picks a smaller file.',
        ...(i.nextImage
          ? {
              before: jsx(),
              after: `<Image src={…} alt="${alt}" sizes="${i.renderedW}px" />`,
              steps: [
                { kind: 'add', text: `Add \`sizes="${i.renderedW}px"\` to this <Image>. For fluid layouts use viewport units, e.g. \`sizes="(max-width: 768px) 50vw, 20vw"\`.` },
                { kind: 'check', text: 'With `fill`, `sizes` is required; without it Next assumes 100vw and serves the largest file.' },
              ],
            }
          : {
              before: tag,
              after: addAttr(tag, `sizes="${i.renderedW}px" srcset="small.jpg 400w, medium.jpg 800w"`),
              steps: [
                { kind: 'replace', text: 'Replace `<img>` with `next/image` so the srcset is generated for you.' },
                { kind: 'add', text: 'Or export smaller versions of the file and list them in `srcset` with a matching `sizes`.' },
              ],
            }),
      });

    // 2b. old formats (jpeg/png/gif) that are big enough to matter
    const mime = s.network.find((n) => n.url === i.src)?.mime ?? '';
    if (/image\/(jpeg|png|gif)/.test(mime) && i.bytes > 30_000)
      out.push({
        ...common,
        id: 'img-format',
        title: 'Serve images in modern formats (WebP / AVIF)',
        severity: i.bytes > 150_000 ? 'medium' : 'low',
        impact: 'Network',
        why: `Delivered as ${mime.replace('image/', '')} (${kb(i.bytes)}). WebP and AVIF are usually 25-50% smaller for the same quality.`,
        fix: 'Let next/image convert to AVIF/WebP, or export the file in a modern format.',
        ...(i.nextImage
          ? {
              before: `<Image src={…} alt="${alt}" unoptimized />\n\n// next.config.js had no "formats"`,
              after: `<Image src={…} alt="${alt}" />\n\n// next.config.js\nimages: { formats: ['image/avif', 'image/webp'] }`,
              steps: [
                { kind: 'remove', text: 'Remove the `unoptimized` prop if it is there; it turns optimization off.' },
                { kind: 'add', text: "Add `images: { formats: ['image/avif', 'image/webp'] }` to `next.config.js`." },
                { kind: 'check', text: 'If the image is hosted on another domain, add it to `images.remotePatterns` so Next can optimize it.' },
              ],
            }
          : {
              before: tag,
              after: tag.replace(/<img/i, '<Image').replace(/\s*\/?>\s*$/, ' />'),
              steps: [
                { kind: 'replace', text: 'Replace `<img>` with `next/image`, which serves WebP/AVIF automatically.' },
                { kind: 'check', text: 'Or convert the file yourself (e.g. squoosh.app) and use the `.webp` / `.avif` version.' },
              ],
            }),
      });

    // 3. no reserved space -> layout shift
    if (!i.hasSize)
      out.push({
        ...common,
        id: 'img-no-size',
        title: 'Reserve space for images to avoid layout shift',
        severity: 'low',
        impact: 'CLS',
        why: 'The image has no width/height, so the page jumps when it finishes loading (Cumulative Layout Shift).',
        fix: 'Set width and height, or use `fill` inside a container with an aspect ratio.',
        ...(i.nextImage
          ? {
              before: jsx(),
              after: `<Image src={…} alt="${alt}" width={${i.naturalW || 300}} height={${i.naturalH || 450}} />`,
              steps: [
                { kind: 'add', text: 'Add `width` and `height` props (the real image size is fine; CSS controls the displayed size).' },
                { kind: 'check', text: 'Or use `fill` and give the parent `relative aspect-[2/3]`.' },
              ],
            }
          : {
              before: tag,
              after: addAttr(tag, `width="${i.naturalW}" height="${i.naturalH ?? ''}"`),
              steps: [{ kind: 'add', text: `Add \`width="${i.naturalW}" height="${i.naturalH ?? '…'}"\` to the <img>, or an \`aspect-ratio\` in CSS.` }],
            }),
      });
  }

  // 4. the image the browser really measured as LCP (falls back to a guess if unknown)
  const lcpSrc = s.lcpElement?.src;
  const lcpImg: ImageInfo | undefined = lcpSrc
    ? s.images.find((i) => i.src === lcpSrc)
    : s.lcpElement
      ? undefined
      : s.images.find((i) => i.aboveFold && i.renderedW > 300);
  if (lcpImg && s.vitals.lcp > 2500 && lcpImg.fetchPriority !== 'high') {
    const tag = tidy(lcpImg.html);
    const alt = lcpImg.alt ?? '';
    out.push({
      id: 'lcp-priority',
      title: 'Load the main image first',
      severity: 'high',
      impact: 'LCP',
      route: s.route,
      where: loc(lcpImg.owner, lcpImg.selector, short(lcpImg.src)),
      evidence: tag || undefined,
      asset: short(lcpImg.src, 80),
      why: `Largest Contentful Paint is ${Math.round(s.vitals.lcp)}ms (good is under 2500ms) and the browser measured THIS image as the LCP element. It is not marked as important, so it is downloaded late.`,
      fix: 'Add `priority` (next/image) or `fetchpriority="high"` to this image.',
      ...(lcpImg.nextImage
        ? {
            before: `<Image src={…} alt="${alt}" />`,
            after: `<Image src={…} alt="${alt}" priority />`,
            steps: [
              { kind: 'add', text: 'Add the `priority` prop to this <Image>.' },
              { kind: 'check', text: 'Use it on one or two images per page only; if everything is priority, nothing is.' },
            ],
          }
        : {
            before: tag,
            after: addAttr(dropAttr(tag, 'loading'), 'fetchpriority="high"'),
            steps: [
              { kind: 'remove', text: 'Remove `loading="lazy"` if it is there. A lazy image can never be the fast LCP.' },
              { kind: 'add', text: 'Add `fetchpriority="high"`.' },
            ],
          }),
    });
  }
  return out;
};

// ---------------------------------------------------------------- javascript
const unusedJs: Rule = (s) =>
  s.scripts
    .filter((c) => c.total - c.used > 20_000)
    .map((c): Finding => {
      const file = c.url.split('/').slice(-1)[0];
      return {
        id: 'unused-js',
        title: 'Load less JavaScript up front',
        severity: c.total - c.used > 100_000 ? 'high' : 'medium',
        impact: 'TBT',
        route: s.route,
        where: file,
        asset: c.url,
        evidence: `${kb(c.total)} downloaded, ${kb(c.used)} executed (${Math.round((c.used / c.total) * 100)}% used)`,
        why: `${Math.round((1 - c.used / c.total) * 100)}% of this file did not run on this route. The browser still downloads and parses all of it.`,
        fix: 'Split heavy, non-critical code with dynamic import.',
        before: `import TrailerModal from './TrailerModal';`,
        after: `import dynamic from 'next/dynamic';\n\nconst TrailerModal = dynamic(() => import('./TrailerModal'), { ssr: false });`,
        steps: [
          { kind: 'check', text: 'Find what is inside the file: run `ANALYZE=true next build` with `@next/bundle-analyzer`, or open the file in source-map-explorer.' },
          { kind: 'replace', text: 'For modals, charts, editors, players: replace the static `import` with `dynamic(() => import(...))`.' },
          { kind: 'remove', text: 'Remove libraries you only use for one small function (e.g. all of lodash) and import that function directly.' },
        ],
      };
    });

// ---------------------------------------------------------------- components
const heavyComponents: Rule = (s) =>
  flat(s.tree)
    .filter((n) => n.domNodes > 400 && !n.aboveFold && n.rect)
    .map((n): Finding => {
      const name = safeName(n.name);
      return {
        id: 'defer-below-fold',
        title: 'Do not render heavy sections before they are needed',
        severity: 'medium',
        impact: 'Render',
        route: s.route,
        where: `<${n.name}> (y=${n.rect!.y}px)`,
        evidence: `<${n.name}> renders ${n.domNodes} DOM nodes, starting ${n.rect!.y}px from the top of the page`,
        why: 'This section is far below the first screen but it is rendered together with everything else, slowing the first paint.',
        fix: 'Mount it only when it is near the viewport.',
        before: `<${name} />`,
        after: `import dynamic from 'next/dynamic';\nimport { useInView } from 'react-intersection-observer';\n\nconst ${name} = dynamic(() => import('./${name}'));\n\nconst [ref, inView] = useInView({ triggerOnce: true, rootMargin: '300px' });\n\n<div ref={ref} style={{ minHeight: ${n.rect!.h} }}>\n  {inView && <${name} />}\n</div>`,
        steps: [
          { kind: 'add', text: 'Install `react-intersection-observer` (or write a small IntersectionObserver hook).' },
          { kind: 'replace', text: `Wrap \`<${name} />\` in a div with \`ref\` and render it only when \`inView\` is true.` },
          { kind: 'add', text: `Keep \`minHeight: ${n.rect!.h}\` on the wrapper so the page does not jump when it mounts.` },
        ],
      };
    });

const rerenders: Rule = (s) =>
  flat(s.tree)
    .filter((n) => n.renders > 15)
    .map((n): Finding => ({
      id: 'rerender',
      title: 'Stop components from re-rendering too often',
      severity: n.renders > 40 ? 'high' : 'medium',
      impact: 'Render',
      route: s.route,
      where: `<${n.name}>`,
      evidence: `<${n.name}> rendered ${n.renders} times while the page loaded and scrolled`,
      why: `Rendered ${n.renders} times. Usually state lives higher than needed, the store is read without a selector, or props change on every render.`,
      fix: 'Select only what you need and memoize stable props.',
      before: `const { user, cart } = useStore();   // re-renders on ANY store change\n\nexport default function ${safeName(n.name)}() { … }`,
      after: `const userId = useStore((s) => s.user.id);   // re-renders only when id changes\n\nfunction ${safeName(n.name)}() { … }\nexport default memo(${safeName(n.name)});`,
      steps: [
        { kind: 'replace', text: 'Replace `useStore()` / `useSelector(s => s)` with a precise selector: `useStore(s => s.user.id)`.' },
        { kind: 'add', text: 'Wrap the component in `React.memo` and the function props passed to it in `useCallback`.' },
        { kind: 'check', text: 'Move state down into the smallest component that needs it.' },
        { kind: 'check', text: 'If React Compiler is on, make sure this component is not opted out.' },
      ],
    }));

// ---------------------------------------------------------------- unused css
const unusedCss: Rule = (s) =>
  (s.css ?? [])
    .filter((c) => c.total - c.used > 20_000)
    .map((c): Finding => {
      const file = c.url.split('/').slice(-1)[0].split('?')[0];
      return {
        id: 'unused-css',
        title: 'Remove CSS that this page does not use',
        severity: c.total - c.used > 80_000 ? 'high' : 'medium',
        impact: 'LCP',
        route: s.route,
        where: file,
        asset: c.url,
        evidence: `${kb(c.total)} of CSS, ${kb(c.used)} used (${Math.round((c.used / c.total) * 100)}%)`,
        why: 'CSS blocks rendering. The browser must download and parse all of it before it can paint anything, even rules that never match.',
        fix: 'Ship only the styles this page needs.',
        before: `import 'bootstrap/dist/css/bootstrap.css'; // whole framework`,
        after: `// Tailwind: make sure "content" in tailwind.config only lists your real source folders\ncontent: ['./src/**/*.{ts,tsx}']`,
        steps: [
          { kind: 'remove', text: 'Remove global CSS frameworks or icon fonts you only use a little of.' },
          { kind: 'check', text: 'Tailwind: check `content` in `tailwind.config` so unused classes are purged.' },
          { kind: 'replace', text: 'Prefer CSS Modules or Tailwind over one huge global stylesheet.' },
        ],
      };
    });

// ---------------------------------------------------------------- network budgets
const topN = (items: { url: string; bytes: number }[], n = 5) =>
  [...items]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, n)
    .map((x) => `${kb(x.bytes).padStart(7)}  ${short(x.url.split('?')[0], 70)}`)
    .join('\n');

const jsBudget: Rule = (s) => {
  const js = s.network.filter((n) => n.type === 'Script');
  const total = js.reduce((a, b) => a + b.bytes, 0);
  if (total <= 170 * 1024) return [];
  return [{
    id: 'js-budget',
    title: 'Keep total JavaScript under 170 KB',
    severity: total > 350 * 1024 ? 'high' : 'medium',
    impact: 'TBT',
    route: s.route,
    where: 'JavaScript bundle',
    evidence: `${kb(total)} of JavaScript downloaded (${js.length} files). Biggest:\n${topN(js)}`,
    why: `${kb(total)} of JavaScript is downloaded (compressed). On a mid-range phone every KB also has to be parsed and executed, which blocks taps and delays LCP.`,
    fix: 'Find the biggest libraries, lazy-load them, or replace them with lighter ones.',
    before: `import _ from 'lodash';\nimport moment from 'moment';`,
    after: `import debounce from 'lodash/debounce';\nimport { format } from 'date-fns';\n\n// next.config.js\nexperimental: { optimizePackageImports: ['lucide-react', '@mui/material'] }`,
    steps: [
      { kind: 'check', text: 'Run `ANALYZE=true next build` with `@next/bundle-analyzer` and open the biggest chunks listed above.' },
      { kind: 'replace', text: 'Replace heavy libraries: `moment` → `date-fns` or `dayjs`, whole `lodash` → single functions.' },
      { kind: 'replace', text: 'Load modals, charts, players and editors with `dynamic(() => import(...))`.' },
      { kind: 'remove', text: 'Remove `"use client"` from components that have no state or events, so they stay on the server.' },
      { kind: 'add', text: "Add `optimizePackageImports` in `next.config.js` for icon/UI libraries." },
    ],
  }];
};

const payload: Rule = (s) => {
  const total = s.network.reduce((a, b) => a + b.bytes, 0);
  if (total <= 1.6 * 1024 * 1024) return [];
  return [{
    id: 'payload',
    title: 'Reduce the total page weight',
    severity: total > 3 * 1024 * 1024 ? 'high' : 'medium',
    impact: 'Network',
    route: s.route,
    where: 'all requests',
    evidence: `${(total / 1024 / 1024).toFixed(1)} MB in ${s.network.length} requests. Heaviest:\n${topN(s.network)}`,
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
      id: 'no-compression',
      title: 'Enable text compression (gzip / brotli)',
      severity: 'high',
      impact: 'Network',
      route: s.route,
      where: short(n.url.split('?')[0], 70),
      asset: n.url,
      evidence: `${kb(n.bytes)} sent without a content-encoding header`,
      why: 'This text file is sent uncompressed. gzip or brotli usually cuts JS, CSS and HTML by 70% or more.',
      fix: 'Turn on brotli/gzip on the server or CDN.',
      before: `# response headers\nContent-Type: application/javascript`,
      after: `# response headers\nContent-Type: application/javascript\nContent-Encoding: br`,
      steps: [
        { kind: 'add', text: 'Vercel/Netlify compress automatically. On nginx enable `gzip on;` or the brotli module; on Express use the `compression` middleware.' },
        { kind: 'check', text: 'Check that a proxy or custom server is not stripping the `Content-Encoding` header.' },
      ],
    }));

const thirdParty: Rule = (s) => {
  let origin: string;
  try { origin = new URL(s.url).origin; } catch { return []; }
  const tp = s.network.filter(
    (n) => n.url.startsWith('http') && !n.url.startsWith(origin) && ['Script', 'Stylesheet'].includes(n.type),
  );
  const bytes = tp.reduce((a, b) => a + b.bytes, 0);
  if (tp.length < 6 && bytes < 100 * 1024) return [];
  const hosts = [...new Set(tp.map((n) => new URL(n.url).hostname))];
  return [{
    id: 'third-party',
    title: 'Reduce third-party scripts',
    severity: bytes > 250 * 1024 ? 'high' : 'medium',
    impact: 'TBT',
    route: s.route,
    where: hosts.slice(0, 4).join(', '),
    evidence: `${tp.length} third-party scripts/styles, ${kb(bytes)}, from ${hosts.length} domains. Biggest:\n${topN(tp, 4)}`,
    why: 'Analytics, chat widgets and ad scripts run on the same main thread as your app and you do not control their speed.',
    fix: 'Remove what you do not need and load the rest after the page is interactive.',
    before: `<script src="https://example.com/widget.js"></script>`,
    after: `import Script from 'next/script';\n\n<Script src="https://example.com/widget.js" strategy="lazyOnload" />`,
    steps: [
      { kind: 'remove', text: 'Remove scripts nobody looks at anymore (old analytics, A/B tools).' },
      { kind: 'replace', text: 'Replace raw `<script>` tags with `next/script` and `strategy="lazyOnload"` or `"afterInteractive"`.' },
    ],
  }];
};

// ---------------------------------------------------------------- web vitals
const lcpOther: Rule = (s) => {
  const el = s.lcpElement;
  if (s.vitals.lcp <= 2500) return [];
  const img = el?.src ? s.images.find((i) => i.src === el.src) : undefined;
  if (img && img.fetchPriority !== 'high') return []; // covered by "lcp-priority"
  const what = !el ? 'an unknown element' : el.tag === 'img' ? `the image ${short(el.src ?? '', 50)}` : `<${el.tag}>${el.text ? ` "${el.text}"` : ''}`;
  return [{
    id: 'lcp',
    title: 'Make the largest element appear sooner',
    severity: s.vitals.lcp > 3000 ? 'high' : 'medium',
    impact: 'LCP',
    route: s.route,
    where: el ? loc(el.owner, el.selector) : 'LCP element',
    evidence: `LCP = ${Math.round(s.vitals.lcp)}ms, element: ${what}`,
    why: `Largest Contentful Paint is ${Math.round(s.vitals.lcp)}ms (good is under 2500ms). The browser measured ${what} as the LCP. ${img ? 'It is already high priority, so the file itself is probably too big or the server is slow.' : 'It is not an image that can be prioritized, so it usually waits for JavaScript, data or a font.'}`,
    fix: img ? 'Make the file smaller and the server faster.' : 'Render this content on the server and do not wait for client-side fetching.',
    before: `'use client';\nuseEffect(() => {\n  fetch('/api/movie').then(setMovie);   // content appears only after JS + fetch\n}, []);`,
    after: `// page.tsx (Server Component)\nconst movie = await getMovie(id);       // content is already in the HTML\nreturn <Hero movie={movie} />;`,
    steps: img
      ? [
          { kind: 'replace', text: 'Serve a smaller, modern-format file with a correct `sizes` (see the image findings).' },
          { kind: 'add', text: 'Add `<link rel="preconnect">` to the image CDN domain.' },
          { kind: 'check', text: 'Check the server response time (TTFB) finding if it is present.' },
        ]
      : [
          { kind: 'remove', text: 'Remove `useEffect` + `fetch` for content that is visible on the first screen.' },
          { kind: 'replace', text: 'Fetch it in a Server Component (or `generateStaticParams` / ISR) so it arrives in the HTML.' },
          { kind: 'replace', text: 'Load fonts with `next/font` and `display: "swap"` so text is not hidden.' },
        ],
  }];
};

const vitals: Rule = (s) => {
  const out: Finding[] = [];
  const { fcp = 0, ttfb = 0 } = s.vitals;
  if (fcp > 1800)
    out.push({
      id: 'fcp', title: 'Show the first content sooner', severity: fcp > 3000 ? 'high' : 'medium', impact: 'FCP', route: s.route, where: 'first paint',
      evidence: `First Contentful Paint = ${Math.round(fcp)}ms`,
      why: `The first text or image appears after ${Math.round(fcp)}ms (good is under 1800ms). The screen is blank until then.`,
      fix: 'Remove render-blocking work: big CSS, blocking scripts, slow server.',
      steps: [
        { kind: 'remove', text: 'Remove blocking `<script>` tags in `<head>` and big unused CSS.' },
        { kind: 'replace', text: 'Render the first screen on the server so HTML already contains content.' },
        { kind: 'check', text: 'See the server response (TTFB) and unused CSS findings.' },
      ],
    });
  if (ttfb > 800)
    out.push({
      id: 'ttfb', title: 'Speed up the server response', severity: ttfb > 1800 ? 'high' : 'medium', impact: 'LCP', route: s.route, where: 'server / CDN',
      evidence: `Time to first byte = ${Math.round(ttfb)}ms`,
      why: `The server needs ${Math.round(ttfb)}ms to start answering (good is under 800ms). Everything else waits for it.`,
      fix: 'Cache the page, or move the data fetching closer to the user.',
      before: `export const dynamic = 'force-dynamic'; // rendered on every request`,
      after: `export const revalidate = 60; // cached at the edge, refreshed every 60s`,
      steps: [
        { kind: 'remove', text: 'Remove `force-dynamic` / `cache: "no-store"` where data can be a minute old.' },
        { kind: 'add', text: 'Add `revalidate` (ISR) or static generation for pages like movie details.' },
        { kind: 'check', text: 'Put the database in the same region as the server (Vercel region vs Neon region).' },
      ],
    });
  if (s.vitals.cls > 0.05)
    out.push({
      id: 'cls', title: 'Remove layout shifts', severity: s.vitals.cls > 0.1 ? 'high' : 'low', impact: 'CLS', route: s.route, where: 'whole page',
      evidence: `CLS = ${s.vitals.cls.toFixed(3)}`,
      why: `Cumulative Layout Shift is ${s.vitals.cls.toFixed(3)} (good is under 0.1). Content moves while the page loads.`,
      fix: 'Reserve space for images, skeletons and fonts.',
      before: `<img src="/poster.jpg" />\n/* custom font loaded from a <link> */`,
      after: `<Image src="/poster.jpg" width={300} height={450} alt="" />\n\nimport { Inter } from 'next/font/google';\nconst inter = Inter({ subsets: ['latin'], display: 'swap' });`,
      steps: [
        { kind: 'add', text: 'Give every image and video a width/height or `aspect-ratio` (see the image findings).' },
        { kind: 'replace', text: 'Replace spinners with skeletons that have the same size as the final content.' },
        { kind: 'replace', text: 'Load fonts with `next/font` instead of a `<link>` or `@import`.' },
      ],
    });
  if (s.vitals.tbt > 200)
    out.push({
      id: 'tbt', title: 'Reduce main-thread blocking', severity: s.vitals.tbt > 600 ? 'high' : 'medium', impact: 'TBT', route: s.route, where: 'main thread',
      evidence: `Total Blocking Time ≈ ${Math.round(s.vitals.tbt)}ms, ${s.vitals.longTasks} long tasks`,
      why: `The main thread was blocked for about ${Math.round(s.vitals.tbt)}ms (good is under 200ms). Taps and scrolls feel slow during this time.`,
      fix: 'Ship less client JavaScript.',
      before: `'use client';\n\nexport default function Page() { /* static content + one button */ }`,
      after: `// page.tsx (Server Component, no "use client")\nexport default function Page() {\n  return <><StaticContent /><LikeButton /></>;\n}\n\n// LikeButton.tsx\n'use client';\nexport function LikeButton() { … }`,
      steps: [
        { kind: 'remove', text: 'Remove `"use client"` from components that only show data and have no state or events.' },
        { kind: 'add', text: 'Keep `"use client"` only on small leaf components (buttons, forms).' },
        { kind: 'check', text: 'See the JavaScript budget and unused JavaScript findings for big files.' },
      ],
    });
  if (s.domTotal > 800)
    out.push({
      id: 'dom-size', title: 'Reduce the number of DOM elements', severity: s.domTotal > 1400 ? 'high' : 'medium', impact: 'Render', route: s.route, where: 'DOM',
      evidence: `${s.domTotal} DOM nodes`,
      why: `${s.domTotal} DOM nodes. Lighthouse warns above 800 and fails above 1400 because style and layout calculations get slower.`,
      fix: 'Virtualize or paginate lists and remove needless wrapper elements.',
      before: `<div><div><div><span>{title}</span></div></div></div>`,
      after: `<span>{title}</span>`,
      steps: [
        { kind: 'remove', text: 'Remove wrapper `<div>`s that exist only for spacing; use `gap` or margin on the parent.' },
        { kind: 'replace', text: 'Replace long rendered lists with virtualization or pagination.' },
      ],
    });
  return out;
};

export const rules: Rule[] = [
  virtualizeLists, images, unusedJs, unusedCss, heavyComponents, rerenders,
  lcpOther, vitals, jsBudget, payload, noCompression, thirdParty,
];
export const analyze = (s: RouteSnapshot): Finding[] => rules.flatMap((r) => r(s));
