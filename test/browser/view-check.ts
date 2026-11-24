/**
 * Browser check for the PGN reconstruction UI — built to
 * dist-test/test/view.html.
 *
 * Statically imports src/main.ts so the *real* app boots against this
 * page's real DOM, then pastes the Opera Game, navigates with keys,
 * buttons and move-list clicks, and asserts the board DOM (piece map +
 * last-move/check highlights), the move list and the status line.
 *
 * Prints PASS/FAIL to #out.
 */

import { loadPgn, positionAt } from "../../src/chess/game.ts";
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const DEBOUNCE_WAIT = 450; // inputs.ts debounces 300ms

type PieceEl = HTMLElement & { cgKey?: string };

/** Piece map of the rendered board: square key -> "white pawn". */
function boardPieces(): Map<string, string> {
  const map = new Map<string, string>();
  for (const el of document.querySelectorAll<HTMLElement>("#board piece")) {
    const key = (el as PieceEl).cgKey;
    const m = /^(white|black) (\w+)/.exec(el.className);
    if (key && m) map.set(key, `${m[1]} ${m[2]}`);
  }
  return map;
}

/** Piece map of a FEN's placement field, same shape as boardPieces(). */
function fenPieces(fen: string): Map<string, string> {
  const roles: Record<string, string> = {
    p: "pawn", r: "rook", n: "knight", b: "bishop", q: "queen", k: "king",
  };
  const map = new Map<string, string>();
  const rows = (fen.split(" ")[0] ?? "").split("/");
  for (let i = 0; i < rows.length; i++) {
    let file = 0;
    for (const ch of rows[i] ?? "") {
      if (ch >= "1" && ch <= "8") {
        file += Number(ch);
        continue;
      }
      const color = ch === ch.toUpperCase() ? "white" : "black";
      const role = roles[ch.toLowerCase()] ?? ch.toLowerCase();
      map.set(`${"abcdefgh"[file] ?? "?"}${8 - i}`, `${color} ${role}`);
      file++;
    }
  }
  return map;
}

