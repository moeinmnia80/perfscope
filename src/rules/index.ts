import type { Finding, Rule, RouteSnapshot, ComponentNode } from '../types.js';

const kb = (b: number) => (b / 1024).toFixed(0) + 'KB';
const flat = (n: ComponentNode[]): ComponentNode[] => n.flatMap((x) => [x, ...flat(x.children)]);

const virtualizeLists: Rule = (s) =>
  s.lists
    .filter((l) => l.items >= 50)
    .map((l): Finding => ({
      id: 'virtualize-list',
      severity: l.items > 150 ? 'high' : 'medium',
      route: s.route,
      where: l.selector,
      why: `${l.items} items are in the DOM at once (height ${l.heightPx}px). Layout cost and memory grow with node count.`,
      fix: `For long scrollable lists use virtualization; if data comes from an API use pagination or infinite query:
\`\`\`tsx
import { useVirtualizer } from '@tanstack/react-virtual';
const rowVirtualizer = useVirtualizer({
  count: movies.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 320,
  overscan: 4,
});
\`\`\``,
    }));

const images: Rule = (s) => {
  const out: Finding[] = [];
  for (const i of s.images) {
    const short = i.src.slice(-60);
    if (!i.aboveFold && !i.lazy)
      out.push({
        id: 'img-lazy', severity: 'medium', route: s.route, where: short,
        why: 'A below-the-fold image is loaded without lazy-loading.',
        fix: 'Use `next/image` (lazy by default) or add `loading="lazy"`.',
      });
    if (i.naturalW > i.renderedW * 2 && i.renderedW > 0)
      out.push({
        id: 'img-oversized', severity: 'medium', route: s.route, where: short,
        why: `Natural width ${i.naturalW}px but rendered at ${i.renderedW}px (${kb(i.bytes)} transferred).`,
        fix: '`<Image sizes="(max-width:768px) 50vw, 20vw" ... />` so a proper srcset is generated.',
      });
    if (!i.hasSize)
      out.push({
        id: 'img-no-size', severity: 'low', route: s.route, where: short,
        why: 'No explicit dimensions; causes layout shift (CLS).',
        fix: 'Set width/height or use `fill` inside a container with `aspect-[2/3]`.',
      });
  }
  const lcpImg = s.images.find((i) => i.aboveFold && i.renderedW > 300);
  if (lcpImg && s.vitals.lcp > 2500)
    out.push({
      id: 'lcp-priority', severity: 'high', route: s.route, where: lcpImg.src.slice(-60),
      why: `LCP is ${Math.round(s.vitals.lcp)}ms and the hero image is likely the LCP element.`,
      fix: 'Add `<Image priority />` or `fetchPriority="high"` to this image.',
    });
  return out;
};

const unusedJs: Rule = (s) =>
  s.scripts
    .filter((c) => c.total > 50_000 && c.used / c.total < 0.5)
    .map((c): Finding => ({
      id: 'unused-js',
      severity: c.total > 200_000 ? 'high' : 'medium',
      route: s.route,
      where: c.url.split('/').slice(-1)[0],
      why: `${Math.round((1 - c.used / c.total) * 100)}% of ${kb(c.total)} in this file did not execute on this route.`,
      fix: `Lazy-load heavy, non-critical parts:
\`\`\`tsx
import dynamic from 'next/dynamic';
const TrailerModal = dynamic(() => import('./TrailerModal'), { ssr: false });
\`\`\``,
    }));

const heavyComponents: Rule = (s) =>
  flat(s.tree)
    .filter((n) => n.domNodes > 400 && !n.aboveFold && n.rect)
    .map((n): Finding => ({
      id: 'defer-below-fold',
      severity: 'medium',
      route: s.route,
      where: `<${n.name}> (y=${n.rect!.y}px, ${n.domNodes} nodes)`,
      why: 'A heavy component below the fold renders together with the rest of the page.',
      fix: `Use \`dynamic()\` plus an IntersectionObserver so it mounts when near the viewport:
\`\`\`tsx
const ${n.name} = dynamic(() => import('./${n.name}'));
{inView && <${n.name} />}
\`\`\``,
    }));

const rerenders: Rule = (s) =>
  flat(s.tree)
    .filter((n) => n.renders > 15)
    .map((n): Finding => ({
      id: 'rerender',
      severity: n.renders > 40 ? 'high' : 'medium',
      route: s.route,
      where: `<${n.name}>`,
      why: `Rendered ${n.renders} times. Usually state lives higher than needed, or props are unstable.`,
      fix: `- Move state down to the lowest component that needs it.
- Use precise selectors in Zustand/Redux: \`useStore(s => s.user.id)\`.
- Use \`React.memo\` + \`useCallback\` for function props when needed.
- If React Compiler is enabled, check this component is not opted out.`,
    }));

const vitals: Rule = (s) => {
  const out: Finding[] = [];
  if (s.vitals.cls > 0.1)
    out.push({
      id: 'cls', severity: 'high', route: s.route, where: 'whole page',
      why: `CLS is ${s.vitals.cls.toFixed(3)} (good threshold: 0.1).`,
      fix: 'Reserve fixed dimensions for images, skeletons and fonts. Use `next/font`.',
    });
  if (s.vitals.tbt > 300)
    out.push({
      id: 'tbt', severity: 'high', route: s.route, where: 'main thread',
      why: `Total Blocking Time is about ${Math.round(s.vitals.tbt)}ms.`,
      fix: 'Reduce client-side JS: make non-interactive components Server Components and push `use client` down to leaves.',
    });
  if (s.domTotal > 1500)
    out.push({
      id: 'dom-size', severity: s.domTotal > 3000 ? 'high' : 'medium', route: s.route, where: 'DOM',
      why: `${s.domTotal} DOM nodes. Above ~1500, style/layout cost becomes noticeable.`,
      fix: 'Virtualization, pagination, and removing needless wrapper elements.',
    });
  return out;
};

export const rules: Rule[] = [virtualizeLists, images, unusedJs, heavyComponents, rerenders, vitals];
export const analyze = (s: RouteSnapshot): Finding[] => rules.flatMap((r) => r(s));
