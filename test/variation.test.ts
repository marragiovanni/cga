import assert from "node:assert/strict";
import { test } from "node:test";

import { START_FEN, loadPgn } from "../src/chess/game.ts";
import {
  extendToLeaf,
  gameLine,
  isMainPath,
  isPrimaryPath,
  mainPath,
  pathFromRoot,
  pathPositionAt,
  pathPositions,
  playMove,
  primaryPath,
  treeFromGame,
} from "../src/chess/variation.ts";

const OPERA_PGN = `[Event "Paris Opera"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 1-0`;

// ------------------------------------------------------------ main chain

test("treeFromGame + mainPath mirror the game's moves exactly", () => {
  const game = loadPgn(OPERA_PGN);
  const tree = treeFromGame(game);

  assert.equal(tree.startFen, game.moves[0]?.fenBefore, "start FEN comes from the game");
  assert.equal(tree.startFen, START_FEN, "Opera Game starts from the initial position");

  const path = mainPath(tree);
  assert.equal(path.length, game.moves.length, "one node per ply");
  for (const [index, node] of path.entries()) {
    assert.equal(node.move, game.moves[index], "nodes carry the original MoveRecords");
    assert.equal(node.main, true, "PGN nodes are marked main");
    assert.equal(node.move.ply, index + 1, "ply = depth from the root");
  }
  assert.equal(tree.root.move.ply, 0, "synthetic root sits at ply 0");
  assert.equal(tree.root.move.fenAfter, tree.startFen, "root's position is the start");
  assert.equal(path[0]?.parent, tree.root, "first move hangs off the root");
});

test("pathFromRoot returns first move → node, root excluded", () => {
  const game = loadPgn(OPERA_PGN);
  const tree = treeFromGame(game);
  const path = mainPath(tree);
  const fifth = path[4];
  assert.ok(fifth);

  const fromRoot = pathFromRoot(fifth);
  assert.equal(fromRoot.length, 5);
  assert.deepEqual(
    fromRoot.map((n) => n.move.san),
    path.slice(0, 5).map((n) => n.move.san),
    "ordered first move → node",
  );
  assert.equal(pathFromRoot(tree.root).length, 0, "the root itself is excluded");
  assert.equal(pathFromRoot(null).length, 0, "null yields an empty path");
});

// ------------------------------------------------------------- positions

test("pathPositions yields the N+1 layout analyzeGame expects", () => {
  const game = loadPgn(OPERA_PGN);
  const tree = treeFromGame(game);
  const path = mainPath(tree);

  const positions = pathPositions(tree, path);
  assert.equal(positions.length, game.moves.length + 1);
  assert.equal(positions[0], game.moves[0]?.fenBefore);
  for (const [index, node] of path.entries()) {
    assert.equal(positions[index], node.move.fenBefore, "entry i = position before move i");
  }
  assert.equal(positions.at(-1), path.at(-1)?.move.fenAfter, "last entry = final position");

  assert.deepEqual(pathPositions(tree, []), [tree.startFen], "empty path = just the start");
});

test("pathPositionAt shows the position after the revealed moves", () => {
  const game = loadPgn(OPERA_PGN);
  const tree = treeFromGame(game);
  const path = mainPath(tree);

  const start = pathPositionAt(tree, path, 0);
  assert.equal(start.fen, tree.startFen, "cursor 0 = start position");
  assert.equal(start.lastMove, null, "no last-move highlight at the start");

  const mid = pathPositionAt(tree, path, 3);
  assert.equal(mid.fen, path[2]?.move.fenAfter, "cursor k = after k moves");
  assert.deepEqual(mid.lastMove, ["g1", "f3"] satisfies [string, string], "last move highlighted");

  const end = pathPositionAt(tree, path, path.length);
  assert.equal(end.fen, path.at(-1)?.move.fenAfter, "cursor N = final position");
});

// ------------------------------------------------------------- main path

test("isMainPath: PGN prefix yes, any variation no", () => {
  const game = loadPgn(OPERA_PGN);
  const tree = treeFromGame(game);
  const path = mainPath(tree);

  assert.equal(isMainPath([]), true, "empty path is trivially main");
  assert.equal(isMainPath(path.slice(0, 3)), true, "prefix of the main line is main");
  assert.equal(isMainPath(path), true, "the whole main line is main");

  const variation = playMove(path[0]!, "g8f6"); // 1...Nf6 instead of 1...e5
  assert.ok(variation);
  assert.equal(variation.main, false, "created nodes are not main");
  assert.equal(isMainPath([variation]), false, "a variation path is not main");
  assert.equal(
    isMainPath([path[0]!, variation]),
    false,
    "a main prefix + variation node is not main",
  );
});

// --------------------------------------------------------------- playMove

