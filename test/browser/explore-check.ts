/**
 * Browser check for the interactive board with real-time analysis —
 * built to dist-test/test/explore.html.
 *
 * Statically imports src/main.ts so the *real* app boots against this
 * page's real DOM, then drives the whole exploration flow:
 *
 *   paste PGN → full run (progress, board lock) → fork a variation
 *   with synthetic click-click moves (trustAllEvents) → variation
 *   chip + live badge + sidebar readout → click the main chip to
 *   restore the line → a second sibling alternative coexists →
 *   Analyze runs on the viewed path → ELO re-classification without
 *   the engine → a fresh PGN proves the board locks during a run.
 *
 * Engine-dependent values are format-based; structural facts (chips,
 * statuses, lock class, badge counts) are exact.
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

/** A fresh second game: none of its positions were ever analyzed. */
const QUEENS_PGN = "1. d4 d5 2. c4 e6 3. Nc3 Nf6";

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
// Button label: only the text nodes, since the decorative SVG icon is
// aria-hidden and carries no action text.
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
const boardLocked = (): boolean => $("board").classList.contains("locked");

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

// ---------------------------------------------------------------- board

type PieceEl = HTMLElement & { cgKey?: string };

/** Visible square keys carrying a CSS class (hidden stale nodes are skipped). */
function squareKeys(cls: string): string[] {
  const keys: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(`#board square.${cls}`)) {
    if (el.style.display === "none") continue;
    const key = (el as PieceEl).cgKey;
    if (key) keys.push(key);
  }
  return keys.sort();
}

/** Center of a square in viewport coordinates (chessground: white pov). */
function squareCenter(key: string): { x: number; y: number } {
  const boardEl = document.querySelector<HTMLElement>("#board cg-board, #board .cg-board");
  if (!boardEl) throw new Error("missing #board cg-board");
  const rect = boardEl.getBoundingClientRect();
  const file = key.charCodeAt(0) - 97; // a → 0
  const rank = Number(key[1]); // 1..8
  return {
    x: rect.left + (rect.width * (file + 0.5)) / 8,
    y: rect.top + (rect.height * (8 - rank + 0.5)) / 8,
  };
}

/**
 * Click one square: mousedown selects the piece, mouseup releases it
 * (chessground's click-to-move). Synthetic events are accepted because
 * the board runs with `trustAllEvents`.
 */
function clickSquare(key: string): void {
  const boardEl = document.querySelector<HTMLElement>("#board cg-board, #board .cg-board");
  if (!boardEl) throw new Error("missing #board cg-board");
  const { x, y } = squareCenter(key);
  boardEl.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
    }),
  );
  document.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 0,
      clientX: x,
      clientY: y,
    }),
  );
}

/** Play a move the way a user would: click the origin, click the target. */
async function boardMove(from: string, to: string): Promise<void> {
  clickSquare(from);
  clickSquare(to);
  await sleep(0); // let Svelte flush the batched DOM update
}

// ------------------------------------------------------------ move list

function primaryChips(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#movelist .ply:not(.var)")];
}

function varChips(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#movelist .ply.var")];
}

/** Classifier label of a chip, or null when unclassified (data-label). */
function labelOf(el: HTMLElement): string | null {
  return el.dataset.label ?? null;
}

function primaryLabels(): (string | null)[] {
  return primaryChips().map((el) => labelOf(el));
}

function activePly(): string | null {
  return document.querySelector("#movelist .ply.active")?.getAttribute("data-ply") ?? null;
}

/** Board overlay chip (#move-label): text + visibility. */
const moveLabelText = (): string => $("move-label").textContent ?? "";
const moveLabelHidden = (): boolean => $("move-label").hidden !== false;

/** Green best-move arrow lines currently drawn on the board. */
function arrowLines(): SVGLineElement[] {
  return [...document.querySelectorAll<SVGLineElement>("#board svg.cg-shapes line")];
}


