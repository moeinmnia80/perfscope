import { HOST_ID, kb, ms } from "../collect/dom";
import { measureImage, optimizeImage } from "../collect/images";
import type { Scope } from "../scope";
import { loadOpen, saveOpen, saveSettings } from "../settings";
import type { Category, Corner, Finding, Report, Settings } from "../types";
import { Shader } from "./shader";
import { css } from "./styles";

type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids) if (c) el.append(c);
  return el;
};

const svg = (d: string) => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 16 16");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", d);
  s.append(p);
  return s;
};
const ICON = {
  refresh: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3",
  gear: "M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1",
  close: "M3.5 3.5l9 9M12.5 3.5l-9 9",
  copy: "M5.5 5.5h7v7h-7zM3.5 10.5v-7h7",
};

type TabId = "overview" | "images" | "layout" | "fonts" | "a11y" | "components" | "best" | "settings";
const TABS: { id: TabId; label: string; cats?: Category[] }[] = [
  { id: "overview", label: "Overview" },
  { id: "images", label: "Images", cats: ["images"] },
  { id: "layout", label: "Layout", cats: ["layout", "paint"] },
  { id: "fonts", label: "Fonts", cats: ["fonts"] },
  { id: "a11y", label: "A11y", cats: ["a11y"] },
  { id: "components", label: "Components", cats: ["components"] },
  { id: "best", label: "Practice", cats: ["best"] },
  { id: "settings", label: "Settings" },
];
const SEV_COLOR = { high: "var(--high)", medium: "var(--med)", low: "var(--low)" } as const;

const metricTone = (v: number | undefined, good: number, bad: number): "good" | "warn" | "bad" | "" => (v === undefined ? "" : v <= good ? "good" : v <= bad ? "warn" : "bad");

