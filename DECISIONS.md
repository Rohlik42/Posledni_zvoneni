# DECISIONS

Každé rozhodnutí je jedna věta s důvodem. Člověk je může změnit. Agenti připisují nová rozhodnutí na konec, s datem a fází.

## Před startem (2026-10-03, člověk + startovací session)

### Rozhodl člověk
1. **Učitelé:** 8 učitelů z LEGACY.md převzít beze změny jmen i předmětů a přidat jednoho nového fiktivního fyzikáře. Railgun a otázky o vodivosti vody v DESIGN.md potřebují fyziku.
2. **Rozsah budovy:** z reálných 6 úrovní vybere patra agent ve fázi Level layout podle `reference/matterport/`. Zadání říká „2 patra + suterén“ a vstupní podlaží s hlavním vchodem a tělocvičnou je logický cíl.
3. **Matterport reference:** půdorysy všech pater (≈85 px/m), panoramata povrchů a seznam místností jsou v `reference/matterport/` ve veřejném repu. Level se staví podle skutečné dispozice a agent nepotřebuje síť.
4. **Textury z Matterportu:** fotky povrchů z prohlídky (šachovnicová dlažba, parkety, obklady, dveře, skříňky) se zpracují na stylizované textury. Jde o tutéž školu, takže je to věrnější než generické textury z Poly Haven, které zůstávají doplňkem a fallbackem.
5. **Nasazení:** nová verze půjde přes GitHub Actions na GitHub Pages (Vite build v kořeni webu, stará hra pod `/legacy/`). Stará hra běžela z kořene `main` a přesunem do `legacy/` by se rozbila.

### Rozpory v DESIGN.md rozhodnuté startovací session
6. **Modely jen z primitiv, žádné stažené GLB, Mixamo ani Sketchfab** (DESIGN §1, §13 má přednost před §8 a §11). Stahovat se smí jen textury a HDR, takže `@babylonjs/loaders` zůstává jen pro případné vlastní glTF z `tools/`.
7. **Credity:** Poly Haven je CC0 a Matterport má vlastní záznam v ASSETS.md, takže položka „credity CC-BY autorů v menu“ (§15) se mění na obrazovku „Zdroje“ s výpisem ASSETS.md.
8. **Ukládání:** checkpoint po každém klíči (localStorage) místo plného uložení pozice; DoD „uložení pozice“ splňuje checkpoint a jeho obnovení z menu („Pokračovat“).
9. **Commity:** commituje nightshift po každé fázi (merge do `main`), konvence `step-N` z §12 neplatí.
10. **Navigace:** `RecastNavigationJSPluginV2` z `@babylonjs/addons` + `@recast-navigation/*` místo starého `recast-detour` + `RecastJSPlugin`. Babylon 9 starý plugin nahradil a nový je udržovaný.
11. **Stíny:** cascaded shadow maps jen pro jedno směrové „měsíční“ světlo okny, pokud vůbec. Bodová světla (oheň, lampy) mají stíny jen na presetu Vysoké, nejvýš 2 současně. Interiér osvětlený bodovými světly z CSM nic nemá.
12. **Výkon se měří na stroji, kde běží nightshift** (Apple M1 Pro, headless Chromium přes WebGPU/Metal, ověřeno). Cíl: 60 fps v 1080p na Vysoké a ≥ 30 fps na Nízké se simulovaným slabým GPU (render scale 0.5 + CPU throttling 4×). Ryzen AI ověří člověk.
13. **Tauri** (§10 krok 8) není součástí noční smyčky. Chybí Rust toolchain a globální instalace jsou zakázané, takže je to položka „Backlog — needs a human“.
14. **Testovací API:** hra vystavuje `window.__game` (stav, teleport, odpověď v kvízu, výstřel…) jen pro Playwright. Skriptovaný průchod levelem (§16) bez něj nejde spolehlivě napsat.
15. **Obtížnost a zdraví hráče:** DoD (§15) chce, aby obtížnost ovlivňovala i zdraví hráče, kdežto stará hra měla vždy 150. Platí DoD: základ 150 × násobič per obtížnost; jména, motta a portréty zůstávají z LEGACY.md.
16. **Formát quiz.json:** `{ wrongAnswerDamage, subjects: [{ subject, questions: [{ q, options: [4], correct: 0–3 }] }] }`, protože §6 popisuje jen jeden předmět a §3 chce `wrongAnswerDamage` přímo v quiz.json.
17. **Síť pro agenty:** povolené je jen npm a `api.polyhaven.com` / `dl.polyhaven.org`. Matterport je stažený v `reference/`, za běhu se k němu nepřistupuje.
18. **Babylon 9.29, TypeScript 7, Vite 8, Playwright 1.63** (aktuální verze 2026-10-03). `chunkSizeWarningLimit` je zvednutý na 4 MB, protože Babylon je velký sám o sobě a DoD chce build bez varování.
19. **Paralelní běh bez konfliktů:** dev scény se registrují přes `import.meta.glob`, test API přes `TestHooks.register` a `DECISIONS.md`/`ASSETS.md`/`PERF.md` mají `merge=union`. Nightshift spouští paralelní fáze souběžně ve worktree a sdílené soubory by se jinak hádaly při každém merge.
20. **Rozvrh směn:** paralelní fáze závisí jen na předchozích směnách, protože serial a parallel stopa startují současně z téhož `main` (ověřeno v `workflows/shift.js`).

