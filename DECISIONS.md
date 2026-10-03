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

## Fáze 2 — Player (2026-10-03)
27. **Havok se krokuje ze systému hry (`Physics.step` v pevném kroku), automatický krok scény je vypnutý (`scene.physicsEnabled = false`):** fyzika i hráč se pak hýbou přesně s `__game.step(ms)`, takže testy pohybu nezávisí na zátěži stroje.
28. **Pozice hráče (`__game.player.position`, spawn, teleport) jsou chodidla, ne střed kapsle ani oči:** spawny a body v level.json leží na podlaze a test porovnává výšku přímo s horní plochou krabice.
29. **Schody mají neviditelný šikmý kolizní pás přes hrany stupňů, stupně jsou jen vizuál:** step-up `PhysicsCharacterController` na celé schodiště spolehlivě nefunguje (dopadne na zaoblenou hranu příliš strmě a krok odmítne podle toho, kde se kapsle hrany dotkne), pás je navíc plynulý pro kameru; fáze 9 má schodiště stavět stejně (`BoxRoom.addStairs`).
30. **`maxStepHeight` (0,35 m) platí pro jednotlivé nízké překážky (obrubník, práh) s pomocí `stepUpBoost`:** když hráč na zemi tlačí dopředu a minulý krok se pohnul pod polovinu požadované rychlosti, controller dostane na jeden krok dvojnásobnou rychlost, aby jeho step-up dosáhl dál než na hranu; u zdi to nic nedělá, protože solver rychlost do zdi odebere.
31. **Svislou rychlost řídí hráč, solver ji smí jen ubrat (strop, podlaha), po přistání se kapsle dosedne raycastem (`groundSnapDistance`):** rychlost ze step-upu (teleport nahoru) by jinak hráče vystřelila ze schodů a controller se po pádu považuje za podepřený i pár centimetrů nad plochou.
32. **`maxSlopeDegrees` 50° místo obvyklých 45°:** step-up controlleru přijme dopad na hranu obrubníku jen s normálou nad `maxSlopeCosine` a při 46° ho odmítal.
33. **Červené okraje při zásahu jsou DOM vrstva nad canvasem (`src/ui/DamageOverlay.ts`), ne vignette pipeline:** nezávisí na nastavení pipeline (fáze 19/21 ji ladí a vypínají) a nepotřebuje GUI texturu.
### Fáze 7 – textury (2026-10-03)
- **Textury jsou paletové PNG ≤ 512 px posterizované přes libimagequant (sharp, bez ditheringu, 10–32 barev):** dává low-poly punk vzhled, deterministický výstup (skripty jsou idempotentní, druhý běh nic nemění) a celé `public/textures/` má 5,9 MB.
- **Parkety, žluté/zelené linoleum a dlažba dvora jsou z `down.jpg` panoramat, ne z půdorysů:** půdorys má 85 px/m a 7 cm lamely ani zrnitost linolea neukáže; měřítko down plochy 354 px/m je změřené na 5 cm čáře hřiště. Oranžové linoleum (žádné panorama) má zrno ze žlutého linolea a barvu z mediánu půdorysu Floor 3.
- **Šachovnice chodby: barvy a rozměr z půdorysu Floor 4 (perioda 35,5 px → dlaždice 29,5 cm, kladené 45° k chodbě), geometrie je ideální šachovnice napasovaná na fotku (95,6 % shoda):** stitching půdorysu dělá zubaté hrany a zadání chce pravidelnou šachovnici bez švů.
- **Čáry tělocvičny jsou samostatný RGBA decal přes celou tělocvičnu (`plan.rectPx` v index.json):** vznikl detekcí modré/žluté v půdorysu a překreslením rovnými 6 cm tahy, aby se dal položit přes opakující se parkety.
- **Poly Haven: ve hře se používá posterizovaná 512px kopie, originál 1K zůstává jako cache v `public/textures/ph/raw/`:** plán chce cache v `public/textures/ph/`; přidá ~4 MB do buildu, fáze 21 ji může z buildu vyřadit.
### Fáze 9 – greybox generátor (2026-10-03)
- **Zdi jsou segmenty bez CSG, každá místnost staví svou polovinu zdi ven ze svého obdélníku** (polovina mezery k sousedovi, u dotýkajících se místností polovina `interiorThickness`, bez souseda obvodová zeď `exteriorThickness`; `src/level/LevelLayout.segments`): sousedé tak mezeru vyplní beze švu, každá stěna nese materiál místnosti, do které je vidět, a otvory jsou jen přerušení segmentu.
- **Statická geometrie se slučuje podle vlastník (místnost) × materiál a kolize je jeden statický Havok compound z boxů na místnost:** box tvary jsou přesné a levné, neviditelné desky schodů a zábradlí nepotřebují mesh, a počet trojúhelníků na místnost jde přímo změřit.
- **Bodové světlo svítí jen na meshe své místnosti (`includedOnlyMeshes`), schodiště a šachta nad ním jsou jeden prostor:** bez stínů by světlo prosvítalo zdmi a sloučené meshe by jinak přetekly limit světel materiálu (`data/materials.json → maxLights`); šest místností bez světla (obě schodiště, šachty, podesta 1. patra, schody k tělocvičně, ulice) proto dostalo světlo v `level.json`.
- **Jas greyboxu: `data/greybox.json → lights.intensityScale` 2,2 a `rangeScale` 1,3 násobí hodnoty z level.json:** autorská poměrná intenzita z fáze 8 zůstává, ve tmě s ACES a vignettou byly místnosti nečitelné; fáze 19 doladí.
- **UV statické geometrie jsou v metrech světa (projekce podle převládající osy normály) a `MaterialLibrary` škáluje opakující se texturu podle `sizeM` z `public/textures/index.json`:** sloučené boxy různých rozměrů pak mají stejně velkou dlaždici; clamp/decal textury (výhled z okna, čáry tělocvičny) mají jednotkové UV na vlastním quadu.
- **Všechny materiály levelu mají černý spekulár a bodová světla `specular` černé (vynucuje `MaterialLibrary`, ne data):** flat styl odlesky nepotřebuje a odlesk na zdi vypadá jako baterka hráče (FEEDBACK.md); fáze 5 řeší totéž v boxroomu a SSAO.
- **Barvy světel v level.json jsou klíče palety:** nové `light.fluorescent` a `light.exitSign`, ostatní přešly na existující `light.lamp`, `light.emergency`, `light.fire` (rozdíl ≤ 22 z 255 v kanálu), kontroluje `tests/data/level.test.ts`.
- **Textury z půdorysu (šachovnice, čáry tělocvičny) jsou v 83 px/m jako geometrie:** dlaždice šachovnice 30,2 cm (perioda 0,855 m), decal 16,51 × 7,53 m kladený podle `plan.rectPx / plan.pxPerMeter` přesně na x0/x1 tělocvičny.
- **Snížené místnosti (`f2-gym-stairs`, `f2-entrance-hall`) mají `ceilingHeight` 5,6 / 5,2, aby strop ležel ve 4,2 m jako ve zbytku podlaží:** jinak by strop schodů k tělocvičně byl ve 2,8 m a průchod 3,4 m by se o něj ořízl.
- **Vite `cacheDir` je `.vite/` v každém checkoutu:** worktree sdílejí `node_modules` symlinkem a souběžné dev servery si ve sdíleném `node_modules/.vite` navzájem přepisovaly optimalizované závislosti („504 Outdated Optimize Dep“, Babylon pak nezkompiloval shader).

