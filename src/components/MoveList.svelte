<script lang="ts">
  /**
   * Move list — renders the GAME's line (the imported PGN) as the
   * primary 2-column table (Turn # | White | Black),
   * with alternatives rendered as indented variation branches — no
   * matter which line the board is currently viewing. Branches nest
   * recursively: a fork inside a variation shows inside that branch.
   *
   * Move classification labels are not shown in the move list (they are
   * placed prominently under the board), but the `data-label` attribute is
   * preserved for automated testing and inspection.
   */
  import type { MoveClassification } from "../classifier/classifier.ts";
  import { gameLine, type VariationNode, type VariationTree } from "../chess/variation.ts";

  interface Props {
    tree: VariationTree | null;
    path: readonly VariationNode[];
    cursor: number;
    /** Bumped whenever the engine cache gains results. */
    version?: number;
    classify: (node: VariationNode) => MoveClassification | null;
    result: string | null;
    onJump: (node: VariationNode) => void;
  }

  let props: Props = $props();

  interface VarItem {
    node: VariationNode;
    moveNo: string | null;
    label: string | null;
    /** Alternatives to this move's continuation (nested branches). */
    subs: VarBranch[];
  }

  interface VarBranch {
    id: string;
    items: VarItem[];
  }

  interface TurnRow {
    turnNumber: number;
    white: { node: VariationNode; label: string | null } | null;
    black: { node: VariationNode; label: string | null } | null;
    variations: VarBranch[];
  }

  /**
   * Variation chains branching off `parent`, i.e. every child except
   * the one the rendered line continues along. Each chain follows the
   * child's own first continuation down to a leaf, and chain moves
   * with siblings of their own recurse into nested branches.
   */
  function getVariations(parent: VariationNode | null, lineChild: VariationNode | null, classifyFn: typeof props.classify): VarBranch[] {
    if (!parent || parent.children.length < 2) return [];
    const branches: VarBranch[] = [];

    for (const sibling of parent.children) {
      if (sibling === lineChild) continue;
      const items: VarItem[] = [];
      let curr: VariationNode | null = sibling;
      let first = true;

      while (curr) {
        const ply = curr.move.ply;
        let moveNo: string | null = null;
        if (ply % 2 === 1) {
          moveNo = `${(ply + 1) / 2}.`;
        } else if (first) {
          moveNo = `${ply / 2}...`;
        }

        items.push({
          node: curr,
          moveNo,
          label: classifyFn(curr)?.label ?? null,
          subs: getVariations(curr, curr.children[0] ?? null, classifyFn),
        });

        first = false;
        curr = curr.children[0] ?? null;
      }

      if (items.length > 0) {
        branches.push({
          id: `var-${sibling.move.ply}-${sibling.move.uci}`,
          items,
        });
      }
    }
    return branches;
  }

  const turnRows = $derived.by((): TurnRow[] => {
    void props.version; // re-derive when labels land
    // Reading the viewed path keeps this derivation live across forks:
    // tree mutations alone don't trigger (same object reference), but
    // every fork/re-slice reassigns `path` too.
    void props.path;
    const tree = props.tree;
    if (!tree) return [];
    const line = gameLine(tree);
    if (line.length === 0) return [];

    const rows: TurnRow[] = [];
    let i = 0;

    while (i < line.length) {
      const node1 = line[i]!;
      const ply1 = node1.move.ply;
      const turnNumber = Math.ceil(ply1 / 2);

      let whiteNode: VariationNode | null = null;
      let blackNode: VariationNode | null = null;
      const rowVariations: VarBranch[] = [];

      if (ply1 % 2 === 1) {
        // White move
        whiteNode = node1;
        rowVariations.push(...getVariations(node1.parent, node1, props.classify));
        i++;

        // Check if next move is Black's move in the same turn
        if (i < line.length && line[i]!.move.ply === ply1 + 1) {
          blackNode = line[i]!;
          rowVariations.push(...getVariations(blackNode.parent, blackNode, props.classify));
          i++;
        }
      } else {
        // Line started with a Black move (e.g. a FEN-started game)
        blackNode = node1;
        rowVariations.push(...getVariations(node1.parent, node1, props.classify));
        i++;
      }

      rows.push({
        turnNumber,
        white: whiteNode ? { node: whiteNode, label: props.classify(whiteNode)?.label ?? null } : null,
        black: blackNode ? { node: blackNode, label: props.classify(blackNode)?.label ?? null } : null,
        variations: rowVariations,
      });
    }

    return rows;
  });

  const activeNode = $derived(props.cursor > 0 ? (props.path[props.cursor - 1] ?? null) : null);

  let listEl = $state<HTMLElement | null>(null);

  // Auto-scroll the active move inside the list only. `scrollIntoView()`
  // also scrolls ancestor scrollers — on mobile that means the page,
  // which yanks the board out of view when a move is played.
  $effect(() => {
    void props.cursor;
    void turnRows;
    if (!listEl) return;
    const active = listEl.querySelector<HTMLElement>(".ply.active");
    if (!active) return;
    const listRect = listEl.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    const pad = 4;
    if (itemRect.top < listRect.top + pad) {
      listEl.scrollTop -= listRect.top + pad - itemRect.top;
    } else if (itemRect.bottom > listRect.bottom - pad) {
      listEl.scrollTop += itemRect.bottom - (listRect.bottom - pad);
    }
  });
