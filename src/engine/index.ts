import { jsEngine } from "./fallback";
import type { Engine } from "./shared";

export * from "./shared";

let engine: Engine = jsEngine;
let loading: Promise<Engine> | undefined;

/** The current engine: the JS twin until the Rust core has loaded (usually within a few ms). */
export const getEngine = () => engine;

/** Loads the Rust/WASM core once, off the main thread's critical path. Never throws: falls back to JS. */
export const loadEngine = (): Promise<Engine> =>
  (loading ??= (async () => {
    try {
      if (typeof WebAssembly === "undefined") return engine;
      const { loadWasmEngine } = await import("./wasm");
      engine = await loadWasmEngine();
    } catch {
      /* CSP without wasm-unsafe-eval, or an old browser: the JS twin is already in place */
    }
    return engine;
  })());
