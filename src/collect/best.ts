import type { Finding } from "../types";
import { fileName, kb, selectorOf } from "./dom";
import { domStats } from "./layout";

type Res = PerformanceResourceTiming & { renderBlockingStatus?: string };

export function scanBest(): Finding[] {
  const out: Finding[] = [];
  const push = (f: Omit<Finding, "category">) => out.push({ category: "best", ...f });
  const res = performance.getEntriesByType("resource") as Res[];
  const here = location.origin;

  // DOM size
  const d = domStats();
  if (d.nodes > 1500) push({ id: "dom-size", severity: d.nodes > 3000 ? "high" : "medium", short: `${d.nodes.toLocaleString()} DOM nodes (depth ${d.depth}): every style recalculation and layout scales with this. Virtualize long lists, lazy-mount hidden UI.`, where: "document", facts: [["nodes", String(d.nodes)], ["max depth", String(d.depth)], ["widest parent", String(d.widest)]], fix: "Aim under ~1,500. Render only what is visible (virtual lists), mount tabs/modals on demand, and use `content-visibility: auto` on long sections." });
  if (d.widest > 120 && d.widestEl) push({ id: "dom-wide", severity: "medium", elements: [new WeakRef(d.widestEl)], short: `${selectorOf(d.widestEl)} has ${d.widest} direct children: virtualize it or add content-visibility: auto.`, where: selectorOf(d.widestEl), facts: [["children", String(d.widest)]], fix: "Large flat lists make every layout expensive.", after: `.item { content-visibility: auto; contain-intrinsic-size: auto 80px; }` });
  if (d.depth > 32) push({ id: "dom-deep", severity: "low", short: `DOM is ${d.depth} levels deep: wrapper-div chains slow style matching. Flatten.`, where: "document", facts: [["depth", String(d.depth)]], fix: "Remove wrappers that only exist for layout (use gap / grid / fragments)." });

  // render-blocking
  const blocking = res.filter((r) => r.renderBlockingStatus === "blocking" && r.responseEnd > 0);
  if (blocking.length > 2) push({ id: "render-blocking", severity: blocking.length > 5 ? "high" : "medium", short: `${blocking.length} render-blocking resources (${blocking.slice(0, 2).map((b) => fileName(b.name)).join(", ")}…): inline critical CSS, defer scripts.`, where: "<head>", facts: blocking.slice(0, 5).map((b) => [fileName(b.name), `${Math.round(b.responseEnd)} ms`] as [string, string]), fix: "Add `defer`/`async` to scripts, and keep only critical CSS render-blocking." });

  // scripts weight
  const js = res.filter((r) => r.initiatorType === "script" || /\.m?js(\?|$)/.test(r.name));
  const jsBytes = js.reduce((a, r) => a + (r.encodedBodySize || r.transferSize || 0), 0);
  const bigJs = js.filter((r) => (r.encodedBodySize || 0) > 150_000).sort((a, b) => b.encodedBodySize - a.encodedBodySize);
  if (bigJs.length) push({ id: "js-big", severity: bigJs[0]!.encodedBodySize > 400_000 ? "high" : "medium", short: `${fileName(bigJs[0]!.name)} is ${kb(bigJs[0]!.encodedBodySize)} compressed: split it (dynamic import) or drop a heavy dependency.`, where: fileName(bigJs[0]!.name), facts: [["largest script", kb(bigJs[0]!.encodedBodySize)], ["all JS", kb(jsBytes)], ["scripts", String(js.length)]], fix: "Load route-specific and below-the-fold code with `import()`; check the bundle analyzer for the biggest packages." });
  const thirdParty = new Set(res.map((r) => { try { return new URL(r.name).origin; } catch { return here; } }).filter((o) => o !== here));
  if (thirdParty.size > 6) push({ id: "third-party", severity: "low", short: `${thirdParty.size} third-party origins: each costs a DNS/TLS handshake. Self-host or preconnect the ones that matter.`, where: "network", facts: [["origins", [...thirdParty].slice(0, 4).map((o) => new URL(o).host).join(", ")]], fix: "Remove what you do not need; add `<link rel=preconnect>` for critical ones." });

  // compression
  const raw = res.filter((r) => /\.(m?js|css|json|svg|html)(\?|$)/.test(r.name) && r.decodedBodySize > 20_000 && r.encodedBodySize > 0 && r.encodedBodySize >= r.decodedBodySize * 0.95 && r.name.startsWith(here));
  if (raw.length) push({ id: "no-compression", severity: "medium", short: `${fileName(raw[0]!.name)} (${kb(raw[0]!.decodedBodySize)}) is sent uncompressed: enable gzip/brotli. (Dev servers often do this; check production.)`, where: fileName(raw[0]!.name), facts: [["files", String(raw.length)]], fix: "Enable Brotli on your host/CDN. Text compresses 70–85%." });

  // protocol
  const h1 = res.filter((r) => r.nextHopProtocol === "http/1.1" && r.name.startsWith(here));
  if (h1.length > 20 && location.hostname !== "localhost") push({ id: "http1", severity: "low", short: `${h1.length} requests over HTTP/1.1: serve over HTTP/2 or 3.`, where: "network", facts: [["requests", String(h1.length)]], fix: "HTTP/2 multiplexes requests on one connection." });

  // document basics
  if (document.compatMode === "BackCompat") push({ id: "quirks", severity: "high", short: "The page renders in quirks mode: add <!DOCTYPE html>.", where: "document", facts: [], fix: "Quirks mode changes box sizing and layout in surprising ways." });
  if (!document.querySelector('meta[name="viewport"]')) push({ id: "no-viewport", severity: "high", short: 'No <meta name="viewport">: mobile browsers will render a desktop-width page.', where: "<head>", facts: [], fix: "Add the viewport tag.", after: `<meta name="viewport" content="width=device-width, initial-scale=1">` });
  if (location.protocol === "https:") {
    const mixed = res.filter((r) => r.name.startsWith("http://"));
    if (mixed.length) push({ id: "mixed", severity: "high", short: `${mixed.length} resource(s) load over http on an https page (${fileName(mixed[0]!.name)}).`, where: fileName(mixed[0]!.name), facts: [], fix: "Use https URLs." });
  }
  return out;
}
