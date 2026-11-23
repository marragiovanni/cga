<script lang="ts">
  /** Board cell — the chessground board (driven by src/ui/board.ts),
   *  the classifier label of the move on the board *below* it, and the
   *  navigation buttons. */
  import { onMount } from "svelte";
  import type { PositionView } from "../chess/game.ts";
  import { initBoard, type BoardApi } from "../ui/board.ts";
  import MoveLabel from "./MoveLabel.svelte";

  interface Props {
    position: PositionView;
    /** Bumped to force a re-application of `position` (snap-back). */
    nonce?: number;
    arrow: string | null;
    locked: boolean;
    /** Classifier label of the move on the board (null = none yet). */
    moveLabel: string | null;
    /** True while a live search for the shown move is in flight. */
    labelPending: boolean;
    /** Which side sits at the bottom of the board. */
    orientation?: "white" | "black";
    san?: string | null;
    moveNo?: number | null;
    isWhite?: boolean;
    cpLoss?: number | null;
    onMove: (uci: string) => void;
    onNav: (to: "first" | "prev" | "next" | "last") => void;
    /** Flip the board (user request, e.g. analyzing as Black). */
    onFlip?: () => void;
  }

  let {
    position,
    nonce = 0,
    arrow,
    locked,
    moveLabel,
    labelPending,
    orientation = "white",
    san = null,
    moveNo = null,
    isWhite = true,
    cpLoss = null,
    onMove,
    onNav,
    onFlip,
  }: Props = $props();

  let boardEl = $state<HTMLDivElement | null>(null);
  let board = $state<BoardApi | null>(null);

  onMount(() => {
    if (!boardEl) return;
    board = initBoard(boardEl, { onMove });
  });

  // Position + arrow in ONE effect: every application ends with the
  // current arrow, so no stale arrow can survive a navigation
  $effect(() => {
    void nonce;
    if (!board) return;
    board.setPosition(position);
    board.setArrow(arrow);
  });

  $effect(() => {
    if (board) board.setLocked(locked);
  });

  $effect(() => {
    if (board) board.setOrientation(orientation);
  });
</script>

<div id="board-cell">
  <div id="board" bind:this={boardEl} aria-label="chessboard"></div>

  <MoveLabel
    label={moveLabel}
    pending={labelPending}
    {san}
    {moveNo}
    {isWhite}
    {cpLoss}
  />

  <div id="nav" role="group" aria-label="position navigation">
    <button id="nav-first" type="button" title="First position (Home)" onclick={() => onNav("first")}>
      ⏮
    </button>
    <button id="nav-prev" type="button" title="Previous move (←)" onclick={() => onNav("prev")}>
      ◀
    </button>
    <button id="nav-next" type="button" title="Next move (→)" onclick={() => onNav("next")}>
      ▶
    </button>
    <button id="nav-last" type="button" title="Last position (End)" onclick={() => onNav("last")}>
      ⏭
    </button>
    {#if onFlip}
      <button id="board-flip" type="button" title="Flip board — play as Black (F)" onclick={onFlip}>
        ⇅
      </button>
    {/if}
  </div>
</div>

<style>
  #nav {
    display: flex;
    justify-content: center;
    gap: 0.6rem;
    margin-top: 0.65rem;
    width: var(--board-w);
  }

  #nav button {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.4rem 1.1rem;
    font-size: 1rem;
    background: var(--panel);
    color: var(--fg);
    border: 1px solid var(--panel-edge);
    border-radius: 8px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    transition: all 0.15s ease;
  }

  #nav button:hover {
    border-color: var(--accent);
    background: rgba(255, 255, 255, 0.08);
    box-shadow: 0 0 10px rgba(127, 166, 80, 0.35);
    transform: translateY(-1px);
  }

  #nav button:active {
    transform: translateY(0);
  }
</style>
