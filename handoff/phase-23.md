# Phase 23 — Deploy na GitHub Pages (handoff)

Branch `worktree-wf_3a0b54f2-e76-2`, worktree `.claude/worktrees/wf_3a0b54f2-e76-2`, port 5303 (vite preview, killed).
Base: main @ d7e5ef3 (worktree cut from stale 6e5ac74, fast-forwarded to main).

## Status: DONE (milestone 5/5, 2026-10-04)

Quick gate green: `npm run typecheck` exit 0; `npm test` → `test:data` 111/111, Playwright smoke 6/6 (5.3 s).
Full suite NOT run (shift gate, per brief).

## What changed
- **`.github/workflows/pages.yml`** (new): `on: push [main]` + `workflow_dispatch`; permissions `contents: read`,
  `pages: write`, `id-token: write`; concurrency `pages` (no cancel). Job `build` (ubuntu, 20 min): checkout@v4,
  setup-node@v4 (Node 24, npm cache), configure-pages@v5 (id `pages`), `npm ci`,
  `npm run build -- --base "${{ steps.pages.outputs.base_path }}/"` (= `tsc --noEmit && vite build --base
  /Posledni_zvoneni/`), copy `legacy/{index.html,game.js,style.css,prototyp-babylon.jpg,vendor/}` → `dist/legacy/`
  (+ `test -f` guards), `touch dist/.nojekyll`, upload-pages-artifact@v3 (`dist`). Job `deploy` (needs build,
  environment `github-pages`): deploy-pages@v4.
- `vite.config.ts` **unchanged** (`base: "./"` stays for local builds).
- `DECISIONS.md` → „Fáze 23“ (4 bullets), `PLAN.md` → Done block under Phase 23 + Backlog item refined (push, Settings →
  Pages → GitHub Actions, check the run, URL https://rohlik42.github.io/Posledni_zvoneni/).
- Screenshots `screenshots/23-pages-main.png`, `23-pages-credits.png`, `23-pages-legacy.png`.
- Scratch probe `probe23.tmp.mts` (gitignored): Playwright over `vite preview --base /Posledni_zvoneni/`.

## Verified (numbers)
Ran exactly the workflow's steps locally: `npm run build -- --base /Posledni_zvoneni/` exit 0, no warnings
(`grep -ci "warn|error"` = 0); index.html and dev/index.html reference `/Posledni_zvoneni/assets/...`; legacy copy
commands + guards pass; dist 36 MB. `npx vite preview --base /Posledni_zvoneni/ --port 5303`, curl: `/`, `legacy/`,
`legacy/index.html`, `dev/`, `textures/index.json`, `assets/HavokPhysics-*.wasm` (application/wasm, 2.09 MB),
`legacy/vendor/babylon.js` all 200.
Playwright probe (headless Chromium, 1280×720):
- `/Posledni_zvoneni/` ready in 1.4–2.0 s, renderer webgpu, `error` null, main menu, `sky.ready()` true, navmesh 474
  triangles (recast `wasm-compat` chunk) and Havok WASM loaded from `/Posledni_zvoneni/assets/`, 46 texture requests,
  every request inside the base, **0 console errors/warnings, 0 HTTP ≥ 400, 0 failed requests**.
- **Zdroje** (`ASSETS.md?raw`): `menu.creditCount` 26, table visible (screenshot); legacy link `href="legacy/index.html"`
  resolves to `http://localhost:5303/Posledni_zvoneni/legacy/index.html` → old game loads there (title „Školní survival •
  Poslední zvonění“, 1 canvas, `BABYLON` global, menu with portraits visible). **No src/ui change needed for the main
  page.** Its only outside requests are its own Google Fonts (legacy is read-only; not a regression).
- **Portraits** (`import.meta.glob(... ?raw)`): picker page `difficulty`, 5 rows, 1 SVG each, 1 `<math>`.
- **Reload under the subpath:** pick Ultrašprt → JDEME DO ŠKOLY → `?new=1&difficulty=ultra` → after load the address is
  `/Posledni_zvoneni/` (replaceState keeps the path), unpaused, intro shown, health 120.
- **Mandatory visual check** (`23-pages-main.png`, after clicking JDEME VEN + 4 s): učebna with desks, window with the
  Prague skyline skybox, door, wardrobe, HUD (KLÍČE, ZDRAVÍ 120, 6 weapon slots, MUNICE 30/30·∞), crosshair, water pistol.
  `23-pages-credits.png`: Zdroje page, 26 položek, link „STARÁ VERZE …“. `23-pages-legacy.png`: old game's menu.
- `/Posledni_zvoneni/dev/?scene=skybox`: no error, `sky.ready()` true.
- Same probe on the **default `base: "./"` build** under `/Posledni_zvoneni/`: the game, Zdroje, portraits, reload and
  legacy all identical (0 problems) — but `dev/?scene=skybox` gives `sky.ready()` false (fetches `dev/textures/...`;
  vite preview's SPA fallback answers HTML). That is why CI builds with the absolute base.

## Flags / next phases must know
- **Not pushed** (DECISIONS #8). Backlog has the human item. The workflow itself has never run on GitHub; first push
  is its first real test (action versions checkout@v4, setup-node@v4, configure-pages@v5, upload-pages-artifact@v3,
  deploy-pages@v4).
- **Optional fix for another phase (src/ui, not done here):** the credits link from the dev scene `?scene=menu`
  resolves to `dev/legacy/index.html` (404) because `data/menu.json → legacyUrl` is document-relative. Exact fix in
  `src/ui/MenuPages.ts:190`: `legacy.href = \`${import.meta.env.BASE_URL}${this.data.legacyUrl}\`;` — dev server
  BASE_URL is `/`, Pages build `/Posledni_zvoneni/`, both resolve from `/` and `/dev/`; a local `./` build from `/`
  still works. The real game page (`/`) is fine as is.
- ~~Fonts (phase 18 flag) are still not bundled; on Pages the menu uses system fallbacks, same as locally.~~
  **Corrected by phase 24:** out of date since phase 19 (same shift, merged after this phase) bundles Barlow Condensed and
  Inter from `@fontsource/*` (`src/ui/BundledFonts.ts`, DECISIONS „Fáze 19“), so the build ships the woff2 files under
  `assets/` and Pages serves them from the base path like every other asset. This phase's probe ran on a branch cut
  before phase 19 merged.
- Shift gate: nothing in `src/` or tests changed; `npm run build` (part of test:full) is unaffected.
