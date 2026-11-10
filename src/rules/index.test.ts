import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from './index.js';
import type { RouteSnapshot } from '../types.js';

const base: RouteSnapshot = {
  route: '/', url: 'http://x/', network: [], scripts: [], tree: [],
  lists: [], images: [], domTotal: 100,
  vitals: { lcp: 1000, cls: 0, longTasks: 0, tbt: 0 },
};

test('200-item list -> virtualize with high severity', () => {
  const f = analyze({ ...base, lists: [{ selector: 'ul.grid', items: 200, heightPx: 9000 }] });
  assert.equal(f[0].id, 'virtualize-list');
  assert.equal(f[0].severity, 'high');
});

test('healthy page -> no findings', () => {
  assert.equal(analyze(base).length, 0);
});

test('high CLS is reported', () => {
  const f = analyze({ ...base, vitals: { ...base.vitals, cls: 0.4 } });
  assert.ok(f.some((x) => x.id === 'cls'));
});

test('300KB of JS -> js-budget (medium), 400KB -> high', () => {
  const net = (kb: number) => [{ url: 'https://x/a.js', type: 'Script', bytes: kb * 1024 }];
  assert.equal(analyze({ ...base, network: net(300) }).find((x) => x.id === 'js-budget')?.severity, 'medium');
  assert.equal(analyze({ ...base, network: net(400) }).find((x) => x.id === 'js-budget')?.severity, 'high');
  assert.equal(analyze({ ...base, network: net(50) }).length, 0);
});

test('slow LCP on a text element -> lcp finding naming the element', () => {
  const f = analyze({
    ...base,
    vitals: { ...base.vitals, lcp: 4200 },
    lcpElement: { tag: 'h1', text: 'Dune', selector: 'section > h1', owner: 'Hero' },
  });
  const l = f.find((x) => x.id === 'lcp');
  assert.ok(l);
  assert.match(l!.evidence ?? '', /h1/);
});

test('uncompressed JS is reported as high', () => {
  const f = analyze({ ...base, network: [{ url: 'https://x/app.js', type: 'Script', bytes: 50_000, compressed: false }] });
  assert.equal(f.find((x) => x.id === 'no-compression')?.severity, 'high');
});

const img = (over: object = {}) => ({
  src: 'https://image.tmdb.org/t/p/original/abc.jpg', renderedW: 190, displayH: 285, naturalW: 1000, naturalH: 1500,
  lazy: true, aboveFold: false, hasSize: true, bytes: 700_000, y: 900, selector: 'div.card > img.poster', owner: 'MovieCard',
  nextImage: false, ...over,
});
const phone = { w: 390, h: 844, dpr: 2 };

test('oversized TMDB poster -> asks for the right TMDB size (w500 for a 380px need)', () => {
  const f = analyze({ ...base, viewport: phone, images: [img()] });
  const o = f.find((x) => x.id === 'img-oversized');
  assert.ok(o);
  assert.match(o!.after ?? '', /\/t\/p\/w500\/abc\.jpg/);
  assert.match(o!.before ?? '', /\/t\/p\/original\//);
});

test('many images with the same problem pattern -> ONE grouped finding', () => {
  const f = analyze({ ...base, viewport: phone, images: Array.from({ length: 12 }, (_, i) => img({ src: `https://image.tmdb.org/t/p/original/p${i}.jpg` })) });
  const o = f.filter((x) => x.id === 'img-oversized');
  assert.equal(o.length, 1);
  assert.match(o[0].where, /12 images/);
});

test('images with unknown byte size are not flagged as oversized', () => {
  const f = analyze({ ...base, viewport: phone, images: [img({ bytes: 0 })] });
  assert.ok(!f.some((x) => x.id === 'img-oversized'));
});

test('re-render caused by function props -> useCallback advice naming the prop', () => {
  const node = { name: 'MovieCard', rect: null, domNodes: 5, renders: 20, aboveFold: true, children: [],
    why: { props: 20, state: 0, store: 0, context: 0, parent: 0, keys: [['onPick()', 20]] as [string, number][] } };
  const f = analyze({ ...base, tree: [node] }).find((x) => x.id === 'rerender');
  assert.ok(f);
  assert.ok(f!.steps?.some((s) => /useCallback/.test(s.text) && /onPick/.test(s.text)));
});

test('re-render with identical props -> memo advice; minified names never shown as the component', () => {
  const node = { name: 'fp', minified: true, hint: 'div.card', count: 60, rect: null, domNodes: 5, renders: 30, aboveFold: true, children: [],
    why: { props: 0, state: 0, store: 0, context: 0, parent: 30, keys: [] as [string, number][] } };
  const f = analyze({ ...base, tree: [node] }).find((x) => x.id === 'rerender');
  assert.ok(f);
  assert.match(f!.where, /minified/);
  assert.match(f!.after ?? '', /memo/);
});

test('mostly minified tree -> one explanatory finding', () => {
  const mk = (name: string) => ({ name, minified: true, hint: 'div', rect: null, domNodes: 1, renders: 0, aboveFold: true, children: [] });
  assert.ok(analyze({ ...base, tree: [mk('a'), mk('b'), mk('c')] }).some((x) => x.id === 'minified-names'));
});

test('LCP image on another origin without preconnect -> preconnect finding; with it -> none', () => {
  const s = { ...base, vitals: { ...base.vitals, lcp: 1000 }, lcpElement: { tag: 'img', src: 'https://image.tmdb.org/t/p/w500/a.jpg' } };
  assert.ok(analyze(s).some((x) => x.id === 'preconnect'));
  assert.ok(!analyze({ ...s, preconnects: ['https://image.tmdb.org'] }).some((x) => x.id === 'preconnect'));
});

test('blocking script in head -> render-blocking', () => {
  assert.ok(analyze({ ...base, blocking: [{ url: 'http://x/a.js', kind: 'script' }] }).some((x) => x.id === 'render-blocking'));
});
