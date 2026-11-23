<script lang="ts">
  /** Inputs — PGN textarea, ELO fields, analyze button, progress bar,
   *  match accuracy card, and status line. */
  interface Props {
    pgn?: string;
    eloWhite?: number | null;
    eloBlack?: number | null;
    running: boolean;
    progressVisible: boolean;
    progressPct: number;
    statusText: string;
    statusIsError: boolean;
    statusIsIdle: boolean;
    whiteAccuracy?: number | null;
    blackAccuracy?: number | null;
    onPgnInput: () => void;
    onAnalyze: () => void;
  }

  let {
    pgn = $bindable(""),
    eloWhite = $bindable<number | null>(1500),
    eloBlack = $bindable<number | null>(1500),
    running,
    progressVisible,
    progressPct,
    statusText,
    statusIsError,
    statusIsIdle,
    whiteAccuracy = null,
    blackAccuracy = null,
    onPgnInput,
    onAnalyze,
  }: Props = $props();

  const accuracyLevel = (val: number | null): string => {
    if (val === null) return "";
    if (val >= 90) return "excellent";
    if (val >= 75) return "good";
    if (val >= 60) return "fair";
    return "poor";
  };
</script>

<section id="inputs" class="panel">
  <div class="panel-header">
    <label class="field-label" for="pgn">
      <span class="label-icon" aria-hidden="true">📋</span>
      PGN Game Import
    </label>
  </div>

  <textarea
    id="pgn"
    placeholder="Paste a PGN here or play moves on the board…"
    bind:value={pgn}
    oninput={onPgnInput}
  ></textarea>

  <div class="elo-row">
    <label class="elo-field">
      <span class="elo-title">♔ White ELO</span>
      <input id="elo-white" type="number" min="0" max="4000" bind:value={eloWhite} />
    </label>
    <label class="elo-field">
      <span class="elo-title">♚ Black ELO</span>
      <input id="elo-black" type="number" min="0" max="4000" bind:value={eloBlack} />
    </label>
  </div>

  <button id="analyze-btn" type="button" class:cancel={running} onclick={onAnalyze}>
    {#if running}
      <span class="btn-icon" aria-hidden="true">⏹</span> Cancel…
    {:else}
      <span class="btn-icon" aria-hidden="true">▶</span> Analyze
    {/if}
  </button>

  {#if progressVisible}
    <div id="progress" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
      <div id="progress-bar" style:width={`${progressPct}%`}></div>
    </div>
  {/if}

  {#if whiteAccuracy !== null && blackAccuracy !== null}
    <div class="accuracy-card">
      <div class="accuracy-title">Game Accuracy</div>
      <div class="accuracy-grid">
        <div class="accuracy-side white">
          <span class="side-name">♔ White</span>
          <span class="accuracy-val {accuracyLevel(whiteAccuracy)}">{whiteAccuracy.toFixed(0)}%</span>
        </div>
        <div class="accuracy-divider" aria-hidden="true"></div>
        <div class="accuracy-side black">
          <span class="side-name">♚ Black</span>
          <span class="accuracy-val {accuracyLevel(blackAccuracy)}">{blackAccuracy.toFixed(0)}%</span>
        </div>
      </div>
    </div>
  {/if}

  <p id="status" class:idle={statusIsIdle} class:error={statusIsError}>{statusText}</p>
</section>

<style>
  #inputs {
    grid-area: inputs;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #3f404a transparent;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.35rem;
  }

  .field-label {
    color: var(--muted);
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .label-icon {
    font-size: 0.85rem;
  }

  .elo-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-top: 0.65rem;
  }

  .elo-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.45rem 0.65rem;
    background: var(--bg);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    cursor: text;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  :global(:root.light) .elo-field {
    border-color: rgba(0, 0, 0, 0.1);
    background: rgba(0, 0, 0, 0.03);
  }

  .elo-title {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }

  .elo-field:hover { border-color: rgba(255, 255, 255, 0.18); }
  :global(:root.light) .elo-field:hover { border-color: rgba(0, 0, 0, 0.2); }

  .elo-field:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .elo-field input {
    width: 100%;
    background: transparent;
    color: var(--fg);
    border: none;
    padding: 0;
    font-size: 1.05rem;
    font-weight: 600;
    font-family: inherit;
  }

  .elo-field input:focus { outline: none; }

  #analyze-btn {
    width: 100%;
    margin-top: 0.85rem;
    padding: 0.65rem 1.25rem;
    font-size: 0.95rem;
    font-weight: 750;
    letter-spacing: 0.02em;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
  }

  .btn-icon {
    font-size: 0.85rem;
  }

  #progress {
    margin-top: 0.75rem;
    height: 8px;
    background: var(--bg);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 999px;
    overflow: hidden;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.45);
  }

  :global(:root.light) #progress {
    border-color: rgba(0, 0, 0, 0.08);
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.08);
  }

  #progress-bar {
    height: 100%;
    width: 0%;
    background: linear-gradient(90deg, #6f9a45, #a3d470);
    border-radius: 999px;
    transition: width 0.2s;
  }

  /* Match Accuracy Card */
  .accuracy-card {
    margin-top: 0.85rem;
    padding: 0.65rem 0.85rem;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(127, 166, 80, 0.25);
    border-radius: 8px;
    animation: slide-up 0.3s ease-out;
  }

  :global(:root.light) .accuracy-card {
    background: rgba(127, 166, 80, 0.06);
    border-color: rgba(127, 166, 80, 0.2);
  }

  @keyframes slide-up {
    from { opacity: 0; transform: translateY(6px); }
  }

  .accuracy-title {
    font-size: 0.7rem;
    font-weight: 750;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    text-align: center;
    margin-bottom: 0.45rem;
  }

  .accuracy-grid {
    display: flex;
    align-items: center;
    justify-content: space-around;
  }

  .accuracy-side {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
  }

  .side-name {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--muted);
  }

  .accuracy-val {
    font-size: 1.25rem;
    font-weight: 800;
    color: var(--accent);
    font-family: ui-monospace, monospace;
    transition: color 0.3s ease;
  }

  .accuracy-val.excellent { color: #22c55e; }
  .accuracy-val.good { color: var(--accent); }
  .accuracy-val.fair { color: #eab308; }
  .accuracy-val.poor { color: #ef4444; }

  .accuracy-divider {
    width: 1px;
    height: 1.8rem;
    background: rgba(255, 255, 255, 0.1);
  }

  :global(:root.light) .accuracy-divider {
    background: rgba(0, 0, 0, 0.1);
  }

  #status {
    margin: 0.75rem 0 0;
    font-size: 0.82rem;
    color: var(--fg);
    line-height: 1.4;
    word-break: break-word;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    padding-top: 0.65rem;
  }

  :global(:root.light) #status {
    border-top-color: rgba(0, 0, 0, 0.06);
  }

  #status.idle {
    color: var(--muted);
    font-style: italic;
  }

  #status.error {
    color: var(--danger);
  }

  @media (max-width: 640px) {
    .elo-row {
      grid-template-columns: 1fr;
      gap: 0.5rem;
    }
  }
</style>
