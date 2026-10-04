# Phase 23 — Deploy na GitHub Pages (handoff)

Branch `worktree-wf_3a0b54f2-e76-2`, worktree `.claude/worktrees/wf_3a0b54f2-e76-2`, dev port 5303.
Base: main @ d7e5ef3 (worktree cut from stale 6e5ac74, fast-forwarded to main).

## Status: UNDERSTOOD (milestone 1/5)

Plan: `.github/workflows/pages.yml` (push to main + workflow_dispatch → `npm ci`, `npm run build`, copy `legacy/` web
files into `dist/legacy/`, `actions/upload-pages-artifact` + `actions/deploy-pages`). `vite.config.ts` keeps
`base: "./"` unless the subpath check shows a problem. Verify with `npm run build`, `vite preview --base
/Posledni_zvoneni/` over dist/ + legacy copy: game boots, Zdroje (ASSETS.md?raw), difficulty portraits
(import.meta.glob ?raw), Havok WASM, textures, skybox, `legacy/index.html` link.
Repo: github.com/Rohlik42/Posledni_zvoneni → Pages URL https://rohlik42.github.io/Posledni_zvoneni/.