## Fáze 8 – Level layout (2026-10-03)
21. **Patra:** hratelné jsou Matterport Floor 2 (vstupní podlaží s hlavním vchodem z Josefské a tělocvičnou č. 1), Floor 3 (1. patro) a Floor 4 (2. patro), protože jen sousední patra dovolí, aby obě skutečná schodiště (západní hlavní a prostřední) ležela nad sebou; hudebna (učebna 31) je skutečně ve Floor 4 a laboratoř/ateliér z Floor 5 nahrazují učebny 20 a 26 ve Floor 3.
22. **Měřítko půdorysů je 83 px/m, ne 85:** měřítko zapečené v obrázku má 252 px na 10 ft (82,7 px/m) a značka 5 ft to potvrzuje; hodnota je v `data/level.json → plan.pxPerMeter` a nástroje ji čtou odtud.
23. **Souřadnice level.json jsou v metrech půdorysu** (x doprava, z dolů po obrázku, počátek levý horní pixel, y absolutně, Floor 2 = 0, patro = 5 m); Babylon dostane `worldZ = −z`, aby budova nebyla zrcadlově převrácená.
24. **Trasa a zámky:** start ve Floor 4 (učebna 30), červené dveře na prostředním schodišti do Floor 3, žluté dveře do západní haly Floor 3 se schodištěm do Floor 2, modrý klíč z tělocvičny otevírá hlavní vchod (`lock: exit`); ostatní napojení schodišť jsou zavalená, aby šlo patra odemykat postupně.
25. **Místnosti jsou obdélníky** a sousední místnosti spojují dveře nebo průchody (`kind: opening`) přes mezeru zdi (`depth`); polygonové místnosti by fáze 9 musela triangulovat a skutečná dispozice se obdélníky popíše s chybou do 1 m (kritérium fáze 8; `tools/level-wall-scan.ts` měří 74 stěn: 58 do 0,5 m, 12 v 0,5–1 m, 4 hlášené nad 1 m jsou chyby skeneru u výklenků a děr ve skenu, na výřezech sedí).
26. **Tělocvična a zádveří jsou níž** (−1,4 m a −1,0 m podle výšek kamer Matterportu), takže level má i krátká schodiště uvnitř patra (`fromFloor == toFloor`).
## Fáze 1 — Core (2026-10-03)
21. **Data přes statický `import json` + `DataLoader.parse(file, raw, schema)`:** soubory se bundlují Vitem a v Node testech je čte tsx, takže validace (povinná pole, typy, rozsahy, neznámé klíče = chyba, klíče `//` = komentář) běží v prohlížeči i v `npm run test:data` bez fetch a async načítání.
22. **Barvy v datech jsou klíče palety (`"neon.water"`), ne hex:** jediný zdroj barev je `data/palette.json` a překlep v klíči spadne v datovém testu.
23. **Simulace v pevném kroku (`data/game.json → simulationHz` 60), render jednou za snímek; `__game.step(ms)` krokuje i v pauze:** testy pohybu a AI jsou pak deterministické nezávisle na zátěži stroje.
24. **Esc a ztráta pointer locku jen pauzují (nepřepínají), návrat kliknutím do canvasu:** Chrome při zamčeném kurzoru Esc spolkne, takže přepínání by pauzu dvakrát přeplo; LEGACY stejně pokračuje tlačítkem v menu.
25. **Render mimo smyčku (`step`) se obaluje `engine.beginFrame/endFrame`:** WebGPU jinak použije zničenou swap-chain texturu a hlásí varování, které smoke test (DoD bez varování) zachytí.
26. **Smoke testy selhávají na `console.warn` i `console.error` (`tests/support/ConsoleGuard.ts`), allowlist je zatím prázdný:** na tomto stroji WebGPU i WebGL2 běží bez varování.

### Fáze 7 – textury (2026-10-03)
- **Textury jsou paletové PNG ≤ 512 px posterizované přes libimagequant (sharp, bez ditheringu, 10–32 barev):** dává low-poly punk vzhled, deterministický výstup (skripty jsou idempotentní, druhý běh nic nemění) a celé `public/textures/` má 5,9 MB.
- **Parkety, žluté/zelené linoleum a dlažba dvora jsou z `down.jpg` panoramat, ne z půdorysů:** půdorys má 85 px/m a 7 cm lamely ani zrnitost linolea neukáže; měřítko down plochy 354 px/m je změřené na 5 cm čáře hřiště. Oranžové linoleum (žádné panorama) má zrno ze žlutého linolea a barvu z mediánu půdorysu Floor 3.
- **Šachovnice chodby: barvy a rozměr z půdorysu Floor 4 (perioda 35,5 px → dlaždice 29,5 cm, kladené 45° k chodbě), geometrie je ideální šachovnice napasovaná na fotku (95,6 % shoda):** stitching půdorysu dělá zubaté hrany a zadání chce pravidelnou šachovnici bez švů.
- **Čáry tělocvičny jsou samostatný RGBA decal přes celou tělocvičnu (`plan.rectPx` v index.json):** vznikl detekcí modré/žluté v půdorysu a překreslením rovnými 6 cm tahy, aby se dal položit přes opakující se parkety.
- **Poly Haven: ve hře se používá posterizovaná 512px kopie, originál 1K zůstává jako cache v `public/textures/ph/raw/`:** plán chce cache v `public/textures/ph/`; přidá ~4 MB do buildu, fáze 21 ji může z buildu vyřadit.
