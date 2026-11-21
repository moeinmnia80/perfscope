import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", auto: "src/auto.ts", react: "src/react.tsx" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: false,
  target: "es2020",
  treeshake: true,
  minify: true,
  clean: true,
  splitting: true,
  external: ["react", "react/jsx-runtime"],
});
