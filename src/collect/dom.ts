/** Small DOM helpers shared by the collectors. */

export const HOST_ID = "perfscope-root";

/** true for nodes that belong to perfscope's own overlay: they are never audited */
export const isOwn = (el: Element | null) => !!el && (el.id === HOST_ID || !!el.closest?.(`#${HOST_ID}`));

const esc = (s: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, "\\$&"));

/** A short selector a developer can search for: `img.hero`, `#logo`, `main > section.cards > li:nth-of-type(3)` (max 3 levels). */
export const selectorOf = (el: Element): string => {
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let depth = 0; cur && cur.nodeType === 1 && depth < 3; depth++) {
    if (cur.id && !/\d{4,}/.test(cur.id)) {
      parts.unshift(`#${esc(cur.id)}`);
      break;
    }
    let part = cur.tagName.toLowerCase();
    const cls = [...cur.classList].filter((c) => c.length < 24 && !/^(?:css|jsx|sc|_|svelte)-?[\w-]*\d/.test(c)).slice(0, 2);
    if (cls.length) part += "." + cls.map(esc).join(".");
    const parent: Element | null = cur.parentElement;
    if (parent && !cls.length && parent.querySelectorAll(`:scope > ${cur.tagName.toLowerCase()}`).length > 1) {
      part += `:nth-of-type(${[...parent.children].filter((c) => c.tagName === cur!.tagName).indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    cur = parent;
    if (cur === document.body || cur === document.documentElement) break;
  }
  return parts.join(" > ");
};

/** `https://cdn.x.com/a/b/hero.jpg?w=100` -> `hero.jpg` */
export const fileName = (url: string) => {
  try {
    const u = new URL(url, location.href);
    if (u.protocol === "data:") return "inline image";
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? u.hostname);
    return last.length > 42 ? last.slice(0, 39) + "..." : last;
  } catch {
    return url.slice(0, 40);
  }
};

export const kb = (bytes: number) =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${Math.round(bytes)} B`;

export const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`);

/** Run `work` in slices of `budgetMs`, yielding to the browser between slices, so a scan never blocks input. */
export const chunked = async <T,>(items: readonly T[], work: (item: T, i: number) => void, budgetMs = 6) => {
  let start = performance.now();
  for (let i = 0; i < items.length; i++) {
    work(items[i]!, i);
    if (performance.now() - start > budgetMs) {
      await yieldToMain();
      start = performance.now();
    }
  }
};

export const yieldToMain = (): Promise<void> =>
  new Promise((resolve) => {
    const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (s?.yield) void s.yield().then(resolve);
    else if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: 80 });
    else setTimeout(resolve, 0);
  });

/** stable small integer id for a node (for the churn counter), without keeping the node alive */
const ids = new WeakMap<Node, number>();
let nextId = 1;
export const nodeId = (n: Node) => ids.get(n) ?? (ids.set(n, nextId), nextId++);
