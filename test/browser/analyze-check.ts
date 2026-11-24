/**
 * Browser check for the full analysis pipeline — built to
 * dist-test/test/analyze.html.
 *
 * Statically imports src/main.ts so the *real* app boots against this
 * page's real DOM, then drives the whole analysis flow end to end:
 *
 *   paste PGN → Analyze → live progress → Cancel → resume → labels in
 *   the move list → sidebar engine readout + opening + eval bar → best
 *   move arrow → ELO re-classification without the engine.
 *
 * Expected values below (accuracy, per-ply labels, book membership)
 * were captured from the real lite-single engine at depth 14; assertions
 * on engine-dependent values are format-based so a marginally different
 * evaluation never turns the check red, while book/book-gate facts —
 * which no engine can move — are asserted exactly.
 *
 * Prints PASS/FAIL to #out.
 */

import { loadPgn } from "../../src/chess/game.ts";
import "../../src/main.ts";

const OPERA_PGN = `[Event "Paris Opera"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Morphy, Paul"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7
8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7
14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0`;

/** Position count the app analyzes: plies + final position. */
const TOTAL = 26;
const LABELS = ["book", "best", "blunder", "mistake", "inaccuracy", "good", "acceptable"];

const out = document.getElementById("out");
if (!out) throw new Error("missing #out element");
const log = (line: string): void => {
  out.textContent = `${out.textContent ?? ""}${line}\n`;
};

