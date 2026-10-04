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
| 7 | `26`, `25` | – | groom po směně 6 (kritika); 25 měří fps → poslední a bez paralelní zátěže, proto vše serial |

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
4. `src/ui/Hud.ts` (DOM vrstva nad canvasem z fáze 5, ne Babylon GUI — DECISIONS „Fáze 5“): zdraví, munice, aktivní zbraň (sloty 1–6), klíče, ikony power-upů s časovačem, toasty (styl LEGACY §4), zaměřovač a hitmarker z fáze 5.
5. `__game.inventory`, `__game.give(item)`, `__game.doors` (stav, `tryOpen(id)`).

**Verification**
Quick gate: `tests/e2e/doors-keys.spec.ts`, `tests/e2e/level-walk.spec.ts`. Pro každou dvojici sousedních místností existuje navmesh cesta (přidej do level-walk). Bez klíče se zamčené dveře neotevřou a zobrazí hlášku. Po sebrání klíče se otevřou. Zavřené dveře zastaví výstřel i robota. Power-upy fungují (rychlost +x % po dobu 30 s). Snímek HUD `screenshots/10-hud.png` prohlédni: čitelnost na tmavé scéně, české texty s diakritikou.

**Do not**
Kvíz (fáze 11). Ukládání (fáze 16).

**Done 2026-10-04** (handoff `handoff/phase-10.md`). `/` i `?scene=level` startují přes `LevelGameplay` (level, navmesh, hráč, pistolka, HUD se zaměřovačem, inventář, 17 dveří, 13 pickupů z level.json); dev scéna `?scene=doors` (boxroom, zamčené dveře do výklenku s robotem, klíč, power-upy). Quick gate zelený: typecheck, `npm run test:data` 81/81, Playwright 26/26 (6 smoke + 8 `doors-keys` + 12 `level-walk`). Odchylky od litery: HUD je DOM (bod 4 opraven), nové parametry HUD v `data/hud.json`, texty v `data/texts.json`, dveře v `data/doors.json`; navmesh levelu je tile cache (box překážky za zavřené dveře, upeče se za ~60 ms) s lomenými cestami místo vyhlazených a poloměrem agenta 0,3 m, kolizní desky zábradlí nejsou vstup navmeshe; dveře jsou přepínací (E i kolečko), roboti je neotevírají; dropy v `enemies.json` přejmenované na id z `pickups.json`; zbraně fáze 13 a munice do nich se v inventáři schovají, dokud zbraň neexistuje; navíc `RoomLighting` (dveře, pickupy, zbraň v ruce a roboti svítí světly své místnosti) a `?enemies=` v dev scéně levelu (osazení robotů zůstává fázi 16). Nástěnné hasičáky a hadice z `level.json → pickups` osadí fáze 13/16.

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

**Done 2026-10-04** (handoff `handoff/phase-11.md`). Dev scéna `npm run dev` → http://localhost:5173/dev/?scene=teacher (`&teacher=<id>` vybere jiného z 9 učitelů). Quick gate zelený: typecheck, `npm run test:data` 92/92 (+9 `tests/data/teachers.test.ts`), Playwright 14/14 (6 smoke vč. rozpočtu modelů + 8 `tests/e2e/quiz.spec.ts`). Fyzikář je „Voltr“, přezdívka „Ampér“. Odchylky od litery: kvízový overlay je DOM vrstva jako HUD, ne Babylon GUI (bod 4; DECISIONS „Fáze 11“); po správné odpovědi je obrazovka s hláškou a odměnou, hra pokračuje na Enter / klik; odměna, kterou hráč nemůže vzít (lékárnička při plném zdraví), leží u učitele jako pickup; damage pasti má typ `explosion` a násobič `QuizSystem.damageMultiplier` (fáze 17); jmenovka je menší než v LEGACY (1,0 × 0,31 m); učitel má statický kolizní kvádr přes židli; E na učitele má přednost před dveřmi (`DoorSystem.yieldInteract`). Navíc: `Player.animatePausedEffects` (otřes a červené okraje v pauze kvízu), texty v `data/texts.json → teachers/quiz`, zvuky `trapBlast`, `quizOpen`, `quizCorrect`, `shacklesOpen`, barvy `teacher.*` a `ui.overlay*` v paletě. Učitele do levelu osadí fáze 16 přes `TeacherSystem.levelSpecs`.

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

**Done 2026-10-03** (handoff `handoff/phase-13.md`). Dev scéna `?scene=weapons` (boxroom, 5 humanoidů, nástěnný hasičák, hydrant, kbelík balónků; data `data/weapon-range.json`). Quick gate `tests/e2e/weapons-all.spec.ts` (10 testů) zelený; snímek `screenshots/13-weapons.png` (6 viewmodelů při střelbě, 3×2). Viewmodely 200–384 tri. Odchylky od litery: kužel hasičáku i AoE balónku počítá `AreaQuery` (obálka cíle + paprsek viditelnosti) místo vějíře paprsků (`rays` zmizel); hadice místo `pushForce` krátce zpomalí; hasičák se doplní sám při příchodu ke skříňce (hydrant chce E); sbírané balónky řeší vlastní `AmmoPickup` (+ `weapons.json → ammoPickup`); výstřel balónku se hlásí až při prasknutí; base `Weapon` navíc `wantsToFire`, `refill`, `idle`, `extraState`, `params.soundInterval`; `ShotEvent.hits` pro víc cílů; `DamageTargets.attached`. HUD ukazuje u hadice „Infinity“ (Hud.ts vlastní fáze 10, viz handoff).

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

**Done 2026-10-04** (handoff `handoff/phase-15.md`). Galerie `npm run dev` → http://localhost:5173/dev/?scene=gallery (`&section=props|teachers|…` detail), snímek `screenshots/15-gallery.png` (nahrazuje smazaný `14-models.png`), ukázka rekvizit `?scene=props` (`15-props.png`). Quick gate zelený (data 98/98 včetně `tests/data/props.test.ts`, smoke 6/6). Odchylky od litery: galerie nahradila scénu `models` (rozpočtový test běží na `gallery`, `__game.models` zůstal) a `data/model-showcase.json` → `data/gallery.json`; police nad sebou místo podstavců na podlaze, herní mlha posunutá o vzdálenost kamery; balónky sjednocené na `BalloonPackModel` (`WaterBalloonPackModel` smazán); rekvizity (9 blueprintů, třídy nad `BlueprintModel`) jsou v plánových souřadnicích level.json, nekolidují a nejsou pickable (kolize, světla a napojení do levelu dělá fáze 16); stylová revize ztlumila jen glóbus a noty na pianu, terč (líc −z) otáčí galerie, model zůstal. CLAUDE.md jsem needitoval: URL `dev/?scene=gallery` v něm už platí.

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

