/**
 * Browser check runner — serves dist-test/ and opens every check page in
 * headless Firefox (Playwright), printing each page's #out verdict.
 *
 *   node scripts/run-checks.mjs              all pages
 *   node scripts/run-checks.mjs view.html    subset (names without .html ok)
 *
 * Requires the check build to exist (`npm run build:test`) and `playwright`
 * with its firefox build installed (`npx playwright install firefox`).
 */

import { firefox } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const DIST = "dist-test";
const PORT = 8081;
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
};

const server = createServer(async (req, res) => {
  let path = req.url?.split("?")[0] ?? "/";
  if (path.endsWith("/")) path += "index.html";
  try {
    const file = await readFile(join(DIST, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((resolve) => server.listen(PORT, resolve));

let pages = process.argv.slice(2).map((p) => p.replace(/\.html$/, ""));
pages = pages.map((p) => (p.startsWith("test/") ? p : `test/${p}`));
if (pages.length === 0) {
  pages = ["test/view", "test/engine", "test/analyze", "test/explore"];
}

const browser = await firefox.launch();
let failed = false;

for (const page of pages) {
  const context = await browser.newContext();
  const tab = await context.newPage();
  const errors = [];
  tab.on("pageerror", (error) => errors.push(String(error)));
  try {
    await tab.goto(`http://localhost:${PORT}/${page}.html`);
    await tab.waitForFunction(
      () => {
        const out = document.getElementById("out");
        // Final verdicts only: the summary lines carry a count, while
        // intermediate failures are plain "FAIL — <message>".
        return out !== null && /PASS — (?:bestmove|\d+ assertion)|FAIL — \d+ failure|ERROR/.test(out.textContent ?? "");
      },
      null,
      { timeout: page.includes("analyze") || page.includes("explore") ? 300_000 : 120_000 },
    );
    const text = await tab.evaluate(() => document.getElementById("out")?.textContent ?? "");
    console.log(`\n===== ${page} =====\n${text.trim()}`);
    if (!text.includes("PASS")) failed = true;
  } catch (error) {
    console.log(`\n===== ${page} =====\nERROR — ${error}`);
    failed = true;
  }
  if (errors.length > 0) {
    console.log(`page errors (${page}): ${errors.join(" | ")}`);
    failed = true;
  }
  await context.close();
}

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
