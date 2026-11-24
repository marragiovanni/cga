<script lang="ts">
  /**
   * Root component — owns the navigation state (the loaded game's
   * variation tree, the viewed line `path` and `cursor`) and the
   * analysis orchestration that used to live in the vanilla main.ts.
   *
   * PGN textarea → debounced parse → tree + move list rebuild; then
   * ←/→/Home/End keys, move-list clicks and the nav buttons move
   * `cursor` — clicking a chip outside the viewed line re-slices
   * `path` onto that branch instead.
   *
   * The board is interactive: a completed drag/click adds (or reuses)
   * a child node of the viewed position and kicks off a *live*
   * analysis of just the two positions the move needs — the label
   * under the board, the sidebar and the eval update as results land.
   * The Analyze button runs a full pass over the *viewed path* (board
   * locked meanwhile); cancelling keeps the positions analyzed so far.
   */
  import { gameAccuracy } from "./classifier/accuracy.ts";
  import { isBookMove, openingAt } from "./book/book.ts";
  import {
    loadPgn,
    pvToSan,
    uciToSan,
    positionView,
    START_FEN,
    type GameData,
    type PositionView,
  } from "./chess/game.ts";
  import {
    isMainPath,
    mainPath,
    extendToLeaf,
    gameLine,
    pathFromRoot,
    pathPositionAt,
    pathPositions,
    playMove,
    treeFromGame,
    type VariationNode,
    type VariationTree,
  } from "./chess/variation.ts";
  import {
    bookClassification,
    classifyMoveRecord,
    resultToCp,
    toWhiteRelative,
    type GameClassification,
    type MoveClassification,
  } from "./classifier/classifier.ts";
  import { planSearch } from "./analyzer/skip.ts";
  import { createAnalysisController } from "./ui/analysis.ts";
  import { openEvalStore } from "./ui/evalcache.ts";
  import { formatScore } from "./ui/score.ts";
  import { Import, Moon, Sun } from "@lucide/svelte";
  import labels from "./config/labels.json" with { type: "json" };
  import BoardCell from "./components/BoardCell.svelte";
  import InputsPanel from "./components/InputsPanel.svelte";
  import MoveList from "./components/MoveList.svelte";
  import Sidebar from "./components/Sidebar.svelte";

  /** Plies of the principal variation shown in the sidebar. */
  const PV_MOVES = 6;
  const IDLE_STATUS = "Paste a PGN here…";
  /** Delay after the last keystroke before the PGN is parsed. */
  const PGN_DEBOUNCE_MS = 300;

  /**
   * Engine pool size: one core is left to the UI (clamped to
   * hardwareConcurrency − 1), capped by the configured maximum — 4
   * measured as the sweet spot on desktop (more saturates memory
   * bandwidth without adding throughput at depth 14).
   */
  const engineCount = Math.max(
    1,
    Math.min(
      labels.engine.workers ?? 4,
      Math.max(1, (globalThis.navigator?.hardwareConcurrency ?? 4) - 1),
    ),
  );
  const analysis = createAnalysisController(undefined, engineCount, openEvalStore() ?? undefined);

  // Warm up the pool while the page idles: worker scripts, WASM and
  // NNUE load off the critical path, so pressing Analyze starts
  // searching immediately instead of paying ~1-2 s of engine init.
  $effect(() => {
    const idle =
      "requestIdleCallback" in globalThis
        ? (cb: () => void) => globalThis.requestIdleCallback(() => cb(), { timeout: 2000 })
        : (cb: () => void) => globalThis.setTimeout(cb, 500);
    idle(() => analysis.warmup());
  });

  // ------------------------------------------------------------- state

  let game = $state<GameData | null>(null);
  // `tree` and `path` hold the SAME node objects (a path is a slice of
  // the tree), and the move list identifies the active child by object
  // identity. Deep $state proxies break that identity — the same node
  // read through different containers yields different proxy instances
  // — so both use `$state.raw`: reassignments still trigger updates,
  // and every internal tree mutation (playMove) is paired with a `path`
  // reassignment in the same handler.
  let tree = $state.raw<VariationTree | null>(null);
  /** The viewed line: root → leaf through the tree. */
  let path = $state.raw<VariationNode[]>([]);
  /** Moves of `path` revealed on the board (0 = start position). */
  let cursor = $state(0);
  /** Bumped on every PGN change; stale run/live callbacks bail out. */
  let epoch = 0;
  /** Live (per-move) searches still queued or running. */
  let livePending = $state(0);
  let analysisRunning = $state(false);
  /** Bumped whenever the engine cache gains results — labels, sidebar
   *  readout and the board label derive from it. */
  let labelsVersion = $state(0);
  /** Forces the board to re-apply its position (snap-back after an
   *  illegal/rejected move). */
  let boardNonce = $state(0);

  let pgn = $state("");
  let eloWhite = $state<number | null>(1500);
  let eloBlack = $state<number | null>(1500);
  let mobileImportOpen = $state(false);
  /** True when the game on screen came from an imported PGN. Player
   *  accuracy is only meaningful then: when the board is just being
   *  explored (no PGN), moves still get engine labels but there is no
   *  "player" to score, so accuracy is neither computed nor shown. */
  let pgnSource = $state(false);

  /** Which side sits at the bottom of the board (flip to analyze from
   *  the other player's point of view, e.g. as Black). Session-only. */
  let orientation = $state<"white" | "black">("white");
  const toggleOrientation = (): void => {
    orientation = orientation === "white" ? "black" : "white";
  };

  let statusText = $state(IDLE_STATUS);
  let statusIsError = $state(false);
  let progressVisible = $state(false);
  let progressPct = $state(0);

  const setStatus = (text: string, isError = false): void => {
    statusText = text;
    statusIsError = isError;
  };

  // -------------------------------------------------- classification

  /**
   * Label of a single tree node: needs the engine results of the
   * positions *before* and *after* its move — null until both are
   * cached (unanalyzed, or a run was cancelled in between).
   */
  const classifyNode = (node: VariationNode): MoveClassification | null => {
    // Book moves need no engine data at all: the opening table labels
    // them (same maxPly gate the classifier applies via `inBook`).
    if (
      node.move.ply <= labels.book.maxPly &&
      isBookMove(node.move.fenBefore, node.move.uci)
    ) {
      return bookClassification();
    }
    const before = analysis.get(node.move.fenBefore);
    const after = analysis.get(node.move.fenAfter);
    if (!before || !after) return null;
    return classifyMoveRecord(node.move, before, after, {
      whiteElo: eloWhite,
      blackElo: eloBlack,
      inBook: ({ fenBefore, uci }) => isBookMove(fenBefore, uci),
    });
  };

  /** Aggregate of the viewed path (null when nothing is classified). */
  const classification = $derived.by((): GameClassification | null => {
    void labelsVersion;
    if (!game || !tree) return null;
    const moves = path.map(classifyNode);
    const cpLosses: { w: number[]; b: number[] } = { w: [], b: [] };
    path.forEach((node, index) => {
      const label = moves[index];
      if (!label) return;
      const mover = node.move.fenBefore.split(" ")[1] === "b" ? "b" : "w";
      cpLosses[mover].push(label.cpLoss);
    });
    if (cpLosses.w.length === 0 && cpLosses.b.length === 0) return null;
    return {
      moves,
      // No player to score when the game is just being explored.
      whiteAccuracy: pgnSource ? gameAccuracy(cpLosses.w) : 0,
      blackAccuracy: pgnSource ? gameAccuracy(cpLosses.b) : 0,
    };
  });

  /** " · White 87% · Black 92%" once classified, "" otherwise. */
  const accuracySuffix = (): string => {
    if (!pgnSource) return "";
    const cls = classification;
    if (!cls) return "";
    return (
      ` · White ${cls.whiteAccuracy.toFixed(0)}%` +
      ` · Black ${cls.blackAccuracy.toFixed(0)}%`
    );
  };

  const gameStatus = (): string => {
    if (!game) return IDLE_STATUS;
    // Accuracy only once EVERY move is classified — book moves classify
    // instantly, but percentages over a half-labeled game mislead.
    const cls = classification;
    const suffix = cls && cls.moves.every((label) => label !== null) ? accuracySuffix() : "";
    return (
      `${game.white} vs ${game.black} · ${game.result} · ` +
      `${game.moves.length} moves${suffix}`
    );
  };

  /** Status line for whatever line is on the board right now. */
  const statusForView = (): string => {
    if (!game || !tree) return IDLE_STATUS;
    // Manual exploration has no "game" to summarize; hide the status
    // bar so "Variation · X moves" never leaks into the left panel.
    if (!pgnSource) return IDLE_STATUS;
    if (!isMainPath(path)) {
      // Accuracy only when *every* move of the line is classified.
      const cls = classification;
      const suffix = cls && cls.moves.every((label) => label !== null) ? accuracySuffix() : "";
      return `Variation · ${path.length} moves${suffix}`;
    }
    return gameStatus();
  };

  // ------------------------------------------------------------- view

  /** Position on the board; a clean start board with no game loaded. */
  const position = $derived(
    tree ? pathPositionAt(tree, path, cursor) : positionView(START_FEN, null),
  );

  /** The move currently revealed by the cursor (null = start position). */
  const shownNode = $derived(cursor > 0 ? (path[cursor - 1] ?? null) : null);

  /** Label of the move on the board (null = not classified / no move). */
  const moveLabel = $derived.by((): MoveClassification | null => {
    void labelsVersion;
    void livePending;
    return shownNode ? classifyNode(shownNode) : null;
  });

  /** Engine readout for the position on the board. */
  const here = $derived.by(() => {
    void labelsVersion;
    return position ? analysis.get(position.fen) : null;
  });

  const engineInfo = $derived.by(() => {
    if (!here || !position) return null;
    const { fen, result } = here;
    return {
      bestMove: uciToSan(fen, result.bestMove),
      score: formatScore(result, fen),
      pv: pvToSan(fen, result.pv, PV_MOVES) || null,
    };
  });

  const openingInfo = $derived(position ? openingAt(position.fen) : null);
  const evalCp = $derived(
    here && position ? toWhiteRelative(resultToCp(here.result), position.fen) : null,
  );
  const arrow = $derived(here ? here.result.bestMove : null);

  // --------------------------------------------------------- handlers

  /**
   * Reveal `next` moves of the viewed line. Stepping BACK out of a
   * variation re-joins the main line: the
   * alternative stays in the tree as a branch, but → from the fork
   * position resumes the imported game instead of re-entering it.
   */
  const setCursor = (next: number): void => {
    const target = Math.max(0, Math.min(next, path.length));
    if (target < cursor && tree) {
      const undone = path[cursor - 1];
      const shown = target > 0 ? path[target - 1] : null;
      if (undone && !undone.main && (shown === null || shown.main)) {
        // The move being undone is an alternative and we land on the
        // main line (or the start): re-slice onto the game's line.
        path = target === 0 ? gameLine(tree) : extendToLeaf(path.slice(0, target));
      }
    }
    cursor = target;
  };

  const onNav = (to: "first" | "prev" | "next" | "last"): void => {
    if (to === "first") setCursor(0);
    else if (to === "last") setCursor(path.length);
    else setCursor(cursor + (to === "next" ? 1 : -1));
    if (!analysisRunning && livePending === 0) setStatus(statusForView());
  };

  /** Chip clicked: stay on the line, or re-slice onto its branch. */
  const jumpTo = (node: VariationNode): void => {
    const index = path.indexOf(node);
    if (index >= 0) {
      // Clicking a main-line move while a variation is viewed re-joins
      // the main line (the variation stays a branch), so navigation
      // continues along the real game from here.
      if (node.main && path[index + 1] && !path[index + 1].main) {
        path = extendToLeaf(path.slice(0, index + 1));
        cursor = index + 1;
        if (!analysisRunning && livePending === 0) setStatus(statusForView());
        return;
      }
      setCursor(index + 1);
      return;
    }
    // The viewed line runs from the root through the clicked node and
    // on along its continuation to a leaf — so returning to the real
    // game at a fork point keeps the rest of the match visible (and
    // steppable) in the move list.
    const base = pathFromRoot(node);
    path = extendToLeaf(base);
    cursor = base.length;
    if (!analysisRunning && livePending === 0) setStatus(statusForView());
  };

  /**
   * Queue the positions a fresh move needs behind whatever the engine
   * is doing; when they land, labels and the sidebar refresh. The
   * status line says so until the last live task finishes — unless a
   * full run owns it.
   */
  const liveAnalyze = (positions: string[]): void => {
    const startedEpoch = epoch;
    livePending++;
    if (!analysisRunning) setStatus("Analyzing move…");
    void analysis
      .analyzeNow(positions)
      .catch(() => {
        // Live search failed: the view simply stays unanalyzed.
      })
      .finally(() => {
        if (epoch !== startedEpoch) return; // stale: PGN replaced meanwhile
        livePending = Math.max(0, livePending - 1);
        if (analysisRunning) return; // a full run owns the status line
        labelsVersion++;
        if (livePending === 0) setStatus(statusForView());
      });
  };

  /**
   * A move was played on the board: reuse/create the child node,
   * re-slice the viewed line onto it, then ask for the two positions
   * the classification needs (missing ones only).
   */
  const handleMove = (uci: string): void => {
    if (analysisRunning) {
      boardNonce++; // locked: snap back
      return;
    }
    if (!game || !tree) {
      pgnSource = false;
      game = {
        tags: {
          Event: "Interactive Analysis",
          Site: "",
          Date: new Date().toISOString().slice(0, 10),
          Round: "",
          White: "White",
          Black: "Black",
          Result: "*",
        },
        white: "White",
        black: "Black",
        result: "*",
        whiteElo: eloWhite,
        blackElo: eloBlack,
        moves: [],
      };
      tree = treeFromGame(game);
      path = [];
      cursor = 0;
    }
    const parent = cursor > 0 ? (path[cursor - 1] ?? tree.root) : tree.root;
    const node = playMove(parent, uci);
    if (!node) {
      boardNonce++; // illegal move (defensive): snap back
      return;
    }
    // A fresh move has no children yet (the line ends there), but a
    // REUSED node (replaying a known move, e.g. the PGN's) carries its
    // continuation — extend to a leaf so the rest of the line stays
    // visible and steppable instead of collapsing to the fork point.
    const base = pathFromRoot(node);
    path = extendToLeaf(base);
    cursor = base.length;

    // Plan the live search: book moves need no engine at all, terminal
    // positions (a played mate, stalemate…) are synthesized.
    const plan = planSearch(
      [node.move.fenBefore, node.move.fenAfter],
      [node.move.uci],
    );
    if (plan.synthesized.length > 0) {
      analysis.seed(plan.synthesized);
      labelsVersion++;
    }
    if (plan.searchable.length === 0) {
      // Book move: the label comes from the table alone — done now.
      if (!analysisRunning) setStatus(statusForView());
      return;
    }
    liveAnalyze(plan.searchable);
  };

  const runAnalysis = async (): Promise<void> => {
    if (!game || !tree || analysisRunning) return;
    const startedEpoch = epoch;
    // Skip what the engine can't contribute: book moves are labeled
    // from the table, terminal positions are synthesized without a search.
    const plan = planSearch(
      pathPositions(tree, path),
      path.map((node) => node.move.uci),
    );
    analysis.seed(plan.synthesized);
    if (plan.searchable.length === 0) {
      // Book-only line (or a lone terminal position): every label is
      // already available — no run, no progress bar, just done.
      labelsVersion++;
      setStatus(`Analysis complete${accuracySuffix()}`);
      return;
    }
    analysisRunning = true;
    progressVisible = true;
    try {
      const outcome = await analysis.start(plan.searchable, (done, total) => {
        if (epoch !== startedEpoch) return;
        // The pool commits each position's result BEFORE ticking, so a
        // bump here makes labels, badges and the eval bar stream in
        // progressively while the run continues.
        labelsVersion++;
        progressPct = total > 0 ? Number(((done / total) * 100).toFixed(1)) : 0;
        setStatus(`Analyzing… ${done}/${total}`);
      });
      if (epoch !== startedEpoch) return; // PGN changed while running
      labelsVersion++;
      setStatus(
        outcome.aborted
          ? `Analysis cancelled · ${outcome.done}/${outcome.total} positions`
          : `Analysis complete${accuracySuffix()}`,
      );
    } catch (error) {
      if (epoch === startedEpoch) {
        const detail = error instanceof Error ? error.message : String(error);
        setStatus(`Analysis failed — ${detail}`, true);
      }
    } finally {
      if (epoch === startedEpoch) {
        analysisRunning = false;
        progressVisible = false;
        progressPct = 0;
      }
    }
  };

  const onAnalyze = (): void => {
    if (analysisRunning) {
      analysis.cancel();
      return;
    }
    void runAnalysis();
  };

  const startGame = (parsed: GameData): void => {
    pgnSource = true;
    game = parsed;
    // Seed the ELO inputs from the PGN's WhiteElo/BlackElo tags when
    // the game carries them — no manual retyping. A game without the
    // tags leaves the current values (manual entries) untouched.
    if (parsed.whiteElo !== null) eloWhite = parsed.whiteElo;
    if (parsed.blackElo !== null) eloBlack = parsed.blackElo;
    tree = treeFromGame(parsed);
    path = mainPath(tree);
    cursor = 0;
    // Fire-and-forget restore from the persistent eval cache: results
    // survive page reloads, so a re-pasted game (or a shared opening)
    // labels up without waiting for a single search.
    void analysis
      .hydrate(pathPositions(tree, path))
      .then(() => {
        labelsVersion++;
        if (!analysisRunning && livePending === 0) setStatus(statusForView());
      })
      .catch(() => {
        // restore failed: nothing to show, analysis works as usual
      });
    setStatus(gameStatus());
  };

  const onPgnChange = (value: string): void => {
    // A new PGN invalidates any run or live search in flight; their
    // cached positions are FEN-keyed and stay valid for reuse.
    epoch++;
    if (analysisRunning) {
      analysis.cancel();
      analysisRunning = false;
      progressVisible = false;
    }
    livePending = 0;

    if (value.trim() === "") {
      pgnSource = false;
      game = null;
      tree = null;
      path = [];
      cursor = 0;
      setStatus(IDLE_STATUS);
      return;
    }
    try {
      startGame(loadPgn(value));
    } catch (error) {
      // Keep the previous game on screen; just report the problem.
      const detail = error instanceof Error ? error.message : String(error);
      setStatus(`Invalid PGN — ${detail}`, true);
    }
  };

  let pgnTimer: ReturnType<typeof setTimeout> | null = null;
  const onPgnInput = (): void => {
    if (pgnTimer !== null) clearTimeout(pgnTimer);
    pgnTimer = setTimeout(() => {
      pgnTimer = null;
      onPgnChange(pgn);
    }, PGN_DEBOUNCE_MS);
  };

  // Changing an ELO re-classifies (cheap, no engine) and refreshes the
  // status line — but only in response to the *inputs*, not to other
  // state changes. (prev === null on the first run: nothing changed.)
  let prevElo: { w: number | null; b: number | null } | null = null;
  $effect(() => {
    const w = eloWhite;
    const b = eloBlack;
    const prev = prevElo;
    prevElo = { w, b };
    if (prev === null || (prev.w === w && prev.b === b)) return;
    if (!game || !tree) return;
    if (!analysisRunning && livePending === 0) setStatus(statusForView());
  });

  // ------------------------------------------------------ lifecycle

  // Theme toggle state + persistence
  let darkMode = $state(!document.documentElement.classList.contains("light"));

  const toggleTheme = (): void => {
    darkMode = !darkMode;
    document.documentElement.classList.toggle("light", !darkMode);
    try { localStorage.setItem("cma-theme", darkMode ? "dark" : "light"); } catch { /* quota */ }
  };

  // Restore saved theme preference
  $effect(() => {
    try {
      const saved = localStorage.getItem("cma-theme");
      if (saved === "light") {
        darkMode = false;
        document.documentElement.classList.add("light");
      } else if (saved === "dark") {
        darkMode = true;
        document.documentElement.classList.remove("light");
      } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
        darkMode = false;
        document.documentElement.classList.add("light");
      }
    } catch { /* localStorage unavailable */ }
  });

  // Keyboard navigation (ignore while typing in the PGN textarea).
  $effect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!game) return;
      const target = event.target;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;
      switch (event.key) {
        case "ArrowLeft":
          setCursor(cursor - 1);
          break;
        case "ArrowRight":
          setCursor(cursor + 1);
          break;
        case "Home":
          setCursor(0);
          break;
        case "End":
          setCursor(path.length);
          break;
        case "f":
        case "F":
          toggleOrientation();
          break;
        default:
          return;
      }
      if (!analysisRunning && livePending === 0) setStatus(statusForView());
      event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // Mobile PGN sheet: lock the page behind it, close on Escape, and move
  // focus into the sheet while open (back to the toggle once it closes).
  $effect(() => {
    if (!mobileImportOpen) return;
    const previousOverflow = document.body.style.overflow;
    const toggle = document.getElementById("mobile-import-toggle");
    const mobileQuery = window.matchMedia("(max-width: 640px)");
    const onViewportChange = (): void => {
      if (!mobileQuery.matches) mobileImportOpen = false;
    };
    document.body.style.overflow = "hidden";
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") mobileImportOpen = false;
    };
    document.addEventListener("keydown", onKeydown);
    mobileQuery.addEventListener("change", onViewportChange);
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>("#inputs #pgn")?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeydown);
      mobileQuery.removeEventListener("change", onViewportChange);
      document.body.style.overflow = previousOverflow;
      toggle?.focus({ preventScroll: true });
    };
  });

  // Leaving the page mid-run: abort and tear the worker down.
  $effect(() => {
    const onUnload = (): void => analysis.dispose();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  });