</script>

{#snippet varBranch(branch: VarBranch)}
  <div class="variation-branch">
    <span class="var-marker" aria-hidden="true">↳</span>
    <span class="var-parens">(</span>
    {#each branch.items as vItem (`${vItem.node.move.ply}-${vItem.node.move.uci}`)}
      <span class="var-unit">
        {#if vItem.moveNo}<span class="move-no var-no">{vItem.moveNo}</span>{/if}
        <button
          type="button"
          class="ply var"
          class:active={vItem.node === activeNode}
          data-ply={vItem.node.move.ply}
          data-label={vItem.label ?? undefined}
          onclick={() => props.onJump(vItem.node)}
        >
          {vItem.node.move.san}
        </button>
      </span>
      {#if vItem.subs.length > 0}
        <div class="variation-container nested">
          {#each vItem.subs as sub (sub.id)}
            {@render varBranch(sub)}
          {/each}
        </div>
      {/if}
    {/each}
    <span class="var-parens">)</span>
  </div>
{/snippet}

<section id="movelist" class="panel" aria-label="moves" bind:this={listEl}>
  {#if props.tree && turnRows.length > 0}
    <div class="move-table">
      {#each turnRows as row (`${row.turnNumber}-${row.white?.node.move.uci ?? ""}-${row.black?.node.move.uci ?? ""}-${row.variations.map((v) => v.id).join(",")}`)}
        <div class="move-row">
          <span class="move-no">{row.turnNumber}.</span>

          <div class="move-col white-col">
            {#if row.white}
              <button
                type="button"
                class="ply"
                class:active={row.white.node === activeNode}
                data-ply={row.white.node.move.ply}
                data-label={row.white.label ?? undefined}
                onclick={() => props.onJump(row.white!.node)}
              >
                {row.white.node.move.san}
              </button>
            {/if}
          </div>

          <div class="move-col black-col">
            {#if row.black}
              <button
                type="button"
                class="ply"
                class:active={row.black.node === activeNode}
                data-ply={row.black.node.move.ply}
                data-label={row.black.label ?? undefined}
                onclick={() => props.onJump(row.black!.node)}
              >
                {row.black.node.move.san}
              </button>
            {/if}
          </div>
        </div>

        {#if row.variations.length > 0}
          <div class="variation-container">
            {#each row.variations as branch (branch.id)}
              {@render varBranch(branch)}
            {/each}
          </div>
        {/if}
      {/each}
    </div>

    {#if props.result && props.result !== "*" && props.path.length > 0}
      <div class="result-row">
        <span class="result">{props.result}</span>
      </div>
    {/if}
  {:else}
    <div class="empty-state">
      <span class="empty-icon">♟</span>
      <p>Moves will appear here once a game is loaded or played.</p>
    </div>
  {/if}
</section>

<style>
  #movelist {
    grid-area: movelist;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #3f404a transparent;
    padding: 0.5rem;
    background: var(--panel);
  }

  :global(:root.light) #movelist {
    scrollbar-color: #c4c4cc transparent;
  }

  .move-table {
    display: flex;
    flex-direction: column;
    width: 100%;
    gap: 1px;
  }

  .move-row {
    display: grid;
    grid-template-columns: 2.4rem 1fr 1fr;
    align-items: center;
    padding: 0.18rem 0.35rem;
    border-radius: 6px;
    transition: background-color 0.12s;
  }

  .move-row:nth-child(even) {
    background: rgba(255, 255, 255, 0.025);
  }

  .move-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  :global(:root.light) .move-row:nth-child(even) {
    background: rgba(0, 0, 0, 0.025);
  }

  :global(:root.light) .move-row:hover {
    background: rgba(0, 0, 0, 0.04);
  }

  .move-no {
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 600;
    font-family: ui-monospace, monospace;
    user-select: none;
    text-align: right;
    padding-right: 0.55rem;
  }

  .move-col {
    display: flex;
    align-items: center;
  }

  .ply {
    all: unset;
    cursor: pointer;
    display: inline-block;
    padding: 0.2rem 0.55rem;
    border-radius: 5px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 0.88rem;
    font-weight: 500;
    color: var(--fg);
    transition: background 0.12s, color 0.12s, transform 0.08s;
    user-select: none;
    box-sizing: border-box;
    text-align: left;
  }

  .ply:hover {
    background: rgba(255, 255, 255, 0.09);
    color: var(--fg-strong);
  }

  :global(:root.light) .ply:hover {
    background: rgba(0, 0, 0, 0.06);
  }

  .ply.active {
    background: var(--accent);
    color: #111411;
    font-weight: 700;
    box-shadow: 0 0 10px rgba(127, 166, 80, 0.45);
  }

  /* Variations block */
  .variation-container {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin: 0.2rem 0 0.3rem 1.6rem;
    padding-left: 0.6rem;
    border-left: 2px solid rgba(127, 166, 80, 0.3);
  }

  /* A fork inside a variation: nested container wraps within its branch row. */
  .variation-container.nested {
    flex-basis: 100%;
    margin-left: 0;
  }

  .variation-branch {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.35rem;
    font-size: 0.82rem;
    color: var(--muted);
  }

  .var-marker {
    font-size: 0.85rem;
    color: var(--accent);
    opacity: 0.7;
    margin-right: 0.1rem;
  }

  .var-parens {
    color: #63646f;
    font-weight: 600;
  }

  .var-unit {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }

  .var-no {
    font-size: 0.75rem;
    padding-right: 0.1rem;
    color: var(--muted);
  }

  .ply.var {
    color: var(--muted);
    padding: 0.12rem 0.35rem;
    font-size: 0.82rem;
  }

  .ply.var:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--fg-strong);
  }

  :global(:root.light) .ply.var:hover {
    background: rgba(0, 0, 0, 0.06);
  }

  .ply.var.active {
    background: var(--accent);
    color: #111411;
    font-weight: 700;
    box-shadow: 0 0 10px rgba(127, 166, 80, 0.45);
  }

  .result-row {
    padding: 0.75rem 0.5rem 0.25rem;
    text-align: center;
  }

  .result {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--muted);
    letter-spacing: 0.05em;
    user-select: none;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--muted);
    text-align: center;
    padding: 2rem;
    gap: 0.5rem;
  }

  .empty-icon {
    font-size: 2.2rem;
    opacity: 0.25;
  }

  .empty-state p {
    font-size: 0.85rem;
    line-height: 1.4;
    margin: 0;
  }
</style>
