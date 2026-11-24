<script lang="ts">
  /** Sidebar — game info, opening name, engine readout for the position
   *  on the board (best move, score, continuation) and the eval bar.
   *  All values are derived snapshots: null resets to "–". */
  import type { GameData } from "../chess/game.ts";
  import type { OpeningInfo } from "../book/book.ts";
  import { evalBarFraction } from "../ui/score.ts";

  export interface EngineInfoView {
    /** Best move in SAN (null when there is no legal move). */
    bestMove: string | null;
    /** Formatted White-relative score, e.g. "+0.35" or "-M2". */
    score: string | null;
    /** First few plies of the principal variation, SAN. */
    pv: string | null;
  }

  interface Props {
    game: GameData | null;
    opening: OpeningInfo | null;
    engineInfo: EngineInfoView | null;
    /** White-relative evaluation in centipawns (null → neutral 50%). */
    evalCp: number | null;
  }

  let { game, opening, engineInfo, evalCp }: Props = $props();

  const fraction = $derived(evalBarFraction(evalCp));
  const fractionPct = $derived(Math.round(fraction * 100));
</script>

<section id="sidebar" class="panel">
  <!-- Game info -->
  <div class="info-block">
    <h3 class="section-title">Game</h3>
    <dl id="game-info">
      <dt>White</dt>
      <dd id="game-white">{game?.white || "–"}</dd>
      <dt>Black</dt>
      <dd id="game-black">{game?.black || "–"}</dd>
      <dt>Result</dt>
      <dd id="game-result">{game?.result || "–"}</dd>
    </dl>
  </div>

  <!-- Opening -->
  {#if opening}
    <div class="opening-badge" title={opening.name}>
      <span class="eco-code">{opening.eco}</span>
      <span class="opening-name">{opening.name}</span>
    </div>
  {:else}
    <div class="opening-badge empty">
      <span id="opening">–</span>
    </div>
  {/if}

  <!-- Eval bar -->
  <div class="eval-section">
    <h3 class="section-title">Evaluation</h3>
    <div class="eval-row">
      <span class="eval-king w" aria-hidden="true">♔</span>
      <div id="eval-bar">
        <div id="eval-fill" style:width={`${fraction * 100}%`}></div>
      </div>
      <span
        id="eval-pct"
        class:white-advantage={fractionPct > 55}
        class:black-advantage={fractionPct < 45}
        title={`White's win probability: ${fractionPct}%`}
      >
        {fractionPct}%
      </span>
      <span class="eval-king b" aria-hidden="true">♚</span>
    </div>
  </div>

  <!-- Engine info -->
  <div class="info-block">
    <h3 class="section-title">Engine</h3>
    <dl id="engine-info">
      <dt>Best move</dt>
      <dd id="best-move" class:highlight={engineInfo?.bestMove}>{engineInfo?.bestMove ?? "–"}</dd>
      <dt>Score</dt>
      <dd id="score">{engineInfo?.score ?? "–"}</dd>
      <dt>Continuation</dt>
      <dd id="pv">{engineInfo?.pv || "–"}</dd>
    </dl>
  </div>
</section>

<style>
  #sidebar {
    grid-area: sidebar;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .section-title {
    margin: 0 0 0.35rem;
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .section-title::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--panel-edge);
  }

  .info-block {
    padding-bottom: 0.35rem;
  }

  #game-info {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.35rem 1rem;
    margin: 0;
    font-size: 0.9rem;
  }

  #game-info dt,
  #engine-info dt {
    color: var(--muted);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
  }

  #game-info dd {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Opening badge */
  .opening-badge {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.4rem 0.65rem;
    background: rgba(127, 166, 80, 0.08);
    border: 1px solid rgba(127, 166, 80, 0.18);
    border-radius: 8px;
    overflow: hidden;
    transition: all 0.2s ease;
  }

  .opening-badge.empty {
    background: transparent;
    border-color: transparent;
  }

  .eco-code {
    font-family: ui-monospace, monospace;
    font-weight: 800;
    font-size: 0.78rem;
    color: var(--accent);
    padding: 0.1rem 0.4rem;
    background: rgba(127, 166, 80, 0.15);
    border-radius: 4px;
    white-space: nowrap;
    letter-spacing: 0.03em;
  }

  .opening-name {
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Eval bar */
  .eval-section {
    padding-bottom: 0.15rem;
  }

  .eval-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }

  .eval-king {
    font-size: 1.15rem;
    line-height: 1;
    text-shadow: 0 0 8px rgba(255, 255, 255, 0.15);
  }

  .eval-king.w { color: #f2f2f5; }
  .eval-king.b { color: #62626c; }

  :global(:root.light) .eval-king.w { color: #555; }
  :global(:root.light) .eval-king.b { color: #222; }

  #eval-bar {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 1.5rem;
    background: linear-gradient(180deg, #141418, #202026);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 999px;
    overflow: hidden;
    box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.6);
  }

  /* The unfilled side of the bar is Black's share, so it must stay dark
     in light mode too — only the chrome around it gets lighter. */
  :global(:root.light) #eval-bar {
    border-color: rgba(0, 0, 0, 0.12);
    box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.1);
  }

  #eval-bar::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: rgba(127, 166, 80, 0.85);
    box-shadow: 0 0 6px rgba(127, 166, 80, 0.7);
    z-index: 1;
  }

  #eval-fill {
    height: 100%;
    width: 50%;
    background: linear-gradient(180deg, #ffffff 0%, #e7e7ec 60%, #d3d3da 100%);
    box-shadow: inset 0 -1px 2px rgba(0, 0, 0, 0.15), 0 0 10px rgba(255, 255, 255, 0.25);
    transition: width 0.45s cubic-bezier(0.22, 1, 0.36, 1);
  }

  :global(:root.light) #eval-fill {
    background: linear-gradient(180deg, #ffffff 0%, #fafafa 60%, #f0f0f0 100%);
    box-shadow: inset 0 -1px 2px rgba(0, 0, 0, 0.08), 0 0 6px rgba(255, 255, 255, 0.5);
  }

  #eval-pct {
    min-width: 3.1rem;
    padding: 0.15rem 0.45rem;
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    font-weight: 700;
    text-align: center;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 999px;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.45);
    font-variant-numeric: tabular-nums;
    transition: color var(--transition-fast);
  }

  #eval-pct.white-advantage { color: #f2f2f5; }
  #eval-pct.black-advantage { color: #9a9aa2; }

  /* On the light page the pill background is light, so the advantage
     colours above would be invisible; use readable dark text instead. */
  :global(:root.light) #eval-pct.white-advantage { color: var(--fg-strong); }
  :global(:root.light) #eval-pct.black-advantage { color: #4b5563; }

  :global(:root.light) #eval-pct {
    border-color: rgba(0, 0, 0, 0.1);
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.08);
  }

  /* Engine info */
  #engine-info {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.35rem 1rem;
    margin: 0;
    font-size: 0.9rem;
  }

  #engine-info dd {
    margin: 0;
    font-family: ui-monospace, monospace;
    overflow-wrap: anywhere;
  }

  #best-move.highlight {
    color: var(--accent);
    font-weight: 700;
  }
</style>