const failures: string[] = [];
let passed = 0;
function expect(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    log(`ok   — ${msg}`);
  } else {
    failures.push(msg);
    log(`FAIL — ${msg}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const DEBOUNCE_WAIT = 450; // inputs.ts debounces 300ms

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

const statusText = (): string => $("status").textContent ?? "";
// Opening display: the badge renders "C41 Philidor …" when an opening
// is known, and a lone `#opening` span with "–" when there is none.
const openingText = (): string => {
  const badge = document.querySelector(".opening-badge");
  if (!badge || badge.querySelector("#opening")) return "–";
  const eco = badge.querySelector(".eco-code")?.textContent ?? "";
  const name = badge.querySelector(".opening-name")?.textContent ?? "";
  return `${eco} ${name}`.trim();
};
// Button label, excluding the decorative icon span (textContent is
// "▶ Analyze" / "⏹ Cancel…" because of the aria-hidden glyph).
const buttonText = (): string =>
  [...$<HTMLButtonElement>("analyze-btn").childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? "")
    .join("")
    .trim();
// The progress bar is rendered only while a run is visible
// ({#if progressVisible}); a missing element counts as hidden.
const progressHidden = (): boolean =>
  !document.getElementById("progress") ||
  $<HTMLElement>("progress").hidden !== false;
const progressBarWidth = (): string =>
  document.getElementById("progress-bar")?.style.width ?? "";
/** Plies of the viewed line carrying a classifier label (data-label). */
const badgeCount = (): number =>
  document.querySelectorAll("#movelist .ply[data-label]").length;

/** Classifier label of a ply's chip, or null when unclassified. */
function labelAt(ply: number): string | null {
  const chip = document.querySelector<HTMLElement>(`#movelist .ply[data-ply="${ply}"]`);
  return chip?.dataset.label ?? null;
}

function allLabels(): (string | null)[] {
  const game = loadPgn(OPERA_PGN);
  return game.moves.map((_, i) => labelAt(i + 1));
}

/** Green best-move arrow lines currently drawn on the board. */
function arrowLines(): SVGLineElement[] {
  return [...document.querySelectorAll<SVGLineElement>("#board svg.cg-shapes line")];
}

/** Poll until `probe` returns a truthy value; returns it. */
async function waitFor<T>(
  probe: () => T | null | undefined | false,
  timeoutMs: number,
  what: string,
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = probe();
    if (hit) return hit as NonNullable<T>;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

async function pastePgn(pgn: string): Promise<void> {
  const pgnEl = $<HTMLTextAreaElement>("pgn");
  pgnEl.value = pgn;
  pgnEl.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(DEBOUNCE_WAIT);
}

async function setElo(id: string, value: string): Promise<void> {
  const el = $<HTMLInputElement>(id);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(60); // let the synchronous re-classification land
}

async function goto(ply: number): Promise<void> {
  const active = document.querySelector("#movelist .ply.active");
  let current = active ? Number(active.getAttribute("data-ply")) : 0;
  if (ply === current) return;
  if (ply === 0) {
    $("nav-first").click();
    await sleep(60); // let Svelte flush and chessground redraw shapes
    return;
  }
  if (ply === lastPly()) {
    $("nav-last").click();
    await sleep(60);
    return;
  }
  const step = ply > current ? "nav-next" : "nav-prev";
  while (current !== ply) {
    $(step).click();
    current += ply > current ? 1 : -1;
  }
  await sleep(60);
}

function lastPly(): number {
  return loadPgn(OPERA_PGN).moves.length;
}

async function check(): Promise<void> {
  const game = loadPgn(OPERA_PGN);
  const last = game.moves.length; // 33

  // ---------------------------------------------------- A. pre-analysis
  log("— phase A: parsed, not yet analyzed —");
  expect(document.getElementById("status") === null, "initial idle status is hidden");

  await pastePgn(OPERA_PGN);
  expect(
    document.querySelectorAll("#movelist .ply").length === last,
    `move list has ${last} plies`,
  );
  // Book plies (1-7) badge instantly — table facts; the rest wait for
  // the engine.
  const preLabels = allLabels();
  expect(
    preLabels.slice(0, 7).every((l) => l === "book") && preLabels.slice(7).every((l) => l === null),
    `book plies pre-labeled, engine plies not (got ${preLabels.join(",")})`,
  );
  expect(buttonText() === "Analyze", `button reads "Analyze" (got "${buttonText()}")`);
  expect(progressHidden(), "progress bar hidden before analysis");
  for (const id of ["best-move", "score", "pv"]) {
    expect($(`${id}`).textContent === "–", `#${id} resets to "–" (got "${$(`${id}`).textContent}")`);
  }
  expect(openingText() === "–", `opening resets to "–" (got "${openingText()}")`);
  expect(arrowLines().length === 0, "no best-move arrow before analysis");

  // The opening name must not depend on the engine.
  await goto(6);
  expect(
    openingText() === "C41 Philidor Defense: Albin-Blackburne Gambit",
    `opening at ply 6 comes from the book (got "${openingText()}")`,
  );
  await goto(0);
  expect(openingText() === "–", "start position has no opening name");

  // ------------------------------------------------------- B. start run
  log("— phase B: analyze, live progress —");
  $("analyze-btn").click();
  await sleep(0); // let Svelte flush the batched DOM update
  expect(buttonText() === "Cancel…", `button flips to "Cancel…" (got "${buttonText()}")`);
  expect(!progressHidden(), "progress bar shown while running");

  const running = await waitFor(() => {
    const m = /^analyzing… (\d+)\/(\d+)$/.exec(statusText());
    return m !== null && Number(m[1]) >= 1 ? { done: Number(m[1]), total: Number(m[2]) } : null;
  }, 10_000, "at least one analyzed position");
  expect(running.total === TOTAL, `total is ${TOTAL} positions (got ${running.total})`);
  const barWidth = progressBarWidth();
  expect(
    barWidth !== "" && barWidth !== "0%" && barWidth !== "0.0%",
    `progress bar advanced past zero (width=${barWidth})`,
  );

  // -------------------------------------------------------- C. cancel run
  log("— phase C: cancel mid-run, keep partial work —");
  // Wait until at least two positions are done so something is cached.
  await waitFor(() => {
    const m = /^analyzing… (\d+)\//.exec(statusText());
    return m !== null && Number(m[1]) >= 2;
  }, 10_000, "at least 2 analyzed positions");
  $("analyze-btn").click();

  const cancelled = await waitFor(
    () => /^analysis cancelled · (\d+)\/(\d+) positions$/.exec(statusText()),
    10_000,
    "an `analysis cancelled` status line",
  );
  const cancelledDone = Number(cancelled[1]);
  expect(cancelledDone > 0 && cancelledDone < TOTAL, `partial run (${cancelledDone}/${TOTAL})`);
  expect(buttonText() === "Analyze", `button returns to "Analyze" (got "${buttonText()}")`);
  expect(progressHidden(), "progress bar hidden after cancel");
  const partialBadges = badgeCount();
  expect(
    partialBadges > 0 && partialBadges < last,
    `partial labels kept but incomplete (${partialBadges} of ${last})`,
  );

  // -------------------------------------------------------- D. resume run
  log("— phase D: resume to completion —");
  $("analyze-btn").click();
  await sleep(0);
  expect(buttonText() === "Cancel…", `resume flips button to "Cancel…" (got "${buttonText()}")`);

  await waitFor(() => statusText().startsWith("analysis done"), 60_000, "analysis to finish");
  const doneStatus = statusText();
  expect(
    /^analysis done · White \d+% · Black \d+%$/.exec(doneStatus) !== null,
    `status carries both accuracies (got "${doneStatus}")`,
  );
  log(`     status: ${doneStatus}`);
  expect(buttonText() === "Analyze", `button back to "Analyze" when done (got "${buttonText()}")`);
  expect(progressHidden(), "progress bar hidden when done");

  expect(badgeCount() === last, `all ${last} plies labelled (got ${badgeCount()})`);

  // Book facts are engine-independent: assert them exactly.
  let bookStreak = 0;
  for (let ply = 1; ply <= last && labelAt(ply) === "book"; ply++) bookStreak++;
  expect(bookStreak === 7, `plies 1-7 are book, ply ${bookStreak + 1} is not (streak=${bookStreak})`);
  expect(labelAt(8) !== "book", `ply 8 leaves the book (got "${labelAt(8)}")`);

  const known = allLabels().every((l) => l !== null && LABELS.includes(l));
  expect(known, `every badge carries a known label (${allLabels().join(",")})`);

  // --------------------------------------------------- E. per-ply readout
  // Book-only plies (0-6) are never searched: the sidebar shows no eval
  // there — the label comes from the opening table. The first searched
  // position is ply 7 (after 7...Qe7).
  log("— phase E: sidebar, opening, arrow per ply —");
  await goto(0);
  expect($("best-move").textContent === "–", `book ply 0 shows no best move (got "${$("best-move").textContent}")`);
  expect($("score").textContent === "–", `book ply 0 shows no score (got "${$("score").textContent}")`);
  expect($("pv").textContent === "–", `book ply 0 shows no continuation (got "${$("pv").textContent}")`);
  expect(openingText() === "–", "ply 0 has no opening name");
  expect(arrowLines().length === 0, "no best-move arrow at the unsearched ply 0");

  await goto(6);
  expect(
    openingText() === "C41 Philidor Defense: Albin-Blackburne Gambit",
    `opening badge is engine-independent (got "${openingText()}")`,
  );
  expect($("best-move").textContent === "–", `book ply 6 shows no best move (got "${$("best-move").textContent}")`);
  expect(arrowLines().length === 0, "no arrow at the unsearched ply 6");

  await goto(7);
  const scoreRe = /^[+-](?:\d+\.\d{2}|M\d+)$/;
  expect($("best-move").textContent !== "–", `ply 7 best move shown (got "${$("best-move").textContent}")`);
  expect(scoreRe.test($("score").textContent ?? ""), `ply 7 score formatted (got "${$("score").textContent}")`);
  expect($("pv").textContent !== "–", `ply 7 continuation shown (got "${$("pv").textContent}")`);
  let arrows = arrowLines();
  expect(arrows.length === 1, `one best-move arrow at ply 7 (got ${arrows.length})`);
  expect(
    (arrows[0]?.getAttribute("marker-end") ?? "").includes("arrowhead-g"),
    `arrow uses the green brush (got "${arrows[0]?.getAttribute("marker-end")}")`,
  );

  // Checkmate: no legal move, so the synthesized "(none)" must clear the UI.
  await goto(last);
  expect($("best-move").textContent === "–", `final position has no best move (got "${$("best-move").textContent}")`);
  expect($("pv").textContent === "–", `final position has no continuation (got "${$("pv").textContent}")`);
  expect(scoreRe.test($("score").textContent ?? ""), `final score formatted (got "${$("score").textContent}")`);
  expect(arrowLines().length === 0, "arrow cleared at the mate position");

  await goto(7);
  expect(arrowLines().length === 1, "arrow restored when navigating back to ply 7");

  // ------------------------------------------------ F. ELO re-classification
  log("— phase F: ELO change re-classifies without the engine —");
  const before = allLabels();
  expect(before.every((l) => l !== null), "baseline labels captured");

  await setElo("elo-white", "4000"); // strictest thresholds for White
  const afterHigh = allLabels();
  await setElo("elo-white", "0"); // most lenient thresholds for White
  const afterLow = allLabels();
  const changed = before
    .map((l, i) => {
      const high = afterHigh[i] !== l ? "elo 4000" : null;
      const low = afterLow[i] !== l ? "elo 0" : null;
      return high ?? low ? `${i + 1} (${high ?? low})` : null;
    })
    .filter((p) => p !== null);
  expect(
    changed.length >= 1,
    `ELO change re-classified at least one label (changed at ply ${changed.join(", ply ") || "none"})`,
  );
  log(`     changed plies: ${changed.join(", ") || "none"} · W:${before.join("/")} -> ${afterLow.join("/")}`);
  expect(badgeCount() === last, `badge count unchanged after re-classify (${badgeCount()})`);

  // The button must never re-enter the running state: no engine work.
  let engineReran = false;
  const eloDeadline = Date.now() + 700;
  while (Date.now() < eloDeadline) {
    if (buttonText() === "Cancel…" || /^analyzing…/.test(statusText())) engineReran = true;
    await sleep(50);
  }
  expect(!engineReran, "ELO change never started an engine run");
  expect(
    /White \d+% · Black \d+%/.test(statusText()),
    `status still shows both accuracies (got "${statusText()}")`,
  );

  await setElo("elo-white", "1500"); // restore
  expect(allLabels().join(",") === before.join(","), "restoring ELO restores the original labels");

  // ------------------------------------------------------------ verdict
  if (failures.length === 0) {
    log(`\nPASS — ${passed} assertions, full analysis pipeline verified`);
  } else {
    log(`\nFAIL — ${failures.length} failure(s), ${passed} passed:\n  - ${failures.join("\n  - ")}`);
  }
}

void check().catch((error) => {
  log(`ERROR — ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  log(`\nFAIL — ${failures.length} failure(s), ${passed} passed`);
});
