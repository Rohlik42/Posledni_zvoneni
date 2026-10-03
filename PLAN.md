# MALGYM 2066 — hratelný level Malostranského gymnázia

Cíl: single-player FPS v prohlížeči (Babylon.js 9 + TypeScript + Vite) podle `DESIGN.md`. Jeden level je Malostranské gymnázium v roce 2066 podle skutečné dispozice z `reference/matterport/`. Má low-poly punk vizuál z primitiv, roboty s AI, zajaté učitele s kvízem a klíče Doom-style. Hotovo = platí celá sekce 15 DESIGN.md (Definition of done) s úpravami z `DECISIONS.md`. Spec: `DESIGN.md` (zadání), `DECISIONS.md` (rozhodnutí, která mají přednost), `LEGACY.md` (obsah ze staré hry), `reference/matterport/README.md` (budova a textury). Pokud existuje `FEEDBACK.md`, každá fáze ho čte jako **prioritní vstup**.

## Decisions

2026-10-03 – celý seznam s důvody je v `DECISIONS.md` → „Před startem“. Ve zkratce:

1. Učitelé: 8 z LEGACY.md beze změny + 1 nový fiktivní fyzikář (jméno, přezdívku i hlášky vymyslí fáze 11).
2. Patra budovy vybere fáze 8 z `reference/matterport/`; cíl je „2 patra + suterén“, kde „suterén“ je vstupní podlaží (Floor 2) s hlavním vchodem a tělocvičnou.
3. Textury primárně z fotek Matterportu (fáze 7), Poly Haven doplňkem, procedurální fallback.
4. Modely jen z primitiv. Žádné GLB, Mixamo ani Sketchfab.
5. Checkpoint po každém klíči místo plného uložení.
6. Navigace: `RecastNavigationJSPluginV2` z `@babylonjs/addons`, ne `recast-detour`.
7. Výkon se měří na tomto stroji (M1 Pro, headless Chromium, WebGPU/Metal ověřeno: 60 fps prázdná scéna). „Slabý notebook“ = preset Nízké + CPU throttling 4× přes CDP.
8. Tauri ne. Deploy přes GitHub Actions na Pages (fáze 23), ale **nightshift nepushuje**: push udělá člověk.
9. Testy řídí hru přes `window.__game` (`src/core/TestHooks.ts`), kontrakt se jen rozšiřuje.
10. Pořadí učitelů, klíčů a zbraní je v Evidence → „Progrese“. Fáze 16 ho smí upravit podle reálné mapy, ale musí změnu zapsat sem i do DECISIONS.md.
11. **Žádný push, žádné force operace, žádné mazání `reference/` ani `legacy/`.**
12. **Rychlost má přednost před přehnaným ověřováním** (přání člověka): ověřuj jen to, co fáze mění. Viz „Rozvrh a ověřování“.

## Rozvrh a ověřování

**Směny.** Lead session předá workflow `shift` tyto argumenty. **Pozor:** `serial` a `parallel` startují *současně* (shift.js `Promise.all`) a paralelní worktree se odvětví od `main` na začátku směny. Paralelní fáze proto smí záviset **jen na předchozích směnách**, nikdy na sériových fázích téže směny. Co se nestihne, jde do další směny.

| Směna | serial | parallel | Pozn. |
| --- | --- | --- | --- |
| 1 | `1`, `2` | `7`, `8`, `12` | 7, 8 a 12 jsou čistě nástroje a data, nepotřebují engine |
| 2 | `3`, `4`, `5` | `9` | 9 = geometrie levelu bez navmeshe; po směně 2 → člověk hraje Weapon feel |
| 3 | `F1`, `10`, `11` | `13`, `14` | F1 = feedback (z-fighting, skybox); 13/14 stojí na 3–5 (směna 2) |
| 4 | `16`, `18`, `17` | `15` | 18 (menu) před 17 (výběr obtížnosti v menu); 15 = jen modely rekvizit + PropPlacer, napojí 16 |
| 5 | `19`, `20` | `23` | po směně 5 → člověk hraje Visual pass |
| 6 | `21`, `24` | – | 21 měří fps → běží sama, bez paralelní zátěže |

**Pravidla pro paralelní fáze:** nepřidávají npm závislosti (`sharp` a `tsx` už jsou nainstalované; potřebnou závislost zapiš do handoffu a přidá ji další serial fáze). V worktree se nikdy neinstaluje. Needitují soubory, které vlastní jiná fáze téže směny. Sdílené registry jsou navržené bez konfliktů: dev scény se hledají přes `import.meta.glob("./scenes/*Scene.ts")` a test API registruje každý modul sám (`TestHooks.register("weapons", api)`), viz fáze 1. `DECISIONS.md`, `ASSETS.md` a `PERF.md` mají v `.gitattributes` `merge=union`, jen se do nich připisuje na konec.

**Časově citlivé testy:** testy běží, zatímco stroj zatěžují i jiné worktree. Pohyb a AI proto testuj s volnými mezemi a přes deterministický krok (`__game.step(ms)` posune simulaci s pevným dt). Fps se měří jen ve fázích 21 a 24.

**Dvě úrovně testů.**
- **Quick gate** (pro každou fázi, běží 3× u implementace, review a merge, proto musí být levná): výchozí `["npm run typecheck", "npm test"]` (datové testy + smoke, ~10 s). Když sekce fáze uvádí „Quick gate: `tests/e2e/a.spec.ts`, `b.spec.ts`“, lead předá `phases[id].tests = ["npm run typecheck", "npm run test:data && npx playwright test tests/smoke tests/e2e/a.spec.ts tests/e2e/b.spec.ts"]`. Je to jeden běh Playwrightu, takže i jeden dev server.
- **Shift gate** (jednou za směnu na mergnutém main): `npm run test:full` (build + všechny testy včetně playthrough).
- Měření fps a PERF.md jen ve fázích 21 a 24. Žádná videa. Snímky jen ty uvedené ve fázi (1–3 na fázi) a každý si prohlédni.

## Phase 0 — Evidence

Fakta, na která se fáze odkazují. Nic se tu neimplementuje.

**Spec**
- Herní smyčka, kvíz, klíče: DESIGN §3. Zbraně: §4 (tabulka 6 zbraní). Nepřátelé: §5. Učitelé, kvíz a power-upy: §6. Level: §7. Technologie a presety kvality: §8. Struktura repa a pravidla: §9 + `CLAUDE.md`. Pořadí práce: §10. Zdroje assetů, paleta a rozpočty trojúhelníků: §13. DoD: §15. Smyčka ověřování: §16.
- Obsah ze staré hry: `LEGACY.md` §1 Učitelé (8 jmen + placeholder fyzika), §2 Obtížnost (5 stupňů `baby/schoolkid/truant/rascal/ultra`, výchozí `truant`; tabulka násobičů; motta; SVG portréty v `legacy/index.html:3`; návrh mapování), §3 Texty (humor, tón), §4 Barvy a písma, §5 Zvuky (Web Audio recepty).
- Budova: `reference/matterport/README.md`. Půdorysy `floorplans/floor{1..6}_*.jpg` mají 4968×3043 px a **83 px/m** (změřeno na měřítku v obrázku ve fázi 8, DECISIONS „Měřítko půdorysů je 83 px/m“; README uvádí ≈85, to neplatí). Geometrie (`data/level.json → plan.pxPerMeter`) i textury z půdorysu (`tools/matterport-textures.json`) používají 83. Všechna patra mají stejný výřez. Výška patra je ≈5 m. Seznam místností s patry je `rooms.json`, popisky jsou ve `views/labels_floor{2,3,6}.jpg` a fotky povrchů v `panoramas/*/{a,b,c,d,down}.jpg`.

