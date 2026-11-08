import type { Page } from 'playwright';

// /movie/12345 -> /movie/:id so only one sample per pattern is analyzed
const pattern = (path: string) =>
  path.replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, '/:id');

export async function discoverRoutes(page: Page, origin: string, limit = 12): Promise<string[]> {
  const seen = new Map<string, string>();
  const queue = ['/'];
  const visited = new Set<string>();

  while (queue.length && seen.size < limit) {
    const path = queue.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);

    const pat = pattern(path);
    if (!seen.has(pat)) seen.set(pat, path);

    await page.goto(origin + path, { waitUntil: 'networkidle' }).catch(() => {});
    const hrefs = await page
      .$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href') || ''))
      .catch(() => [] as string[]);

    for (const h of hrefs) {
      if (!h.startsWith('/') || h.startsWith('//') || h.includes('#')) continue;
      const clean = h.split('?')[0];
      if (!seen.has(pattern(clean))) queue.push(clean);
    }
  }
  return [...seen.values()];
}