function mapsEqual(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

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

function expectBoard(ply: number, label: string): void {
  const game = loadPgn(OPERA_PGN);
  const pos = positionAt(game, ply);
  expect(
    mapsEqual(boardPieces(), fenPieces(pos.fen)),
    `${label}: board pieces match FEN of ply ${ply}`,
  );
}

function press(key: string): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

async function pastePgn(pgn: string): Promise<void> {
  const pgnEl = document.getElementById("pgn") as HTMLTextAreaElement | null;
  if (!pgnEl) throw new Error("missing #pgn");
  pgnEl.value = pgn;
  pgnEl.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(DEBOUNCE_WAIT);
}

async function check(): Promise<void> {
  const game = loadPgn(OPERA_PGN);
  const last = game.moves.length; // 33

  // 1. Initial state: no game yet.
  expect(document.getElementById("status") === null, "initial idle status is hidden");
  expect(document.querySelectorAll("#movelist .ply").length === 0, "initial move list is empty");

  // 2. Paste the Opera Game (debounced live parse).
  await pastePgn(OPERA_PGN);
  const status = document.getElementById("status")?.textContent ?? "";
  expect(status.includes("Morphy, Paul") && status.includes("1-0"), `status shows game summary ("${status}")`);
  expect(!status.startsWith("Invalid PGN"), "no parse error for a valid PGN");
  expect(document.getElementById("game-white")?.textContent === "Morphy, Paul", "sidebar shows White");
  expect(document.getElementById("game-result")?.textContent === "1-0", "sidebar shows result");
  expect(document.querySelectorAll("#movelist .ply").length === last, `move list has ${last} plies`);
  expect(document.querySelectorAll("#movelist .move-no").length === 17, "move list has 17 move numbers");
  expect(
    document.querySelector('#movelist .ply[data-ply="1"]')?.textContent === "e4",
    "first ply is e4",
  );

  if (window.matchMedia("(max-width: 640px)").matches) {
    const importToggle = document.getElementById("mobile-import-toggle") as HTMLButtonElement | null;
    const inputs = document.getElementById("inputs");
    expect(importToggle !== null, "mobile PGN import action is available");
    importToggle?.click();
    await sleep(50);
    expect(inputs?.classList.contains("mobile-open") === true, "mobile PGN sheet opens");
    expect(document.body.style.overflow === "hidden", "page scroll locks behind the sheet");
    press("Escape");
    await sleep(50);
    expect(inputs?.classList.contains("mobile-open") === false, "Escape closes the mobile PGN sheet");
    expect(document.body.style.overflow === "", "page scroll restored when the sheet closes");

    importToggle?.click();
    await sleep(50);
    (inputs?.querySelector(".mobile-sheet-close") as HTMLButtonElement | null)?.click();
    await sleep(50);
    expect(inputs?.classList.contains("mobile-open") === false, "mobile PGN sheet closes");

    const sidebarStatus = document.getElementById("status");
    const mobileStatus = document.getElementById("mobile-status");
    expect(sidebarStatus !== null && mobileStatus !== null, "status is rendered in both slots");
    expect(getComputedStyle(sidebarStatus!).display === "none", "sidebar status is hidden on mobile");
    expect(getComputedStyle(mobileStatus!).display !== "none", "mobile status is visible");
    expect(mobileStatus?.textContent === status, "mobile status mirrors the sidebar status");

    window.scrollTo(0, 160);
    const scrollBeforeNavigation = window.scrollY;
    (document.getElementById("nav-next") as HTMLButtonElement | null)?.click();
    await sleep(50);
    expect(
      Math.abs(window.scrollY - scrollBeforeNavigation) <= 1,
      "mobile navigation preserves the page scroll position",
    );
    (document.getElementById("nav-first") as HTMLButtonElement | null)?.click();
    await sleep(50);
  }

  // 3. Start position on the board, nothing highlighted.
  expectBoard(0, "start");
  expect(squareKeys("last-move").length === 0, "start: no last-move highlight");
  expect(
    document.querySelector("#movelist .ply.active") === null,
    "start: no active move in list",
  );

  // 4. End key → final position (checkmate on e8, last move d1-d8).
  press("End");
  await sleep(50);
  expectBoard(last, "end");
  expect(
    JSON.stringify(squareKeys("last-move")) === JSON.stringify(["d1", "d8"]),
    `end: last-move squares are d1/d8 (got ${JSON.stringify(squareKeys("last-move"))})`,
  );
  expect(
    JSON.stringify(squareKeys("check")) === JSON.stringify(["e8"]),
    "end: mated black king (e8) highlighted in check",
  );
  expect(
    document.querySelector(`#movelist .ply[data-ply="${last}"]`)?.classList.contains("active") === true,
    "end: last ply active in move list",
  );

  // 5. Home key → back to the start. (Longest transition on the board:
  // 33 plies back — chessground animates it, so wait a bit longer.)
  press("Home");
  await sleep(250);
  expectBoard(0, "home");
  expect(squareKeys("last-move").length === 0, "home: highlights cleared");
  expect(
    document.querySelector("#movelist .ply.active") === null,
    "home: active move cleared",
  );

  // 6. Nav buttons.
  document.getElementById("nav-next")?.click();
  await sleep(50);
  expectBoard(1, "nav-next");
  expect(
    JSON.stringify(squareKeys("last-move")) === JSON.stringify(["e2", "e4"]),
    "nav-next: last move e2/e4",
  );
  expect(
    document.querySelector('#movelist .ply[data-ply="1"]')?.classList.contains("active") === true,
    "nav-next: ply 1 active in move list",
  );

  document.getElementById("nav-first")?.click();
  await sleep(50);
  expectBoard(0, "nav-first");

  document.getElementById("nav-last")?.click();
  await sleep(50);
  expectBoard(last, "nav-last");

  // 7. Click a move in the list (ply 17 = 9.Bg5).
  document.querySelector<HTMLElement>('#movelist .ply[data-ply="17"]')?.click();
  await sleep(50);
  const expected17 = positionAt(game, 17);
  expectBoard(17, "movelist click");
  expect(
    JSON.stringify(squareKeys("last-move")) ===
      JSON.stringify([...(expected17.lastMove ?? [])].sort()),
    `movelist click: last move ${JSON.stringify(expected17.lastMove)}`,
  );

  // 8. Step backwards with the arrow key.
  press("ArrowLeft");
  await sleep(50);
  expectBoard(16, "arrow-left");
  expect(
    document.querySelector('#movelist .ply[data-ply="17"]')?.classList.contains("active") === false,
    "arrow-left: active ply moved off 17",
  );

  // 9. Invalid PGN: red status, previous game stays on screen.
  await pastePgn("this is not a chess game at all");
  const errStatus = document.getElementById("status")?.textContent ?? "";
  expect(errStatus.startsWith("Invalid PGN"), `invalid PGN reported ("${errStatus}")`);
  expect(
    document.getElementById("status")?.classList.contains("error") === true,
    "status line flagged as error",
  );
  expect(
    document.querySelectorAll("#movelist .ply").length === last,
    "previous game kept after a bad edit",
  );

  // 10. Recover with a valid PGN again.
  await pastePgn(OPERA_PGN);
  expect(
    document.querySelectorAll("#movelist .ply").length === last,
    "valid PGN re-parsed after error",
  );

  // 11. ELO fields auto-fill from the PGN's WhiteElo/BlackElo tags…
  const eloValue = (id: string): string =>
    (document.getElementById(id) as HTMLInputElement | null)?.value ?? "missing";
  await pastePgn(`${OPERA_PGN.replace('[Result "1-0"]', '[Result "1-0"]\n[WhiteElo "2680"]\n[BlackElo "2410"]')}`);
  expect(eloValue("elo-white") === "2680", `White ELO auto-filled from the PGN tag (got "${eloValue("elo-white")}")`);
  expect(eloValue("elo-black") === "2410", `Black ELO auto-filled from the PGN tag (got "${eloValue("elo-black")}")`);
  // …and a PGN *without* the tags leaves manual entries untouched.
  await pastePgn(OPERA_PGN);
  expect(eloValue("elo-white") === "2680", "manual ELO values survive a tag-less PGN");
  expect(eloValue("elo-black") === "2410", "manual ELO values survive a tag-less PGN");

  // 12. Board flip: button toggles orientation, "f" flips back — the
  // position itself (piece map) never changes with the orientation.
  const boardEl = document.getElementById("board")!;
  expectBoard(0, "pre-flip");
  document.getElementById("board-flip")?.click();
  await sleep(100);
  expect(boardEl.className.includes("orientation-black"), "flip button shows Black at the bottom");
  expectBoard(0, "flipped");
  press("f");
  await sleep(100);
  expect(boardEl.className.includes("orientation-white"), "\"f\" flips back to White");

  if (failures.length === 0) {
    log(`\nPASS — ${passed} assertions, game reconstruction UI verified`);
  } else {
    log(`\nFAIL — ${failures.length} failure(s), ${passed} passed:\n  - ${failures.join("\n  - ")}`);
  }
}

void check().catch((error) => {
  log(`ERROR — ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
});