**API (ověřené v `node_modules`, verze z package.json)**
- Engine: `src/core/EngineFactory.ts` (WebGPU s fallbackem na WebGL2, `?renderer=webgl2` vynutí fallback). `WebGPUEngine.IsSupportedAsync` + `initAsync()`.
- Babylon 9 má pro mnoho modulů `*.pure.js` varianty bez side effectů. **Importuj ne-pure cestu** (`@babylonjs/core/Meshes/mesh`), aby se zaregistrovaly side effecty (např. `MeshBuilder`, `physicsEngineComponent`). Když něco „není funkce“, chybí side-effect import.
- Post-processing: `@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline` (bloom, tone mapping, grain, chromatic aberration, vignette přes `imageProcessing`) a `ssao2RenderingPipeline` (SSAO).
- Fyzika: Havok `@babylonjs/havok` (`HavokPhysics()` načte `HavokPhysics.wasm`, Vite ho nesmí pre-bundlovat, viz `vite.config.ts`), plugin `@babylonjs/core/Physics/v2/Plugins/havokPlugin`. Hráč: `PhysicsCharacterController` v `@babylonjs/core/Physics/v2/characterController` (řádek 177 v .d.ts). Výhodnější než `UniversalCamera.checkCollisions`: jeden kolizní systém pro hráče, projektily i padající předměty.
- Flat shading: `Mesh.convertToFlatShadedMesh()` (`Meshes/mesh.pure.d.ts:1041`).
- Navigace: `CreateNavigationPluginAsync()` z `@babylonjs/addons/navigation/factory` vrací `RecastNavigationJSPluginV2` (`createNavMesh(meshes, params)`, `computePath`, `computePathSmooth`, `getClosestPoint`). Závislosti `@recast-navigation/core` a `@recast-navigation/generators` jsou nainstalované.
- AI: Yuka 0.7.8 (`yuka/build/yuka.module.js`: `StateMachine` ř. 9269, `Vision` ř. 20285, `MemorySystem` ř. 20049, `EntityManager` ř. 7803), typy z `@types/yuka`. Yuka řeší jen rozhodování, vnímání a steering. Cesty počítá recast. Pozice se synchronizují Yuka ↔ Babylon jednou za snímek.
- Audio: Babylon AudioV2 `CreateAudioEngineAsync` (`AudioV2/webAudio/webAudioEngine.d.ts:55`) pro prostorové zvuky. Zvuky se syntetizují přes Web Audio do `AudioBuffer` (recepty v LEGACY §5), ne ze souborů.
- GUI: `@babylonjs/gui` `AdvancedDynamicTexture.CreateFullscreenUI` pro HUD a kvíz.

**Měření (2026-10-03, tento stroj)**
- Headless Chromium (Playwright 1.63, `--enable-unsafe-webgpu --use-angle=metal`): renderer `webgpu`, adapter `apple metal-3`, prázdná scéna 60 fps (vsync). Headed stejně.
- `npm run build`: OK, hlavní chunk 840 kB (prázdná scéna).

**Progrese (rozhodnuto startovací session, fáze 16 může upravit podle mapy)**

Hráč začíná v nejvyšším hratelném patře (zavřený ve třídě po útoku) a postupuje dolů k hlavnímu vchodu na Floor 2.

| # | Učitel (LEGACY §1) | Předmět / kabinet | Odměna | Role |
| --- | --- | --- | --- | --- |
| 1 | Lambertová | Zeměpis | Hasicí přístroj (zbraň 2) | hlavní trasa, „1. učitel“ dle DESIGN §4 |
| 2 | Šiklová | Matematika | **ČERVENÝ klíč** | klíčová |
| 3 | Ditrichová | Hudebka | energetický drink + lékárnička | volitelná odbočka |
| 4 | Underlová | Angličtina | Paralyzér (zbraň 4) | hlavní trasa (za červenými dveřmi) |
| 5 | Komoň | Čeština | **ŽLUTÝ klíč** | klíčová |
| 6 | Novotná | Výtvarka | gumáky | volitelná odbočka |
| 7 | NOVÝ fyzikář | Fyzika (kabinet fyziky) | Školní railgun (zbraň 5) + munice | hlavní trasa (za žlutými dveřmi) |
| 8 | Doležalová | Dějepis | lékárnička + munice railgunu | volitelná odbočka |
| 9 | Taušl | Tělocvik (tělocvična) | **MODRÝ klíč** → hlavní vchod | klíčová, finální aréna, v tělocvičně je hadice (zbraň 6) |

Vodní balónky (zbraň 3) leží na chodbě mezi učiteli 1 a 2. Vodní pistolka (zbraň 1) je od startu. Checkpoint se ukládá po každém klíči a na startu.

## Phase 1 — Core: Game, data loader, rendering pipeline, dev scény

**Implement**
1. `src/core/Game.ts`: vlastní engine (z `EngineFactory`), scénu, render loop, resize a pauzu. `src/main.ts` jen vytvoří `Game`. Zachovej `window.__game` z `TestHooks.ts` a rozšiř ho o `scene` (název aktivní scény), `paused` a `frameTimeMs()`.
2. `src/utils/DataLoader.ts`: typované načítání `data/*.json` (import přes Vite `?url` nebo `import json`), validace povinných polí s čitelnou chybou. `data/palette.json`: low-poly punk paleta, tmavé podklady a výrazné akcenty. Vyjdi z LEGACY §4 a doplň neon pro roboty, vodu a elektřinu.
3. `src/rendering/RenderPipeline.ts`: `DefaultRenderingPipeline` (ACES tone mapping, bloom, grain, chromatická aberace, vignette), `SSAO2RenderingPipeline`, exponenciální mlha (`scene.fogMode = FOGMODE_EXP2`). Všechny hodnoty jsou v `data/rendering.json`. Pipeline jde zapínat po částech (podklad pro fázi 21).
4. `dev/main.ts`: registr dev scén (`?scene=<id>`, bez parametru seznam odkazů) a `dev/scenes/EmptyScene.ts`. Každá další fáze přidává svou scénu sem.
5. Registry bez merge konfliktů (paralelní fáze do nich přidávají): `dev/main.ts` najde scény přes `import.meta.glob("./scenes/*Scene.ts", { eager: true })` (každá exportuje `id` a `create`) a `TestHooks.register(name, api)` vystaví `window.__game[name]`. Moduly se registrují samy, takže se sdílený soubor needituje. Přidej `__game.step(ms)`, který posune simulaci s pevným krokem (pro deterministické testy).
6. Smoke test selže i na `console.warn` (DoD §15 „bez chyb a varování“). Neovlivnitelná varování knihoven patří na krátký allowlist v testu s komentářem proč.
7. `src/core/Input.ts`: mapování kláves a myši (WASD, Shift sprint, mezerník, E interakce, kolečko a 1–6 zbraně, prostřední tlačítko dveře podle LEGACY §3, Esc pauza), pointer lock s fallbackem z LEGACY.

**Verification**
Quick gate: výchozí. `npm run build` bez varování. Přidej smoke test, který otevře `/dev/?scene=empty` a ověří `__game.ready`. Snímek `screenshots/01-pipeline.png` scény s pár barevnými krabicemi a bodovým světlem v mlze: grain a vignette jsou vidět, bloom kolem světla. Prohlédni ho.

**Do not**
Neimplementuj hráče ani fyziku (fáze 2). Nepřidávej herní konstanty do kódu. Neimportuj celý `@babylonjs/core` index.

**Done 2026-10-03** (handoff `handoff/phase-1.md`). Odchylky od litery: obsah testovací scény s krabicemi je samostatná dev scéna `pipeline` (data v `data/dev-scenes.json`), `empty` je opravdu prázdná; `?off=bloom,ssao` v dev scénách vypíná části pipeline. Navíc `data/game.json` (pevný krok, výchozí kamera, ambient) a `data/input.json` (mapování kláves). Boot smoke test už nepřepisuje `screenshots/00-boot.png`. Snímky dělá `tools/screenshot.ts`.

## Phase 2 — Player: FPS pohyb v krabicové místnosti

**Implement**
1. Havok init v `src/core/Physics.ts` (WASM přes Vite URL).
2. `src/player/PlayerController.ts` nad `PhysicsCharacterController`: chůze, sprint, skok s coyote time, gravitace, schody (step height), akcelerace a tření. Parametry jsou v `data/player.json`.
3. `src/player/PlayerCamera.ts`: mouse look s omezením pitch, head bob, pohyb kamery při doskoku, FOV kick při sprintu, horizont vždy vodorovně (LEGACY: „Horizont zůstává vodorovný“).
4. `src/player/PlayerHealth.ts`: zdraví, damage, červené okraje obrazovky při zásahu, smrt jako event.
5. `dev/scenes/BoxRoomScene.ts`: místnost 20×20×5 m se schody, rampou, sloupy, krabicemi na skákání a dveřním otvorem. Stejná místnost slouží fázím 3–5.
6. `__game`: `player: { position, velocity, health, teleport(x,y,z), lookAt(x,y,z) }`, `input.simulate(key, ms)` pro testy.

**Verification**
Quick gate: `tests/e2e/movement.spec.ts`. Držet W 2 s → posun 7–12 m (podle `data/player.json`), skok překoná 0,5 m krabici, schody se dají vyjít, hráč neprojde zdí. Snímek `screenshots/02-boxroom.png`.

