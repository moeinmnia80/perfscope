#!/usr/bin/env node
// npx @moeinmnia/perfscope init   : wires perfscope into a Next.js or Vite project (development only).
// Idempotent: running it twice changes nothing. Add --dry to see what it would do.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const cmd = args[0];
const dry = args.includes("--dry");
const cwd = process.cwd();
const IMPORT = 'import "@moeinmnia/perfscope/auto";';

const log = (m) => console.log(`  ${m}`);
const first = (...paths) => paths.map((p) => join(cwd, p)).find((p) => existsSync(p));
const write = (file, text) => (dry ? log(`[dry] would write ${file.replace(cwd, ".")}`) : writeFileSync(file, text));

if (cmd !== "init") {
  console.log(`perfscope: a dev-time performance overlay\n\n  npx @moeinmnia/perfscope init [--dry]   add it to this project\n\nManual setup:  import "@moeinmnia/perfscope/auto";  (development only)\nDocs:          https://github.com/moeinmnia80/perfscope#readme`);
  process.exit(cmd ? 1 : 0);
}

if (!existsSync(join(cwd, "package.json"))) {
  console.error("perfscope: no package.json here. Run this in your project's root.");
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
const has = (n) => !!(pkg.dependencies?.[n] || pkg.devDependencies?.[n]);
console.log("perfscope init");

if (has("next")) {
  const layout = first("app/layout.tsx", "src/app/layout.tsx", "app/layout.jsx", "src/app/layout.jsx", "app/layout.js", "src/app/layout.js");
  if (!layout) {
    log("Next.js detected, but no app/layout found (Pages Router?). Add this to pages/_app:  " + IMPORT);
    process.exit(0);
  }
  const ts = layout.endsWith("x") && layout.includes(".ts");
  const dir = layout.replace(/[\\/]layout\.\w+$/, "");
  const compDir = existsSync(join(dir, "..", "components")) && dir.endsWith("app") ? join(dir, "..", "components") : join(dir, "_components");
  const comp = join(compDir, ts ? "perfscope-dev.tsx" : "perfscope-dev.jsx");
  if (!existsSync(comp)) {
    if (!dry) mkdirSync(compDir, { recursive: true });
    write(comp, `"use client";\n// perfscope: development-only performance overlay. Safe to commit: it does nothing in production builds.\nimport "@moeinmnia/perfscope/auto";\n\nexport function PerfscopeDev() {\n  return null;\n}\n`);
    log(`created ${comp.replace(cwd, ".")}`);
  }
  let src = readFileSync(layout, "utf8");
  if (src.includes("PerfscopeDev")) log("layout already wired: nothing to do");
  else {
    const rel = comp.replace(/\.\w+$/, "");
    const importPath = rel.startsWith(join(cwd, "src")) && src.includes('"@/') ? "@/" + rel.slice(join(cwd, "src").length + 1).replace(/\\/g, "/") : (rel.startsWith(cwd + "/components") && src.includes('"@/') ? "@/" + rel.slice(cwd.length + 1) : "./" + rel.replace(dir, "").replace(/^[\\/]/, "").replace(/\\/g, "/"));
    const lines = src.split("\n");
    const lastImport = lines.map((l, i) => (/^import\s/.test(l) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    lines.splice(lastImport + 1, 0, `import { PerfscopeDev } from "${importPath}";`);
    src = lines.join("\n");
    // only touch the JSX: never the `{ children }` in the function signature
    const body = src.search(/<body[^>]*>/);
    if (body === -1) {
      log("no <body> found in the layout. Add <PerfscopeDev /> inside it yourself.");
    } else {
      const head = src.slice(0, body);
      const rest = src.slice(body);
      src = head + (/\{\s*children\s*\}/.test(rest) ? rest.replace(/\{\s*children\s*\}/, (m) => `<PerfscopeDev />\n        ${m}`) : rest.replace(/(<body[^>]*>)/, "$1\n        <PerfscopeDev />"));
    }
    write(layout, src);
    log(`wired ${layout.replace(cwd, ".")}`);
  }
} else if (has("vite") || first("index.html")) {
  const entry = first("src/main.tsx", "src/main.jsx", "src/main.ts", "src/main.js", "src/index.tsx", "src/index.jsx");
  if (!entry) {
    log("Vite detected, but no src/main.* found. Add this as the FIRST import of your entry file:  " + IMPORT);
    process.exit(0);
  }
  const src = readFileSync(entry, "utf8");
  if (src.includes("@moeinmnia/perfscope")) log("entry already wired: nothing to do");
  else {
    write(entry, `${IMPORT} // dev-only; keep it first so React timings are live\n${src}`);
    log(`wired ${entry.replace(cwd, ".")}`);
  }
} else {
  log("Could not detect Next.js or Vite. Add this as the first import of your client entry:");
  log(IMPORT);
}
console.log("\n  Run your dev server. A small rectangle appears in the corner of the page (Alt+Shift+P toggles it).");
