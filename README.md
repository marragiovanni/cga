# CGA

**Chess Game Analyzer** — a browser-based chess game analyzer. Paste a PGN,
let Stockfish (WebAssembly) analyze every position, and get a plain-language
label for each move — book,
best, good, inaccuracy, mistake or blunder — plus accuracy stats, opening
identification, an eval bar, and an interactive board to explore alternatives.

Everything runs locally in the browser: games, engine output and evaluations
never leave your machine. The only network requests are for the app's own
files (the engine worker and its `.wasm` binary).

**[You can try it here!](https://cga.tommib.workers.dev/)**

## Features

- **PGN import** with headers, player names, ratings and result
- **Stockfish WASM** in a pool of Web Workers (single-threaded `lite-single`
  build — no special HTTP headers needed)
- **Natural-language move labels** scaled by player rating, with centipawn loss
  and win-probability context
- **Opening book** built from the CC0 `lichess-org/chess-openings` dataset
- **Accuracy** per side and per game
- **Interactive board**: play or drag legal moves to fork variations; the
  engine evaluates the new positions live
- **Persistent eval cache** in IndexedDB, so re-analyzing the same game is
  instant
- **Fork navigation**: the imported game is always the main line, alternatives
  render as branches, and the board UI follows the selected line
- **Phone-friendly layout**: board-first view with a slide-up PGN import sheet

## Requirements

- Node.js 20+ and npm

## Development

```bash
npm ci
npm run dev          # http://localhost:8080
```

`npm run dev` copies the Stockfish worker from `node_modules/stockfish` into
`public/stockfish/` before starting Vite.

## Build and deploy

```bash
npm run build        # type-checks, generates the opening book, builds dist/
```

Deploy the **`dist/`** folder to any static host. Asset URLs are relative
(`base: "./"`), so the app works both at a domain root and under a sub-path
(e.g. `https://user.github.io/cga/`).

No custom headers are required with the bundled single-threaded engine. If you
ever switch to a multi-threaded Stockfish build, the host must send:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The app has no cross-origin dependencies, so it is compatible with those
headers as-is.

## Testing

```bash
npm test                                  # unit tests (node --test)
npm run build:test                        # browser checks → dist-test/
npx playwright install firefox            # once
node scripts/run-checks.mjs               # runs every browser check
node scripts/run-checks.mjs view          # a single page
node scripts/run-checks.mjs --mobile      # phone-sized viewport (390×844)
```

Production builds deliberately exclude the Playwright check pages.

## Project layout

```
src/engine/       UCI adapter, worker transport, Stockfish wrapper
src/analyzer/     search planning (book/terminal skipping), orchestration types
src/classifier/   move labels, win probability, accuracy
src/chess/        PGN import and variation tree
src/book/         opening-book lookup
src/ui/           analysis pool, board wrapper, eval cache, score helpers
src/components/   Svelte UI components
scripts/          opening-book generator, engine copier, browser-check runner
test/             unit tests and Playwright check pages
data/             vendored chess-openings TSV files (CC0)
public/stockfish/ vendored Stockfish.js worker + wasm + licence
```

## Licence

This project is licensed under **GPL-3.0-or-later**; see [LICENSE](LICENSE).
It bundles GPL-licensed Stockfish.js and chessground, so redistributing the app
(or a built `dist/`) means distributing GPL software. The full corresponding
source is this repository, and the licence text is included.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for versions, copyright
holders and the other bundled licences (chess.js, Svelte, opening data).
