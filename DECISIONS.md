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
16. **Formát quiz.json:** pole předmětů `[{ subject, questions: [{ q, options: [4], correct: 0–3 }] }]`, protože §6 popisuje jen jeden předmět.
17. **Síť pro agenty:** povolené je jen npm a `api.polyhaven.com` / `dl.polyhaven.org`. Matterport je stažený v `reference/`, za běhu se k němu nepřistupuje.
18. **Babylon 9.29, TypeScript 7, Vite 8, Playwright 1.63** (aktuální verze 2026-10-03). `chunkSizeWarningLimit` je zvednutý na 4 MB, protože Babylon je velký sám o sobě a DoD chce build bez varování.
