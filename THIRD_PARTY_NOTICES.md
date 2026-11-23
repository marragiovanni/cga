# Third-party notices

This project is distributed under the GNU General Public License v3.0 or later
(see `LICENSE`). It bundles or depends on the following third-party software.

## Stockfish.js 19 (bundled engine)

- Files: `public/stockfish/engine.js`, `public/stockfish/engine.wasm`
  (copied from npm package `stockfish@19.0.1`,
  `bin/stockfish-19-lite-single.{js,wasm}`)
- Licence: **GPL-3.0**
- Copyright: Stockfish.js 19 (c) 2026, Chess.com, LLC; based on Stockfish
  (c) T. Romstad, M. Costalba, J. Kiiski, G. Linscott and other contributors;
  neural networks by Chris Bao (sscg13)
- Upstream: <https://github.com/nmrugg/stockfish.js>
- Engine source: <https://github.com/official-stockfish/Stockfish>
- Licence text: `LICENSE` (GNU GPL v3) and
  `public/stockfish/Copying.txt`

The unminified engine source is available from the upstream repositories
above; the exact build shipped here is the npm `stockfish@19.0.1`
`stockfish-19-lite-single` artifact, byte-for-byte.

## chessground 10.1.1 (bundled board UI)

- Licence: **GPL-3.0-or-later**
- Copyright: lichess-org and contributors
- Upstream: <https://github.com/lichess-org/chessground>
- Licence text: `LICENSE`

## chess.js 1.4.0 (bundled chess rules)

- Licence: **BSD-2-Clause**
- Copyright (c) 2025, Jeff Hlywa <jhlywa@gmail.com>
- Upstream: <https://github.com/jhlywa/chess.js>

```
Copyright (c) 2025, Jeff Hlywa (jhlywa@gmail.com)
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

## Svelte 5 (bundled runtime)

- Licence: **MIT**
- Copyright (c) 2016-2025 Svelte Contributors
- Upstream: <https://github.com/sveltejs/svelte>

## Opening data: lichess-org/chess-openings

- Files: `data/*.tsv`, compiled into `src/config/openings.json`
- Licence: **CC0 1.0** (public domain dedication)
- Upstream: <https://github.com/lichess-org/chess-openings>

## Development-only tooling

Vite, TypeScript, Playwright and the `@sveltejs/vite-plugin-svelte` plugin are
used to build and test the project but are not part of the deployed bundle.
