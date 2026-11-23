/**
 * Board UI — wraps chessground as an *interactive* board.
 *
 * The rest of the app never touches chessground: it calls
 * `setPosition()` with a FEN + last move + check flag, and chessground
 * animates the transition. In the other direction, a completed user
 * drag/click move is reported through `handlers.onMove(uci)`; the app
 * validates it and must call `setPosition()` afterwards (re-applying
 * the current position snaps the board back when a move is rejected).
 *
 * Only legal moves are offered: dests come from chess.js for the side
 * to move, so dragging is restricted exactly like a real game. When a
 * pawn reaches the last rank a small promotion picker opens (chessground
 * has none built in); dismissing it snaps the pawn back.
 *
 * `setLocked(true)` freezes the board (used while a full analysis run
 * is active) by clearing `movable.color`.
 */

import { Chess } from "chess.js";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Key } from "@lichess-org/chessground/types";

import type { PositionView } from "../chess/game.ts";

export interface BoardApi {
  /** Show a position; chessground animates the transition. */
  setPosition(position: PositionView): void;
  /** Draw (or clear, with null) the engine's best-move arrow. Survives
   *  subsequent setPosition calls — the FEN update resets shapes. */
  setArrow(uci: string | null): void;
  /** Piece-placement FEN currently displayed (for tests). */
  fen(): string;
  /** Freeze/unfreeze piece movement (analysis run in progress). */
  setLocked(locked: boolean): void;
  /** Flip the board (white at the bottom ↔ black at the bottom). */
  setOrientation(orientation: "white" | "black"): void;
}

export interface BoardHandlers {
  /** A move completed on the board (UCI, promotion suffix included). */
  onMove?: (uci: string) => void;
}

/**
 * Legal destination squares for the side to move in `fen` — the map
 * chessground needs (`orig → [dest, …]`), straight from chess.js.
 */
export function legalDests(fen: string): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  try {
    const chess = new Chess(fen);
    for (const move of chess.moves({ verbose: true })) {
      const from = move.from as Key;
      const to = move.to as Key;
      const list = dests.get(from);
      if (list) {
        if (!list.includes(to)) list.push(to); // promotion: same from/to ×4
      } else {
        dests.set(from, [to]);
      }
    }
  } catch {
    // Unparseable FEN: no moves, board stays put.
  }
  return dests;
}

/** True when moving `orig` → `dest` in `fen` promotes a pawn. */
export function needsPromotion(fen: string, orig: string, dest: string): boolean {
  if (dest[1] !== "1" && dest[1] !== "8") return false;
  try {
    const chess = new Chess(fen);
    return chess.get(orig as Parameters<Chess["get"]>[0])?.type === "p";
  } catch {
    return false;
  }
}

const PROMOTION_ROLES: [string, string][] = [
  ["q", "♕"],
  ["r", "♖"],
  ["b", "♗"],
  ["n", "♘"],
];

export function initBoard(root: HTMLElement, handlers: BoardHandlers = {}): BoardApi {
  let arrow: string | null = null;
  let currentView: PositionView | null = null;
  let locked = false;
  let orientation: "white" | "black" = "white";
  let pending: { orig: Key; dest: Key } | null = null;
  let promotionEl: HTMLElement | null = null;

  const applyArrow = (): void => {
    const uci = arrow;
    const drawable = uci !== null && uci !== "(none)" && uci.length >= 4;
    api.setShapes(
      drawable
        ? [{ brush: "green", orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key }]
        : [],
    );
  };

  const removePromotion = (): void => {
    promotionEl?.remove();
    promotionEl = null;
    pending = null;
    document.removeEventListener("mousedown", onOutsidePromotion, true);
    document.removeEventListener("keydown", onPromotionKey, true);
  };

  function onOutsidePromotion(event: Event): void {
    // Clicks on the picker itself are not dismissals.
    if (promotionEl?.contains(event.target as Node)) return;
    cancelPromotion();
  }

  function onPromotionKey(event: Event): void {
    if ((event as KeyboardEvent).key === "Escape") cancelPromotion();
  }

  const cancelPromotion = (): void => {
    if (!pending) return;
    removePromotion();
    if (currentView) syncPosition(currentView); // snap the pawn back
  };

  const choosePromotion = (role: string): void => {
    if (!pending) return;
    const { orig, dest } = pending;
    removePromotion();
    // The app validates and calls setPosition() to finish the move.
    handlers.onMove?.(`${orig}${dest}${role}`);
  };

  const openPromotion = (orig: Key, dest: Key): void => {
    pending = { orig, dest };
    api.set({ movable: { color: undefined } }); // block further moves

    const box = document.createElement("div");
    box.className = "promotion";
    const color = (currentView?.fen.split(" ")[1] ?? "w") === "w" ? "white" : "black";
    for (const [role, glyph] of PROMOTION_ROLES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `promotion-piece ${color}`;
      button.textContent = glyph;
      button.title = `promote to ${role}`;
      button.addEventListener("click", () => choosePromotion(role));
      box.appendChild(button);
    }
    // Drop the picker over the destination square. The visual y of a
    // square depends on the orientation: white pov has rank 8 at the
    // top, black pov has rank 1 there.
    const file = dest.charCodeAt(0) - 97;
    const rank = Number(dest[1]);
    box.style.left = `${file * 12.5}%`;
    box.style.top = `${(orientation === "white" ? 8 - rank : rank - 1) * 12.5}%`;
    root.appendChild(box);
    promotionEl = box;

    document.addEventListener("mousedown", onOutsidePromotion, true);
    document.addEventListener("keydown", onPromotionKey, true);
  };

  const onAfterMove = (orig: Key, dest: Key): void => {
    if (needsPromotion(currentView?.fen ?? "", orig, dest)) {
      openPromotion(orig, dest);
      return;
    }
    handlers.onMove?.(`${orig}${dest}`);
  };

  const api: Api = Chessground(root, {
    animation: { enabled: true, duration: 150 },
    highlight: { lastMove: true, check: true },
    drawable: { enabled: false, visible: true },
    coordinates: true,
    // Automated checks drive the board with synthetic pointer events;
    // for a local, offline tool this only widens what can move pieces.
    trustAllEvents: true,
    movable: {
      free: false,
      color: undefined, // until the first setPosition (nothing movable)
      showDests: true,
      events: { after: onAfterMove },
    },
  });

  function syncPosition(position: PositionView): void {
    currentView = position;
    const turnColor = position.fen.split(" ")[1] === "b" ? "black" : "white";
    api.set({
      fen: position.fen,
      turnColor,
      lastMove: position.lastMove ? [position.lastMove[0] as Key, position.lastMove[1] as Key] : undefined,
      check: position.check === "w" ? "white" : position.check === "b" ? "black" : false,
      movable: {
        color: locked ? undefined : turnColor,
        dests: legalDests(position.fen),
      },
    });
    applyArrow(); // passing a FEN resets chessground's shapes
  }

  return {
    setPosition(position): void {
      removePromotion(); // navigating away discards a pending choice
      syncPosition(position);
    },
    setArrow(uci): void {
      arrow = uci;
      applyArrow();
    },
    fen: () => api.getFen(),
    setLocked(next): void {
      locked = next;
      root.classList.toggle("locked", locked);
      if (locked) removePromotion();
      if (currentView) syncPosition(currentView); // re-apply movability
    },
    setOrientation(next): void {
      orientation = next;
      api.set({ orientation });
    },
  };
}
