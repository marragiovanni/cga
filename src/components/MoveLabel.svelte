<script lang="ts">
  /**
   * MoveLabel — prominent evaluation card displayed directly under the chessboard.
   *
   * Displays the classification (Best, Book, Good, Inaccuracy, Mistake, Blunder)
   * with high-contrast badge colors, icons, move name, and loss context.
   *
   * Preserves `#move-label` text and hidden state for test suite assertions.
   */
  import {
    BadgeAlert,
    BookOpen,
    CircleCheck,
    CircleX,
    Lightbulb,
    LoaderCircle,
    OctagonAlert,
    Star,
    ThumbsUp,
    TriangleAlert,
  } from "@lucide/svelte";

  interface Props {
    label: string | null;
    pending: boolean;
    san?: string | null;
    moveNo?: number | null;
    isWhite?: boolean;
    cpLoss?: number | null;
  }

  let { label, pending, san = null, moveNo = null, isWhite = true, cpLoss = null }: Props = $props();

  const DESCRIPTIONS: Record<string, string> = {
    book: "Classical opening theory",
    best: "Engine top choice",
    good: "Solid move",
    acceptable: "Maintains position",
    inaccuracy: "Suboptimal move",
    mistake: "Noticeable disadvantage",
    blunder: "Serious mistake",
  };

  const movePrefix = $derived.by(() => {
    if (!moveNo || !san) return san ?? "";
    return isWhite ? `${moveNo}. ${san}` : `${moveNo}... ${san}`;
  });

  const formattedLoss = $derived.by(() => {
    if (cpLoss === null || cpLoss === undefined || label === "book") return null;
    if (cpLoss === 0) return "0.00 cp loss";
    return `-${(cpLoss / 100).toFixed(2)} cp`;
  });
</script>

