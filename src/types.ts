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
}

export interface ImageInfo {
  src: string;
  renderedW: number;
  naturalW: number;
  lazy: boolean;
  aboveFold: boolean;
  hasSize: boolean;
  bytes: number;
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

export interface Finding {
  id: string;
  severity: Severity;
  route: string;
  where: string;
  why: string;
  fix: string;
}

export type Rule = (s: RouteSnapshot) => Finding[];
