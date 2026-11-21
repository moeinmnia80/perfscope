// re-adds "use client" to the React entry (bundlers drop directives)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
for (const f of ["dist/react.js", "dist/react.cjs", "dist/auto.js", "dist/auto.cjs"]) {
  if (!existsSync(f)) continue;
  const s = readFileSync(f, "utf8");
  if (!s.startsWith('"use client"')) writeFileSync(f, '"use client";\n' + s);
}