<div class="move-eval-slot">
  {#if pending}
    <div class="eval-card pending">
      <span class="spinner" aria-hidden="true"><LoaderCircle size={21} /></span>
      <div class="card-content">
        <div class="card-header">
          {#if movePrefix}<span class="move-name">{movePrefix}</span>{/if}
          <span id="move-label" class="pending-text" aria-live="polite">…</span>
        </div>
        <span class="desc">Evaluating with Stockfish…</span>
      </div>
    </div>
  {:else if label}
    <div class="eval-card {label}">
      <div class="badge-icon" aria-hidden="true">
        {#if label === "book"}
          <BookOpen />
        {:else if label === "best"}
          <Star fill="currentColor" />
        {:else if label === "good"}
          <ThumbsUp />
        {:else if label === "acceptable"}
          <CircleCheck />
        {:else if label === "inaccuracy"}
          <TriangleAlert />
        {:else if label === "mistake"}
          <BadgeAlert />
        {:else if label === "blunder"}
          <OctagonAlert />
        {:else}
          <CircleX />
        {/if}
      </div>
      <div class="card-content">
        <div class="card-header">
          {#if movePrefix}
            <span class="move-name">{movePrefix}</span>
          {/if}
          <span
            id="move-label"
            class="label-badge {label}"
            aria-live="polite"
          >{label}</span>
        </div>
        <div class="card-footer">
          <span class="desc">{DESCRIPTIONS[label] ?? ""}</span>
          {#if formattedLoss}
            <span class="loss-metric">{formattedLoss}</span>
          {/if}
        </div>
      </div>
    </div>
  {:else}
    <div class="eval-card idle">
      <span class="idle-icon" aria-hidden="true"><Lightbulb size={18} /></span>
      <span class="idle-text">
        {movePrefix ? `${movePrefix} — Click Analyze for evaluation` : "Play or navigate moves to analyze"}
      </span>
      <span id="move-label" hidden aria-hidden="true"></span>
    </div>
  {/if}
</div>

<style>
  .move-eval-slot {
    width: var(--board-w);
    margin-top: 0.65rem;
    display: flex;
    justify-content: center;
  }

  .eval-card {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.55rem 0.95rem;
    background: var(--panel);
    border: 1px solid var(--panel-edge);
    border-radius: var(--radius);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    transition: all 0.2s ease;
  }

  .badge-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
  }

  .badge-icon :global(svg) {
    width: 1.35rem;
    height: 1.35rem;
    stroke-width: 2;
  }

  .card-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .move-name {
    font-weight: 750;
    font-size: 1.05rem;
    color: var(--fg-strong);
    letter-spacing: 0.01em;
  }

  .label-badge {
    font-size: 0.8rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    padding: 0.15rem 0.65rem;
    border-radius: 999px;
    color: #111411;
    line-height: 1.3;
    display: inline-block;
  }

  .card-footer {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    font-size: 0.78rem;
  }

  .desc {
    color: var(--muted);
  }

  .loss-metric {
    font-family: ui-monospace, monospace;
    font-weight: 600;
    color: var(--fg);
    background: rgba(0, 0, 0, 0.25);
    padding: 0.05rem 0.4rem;
    border-radius: 4px;
  }

  :global(:root.light) .loss-metric {
    background: rgba(0, 0, 0, 0.06);
  }

  /* Specific theme accents for labels */
  .eval-card.best {
    border-color: rgba(34, 197, 94, 0.4);
    box-shadow: 0 4px 18px rgba(34, 197, 94, 0.15);
  }
  .eval-card.best .badge-icon {
    background: rgba(34, 197, 94, 0.15);
  }
  .label-badge.best {
    background: #22c55e;
    color: #052e16;
  }

  .eval-card.book {
    border-color: rgba(127, 166, 80, 0.4);
    box-shadow: 0 4px 18px rgba(127, 166, 80, 0.15);
  }
  .eval-card.book .badge-icon {
    background: rgba(127, 166, 80, 0.15);
  }
  .label-badge.book {
    background: #7fa650;
    color: #142806;
  }

  .eval-card.good {
    border-color: rgba(59, 130, 246, 0.4);
  }
  .eval-card.good .badge-icon {
    background: rgba(59, 130, 246, 0.15);
  }
  .label-badge.good {
    background: #3b82f6;
    color: #eff6ff;
  }

  .eval-card.acceptable {
    border-color: rgba(148, 163, 184, 0.3);
  }
  .eval-card.acceptable .badge-icon {
    background: rgba(148, 163, 184, 0.12);
  }
  .label-badge.acceptable {
    background: #94a3b8;
    color: #0f172a;
  }

  .eval-card.inaccuracy {
    border-color: rgba(234, 179, 8, 0.45);
    box-shadow: 0 4px 18px rgba(234, 179, 8, 0.12);
  }
  .eval-card.inaccuracy .badge-icon {
    background: rgba(234, 179, 8, 0.15);
  }
  .label-badge.inaccuracy {
    background: #eab308;
    color: #422006;
  }

  .eval-card.mistake {
    border-color: rgba(249, 115, 22, 0.5);
    box-shadow: 0 4px 18px rgba(249, 115, 22, 0.15);
  }
  .eval-card.mistake .badge-icon {
    background: rgba(249, 115, 22, 0.15);
  }
  .label-badge.mistake {
    background: #f97316;
    color: #431407;
  }

  .eval-card.blunder {
    border-color: rgba(239, 68, 68, 0.6);
    box-shadow: 0 4px 20px rgba(239, 68, 68, 0.25);
  }
  .eval-card.blunder .badge-icon {
    background: rgba(239, 68, 68, 0.2);
  }
  .label-badge.blunder {
    background: #ef4444;
    color: #ffffff;
  }

  /* Pending / Analyzing state */
  .eval-card.pending {
    border-color: rgba(127, 166, 80, 0.3);
    animation: card-pulse 1.4s ease-in-out infinite;
  }

  .spinner {
    display: flex;
    color: var(--accent);
    animation: spin 2s linear infinite;
  }

  .pending-text {
    font-size: 1.1rem;
    font-weight: 800;
    color: var(--accent);
    letter-spacing: 0.2em;
  }

  /* Idle state */
  .eval-card.idle {
    opacity: 0.75;
    padding: 0.5rem 0.95rem;
    background: rgba(35, 37, 41, 0.6);
  }

  :global(:root.light) .eval-card.idle {
    opacity: 1;
    background: var(--bg);
  }

  .idle-icon {
    display: flex;
    opacity: 0.7;
  }

  .idle-text {
    font-size: 0.85rem;
    color: var(--muted);
  }

  :global(:root.light) .eval-card.idle .idle-text {
    color: #4b5563;
  }

  @keyframes card-pulse {
    50% { border-color: rgba(127, 166, 80, 0.6); }
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
</style>
