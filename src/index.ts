import { Scope } from "./scope";
import { loadSettings } from "./settings";
import { Overlay } from "./ui/overlay";
import type { Report, Settings } from "./types";

export type { Report, Finding, Settings, Severity, Category, ComponentStat, Vitals } from "./types";
export { defaultSettings } from "./types";

export interface PerfscopeOptions extends Partial<Settings> {
  /** run even when NODE_ENV is "production" (default: development only) */
  force?: boolean;
  /** called after every scan */
  onReport?: (report: Report) => void;
}

export interface PerfscopeHandle {
  /** scan now; resolves with the report */
  scan(): Promise<Report | undefined>;
  open(): void;
  close(): void;
  report(): Report | undefined;
  /** remove the overlay and every observer */
  destroy(): void;
}

declare const process: { env?: Record<string, string | undefined> } | undefined;

let current: PerfscopeHandle | undefined;

const isProd = () => {
  try {
    return typeof process !== "undefined" && process.env?.NODE_ENV === "production";
  } catch {
    return false;
  }
};

/**
 * Starts perfscope. Safe to call twice (returns the running instance), a no-op on the server and in
 * production builds unless `force: true`.
 */
export function init(options: PerfscopeOptions = {}): PerfscopeHandle | undefined {
  if (typeof window === "undefined" || typeof document === "undefined") return undefined;
  if (current) return current;
  if (isProd() && !options.force) return undefined;
  const { force: _f, onReport, ...rest } = options;
  void _f;
  const scope = new Scope(loadSettings(rest));
  scope.start();
  const overlay = new Overlay(scope);
  if (onReport) scope.subscribe((r, scanning) => r && !scanning && onReport(r));
  current = {
    scan: () => scope.scan(),
    open: () => overlay.setOpen(true),
    close: () => overlay.setOpen(false),
    report: () => scope.report,
    destroy: () => {
      overlay.destroy();
      scope.stop();
      current = undefined;
    },
  };
  return current;
}

export const destroy = () => current?.destroy();
export default init;
