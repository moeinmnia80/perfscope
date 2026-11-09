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
