type Severity = "high" | "medium" | "low";
type Category = "images" | "layout" | "paint" | "fonts" | "a11y" | "best" | "components";
interface Finding {
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
interface ImageFinding {
    src: string;
    naturalW: number;
    naturalH: number;
    targetW: number;
    targetH: number;
    bytes: number;
    estBytes: number;
    format: string;
    usages: {
        selector: string;
        owner?: string;
        w: number;
        h: number;
    }[];
}
interface Vitals {
    lcp?: {
        ms: number;
        selector?: string;
        url?: string;
        size: number;
    };
    cls: number;
    inp?: number;
    fcp?: number;
    longTasks: number;
    score?: number;
}
interface ComponentStat {
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
interface Report {
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
    stats: {
        nodes: number;
        depth: number;
        images: number;
        fonts: number;
    };
}
type Corner = "bottom-right" | "bottom-left" | "top-right" | "top-left";
interface Settings {
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
declare const defaultSettings: Settings;

interface PerfscopeOptions extends Partial<Settings> {
    /** run even when NODE_ENV is "production" (default: development only) */
    force?: boolean;
    /** called after every scan */
    onReport?: (report: Report) => void;
}
interface PerfscopeHandle {
    /** scan now; resolves with the report */
    scan(): Promise<Report | undefined>;
    open(): void;
    close(): void;
    report(): Report | undefined;
    /** remove the overlay and every observer */
    destroy(): void;
}
/**
 * Starts perfscope. Safe to call twice (returns the running instance), a no-op on the server and in
 * production builds unless `force: true`.
 */
declare function init(options?: PerfscopeOptions): PerfscopeHandle | undefined;
declare const destroy: () => void | undefined;

export { type Category, type ComponentStat, type Finding, type PerfscopeHandle, type PerfscopeOptions, type Report, type Settings, type Severity, type Vitals, init as default, defaultSettings, destroy, init };
