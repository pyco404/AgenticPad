import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies web/public/exit/exit.mjs, verbatim, into the page's own script in
 * web/public/exit/index.html, between the two marker lines.
 *
 * The page must work saved to disk and opened directly, and a browser will not
 * load a module from a file:// URL - so the page cannot import exit.mjs, it has
 * to carry it. exit.mjs stays the one source (the web app's exit panel imports
 * it, and the tests hold it byte for byte against @solana/web3.js); this makes
 * the page's copy, and test/standalone-exit.test.ts fails if the two differ.
 *
 *   npm run exit:inline            rewrite the page's copy
 *   npm run exit:inline -- --check exit non-zero if it is out of date
 */

export const BEGIN = "// ---- begin exit.mjs (copied in by scripts/inline-exit.ts; edit exit.mjs, not this) ----";
export const END = "// ---- end exit.mjs ----";

const DIR = new URL("../web/public/exit/", import.meta.url);

/** The page with its copy of the library replaced by `library`. */
export function inline(page: string, library: string): string {
  const start = page.indexOf(BEGIN);
  const end = page.indexOf(END);
  if (start < 0 || end < start) throw new Error("index.html has no exit.mjs markers");
  return page.slice(0, start + BEGIN.length) + "\n" + library + page.slice(end);
}

/** The library as the page carries it, between the markers. */
export function inlined(page: string): string {
  const start = page.indexOf(BEGIN);
  const end = page.indexOf(END);
  if (start < 0 || end < start) throw new Error("index.html has no exit.mjs markers");
  return page.slice(start + BEGIN.length + 1, end);
}

// Run as a script, not when a test imports the helpers above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const page = readFileSync(new URL("index.html", DIR), "utf8");
  const library = readFileSync(new URL("exit.mjs", DIR), "utf8");
  const next = inline(page, library);
  if (process.argv.includes("--check")) {
    if (next !== page) {
      console.error("web/public/exit/index.html is out of date with exit.mjs: run npm run exit:inline");
      process.exit(1);
    }
    console.log("index.html carries exit.mjs exactly");
  } else {
    writeFileSync(new URL("index.html", DIR), next);
    console.log(next === page ? "index.html already up to date" : "index.html updated from exit.mjs");
  }
}
