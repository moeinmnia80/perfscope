export interface ComponentNode {
  name: string;
  rect: { x: number; y: number; w: number; h: number } | null;
  domNodes: number;
  renders: number;
  aboveFold: boolean;
  children: ComponentNode[];
}

export interface ListCandidate {
  selector: string;
  items: number;
  heightPx: number;
  /** nearest React component that renders this list, e.g. "MovieGrid" */
  owner?: string;
}

export interface ImageInfo {
  src: string;
  renderedW: number;
  naturalW: number;
  naturalH?: number;
  lazy: boolean;
  aboveFold: boolean;
  hasSize: boolean;
  bytes: number;
  /** CSS-like path to the element, e.g. "div.card > img.poster" */
  selector?: string;
  /** outerHTML of the <img> as rendered in the browser (truncated) */
  html?: string;
  alt?: string | null;
  /** true when the element was rendered by next/image */
  nextImage?: boolean;
  fetchPriority?: string;
  /** nearest React component that renders this image, e.g. "MovieCard" */
  owner?: string;
}

export interface ScriptCoverage {
  url: string;
  total: number;
  used: number;
}

export interface RouteSnapshot {
  route: string;
  url: string;
  vitals: { lcp: number; cls: number; longTasks: number; tbt: number };
  network: { url: string; type: string; bytes: number }[];
  scripts: ScriptCoverage[];
  tree: ComponentNode[];
  lists: ListCandidate[];
  images: ImageInfo[];
  domTotal: number;
}

export type Severity = 'high' | 'medium' | 'low';

/** One concrete action the developer has to take. */
export interface Step {
  kind: 'remove' | 'add' | 'replace' | 'check';
  text: string;
}

export interface Finding {
  /** rule id, also used to group instances in the report (e.g. "img-lazy") */
  id: string;
  /** short human title shown in the report */
  title: string;
  severity: Severity;
  route: string;
  /** where it is: <Component> › selector */
  where: string;
  /** why it is a problem, with the measured numbers */
  why: string;
  /** one-line recommendation (used for the group header and Markdown export) */
  fix: string;
  /** which metric this affects: LCP, CLS, TBT, Network, Memory, Render */
  impact?: string;
  /** what was found in the page (usually the rendered HTML) */
  evidence?: string;
  /** the asset involved (image URL, script file) */
  asset?: string;
  /** code as it probably is now */
  before?: string;
  /** code as it should be */
  after?: string;
  /** exactly what to remove / add / replace */
  steps?: Step[];
}

export type Rule = (s: RouteSnapshot) => Finding[];