test("playMove rejects illegal moves with null", () => {
  const game = loadPgn(OPERA_PGN);
  const tree = treeFromGame(game);
  const rootChildren = tree.root.children.length;

  assert.equal(playMove(tree.root, "e2e5"), null, "pawn cannot jump three squares");
  assert.equal(playMove(tree.root, "zz99"), null, "malformed UCI");
  assert.equal(playMove(tree.root, "e1e3"), null, "king cannot move two squares");
  assert.equal(tree.root.children.length, rootChildren, "failed attempts add no nodes");
});

test("playMove creates a variation with correct ply, SAN and FENs", () => {
  const game = loadPgn(OPERA_PGN);
  const tree = treeFromGame(game);
  const path = mainPath(tree);
  const first = path[0]!; // 1.e4

  const node = playMove(first, "g8f6");
  assert.ok(node);
  assert.equal(node.move.san, "Nf6");
  assert.equal(node.move.uci, "g8f6");
  assert.equal(node.move.ply, 2, "ply = parent ply + 1");
  assert.equal(node.move.fenBefore, first.move.fenAfter, "plays from the parent's position");
  assert.notEqual(node.move.fenAfter, first.move.fenAfter, "the position changed");
  assert.equal(node.parent, first);
  assert.equal(first.children.length, 2, "sibling of the PGN's 1...e5");
  assert.equal(first.children[1], node, "new alternatives append after existing ones");

  // A first move hangs off the synthetic root.
  const fresh = treeFromGame(loadPgn("1. e4 e5 1-0"));
  const e4 = playMove(fresh.root, "e2e4");
  assert.ok(e4);
  assert.equal(e4.move.ply, 1, "root children start at ply 1");
  assert.equal(fresh.root.children.length, 1);
});

test("playMove reuses an existing child instead of duplicating it", () => {
  const game = loadPgn(OPERA_PGN);
  const tree = treeFromGame(game);
  const path = mainPath(tree);
  const first = path[0]!; // 1.e4, whose PGN continuation is 1...e5

  const again = playMove(first, "e7e5");
  assert.equal(again, first.children[0], "replays hand back the existing node");
  assert.equal(first.children.length, 1, "no second copy of the same move");

  const variation = playMove(first, "g8f6");
  assert.ok(variation);
  const alsoVariation = playMove(first, "g8f6");
  assert.equal(alsoVariation, variation, "created variations are reused too");
  assert.equal(first.children.length, 2);
});

test("branching mid-path re-slices the path without losing the old line", () => {
  const game = loadPgn(OPERA_PGN);
  const tree = treeFromGame(game);
  const main = mainPath(tree);

  // Fork at ply 3: play a different third move for White.
  const parent = main[1]!; // after 1.e4 e5
  const fork = playMove(parent, "f1c4");
  assert.ok(fork);
  assert.notEqual(fork, main[2], "the fork is a new node, not the PGN's 3.Nf3");

  const forkPath = pathFromRoot(fork);
  assert.equal(forkPath.length, 3, "root → fork node");
  assert.deepEqual(
    forkPath.map((n) => n.move.san),
    ["e4", "e5", "Bc4"],
    "path carries the forked line",
  );
  assert.equal(isMainPath(forkPath), false);
  assert.equal(parent.children.length, 2, "old continuation stays as a sibling");
  assert.equal(parent.children[0], main[2], "the PGN's own move is still first");
  assert.equal(main.length, game.moves.length, "the main path is untouched");
});

// ------------------------------------------------------------- extendToLeaf

test("extendToLeaf: an empty prefix stays empty", () => {
  assert.deepEqual(extendToLeaf([]), []);
});

test("extendToLeaf: a leaf node yields just the prefix", () => {
  const tree = treeFromGame(loadPgn(OPERA_PGN));
  const main = mainPath(tree);
  const tail = pathFromRoot(main.at(-1)!);
  assert.equal(extendToLeaf(tail).length, tail.length, "nothing to add at the leaf");
  assert.deepEqual(extendToLeaf(tail), tail);
});

test("extendToLeaf: a mid-main node keeps the whole PGN continuation", () => {
  const tree = treeFromGame(loadPgn(OPERA_PGN));
  const main = mainPath(tree);

  // Jump back to ply 1 (after 1.e4): the viewed line must still reach
  // the end of the game, so the rest of the match stays in the list.
  const base = pathFromRoot(main[0]!);
  const line = extendToLeaf(base);
  assert.equal(line.length, main.length, "full game visible after the jump");
  assert.deepEqual(line.map((n) => n.move.san), main.map((n) => n.move.san));
  assert.equal(line[0], main[0], "same node objects, not copies");
});

