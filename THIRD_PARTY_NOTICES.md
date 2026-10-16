# Third-party notices

## Upstream base project (`lezi-fun/codex-webui`)

This repository (**Codex PiWeb UI**) is a secondary development (derivative work) based on [`lezi-fun/codex-webui`](https://github.com/lezi-fun/codex-webui), originally licensed under the MIT License (`Copyright (c) 2026 lezi-fun`). The original copyright and permission notice are preserved in [`LICENSE`](./LICENSE).

## Interface and interaction design inspiration (`agegr/pi-web`)

The three-column workspace layout (left sidebar icon switcher for Chats / Files, center conversation dock with persistent runtime status & token usage bar, and right panel for file preview / PTY terminal / diff review) and core workspace ergonomics are inspired by [`@agegr/pi-web`](https://github.com/agegr/pi-web) (MIT License). No `@agegr/pi-web` source files are bundled in this repository.

## Skills interaction inspiration (`@deepseek-ai/dsh`)

The Skills cards, instruction inspection, and slash-selection interaction are inspired by the locally inspected DeepSeek Harness (`@deepseek-ai/dsh`, MIT, Copyright (c) 2026 DeepSeek). This project implements its own vanilla JavaScript UI and Codex app-server integration; no DSH packages or bundles are shipped. Curated skill bundles remain in the user's Codex cache and retain their own licenses when explicitly installed; they are not included in this repository.

## Lucide

The interface icons in `public/codex-icons.js` use the exact Lucide icon path data bundled with the locally installed Codex.app (`lucide-react` 0.456.0).

ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

Source verification: `/Applications/Codex.app/Contents/Resources/THIRD_PARTY_NOTICES.txt`, entry `lucide-react (0.456.0)`.

## Codex.app visual assets

`public/codex-brand.js` retains the monochrome Knot path extracted from the installed Codex.app wordmark, while `public/assets/codex-app-icon*.png` and `public/assets/codex-motion/*.json` were extracted from the same local application to reproduce its brand and tool-motion presentation. These assets are distributed separately from the MIT-licensed source code and remain subject to the rights and terms of their respective owner. They may be removed or replaced if requested by the relevant rights holder.

OpenAI, Codex, and related marks are trademarks of their respective owners. This project is not affiliated with or endorsed by OpenAI.