**Done 2026-10-04** (handoff `handoff/phase-16.md`). `/` = celá hra (`LevelGameplay` s `play`): 9 učitelů v kabinetech, 22 robotů (delta 0), 6 nástěnných hasičáků a hydrant v tělocvičně u zdi (paprsek), pickupy, úvod (`ScreenOverlay`), konec levelu po otevření hlavního vchodu, checkpointy (`src/core/Checkpoint.ts`, `src/level/LevelProgress.ts`). Pořadí Progrese beze změny. Rekvizity fáze 15 (143 kusů ve 12 místnostech, `PropPlacer`) stojí v levelu, svítí je lampy jejich místnosti a mají statické kolizní kvádry, které jdou i do navmeshe (`src/level/PropColliders.ts`); trasa obchází nábytek (datový test) a katedra v kabinetu češtiny je o 0,3 m západněji. Playthrough 7/7 (ujde 424 m, 4 teleporty na 3 m, 22/22 robotů, 9 učitelů, 1 špatná odpověď, smrt → checkpoint, `?continue=1` v druhé kartě, hráč neprojde lavicí), snímek konce levelu `16-level-end.png` je ze skutečného průchodu (22 robotů, 9/1 odpovědí; čas na obrazovce se mezi běhy liší, průchod není deterministický, např. 2:28 i 2:56; od fáze 19 test snímek ukládá do `test-results/screenshots/`, verzovaný jen s `SAVE_SCREENSHOTS=1`), odhad hraní ≈ 18 min. Odchylky od litery: rekvizity jsou jen v celé hře (`play`), holý level je nemá; `?scene=level` zůstává holý level (celá hra s `?play=1`); obnovení po smrti bylo ve fázi 16 automatické po 1,5 s, od fáze 18 ho nahradila obrazovka smrti s tlačítkem „ZKUSIT ZNOVU →“ (obnoví poslední checkpoint; oprava popisu ve fázi 24); úvod hru nepozastavuje; checkpoint se po dohrání smaže. Z kritiky směny 3: HUD hadice ukazuje ∞ (playthrough to hlídá), dveře se nezavřou na robota, slot test ve `weapon.spec.ts` přepsaný, tok balónků (pickup → skrýš → zbraň → munice → hod) ověřený v playthrough.

## Phase 17 — Difficulty

