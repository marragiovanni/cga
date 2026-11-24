<script lang="ts">
  /** Board cell — the chessground board (driven by src/ui/board.ts),
   *  the classifier label of the move on the board *below* it, and the
   *  navigation buttons. */
  import { onMount } from "svelte";
  import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, RotateCcw } from "@lucide/svelte";
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
    statusText: string;
    statusIsError: boolean;
    statusIsIdle: boolean;
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
    statusText,
    statusIsError,
    statusIsIdle,
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

  const navigate = (event: MouseEvent, to: "first" | "prev" | "next" | "last"): void => {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    (event.currentTarget as HTMLButtonElement).blur();
    onNav(to);
    requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
  };
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
    <button id="nav-first" type="button" title="First position (Home)" aria-label="First position" onpointerdown={(event) => event.preventDefault()} onclick={(event) => navigate(event, "first")}>
      <ChevronsLeft size={20} aria-hidden="true" />
    </button>
    <button id="nav-prev" type="button" title="Previous move (←)" aria-label="Previous move" onpointerdown={(event) => event.preventDefault()} onclick={(event) => navigate(event, "prev")}>
      <ChevronLeft size={20} aria-hidden="true" />
    </button>
    <button id="nav-next" type="button" title="Next move (→)" aria-label="Next move" onpointerdown={(event) => event.preventDefault()} onclick={(event) => navigate(event, "next")}>
      <ChevronRight size={20} aria-hidden="true" />
    </button>
    <button id="nav-last" type="button" title="Last position (End)" aria-label="Last position" onpointerdown={(event) => event.preventDefault()} onclick={(event) => navigate(event, "last")}>
      <ChevronsRight size={20} aria-hidden="true" />
    </button>
    {#if onFlip}
      <button id="board-flip" type="button" title="Flip board — play as Black (F)" aria-label="Flip board" onpointerdown={(event) => event.preventDefault()} onclick={onFlip}>
        <RotateCcw size={19} aria-hidden="true" />
      </button>
    {/if}
  </div>

  {#if !statusIsIdle}
    <p id="mobile-status" class:error={statusIsError} aria-live="polite">{statusText}</p>
  {/if}
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
    width: 2.8rem;
    min-height: 2.8rem;
    padding: 0.5rem;
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

  #mobile-status {
    display: none;
  }

  @media (max-width: 640px) {
    #board-cell {
      overflow-anchor: none;
    }

    :global(.move-eval-slot) {
      min-height: 4.15rem;
    }

    #mobile-status {
      display: block;
      width: var(--board-w);
      margin-top: 0.65rem;
      padding: 0.6rem 0.75rem;
      color: var(--muted);
      background: rgba(127, 166, 80, 0.08);
      border: 1px solid rgba(127, 166, 80, 0.18);
      border-radius: 8px;
      font-size: 0.84rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      line-height: 1.35;
    }

    #mobile-status.error {
      color: var(--danger);
      background: rgba(239, 68, 68, 0.08);
      border-color: rgba(239, 68, 68, 0.25);
    }

    :global(:root.light) #mobile-status {
      background: rgba(91, 140, 42, 0.06);
      border-color: rgba(91, 140, 42, 0.18);
    }
  }
</style>