**Do not**
`UniversalCamera.checkCollisions` jako hlavní kolize. Naklánění horizontu. Rychlosti v kódu.

**Done 2026-10-03** (handoff `handoff/phase-2.md`). Odchylky od litery: schody v boxroomu mají neviditelný šikmý kolizní pás přes hrany stupňů (step-up controlleru na celé schodiště nefunguje spolehlivě, DECISIONS 29); `maxStepHeight` se ověřuje na samostatném obrubníku 0,2 m (`curb`). Místnost je skládaná z dat `data/boxroom.json` přes `dev/BoxRoom.ts` (fáze 3–5 volají `BoxRoom.build` + `Player.create`), navíc výklenek za dveřním otvorem. Navíc `data/physics.json`, `src/core/PhysicsConfig.ts`, `src/player/Player.ts` (skládá controller, kameru, zdraví a overlay), `src/ui/DamageOverlay.ts`, `Game.stepAlpha` (interpolace kamery mezi kroky). `/` se nezměnilo (pořád prázdná scéna, hráč je jen v `/dev/?scene=boxroom`). Oprava po review: větev omylem commitovala symlink `node_modules` (worktree), je odtrackovaný a `.gitignore` má `node_modules` bez lomítka, aby kryl i symlinky; větev je mergnutá s main @ e9d71b5 (fáze 7, 8, 12).

## Phase 3 — Weapon framework + vodní pistolka

**Implement**
1. `src/weapons/Weapon.ts` (base: fire rate, ammo, reload/recharge, viewmodel, sway, recoil, hit effect). `src/weapons/WeaponInventory.ts` (sloty 1–6, kolečko). `data/weapons.json` se všemi šesti zbraněmi z DESIGN §4. Zatím je implementovaná jen pistolka, ostatní mají `enabled: false`.
2. `src/weapons/models/WaterPistolModel.ts`: viewmodel z válců a kvádrů (≤ 1k trojúhelníků), flat shading, barvy z palety. Vykresluje se v samostatné vrstvě nebo s `renderingGroupId`, aby neprolézal zdmi.
3. `src/weapons/WaterPistol.ts`: hitscan (`scene.pickWithRay`), proud vodních částic, šplouchnutí a mokrá skvrna na dopadu.
4. `src/audio/SynthSounds.ts`: syntéza zvuků do `AudioBuffer` (Web Audio). Začni výstřelem pistolky, šplouchnutím a „cvaknutím“ prázdné zbraně.
5. Zásah volá `IDamageable.takeDamage(amount, type)` s typy `water` / `electric` / `kinetic`. Typ se použije u robotů (voda a elektřina škodí víc).
6. `src/utils/ModelRegistry.ts`: každá modelová třída se sama zaregistruje (jméno, factory, rozpočet trojúhelníků podle §13: robot 2k, zbraň 1k). `tests/smoke/model-budget.spec.ts` postaví všechny registrované modely a selže při překročení rozpočtu. Z registru se plní galerie ve fázi 15.

**Verification**
Quick gate: `tests/e2e/weapon.spec.ts`. Výstřel na terč v boxroomu sníží jeho HP o hodnotu z weapons.json. Snímek viewmodelu při střelbě (`screenshots/03-water-pistol.png`): pistolka vypadá jako hranatá hračka, ne jako šedá krabice, a voda je vidět.

**Do not**
Projektily přes fyziku u hitscanu. Zvukové soubory. Další zbraně (fáze 13).

**Done 2026-10-03** (handoff `handoff/phase-3.md`). Pistolka v dev scéně `?scene=weapon` (boxroom + 3 terče z `data/targets.json`), hitscan přes `scene.pickWithRay`, 1 výstřel = −6 HP podle weapons.json, viewmodel 400 tri v rendering group 1. Odchylky od litery: modely z primitiv mají skladbu v `data/models.json` (`blueprints` + rozpočty po kategoriích), třída modelu je tenká nad `BlueprintBuilder`; rozpočtový test běží nad dev scénou `?scene=models`; pistolka má nádržku 30 výstřelů s automatickým napumpováním (zásoba nekonečná) a nová akce `reload` (R); zvuky jsou v `data/sounds.json` a navíc `pump`; `IDamageable` je v `src/core/` a vlastník se hledá přes `DamageTargets` (metadata mesh); oprava v `Game.ts`: Babylon rušil `mousedown`, levé tlačítko nestřílelo. `__game` navíc `weapons`, `targets`, `audio`, `models`.

## Phase 4 — Humanoid robot + AI + navmesh v krabici

**Implement**
1. `src/enemies/models/HumanoidRobotModel.ts`: hierarchie primitiv (trup, hlava se „svítícím okem“, klouby, končetiny), ≤ 2k trojúhelníků, procedurální chůze, míření, zásah a smrt (rozpad na díly, jiskry). Generický design, žádné licencované vzory.
2. `src/enemies/Enemy.ts` (base, `IDamageable`, odolnosti podle typu damage, drop munice podle šance z `data/enemies.json`) a `src/enemies/Humanoid.ts`.
3. `src/enemies/ai/`: Yuka `StateMachine` se stavy Patrol → Alert (slyší/vidí) → Chase → Attack → Search → Patrol. `Vision` s FOV a překážkami přes raycast do scény. Sluch reaguje na výstřely hráče v okruhu. Humanoid se kryje u nejbližšího „cover point“ (meta-data v levelu).
4. `src/level/NavMeshService.ts`: `CreateNavigationPluginAsync` → `createNavMesh` z mesh podlah a statické geometrie. `computePathSmooth` pro pronásledování. Debug vykreslení navmeshe přepínatelné v dev scéně.
5. `Enemy.applyStatus(kind: "slow" | "stun", seconds, strength)` + AI stav Stunned. Fáze 13 jen volá, fáze 14 implementuje pro nové typy.
6. Projektily robota (elektrický výboj) s varováním (nápřah 0,4 s, viditelný záblesk), damage hráči.

**Verification**
Quick gate: `tests/e2e/humanoid.spec.ts` na `dev/?scene=boxroom-enemy`. Robot hráče najde (stav Chase do 5 s po výstřelu), dojde k němu po navmeshi kolem sloupu, zaútočí, vodní pistolka ho zabije počtem zásahů podle JSON. Snímek `04-humanoid.png`: robot musí být čitelný v tmavé scéně.

**Do not**
Yuka navmesh místo recastu. AI parametry v kódu. Modely ze souborů.

**Done 2026-10-03** (handoff `handoff/phase-4.md`). Dev scéna `?scene=boxroom-enemy` (boxroom + pistolka + 1 humanoid z `data/encounters.json`), robot 928 tri, navmesh boxroomu se upeče za ~17 ms, pistolka robota zabije 7 zásahy (60 HP, voda ×1,5). Odchylky od litery: stavy AI navíc Cover (kryt při poklesu HP pod prahy z `enemies.json`), Stunned a Dead; recast se injektuje z lokálních balíčků (addon by ho stahoval z unpkg); drop munice je zatím jen událost `Enemy.onDrop` (pickupy fáze 10); výboje a trosky jsou vlastní balistika, ne Havok tělesa; robot má navíc animovanou Havok kapsli (`EnemyCollider`), aby jím hráč neprocházel; blueprinty v `data/models.json` umí vnořené skupiny (`groupParents`) a kotvy ve skupinách (`anchorParents`); nová akce `debugNavmesh` (N); hluk výstřelů jde přes `src/core/NoiseEvents.ts` (emituje `WeaponInventory`). `__game` navíc `enemies` a `navmesh`.

## Phase 5 — Weapon feel

**Implement**
Ladění „musí být zábavné střílet“ (DESIGN §10 krok 2) v boxroomu:
1. Hit feedback: hitmarker v zaměřovači, záblesk a jiskry na robotovi, krátké zpomalení robota při zásahu, zvuk zásahu podle materiálu (kov / zeď).
2. Viewmodel: sway při pohybu, bob, recoil kick, animace „pumpování“ pistolky.
3. Screen shake při zásahu hráče a při smrti robota. Minimální HUD (zaměřovač, zdraví, munice) jako základ pro fázi 10.
4. Vlna 3–5 humanoidů v boxroomu (`?scene=arena`) s respawnem pro testování.
5. Všechny feel parametry v `data/weapons.json` / `data/feel.json`.

