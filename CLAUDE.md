# MALGYM 2066 – pravidla pro agenty

Single-player FPS v prohlížeči (Babylon.js 9, TypeScript strict, Vite). Nightshift ji staví fázi po fázi podle `PLAN.md`.

**Čti v tomto pořadí:** `PLAN.md` (tvoje fáze + Decisions + Evidence) → `DECISIONS.md` → `DESIGN.md` (zadání; v rozporu platí DECISIONS/PLAN) → `LEGACY.md` (obsah ze staré hry) → `FEEDBACK.md`, pokud existuje: zpětná vazba člověka má **přednost** před vším kromě bezpečnostních pravidel.

## Příkazy

- `npm run dev` – dev server na http://localhost:5173 (hra), `/dev/?scene=<jméno>` (izolované testovací scény)
- `npm run build` – `tsc --noEmit` + `vite build`; musí projít **bez chyb a bez varování**
- `npm test` – rychlé Playwright smoke testy (`tests/smoke/`)
- `npm run test:full` – všechny testy včetně průchodu levelem (`tests/e2e/`)
- Snímky ukládej do `screenshots/<fáze>-<popis>.png` a **prohlédni si je** (Read tool). Že test prošel, neznamená, že scéna vypadá dobře.

## Struktura (DESIGN §9)

```
src/main.ts  core/  rendering/  player/  weapons/  enemies/  enemies/models/  level/  quiz/  ui/  audio/  utils/
dev/         – testovací scény, každá samostatně spustitelná (?scene=…), + galerie modelů
data/        – level.json weapons.json enemies.json teachers.json quiz.json palette.json quality.json difficulty.json
public/      – textures/ hdr/ (generované nebo stažené výstupy)
tools/       – skripty (fetch-textures, matterport-textures, …), spouštěné přes `node --experimental-strip-types` nebo `npx tsx`
reference/   – Matterport reference (jen čtení, nikdy nemazat)
legacy/      – stará hra (jen čtení, kód nepřebírat)
tests/smoke/ tests/e2e/  screenshots/
```

## Pravidla kódu (DESIGN §9, §13)

- **Žádná herní data v kódu.** Rozměry, damage, pozice, texty, barvy a časy jsou v `data/*.json` a kód je čte (typované loadery v `src/utils/` nebo u systému).
- **Jeden soubor = jedna třída.** Pojmenované konstanty místo magických čísel.
- **Každý systém jde spustit samostatně** v dev scéně `dev/scenes/<Systém>Scene.ts`, registrované v `dev/main.ts`.
- Žádné minifikované výstupy v repu, žádná jednosouborová dema.
- **Modely jen z primitiv:** každý model je samostatná třída s parametry (barva, měřítko, varianta) v `src/**/models/` a je vidět v galerii `dev/?scene=gallery`. Flat shading (`convertToFlatShadedMesh`), barvy z `data/palette.json`. Rozpočet trojúhelníků: robot ≤ 2k, zbraň ≤ 1k, místnost ≤ 20k včetně detailů.
- Importuj Babylon po modulech (`@babylonjs/core/Meshes/meshBuilder`), ne celý `@babylonjs/core` index. Drží to velikost bundlu.
- `window.__game` (`src/core/TestHooks.ts`) je kontrakt pro testy: pole přidávej, neodebírej.
- Nové rozhodnutí = jedna věta s důvodem na konec `DECISIONS.md`.
- Každý stažený nebo z Matterportu odvozený soubor má řádek v `ASSETS.md` (název, zdroj, licence).

## Bezpečnost autonomního běhu (DESIGN §12)

- Pracuj jen uvnitř repa. Nic mimo něj nečti, nemaž ani nepřepisuj.
- Žádné globální instalace (kromě `npx playwright install chromium`), závislosti jen přes `package.json`.
- Síť: jen npm a Poly Haven (`api.polyhaven.com`, `dl.polyhaven.org`). Stažené soubory jdou do `public/textures/` a `public/hdr/`. Žádné odesílání dat kamkoliv.
- Dlouhé procesy vždy s timeoutem. Dev server a Playwright po testu ukonči.
- `reference/` a `legacy/` jsou jen pro čtení.
- Nikdy nekonči otázkou na člověka: zvol jednodušší fungující řešení, zapiš ho do DECISIONS.md a pokračuj. Co opravdu potřebuje člověka, patří do `## Backlog — needs a human` v PLAN.md.