test("extendToLeaf: after a fork the old continuation stays reachable", () => {
  const tree = treeFromGame(loadPgn(OPERA_PGN));
  const main = mainPath(tree);

  // Fork at ply 3 (2.Nf3 → 2.Nc3 instead), then "undo" back to the
  // fork position and return to the PGN move.
  const fork = playMove(main[1]!, "b1c3");
  assert.ok(fork);

  // Jumping to the fork node: line ends there (nothing played after).
  const forkLine = extendToLeaf(pathFromRoot(fork));
  assert.deepEqual(forkLine.map((n) => n.move.san), ["e4", "e5", "Nc3"]);

  // Returning to the real game: the PGN continuation re-appears.
  const restored = extendToLeaf(pathFromRoot(main[2]!)); // 2.Nf3
  assert.equal(restored.length, main.length, "the whole match is visible again");
  assert.deepEqual(restored.map((n) => n.move.san), main.map((n) => n.move.san));
});

test("extendToLeaf: a reused node replays into its full continuation", () => {
  const tree = treeFromGame(loadPgn(OPERA_PGN));
  const main = mainPath(tree);

  // Undo to ply 0, replay the PGN's first move: playMove reuses the
  // node, and the viewed line must extend through the rest of the game.
  const replayed = playMove(tree.root, "e2e4");
  assert.equal(replayed, main[0], "the PGN node is reused");
  const line = extendToLeaf([replayed!]);
  assert.equal(line.length, main.length);
  assert.deepEqual(line.map((n) => n.move.san), main.map((n) => n.move.san));
});

// ----------------------------------------------------------------- gameLine

test("gameLine: the imported game is the primary line, untouched", () => {
  const game = loadPgn(OPERA_PGN);
  const tree = treeFromGame(game);
  const main = mainPath(tree);

  const line = gameLine(tree);
  assert.equal(line.length, main.length);
  assert.deepEqual(line.map((n) => n.move.san), main.map((n) => n.move.san));
});

test("gameLine: mid-game alternatives never leak into the primary line", () => {
  const tree = treeFromGame(loadPgn(OPERA_PGN));
  const main = mainPath(tree);

  // Fork at ply 3: 2.Nc3 instead of 2.Nf3, and even extend the fork.
  const fork = playMove(main[1]!, "b1c3");
  assert.ok(fork);
  const deeper = playMove(fork, "g8f6");
  assert.ok(deeper);

  const line = gameLine(tree);
  assert.deepEqual(line.map((n) => n.move.san), main.map((n) => n.move.san));
  assert.ok(line.every((n) => n.main), "every displayed node is a main-chain node");
});

test("gameLine: moves played straight on past the game's end extend it", () => {
  const game = loadPgn("1. e4 e5");
  const tree = treeFromGame(game);
  const main = mainPath(tree);
  assert.equal(main.length, 2);

  // User continues playing past the end of the imported game.
  const nf3 = playMove(main.at(-1)!, "g1f3");
  assert.ok(nf3);

  const line = gameLine(tree);
  assert.deepEqual(
    line.map((n) => n.move.san),
    ["e4", "e5", "Nf3"],
    "the user's continuation is part of the game line",
  );
  assert.equal(line.at(-1)!.main, false, "even though it is not a PGN node");
});

test("no PGN: the primary line is the first-child chain", () => {
  const tree = treeFromGame({ ...loadPgn(OPERA_PGN), moves: [] });
  const e4 = playMove(tree.root, "e2e4")!;
  const e5 = playMove(e4, "e7e5")!;
  const nf3 = playMove(e5, "g1f3")!;
  const bc4 = playMove(e5, "f1c4")!;

  assert.equal(e4.main, false, "interactive moves are not PGN moves");
  assert.deepEqual(primaryPath(tree).map((n) => n.move.san), ["e4", "e5", "Nf3"]);
  assert.deepEqual(gameLine(tree).map((n) => n.move.san), ["e4", "e5", "Nf3"]);
  assert.equal(isPrimaryPath([e4, e5, nf3]), true, "first-child chain is primary");
  assert.equal(isPrimaryPath([e4, e5, bc4]), false, "the fork is a variation");
  assert.equal(e5.children[0], nf3, "the original continuation stays first");
});

test("primaryPath ignores a multi-level variation branch", () => {
  const tree = treeFromGame(loadPgn(OPERA_PGN));
  const main = primaryPath(tree);
  const fork = playMove(main[1]!, "b1c3")!;
  const deeper = playMove(fork, "g8f6")!;
  const leaf = playMove(deeper, "g1f3")!;

  assert.deepEqual(primaryPath(tree).map((n) => n.move.san), main.map((n) => n.move.san));
  assert.equal(isPrimaryPath([fork, deeper, leaf]), false, "a nested variation is not primary");
  assert.equal(isPrimaryPath([main[0]!, main[1]!, main[2]!]), true);
});
