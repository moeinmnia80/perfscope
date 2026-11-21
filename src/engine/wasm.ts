import { IMG_IN, IMG_OUT, type Churn, type Engine, type ImagePlan, type ImageUsageIn } from "./shared";
import { WASM_BASE64 } from "./wasm.gen";

type Exports = {
  memory: WebAssembly.Memory;
  ps_alloc(len: number): number;
  ps_free(ptr: number, len: number): void;
  ps_image_plan(n: number, inp: number, out: number): number;
  ps_contrast(n: number, inp: number, out: number): void;
  ps_top_k(n: number, vals: number, k: number, out: number): number;
  ps_score(lcp: number, cls: number, inp: number, mobile: number): number;
  ps_churn(n: number, inp: number, out: number): number;
};

const decode = (b64: string) => {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
};

/** Instantiates the embedded Rust core. Throws when WebAssembly is blocked (the caller falls back to JS). */
export async function loadWasmEngine(): Promise<Engine> {
  const { instance } = await WebAssembly.instantiate(decode(WASM_BASE64), {});
  const x = instance.exports as unknown as Exports;

  /** copy `data` into wasm memory, run `fn`, free. A fresh Float64Array each call: memory may grow and detach old views. */
  const withBuf = <T,>(data: ArrayLike<number>, outLen: number, fn: (inp: number, out: number) => T): { r: T; out: Float64Array } => {
    const inPtr = x.ps_alloc(Math.max(data.length, 1));
    const outPtr = x.ps_alloc(Math.max(outLen, 1));
    new Float64Array(x.memory.buffer, inPtr, data.length).set(data as ArrayLike<number>);
    const r = fn(inPtr, outPtr);
    const out = new Float64Array(x.memory.buffer, outPtr, outLen).slice();
    x.ps_free(inPtr, Math.max(data.length, 1));
    x.ps_free(outPtr, Math.max(outLen, 1));
    return { r, out };
  };

  return {
    kind: "wasm",
    imagePlan(usages: ImageUsageIn[]): ImagePlan[] {
      const n = usages.length;
      if (!n) return [];
      const flat = new Float64Array(n * IMG_IN);
      usages.forEach((u, i) => flat.set([u.group, u.cssW, u.cssH, u.naturalW, u.naturalH, u.bytes, u.format, u.dpr, +u.above, +u.lcp], i * IMG_IN));
      const { r: groups, out } = withBuf(flat, n * IMG_OUT, (a, b) => x.ps_image_plan(n, a, b));
      const plans: ImagePlan[] = [];
      for (let g = 0; g < groups; g++) {
        const o = out.subarray(g * IMG_OUT, g * IMG_OUT + IMG_OUT);
        plans.push({ group: o[0]!, maxW: o[1]!, maxH: o[2]!, targetW: o[3]!, targetH: o[4]!, estBytes: o[5]!, savings: o[6]!, usages: o[7]! });
      }
      return plans;
    },
    contrast(rows) {
      const n = rows.length;
      if (!n) return [];
      const { out } = withBuf(rows.flat(), n, (a, b) => x.ps_contrast(n, a, b));
      return Array.from(out);
    },
    topK(values, k) {
      const n = values.length;
      if (!n || k <= 0) return [];
      const { r: m, out } = withBuf(values, Math.min(k, n), (a, b) => x.ps_top_k(n, a, k, b));
      return Array.from(out.subarray(0, m), Number);
    },
    score: (lcp, cls, inp, mobile) => x.ps_score(lcp, cls, inp, mobile ? 1 : 0),
    churn(events): Churn[] {
      const n = events.length;
      if (!n) return [];
      const { r: nodes, out } = withBuf(events.flat(), n * 3, (a, b) => x.ps_churn(n, a, b));
      const res: Churn[] = [];
      for (let i = 0; i < nodes; i++) res.push({ id: out[i * 3]!, count: out[i * 3 + 1]!, perSecond: out[i * 3 + 2]! });
      return res;
    },
  };
}