// ---------------------------------------------------------------- check

async function check(): Promise<void> {
  const game = loadPgn(OPERA_PGN);
  const last = game.moves.length; // 33

  // ------------------------------------------- A. paste + full run
  log("— phase A: paste the Opera Game and run a full analysis —");
  await pastePgn(OPERA_PGN);
  expect(primaryChips().length === last, `move list has ${last} plies`);
  // Book plies (1-7) are table-labeled facts — they badge immediately,
  // before any engine work; the rest wait for analysis.
  const preLabels = primaryLabels();
  expect(
    preLabels.slice(0, 7).every((l) => l === "book") && preLabels.slice(7).every((l) => l === null),
    `book plies pre-labeled, engine plies not (got ${preLabels.join(",")})`,
  );

  $("analyze-btn").click();
  await sleep(0); // let Svelte flush the batched DOM update
  expect(buttonText() === "Cancel…", `button flips to "Cancel…" (got "${buttonText()}")`);
  expect(boardLocked(), "board locked as soon as the run starts");
  expect(!progressHidden(), "progress bar shown while running");

  const running = await waitFor(
    () => /^Analyzing… (\d+)\/(\d+)$/.exec(statusText()),
    15_000,
    "run progress",
  );
  expect(Number(running[2]) === 26, `total is 26 searchable positions (got ${running[2]})`);

  await waitFor(() => statusText().startsWith("Analysis complete"), 60_000, "run to finish");
  expect(
    /^Analysis complete · White \d+% · Black \d+%$/.test(statusText()),
    `done status carries both accuracies (got "${statusText()}")`,
  );
  expect(buttonText() === "Analyze", "button back to Analyze when done");
  expect(progressHidden(), "progress bar hidden when done");
  expect(!boardLocked(), "board unlocked after the run");
  expect(
    primaryChips().filter((el) => labelOf(el) !== null).length === last,
    "every ply labelled",
  );

  // ------------------------------------------- B. fork a variation
  // 1...c5 is in the opening table → labeled "book" instantly, no live
  // search, no "analyzing move…" state.
  log("— phase B: fork 1...c5 with synthetic clicks —");
  const e4Chip = primaryChips().find((el) => el.dataset.ply === "1");
  expect(e4Chip !== undefined, "ply 1 chip exists");
  e4Chip?.click();
  await sleep(50);
  expect(squareKeys("last-move").join(",") === "e2,e4", "viewing the position after 1.e4");
  expect(activePly() === "1", "ply 1 active in the move list");

  await boardMove("c7", "c5"); // the Sicilian, instead of the game's 1...e5
  await waitFor(
    () => /^Variation · 2 moves · White \d+% · Black \d+%$/.test(statusText()),
    5_000,
    "book fork is classified instantly (no live search)",
  );
  expect(
    moveLabelText() === "book" && !moveLabelHidden(),
    `board overlay reads "book" straight away (got "${moveLabelText()}")`,
  );
  expect(primaryChips().some((el) => el.dataset.ply === "2"), "the game's 1...e5 stays the primary move");
  expect(varChips().some((el) => el.dataset.ply === "2"), "the c5 fork renders as a variation branch");
  expect(!boardLocked(), "board stays unlocked");
  const c5Chip = varChips().find((el) => el.dataset.ply === "2");
  const c5Label = c5Chip ? labelOf(c5Chip) : null;
  expect(
    c5Label === "book",
    `fork move carries the book badge without a search (got "${c5Label}")`,
  );
  expect(squareKeys("last-move").join(",") === "c5,c7", "board shows 1...c5");
  // Book positions are never searched: the sidebar shows no eval there.
  expect($("best-move").textContent === "–", `no best move at the book position (got "${$("best-move").textContent}")`);
  expect($("score").textContent === "–", `no score at the book position (got "${$("score").textContent}")`);
  expect($("pv").textContent === "–", `no continuation at the book position (got "${$("pv").textContent}")`);
  expect(arrowLines().length === 0, `no best-move arrow without a search (got ${arrowLines().length})`);

  // --------------------------------- C. main chip restores the line
  // The imported game IS the primary line now — clicking its chip from
  // inside a variation re-joins the main line.
  log("— phase C: click the main chip to restore the line —");
  const e5Main = primaryChips().find((el) => el.dataset.ply === "2");
  expect(e5Main !== undefined, "the game's 1...e5 is a primary chip");
  e5Main?.click();
  await sleep(100);
  expect(
    statusText().includes("Morphy, Paul") && statusText().includes("33 moves"),
    `status back to the game summary (got "${statusText()}")`,
  );
  expect(squareKeys("last-move").join(",") === "e5,e7", "board restored to after 1...e5");
  expect(activePly() === "2", "the restored chip is active");
  expect(
    !moveLabelHidden() && moveLabelText() === "book",
    `overlay reads "book" for the proven-book 1...e5 (got "${moveLabelText()}")`,
  );
  expect(primaryChips().length === last, "full main line back in the move list");
  expect(varChips().some((el) => el.dataset.ply === "2"), "the fork survived as a variation");

  // ----------------------------- D. a second sibling coexists
  // From after 1...e5, play 2.h3 — deliberately OFF-book, so this fork
  // exercises the live-search path (book moves are labeled instantly).
  log("— phase D: add an off-book second sibling (2.h3) —");
  const varsBefore = varChips().length;
  primaryChips().find((el) => el.dataset.ply === "2")?.click(); // to after 1...e5
  await sleep(50);
  expect(activePly() === "2", "at the second forking point");

  await boardMove("h2", "h3");
  expect(statusText() === "Analyzing move…", "live status for the off-book fork");
  const ply3Chip = varChips().find((el) => el.dataset.ply === "3");
  expect(ply3Chip !== undefined, "the h3 fork move chip rendered as a variation");
  expect(
    primaryChips().some((el) => el.dataset.ply === "2") &&
      varChips().some((el) => el.dataset.ply === "2"),
    "the game line (e5) and the first alternative (c5) both render",
  );
  expect(varChips().length > varsBefore, "the move list grew with the new branch");

  await waitFor(
    () => /^Variation · 3 moves · White \d+% · Black \d+%$/.test(statusText()),
    30_000,
    "second variation status",
  );
  expect(
    ply3Chip !== undefined && labelOf(ply3Chip) !== null && labelOf(ply3Chip) !== "book",
    `off-book fork move got a real engine badge (got "${ply3Chip ? labelOf(ply3Chip) : null}")`,
  );
  expect(squareKeys("last-move").join(",") === "h2,h3", "board shows 2.h3");
  // The position after the fork WAS searched: the sidebar has evals.
  expect($("best-move").textContent !== "–", `searched fork shows a best move (got "${$("best-move").textContent}")`);
  expect(arrowLines().length === 1, `best-move arrow drawn for the searched fork (got ${arrowLines().length})`);

  // -------------------------------- E. Analyze on the viewed path
  log("— phase E: Analyze runs on the viewed (variation) path —");
  $("analyze-btn").click();
  await sleep(0); // let Svelte flush the batched DOM update
  expect(buttonText() === "Cancel…", "run starts while a variation is viewed");
  expect(boardLocked(), "board locks for the viewed-path run");

  await waitFor(() => statusText().startsWith("Analysis complete"), 30_000, "viewed-path run");
  expect(
    /^Analysis complete · White \d+% · Black \d+%$/.test(statusText()),
    `done status carries accuracies (got "${statusText()}")`,
  );
  expect(buttonText() === "Analyze", "button back to Analyze");
  expect(!boardLocked(), "board unlocked when the run ends");
  expect(progressHidden(), "progress hidden when done");

  // ------------------------------------- F. ELO re-classification
  log("— phase F: ELO change re-classifies without the engine —");
  // Click the tail of the main line — the primary table, since the
  // imported game is the primary line.
  const lastMainChip = primaryChips().find((el) => el.dataset.ply === String(last));
  expect(lastMainChip !== undefined, "main-line tail visible as a primary chip");
  lastMainChip?.click();
  await sleep(50);
  expect(primaryChips().length === last, `full main line restored (${primaryChips().length} plies)`);
  expect(activePly() === String(last), "last ply active after jumping");

  const labelsBefore = primaryLabels();
  expect(labelsBefore.every((l) => l !== null), "baseline labels captured");

  await setElo("elo-white", "4000"); // strictest thresholds for White
  const labelsHigh = primaryLabels();
  await setElo("elo-white", "0"); // most lenient thresholds for White
  const labelsLow = primaryLabels();
  const changed = labelsBefore
    .map((l, i) => {
      const high = labelsHigh[i] !== l ? "elo 4000" : null;
      const low = labelsLow[i] !== l ? "elo 0" : null;
      return high ?? low ? `${i + 1} (${high ?? low})` : null;
    })
    .filter((p) => p !== null);
  expect(
    changed.length >= 1,
    `ELO change re-classified at least one label (changed at ply ${changed.join(", ") || "none"})`,
  );
  expect(
    primaryChips().filter((el) => labelOf(el) !== null).length === last,
    "badge count unchanged after re-classify",
  );

  let engineReran = false;
  const eloDeadline = Date.now() + 700;
  while (Date.now() < eloDeadline) {
    if (buttonText() === "Cancel…" || /^Analyzing…/.test(statusText())) engineReran = true;
    await sleep(50);
  }
  expect(!engineReran, "ELO change never started an engine run");
  expect(
    /White \d+% · Black \d+%/.test(statusText()),
    `status still shows both accuracies (got "${statusText()}")`,
  );

  await setElo("elo-white", "1500"); // restore
  expect(
    primaryLabels().join(",") === labelsBefore.join(","),
    "restoring ELO restores the original labels",
  );

  // ------------------- G. fresh PGN: a book-only line needs no run
  // All six moves of the Queen's Gambit line are in the opening table —
  // analysis completes without a single engine search.
  log("— phase G: fresh book-only PGN finishes instantly —");
  await pastePgn(QUEENS_PGN);
  expect(primaryChips().length === 6, `fresh game has 6 plies (got ${primaryChips().length})`);
  expect(
    primaryChips().every((el) => labelOf(el) === "book"),
    "a book-only game is fully labeled the moment it is pasted",
  );
  expect(varChips().length === 0, "variations are gone with the new PGN");
  expect(moveLabelHidden(), "board overlay hidden at the fresh game's start position");

  $("analyze-btn").click();
  await sleep(60);
  expect(buttonText() === "Analyze", `no run starts — every move is book (got "${buttonText()}")`);
  expect(!boardLocked(), "board never locks for a book-only analysis");
  expect(progressHidden(), "no progress bar without a run");
  expect(
    /^Analysis complete · White \d+% · Black \d+%$/.test(statusText()),
    `instant done status (got "${statusText()}")`,
  );
  expect(
    primaryChips().filter((el) => labelOf(el) !== null).length === 6,
    "all fresh plies labelled",
  );
  expect(
    primaryChips().every((el) => labelOf(el) === "book"),
    "every label reads book (table-labeled, not searched)",
  );

  // ------------------------------------------------------------ verdict
  if (failures.length === 0) {
    log(`\nPASS — ${passed} assertions, interactive exploration verified`);
  } else {
    log(`\nFAIL — ${failures.length} failure(s), ${passed} passed:\n  - ${failures.join("\n  - ")}`);
  }
}

void check().catch((error) => {
  log(`ERROR — ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  log(`\nFAIL — ${failures.length} failure(s), ${passed} passed`);
});
