#!/usr/bin/env node
import { chromium } from 'playwright';
import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverRoutes } from './crawl.js';
import { collectRoute } from './collect/page.js';
import { analyze } from './rules/index.js';
import { renderHtml } from './report/html.js';
import type { RouteSnapshot } from './types.js';

const HELP = `
perfscope <url> [options]

  --out <dir>       output dir (default: perfscope-report)
  --limit <n>       max routes to analyze (default: 12)
  --desktop         desktop viewport (default: mobile)
  --pdf             also export PDF
  --no-throttle     measure on your own machine speed (default: Slow 4G + 4x CPU like Lighthouse)
  --fail-on <sev>   exit 1 when a finding has this severity or higher (high|medium|low)
  -h, --help
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', default: 'perfscope-report' },
    limit: { type: 'string', default: '12' },
    desktop: { type: 'boolean', default: false },
    pdf: { type: 'boolean', default: false },
    'no-throttle': { type: 'boolean', default: false },
    'fail-on': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help || positionals.length === 0) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

let origin: string;
try {
  origin = new URL(positionals[0]).origin;
} catch {
  console.error('Invalid URL. Example: perfscope https://example.com');
  process.exit(1);
}

async function main() {
  const browser = await chromium.launch().catch((e: Error) => {
    if (/Executable doesn't exist/i.test(e.message)) {
      console.error('Chromium is not installed. Run: npx playwright install chromium');
      process.exit(1);
    }
    throw e;
  });

  try {
    const ctx = await browser.newContext(
      values.desktop
        ? { viewport: { width: 1440, height: 900 } }
        : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true },
    );

    const crawlPage = await ctx.newPage();
    const routes = await discoverRoutes(crawlPage, origin, Number(values.limit));
    await crawlPage.close();
    console.log(`routes (${routes.length}):`, routes.join('  '));

    const snapshots: RouteSnapshot[] = [];
    for (const r of routes) {
      const page = await ctx.newPage(); // fresh page per route so measurements stay clean
      try {
        snapshots.push(await collectRoute(page, origin, r, { throttle: !values['no-throttle'], desktop: values.desktop }));
        console.log('ok  ', r);
      } catch (e) {
        console.warn('fail', r, (e as Error).message);
      } finally {
        await page.close();
      }
    }

    const findings = snapshots.flatMap(analyze);
    const out = resolve(values.out!);
    await mkdir(out, { recursive: true });
    await writeFile(`${out}/report.json`, JSON.stringify({ snapshots, findings }, null, 2));
    await writeFile(`${out}/report.html`, renderHtml({ snapshots, findings }));

    if (values.pdf) {
      const p = await browser.newPage();
      await p.goto(pathToFileURL(`${out}/report.html`).href);
      await p.pdf({ path: `${out}/report.pdf`, format: 'A4', printBackground: true });
      await p.close();
    }

    console.log(`\n${findings.length} findings -> ${out}/report.html`);

    const order = ['low', 'medium', 'high'];
    const min = values['fail-on'] ? order.indexOf(values['fail-on']) : -1;
    if (min >= 0 && findings.some((f) => order.indexOf(f.severity) >= min)) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
