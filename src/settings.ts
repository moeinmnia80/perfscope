import { defaultSettings, type Settings } from "./types";

const KEY = "perfscope:settings:v1";

export const loadSettings = (override: Partial<Settings> = {}): Settings => {
  let saved: Partial<Settings> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
  } catch {
    /* private mode / blocked storage: defaults */
  }
  const s = { ...defaultSettings, ...override, ...saved };
  s.shader = Math.min(Math.max(Number(s.shader) || 0, 0), 100);
  if (!/^#[0-9a-f]{6}$/i.test(s.accent)) s.accent = defaultSettings.accent;
  return s;
};

export const saveSettings = (s: Settings) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
};

const OPEN = "perfscope:open";
export const loadOpen = (fallback: boolean) => {
  try {
    const v = sessionStorage.getItem(OPEN);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
};
export const saveOpen = (open: boolean) => {
  try {
    sessionStorage.setItem(OPEN, open ? "1" : "0");
  } catch {
    /* ignore */
  }
};
