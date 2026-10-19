// A PAGE TO DRAW THE APP'S OWN COMPONENTS IN (R36, 2026-10-19 — the fresh audit's FE11-09; Ryan: "Yes, add it").
//
// The suite held the screens to their source text (scripts/smoke.cjs) and ran hooks on a hand-made React
// (fixtures/hookHost), and two bugs the audit found passed it: a crash screen whose Try again did nothing, and an alert
// tap that opened nothing. This draws a component itself — compiled from its TypeScript and JSX, with the real React and
// react-dom — into happy-dom's document, and @testing-library/react taps it and reads what a person would: the words,
// the roles, the focus. Dev-only (package.json devDependencies, pinned): nothing here ships.
//
//   · domReady(): happy-dom's window made the global one — window, document, every constructor the DOM has and its
//     timers — as @happy-dom/global-registrator does it. Once, and before React, react-dom or the library are loaded:
//     they read the document as they load. Then the library itself: { render, screen, fireEvent, act, within, cleanup }.
//   · componentLoader(shims): a file of the app compiled (ts.transpileModule, react-jsx), `@/x` and `./x` resolved in
//     the repo (.tsx, .ts, /index.tsx, /index.ts); a module named in shims is stood in for — the database client, the
//     router — a stylesheet is nothing, and react / react-dom are the ones the library draws with.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const nodeRequire = createRequire(import.meta.url);

let library = null;

/** happy-dom's window as the global one, then @testing-library/react. Idempotent. */
export function domReady({ url = "https://app.gt3pb.com/", width = 390, height = 844 } = {}) {
  if (library) return library;
  const { GlobalWindow, PropertySymbol } = nodeRequire("happy-dom");
  const window = new GlobalWindow({ url, width, height });
  const IGNORE = new Set(["constructor", "undefined", "NaN", "global", "globalThis"]);
  // Node's own clock and network stay: React schedules its work with these, and a second clock under the same name
  // (the window's, which keeps its own task list) put one render inside another ("Should not already be working").
  const NODE_KEEPS = new Set(["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate",
    "queueMicrotask", "MessageChannel", "MessagePort", "performance", "fetch", "Request", "Response", "Headers", "FormData",
    "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "AbortController", "AbortSignal", "crypto", "structuredClone",
    "console", "process", "Buffer", "Blob", "File", "ReadableStream", "WritableStream", "TransformStream"]);
  const own = Object.getOwnPropertyDescriptors(window);
  for (const key of Object.keys(own)) {
    if (IGNORE.has(key) || NODE_KEEPS.has(key)) continue;
    const d = own[key];
    const was = Object.getOwnPropertyDescriptor(globalThis, key);
    if (was?.value !== undefined && was.value === d.value) continue;
    if (d.value === window) { window[key] = globalThis; d.value = globalThis; }   // window.window, self, top, parent
    Object.defineProperty(globalThis, key, { ...d, configurable: true });
  }
  for (const sym of Object.getOwnPropertySymbols(window)) {
    Object.defineProperty(globalThis, sym, { ...Object.getOwnPropertyDescriptor(window, sym), configurable: true });
  }
  globalThis.document[PropertySymbol.defaultView] = globalThis;
  // React's act() is asked for by the library; this says the page is a test's, so act() is expected and quiet.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  library = nodeRequire("@testing-library/react");
  return library;
}

/** The repo's file for a specifier, or null. */
function resolveIn(base) {
  for (const p of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(p) && !p.endsWith("/")) { try { readFileSync(p); return p; } catch { /* a directory */ } }
  }
  return null;
}

/** A file of the app, compiled with its JSX. `shims` stands in for modules by their specifier. */
export function componentLoader(shims = {}) {
  domReady();
  const cache = new Map();
  const load = (abs) => {
    if (cache.has(abs)) return cache.get(abs).exports;
    const mod = { exports: {} };
    cache.set(abs, mod);
    if (/\.(css|scss)$/.test(abs)) return mod.exports;
    if (abs.endsWith(".json")) { mod.exports = JSON.parse(readFileSync(abs, "utf8")); return mod.exports; }
    const out = ts.transpileModule(readFileSync(abs, "utf8"), {
      fileName: abs,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const here = dirname(abs);
    new Function("module", "exports", "require", "process", out)(mod, mod.exports, (spec) => {
      if (Object.prototype.hasOwnProperty.call(shims, spec)) return shims[spec];
      if (/\.(css|scss)$/.test(spec)) return {};
      if (spec.startsWith("@/") || spec.startsWith("./") || spec.startsWith("../")) {
        const file = resolveIn(spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : normalize(join(here, spec)));
        if (!file) throw new Error(`componentLoader: ${spec} (from ${relative(ROOT, abs)}) is not a file of the app — shim it`);
        const key = relative(ROOT, file);
        if (Object.prototype.hasOwnProperty.call(shims, `@/${key.replace(/\.(tsx|ts)$/, "")}`)) return shims[`@/${key.replace(/\.(tsx|ts)$/, "")}`];
        return load(file);
      }
      return nodeRequire(spec);
    }, process);
    return mod.exports;
  };
  return (rel) => load(join(ROOT, rel));
}

/** A promise and its resolve — for a call the test answers when it chooses. */
export function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