</script>

<header>
  <h1>CGA</h1>
  <div class="header-actions">
    <button
      class="mobile-import-toggle"
      id="mobile-import-toggle"
      type="button"
      onclick={() => (mobileImportOpen = true)}
      aria-controls="inputs"
      aria-expanded={mobileImportOpen}
    >
      <Import size={16} aria-hidden="true" />
      Import PGN
    </button>
    <button
      class="theme-toggle"
      type="button"
      title={darkMode ? "Switch to light theme" : "Switch to dark theme"}
      onclick={toggleTheme}
      aria-label="Toggle theme"
    >
      {#if darkMode}
        <Sun size={18} aria-hidden="true" />
      {:else}
        <Moon size={18} aria-hidden="true" />
      {/if}
    </button>
  </div>
</header>

{#if mobileImportOpen}
  <button
    class="mobile-sheet-backdrop"
    type="button"
    aria-label="Close PGN import"
    onclick={() => (mobileImportOpen = false)}
  ></button>
{/if}

<main class="layout">
  <InputsPanel
    bind:pgn
    bind:eloWhite
    bind:eloBlack
    running={analysisRunning}
    progressVisible={progressVisible}
    {progressPct}
    {statusText}
    {statusIsError}
    statusIsIdle={statusText === IDLE_STATUS}
    mobileOpen={mobileImportOpen}
    whiteAccuracy={pgnSource ? (classification?.whiteAccuracy ?? null) : null}
    blackAccuracy={pgnSource ? (classification?.blackAccuracy ?? null) : null}
    onPgnInput={onPgnInput}
    onAnalyze={() => {
      const startsAnalysis = !analysisRunning;
      onAnalyze();
      if (startsAnalysis) mobileImportOpen = false;
    }}
    onCloseMobileImport={() => (mobileImportOpen = false)}
  />

  <BoardCell
    {position}
    nonce={boardNonce}
    {arrow}
    locked={analysisRunning}
    moveLabel={moveLabel?.label ?? null}
    labelPending={livePending > 0 && shownNode !== null}
    {orientation}
    san={shownNode?.move.san ?? null}
    moveNo={shownNode ? Math.ceil(shownNode.move.ply / 2) : null}
    isWhite={shownNode ? shownNode.move.ply % 2 === 1 : true}
    cpLoss={moveLabel?.cpLoss ?? null}
    {statusText}
    {statusIsError}
    statusIsIdle={statusText === IDLE_STATUS}
    onMove={handleMove}
    onNav={onNav}
    onFlip={toggleOrientation}
  />

  <Sidebar {game} opening={openingInfo} engineInfo={engineInfo} evalCp={evalCp} />

  <MoveList
    {tree}
    {path}
    {cursor}
    version={labelsVersion}
    classify={classifyNode}
    result={pgnSource && isMainPath(path) && game?.result !== "*" ? game.result : null}
    onJump={jumpTo}
  />
</main>
