export type Severity = "high" | "medium" | "low";
export type Category = "images" | "layout" | "paint" | "fonts" | "a11y" | "best" | "components";

export interface Finding {
  id: string;
  category: Category;
  severity: Severity;
  /** the whole answer in one line: what, where, how much, what to do */
  short: string;
  /** a readable name of the place: <Component> › selector */
  where: string;
  /** measured facts: [label, value] */
  facts: [string, string][];
  /** the fix, one or two sentences */
  fix: string;
  before?: string;
  after?: string;
  /** live elements to highlight on the page (weak: a removed node is simply skipped) */
  elements?: WeakRef<Element>[];
  /** images only */
  image?: ImageFinding;
}

export interface ImageFinding {
  src: string;
  naturalW: number;
  naturalH: number;
  targetW: number;
  targetH: number;
  bytes: number;
  estBytes: number;
  format: string;
  usages: { selector: string; owner?: string; w: number; h: number }[];
}

export interface Vitals {
  lcp?: { ms: number; selector?: string; url?: string; size: number };
  cls: number;
  inp?: number;
  fcp?: number;
  longTasks: number;
  score?: number;
}

export interface ComponentStat {
  name: string;
  renders: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
  /** renders where nothing the component owns changed: its parent re-rendered */
  wasted: number;
  /** most frequent reason: props / state / parent */
  cause: "props" | "state" | "parent" | "mount";
  /** props that changed most often */
  props: string[];
  element?: WeakRef<Element>;
}

export interface Report {
  at: number;
  url: string;
  findings: Finding[];
  vitals: Vitals;
  components: ComponentStat[];
  /** whether durations are real (React development / profiling build) */
  reactTiming: "live" | "snapshot" | "unavailable" | "no-react";
  engine: "wasm" | "js";
  /** how long perfscope itself worked for this report, ms */
  selfMs: number;
  stats: { nodes: number; depth: number; images: number; fonts: number };
}

export type Corner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export interface Settings {
  /** show the launcher at all */
  enabled: boolean;
  /** open the panel when the page loads */
  startOpen: boolean;
  corner: Corner;
  /** accent color of the overlay */
  accent: string;
  /** 0..100: strength of the shader in the panel header; 0 turns it off (and stops all drawing) */
  shader: number;
  /** watch style/class mutations to find JS-driven animation */
  watchMutations: boolean;
  /** highlight the element on the page while hovering a finding */
  highlight: boolean;
  /** compact rows */
  dense: boolean;
}

export const defaultSettings: Settings = {
  enabled: true,
  startOpen: false,
  corner: "bottom-right",
  accent: "#ff5d57",
  shader: 55,
  watchMutations: true,
  highlight: true,
  dense: false,
};
