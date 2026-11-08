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
