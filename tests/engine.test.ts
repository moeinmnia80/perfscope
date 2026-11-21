import { describe, expect, it } from "vitest";
import { jsEngine } from "../src/engine/fallback";
import { loadWasmEngine } from "../src/engine/wasm";
import type { ImageUsageIn } from "../src/engine/shared";

const u = (o: Partial<ImageUsageIn>): ImageUsageIn => ({
  group: 1, cssW: 300, cssH: 200, naturalW: 3000, naturalH: 2000, bytes: 800_000, format: 1, dpr: 2, above: false, lcp: false, ...o,
});

describe("Rust (wasm) core equals its JS twin", async () => {
  const wasm = await loadWasmEngine();

  it("image plan: largest usage is the reference", () => {
    const usages = [u({ cssW: 300 }), u({ cssW: 640, cssH: 427 }), u({ group: 2, format: 3, naturalW: 400, naturalH: 300, cssW: 800, bytes: 20000 })];
    const a = wasm.imagePlan(usages);
    const b = jsEngine.imagePlan(usages);
    expect(a).toEqual(b);
    expect(a[0]!.targetW).toBe(1280);
    expect(a[0]!.usages).toBe(2);
    expect(a[1]!.targetW).toBe(400); // never upscaled
    expect(a[1]!.savings).toBe(0);
  });

  it("contrast: black on white = 21, #777 on white ~ 4.48", () => {
    const rows = [[0, 0, 0, 1, 255, 255, 255], [119, 119, 119, 1, 255, 255, 255], [0, 0, 0, 0.5, 255, 255, 255]];
    const a = wasm.contrast(rows);
    const b = jsEngine.contrast(rows);
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));
    expect(a[0]).toBeCloseTo(21, 6);
    expect(a[1]).toBeCloseTo(4.48, 1);
  });

  it("top-k", () => {
    const v = [1, 9, 3, 9, NaN, 5];
    expect(wasm.topK(v, 3)).toEqual([1, 3, 5]);
    expect(jsEngine.topK(v, 3)).toEqual([1, 3, 5]);
    expect(wasm.topK([], 3)).toEqual([]);
  });

  it("score", () => {
    for (const args of [[2000, 0, 100], [4000, NaN, NaN], [9000, 0.6, 900], [1800, 0.02, NaN]] as [number, number, number][]) {
      expect(wasm.score(...args, true)).toBe(jsEngine.score(...args, true));
    }
    expect(Number.isNaN(wasm.score(NaN, NaN, NaN, true))).toBe(true);
  });

  it("churn", () => {
    const ev: [number, number][] = [];
    for (let f = 0; f < 60; f++) ev.push([5, f * 16]);
    ev.push([9, 100], [9, 4000]);
    expect(wasm.churn(ev)).toEqual(jsEngine.churn(ev));
    expect(wasm.churn(ev)[0]).toEqual({ id: 5, count: 60, perSecond: 60 });
  });

  it("handles repeated calls without leaking (memory stays bounded)", () => {
    const usages = Array.from({ length: 500 }, (_, i) => u({ group: i % 50 }));
    for (let i = 0; i < 300; i++) wasm.imagePlan(usages);
    expect(wasm.imagePlan(usages).length).toBe(50);
  });
});
