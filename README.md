# perfscope

Per-route React component graph + automatic performance findings, with a modern HTML report.

## Quick start
```bash
npx playwright install chromium
npx perfscope https://your-site.com
# open perfscope-report/report.html
```

## Options
| flag | description |
|---|---|
| `--out <dir>` | output dir (default `perfscope-report`) |
| `--limit <n>` | max routes to analyze (default 12) |
| `--desktop` | desktop viewport (default: mobile) |
| `--pdf` | also export PDF |
| `--fail-on <sev>` | exit 1 when findings >= severity (for CI) |

## Readable component names
Production builds minify names. For a readable graph, build once with:
```bash
next build --no-mangling
```

## Limitations
- Only client components appear in the Fiber tree (Server Components render no Fiber).
- Per-component bundle size is not measured (route and chunk level only).
- Render counts are aggregated by component name.

## Contributing
Rules are pure functions in `src/rules`: `(RouteSnapshot) => Finding[]`. Add a rule, add a test.

## License
MIT