**Verification**
Quick gate: `tests/e2e/arena.spec.ts`. Aréna se dá vyčistit pistolkou bez ztráty víc než 50 % zdraví při skriptované střelbě (`__game.player.aimAt(enemy)` + fire). Snímek `05-weapon-feel.png` při zásahu. Do handoffu napiš URL, na které si člověk arénu zahraje (`npm run dev` → …).

**Do not**
Nové zbraně ani nepřátelé. Přehnaný shake (> 0,3 m posunu kamery).

**Done 2026-10-03** (handoff `handoff/phase-5.md`). Aréna `npm run dev` → http://localhost:5173/dev/?scene=arena (4 humanoidi, vlny, HUD). Quick gate `tests/e2e/arena.spec.ts` zelený; skriptovaná palba vyčistí arénu za ~10 s bez ztráty zdraví, otřes ≤ 0,2 m. Odchylky od litery: hitmarker, HUD a zaměřovač jsou DOM vrstva (`src/ui/Hud.ts`, `Crosshair.ts`), ne GUI textura; zpomalení při zásahu jde přes volitelné `IDamageable.applyStatus` a robot se pozná podle `surface: "metal"` (zbraně neimportují nepřátele); otřes je obecný `ScreenShake` s kanály a stropem `player.json → camera.maxShakeOffset`; sway/bob/recoil/pumpa existovaly z fáze 3, fáze 5 přidala sway při chůzi, náklon zbraně při úkroku a výstřelu a cuknutí pumpy. Navíc FEEDBACK „světlo u zdi“ (STEER 7): příčina změřená A/B snímky (`tools/wall-light-ab.ts`, `screenshots/05-wall-light-{near,far}[-before].png`) je tmavá EXP2 mlha + přepálené zdi; mlha je teď lineární od 5 m, SSAO zkrocené, vignette slabší, lampy boxroomu nižší a černý spekulár vynucuje `MatteDefaults` pro celou scénu (DECISIONS „Fáze 5“).

## Phase 7 — Matterport a Poly Haven textury

**Implement**
1. `tools/matterport-textures.ts` (spouštět `npm run tool tools/matterport-textures.ts`, `sharp` už je nainstalovaný): z `reference/matterport/` vyřízne a zpracuje dlaždicové textury do `public/textures/mp/`:
   - `floor-checker` (šachovnice chodby; z půdorysu Floor 4, přesné měřítko 85 px/m, 1 dlaždice = změř),
   - `floor-parquet-gym` (tělocvična č.1 z Floor 2, včetně čar hřiště jako samostatná decal textura),
   - `floor-lino-orange`, `floor-lino-yellow`, `floor-lino-green` (učebny z Floor 3/4/5),
   - `wall-plaster` (bílá omítka z panoramat chodeb), `wall-wainscot-wood` (dřevěný obklad: tělocvična / vstupní hala), `door-wood` (masivní dveře jako textura celého křídla), `locker-blue`, `stair-tread`, `beam-wood` (podkroví), `courtyard-paving`, `window-prague` (výhled ze `terasa_vyhled` pro okna).
   Postup: výřez → srovnání jasu a perspektivy (z `down.jpg` a půdorysů je ortografický) → bezešvé okraje (offset + blend nebo mirror) → zmenšení na 512 px → posterizace podle stylu (volitelně pixelace jako Quake). Výstupní parametry jsou v `tools/matterport-textures.json`.
2. `tools/fetch-textures.ts`: Poly Haven API (`api.polyhaven.com`) s CC0 materiály, které Matterport nemá: beton, suť, spálenina, kov, rez. 1K, idempotentní, cache v `public/textures/ph/`. Bez sítě se tiše přeskočí.
3. `public/textures/index.json`: seznam vyrobených textur (id, soubor, rozměr v metrech na dlaždici, zdroj). Materiály z toho postaví fáze 9 (`MaterialLibrary`), tahle fáze engine nepotřebuje.
4. `ASSETS.md`: řádek pro každou texturu (zdroj: Matterport panoráma/půdorys + soubor, nebo Poly Haven URL + CC0).
5. `tools/texture-sheet.ts`: složí všechny výstupní textury do jednoho náhledu `screenshots/07-textures.png` (sharp, bez enginu, aby fáze nezávisela na fázi 1). Datový test `tests/data/textures.test.ts`: každý záznam v `public/textures/index.json` existuje a má ≤ 1024 px.

Paralelní fáze směny 1: jen `tools/`, `public/textures/`, `ASSETS.md`, `tests/data/`. Žádný `src/`.

**Verification**
Quick gate: výchozí (typecheck + `npm test`). Skripty běží idempotentně (druhé spuštění nic nemění). Náhled `screenshots/07-textures.png` prohlédni: šachovnice chodby je pravidelná, bez švů a s barvou blízkou fotce, parkety jsou čitelné. Velikost `public/textures/` < 25 MB.

**Do not**
Textury v plném rozlišení (> 1K). Ruční úpravy obrázků mimo skript. Stahování z jiných domén než Poly Haven.

**Done 2026-10-03** (handoff `handoff/phase-7.md`): 14 Matterport textur + decal čar tělocvičny, 5 Poly Haven (CC0), `public/textures/index.json`, 5,9 MB, skripty idempotentní, `tests/data/textures.test.ts`. Šachovnice: perioda 35,5 px → dlaždice 29,5 cm kladená 45°. Odchylky: parkety, žluté a zelené linoleum, dlažba dvora a schody jsou z `down.jpg` panoramat (354 px/m) místo půdorysů (85 px/m je málo). Oranžové linoleum má barvu z půdorysu Floor 3 a zrno z panoramatu. Geometrie šachovnice je ideální mřížka napasovaná na fotku. Čáry hřiště jsou samostatný decal (`plan.rectPx`). Poly Haven 1K cache je v `public/textures/ph/raw/` a do hry jde posterizovaná 512px kopie.

## Phase 8 — Level layout: level.json podle Matterportu

