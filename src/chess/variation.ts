/**
 * Variation tree — the move graph behind the interactive board.
 *
 * The imported PGN becomes a chain of `main` nodes under a virtual root
 * (ply 0 = the start position); dragging a piece adds — or reuses — a
 * child edge of the position on the board, so every branch is just a
 * sibling node. The *viewed line* is a root→leaf `path` plus a cursor
 * (how many of its moves are shown); moving at a mid-path position
 * re-slices the path without touching the tree, and the previous
 * continuation stays behind as a sibling variation.
 * 
 * the imported game is always the primary line in the move list (`gameLine`), 
 * while user alternatives render as its branches. Stepping back out of a
 * variation re-joins the main line, so ← then → resumes the game
 * instead of re-entering the alternative.
 *
 * Everything is pure data: no DOM, no engine, no chessground.
 */

import { Chess, type Move } from "chess.js";
import { START_FEN, positionView, type GameData, type MoveRecord, type PositionView } from "./game.ts";

export interface VariationNode {
  /** The move played from the parent's position (ply = depth from root;
   *  the root itself carries a synthetic ply-0 record = start FEN). */
  move: MoveRecord;
  /** True for nodes that came from the imported PGN's main line. */
  main: boolean;
  parent: VariationNode | null;
  /** Alternatives to this node's move, in creation order (the PGN's own
   *  continuation is always the first main child). */
  children: VariationNode[];
}

export interface VariationTree {
  /** Virtual ply-0 node: its children are the possible first moves. */
  root: VariationNode;
  /** FEN before any move (the root's synthetic fenAfter). */
  startFen: string;
}

function syntheticRoot(startFen: string): VariationNode {
  return {
    move: { ply: 0, san: "", uci: "", fenBefore: startFen, fenAfter: startFen },
    main: false,
    parent: null,
    children: [],
  };
}

/** Build a tree whose main chain mirrors `game.moves` exactly. */
export function treeFromGame(game: GameData): VariationTree {
  const startFen = game.moves[0]?.fenBefore ?? game.tags.FEN ?? START_FEN;
  const root = syntheticRoot(startFen);
  let parent = root;
  for (const move of game.moves) {
    const node: VariationNode = { move, main: true, parent, children: [] };
    parent.children.push(node);
    parent = node;
  }
  return { root, startFen };
}

/** The PGN main line as a path (first move → last move). */
export function mainPath(tree: VariationTree): VariationNode[] {
  const path: VariationNode[] = [];
  let node = tree.root.children.find((n) => n.main) ?? null;
  while (node) {
    path.push(node);
    node = node.children.find((n) => n.main) ?? null;
  }
  return path;
}

/** Root→node chain, ordered first move → node (the root itself excluded). */
export function pathFromRoot(node: VariationNode | null): VariationNode[] {
  const path: VariationNode[] = [];
  for (let n = node; n && n.move.ply > 0; n = n.parent) path.push(n);
  return path.reverse();
}

/**
 * Extend a root→node chain along the node's first continuation
 * (children[0] — the PGN line for main nodes, the line the user played
 * for variation nodes) down to a leaf.
 *
 * The *viewed line* must always reach a leaf: when the user jumps to a
 * mid-game node (clicking a chip, or replaying the PGN move after
 * undoing a fork), the moves that follow it stay visible and steppable
 * in the move list — otherwise returning to the real game at the fork
 * point would leave nothing to click or navigate into.
 */
export function extendToLeaf(prefix: readonly VariationNode[]): VariationNode[] {
  const out = prefix.slice();
  let n = prefix[prefix.length - 1];
  while (n && n.children.length > 0) {
    const next: VariationNode = n.children[0]!;
    n = next;
    out.push(next);
  }
  return out;
}

/**
 * The positions a path spans: one per move *before* it is played, plus
 * the final position — the N+1 layout `analyzeGame` expects.
 */
export function pathPositions(tree: VariationTree, path: readonly VariationNode[]): string[] {
  if (path.length === 0) return [tree.startFen];
  const positions = path.map((n) => n.move.fenBefore);
  positions.push(path[path.length - 1]!.move.fenAfter);
  return positions;
}

/** Position shown on the board for a cursor (first `cursor` path moves revealed). */
export function pathPositionAt(
  tree: VariationTree,
  path: readonly VariationNode[],
  cursor: number,
): PositionView {
  const node = cursor > 0 ? path[cursor - 1] : undefined;
  return node
    ? positionView(node.move.fenAfter, node.move.uci)
    : positionView(tree.startFen, null);
}

/** True when the path is a prefix of (or equal to) the PGN main line. */
export function isMainPath(path: readonly VariationNode[]): boolean {
  return path.every((n) => n.main);
}

/**
 * The game's line as the move list displays it: the PGN main chain,
 * extended along first children — which picks up moves the user played
 * straight on from the game's end (they extend the line) but never the
 * alternatives forked mid-game (they are siblings, appended later).
 *
 * This is deliberately independent of the viewed path: the imported
 * game is always the primary line, and alternatives
 * render as branches off it no matter what the board is showing.
 */
export function gameLine(tree: VariationTree): VariationNode[] {
  return extendToLeaf(mainPath(tree));
}

/**
 * Play `uci` from `parent` (the tree's root for a first move): reuses an
 * existing child with the same move (replaying a known line) or creates
 * a new variation node. Returns null when the move is illegal.
 */
export function playMove(parent: VariationNode, uci: string): VariationNode | null {
  const existing = parent.children.find((n) => n.move.uci === uci);
  if (existing) return existing;

  let played: Move;
  try {
    const chess = new Chess(parent.move.fenAfter);
    played = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      ...(uci.length > 4 ? { promotion: uci.slice(4, 5) } : {}),
    });
  } catch {
    return null; // illegal move (or malformed UCI)
  }

  const node: VariationNode = {
    move: {
      ply: parent.move.ply + 1,
      san: played.san,
      uci: `${played.from}${played.to}${played.promotion ?? ""}`,
      fenBefore: played.before,
      fenAfter: played.after,
    },
    main: parent.children.length === 0,
    parent,
    children: [],
  };
  parent.children.push(node);
  return node;
}
