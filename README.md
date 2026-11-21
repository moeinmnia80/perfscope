# @moeinmnia/perfscope

A small rectangle on your page that audits what you are building. Development only.

Open it and it tells you, in one line each: which image to resize (and to what width), which LCP image
needs priority, what causes layout shift and forced reflow, which animation repaints every frame, which
font is too heavy, what is not accessible, and which React components cost the most.

The number crunching is a **Rust core compiled to WebAssembly** (embedded, nothing to configure). A
JavaScript twin with identical results takes over if WebAssembly is blocked.

## Setup

```bash
npx @moeinmnia/perfscope init      # Next.js (App Router) or Vite: edits the right file, idempotent
```

or by hand, as the **first import** of your client entry (so React timings are live):

```ts
import "@moeinmnia/perfscope/auto";
```

```tsx
// or as a component
import { Perfscope } from "@moeinmnia/perfscope/react";
<Perfscope corner="bottom-left" accent="#ffc247" />;
```

In a production build it does nothing (pass `force: true` to override). Toggle the panel: **Alt + Shift + P**.

## What it measures

| Area | How |
| --- | --- |
| Images | The largest use of a file is the reference (x pixel ratio, capped at 2x). Exact bytes from resource timing, or by downloading the image. Resize target, format, LCP priority, lazy, missing size. "Download WebP" re-encodes it at the target size in the browser. |
| Layout shift | `layout-shift` entries grouped per element, with the right fix per element type. |
| Forced reflow | Long Animation Frames: function + file + milliseconds (Chromium). |
| Repaint / reflow cost | Running animations of layout/paint properties (Web Animations), JS-driven style/class churn, large blur areas, `transition: all`, permanent `will-change`. |
| Fonts | Size, format, `font-display`, preload, font-swap text reflow, unused faces. |
| Accessibility | Alt, names, labels, contrast (Rust), tap targets, headings, landmarks, `lang`, zoom. |
| Practice | DOM size/depth, render-blocking, big scripts, compression, third-party origins. |
| Components | React's own `actualDuration` per commit: self time, renders, worst, and whether a render happened only because the parent did. Ranked by the Rust core. |

What it cannot know is said in the docs: the browser exposes no repaint counter, cross-origin resources hide
sizes, React timings exist only in development builds, and the score covers LCP/CLS/INP only.

## Staying fast

Passive observers, scans in 6 ms slices that yield to input (never while hidden, never overlapping), a
sampled and self-throttling React hook, and a header shader that draws only while the panel is open (half
resolution, 30 fps, strength 0 = nothing drawn). Every scan reports its own cost in the panel footer.

## Options

`corner`, `accent`, `shader` (0-100), `startOpen`, `watchMutations`, `highlight`, `dense`, `enabled`, `force`,
`onReport`. All except the last three are also in the panel's Settings tab and are remembered.

```ts
import { init } from "@moeinmnia/perfscope";
const scope = init();
await scope.scan();
scope.report()?.findings;
```

## Develop

```bash
npm i
npm run test:rust   # Rust unit tests
npm test            # engine (wasm vs JS) + DOM audits
npm run build       # compiles rust/ to wasm (needs cargo + wasm32-unknown-unknown), then bundles
```

If Rust is not installed, `npm run build` keeps the committed `src/engine/wasm.gen.ts`.

MIT
