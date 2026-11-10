/** Why a component re-rendered, counted per cause (React DevTools-style comparison). */
export interface RenderWhy {
  /** a prop changed identity/value */
  props: number;
  /** its own useState/useReducer state changed */
  state: number;
  /** an external store (zustand, redux, ...) it subscribes to changed */
  store: number;
  /** a context it reads changed */
  context: number;
  /** nothing it owns changed: the parent re-rendered and passed the same props */
  parent: number;
  /** most frequently changed props; "()" = function, "{}" = object/array */
  keys: [string, number][];
}

export interface ComponentNode {
  name: string;
  /** the name looks minified ("fp", "a"), so it is not meaningful */
  minified?: boolean;
  /** for minified components: the DOM element it renders, e.g. "div.grid" */
  hint?: string;
  /** how many identical siblings were merged into this node */
  count?: number;
  rect: { x: number; y: number; w: number; h: number } | null;
  domNodes: number;
  /** re-renders of ONE instance (the worst instance when merged) */
  renders: number;
  why?: RenderWhy;
  aboveFold: boolean;
  children: ComponentNode[];
}

export interface ListCandidate {
  selector: string;
  items: number;
  heightPx: number;
  /** nearest readable React component above this list, e.g. "MovieGrid" */
  owner?: string;
}

export interface ImageInfo {
  src: string;
  renderedW: number;
  displayH?: number;
  naturalW: number;
  naturalH?: number;
  lazy: boolean;
  aboveFold: boolean;
  hasSize: boolean;
  bytes: number;
  /** absolute y position of the image on the page (px) */
  y?: number;
  selector?: string;
  html?: string;
  alt?: string | null;
  nextImage?: boolean;
  fetchPriority?: string;
  loadingAttr?: string | null;
  sizesAttr?: string | null;
  hasSrcset?: boolean;
  owner?: string;
}

export interface ScriptCoverage {
  url: string;
  total: number;
  used: number;
}

export interface NetworkEntry {
  url: string;
  type: string;
  bytes: number;
  mime?: string;
  compressed?: boolean;
  /** cache-control response header */
  cache?: string;
}

export interface RouteSnapshot {
  route: string;
  url: string;
  vitals: { lcp: number; cls: number; longTasks: number; tbt: number; fcp?: number; ttfb?: number };
  network: NetworkEntry[];
  scripts: ScriptCoverage[];
  css?: ScriptCoverage[];
  tree: ComponentNode[];
  lists: ListCandidate[];
  images: ImageInfo[];
  domTotal: number;
  /** the element the browser picked as Largest Contentful Paint */
  lcpElement?: { tag: string; src?: string; selector?: string; owner?: string; text?: string };
  /** true when measured with Slow 4G + 4x CPU slowdown (like Lighthouse mobile) */
  throttled?: boolean;
  viewport?: { w: number; h: number; dpr: number };
  /** origins that have <link rel="preconnect|dns-prefetch"> */
  preconnects?: string[];
  /** scripts/styles in <head> that block the first paint */
  blocking?: { url: string; kind: 'script' | 'css' }[];
}

export type Severity = 'high' | 'medium' | 'low';

/** One concrete action the developer has to take. */
export interface Step {
  kind: 'remove' | 'add' | 'replace' | 'check';
  text: string;
}

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  route: string;
  /** where it is: <Component> › selector */
  where: string;
  why: string;
  fix: string;
  /** which metric this affects: LCP, CLS, TBT, Network, Memory, Render */
  impact?: string;
  /** measured facts shown as a small table: [label, value] */
  facts?: [string, string][];
  /** what was found in the page (usually the rendered HTML) */
  evidence?: string;
  asset?: string;
  before?: string;
  after?: string;
  steps?: Step[];
}

export type Rule = (s: RouteSnapshot) => Finding[];
