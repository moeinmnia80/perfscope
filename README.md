# @moeinmnia/perfscope

Per-route React component graph + a specialist performance audit, with a Lighthouse-style HTML report.

For every problem the report shows **where** it is, **what was measured**, the code **before** and **after**, and exactly what to **remove / add / replace**.

## Quick start
```bash
npx playwright install chromium
npx @moeinmnia/perfscope https://your-site.com
# open perfscope-report/report.html
```

## Options
| flag | description |
|---|---|
| `--out <dir>` | output dir (default `perfscope-report`) |
| `--limit <n>` | max routes to analyze (default 12) |
| `--desktop` | desktop viewport (default: mobile) |
| `--no-throttle` | skip Slow 4G + 4x CPU simulation (default: throttled, like Lighthouse mobile) |
| `--pdf` | also export PDF |
| `--fail-on <sev>` | exit 1 when findings >= severity (for CI) |

## What it checks
- **Images**: real LCP element, size vs. what the screen needs (devicePixelRatio aware), `sizes`/`srcset`, lazy-loading, format (WebP/AVIF), layout shift. Gives CDN-specific fixes (TMDB size ladder, Cloudinary, Unsplash/imgix, `next/image`).
- **Re-renders**: counted per component instance, with the *cause*: parent only, changed props (which ones), own state, external store, or context. The fix matches the cause.
- **Loading**: JS budget, unused JS/CSS, compression, render-blocking scripts, third-party scripts, fonts, cache headers, preconnect to the image host, TTFB, FCP, TBT, CLS, DOM size.

## Readable component names
Production builds minify names (`fp`, `a`). perfscope detects this and describes such components by the HTML element they render. For real names build once with:
```bash
next build --no-mangling
```

## Limitations
- Only client components appear in the Fiber tree (Server Components render no Fiber).
- Per-component bundle size is not measured (route and chunk level only).
- The score is an estimate from FCP, LCP, TBT and CLS; use Lighthouse / PageSpeed Insights for the official number.

## Contributing
Rules are pure functions in `src/rules`: `(RouteSnapshot) => Finding[]`. Add a rule, add a test.

## License
MIT
