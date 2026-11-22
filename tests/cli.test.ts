import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cli = resolve(__dirname, "../bin/perfscope.mjs");

const project = (layout: string) => {
  const dir = mkdtempSync(join(tmpdir(), "ps-cli-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { next: "16.0.0" } }));
  mkdirSync(join(dir, "app"));
  writeFileSync(join(dir, "app/layout.tsx"), layout);
  const run = () => execFileSync("node", [cli, "init"], { cwd: dir, encoding: "utf8" });
  return { dir, run, read: () => readFileSync(join(dir, "app/layout.tsx"), "utf8") };
};

describe("perfscope init (Next.js App Router)", () => {
  it("wires the JSX, not the {children} in the function signature", () => {
    const p = project(`export default function L({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}\n`);
    p.run();
    const out = p.read();
    expect(out).toContain("({children}:{children:React.ReactNode})");
    expect(out).toMatch(/<body><PerfscopeDev \/>\n\s+\{children\}<\/body>/);
  });

  it("handles a normal formatted layout and is idempotent", () => {
    const p = project(`export default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang="en">\n      <body className="x">{children}</body>\n    </html>\n  );\n}\n`);
    p.run();
    const once = p.read();
    expect(once).toContain("{ children }: { children: React.ReactNode }");
    expect(once.match(/<PerfscopeDev \/>/g)).toHaveLength(1);
    p.run();
    expect(p.read()).toBe(once);
  });
});