export class Overlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private ps!: HTMLElement;
  private body!: HTMLElement;
  private tabsEl!: HTMLElement;
  private ind!: HTMLElement;
  private headEl!: HTMLElement;
  private launch!: HTMLButtonElement;
  private badge!: HTMLElement;
  private refreshBtn!: HTMLButtonElement;
  private hlLayer!: HTMLElement;
  private shader!: Shader;
  private tab: TabId = "overview";
  private openIds = new Set<string>();
  private open = false;
  private report?: Report;
  private scanning = false;
  private unsub?: () => void;
  private hlRaf = 0;
  private hlTargets: { el: Element; label: string }[] = [];
  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.open) this.setOpen(false);
    if (e.altKey && e.shiftKey && e.code === "KeyP") this.setOpen(!this.open);
  };

  constructor(private scope: Scope) {
    this.host = document.getElementById(HOST_ID) ?? h("div", { id: HOST_ID });
    this.host.setAttribute("data-perfscope", "");
    this.root = this.host.shadowRoot ?? this.host.attachShadow({ mode: "open" });
    this.root.replaceChildren();
    this.build();
    document.documentElement.append(this.host);
    this.open = loadOpen(scope.settings.startOpen);
    this.apply();
    this.unsub = scope.subscribe((r, s) => { this.report = r; this.scanning = s; this.update(); });
    addEventListener("keydown", this.onKey);
    this.update();
    if (this.open) queueMicrotask(() => this.setOpen(true, true));
  }

  destroy() {
    this.unsub?.();
    removeEventListener("keydown", this.onKey);
    this.shader.destroy();
    this.host.remove();
  }

  /* ---------------------------------------------------------------- structure */
  private build() {
    const style = h("style");
    style.textContent = css;

    this.badge = h("span", { class: "badge", "data-sev": "busy" }, "…");
    this.launch = h("button", { class: "launch", type: "button", "aria-label": "Open perfscope", "aria-expanded": false, onclick: () => this.setOpen(true) },
      h("span", { class: "bars" }, h("i"), h("i"), h("i")), "scope", this.badge);

    const canvas = h("canvas", { "aria-hidden": "true" });
    this.shader = new Shader(canvas);
    this.refreshBtn = h("button", { class: "ib", type: "button", "aria-label": "Scan again", title: "Scan again", onclick: () => void this.scope.scan() });
    this.refreshBtn.append(svg(ICON.refresh));
    const gear = h("button", { class: "ib", type: "button", "aria-label": "Settings", title: "Settings", onclick: () => this.go("settings") });
    gear.append(svg(ICON.gear));
    const close = h("button", { class: "ib", type: "button", "aria-label": "Close", title: "Close (Esc)", onclick: () => this.setOpen(false) });
    close.append(svg(ICON.close));
    this.headEl = h("header", { class: "head" }, canvas,
      h("div", { class: "row" }, h("div", { class: "brand" }, h("b", {}, "■"), "perfscope"), h("div", { class: "icons" }, this.refreshBtn, gear, close)),
      h("div", { class: "score", "data-slot": "score" }), h("div", { class: "chips", "data-slot": "chips" }));

    this.tabsEl = h("nav", { class: "tabs", role: "tablist", "aria-label": "Report sections" });
    this.ind = h("span", { class: "ind" });
    this.body = h("div", { class: "body", role: "tabpanel", tabindex: 0 });
    const foot = h("div", { class: "foot", "data-slot": "foot" });
    const panel = h("section", { class: "panel", role: "dialog", "aria-label": "perfscope report" }, this.headEl, this.tabsEl, this.body, foot, h("div", { class: "scan" }));
    this.hlLayer = h("div", {});
    this.ps = h("div", { class: "ps" }, this.launch, panel);
    this.root.append(style, this.ps, this.hlLayer);
    this.buildTabs();
  }

  private buildTabs() {
    this.tabsEl.replaceChildren();
    for (const t of TABS) {
      const list = this.findingsFor(t.id);
      const sev = list.some((f) => f.severity === "high") ? "high" : list.some((f) => f.severity === "medium") ? "medium" : "";
      const btn = h("button", { class: "tab", role: "tab", type: "button", "aria-selected": t.id === this.tab, "data-sev": sev, onclick: () => this.go(t.id) }, t.label, t.cats && list.length ? h("em", {}, String(list.length)) : null);
      this.tabsEl.append(btn);
    }
    this.tabsEl.append(this.ind);
    requestAnimationFrame(() => this.moveInd());
  }
  private moveInd() {
    const sel = this.tabsEl.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!sel) return;
    this.ind.style.setProperty("--x", `${sel.offsetLeft}px`);
    this.ind.style.setProperty("--w", `${sel.offsetWidth}px`);
    sel.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }

  /* ---------------------------------------------------------------- open / close */
  private cornerInset(): string {
    const c = this.scope.settings.corner;
    const lw = this.launch.offsetWidth || 74, lh = this.launch.offsetHeight || 28;
    const [v, hz] = c.split("-") as ["top" | "bottom", "left" | "right"];
    // an inset that leaves exactly the launcher's rectangle visible in that corner
    const t = v === "top" ? "0" : `calc(100% - ${lh}px)`;
    const b = v === "top" ? `calc(100% - ${lh}px)` : "0";
    const l = hz === "left" ? "0" : `calc(100% - ${lw}px)`;
    const r = hz === "left" ? `calc(100% - ${lw}px)` : "0";
    return `inset(${t} ${r} ${b} ${l})`;
  }

  setOpen(open: boolean, silent = false) {
    this.open = open;
    if (!silent) saveOpen(open);
    this.ps.setAttribute("data-open", String(open));
    this.launch.setAttribute("aria-expanded", String(open));
    if (open) {
      this.ps.style.setProperty("--from", this.cornerInset());
      this.shader.start();
      this.moveInd();
      // a fresh look at the page whenever the panel opens (cheap: sliced, idle)
      if (!this.scope.report || Date.now() - this.scope.report.at > 5000) this.scope.schedule(150);
      requestAnimationFrame(() => (this.ps.querySelector(".ib") as HTMLElement | null)?.focus({ preventScroll: true }));
    } else {
      this.shader.stop();
      this.clearHighlight();
      if (!silent) this.launch.focus({ preventScroll: true });
    }
    this.update();
  }

  private go(t: TabId) {
    this.tab = t;
    this.tabsEl.querySelectorAll<HTMLElement>(".tab").forEach((b, i) => b.setAttribute("aria-selected", String(TABS[i]!.id === t)));
    this.moveInd();
    this.renderBody();
    this.body.scrollTop = 0;
  }

  /* ---------------------------------------------------------------- settings -> DOM */
  apply() {
    const s = this.scope.settings;
    this.ps.setAttribute("data-corner", s.corner);
    this.ps.style.setProperty("--accent", s.accent);
    this.ps.classList.toggle("dense", s.dense);
    this.shader.amount = s.shader / 100;
    this.shader.setColor(s.accent);
    this.host.style.display = s.enabled ? "" : "none";
    if (this.open) this.shader.start();
    this.ps.setAttribute("data-open", String(this.open));
    this.ps.style.setProperty("--from", this.cornerInset());
  }

  private set<K extends keyof Settings>(k: K, v: Settings[K]) {
    this.scope.settings[k] = v;
    saveSettings(this.scope.settings);
    if (k === "watchMutations") this.scope.setWatch(v as boolean);
    this.apply();
    if (k === "dense" || k === "corner") this.renderBody();
  }

  /* ---------------------------------------------------------------- rendering */
  private findingsFor(t: TabId): Finding[] {
    const cats = TABS.find((x) => x.id === t)?.cats;
    return cats && this.report ? this.report.findings.filter((f) => cats.includes(f.category)) : [];
  }

  private update() {
    const r = this.report;
    const high = r?.findings.filter((f) => f.severity === "high").length ?? 0;
    const med = r?.findings.filter((f) => f.severity === "medium").length ?? 0;
    this.launch.setAttribute("data-scanning", String(this.scanning));
    this.refreshBtn.setAttribute("data-spin", String(this.scanning));
    if (!r) { this.badge.textContent = "…"; this.badge.setAttribute("data-sev", "busy"); }
    else if (high) { this.badge.textContent = String(high); this.badge.setAttribute("data-sev", "high"); }
    else if (med) { this.badge.textContent = String(med); this.badge.setAttribute("data-sev", "medium"); }
    else { this.badge.textContent = "✓"; this.badge.setAttribute("data-sev", "ok"); }
    this.launch.setAttribute("aria-label", r ? `Open perfscope: ${high} serious, ${med} medium issues` : "Open perfscope");
    if (!this.open) return;
    this.renderHead();
    this.buildTabs();
    this.renderBody();
    this.renderFoot();
  }

  private renderHead() {
    const v = this.report?.vitals;
    const score = this.headEl.querySelector('[data-slot="score"]')!;
    const chips = this.headEl.querySelector('[data-slot="chips"]')!;
    score.replaceChildren(
      h("span", { class: "n", style: `color:${v?.score === undefined ? "var(--dim)" : v.score >= 90 ? "var(--ok)" : v.score >= 50 ? "var(--med)" : "var(--high)"}` }, v?.score === undefined ? "–" : String(v.score)),
      h("span", { class: "l" }, v?.score === undefined ? (this.scanning ? "scanning…" : "no data yet") : "web vitals score"),
    );
    const chip = (label: string, val: string, tone: string) => h("div", { class: "chip", "data-t": tone }, h("small", {}, label), h("span", {}, val));
    chips.replaceChildren(
      chip("LCP", v?.lcp ? ms(v.lcp.ms) : "–", metricTone(v?.lcp?.ms, 2500, 4000)),
      chip("CLS", v ? v.cls.toFixed(3) : "–", metricTone(v?.cls, 0.1, 0.25)),
      chip("INP", v?.inp !== undefined ? ms(v.inp) : "–", metricTone(v?.inp, 200, 500)),
      chip("Long tasks", v ? String(v.longTasks) : "–", v ? (v.longTasks > 8 ? "bad" : v.longTasks > 2 ? "warn" : "good") : ""),
    );
  }

  private renderFoot() {
    const foot = this.ps.querySelector('[data-slot="foot"]')!;
    const r = this.report;
    foot.replaceChildren(
      h("span", {}, r ? `${r.url} · scanned in ${ms(r.selfMs)}` : "waiting for the page to settle"),
      h("span", {}, r ? `engine: ${r.engine === "wasm" ? "Rust/WASM" : "JS"}` : ""),
    );
  }

  private renderBody() {
    this.clearHighlight();
    const body = this.body;
    body.className = "body" + (this.scope.settings.dense ? " dense" : "");
    body.replaceChildren();
    if (this.tab === "settings") return body.append(this.settingsView());
    if (!this.report) return body.append(h("div", { class: "empty" }, this.scanning ? "Scanning the page…" : "Waiting for the page to finish loading."));
    if (this.tab === "overview") return body.append(...this.overviewView());
    if (this.tab === "components") return body.append(...this.componentsView());
    const list = this.findingsFor(this.tab);
    if (!list.length) return body.append(h("div", { class: "empty" }, h("b", {}, "Nothing to fix here."), this.emptyHint()));
    list.forEach((f, i) => body.append(this.item(f, i)));
  }

  private emptyHint() {
    const r = this.report!;
    const s = r.stats;
    return { images: `${s.images} image use(s) checked.`, fonts: `${s.fonts} font file(s) checked.`, layout: "Layout shifts, forced reflow, animations and repaint cost checked.", a11y: "Names, labels, contrast, targets, headings, landmarks checked.", best: `${s.nodes.toLocaleString()} DOM nodes, depth ${s.depth}.` }[this.tab as string] ?? "";
  }

  private overviewView(): Node[] {
    const r = this.report!;
    const out: Node[] = [];
    const top = r.findings.slice(0, 3);
    if (!top.length) out.push(h("div", { class: "empty" }, h("b", {}, "Clean."), `${r.stats.nodes.toLocaleString()} nodes · ${r.stats.images} images · ${r.stats.fonts} fonts checked.`));
    else {
      out.push(h("div", { class: "note" }, `${r.findings.length} finding${r.findings.length > 1 ? "s" : ""}. Fix these first:`));
      top.forEach((f, i) => out.push(this.item(f, i)));
      const rest = r.findings.length - top.length;
      if (rest > 0) out.push(h("div", { class: "note" }, `+ ${rest} more in the tabs above.`));
    }
    if (r.reactTiming === "snapshot") out.push(h("div", { class: "note" }, "React was loaded before perfscope: component costs are estimates from the last render. Import perfscope first (or use ‹Perfscope /› at the very top) for live counts."));
    return out;
  }

  private componentsView(): Node[] {
    const r = this.report!;
    const out: Node[] = [];
    if (r.reactTiming === "no-react") return [h("div", { class: "empty" }, h("b", {}, "No React on this page."), "Component timing reads React's own render measurements.")];
    const findings = this.findingsFor("components");
    if (r.reactTiming === "unavailable") out.push(h("div", { class: "note" }, "Durations are unavailable: use the development server (React measures render time only in development/profiling builds)."));
    if (r.reactTiming === "snapshot") out.push(h("div", { class: "note warn" }, "Snapshot mode: estimates from the last render, no counts. Load perfscope before React for live numbers."));
    const rows = r.components.slice(0, 14);
    if (rows.length) {
      const max = Math.max(...rows.map((c) => c.totalMs), 0.001);
      const table = h("table", { class: "comp" }, h("thead", {}, h("tr", {}, ...["Component", "Total", "Renders", "Worst", "Idle"].map((x) => h("th", {}, x)))));
      const tb = h("tbody");
      for (const c of rows) {
        const tr = h("tr", { tabindex: 0 },
          h("td", { title: `<${c.name}>` }, `<${c.name}>`, h("span", { class: "bar", style: `width:${Math.max(2, (c.totalMs / max) * 100)}%` })),
          h("td", {}, ms(c.totalMs)), h("td", {}, String(c.renders)), h("td", {}, ms(c.maxMs)),
          h("td", { class: c.wasted > c.renders * 0.5 && c.renders > 2 ? "warn" : "" }, c.renders > 1 ? `${Math.round((c.wasted / c.renders) * 100)}%` : "–"));
        const el = c.element?.deref();
        if (el) { tr.addEventListener("mouseenter", () => this.highlight([{ el, label: `<${c.name}>` }])); tr.addEventListener("mouseleave", () => this.clearHighlight()); }
        tb.append(tr);
      }
      table.append(tb);
      out.push(h("div", { class: "note" }, "Slowest components by self time. “Idle” = share of renders where nothing the component owns changed."), table);
    } else if (r.reactTiming !== "unavailable") out.push(h("div", { class: "empty" }, "No component renders measured yet. Interact with the page and scan again."));
    findings.forEach((f, i) => out.push(this.item(f, i)));
    return out;
  }

  private item(f: Finding, i: number): HTMLElement {
    const open = this.openIds.has(f.id);
    const box = h("div", { class: "item", "data-sev": f.severity, "data-open": open, style: `--i:${Math.min(i, 12)}` });
    const top = h("button", { class: "top", type: "button", "aria-expanded": open, onclick: () => {
      const now = box.getAttribute("data-open") !== "true";
      box.setAttribute("data-open", String(now));
      top.setAttribute("aria-expanded", String(now));
      now ? this.openIds.add(f.id) : this.openIds.delete(f.id);
    } }, h("div", { class: "short" }, f.short), h("div", { class: "where" }, f.where));
    const detail = h("div", { class: "detail" });
    if (f.image) detail.append(this.imageBlock(f));
    if (f.facts.length) { const dl = h("dl", { class: "facts" }); for (const [k, v] of f.facts) dl.append(h("dt", {}, k), h("dd", {}, v)); detail.append(dl); }
    detail.append(h("p", { class: "fix" }, f.fix));
    if (f.before) detail.append(this.code(f.before, "before"));
    if (f.after) detail.append(this.code(f.after, "after"));
    const els = (f.elements ?? []).map((w) => w.deref()).filter((e): e is Element => !!e && e.isConnected);
    if (els.length) detail.append(h("div", { class: "acts" }, h("button", { class: "btn", type: "button", onclick: () => { els[0]!.scrollIntoView({ block: "center", behavior: "smooth" }); this.highlight(els.slice(0, 6).map((el) => ({ el, label: f.where.split(" › ").pop() ?? "" }))); setTimeout(() => this.clearHighlight(), 2400); } }, "Locate on page")));
    box.append(top, detail);
    if (els.length) {
      box.addEventListener("mouseenter", () => this.scope.settings.highlight && this.highlight(els.slice(0, 6).map((el) => ({ el, label: f.where.split(" › ").pop() ?? "" }))));
      box.addEventListener("mouseleave", () => this.clearHighlight());
    }
    return box;
  }

  private code(text: string, kind: "before" | "after") {
    const pre = h("pre", { class: "code", "data-k": kind }, text);
    const b = h("button", { class: "copy", type: "button", "aria-label": "Copy", onclick: async () => { try { await navigator.clipboard.writeText(text); b.textContent = "copied"; setTimeout(() => (b.textContent = "copy"), 1200); } catch { /* clipboard blocked */ } } }, "copy");
    pre.append(b);
    return pre;
  }

  private imageBlock(f: Finding): HTMLElement {
    const im = f.image!;
    const wrap = h("div", {});
    const thumb = h("img", { src: im.src, alt: "", loading: "lazy", decoding: "async" });
    const info = h("div", {}, h("div", {}, `${im.naturalW}×${im.naturalH} → ${im.targetW}×${im.targetH}`), h("div", { style: "color:var(--dim)" }, im.bytes ? `${kb(im.bytes)} → ≈ ${kb(im.estBytes)}` : "size unknown (cross-origin)"));
    wrap.append(h("div", { class: "thumb" }, thumb, info));
    if (im.usages.length) { const ul = h("ul", { class: "uses" }); im.usages.slice(0, 6).forEach((u) => ul.append(h("li", {}, `${u.owner ? `<${u.owner}> › ` : ""}${u.selector} · ${u.w}×${u.h}px`))); wrap.append(ul); }
    const status = h("div", { style: "color:var(--dim);margin-top:6px;font-size:11px" });
    const dl = (blob: Blob, name: string) => { const a = h("a", { href: URL.createObjectURL(blob), download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
    const base = (im.src.split("?")[0]!.split("/").pop() || "image").replace(/\.\w+$/, "");
    const orig = h("button", { class: "btn", type: "button", onclick: async () => { orig.setAttribute("disabled", ""); const m = await measureImage(im.src); const r = await fetch(im.src, { cache: "force-cache" }).catch(() => null); if (r) { const b = await r.blob(); dl(b, im.src.split("?")[0]!.split("/").pop() || "image"); status.textContent = `Original: ${kb(m?.bytes ?? b.size)} (${b.type || "unknown type"}).`; } else status.textContent = "Cross-origin: the browser blocked the download. Open the URL directly."; orig.removeAttribute("disabled"); } }, "Download original");
    const opt = h("button", { class: "btn", type: "button", "data-solid": true, onclick: async () => {
      opt.setAttribute("disabled", ""); status.textContent = "Re-encoding in the browser…";
      const res = await optimizeImage(im.src, im.targetW, "image/webp", 0.8);
      if ("error" in res) status.textContent = res.error;
      else { dl(res.blob, `${base}-${res.w}.webp`); status.textContent = `${res.w}×${res.h} WebP: ${kb(res.blob.size)}${im.bytes ? ` (was ${kb(im.bytes)}, −${Math.max(0, Math.round((1 - res.blob.size / im.bytes) * 100))}%)` : ""}.`; }
      opt.removeAttribute("disabled");
    } }, `Download ${im.targetW}px WebP`);
    wrap.append(h("div", { class: "acts" }, opt, orig), status);
    return wrap;
  }

  private settingsView(): HTMLElement {
    const s = this.scope.settings;
    const root = h("div", { class: "set" });
    const toggle = (label: string, hint: string, key: "enabled" | "startOpen" | "watchMutations" | "highlight" | "dense") => {
      const b = h("button", { type: "button", "aria-pressed": s[key], "aria-label": label, onclick: () => { this.set(key, !s[key] as never); b.setAttribute("aria-pressed", String(s[key])); } });
      return h("div", { class: "tog" }, h("div", {}, h("div", {}, label), h("div", { style: "color:var(--dim);font-size:11px" }, hint)), b);
    };
    root.append(toggle("Show the launcher", "Turn perfscope's rectangle off without uninstalling.", "enabled"));
    root.append(toggle("Open on load", "Start with the panel open.", "startOpen"));

    const corners: Corner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Corner" });
    for (const c of corners) { const b = h("button", { type: "button", "aria-pressed": s.corner === c, onclick: () => { this.set("corner", c); seg.querySelectorAll("button").forEach((x, i) => x.setAttribute("aria-pressed", String(corners[i] === c))); } }, c.replace("-", " ")); seg.append(b); }
    root.append(h("div", { class: "f" }, h("div", { class: "t" }, "Corner"), seg));

    const sw = h("div", { class: "sw", role: "group", "aria-label": "Accent color" });
    const colors = ["#ff5d57", "#ffc247", "#4fd8c4", "#6ea8ff", "#c792ff", "#f4f0e6"];
    const pick = h("input", { type: "color", value: s.accent, "aria-label": "Custom color", style: "width:24px;height:24px;border:0;padding:0;background:none", oninput: (e) => { this.set("accent", (e.target as HTMLInputElement).value); sw.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false")); } });
    for (const c of colors) { const b = h("button", { type: "button", "aria-label": c, style: `--c:${c}`, "aria-pressed": s.accent.toLowerCase() === c, onclick: () => { this.set("accent", c); (pick as HTMLInputElement).value = c; sw.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); } }); sw.append(b); }
    sw.append(pick);
    root.append(h("div", { class: "f" }, h("div", { class: "t" }, "Accent"), sw));

    const val = h("span", {}, s.shader === 0 ? "off" : `${s.shader}%`);
    const range = h("input", { type: "range", min: 0, max: 100, step: 5, value: s.shader, "aria-label": "Shader strength", oninput: (e) => { const v = +(e.target as HTMLInputElement).value; val.textContent = v === 0 ? "off" : `${v}%`; this.set("shader", v); } });
    root.append(h("label", { class: "f" }, h("div", { class: "t" }, "Header shader", val), range, h("div", { style: "color:var(--dim);font-size:11px" }, "0 turns the shader off completely: nothing is drawn.")));

    root.append(toggle("Compact rows", "Tighter finding list.", "dense"));
    root.append(toggle("Highlight on hover", "Outline the element on the page while you hover a finding.", "highlight"));
    root.append(toggle("Watch style/class changes", "Finds elements driven by JavaScript every frame. Light, but you can switch it off.", "watchMutations"));
    root.append(h("div", { style: "color:var(--dim);font-size:11px" }, "Shortcut: Alt + Shift + P. perfscope runs only in development and never inside your production bundle."));
    return root;
  }

  /* ---------------------------------------------------------------- highlight */
  private highlight(targets: { el: Element; label: string }[]) {
    this.hlTargets = targets;
    if (!this.hlRaf) this.hlRaf = requestAnimationFrame(this.drawHl);
  }
  private drawHl = () => {
    this.hlRaf = 0;
    if (!this.hlTargets.length) return;
    const boxes = this.hlTargets.filter((t) => t.el.isConnected).map((t) => {
      const r = t.el.getBoundingClientRect();
      return h("div", { class: "hl", style: `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px` }, h("i", {}, t.label));
    });
    this.hlLayer.replaceChildren(...boxes);
    this.hlRaf = requestAnimationFrame(this.drawHl); // follows scroll; stops as soon as the pointer leaves
  };
  private clearHighlight() {
    this.hlTargets = [];
    cancelAnimationFrame(this.hlRaf);
    this.hlRaf = 0;
    this.hlLayer.replaceChildren();
  }
}

export { SEV_COLOR };