## Fáze 3 — Weapon framework + vodní pistolka (2026-10-03)
- **Modely z primitiv mají skladbu v `data/models.json` (`blueprints`: kvádry a válce, barevné sloty, varianty, pohyblivé skupiny a kotvy), každý model je tenká třída nad `BlueprintBuilder`:** rozměry jsou pak data podle CLAUDE.md, fáze 5 a 15 je ladí bez kódu a třída dál nese parametry (varianta, barvy, měřítko) i chování (pumpa, ústí).
- **Rozpočty trojúhelníků jsou v `data/models.json → budgets` po kategoriích; učitel dostal 2000 jako robot, rekvizita 1000, pickup 500:** §13 uvádí jen robota, zbraň a místnost a `ModelRegistry` potřebuje rozpočet pro každou kategorii.
- **Viewmodel se kreslí v rendering group 1 s vymazanou hloubkou (`setRenderingAutoClearDepthStencil`):** zbraň neprolézá zdmi a hitscan ji pozná podle skupiny a přeskočí.
- **Kdo dostává damage, se hledá přes `metadata.damageable` zasaženého mesh nebo jeho rodičů (`DamageTargets`):** pick vrátí díl modelu a stačí označit kořen; roboti z fáze 4 se napojí stejně.
- **Typy damage jsou v `src/core/DamageTypes.ts` (PlayerHealth je jen re-exportuje):** sdílí je hráč, zbraně i nepřátelé a jádro nemá záviset na `player/`.
- **Vodní pistolka má nádržku 30 výstřelů a nekonečnou zásobu; prázdná cvakne a sama se napumpuje za 1 s (R ručně):** DESIGN chce nekonečnou munici a plán zvuk prázdné zbraně, rytmus střelba–pumpa dává pistolce hračkový charakter; přibyla akce `reload` (klávesa R).
- **Zvuky se syntetizují v čistém JS do `new AudioBuffer(...)` bez AudioContextu, kontext vzniká až při první skutečné interakci (pointerdown/keydown):** dřív vytvořený kontext startuje pozastavený a Chrome o tom píše varování, které smoke testy zachytí; `__game.audio` (seznam, počet přehrání) vzniká už teď a fáze 20 ho rozšíří.
- **`Game` vypíná `scene.preventDefaultOnPointerDown/Up`:** Babylon jinak pointerdown na canvasu ruší, prohlížeč pak nepošle `mousedown` a levé tlačítko nestřílí (ověřeno: 0 výstřelů skutečnou myší před opravou, 7 za 1 s po ní; regresní test v `weapon.spec.ts`).
- **Kapky vody jsou částice s frontou (`DropletEmitter`: vlastní startPosition/Direction), ne jeden pohyblivý emitor:** při `__game.step` padne víc výstřelů do jednoho snímku a každý musí mít vlastní proud z ústí k místu zásahu.
- **Terče na střelnici (`data/targets.json`) nemají fyzikální kolizi:** slouží jen hitscanu v dev scéně `weapon` a dětský mesh pod rodičem by Havok musel řešit zvlášť.