**Implement**
1. Vyber 3 hratelná patra (DECISIONS #2): pravděpodobně Floor 2 (vstup, tělocvična, šatny) + dvě patra s učebnami (Floor 3/4, nebo 4/5 kvůli laboratoři). Výběr a důvod zapiš do DECISIONS.md. Ostatní patra a slepé konce jsou zavalené (suť, propadlý strop).
2. Schéma `data/level.json` (typy v `src/level/LevelTypes.ts`): `floors[]` (výška, výška stropu) a `rooms[]` (id, jméno, patro, polygon/obdélník v metrech, materiál podlahy a stěn, typ: učebna / kabinet / chodba / schodiště / tělocvična / šatna / hala). Dál `doors[]` (pozice, šířka, mezi kterými místnostmi, `lock: none|red|yellow|blue|exit`), `windows[]`, `stairs[]` (z patra na patro, ramena), `blockers[]` (zával), `coverPoints[]`, `spawns{}`, `pickups[]`, `teachers[]` (slot učitele podle Evidence → Progrese + pozice židle), `keys[]` (barva → slot učitele, který klíč dává; teachers.json zatím neexistuje), `lights[]` a `fires[]`.
3. Souřadnice odečti z půdorysů: 1 m = 85 px a počátek je v levém horním rohu obrázku (stejný pro všechna patra). Rozsah: ~12 místností, 3 chodby, 2 schodiště, 6+ kabinetů pro učitele z Evidence → Progrese. Trasa 300–500 m od startu po hlavní vchod. Zkracuj, ale drž skutečné proporce, šachovnicovou chodbu, polohu schodišť a tělocvičny.
4. `tools/level-overlay.ts` (sharp, bez enginu): pro každé patro vykreslí přes půdorys obdélníky místností, dveře (barva zámku), trasu a spawny z level.json do `screenshots/08-levelmap-floor{N}.png`. Slouží k ověření, že data sedí na fotku.
5. `tools/level-route.ts`: spočítá délku hlavní trasy (body v level.json) a vypíše ji.

Paralelní fáze směny 1: jen `data/level.json`, `src/level/LevelTypes.ts`, `tools/` a `tests/data/`. Žádný kód enginu.

**Verification**
Quick gate: výchozí. `screenshots/08-levelmap-floor{N}.png` pro každé patro prohlédni: obdélníky sedí na místnosti v půdorysu (±1 m). Číselně (v testu) ověř 3–4 orientační body proti hodnotám změřeným v pixelech a zapsaným v `tools/level-landmarks.json`: obě schodiště, rohy tělocvičny č.1, hlavní vchod. Datový test `tests/data/level.test.ts`: dveře spojují existující místnosti, každý zámek má záznam v `keys[]`, schodiště spojují existující patra, trasa je 300–500 m.

**Do not**
3D geometrii (fáze 9). Celá budova: jen vybraná patra. Ruční modelování.

**Done 2026-10-03** (handoff `handoff/phase-8.md`). Patra Floor 2 + 3 + 4, trasa 414,1 m, 28 místností (6 kabinetů s učiteli), 2 meziposchoďová schodiště + 2 krátká uvnitř Floor 2. Odchylky od litery: měřítko je **83 px/m** (změřeno na měřítku v obrázku, ne 85), souřadnice půdorysu se do Babylonu mapují s `worldZ = −z`; místnosti jsou jen obdélníky; tělocvična (−1,4 m) a zádveří (−1,0 m) leží níž a mají vlastní krátká schodiště; sdílené dotazy jsou v `tools/LevelQueries.ts`. Pořadí učitelů z Evidence → Progrese se nemění. Oprava po review: učebna č. 33 a kabinet zeměpisu přeměřeny (hranice 28,8 m, kabinet do 31,9 m); přesnost obdélníků ověřuje `tools/level-wall-scan.ts` (74 stěn: 58 do 0,5 m, 12 do 1 m, 4 hlášení nad 1 m jsou artefakty skeneru, na výřezech sedí) a 10 stěnových landmarků v testu.

## Phase 9 — Greybox generátor

**Implement**
0. `src/rendering/MaterialLibrary.ts` + `data/materials.json`: pojmenované materiály z `public/textures/index.json` (fáze 7) s tintem z palety, uvScale a emissive. Bez souboru použije procedurální fallback (canvas šum nebo mřížka).
1. `src/level/LevelBuilder.ts` (+ `WallBuilder`, `StairBuilder`, `OpeningBuilder`, každý ve vlastním souboru): z level.json postaví podlahy, stropy a stěny s otvory pro dveře a okna (CSG2 nebo skládání segmentů; segmenty jsou rychlejší), schodiště, zábradlí a závaly.
2. Statická geometrie se slučuje podle materiálu (`Mesh.MergeMeshes`), statická těla Havok, `freezeWorldMatrix`.
3. **Bez navmeshe:** `NavMeshService` vzniká souběžně ve fázi 4. Navmesh levelu napojí fáze 10. `LevelBuilder` jen vrátí seznam mesh vhodných pro navmesh (`getNavigableMeshes()`).
4. Okna: sklo a za ním výhled (`window-prague` na billboardu nebo procedurální noční obloha s požáry).
5. Level je k vidění v dev scéně `?scene=level` (s hráčem z fáze 2). `/` přepne na level až fáze 10, protože `Game.ts` souběžně edituje sériová stopa.
6. `__game.level`: `rooms`, `teleportToRoom(id)`, `pathLength(fromId, toId)`.

**Verification**
Quick gate: `tests/e2e/level-walk.spec.ts` (jedna načtená stránka pro všechny kontroly, level se nestaví znovu). Hráč teleportovaný do každé místnosti stojí na podlaze a nepropadne. Hráč dojde po schodech o patro výš. Počet trojúhelníků na místnost ≤ 20k (assert v testu). Snímky chodby se šachovnicí a schodiště (`screenshots/09-*.png`) porovnej s panoramaty v `reference/`.

**Do not**
Detaily, suť a oheň (fáze 19). Ruční pozice v kódu.

**Done 2026-10-03** (handoff `handoff/phase-9.md`). `?scene=level` staví celý level (28 místností, 3 patra) za < 1 s; quick gate zelený (39 datových testů, 5 smoke + 6 `level-walk`). Odchylky od litery: kromě `WallBuilder`/`StairBuilder`/`OpeningBuilder` jsou samostatné třídy `LevelLayout` (dotazy bez enginu, sdílí je data test), `RailingBuilder`, `StaticGeometry` (sloučení + Havok compound), `LevelGraph` (`pathLength` po dveřích a schodech, bez navmeshe) a `Level`; parametry generátoru jsou v `data/greybox.json`. Kolize jsou box tvary v jednom statickém compoundu na místnost, ne Havok aggregate na mesh. Okna: sklo s kolizí + samosvítící billboard `window-prague` (tónovaný podle `view`). Závaly jsou zatím jeden box suti. Opravy z kritiky směny 1: barvy světel v `level.json` jsou klíče palety (+ test), textury z půdorysu přegenerované v 83 px/m, Evidence opravena; navíc 6 světel do neosvětlených místností, `ceilingHeight` snížených místností a Vite `cacheDir` per worktree (sdílený cache rozbíjel paralelní dev servery).

## Phase 10 — Dveře, klíče, inventář, HUD, pickupy

**Implement**
0. Navmesh levelu přes `NavMeshService` (fáze 4) z `LevelBuilder.getNavigableMeshes()` (fáze 9), generování ≤ 3 s. `/` nově startuje v levelu na startovní pozici.
1. `src/level/Door.ts`: otevírání (E nebo prostřední tlačítko, LEGACY §3), zamčené barvou, zavřené blokují pohyb, střely i výhled AI. Navmesh se upraví přes obstacles nebo off-mesh. Hlášky „Potřebuješ červený klíč“ z `data/texts.json`.
2. `src/level/KeyPickup.ts` (modely klíčů z primitiv, rotace, světlo v barvě klíče), `src/player/Inventory.ts` (klíče, munice, power-upy).
3. Power-upy (DESIGN §6) v `data/pickups.json`: lékárnička, gumáky (odolnost vůči `electric`; tahle fáze to vlastní i pro budoucí typy robotů: snížení je v `PlayerHealth`), energetický drink (rychlost 30 s). Doplňování hasičáku vlastní fáze 13.
4. `src/ui/Hud.ts` (Babylon GUI): zdraví, munice, aktivní zbraň (sloty 1–6), klíče, ikony power-upů s časovačem, toasty (styl LEGACY §4), zaměřovač a hitmarker z fáze 5.
5. `__game.inventory`, `__game.give(item)`, `__game.doors` (stav, `tryOpen(id)`).

**Verification**
Quick gate: `tests/e2e/doors-keys.spec.ts`, `tests/e2e/level-walk.spec.ts`. Pro každou dvojici sousedních místností existuje navmesh cesta (přidej do level-walk). Bez klíče se zamčené dveře neotevřou a zobrazí hlášku. Po sebrání klíče se otevřou. Zavřené dveře zastaví výstřel i robota. Power-upy fungují (rychlost +x % po dobu 30 s). Snímek HUD `screenshots/10-hud.png` prohlédni: čitelnost na tmavé scéně, české texty s diakritikou.

**Do not**
Kvíz (fáze 11). Ukládání (fáze 16).

## Phase 11 — Učitelé a kvízový systém

**Implement**
1. `data/teachers.json`: 8 učitelů z LEGACY §1 **beze změny jmen a předmětů** + nový fyzikář (vymysli fiktivní příjmení a přezdívku ve stylu ostatních; nesmí to být skutečná osoba). Každý má předmět, místnost (id z level.json), odměnu podle Evidence → Progrese, hlášku po osvobození (vtipná, k předmětu a k robotům) a hlášku při špatné odpovědi.
2. `src/level/models/TeacherModel.ts`: low-poly figura z primitiv sedící svázaná na židli, barevná varianta podle předmětu (LEGACY §4), pouta s blikající robotí pastí, procedurální dech a pohyb hlavy, po osvobození vstane. Jmenovka nad hlavou podle LEGACY §1 (příjmení + předmět).
3. `src/quiz/QuizSystem.ts`: interakce E → pauza hry, uvolní pointer lock → otázka. Správně = pouta se rozpojí, odměna, hláška. Špatně = exploze pasti (částice, zvuk, shake), damage `wrongAnswerDamage` z quiz.json (DESIGN §3) × obtížnost a otázka znovu. Výchozí chování: **další náhodná otázka z téhož předmětu**; zapiš do DECISIONS. Hráč může odejít.
4. `src/quiz/QuizUI.ts`: fullscreen GUI overlay, otázka, 4 tlačítka A–D, klávesy 1–4, styl LEGACY §4.
5. `data/quiz.json` už existuje z fáze 12 (směna 1); pokud ne, vytvoř dočasný se 2 otázkami na předmět. Formát podle DECISIONS #16.
6. `__game.quiz`: `active`, `current { subject, correct }`, `answer(i)`.
7. Dev scéna `dev/?scene=teacher` (boxroom + jeden učitel). Do levelu učitele osadí fáze 16. Odměna jde přes `Inventory.give(itemId)` (fáze 10). Zbraně 2–6 vznikají souběžně ve fázi 13, takže zbraňová odměna je zatím jen item id a test ověřuje inventář, ne zbraň v ruce.

**Verification**
Quick gate: `tests/e2e/quiz.spec.ts`. Interakce s učitelem otevře kvíz, hra je pozastavená, špatná odpověď ubere damage podle JSON a ukáže další otázku, správná odpověď dá odměnu a učitel vstane. Snímky `11-teacher.png` a `11-quiz.png` prohlédni (diakritika, čitelnost, učitel vypadá jako karikatura, ne jako robot).

**Do not**
Skutečné osoby. Otázky v kódu.

## Phase 12 — Quiz content

**Implement**
1. `data/quiz.json`: 5–10 otázek na každý z 9 předmětů (Matematika, Čeština, Angličtina, Zeměpis, Tělocvik, Dějepis, Hudebka, Výtvarka, Fyzika; teachers.json ještě nemusí existovat, předměty jsou z LEGACY §1 a Decisions #1). Úroveň osmiletého gymnázia, lehce vtipné a tematicky navázané na děj (roboti, AGI Neuralith Dynamics, voda a elektřina; fyzikář se ptá na vodivost vody). Formát `{ "wrongAnswerDamage": 20, "subjects": [{ "subject", "questions": [{ "q", "options": [4], "correct": 0–3 }] }] }` (DECISIONS #16). Vždy 4 možnosti a jedna správná. Správná odpověď je rovnoměrně rozložená mezi A–D.
2. Fakta musí být **pravdivá**: u každé otázky si ověř správnou odpověď, žádné sporné nebo zavádějící formulace. Matematika a fyzika s jednoznačným výsledkem.
3. `tests/data/quiz.test.ts` (`node:test` přes tsx, běží v `npm test`): schéma, 4 neprázdné možnosti, `correct` v 0–3, bez duplicit otázek i možností, každý z 9 předmětů má ≥ 5 otázek, rozložení správných odpovědí není víc než 40 % na jednom písmenu.

Paralelní fáze směny 1: jen `data/quiz.json` a `tests/data/quiz.test.ts`.

**Verification**
Quick gate: výchozí. Test zelený. Vypiš 3 náhodné otázky na předmět do handoffu k lidské kontrole.

**Do not**
Otázky odkazující na skutečné osoby ze školy. Anglické otázky mimo předmět Angličtina.

**Done 2026-10-03** (směna 1, handoff `handoff/phase-12.md`). `data/quiz.json`: 72 otázek (7–9 na předmět), správné odpovědi A/B/C/D 18/18/18/18 a vyvážené i uvnitř každého předmětu. `tests/data/quiz.test.ts` navíc hlídá horní mez 10 otázek na předmět, žádné neznámé předměty a jen klíče `wrongAnswerDamage` + `subjects`. Odchylky od litery: žádné. Fáze vytváří adresář `data/`, který na main chyběl.

## Phase 13 — Zbývající zbraně

**Implement**
Podle DESIGN §4 a `data/weapons.json`. Každá zbraň má vlastní viewmodel z primitiv (≤ 1k tri), sway, zvuk, efekt dopadu a registraci v galerii:
1. Hasicí přístroj: kužel (sada raycastů nebo trigger kužel), krátký dosah, zpomaluje roboty přes `Enemy.applyStatus("slow")`, omezená náplň, doplnění z nástěnných hasičáků (`ExtinguisherRefill` jako samostatná třída; rozmístění v levelu udělá fáze 16).
2. Vodní balónky: hod po oblouku (Havok těleso), AoE šplouchnutí, sbírané. Munice zůstává ve `WeaponInventory`, `Inventory` z fáze 10 se needituje.
3. Paralyzér: hitscan krátký dosah, stun robota přes `Enemy.applyStatus("stun")` (fáze 4), nabíjení.
4. Školní railgun: nabíjecí výstřel (držet), průraz více robotů, vzácná munice, výrazný paprsek a bloom.
5. Hadice: stacionární hydrant v tělocvičně. Hráč u něj stojí a ovládá silný nekonečný proud, při pohybu ho pustí.

**Verification**
Quick gate: `tests/e2e/weapons-all.spec.ts` ve vlastní dev scéně `?scene=weapons` (arénu edituje souběžně fáze 14). Každá zbraň dává damage nebo efekt podle JSON (zpomalení, stun, AoE poloměr). Jeden snímek se všemi viewmodely vedle sebe (`13-weapons.png`). Rozpočtový test (fáze 3) zelený.

**Do not**
Měnit pistolku z fáze 3 kromě refaktoru base třídy.

## Phase 14 — Zbývající nepřátelé

**Implement**
1. Čtyřnohý robot (`QuadrupedRobotModel`, `Quadruped.ts`): sprint, výpad, obíhání hráče (Yuka steering), melee damage.
2. Dron (`DroneModel`, `Drone.ts`): létá ve výšce, hledá hráče (wander + seek), slabý a otravný, vlastní zvuk (bzučení podle LEGACY §5 receptů). Navigace přes volný prostor (vlastní 3D steering s raycasty, ne navmesh).
3. Drop tabulky a odolnosti (voda, elektřina) v `data/enemies.json`. `applyStatus` (slow/stun) pro nové typy. Gumáky řeší fáze 10 v `PlayerHealth`.
4. Spawny v level.json podle místností, s počty závislými na obtížnosti (faktor doplní fáze 17).

**Verification**
Quick gate: `tests/e2e/enemies-all.spec.ts` na `?scene=arena` se všemi třemi typy. Každý typ najde hráče a zaútočí a pistolka ho zabije. Snímek `14-enemies.png`. Rozpočtový test zelený.

**Do not**
Boston Dynamics podobu. Bossy.

**Done 2026-10-03** (handoff `handoff/phase-14.md`). Aréna se všemi typy: `npm run dev` → http://localhost:5173/dev/?scene=arena&encounter=arenaMixed. Quick gate `tests/e2e/enemies-all.spec.ts` zelený: každý typ po výstřelu najde hráče do 0,1 s, za 3–12 s ho dvakrát zraní (úbytek zdraví = damage z JSON), slow/stun funguje, pistolka zabije humanoida 7, čtyřnožce 5 a dron 3 zásahy. Modely: čtyřnožec 816 tri, dron 660 tri. Odchylky od litery: aréna se všemi typy je parametr `&encounter=arenaMixed` (výchozí aréna fáze 5 zůstala, její test počítá s humanoidy); navmesh chůze je nová společná třída `GroundAgent` (humanoid přesunut mechanicky); obíhání a výpad jsou Yuka seek (`steerTo`), dron má seedovaný wander místo Yuka `WanderBehavior` (Math.random); spawny v level.json už osadila fáze 8 — fáze 14 přidala `minCountDelta` (brána podle `enemyCountDelta` z fáze 17) a 4 roboty navíc pro těžší obtížnosti, osazení do levelu dělá fáze 16 přes `LevelEnemySpawns.encounter(layout, delta)`; bzučení je opakovaný nesprostorový vzorek (fáze 20).

## Phase 15 — Model gallery (kompletní) a stylová revize

**Implement**
1. `dev/scenes/GalleryScene.ts` plněná z `ModelRegistry` (fáze 3): všechny modely na podstavcích s popiskem a počtem trojúhelníků, pod herním osvětlením: 6 zbraní, 3 roboty, učitele (9 variant), klíče, power-upy, dveře, rekvizity (lavice, židle, tabule, skříňky, hasičák, hydrant).
2. Revize stylu podle DESIGN §1 a §13 proti jednomu snímku galerie: konzistentní hranaté siluety, paleta, flat shading. Sjednoť odchylky.
3. Detailní rekvizity pro učebny a kabinety: lavice, židle, katedra, tabule, skříně, globus, piano v hudebně, laboratorní stoly, žebřiny. Instancované (`thinInstances`). Rozmístění je v **samostatném** `data/props.json` (podle id místností) a `src/level/PropPlacer.ts`. Do stavby levelu ho napojí fáze 16 (ta ve stejné směně edituje level). Tady je vidět v dev scéně `?scene=props`.

**Verification**
Quick gate: výchozí (rozpočtový test je ve smoke), plus datový test, že rekvizity jedné místnosti nepřesáhnou 20k − trojúhelníky geometrie místnosti. `screenshots/15-gallery.png` prohlédni a porovnej se stylem §1/§13.

**Do not**
Nový styl. Textury fotek na postavách (jen paleta).

## Phase 16 — Progrese, osazení levelu, checkpointy, průchod levelem

**Implement**
1. Osaď level podle Evidence → Progrese: učitelé v kabinetech, klíče, zamčené dveře, balónky na chodbě, hydrant v tělocvičně, nepřátelé, pickupy, nástěnné hasičáky (`ExtinguisherRefill`), rekvizity (`PropPlacer` z fáze 15). Zbraňové odměny učitelů napoj na skutečné zbraně z fáze 13. Pokud mapa vynutí jiné pořadí, uprav tabulku v PLAN.md a DECISIONS.
2. Start: úvodní text (příběh z DESIGN §2, tón LEGACY §3). Konec: hlavní vchod s modrým zámkem (`lock: exit`) → obrazovka konce levelu (čas, zabití, správné a špatné odpovědi, obtížnost).
3. `src/core/Checkpoint.ts`: uloží stav do localStorage na startu a po každém klíči (pozice, inventář, osvobození učitelé, otevřené dveře, mrtví nepřátelé). Obnovení po smrti a z menu.
4. `tests/e2e/playthrough.spec.ts`: skriptovaný hráč přes `__game` projde celou trasu (teleport mezi waypointy + skutečná chůze na krátkých úsecích, zabití nepřátel přes aimAt+fire, odpovědi v kvízu správně i jednou špatně, otevření všech dveří) až k východu a ověří obrazovku konce. Zapiš délku trasy.

**Verification**
Quick gate: `tests/e2e/playthrough.spec.ts` (jediná fáze, kde ho quick gate obsahuje; dál běží jen ve shift gate). Snímek konce levelu. Odhad doby hraní (trasa / rychlost chůze + souboje + kvízy) 15–25 min, výpočet do handoffu.

**Do not**
Plné uložení hry. Měnit jména učitelů.

## Phase 17 — Difficulty

**Implement**
1. `data/difficulty.json`: 5 stupňů z LEGACY §2 (id, název, podtitul, motto, portrét). Násobiče: `playerHealth` (DECISIONS #15), `incomingDamage` (= legacy `incoming`), `enemyHealth` (`health`), `enemySpeed` (`speed`), `attackPace` (`pace`), `enemyCountDelta` (`extra`), `quizWrongDamage` (= `incoming`), `pickups` (podle `foundFood`/`foundDrink`). Výchozí Záškoláček.
2. Výběr obtížnosti v menu ve stylu staré hry. SVG portréty převezmi z `legacy/index.html:3` (je to obsah, ne kód) a Schrödingerovu rovnici u Ultrašprta.
3. Propsat do hráče, nepřátel, spawnů, kvízu a pickupů.

**Verification**
Quick gate: `tests/e2e/difficulty.spec.ts`. Na Mimino vs. Ultrašprt se liší zdraví hráče, damage robota, počet spawnů a damage za špatnou odpověď přesně podle JSON. Snímek výběru obtížnosti prohlédni.

**Do not**
Měnit jména, motta ani portréty.

## Phase 18 — Menu a herní tok

**Implement**
1. Hlavní menu: Nová hra (→ obtížnost), Pokračovat (checkpoint), Kvalita, Ovládání, Zdroje (výpis ASSETS.md, poděkování a odkaz na starou verzi `legacy/`), styl LEGACY §4 (Barlow Condensed a Inter lokálně, ne z CDN; pokud font není, použij systémový).
2. Pauza (Esc), smrt + restart z checkpointu, obrazovka konce levelu (fáze 16), úvodní příběh.
3. Nastavení: citlivost myši, hlasitost, invert Y. Ukládá se do localStorage.

**Verification**
Quick gate: `tests/e2e/menu.spec.ts`: menu → hra → pauza → menu → pokračovat. Snímek hlavního menu a pauzy prohlédni (diakritika, kontrast).

**Do not**
Externí CDN pro fonty a skripty.

## Phase 19 — Visual pass

**Implement**
1. Osvětlení Quake 1: tma, bodová světla (zářivky blikající přes poškozený obvod, nouzová světla, oheň), exponenciální mlha, film grain, světla podle `data/level.json` a `data/rendering.json`.
2. Generátor detailů `src/level/DetailGenerator.ts`: suť, trámy, propadlé stropy u závalů, rozbitý nábytek, kabely, spáleniny, vyražená okna, vše z primitiv a deterministicky (seed v level.json).
3. Oheň: částice + blikající bodové světlo + prostorový zvuk. Kouř, jiskry z poškozených robotů a lamp.
4. Procedurální detailní textury v shaderu nebo canvasu: spáleniny, skvrny, graffiti Neuralith Dynamics, nápisy na dveřích (čísla učeben z reference).
5. Stíny: `ShadowGenerator` pro nejvýš 2 bodová světla poblíž hráče (přepínaná podle vzdálenosti). Na jejich vypínání podle presetu navazuje fáze 21.
6. Prostředí: procedurální noční obloha s kouřem a zářím požárů jako environment (pro PBR odlesky) místo stažené HDR. Je to v duchu §13 fallback; zapiš do DECISIONS.
7. Padající předměty (DESIGN §8): pár dynamických Havok těles (židle, suť, kusy stropu), která reagují na zásah, výbuch pasti a hadici.
8. DoD §15: žádný viditelný prvek není netexturovaná primitiva bez světla.

**Verification**
Quick gate: `tests/e2e/level-walk.spec.ts`. Snímky 3 klíčových míst (chodba, kabinet s učitelem, tělocvična) `screenshots/19-*.png` prohlédni a porovnej s `reference/matterport/panoramas`. Musí být poznat škola, a přitom tma a zkáza.

**Do not**
Rozbít čitelnost hratelnosti (nepřátelé, klíče a dveře musí být vidět).

## Phase 20 — Audio pass

**Implement**
1. Všechny zvuky syntézou (`SynthSounds`, recepty LEGACY §5 + nové): kroky podle materiálu podlahy, voda, syčení hasičáku, servomotory robotů, výpad čtyřnožce, bzučení dronu, oheň, výbuch pasti, výstřely všech zbraní, UI.
2. Prostorové zvuky přes Babylon AudioV2 (robot, dron, oheň). Útlum za zavřenými dveřmi.
3. Hudba: krátká chiptune smyčka (procedurální sekvencer na Web Audio, nebo `tone` jako dependency, rozhodni a zapiš). Tišší v kvízu.
4. Hlasitosti v `data/audio.json`, ovládání v nastavení.

Běží sériově po fázi 19: napoj zvuky na existující oheň, roboty a zbraně přes `AudioService` (posluchače událostí), ne přepisováním jejich logiky.

**Verification**
Quick gate: `tests/e2e/audio.spec.ts`. Ověří, že se audio engine odemkne po kliknutí a hraje (`AudioContext.state === "running"`) a že klíčové zvuky existují (`__game.audio.list()`). Žádné chyby v konzoli.

**Do not**
Zvukové soubory z internetu.

## Phase 21 — Quality presets a výkon

**Implement**
1. `data/quality.json`: Nízké (bez SSAO a bloomu, stíny jen od 1 světla, hustší mlha, render scale 0,6, méně částic), Střední, Vysoké (vše, stíny až 2 bodová světla + případně CSM pro okenní světlo, plné částice) podle DESIGN §8 a DECISIONS #11.
2. `src/rendering/QualityManager.ts`: autodetekce podle `navigator.gpu` adapteru (info.vendor/architecture) a fps během prvních 3 s ve hře (začni na Středním, přepni nahoru nebo dolů). Ruční přepnutí v menu, uložené v localStorage.
3. `__game.quality`: `{ preset, set(name), autodetected }`.
4. Výkon a načítání: profiluj (`SceneInstrumentation`, draw calls) a oprav největší problémy. Merge a instancování statiky, `freezeActiveMeshes`, culling po místnostech, sdílené materiály, pooling částic a projektilů, code-splitting dev scén a inspectoru. Načtení do hratelného stavu ≤ 5 s lokálně. Jen pokud presety cílů nedosáhnou, jinak nic nepřepisuj.

**Verification**
Quick gate: `tests/e2e/perf.spec.ts` (jediný test v 1920×1080, ostatní e2e běží v 1280×720): stejná kamera v nejnáročnější scéně. Vysoké ≥ 60 fps (nebo vsync strop) na tomto stroji. Nízké s CDP `Emulation.setCPUThrottlingRate(4)` ≥ 30 fps. Autodetekce vybere preset a hlásí ho. Výsledky (fps, doba načtení) do `PERF.md` s datem.

**Do not**
Měnit herní logiku podle presetu (jen vizuál).

## Phase 23 — Deploy na GitHub Pages

**Implement**
1. `.github/workflows/pages.yml`: na push do `main` spustí `npm ci && npm run build`, zkopíruje `legacy/` do `dist/legacy/` (stará hra dál funguje na `/legacy/`) a nasadí přes `actions/deploy-pages`. Dev scény se do produkce nenasazují, nebo jen pod `/dev/` (rozhodni a zapiš).
2. Vite `base: "./"` musí fungovat i pod `/<repo>/`. Havok WASM a recast musí jít načíst z podcesty.
Paralelní fáze směny 5: jen `.github/workflows/` a případně `vite.config.ts` (`base`). Kopírování `legacy/` je krok ve workflow, ne ve Vite.

**Verification**
Quick gate: výchozí. Lokálně `npm run build && npx vite preview`, plus jednorázová ruční kontrola pod podcestou (`--base /Posledni_zvoneni/`, s `legacy/` zkopírovanou do `dist/`): hra nastartuje a `/legacy/` se načte. Nový test nepřidávej. **Nepushuj.** Do Backlogu přidej položku pro člověka „pushnout a v Settings → Pages přepnout zdroj na GitHub Actions“.

**Do not**
Push. Úpravy Settings repozitáře.

## Phase 24 — DoD audit

**Implement**
Projdi DESIGN §15 bod po bodu (s úpravami z DECISIONS) a ke každému napiš do `PLAN.md` → `## DoD audit` důkaz (test, snímek, číslo z PERF.md) nebo opravu. Doplň `ASSETS.md` a `DECISIONS.md`. Zkontroluj, že kód splňuje pravidla z CLAUDE.md (žádná herní data v kódu: grep na čísla v `src/`, jedna třída na soubor) a oprav nálezy. Plnou sadu spustí shift gate; sám spusť jen testy, kterých se tvoje opravy týkají.

**Verification**
Quick gate: `tests/e2e/perf.spec.ts`, `tests/e2e/playthrough.spec.ts`. Všechny body DoD mají důkaz. Snímky finálního stavu (`screenshots/24-*.png`) prohlédni.

**Do not**
Prohlásit hotovo, dokud některý bod DoD nemá důkaz.

## Phase F1 — FEEDBACK: z-fighting a panorama Prahy

Zdroj: `FEEDBACK.md` (2026-10-03 22:30). Patří na začátek `serial` ve směně 3, před fázi 10.

**Implement**
1. **Z-fighting audit:** `src/level/GeometryAudit.ts` projde po stavbě levelu všechny statické meshe (i ty sloučené podle materiálu). Najde dvojice trojúhelníků, které leží ve stejné rovině (normála ±, vzdálenost roviny < 2 mm) a průmět jejich ploch se překrývá (> 1 cm²). Výpis obsahuje mesh, materiál, místnost a pozici. Je dostupný přes `__game.level.audit()` a jako `npm run tool tools/geometry-audit.ts` (headless přes Playwright, vypíše tabulku).
2. Oprav **příčiny** v builderech (`WallBuilder`, `StairBuilder`, `OpeningBuilder`, `LevelBuilder`), ne jednotlivé výskyty:
   - podlaha patra N+1 vs strop patra N: strop o tloušťku desky níž, nebo jen jedna plocha;
   - stěny sousedních místností sdílející hranici: generuj sdílenou stěnu jednou, nebo s tloušťkou;
   - překryv segmentů stěn v rozích a u otvorů;
   - obklady, sokly, tabule a zárubně na stěně: odsazení ≥ 1 cm;
   - podlahy chodby a místnosti v otvoru dveří.
3. Hloubková přesnost: kamera `minZ` ≥ 0,05 m a `maxZ` podle velikosti levelu. Pokud to engine podporuje na WebGPU i WebGL2, zapni `useReverseDepthBuffer`. Zapiš do DECISIONS.
4. **Panorama Prahy jako skybox:** `tools/prague-skybox.ts` (sharp). Zdroj je `reference/matterport/panoramas_4k/terasa_vyhled/{a,b,c,d}.jpg` (4 souvislé boční stěny krychle 4096², pořadí a→b→c→d navazuje dokola), `up.jpg` (obloha) a `preview.jpg` (náhled). Popředí terasy (dlažba, židle, stoly, atika) je pod horizontem. Ořízni ho tak, že pod linií střech a atiky nahradíš plochu tmavou siluetou střech nebo tmou s mlhou. Plynulý přechod, žádný šev. `down` = tma. Výstup: cube map `public/textures/sky/prague_{px,nx,py,ny,pz,nz}.jpg`, 2048² (Nízké může použít 1024²), s nočním gradingem podle DESIGN §1: tma, modrá noc, zář požárů na obloze, kouř. Zachovej siluety Mikuláše a Hradu, aby to bylo poznat.
5. `src/rendering/Skybox.ts`: `CubeTexture` + skybox mesh (infinite distance), orientace taková, aby výhled seděl se skutečnou orientací (Mikuláš ze západních oken; ověř podle `reference/matterport/views/` a panorámat chodeb a zapiš do DECISIONS). Okna mají jen sklo, žádnou per-okno texturu `window-prague`; přes sklo je vidět skybox. Odstraň použití `window-prague` z materiálů.
6. `ASSETS.md`: řádek pro skybox (zdroj Matterport panoráma terasy).

**Verification**
Quick gate: `tests/e2e/level-walk.spec.ts`. Přidej do něj assert `audit()` = 0 nálezů. Snímky: pohled z okna chodby na 2 místech (`screenshots/F1-window-*.png`) — výhled navazuje, žádný šev a žádné židle z terasy. Pohled do chodby a rohu učebny, kde dřív problikávalo (`F1-zfight-*.png`).

**Do not**
Opravovat z-fighting posunem kamery nebo vypnutím depth testu. Používat jiné zdroje než Matterport terasu. Rozlišení vyšší než 2048² na stěnu.

**Done 2026-10-03** (handoff `handoff/phase-F1.md`). Audit `src/level/GeometryAudit.ts` (`__game.level.audit()`, `npm run tool tools/geometry-audit.ts`): 571 nálezů před opravou, 0 po ní (datový test i `level-walk.spec.ts`). Skybox `tools/prague-skybox.ts` → `public/textures/sky/prague_*.jpg` (2048², 364 kB), `src/rendering/Skybox.ts` + `data/sky.json`, dev scéna `?scene=skybox`; Mikuláš je vidět ze západních oken chodby 2. patra. Odchylky od litery: příčina z-fightingu (překryv objemů viditelných kvádrů) se neřeší zvlášť v každém builderu, ale jedním krokem generátoru `OverlapResolver` (ořez viditelných kvádrů v pořadí deska → detail → zeď → suť, kolize beze změny); v builderech přibylo jen to, co byla chyba i bez z-fightingu: dotýkající se místnosti staví zeď dovnitř, uliční zeď nesahá před fasádu horních pater, sklo je o 5 mm menší než otvor; okno `w-f3-cj-1` posunuté o 1,3 m (stálo za uliční zdí). Audit hlásí odvrácené dvojice ploch jen u oboustranných materiálů. Reverse depth zapnutý na obou rendererech (zisk přesnosti jen na WebGPU), `maxZ` 150. Nízké preset 1024² nevyrábí (fáze 21 může zmenšit při načtení). Z kritiky směny 2: světla levelu změřená A/B u zdi (`tools/level-wall-light-ab.ts`) neklipují, takže se nepřelaďovala; `MaterialLibrary`, `BoxRoom` i `FlatMaterials` dělají materiály přes `MatteDefaults.material`.

## Backlog — needs a human

- Zahrát krabicovou místnost po fázi Weapon feel a zapsat zpětnou vazbu do FEEDBACK.md
- Zahrát celý level po fázi Visual pass a zapsat zpětnou vazbu do FEEDBACK.md
- Ověřit výkon na Ryzen AI notebooku (60 fps Vysoké) a na slabém notebooku (30 fps Nízké); výsledek do FEEDBACK.md
- Tauri build pro Windows a Mac (DESIGN §10 krok 8): potřebuje Rust toolchain, mimo noční smyčku
- Po fázi Deploy: pushnout `main` a v GitHub Settings → Pages nastavit zdroj „GitHub Actions“
- Projít kvízové otázky (data/quiz.json) a případně upravit; zkontrolovat, že jména učitelů jsou v pořádku k veřejnému zveřejnění
