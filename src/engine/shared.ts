/** Record layouts shared by the Rust core and the JS fallback. Keep in sync with rust/src/lib.rs. */
export const IMG_IN = 10;
export const IMG_OUT = 8;

export type ImageUsageIn = {
  group: number;
  cssW: number;
  cssH: number;
  naturalW: number;
  naturalH: number;
  bytes: number;
  /** 0 unknown, 1 jpeg, 2 png, 3 webp, 4 avif, 5 gif, 6 svg */
  format: number;
  dpr: number;
  above: boolean;
  lcp: boolean;
};

export type ImagePlan = {
  group: number;
  maxW: number;
  maxH: number;
  targetW: number;
  targetH: number;
  estBytes: number;
  savings: number;
  usages: number;
};

export type Churn = { id: number; count: number; perSecond: number };

export interface Engine {
  kind: "wasm" | "js";
  imagePlan(usages: ImageUsageIn[]): ImagePlan[];
  /** rows: fg r,g,b, alpha, bg r,g,b */
  contrast(rows: number[][]): number[];
  topK(values: number[], k: number): number[];
  score(lcp: number, cls: number, inp: number, mobile: boolean): number;
  /** events: [nodeId, timeMs] */
  churn(events: [number, number][]): Churn[];
}