**Implement**
1. `data/difficulty.json`: 5 stupňů z LEGACY §2 (id, název, podtitul, motto, portrét). Násobiče: `playerHealth` (DECISIONS #15), `incomingDamage` (= legacy `incoming`), `enemyHealth` (`health`), `enemySpeed` (`speed`), `attackPace` (`pace`), `enemyCountDelta` (`extra`), `quizWrongDamage` (= `incoming`), `pickups` (podle `foundFood`/`foundDrink`). Výchozí Záškoláček.
2. Výběr obtížnosti v menu ve stylu staré hry. SVG portréty převezmi z `legacy/index.html:3` (je to obsah, ne kód) a Schrödingerovu rovnici u Ultrašprta.
3. Propsat do hráče, nepřátel, spawnů, kvízu a pickupů.

**Verification**
Quick gate: `tests/e2e/difficulty.spec.ts`. Na Mimino vs. Ultrašprt se liší zdraví hráče, damage robota, počet spawnů a damage za špatnou odpověď přesně podle JSON. Snímek výběru obtížnosti prohlédni.

**Do not**
Měnit jména, motta ani portréty.

**Done 2026-10-04** (handoff `handoff/phase-17.md`). `/` → NOVÁ HRA → výběr obtížnosti (`DifficultyPicker`, stránka menu ve stylu staré hry, portréty a Schrödingerova rovnice doslova z `legacy/index.html:3` v `data/portraits/`) → JDEME DO ŠKOLY. Quick gate zelený: typecheck, `npm run test:data` 111/111 (+5 `tests/data/difficulty.test.ts`), Playwright 10/10 (6 smoke + 4 `tests/e2e/difficulty.spec.ts`). Mimino vs. Ultrašprt podle JSON: 180 vs. 120 životů, 19 vs. 26 robotů, humanoid skutečně zraní 2× po 5 vs. 2× po 17, past −10 vs. −33, lékárnička +70 vs. +20. Snímky `17-difficulty.png`, `17-main.png`. Odchylky od litery: násobiče `playerHealth` (1,2 … 0,8) a `pickups` (1,4 … 0,4, škáluje množství v léčivých a muničních věcech, ne jejich počet) jsou nové, ostatní z LEGACY §2 beze změny; nápověda výběru už neříká „vždy 150 životů“ a řádek ukazuje životy a počet robotů; level se staví pro jednu obtížnost, jiná volba (nebo „Pokračovat“ na checkpointu jiné obtížnosti) stránku načte znovu s `&difficulty=`, checkpoint obtížnost ukládá; `progression.json → countDelta` zmizel. `menu.spec.ts` a `playthrough.spec.ts` upravené o krok výběru, nespuštěné (shift gate).

## Phase 18 — Menu a herní tok

**Implement**
1. Hlavní menu: Nová hra (→ obtížnost), Pokračovat (checkpoint), Kvalita, Ovládání, Zdroje (výpis ASSETS.md, poděkování a odkaz na starou verzi `legacy/`), styl LEGACY §4 (Barlow Condensed a Inter lokálně, ne z CDN; pokud font není, použij systémový).
2. Pauza (Esc), smrt + restart z checkpointu, obrazovka konce levelu (fáze 16), úvodní příběh.
3. Nastavení: citlivost myši, hlasitost, invert Y. Ukládá se do localStorage.

**Verification**
Quick gate: `tests/e2e/menu.spec.ts`: menu → hra → pauza → menu → pokračovat. Snímek hlavního menu a pauzy prohlédni (diakritika, kontrast).

**Do not**
Externí CDN pro fonty a skripty.

**Done 2026-10-04** (handoff `handoff/phase-18.md`). `/` otevře hlavní menu (DOM, styl LEGACY §4: Nová hra, Pokračovat od uloženého checkpointu, Nastavení, Kvalita, Ovládání, Zdroje s tabulkou ASSETS.md a odkazem na `legacy/`), level se staví za ním a `LevelProgress` čeká na volbu (`deferStart`). Esc → pauza (Zpátky do hry, Nastavení, Ovládání, Hlavní menu) jen když obrazovku nemá kvíz ani úvod / konec / smrt; smrt → obrazovka smrti → „ZKUSIT ZNOVU →“ z checkpointu; „HRÁT ZNOVU“ na konci levelu → nová hra. Nastavení (citlivost myši, hlasitost, invert Y, kvalita) v localStorage přes `src/core/Settings.ts`, platí hned a ve všech scénách. `src/core/GameFlow.ts`, `src/ui/MenuOverlay.ts`, `MenuPages.ts`, `MenuConfig.ts`, `AssetCredits.ts`, `data/menu.json`, dev scéna `?scene=menu`. `tests/e2e/menu.spec.ts` 6/6, `tests/data/menu.test.ts`. Odchylky od litery: písma se nepřibalují (jen jménem se systémovou zálohou, DECISIONS „Fáze 18“); Kvalita jen ukládá volbu, presety zapne fáze 21; „Nová hra“ po odehraném běhu načte stránku znovu s `?new=1`; výběr obtížnosti je háček `GameFlow.setNewGameStep` pro fázi 17; `playthrough.spec.ts` upravený (start přes menu, potvrzení obrazovky smrti), ale nespuštěný (shift gate).

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

**Done 2026-10-04** (handoff `handoff/phase-19.md`). Detaily generuje `src/level/DetailGenerator.ts` z `data/details.json` a `level.json → seed` přímo do kusů greyboxu (suť a trámy u závalů, díry a visící kusy stropu, drobná suť u zdí, rozbité lavice, kabely, spáleniny, skvrny, graffiti, cedulky s čísly učeben, vyražená okna se střepy; nekolidují, nejdou zasáhnout, počítají se do rozpočtu i auditu z-fightingu). Procedurální textury `src/rendering/DecalTextures.ts` (canvas). Živá atmosféra `src/level/LevelAtmosphere.ts` (`data/atmosphere.json`): `LightAnimator` (zářivky na poškozeném obvodu, oheň, nouzová světla), `FireEffects` (plameny, kouř, jiskry, praskání), `DamageSparks` (poškození roboti, vypadávající zářivky), `src/rendering/PointShadows.ts` (≤ 2 světla v místnosti hráče, `rendering.json → shadows`), `src/rendering/NightEnvironment.ts`, `LooseDebris` (10 Havok těles, jen celá hra). Quick gate zelený (data 118/118, smoke + level-walk + nový `tests/e2e/visuals.spec.ts`). Snímky `19-chodba.png`, `19-kabinet.png`, `19-telocvicna.png`, `19-main.png`. Odchylky od litery: mlha zůstala lineární (fáze 5, „světlo u zdi“), ne exponenciální; tma = světla level × 0,86 a ambient v levelu × 0,55; zvuk ohně je opakovaný vzorek tlumený vzdáleností (pravý prostorový zvuk může dodat fáze 20); stíny jsou vždy zapnuté, preset je vypne až ve fázi 21; procedurální prostředí je hlavně v odlescích skla (hra nemá PBR materiály). Výkon (doplněno ve fázi 24): po fázi 19 klesla celá hra ve startovní učebně 30 na ≈ 37–38 fps (headless, 1080p, vše zapnuto, stíny vždy); příčinou nebyly detaily ani stíny (~1 % snímku), ale paprsky vidění robotů přes všechny meshe a draw cally za zdmi; fáze 21 to opravila na 60 fps Vysoké a 38,5 fps Nízké + CPU 4× (PERF.md 2026-10-04). Z kritiky směny 4: testy ukládají snímky do `test-results/` (`SAVE_SCREENSHOTS=1` pro verzované), písma přibalená z `@fontsource/*` (+ `vite.config.ts → server.fs.allow` pro symlinkované `node_modules`), `handoff/phase-16.md` přepsaný, popisky galerie se nepřekrývají.

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

**Done 2026-10-04** (handoff `handoff/phase-20.md`). `src/audio/AudioService.ts` (jeden na hru) spojuje mix a jednorázové zvuky (`SynthSounds`: sběrnice efekty / hudba pod hlavní hlasitostí, `playAt` = PannerNode), prostorové smyčky přes Babylon AudioV2 (`SpatialAudio`: hučení 6 ohňů, bzučení dronů, servomotory robotů podle rychlosti; posluchač na aktivní kameře, nejvýš 10 nejhlasitějších), útlum za zavřenými dveřmi a o patro jinde (`DoorOcclusion`), hudbu (`MusicPlayer`, vlastní chiptune sekvencer, smyčka 7,3 s, tišší v kvízu, menu/pauze i při stojící hře), kroky podle `floorMaterial` místnosti (`Footsteps`) a UI pípání tlačítek; data `data/audio.json`, 17 nových receptů v `sounds.json` (smyčky `loop: true` s plochou obálkou a tremolem). Nastavení má posuvníky Hudba a Efekty. Dev scéna `?scene=audio`. Quick gate zelený: typecheck, data 124/124 (+6 `tests/data/audio.test.ts`), Playwright 13/13 (6 smoke + 7 `tests/e2e/audio.spec.ts`). Odchylky od litery: prostorové jednorázové zvuky (výstřely robotů, jiskry, dopady suti, praskání ohně) jsou Web Audio `PannerNode` na posluchači AudioV2, ne AudioV2 zvuky (AudioV2 má pozici per zvuk a vytváří asynchronně); útlum jen za dveřmi a mezi patry, zdi se netrasují; humanoid hlásí nápřah a výstřel novou událostí `Enemy.onAttack`, zvuky čtyřnožce a dronu hrají prostorově ze stejných dat; `Drone.buzzCount` počítá chvíle na doslech, zvuk je smyčka AudioService; testy nezapisují snímky.

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

**Done 2026-10-04** (handoff `handoff/phase-21.md`). `data/quality.json` (Nízké / Střední / Vysoké: render scale, MSAA, části pipeline, vzorky SSAO, mlha, stíny, částice ohně, skybox, culling), `src/rendering/QualityManager.ts` (jeden na hru, jen hlavní stránka; sleduje `Settings.quality`, aplikuje i na později postavené pipeline), `QualityDetector.ts` (start podle `engine.getInfo()`, pak fps 3 s běžící hry nahoru/dolů), `__game.quality` (`preset`, `set`, `autodetected` + `choice`, `detection`, `applied`, `stats`), stránka Kvalita ukazuje „· teď STŘEDNÍ“, dev scéna `?scene=quality&preset=`. Výkon (profil CDP): `LineOfSight` hledá v uložených boxech + `TriangleGrid` místo `scene.pickWithRay` (stejné odpovědi, `__game.enemies.sightCheck` 20 000 paprsků 0 rozdílů), `RoomCulling` nekreslí obsah vzdálených místností, `skipPointerMovePicking`. `tests/e2e/perf.spec.ts` (1920×1080, start v učebně 30 = nejnáročnější z 11 místností): načtení 2,0 s, autodetekce Střední → Vysoké, Vysoké 60 fps (předtím 37), Nízké + CPU 4× 38,5 fps (předtím 8); `PERF.md`. Z kritiky směny 5: odkaz Zdroje přes `import.meta.env.BASE_URL` (`menu.spec` kontroluje cestu). Odchylky od litery: stíny bodových světel jen Vysoké (DECISIONS #11), Nízké ani Střední je nemá, i když plán u Nízké píše „stíny jen od 1 světla“; render scale Nízké 0,6 (DECISIONS #12 uvádí 0,5); CSM pro okenní světlo není (#11 „pokud vůbec“); zvuk se nethrottluje (pod 0,5 % snímku); merge statiky, `freezeActiveMeshes`, pooling a code-splitting se nedělaly, cíle splnil profil + culling; skybox 1024² je předgenerovaná kopie (`tools/prague-skybox.json → variants`), ne zmenšení za běhu.

## Phase 23 — Deploy na GitHub Pages

**Implement**
1. `.github/workflows/pages.yml`: na push do `main` spustí `npm ci && npm run build`, zkopíruje `legacy/` do `dist/legacy/` (stará hra dál funguje na `/legacy/`) a nasadí přes `actions/deploy-pages`. Dev scény se do produkce nenasazují, nebo jen pod `/dev/` (rozhodni a zapiš).
2. Vite `base: "./"` musí fungovat i pod `/<repo>/`. Havok WASM a recast musí jít načíst z podcesty.
Paralelní fáze směny 5: jen `.github/workflows/` a případně `vite.config.ts` (`base`). Kopírování `legacy/` je krok ve workflow, ne ve Vite.

**Verification**
Quick gate: výchozí. Lokálně `npm run build && npx vite preview`, plus jednorázová ruční kontrola pod podcestou (`--base /Posledni_zvoneni/`, s `legacy/` zkopírovanou do `dist/`): hra nastartuje a `/legacy/` se načte. Nový test nepřidávej. **Nepushuj.** Do Backlogu přidej položku pro člověka „pushnout a v Settings → Pages přepnout zdroj na GitHub Actions“.

**Do not**
Push. Úpravy Settings repozitáře.

**Done 2026-10-04** (handoff `handoff/phase-23.md`). `.github/workflows/pages.yml`: push do `main` nebo ruční spuštění → `npm ci`, `npm run build -- --base "<Pages base_path>/"`, webové soubory `legacy/` do `dist/legacy/`, `.nojekyll`, `upload-pages-artifact` + `deploy-pages`. Ověřeno lokálně stejnými kroky a `vite preview --base /Posledni_zvoneni/` na :5303: build bez varování, hra nastartuje (webgpu, Havok WASM a recast z `/Posledni_zvoneni/assets/`, navmesh 474 trojúhelníků, skybox, 46 textur), Zdroje vypisují 26 řádků ASSETS.md a odkaz vede na `/Posledni_zvoneni/legacy/index.html`, kde stará hra běží, výběr obtížnosti ukazuje 5 portrétů + rovnici, Ultrašprt načte stránku znovu pod podcestou (`?new=1&difficulty=ultra` → `/Posledni_zvoneni/`, 120 životů), `/dev/?scene=skybox` bez chyb; žádná chyba v konzoli ani 404. Odchylky od litery: CI staví s absolutní base místo `./` (`./` hru pod podcestou zvládne, ověřeno, ale dev scény pod `/dev/` by nenašly textury); `vite.config.ts` beze změny; dev scény se nasazují pod `/dev/`; do `dist/legacy/` jdou jen soubory pro prohlížeč. Nepushnuto.

## Phase 24 — DoD audit

**Implement**
Projdi DESIGN §15 bod po bodu (s úpravami z DECISIONS) a ke každému napiš do `PLAN.md` → `## DoD audit` důkaz (test, snímek, číslo z PERF.md) nebo opravu. Doplň `ASSETS.md` a `DECISIONS.md`. Zkontroluj, že kód splňuje pravidla z CLAUDE.md (žádná herní data v kódu: grep na čísla v `src/`, jedna třída na soubor) a oprav nálezy. Plnou sadu spustí shift gate; sám spusť jen testy, kterých se tvoje opravy týkají.

**Verification**
Quick gate: `tests/e2e/perf.spec.ts`, `tests/e2e/playthrough.spec.ts`. Všechny body DoD mají důkaz. Snímky finálního stavu (`screenshots/24-*.png`) prohlédni.

**Do not**
Prohlásit hotovo, dokud některý bod DoD nemá důkaz.

**Done 2026-10-04** (handoff `handoff/phase-24.md`). Sekce `## DoD audit` níže: všech 7 bodů DESIGN §15 (rozepsaných na 17 řádků) má důkaz; strojově neověřitelné části (skutečná doba hraní, fps na Ryzen AI a slabém notebooku, poslech, push + Pages) jsou v Backlogu. Quick gate zelený: typecheck, data 128/128, Playwright 17/17 (6 smoke + 4 `perf` + 7 `playthrough`), navíc `audio.spec` + `visuals.spec` 11/11 kvůli změnám fáze; `npm run build` bez varování. fps (PERF.md): Vysoké 60,0, Nízké + CPU 4× 40,1, načtení 1,8 s. Opravy: magická čísla v `DetailGenerator` → `data/details.json` (výstup generátoru beze změny), pojmenované konstanty v `DecalTextures`, `FireEffects`, `LightAnimator` a dalších 9 souborech, barva focusu výběru obtížnosti do palety; test kroků na dlažbě, parketách a kameni (`audio.spec`); židle v tělocvičně na dostřel hadice + test „hadice hýbe troskou“ (`visuals.spec`); řádky knihoven v ASSETS.md; Done bloky fází 16 a 19 a handoff fáze 23 opravené; lock ověřený proti registru npm. Snímky `screenshots/24-menu.png`, `24-game.png`, `24-gym-hose.png`. Odchylky od litery: proporce kreslení decalů a barevné podíly ohně jsou pojmenované konstanty v kódu, ne JSON (DECISIONS „Fáze 24“); `public/textures/mp/window-prague.png` se od fáze F1 nepoužívá, ale zůstal (je v ASSETS.md a v index.json, smazání by měnilo výstup nástroje fáze 7).

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

## Phase 26 — Stabilní průchod, cache LineOfSight a trvalé důkazy

Zdroj: kritika směny 6 (groom 2026-10-04). Běží ve směně 7 před fází 25 (25 měří fps až na výsledném kódu).

**Implement**
1. **Flaky průchod 3. patra:** ve fázi 24 jednou spadl `tests/e2e/playthrough.spec.ts` → test „floor 3: red door…“ hláškou `stuck before route[33] … (robots within 3 m: e06, e15)`; při opakování a v shift gate prošel. `route[33]` je pata schodiště `stair-mid-34` ve 3. patře (x 34,33, z 19,45, y 5) hned před dveřmi `d-f3-stair-mid` do `f3-corridor`, kde hlídkuje humanoid `e06` (`level.json`: x 36–50, z 20,85). `e15` je čtyřnožec v `f2-corridor` o patro níž na stejném x/z: diagnostika ve `walkRoute` počítá `flat()` vzdálenost bez ohledu na patro, takže hlásí i roboty z jiného patra. Oprav v `walkRoute` (řádky ~270–285):
   - diagnostika „robots within 3 m“ jen pro roboty na stejném patře (`enemyFloor` jako v `threats()`), včetně příznaku `skipped`;
   - když se chůze zasekne a v okruhu `ROOM_RANGE` na stejném patře stojí živý robot, vyřaď ho ze `skipped`, zabij ho (`approach` + `kill`) a waypoint zkus znovu (jednou, zalogovat jako `cleared <id> at route[i]`, ne jako selhání). Robot ze `skipped` (bez výhledu, bez celé cesty) dnes může fyzicky stát ve dveřích a `fight()` ho už neřeší.
   - Zjisti ze stavu při zaseknutí (zalogovat `room`, `seesPlayer`, `skipped` robotů na patře), proč `e06` nebyl v `threats()` (room/seesPlayer na prahu schodiště?), a příčinu zapiš do handoffu. Oprav test, ne hru, pokud hra dělá, co má.
2. **Past v cache `LineOfSight`** (`src/enemies/ai/LineOfSight.ts`, flag handoffu fáze 21): seznam blokujících meshů se staví jen při `dirty`, které nastaví jen `onNewMeshAdded/onMeshRemoved`. Mesh, který se po přidání stane pickable (nebo přestane/začne být `DamageTargets`, nebo se mu odmrazí world matrix), zůstane do další změny sady meshů neviditelný. Dnes to nic nedělá, ale chyba je tichá. Oprav levně: např. v `refresh()` každých N kroků (pojmenovaná konstanta) porovnej podpis sady (počet pickable meshů s `renderingGroupId 0` mimo DamageTargets + počet zmražených) a při změně nastav `dirty`; nebo veřejné `invalidate()` + volání tam, kde se pickable mění. Zvol jednodušší robustní variantu a zapiš ji do DECISIONS.md.
   - Regresní test: `tests/data/line-of-sight.test.ts` s `NullEngine` (mesh přidaný jako non-pickable, pak `isPickable = true`, po `beginStep` ho `firstHit` vidí), nebo, pokud NullEngine v Node nejde, additivní hook v `__game.enemies` a test v `enemies-all.spec.ts`.
3. **Odkaz na starou verzi z dev scény:** oprava fáze 21 (`src/ui/MenuPages.ts:199`, `import.meta.env.BASE_URL`) je ověřená jen na `/` (`tests/e2e/menu.spec.ts:90–92`), chyba ale byla na `/dev/?scene=menu` (handoff fáze 23: odkaz vedl na `dev/legacy/index.html`, 404). Přidej do `menu.spec.ts` krátký test: `/dev/?scene=menu` → ZDROJE → `new URL(href).pathname` = `/${menu.json → legacyUrl}`.
4. **Trvalý důkaz DoD 2a:** řádek 2a v `## DoD audit` cituje `test-results/screenshots/16-level-end.png`, které je v `.gitignore` (DECISIONS „Testy ukládají snímky do test-results…“), takže důkaz po úklidu zmizí. Při jednom běhu quick gate pusť playthrough se `SAVE_SCREENSHOTS=1` (`tests/support/ShotPath.ts`), prohlédni `screenshots/16-level-end.png` a commitni ho; v řádku 2a cituj `screenshots/16-level-end.png` a asserty testu „main entrance with the blue key ends the level“.

**Verification**
Quick gate: `tests/e2e/playthrough.spec.ts`, `tests/e2e/menu.spec.ts`, `tests/e2e/enemies-all.spec.ts`. Nový datový test LOS projde v `npm run test:data`. Quick gate běží u implementace, review i merge (3× průchod); v handoffu log `walkRoute` všech běhů s případnými `cleared`, žádné další běhy navíc. Snímek `screenshots/16-level-end.png` prohlédnutý.

**Do not**
Zvyšovat timeouty nebo počet opakování (`retries`) místo opravy. Měnit AI robotů nebo `level.json` kvůli testu. Měřit fps (to dělá fáze 25). Měnit veřejné API `LineOfSight` jinak než přidáním. Spouštět plnou sadu.

**Done 2026-10-04** (handoff `handoff/phase-26.md`). Quick gate zelený: typecheck 0, data 131/131 (nový `tests/data/line-of-sight.test.ts` 3/3), Playwright 27/27 (6 smoke + 7 `enemies-all` + 7 `menu` + 7 `playthrough`); všech 16 `walkRoute` čisté (žádné `retried`, `cleared` ani `stuck`), 424 m, 4 teleporty, 22/22 robotů. `walkRoute`: diagnostika „stuck“ jen pro roboty na stejném patře s `room`, `seesPlayer`, `skipped` a stavem AI; při zaseknutí `clearBlockers` vyřadí živé roboty patra v `ROOM_RANGE` ze `skipped`, zabije je a waypoint zkusí jednou znovu z předchozího (`cleared <id> at route[i]`); každý `walk()` vypíše svůj log. `LineOfSight`: kontrola podpisu sady kandidátů každých 30 kroků (`SIGNATURE_CHECK_STEPS`), DECISIONS „Fáze 26“; datový test s `NullEngine` padá bez opravy (2 ze 3 případů) a s ní projde. `menu.spec`: `/dev/?scene=menu` → ZDROJE → `/legacy/index.html`. Řádek 2a DoD cituje verzovaný `screenshots/16-level-end.png` (prohlédnutý) a asserty konce. Odchylky od litery: příčina zaseknutí `e06` z fáze 24 se v tomto běhu nezopakovala, takže v handoffu je odvozená z dat (otvor `d-f3-stair-mid` bez křídla, mezera 15 cm mezi obdélníky místností → `room` = null), ne naměřená; při dalším výskytu ji zachytí nový log. Datový test „robot dostane vlastníka“ hlídá kontrolu za paprsek (`blocks()`), ne cache.

## Phase 25 — Perf test s rezervou pod vsync a poctivé PERF.md

Zdroj: kritika směny 6 (groom 2026-10-04). Běží ve směně 7 **sama a poslední** (měří fps; viz fáze 21).

**Implement**
1. **Rezerva pod vsync stropem:** `tests/e2e/perf.spec.ts` má `HIGH_MIN_FPS = 57` a Vysoké měří přes `requestAnimationFrame`, které je zastropované na 60 Hz (fáze 21 i 24 naměřily 60,0). Test tak nepozná regresi, která nespadne pod strop; `stats().frameTimeMs` (`Game.frameTimeMs`) je čas mezi snímky, tedy taky 16,6 ms. Přidej metriku, kterou vsync neomezuje: průměrný CPU čas snímku (`SceneInstrumentation.frameTimeCounter` / `renderTimeCounter`, případně `EngineInstrumentation.gpuFrameTimeCounter`, pokud na WebGPU v headless něco vrací) do `__game.quality.stats()` (jen přidat pole) a do `test-results/perf.json`. Nejdřív změř skutečné hodnoty (Vysoké i Nízké + CPU 4×), pak v testu assertuj CPU čas snímku na Vysoké ≤ pojmenovaná mez s rozumnou rezervou pod 16,7 ms (mez podle naměřených čísel, zdůvodnění do DECISIONS). Assert `fps ≥ 57` nech jako kontrolu stropu. Alternativa, pokud ji headless Chromium respektuje: odemknout rAF (`--disable-frame-rate-limit --disable-gpu-vsync` jen pro perf.spec) a měřit skutečné fps; zvol jednu cestu, zapiš ji.
2. **Autodetekce dolů v e2e:** DoD řádek 1d tvrdí „oba presety“, ale krok dolů (< `downFps` 30) ověřuje jen `tests/data/quality.test.ts`. Přidej do `perf.spec` test: CPU throttling přes CDP tak silný, aby Střední spadlo pod 30 fps s rezervou (změř, např. 8×), `__game.quality.set("auto")` restartuje detekci (`QualityManager` ř. ~148–153), čekej `detection().done` → první měření < `downFps` a `preset === "low"`, `autodetected === "low"`; throttling pak vrať na 1.
3. **Draw cally:** PERF.md má Vysoké 1042 (fáze 21) vs 880 (fáze 24) při stejném počtu aktivních meshů 848 a bez změny renderu. `stats().drawCalls` je `drawCallsCounter.current` jednoho snímku. Zjisti příčinu (stínové mapy lamp s `refreshRate` > 1, SSAO/depth průchody, roboti vcházející do nevyřazených místností — porovnej `activeByKind`), ber v testu min/průměr/max přes měřené okno (`drawCallsCounter` má `min/max/average` nebo vzorkuj) a do perf.json zapiš rozsah.
4. **PERF.md poctivě:** v hlavičce tabulky fáze 21 „Vysoké (vše zapnuto, stíny 2 světel)“ — naměřeno bylo 1 stínové světlo (`handoff/phase-21.md`: „1 shadow light“; `quality.json → high.shadows.maxLights` 2 je strop, ne počet). Oprav na „stíny až 2 světel, v učebně 30 aktivní 1“. Přidej sekci „fáze 25“ s novými čísly (fps, CPU čas snímku, rozsah draw callů, autodetekce dolů) a vysvětlením rozdílu 1042/880.
5. `## DoD audit` v PLAN.md: řádky 1b (rezerva pod stropem), 1c a 1d (autodetekce nahoru i dolů v e2e) aktualizuj na nová čísla a testy.

**Verification**
Quick gate: `tests/e2e/perf.spec.ts`. Projde 2× za sebou (čísla obou běhů do handoffu, rozptyl CPU času snímku a draw callů). Nové pole v `stats()` je jen přidané (kontrakt `window.__game`).

**Do not**
Snižovat meze (`LOW_THROTTLED_MIN_FPS` 30, `HIGH_MIN_FPS`) ani měnit presety v `data/quality.json`, aby test prošel. Optimalizovat render (merge statiky, `freezeActiveMeshes`, pooling — DECISIONS „Fáze 21“: cíle splněné). Videa, snímky navíc, plnou sadu.

## DoD audit

Fáze 24, 2026-10-04, main @ 5c8c4ca + větev fáze 24. DESIGN §15 bod po bodu s úpravami z DECISIONS. „Shift gate 5“ = `npm run test:full` na main @ d05ca2a (build bez varování, data 124/124, Playwright 112/112). „Quick gate 24“ = běh této fáze: typecheck 0, data 128/128, Playwright 17/17 (6 smoke + 4 `perf` + 7 `playthrough`), navíc `audio.spec` + `visuals.spec` 11/11 kvůli změnám fáze. Co stroj ověřit nemůže, je v Backlogu (konec tabulky).

| # | Bod DoD (DESIGN §15) | Úprava (DECISIONS) | Důkaz | Stav |
| --- | --- | --- | --- | --- |
| 1a | `npm run dev` a `npm run build` bez chyb a varování | #18 (`chunkSizeWarningLimit` 4 MB) | `npm run build` ve fázi 24: exit 0, v 249 řádcích výstupu žádné `warn`/`error`/`(!)`; dist má 37 woff2 písem a `HavokPhysics.wasm`. Dev: `tests/smoke/boot.spec.ts` + `ConsoleGuard` (selže i na `console.warn`) na `/`, každý e2e soubor má guard; snímky fáze 24 na vlastním dev serveru: 0 chyb a varování v konzoli. | splněno |
| 1b | 60 fps v 1080p na Vysoké | #7, #12: měří se na M1 Pro (headless Chromium, WebGPU/Metal) | `tests/e2e/perf.spec.ts` (1920×1080, start v učebně 30 = nejnáročnější z 11 místností): fáze 24 **60,0 fps**, 880 draw callů, 848 aktivních meshů, všechny části pipeline zapnuté a stíny lamp (assert v testu); PERF.md 2026-10-04 (fáze 21 i 24). Ryzen AI = Backlog. | splněno na měřicím stroji |
| 1c | 30 fps na Nízké na běžném notebooku | #12: Nízké + CPU throttling 4× přes CDP | `perf.spec`: fáze 24 **40,1 fps** (fáze 21 38,5), 643 draw callů, render scale 0,6, bez SSAO, bloomu a stínů (assert). Skutečný slabý notebook = Backlog. | splněno v simulaci |
| 1d | Automatická volba presetu funguje (oba presety v headless s GPU) | fáze 21: start Střední, 3 s měření | `perf.spec` test 1: adapter `apple metal-3` → Střední 57,3 fps → **Vysoké** 60 fps → zůstává, `autodetected` = preset, stránka Kvalita hlásí „teď VYSOKÉ“; načtení do hratelného stavu **1,8 s** (limit 5 s). | splněno |
| 2a | Level jde dohrát od startu po hlavní vchod | – | `tests/e2e/playthrough.spec.ts` 7/7 (quick gate 24 i 26): ušel 424 m skutečnou chůzí (4 teleporty, celkem 3 m), 22/22 robotů, 9 učitelů, 1 špatná odpověď, smrt → checkpoint, `?continue=1` v druhé kartě. Obrazovka konce: verzovaný snímek `screenshots/16-level-end.png` (fáze 26, `SAVE_SCREENSHOTS=1`: čas 2:28, zničení roboti 22, správně 9, špatně 1, učitelé 9 z 9, návraty 1, obtížnost Záškoláček) a asserty testu „main entrance with the blue key ends the level“: `progress.ended`, hra pozastavená, `end.view` viditelná s titulkem z `texts.json → levelEnd.title`, řádky `right` = 9, `wrong` = 1, `kills` = `stats.kills` > 0, `teachers` = „9 z 9“, `deaths` = 1, `difficulty`, `time` ve formátu m:ss, uložený checkpoint smazaný. | splněno |
| 2b | … za 15–25 min | – | Odhad fáze 16 ≈ 18 min (424 m / chůze + souboje + 9 kvízů, výpočet v `handoff/phase-16.md`); trasa 414 m v datech (`tests/data/level.test.ts`: 300–500 m). Skutečný čas hraní člověkem nikdo nezměřil. | odhad, ověří člověk (Backlog) |
| 2c | Všechny 3 klíče a odpovídající dveře fungují | #24 (červené, žluté, modré = `exit`) | `playthrough.spec` (červený klíč → červené dveře, žlutý → žluté, modrý → hlavní vchod); `doors-keys.spec.ts` 8 testů (bez klíče hláška a zavřeno, s klíčem otevřeno, zavřené dveře zastaví výstřel i robota). | splněno |
| 3a | 6 zbraní s vlastním modelem, zvukem a efektem | – | `weapons-all.spec.ts` (10 testů: damage/zpomalení/stun/AoE podle JSON), `weapon.spec.ts`, rozpočet modelů `tests/smoke/model-budget.spec.ts` (viewmodely 200–400 tri ≤ 1k), snímek `screenshots/13-weapons.png`; zvuky výstřelu všech šesti v `audio.spec` (`KEY_SOUNDS`); průchod získá všech šest zbraní (hasičák, paralyzér a railgun od učitelů, balónky na chodbě, hadice u hydrantu s HUD ∞) a hází balónky. | splněno |
| 3b | 3 typy nepřátel s funkční AI a navigací | – | `enemies-all.spec.ts` (humanoid, čtyřnožec, dron: najdou hráče po výstřelu, zaútočí a zraní podle JSON, slow/stun, pistolka zabije 7/5/3 zásahy), `humanoid.spec.ts` (navmesh kolem sloupu, Chase do 5 s), navmesh levelu v `level-walk.spec.ts` (cesta mezi všemi sousedními místnostmi). | splněno |
| 3c | 6 učitelů s kvízem a odměnou | #1: 9 učitelů (8 z LEGACY + fyzikář) | `quiz.spec.ts` 8 testů (pauza, špatná odpověď = damage z JSON a další otázka, správná = odměna, učitel vstane), `playthrough.spec` osvobodí všech 9 a odměny dorazí do inventáře/zbraní; `tests/data/quiz.test.ts` (72 otázek, 7–9 na předmět). | splněno (9 ≥ 6) |
| 4a | Žádný viditelný prvek není netexturovaná primitiva bez světla | – | `visuals.spec.ts`: `__game.visuals.unlit()` = [] v celé hře (každý viditelný mesh světa dosáhne bodové světlo jeho místnosti); materiály detailů jsou texturované (`tests/data/details.test.ts`), fallback textura `MaterialLibrary` místo holé barvy; snímky `24-game.png`, `24-gym-hose.png`, `19-*.png`. | splněno |
| 4b | Pipeline aktivní (mlha, bloom, SSAO, grain) | #11, fáze 5: mlha lineární, ne EXP2 | `perf.spec` Vysoké: všechny části `quality.json → high.pipeline` zapnuté (assert); smoke `core.spec.ts` přepíná tone mapping, bloom, grain, chromatickou aberaci, vignette i mlhu bez varování; Nízké vypíná SSAO a bloom záměrně (DESIGN §8 presety). | splněno |
| 5 | HUD, hlavní menu, smrt a restart, obrazovka konce levelu, uložení pozice | #8: checkpoint po každém klíči + „Pokračovat“ | `menu.spec.ts` 6 testů (menu → hra → pauza → menu → Pokračovat; smrt → obrazovka smrti → „ZKUSIT ZNOVU →“ z checkpointu; po reloadu Pokračovat), `doors-keys.spec` (HUD), `playthrough.spec` (checkpointy, konec levelu); snímky `24-menu.png`, `24-game.png` (HUD: klíče, zdraví, 6 slotů, munice). | splněno |
| 6a | `ASSETS.md` kompletní | – | Řádek pro každý soubor v `public/` (14 Matterport, 5 + raw Poly Haven, 12 skybox, index), portréty, písma OFL; fáze 24 doplnila knihovny přibalené do buildu (Babylon.js Apache-2.0, Havok MIT, recast-navigation MIT, Yuka MIT). `menu.spec` hlídá, že Zdroje vypíší každý řádek. | splněno |
| 6b | `DECISIONS.md` kompletní | – | Sekci mají „Před startem“ (20 rozhodnutí) a fáze 1–5, 7–11, 13–21, 23, F1 a 24; fáze 12 (kvízové otázky) žádnou odchylku neměla. Odchylky od litery plánu jsou i v Done blocích. Fáze 24 přidala svá rozhodnutí na konec. | splněno |
| 6c | Credity CC-BY autorů v menu | #7: obrazovka „Zdroje“ s výpisem ASSETS.md (CC-BY zdroje nejsou) | Menu → ZDROJE (tabulka ASSETS.md + odkaz na starou verzi `legacy/`), `menu.spec` (počet a názvy řádků, odkaz přes `BASE_URL`). | splněno |
| 7 | Výběr obtížnosti ve stylu Doom (4–5 stupňů ze staré verze) ovlivňuje zdraví hráče, damage nepřátel, jejich počet a damage za špatnou odpověď | #15 (zdraví 150 × násobič) | `difficulty.spec.ts` 4 testy: 5 stupňů z JSON s portréty a mottem; Mimino vs. Ultrašprt 180 vs. 120 životů, 19 vs. 26 robotů, humanoid 2× 5 vs. 2× 17, past −10 vs. −33 přesně podle JSON; snímek `17-difficulty.png`. | splněno |

**Kód proti pravidlům CLAUDE.md (fáze 24).**
- Jedna třída na soubor: 231 souborů `src/`, žádný nemá víc než jednu třídu (grep na `class` na začátku řádku).
- Herní data v kódu: sken číselných literálů v `src/` mimo komentáře, řetězce a pojmenované konstanty našel 299 výskytů. Opraveno: `DetailGenerator` (66 rozměrů a rozptylů → `data/details.json`, výstup generátoru beze změny, sha1 `LevelBuilder.collect` stejný před i po), `DecalTextures` (45 proporcí kreslení → pojmenované konstanty), `FireEffects`, `LightAnimator`, `NightEnvironment`, `EnemyProjectiles`, `Humanoid`, `LineOfSight`, `ElectricArc`, `Extinguisher`, `GeometryAudit`, `MaterialLibrary` (pojmenované konstanty), barva focusu výběru obtížnosti `#ffe5b5` → `palette.json → ui.difficultyFocus`. Zbývá 166 výskytů v `*Config.ts` (meze validace schémat, ne herní data) a matematika (indexy trojúhelníků, smoothstep, přesnost `toFixed`). Názvy modelů v galerii (`title` v `src/**/models/`) zůstávají u modelových tříd (popisky dev galerie, DECISIONS „Fáze 24“).
- Lock: `package-lock.json` odpovídá `package.json` (kořenové závislosti shodné, 154 záznamů nainstalovaných ve verzi z locku, `npm ls --all` exit 0); dva záznamy `@fontsource/*` 5.3.0 z fáze 19 mají stejný `integrity` a URL jako registr npm (`npm view … dist.integrity`). První skutečný `npm ci` proběhne v GitHub Actions po pushi (Backlog).

**Neověřená nebo jen částečně ověřená tvrzení z dřívějších fází (kritika směny 5).**
- Kroky na dlažbě, parketách a kameni (fáze 20): **ověřeno** ve fázi 24, `audio.spec` projde pro každý zvuk kroku největší místnost s tou podlahou (f4-corridor → `stepTile`, f2-gym → `stepWood`, f3-stair-mid → `stepStone`, učebna → `stepLino`) a čeká skutečný krok s tím zvukem. Že zní dobře, posoudí člověk.
- Hadice a volné trosky (19.7): v tělocvičně žádná troska na dostřel hadice nebyla (jediný kus 14 m od hydrantu, dostřel 12 m). Fáze 24 přidala židli 3–4 m od hydrantu (`details.json → loose.items`, mimo trasu podle datového testu) a test ve `visuals.spec`: hráč vezme hadici u hydrantu, stříká na židli → zásahy > 0, posun > 0,2 m (sonda: 6 zásahů, 2,9 m). **Ověřeno.**
- Pokles fps po fázi 19 doplněn do Done bloku fáze 19 (≈ 37–38 fps → fáze 21 60 / 38,5; fáze 24 60 / 40,1).
- Done blok fáze 16 opraven (obrazovka smrti od fáze 18), handoff fáze 23 opraven (písma jsou přibalená od fáze 19).

**Potřebuje člověka** (Backlog níže): skutečná doba hraní 15–25 min, fps na Ryzen AI a slabém notebooku, poslech zvuků, push + GitHub Pages (první `npm ci` a nasazení), kontrola kvízu a jmen.

## Backlog — needs a human

- Zahrát krabicovou místnost po fázi Weapon feel a zapsat zpětnou vazbu do FEEDBACK.md
- Zahrát celý level po fázi Visual pass a zapsat zpětnou vazbu do FEEDBACK.md
- Ověřit výkon na Ryzen AI notebooku (60 fps Vysoké) a na slabém notebooku (30 fps Nízké); výsledek do FEEDBACK.md
- Tauri build pro Windows a Mac (DESIGN §10 krok 8): potřebuje Rust toolchain, mimo noční smyčku
- Po fázi Deploy (fáze 23 hotová): pushnout `main` a v GitHub Settings → Pages přepnout zdroj na „GitHub Actions“; pak v záložce Actions zkontrolovat běh „Deploy na GitHub Pages“ a otevřít https://rohlik42.github.io/Posledni_zvoneni/ (hra, Zdroje → stará verze na `/legacy/`, galerie na `/dev/?scene=gallery`)
- Projít kvízové otázky (data/quiz.json) a případně upravit; zkontrolovat, že jména učitelů jsou v pořádku k veřejnému zveřejnění
- (DoD audit, fáze 24) Dohrát celou hru od hlavního menu po obrazovku konce na skutečném počítači s myší a zapsat čas do FEEDBACK.md: DoD chce 15–25 min a stroj má jen odhad ≈ 18 min (skriptovaný průchod trvá 151 s simulovaného času: chodí bez zaváhání, míří přesně a kvíz odpoví hned)
- (DoD audit, fáze 24) Poslechnout zvuky ve hře (kroky na dlažbě, parketách a schodech, oheň, roboti, hudba): testy ověří jen, že správný zvuk hraje, ne že zní dobře
- (DoD audit, fáze 24) Po pushi: první běh `npm ci` v GitHub Actions je první skutečná zkouška `package-lock.json` (lokálně ověřený proti registru npm); když Actions spadne na locku, stačí jednou lokálně `npm install` a commitnout lock
- (Groom 2026-10-04, kritika směny 6 — mimo nové fáze 25/26) Render scale Nízké 0,6 vs DECISIONS #12 0,5: šum, rozhodnuto v DECISIONS „Fáze 21“ (Nízké = render scale 0,6 …), #12 je starší
- (Groom 2026-10-04) `public/textures/mp/window-prague.png` nepoužitý od F1, ale v `textures/index.json` a ASSETS.md: zdokumentované rozhodnutí (DECISIONS „Skybox…“ F1: zůstává ve výstupu fáze 7), 64 kB; smazat jen pokud to chce člověk
- (Groom 2026-10-04) Rezerva Nízké + CPU 4× (38,5–40,1 vs 30) „pod paralelní zátěží“: šum, Playwright má `workers: 1` a fps fáze běží v rozvrhu samy; meze nesnižovat
- (Groom 2026-10-04) Neprovedené optimalizace (merge statiky, `freezeActiveMeshes`, pooling, code-splitting, CSM okenního světla): zdokumentované rozhodnutí (DECISIONS „Fáze 21“, #11), cíle presetů splněné
- (Groom 2026-10-04) Drobné flagy handoffů: `layout.freeSpot` ignoruje rekvizity (jen dev `?room=`, fáze 15/16/19), volné trosky nejsou v checkpointu (fáze 19, kosmetické): vědomě ponechané, bez akce
