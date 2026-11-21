import { IMG_IN, type Churn, type Engine, type ImagePlan, type ImageUsageIn } from "./shared";

/** Pure-JS twin of rust/src/lib.rs. Same algorithms, used when WebAssembly is unavailable (strict CSP, old browser). */

const formatFactor = (f: number) => (f === 1 ? 0.72 : f === 2 ? 0.5 : f === 5 ? 0.4 : 1);

const imagePlan = (usages: ImageUsageIn[]): ImagePlan[] => {
  const by = new Map<number, ImageUsageIn[]>();
  for (const u of usages) (by.get(u.group) ?? by.set(u.group, []).get(u.group)!).push(u);
  const out: ImagePlan[] = [];
  for (const group of [...by.keys()].sort((a, b) => a - b)) {
    const list = by.get(group)!;
    let maxW = 0, maxH = 0, maxDpr = 1, natW = 0, natH = 0, bytes = 0;
    for (const u of list) {
      maxW = Math.max(maxW, u.cssW);
      maxH = Math.max(maxH, u.cssH);
      maxDpr = Math.max(maxDpr, u.dpr);
      natW = Math.max(natW, u.naturalW);
      natH = Math.max(natH, u.naturalH);
      bytes = Math.max(bytes, u.bytes);
    }
    const fmt = list[list.length - 1]!.format;
    const dpr = Math.min(Math.max(maxDpr, 1), 2);
    let targetW = natW, targetH = natH, scale = 1;
    if (fmt !== 6 && natW > 0) {
      const want = Math.ceil((maxW * dpr) / 16) * 16;
      targetW = Math.max(Math.min(want, natW), Math.min(16, natW));
      scale = targetW / natW;
      targetH = Math.round(natH * scale);
    }
    const est = bytes > 0 ? bytes * scale * scale * formatFactor(fmt) : 0;
    out.push({
      group, maxW, maxH, targetW, targetH,
      estBytes: Math.round(est),
      savings: bytes > 0 ? Math.round(Math.max(0, bytes - est)) : 0,
      usages: list.length,
    });
  }
  return out;
};

const lin = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

const contrast = (rows: number[][]) =>
  rows.map((r) => {
    const a = Math.min(Math.max(r[3]!, 0), 1);
    const l1 = lum(r[0]! * a + r[4]! * (1 - a), r[1]! * a + r[5]! * (1 - a), r[2]! * a + r[6]! * (1 - a));
    const l2 = lum(r[4]!, r[5]!, r[6]!);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  });

const topK = (values: number[], k: number) =>
  values
    .map((v, i) => [Number.isNaN(v) ? -Infinity : v, i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .slice(0, k)
    .map(([, i]) => i);

const erf = (x: number) => {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
};
const curve = (value: number, p10: number, median: number) => {
  const std = (Math.log(Math.max(value, Number.MIN_VALUE) / median) * 0.9061938024368232) / -Math.log(p10 / median);
  return value <= p10 ? 1 : Math.min(Math.max((1 - erf(std)) / 2, 0), 1);
};
const score = (lcp: number, cls: number, inp: number, mobile: boolean) => {
  const [p10, med] = mobile ? [2500, 4000] : [1200, 2400];
  const parts: [number, number, number][] = [
    [lcp, 0.4, curve(lcp, p10, med)],
    [cls, 0.3, cls <= 0 ? 1 : curve(cls, 0.1, 0.25)],
    [inp, 0.3, curve(inp, 200, 500)],
  ];
  let sum = 0, w = 0;
  for (const [v, weight, s] of parts) if (!Number.isNaN(v)) { sum += s * weight; w += weight; }
  return w === 0 ? NaN : Math.round((sum / w) * 100);
};

const churn = (events: [number, number][]): Churn[] => {
  const by = new Map<number, number[]>();
  for (const [id, t] of events) (by.get(id) ?? by.set(id, []).get(id)!).push(t);
  const out: Churn[] = [];
  for (const id of [...by.keys()].sort((a, b) => a - b)) {
    const ts = by.get(id)!.sort((a, b) => a - b);
    let best = 0, lo = 0;
    for (let hi = 0; hi < ts.length; hi++) {
      while (ts[hi]! - ts[lo]! > 1000) lo++;
      best = Math.max(best, hi - lo + 1);
    }
    out.push({ id, count: ts.length, perSecond: best });
  }
  return out;
};

export const jsEngine: Engine = { kind: "js", imagePlan, contrast, topK, score, churn };
export const _IMG_IN = IMG_IN;
