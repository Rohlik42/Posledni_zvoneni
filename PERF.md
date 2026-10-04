# PERF — měření výkonu

Měří se na stroji, kde běží nightshift (DECISIONS #12): Apple M1 Pro, headless Chromium (Playwright 1.63,
`--enable-unsafe-webgpu --use-angle=metal`), renderer WebGPU (adapter `apple metal-3`), vsync 60 Hz. „Slabý notebook“
= preset Nízké + CPU throttling 4× přes CDP `Emulation.setCPUThrottlingRate`. Ryzen AI a skutečný slabý notebook ověří
člověk (Backlog v PLAN.md).

## 2026-10-04 — fáze 21 (quality presets a výkon)

Scéna: celá hra `/?new=1` v 1920×1080 se vším, co běží (22 robotů, učitelé, fyzika, zvuk, oheň), stejná kamera =
start hráče v učebně 30 (`level.json → spawns.player`, pohled ke dveřím). Je to nejnáročnější místo z 11 změřených
místností (v jednom průchodu na Nízké + 4× CPU měla učebna 30 33 fps, ostatní místnosti 38–60 fps). fps = snímky `requestAnimationFrame` za 5 s po 3 s ustálení.
Zdroj čísel: `tests/e2e/perf.spec.ts` (zapisuje `test-results/perf.json`) a sonda s profilerem CDP.

| Měření | Před fází 21 | Po fázi 21 |
| --- | --- | --- |
| Vysoké (vše zapnuto, stíny až 2 světel, v učebně 30 aktivní 1), 1080p | 37 fps (vše zapnuto, stíny vždy) | **60 fps** (vsync strop), 1042 draw callů, 848 aktivních meshů |
| Nízké + CPU 4×, 1080p (render scale 0,6) | 8 fps | **38,5 fps**, 643 draw callů, 620 aktivních meshů |
| Hra stojí (jen render), vše zapnuto | 60 fps | 60 fps |
| Načtení do hratelného stavu (`/?new=1` → level postavený, úvod zavřený) | ≈ 1,8 s | **2,0 s** (limit 5 s) |
| Aktivní meshe ve startovní učebně | 1821 z 2690 | 848 (Vysoké) / 620 (Nízké) |
| Autodetekce (start Střední podle adapteru) | – | Střední 56,1 fps → **Vysoké**, Vysoké 60,0 fps → zůstává |

Kde byl čas (CPU profil 5 s, učebna 30, před fází): 35 % `LineOfSight.probe` dronů (`scene.pickWithRay` = predikát
a inverze matice přes všech 2690 meshů pro každý paprsek, 6 paprsků na dron a krok), render ~50 % (1855 draw callů:
roboti po ~49 dílech, učitelé po ~38, v jiných místnostech za zdmi). Stíny ~1 %, zvuk (SpatialAudio, DoorOcclusion)
pod 0,5 % — throttling zvuku nebyl potřeba.

Co pomohlo:
1. `LineOfSight`: vlastní hledání přes uložené boxy (skupiny podle kořene, bližší první), `TriangleGrid` pro statické
   meshe; stejné odpovědi jako `pickWithRay` (20 000 náhodných paprsků, 0 rozdílů včetně normál). 37 → 48 fps
   (Vysoké), throttled 8 → 25.
2. `RoomCulling`: věci v místnostech dál než N průchodů od hráče se nekreslí (plášť levelu vždy). 48 → 60 fps,
   throttled 25 → 33.
3. Nízké kreslí jen 2 průchody daleko (Střední/Vysoké 3), velké animované skupiny (učitelé) obnovují boxy líně.
   Throttled 33 → 38,5.

## 2026-10-04 — fáze 24 (DoD audit)

Stejná scéna a metodika jako fáze 21 (`tests/e2e/perf.spec.ts`, `test-results/perf.json`), main @ 5c8c4ca + změny fáze 24
(jen data detailů, pojmenované konstanty, jedna židle v tělocvičně navíc; nic, co by mělo měnit výkon).

| Měření | Fáze 21 | Fáze 24 |
| --- | --- | --- |
| Vysoké, 1080p | 60 fps, 1042 draw callů | **60,0 fps**, 880 draw callů, 848 aktivních meshů |
| Nízké + CPU 4×, 1080p | 38,5 fps | **40,1 fps**, 643 draw callů |
| Načtení do hratelného stavu | 2,0 s | **1,8 s** |
| Autodetekce | Střední 56,1 → Vysoké | Střední 57,3 → **Vysoké**, Vysoké 60,0 → zůstává |

Pokles draw callů na Vysoké (1042 → 880) fáze 24 nezkoumala: render ani culling se neměnily a hra během měření běží
(roboti chodí, culling po místnostech, ohně), takže ho nečtěte jako zlepšení; fps je na vsync stropu v obou bězích.

## 2026-10-04 — fáze 25 (rezerva pod vsync, autodetekce dolů, draw cally)

Stejná scéna a metodika (`tests/e2e/perf.spec.ts`, `test-results/perf.json`), main @ 9633423 + fáze 25. Nové: CPU čas
snímku (`__game.quality.stats().cpuFrameMs` / `.window`, `src/rendering/FrameSampler.ts`) = čas od
`engine.onBeginFrameObservable` po `onEndFrameObservable`, tedy kroky hry + `scene.render` + odeslání příkazů WebGPU.
Vsync ho neomezuje. Draw cally a CPU čas jsou min / průměr / max přes všechny snímky měřeného okna (5 s), ne jeden
snímek. Dva běhy quick gate po sobě:

| Měření | Běh 1 | Běh 2 |
| --- | --- | --- |
| Vysoké, 1080p: fps (rAF) | 60,0 | 60,0 |
| Vysoké: CPU čas snímku min / průměr / max | 7,0 / **7,79** / 9,5 ms | 6,9 / **7,80** / 10,1 ms |
| Vysoké: jen `scene.render` (SceneInstrumentation `frameTimeCounter`) | 6,98 ms | 6,99 ms |
| Vysoké: draw cally min / průměr / max | 879 / 965,6 / 1075 | 879 / 964,9 / 1073 |
| Vysoké: nejčastější počty draw callů (snímků z 301) | 1042 × 60, 880 × 58, 1048 × 46, 886 × 46 | 1042 × 60, 880 × 59, 1048 × 46, 886 × 46 |
| Nízké + CPU 4×: fps | 39,9 | 40,1 |
| Nízké + CPU 4×: CPU čas snímku průměr (max) | 23,3 ms (34,6) | 23,2 ms (39,2) |
| Nízké + CPU 4×: draw cally min / průměr / max | 636 / 641,1 / 643 | 636 / 641,1 / 643 |
| Autodetekce nahoru (bez throttlingu) | Střední 57,1 → Vysoké, 60,0 → zůstává | Střední 57,5 → Vysoké, 60,0 → zůstává |
| Autodetekce dolů (CPU 8×, `quality.set("auto")`) | Střední **8,3** fps → Nízké, Nízké 16,0 → zůstává | Střední **9,1** → Nízké, Nízké 16,2 → zůstává |
| Načtení do hratelného stavu | 1,76 s | 1,75 s |

Mez v testu: průměrný CPU čas snímku na Vysoké ≤ **12 ms** (`HIGH_MAX_CPU_FRAME_MS`, DECISIONS „Fáze 25“); naměřeno
7,8 ms a regrese CPU strany o víc než ~55 % test zachytí, i když fps zůstanou na 60. (Opraveno ve fázi 27: dřív tu
stálo „hra by dnes bez vsync stropu běžela kolem 125 fps“. To z CPU času nevyplývá, protože GPU strana se neměřila a
snímek bez stropu omezuje i prezentace. Viz „fáze 27“.) Assert `fps ≥ 57` zůstal jako kontrola stropu. GPU čas (`EngineInstrumentation.gpuFrameTimeCounter`) se
nepoužil: adapter `timestamp-query` umí, ale `EngineFactory` vytváří `WebGPUEngine` bez `enableAllFeatures`, takže
zařízení funkci nemá a `engine.getCaps().timerQuery` není nastavené; zapnout ji by měnilo vytváření enginu pro všechny
hráče kvůli testu. (Opraveno ve fázi 27: dřív tu stálo „Hra je na tomto stroji omezená CPU (pozastavená = 60 fps už
ve fázi 21), proto rozhoduje CPU čas“. 60 fps pozastavené hry je vsync strop, ne důkaz omezení CPU. Ani fáze 27 to
nedokládá: GPU čítač na Metalu práci GPU neměří, viz „fáze 27“.) Odemčení rAF (`--disable-frame-rate-limit
--disable-gpu-vsync`) headless Chromium respektuje jen částečně: sonda naměřila 114–123 fps, tedy další strop
(120 Hz), proto test měří CPU čas a ne odemčené fps.

**Proč fáze 21 hlásila 1042 a fáze 24 880 draw callů.** `stats().drawCalls` je jeden snímek a stínová cube mapa lampy
učebny 30 se kreslí jen každý druhý snímek (`data/rendering.json → shadows.refreshRate` 2). V učebně svítí stíny
1 světlo (`l-f4-u30`) s 27 vrhači; 6 stěn cube mapy × 27 = **162 draw callů** navíc ve snímku, kdy se mapa obnovuje:
880 + 162 = 1042. Sonda to ověřila přímo: s `refreshRate` 2 se stínová funkce volá v průměru 3× za snímek (6 stěn každý
druhý snímek) a okno má dva vrcholy 880/886 a 1042/1048 v poměru ~1 : 1; s `refreshRate` 1 je 6 volání za snímek a
všechny snímky mají 1037–1048. Střední (bez stínů) má jeden vrchol 921–935. Fáze 21 tedy náhodou odečetla snímek se
stíny, fáze 24 snímek bez nich; render ani počet aktivních meshů (848) se mezi nimi nezměnil. Zbylých ±6 draw callů
(880/886, 1042/1048) je v obou polovinách, se stíny nesouvisí a dál se nezkoumaly (běžící hra: oheň, roboti). Od fáze 25
perf.json zapisuje rozsah a nejčastější hodnoty místo jednoho snímku.

## 2026-10-04 — fáze 27 (GPU čas snímku, `?gpuTiming=1`)

Stejná scéna a metodika (`tests/e2e/perf.spec.ts`, `test-results/perf.json → highGpu`), main @ 12cf0d7 + fáze 27. Nový
test 6 otevře `/?new=1&gpuTiming=1` ve vlastním kontextu (sdílená stránka předchozích testů mezitím přejde na
`about:blank`, aby GPU kreslilo jen měřenou hru). S tímto parametrem `EngineFactory` vyžádá na zařízení WebGPU funkci
`timestamp-query`, ale jen když ji adapter nabízí. `QualityManager` pak zapne `EngineInstrumentation.captureGPUFrameTime`.
Babylonův GPU čítač snímku je rozdíl časových razítek od prvního příkazu snímku (upload encoder) po konec render
encoderu. **Na Metalu (M1 Pro) nesleduje práci GPU** (sonda níže), proto se v testu jen zapisuje a mez na něj není. Babylon
měří jeden snímek najednou, proto má okno 5 s ~150 vzorků na 301 snímků. Bez parametru se engine vytváří jako dřív a
`stats().gpuFrameMs` je `null`. Hlídá to boot smoke i test 1. Dva běhy quick gate po sobě:

| Měření | Běh 1 | Běh 2 |
| --- | --- | --- |
| Vysoké, 1080p, `?gpuTiming=1`: GPU čítač snímku min / průměr / max | 0,02 / **1,53** / 1,90 ms (150 vzorků) | 0,02 / **1,69** / 4,35 ms (149 vzorků) |
| tamtéž: fps (rAF) | 60,1 | 60,0 |
| tamtéž: CPU čas snímku min / průměr / max | 7,9 / 9,0 / 12,3 ms | 7,9 / 9,06 / 12,2 ms |
| tamtéž: draw cally min / průměr / max | 925 / 1012 / 1097 | 925 / 1012 / 1097 |
| Vysoké bez parametru (test 3): fps / CPU čas průměr | 60,0 / 7,81 ms | 60,0 / 8,06 ms |
| Vysoké bez parametru: draw cally min / průměr / max | 879 / 965 / 1073 | 879 / 966 / 1075 |
| Nízké + CPU 4× (test 4): fps / CPU čas průměr | 44,0 / 21,3 ms | 41,4 / 22,6 ms |
| Autodetekce nahoru (test 1) | Střední 57,3 → Vysoké, 60,0 → zůstává | Střední 57,5 → Vysoké, 60,0 → zůstává |
| Autodetekce dolů (test 5, CPU 8×, ruční Střední → `auto`) | Střední 10,1 → Nízké, 17,6 → zůstává | Střední 9,5 → Nízké, 16,9 → zůstává |
| Načtení do hratelného stavu | 1,74 s | 1,76 s |

Jednorázové sondy ze sezení fáze 27, nejsou v testu: Střední 1,51 ms, Nízké 1,11–1,24 ms (render 1152×648). Vysoké při
4× počtu pixelů (deviceScaleFactor 2, render 3840×2160) má 1,97–2,10 ms a stále **60,0 fps** při CPU čase 8,9–9,1 ms.
Razítka jednotlivých průchodů (`timestampWrites`) vrací na Metalu nesmysl (součet 43 ms průměr a 242 ms max za snímek
při 60 fps), proto se nepoužila.

**Reaguje čítač na cenu průchodů? Ne.** Oprava po review fáze 27. Jednorázová sonda (jeden kontext s `?gpuTiming=1`,
Vysoké, stejný pohled; části pipeline přepíná `__game.rendering.setEnabled`; před každým oknem 5 s se 3 s ustaluje) proběhla
2× po sobě. Hodnoty jsou ve tvaru běh 1 / běh 2:

| Nastavení | 1080p (dsf 1): fps | 1080p: GPU čítač průměr | 5760×3240 (dsf 3): fps | 5760×3240: GPU čítač průměr | dsf 3: CPU čas průměr |
| --- | --- | --- | --- | --- | --- |
| vše zapnuto | 60,0 / 60,0 | 1,65 / 1,58 ms | **33,2 / 32,9** | **0,016 / 0,014 ms** | 11,0 / 10,9 ms |
| bez SSAO | 60,0 / 60,0 | 1,65 / 1,64 ms | 48,2 / 48,4 | 0,020 / 0,023 ms | 10,7 / 10,4 ms |
| bez SSAO a bloomu | 60,0 / 60,0 | 1,49 / 1,46 ms | 60,1 / 60,0 | 2,69 / 2,13 ms | 9,9 / 9,5 ms |
| bez všech částí pipeline | 22,2 (?) / 60,0 | 1,61 / 1,55 ms | 60,0 / 60,0 | 2,09 / 2,15 ms | 9,3 / 9,1 ms |
| vše zapnuto znovu | 60,1 / 60,1 | 1,64 / 1,57 ms | 33,0 / 33,1 | 0,015 / 0,014 ms | 10,5 / 10,3 ms |

V 5760×3240 hru brzdí GPU: CPU čas je ~11 ms, ale fps jsou 33 a vypnutí SSAO je zvedne na 48. Právě tehdy čítač
ukazuje ~0,015 ms. V 1080p vypnutí SSAO (16 vzorků na celou obrazovku) čítač nezmění vůbec (1,65 → 1,65 ms). Čítač tedy
cenu průchodů nesleduje a jeho číslo není GPU čas snímku. Proč klesne skoro na nulu, když hru brzdí GPU, se nezkoumalo.
Nejspíš Metal zapíše razítka na hranicích encoderů dřív, než doběhnou render passy. Hodnota 22,2 fps v běhu 1 (1080p
bez pipeline) se ve druhém běhu neopakovala (60,0) a její příčina se nezkoumala.

Důsledek: v testu 6 **není mez na GPU čas** (dřívější `HIGH_MAX_GPU_FRAME_MS` 5 ms je pryč, DECISIONS „Fáze 27“). Test
assertuje jen to, že zařízení dostalo `timestamp-query`, čítač vrací nenulové vzorky a fps jsou ≥ 57, a čítač zapíše do
`perf.json → highGpu`. Podle plánu (bod 1: „nesmysl → test jen zapíše“).

**Jak číst čísla.**
- Rezerva pod vsync stropem = větší z CPU a GPU času. CPU čas je 7,8–8,1 ms, tedy ~8,6 ms pod 16,7 ms (mez 12 ms).
  GPU čas snímku v ms **neznáme**: čítač ho na Metalu neměří (viz sonda). Která strana rozhoduje, se tedy říct nedá.
- Nezávislý důkaz o GPU straně jsou jen fps: Vysoké drží 60 fps i ve 3840×2160 (4× pixely). Ve 5760×3240 (9× pixely)
  spadne na 33 fps, bez SSAO na 48 a bez SSAO a bloomu je zpět na 60. Vysoké v 1080p se tedy na GPU vejde do 16,7 ms i se 4× pixely.
- GPU regresi (stíny, SSAO, bloom) hlídá pořád **jen `fps ≥ 57`**. Zachytí ji, až když snímek přeroste vsync strop.
- Kolik fps by hra měla bez stropu, z toho nevyplývá. Snímek omezuje i prezentace a kompozitor a sonda s odemčeným rAF
  (fáze 25) narazila na další strop ~120 Hz. Proto už tu není tvrzení „≈ 125 fps“.
- S `?gpuTiming=1` je CPU čas o ~1,2 ms vyšší (9,0 vs 7,8–8,1 ms) a snímek má ~46 draw callů navíc (925–1097 vs
  879–1075). Pravděpodobně jde o čtení razítek (`mapAsync`) a o jiný stav čerstvé hry v novém kontextu. Příčina se
  nezkoumala. Mez CPU času (12 ms) hlídá test 3 bez parametru.
- Čítač běží jen v Chromiu s `--enable-unsafe-webgpu` (perf test). Běžný Chrome 153 nemá `GPUCommandEncoder.writeTimestamp`,
  Babylon pak hlásí 0 a `stats().gpuFrameMs` zůstane `null`. Ověřeno ve vizuální kontrole fáze 27.

## 2026-10-04 — Souboj (FEEDBACK „laguje to, když lítá hodně particles“, i na Nízké na Windows)

Zdroj čísel: `tests/e2e/perf-combat.spec.ts` (zapisuje `test-results/perf-combat.json` a `.cpuprofile`). Celá hra
`/?new=1`, hráč v tělocvičně (největší místnost, hoří v ní oheň), 12 robotů všech typů (po čtyřech humanoidech,
čtyřnožcích a dronech) teleportovaných před něj. Skript v stránce bojuje v reálném čase: míří na nejbližšího robota,
drží a pouští spoušť (700 / 150 ms), každých 2,4 s přepne na další ze 6 zbraní a doplní ji, každých 1,6 s zničí robota
(trosky, jiskry, otřes), každé 2 s odpálí past z kvízu (`__game.quiz.trapBlast`); roboti střílí zpět, hráč má IDDQD.
Každé kolo začíná čistě (roboti zpět, `pickups.removeDrops`), 4 s se bojuje na zahřátí, pak se 8 s měří. Před měřením
jedno celé kolo navíc („první boj“). Na snímek: CPU čas (engine begin → end), interval mezi snímky (drží i GC a vše mimo
snímek), p95 a max, draw cally, živé částice, systémy s částicemi, světla, meshe; v okně počet překladů shaderů a nových
WebGPU pipeline (`CompileCounter`). Adaptace je při měření vypnutá. Stroj: M1 Pro, headless Chromium, WebGPU. Během
měření běžely i procesy jiných agentů (load average 3,4–6,7; v prvních sondách přes 20, ta čísla nejsou v tabulce).
„Před“ = main @ 6774b08 + jen měřicí commit (worktree, stejný test), „po“ = tato změna; obě sady za sebou do 20 minut.

| Předvolba | fps | CPU snímku průměr / p95 / max (ms) | nejdelší interval (ms) | draw cally | částice max | překlady + pipeline v okně |
| --- | --- | --- | --- | --- | --- | --- |
| Vysoké 720p | 40,2 → **60,0** | 23,3 / 48,4 / 209 → **12,3 / 17,2 / 22** | 210 → **22** | 2866 → 1203 | 1092 → 964 | 0 → 0 |
| Střední 720p | 50,6 → **60,0** | 14,3 / 18,5 / 226 → **8,9 / 13,3 / 21** | 227 → **21** | 705 → 597 | 936 → 780 | 0 → 0 |
| Nízké 720p | 50,7 → **60,1** | 13,3 / 15,8 / 273 → **8,3 / 11,5 / 18** | 273 → **19** | 722 → 572 | 688 → 566 | 5 → 0 |
| Vysoké 720p CPU 4× | 3,2 → **11,2** | 300,5 / 685,8 / 910 → **85,7 / 128,3 / 152** | 915 → **159** | 4262 → 1333 | 976 → 976 | 0 → 0 |
| Střední 720p CPU 4× | 3,6 → **17,3** | 270,1 / 659,4 / 1090 → **54,6 / 97,7 / 153** | 1096 → **156** | 1193 → 601 | 662 → 721 | 0 → 0 |
| Nízké 720p CPU 4× | 3,6 → **20,8** | 271,9 / 764,2 / 1064 → **45,1 / 90,5 / 162** | 1071 → **166** | 1159 → 492 | 457 → 493 | 2 → 0 |
| Vysoké 1080p | 41,0 → **60,1** | 22,8 / 54,3 / 330 → **12,1 / 17,4 / 21** | 330 → **22** | 2787 → 1113 | 1124 → 990 | 2 → 0 |
| Střední 1080p | 52,5 → **60,1** | 13,2 / 17,6 / 177 → **9,6 / 13,5 / 19** | 178 → **23** | 614 → 616 | 858 → 751 | 2 → 0 |
| Nízké 1080p | 51,3 → **60,1** | 13,3 / 17,2 / 178 → **8,1 / 11,9 / 19** | 179 → **24** | 652 → 567 | 731 → 529 | 0 → 0 |
| Vysoké 1080p CPU 4× | 2,6 → **9,8** | 368,3 / 1033,6 / 1069 → **98,2 / 165,5 / 175** | 1165 → **183** | 4505 → 1442 | 888 → 914 | 0 → 0 |
| Střední 1080p CPU 4× | 4,0 → **15,9** | 239,0 / 692,2 / 1608 → **59,6 / 97,8 / 153** | 1615 → **157** | 1114 → 614 | 847 → 723 | 2 → 0 |
| Nízké 1080p CPU 4× | 4,2 → **22,3** | 232,9 / 616,9 / 709 → **41,9 / 87,4 / 144** | 620 → **147** | 1086 → 495 | 453 → 507 | 0 → 0 |
| WebGL2 (`?renderer=webgl2`) Vysoké 1080p | 45,9 → **60,0** | 19,7 / 36,7 / 195 → **9,6 / 14,0 / 17** | 205 → **17** | 3355 → 1169 | – | 1 → 0 |
| WebGL2 Nízké 1080p | 50,8 → **60,1** | 11,6 / 15,1 / 289 → **5,8 / 8,2 / 15** | 290 → **17** | 715 → 516 | – | 1 → 0 |
| Procházka celou trasou na Vysoké (28 lamp se stíny) | – | – | – | – | – | **94 + 114 → 0 + 1** |

Světla 51 → 55 (3 tmavá doplňková světla pohyblivých věcí a 1 „držák“ stínových shaderů), systémů s částicemi nejvýš
27–28 v obou, meshů ~2900 v obou. Rozpočet efektů na Nízké v boji vynechal 11 711 ozdobných částic (hustota 0,45), strop
živých částic se nedotkl (`culled` 0). Adaptace (Nízké 1080p, CPU 6×): po 6 s sestoupila na úroveň 1 (render scale 0,6
→ 0,51, ozdobné částice × 0,75) bez jediného překladu; vypnutí v menu vrátí předvolbu hned.

Cíle zadání na tomto stroji: Vysoké 1080p průměr CPU ≤ 12 ms — **12,1 ms** (téměř, dřív 22,8), p95 ≤ 20 ms — **17,4**
(splněno, dřív 54,3); žádný snímek nad 100 ms po zahřátí — **splněno** bez throttlingu (nejdelší 24 ms, dřív 178–330
ms), s CPU 4× ne (144–183 ms); **Nízké s CPU 4× ≥ 30 fps — nesplněno: 20,8–22,3 fps** (dřív 3,6–4,2). Kontrola
(`COMBAT_MODE=idle`, roboti v tělocvičně stojí a nikdo nestřílí): Nízké 1080p s CPU 4× má **20,1 fps** i bez boje —
zbývající cena je vykreslení scény (~500 draw callů: díly robotů po ~50, level, učitelé) a AI, ne efekty boje. Test proto
hlídá jen meze proti regresi (Vysoké 1080p ≤ 16 / p95 ≤ 25 ms, Nízké CPU 4× ≥ 14 fps, interval ≤ 100 ms, 0 překladů).
Zrychlit dál by šlo jen sloučením dílů robotů do méně meshů (draw cally), to je mimo tuto změnu.

Kde byl čas (CPU profil Vysoké 1080p, CPU 4×, 5 s boje; `.cpuprofile` v test-results):
- **Před:** `RoomLighting.update → relink → exclude` **29,5 %** (Babylonův hook na `includedOnlyMeshes.splice` projde
  celou scénu za každý mesh a světlo; spouštěla ho každá mokrá skvrna na robotovi a každý rozpad robota),
  `EnemyProjectiles.advance` **8,1 %** (`scene.pickWithRay` přes ~2700 meshů každým krokem každé střely, k tomu
  `CreateSphere`/`dispose` na výstřel). V mezikroku po opravě `RoomLighting` zbyly na Vysoké stínové mapy ~25 % (díly
  robotů v cube mapách lamp, ~2000 draw callů navíc). Částice samy (sonda Nízké): animace 2,2 % + kreslení 1 %, GC 0,2 % —
  „laguje to s particles“ byla souvislost s bojem, ne příčina.
- **Po:** vykreslení 51 % (z toho stínové mapy 9 %), `(program)` (nativní WebGPU) 29 %, simulace 17,6 % (roboti 8,3 %,
  zbraně 3 %, `LineOfSight` 3,4 %, `RoomCulling` 2,8 %), částice 2,1 %, `RoomLighting` 0,8 %, střely robotů 0,2 %.
- **Překlady shaderů** (`CompileCounter`, WebGPU): v měřených oknech před 0–5 za 8 s (robot v místnosti s jiným počtem
  lamp, první mokrá skvrna, trosky bez světel, efekty po změně předvolby), po 0. Procházka celou trasou na Vysoké: před
  94 efektů a 114 pipeline (každá lampa, která dostala stín, přeložila materiály celé místnosti; jeden snímek ~83 ms),
  po 0 efektů a 1 pipeline (nevystopovaná, je i na Střední bez stínů).

Statická scéna (`tests/e2e/perf.spec.ts`, start v učebně 30, 1080p): Vysoké CPU 11,7 ms (main před touto změnou 10,5 ms,
fáze 25 7,8 ms — mezitím přibyli lidé a světla jiných agentů); trvalé stínové generátory všech 40 lamp stojí v tomto
pohledu ~1,3 ms vazeb stínů za snímek (sonda: stíny zapnuté/vypnuté 12,3 / 10,9 ms, main 10,6 / 9,6 ms), proto mez testu
12 → 14 ms (DECISIONS). Nízké s CPU 4× ve statické scéně: 21,6 fps po, **23,2 fps na main před touto změnou** — test 4
perf.spec (≥ 30 fps) padal už na main @ 6774b08, nezpůsobila to tato změna.

Panel výkonu: F3 nebo `?perf=1` v adrese ukáže renderer, předvolbu a úroveň adaptace, fps, CPU snímku, interval snímku,
počet zaseknutí > 100 ms, překlady shaderů (celkem / za poslední sekundu), WebGPU pipeline, částice, draw cally, meshe a
světla — čísla, která může člověk opsat z Windows (Ryzen) a poslat.

## 2026-10-04 — Zasekávání na Macu (FEEDBACK „občas se to sekne, jak se něco předpočítává“)

Zdroj čísel: `tests/e2e/hitches.spec.ts` (zapisuje `test-results/hitches[-<tag>].json`). Celá hra `/?new=1` s předvolbou
uloženou v nastavení před načtením a s adaptací, jak ji má hráč (výchozí zapnuto). **Procházka:** hráč jde v reálném
čase klávesou dopředu celou trasou `level.json → route` (~420 m, ~93 s, 4 patra, dveře otevírá cestou, roboti útočí,
IDDQD). **Souboj:** 30 s boje v tělocvičně (`tests/support/CombatScript.ts`, stejný skript jako `perf-combat.spec.ts`).
Snímky se měří v stránce (`performance.now()` v `requestAnimationFrame`), počítá se vše po prvních 3 s. Displej jako
Retina Macu (`deviceScaleFactor` 2: 1280×720 CSS px = render 2560×1440, 1920×1080 = 3840×2160), headless Chromium,
WebGPU, M1 Pro; stroj byl zatížený jinými agenty (load 4–7). „Před optimalizací“ = 1bdef5e (worktree, stejný test; past
z kvízu tam nemá hook, takže jeho souboj je lehčí), „1ef8804“ = commit „combat performance“ (worktree s dočasnými
štítky důvodů), „po“ = tato změna. Buňka: **snímky > 50 ms / snímky > 33 ms za minutu / nejdelší snímek po 3 s (ms)**.

| Scénář (2×) | Před optimalizací | 1ef8804 | Po |
| --- | --- | --- | --- |
| Procházka Vysoké 720p | 49 / 68,7 / 184 | 48 / 55,8 / 104 | **0 / 0 / < 33** (max 29) |
| Procházka Vysoké 1080p | 56 / 71,9 / 177 | 48 / 59,3 / 99 | **0 / 0 / < 33** (max 31) |
| Procházka Střední 720p | 39 / 50,9 / 177 | 0 / 0 / < 33 | **0 / 0 / < 33** (max 33) |
| Procházka Střední 1080p | 34 / 46,7 / 188 | 0 / 0 / < 33 | **0 / 0 / < 33** (max 28) |
| Souboj Vysoké 720p | 26 / 47 / 254 | 0 / 0 / < 33 (start boje 108) | **0 / 0 / < 33** (max 30) |
| Souboj Vysoké 1080p | 24 / 57 / 251 | 0 / 0 / < 33 (start boje 96) | **0 / 0 / < 33** (max 31) |
| Souboj Střední 720p | 26 / 34 / 224 | 0 / 0 / < 33 | **0 / 0 / < 33** (max 28) |
| Souboj Střední 1080p | 26 / 34 / 240 | 0 / 0 / < 33 | **0 / 0 / < 33** (max 33) |
| Automaticky, procházka 720p (zvolí Vysoké) | – | – | 0 / 0,7 / 36 |
| Automaticky, procházka 1080p (zvolí Střední) | – | – | 0 / 0 / < 33 |
| Displej 1:1, Automaticky 1080p, procházka | – | 33 / 50,6 / 87 (zvolí Vysoké) | **0 / 0,7 / 34** |
| Displej 1:1, Vysoké 1080p, procházka | – | 42 / 52,8 / 101 | **0 / 0 / < 33** |
| Displej 1:1, Vysoké 1080p, souboj | – | 0 / 0 / < 33 (start 100) | **0 / 0 / < 33** |

Cíle zadání: žádný snímek > 50 ms po prvních 3 s — **splněno** ve všech 13 bězích; snímky > 33 ms nejvýš 1 za minutu
— **splněno** (nejvýš 0,7/min, 1 snímek 34–36 ms v celé procházce). Průměry souboje (`perf-combat.spec.ts`, adaptace
vypnutá, displej 1:1, CPU snímku průměr / p95 ms) 1ef8804 → po: Vysoké 720p 10,8 / 15,4 → 10,8 / 15,5; Střední 720p
7,8 / 11,7 → 7,8 / 11,1; Vysoké 1080p 11,2 / 16,1 → 11,0 / 15,6; Střední 1080p 8,2 / 11,7 → 8,4 / 11,6 (v rámci ±3 %,
mez zadání 10 %); 0 překladů a 0 pipeline v měřených oknech v obou.

Kde byla zaseknutí (štítky `FrameTags` a Chrome trace s `HITCH_TRACE=1`):
- **1ef8804, Vysoké, procházka: výměna stínových map lamp.** 55 z 86 dlouhých snímků mělo štítek `shadowSwap`/`shadowIdle`
  s CPU snímku 40–75 ms (24 dalších z prvních 10 s už se do tehdejšího logu 64 snímků nevešlo), v chodbách každé ~2 s
  (kdykoli se změní 2 nejbližší lampy). `RenderTargetTexture.resize`
  (8 ↔ 512 px) spouští v Babylonu `ShadowGenerator.recreateShadowMap`: nový render pass, takže vrhači znovu staví stav
  kreslení, a `_markMeshesAsLightDirty` na celou místnost. Dalších 5 snímků (37–56 ms) mělo jen štítek `rechoose`
  (výměna světel robota) — na Střední tytéž výměny dlouhý snímek nedělají a po opravě zmizely i tyto (byla to první
  kresba nově vytvořené mapy). Na Střední (bez stínů) 1ef8804 nezasekával.
- **Automatická volba přepínala předvolbu za hry:** měřila v prvních vteřinách hraní a změna (render targety, 40 stínových
  generátorů, 3 snímky zahřátí všeho bez ořezu) stojí na M1 **230–355 ms jednoho snímku** (sonda Střední ↔ Vysoké za hry,
  2560×1440). S displejem 1:1 volba na M1 přešla na Vysoké, a tím i na výměny stínových map výše.
- **Adaptivní rozlišení:** krok mění hardware scaling a realokuje všechny render targety. Na M1 je levný (sonda 2560×1440
  ↔ 2176×1224 na Střední i Vysoké: nejdelší snímek kolem kroku 19–23 ms), na Macu tedy zaseknutí nezpůsoboval; je ale
  přesně tou realokací za hry, kterou zadání zakazuje, a na Windows bývá dražší → výchozí vypnuto (volba zůstává).
- **Zbytek po opravě (trace):** jediný snímek nad 33 ms v procházce Vysoké (34,7 ms) = přepočet defines materiálu
  (`isReadyForSubMesh` 2,5 ms) po výměně světel robota; v souboji 34 ms = mokrá skvrna (`CreateDecal`, 2,6 ms) + běžný
  snímek. GC v dlouhých snímcích 0 ms.
- **Před optimalizací (1bdef5e)** zasekával v tomto měření víc než 1ef8804, i na Střední (38 snímků > 50 ms za
  procházku, 26 v souboji). Trace (`HITCH_TRACE=1`, Střední 720p@2×): ve všech dlouhých snímcích procházky běželo
  `RoomLighting.include`/`exclude` (30–150 ms; robot, který hráče honí, přešel do jiné místnosti a přepojoval ~50 dílů
  přes Babylonův hook — opraveno v 1ef8804), GC 0 ms. Robot honící hráče s IDDQD přes celou školu je horší případ než
  běžné hraní, takže starou verzi to v praxi mohlo škubat méně; výměna stínových map v 1ef8804 se ale opakovala při
  každém průchodu chodbou s lampami na Vysoké, i bez robotů v okolí — proto „občas se to sekne“ až po optimalizaci.

Co se změnilo: stínová mapa lampy mění jen velikost textury (handler generátoru se při naší změně velikosti přeskočí);
automatická volba měří a přepíná jen za obrazovkou (menu, příběh, pauza), nikdy za hry; adaptace za hry ubírá jen
ozdobné částice (rozlišení jen s volbou „Při zpomalení snížit i rozlišení“); `FrameBudget` dokončí při načtení vše
předpočitatelné (mřížky trojúhelníků `LineOfSight` — dřív líně při prvním paprsku do nové místnosti) a co přibude za
hry, rozloží po ≤ 1,5 ms na snímek; bazény střel robotů (24 na materiál) a balónků (6) mají pevnou velikost.

Panel F3 / `?perf=1` nově ukazuje **nejdelší snímek za posledních 10 s**, počet snímků > 33 ms a **poslední snímek
> 33 ms s důvodem** (např. „výměna stínové mapy lampy“, „zahřátí shaderů“, „mimo snímek (GC nebo prohlížeč)“, „důvod
neznámý“). Z Windows (Ryzen) tak jde poslat i příčinu, ne jen čísla.

Měřit znovu: `HITCH_PRESETS=high,medium HITCH_HEIGHTS=720,1080 HITCH_SCENARIOS=walk,combat HITCH_ASSERT=0
npx playwright test tests/e2e/hitches.spec.ts`; `HITCH_TRACE=1` připíše GC a funkce z CPU sampleru, `HITCH_DPR=1`
displej 1:1. Výchozí běh (Střední 720p@2×, procházka) je test: žádný snímek > 50 ms po 3 s a nejvýš 4 snímky > 33 ms
za minutu (cíl 1/min; běh, jehož dlouhé snímky hra nezpůsobila, se změří ještě jednou).

Známé: test 4 v `perf.spec.ts` (Nízké s CPU 4× ≥ 30 fps ve statické scéně) dál padá jako na main před touto změnou
(teď 28,2 fps, dřív 21,6–23,2; viz „Souboj“).

## 2026-10-04 — Překlady po přepnutí předvolby (Nízké 720p) a zahřátí všech variant

Úloha: `perf-combat.spec.ts` padal na `low-720` (po přepnutí na Nízké se v měřeném okně přeložil 1 shader a vznikly
1–2 WebGPU pipeline, i na 9b31cb4). Zahřátí (`ShaderPrewarm`) má po změně předvolby (za menu, pauzou nebo příběhem) a
při načtení postavit každou variantu, kterou hra pak opravdu použije. Stroj: M1 Pro, headless Chromium, WebGPU, load
average 3–7 (běžely i jiné agenty). „Před“ = cafaee4 (worktree), „po“ = tato změna (worktree se stejným základem),
střídavě za sebou.

**Jak se to hledalo.** `CompileCounter` teď zapisuje i každou novou WebGPU pipeline (`kind: "pipeline"`) s efektem
(`effectId`, defines) a stavem kreslení: render target (`PostProcessRTT-imageProcessing`, `sceneprePassRT`,
`light:…_shadowMap`, `main`), formáty barev a hloubky, MSAA, blending, zápis hloubky, culling, surový klíč Babylonovy
cache a se zapnutým `perf.trace(true)` i mesh, který ji kreslil. Assert v `perf-combat.spec.ts` pak píše např.
`pipeline default [extinguisher-beam-core …] {draw, target PostProcessRTT-imageProcessing, …, blend 0, depthWrite 1,
…} <ALPHABLEND NONUNIFORMSCALING …>`. Sonda (jednorázový spec, není v repu): čerstvé načtení s předvolbou, nebo 16 s boje,
pauza, přepnutí předvolby, 1,5 s; pak 32 s boje (každá zbraň 2×) a vše, co se v něm přeložilo.

| Sonda (720p; 32 s boje), efekty + pipeline | Před | Po |
| --- | --- | --- |
| Načtení na Nízké | 7 | **0** |
| Načtení na Střední / Vysoké | 7 / 7 | **0 / 0** |
| Vysoké → Nízké | 10 | **0** |
| Střední → Nízké | 12 | **0** |
| Nízké → Vysoké | 5 | **0** |
| Vysoké → Střední | 0 | 0 |
| 1080p: načtení Nízké, Nízké → Střední, Střední → Vysoké, Vysoké → Nízké, Nízké → Vysoké | – | **0 ve všech** |

Co se překládalo a proč (každá příčina potvrzená sondou, opravy v pořadí nálezu):
1. **Paprsek hasičáku a railgunu** (to je `low-720` z úlohy): zahřátí ho kreslilo v klidu — měřítko 1 a průhlednost 0.
   Výstřel ho natáhne (define `NONUNIFORMSCALING`, jiný shader) a jádro v plném jasu (alfa 1) se kreslí neprůhledně,
   tedy jiná pipeline než při doznívání. Na Nízké chybí pre-pass SSAO, takže kreslení míří do jiného render targetu
   než na Střední a Vysoké a pipeline z dřívějších předvoleb nepomůže.
2. **Defines podle historie meshe** (Babylon drží defines pro každý sub-mesh a vypisuje je v pořadí, v jakém poprvé
   vznikly): mesh, který svítil 1 světlem a pak 4, dával jiný řetězec (= jiný shader) než mesh se 4 světly od začátku.
   Po vypnutí SSAO zůstaly v defines každého už kresleného meshe `PREPASS_COLOR`, indexy a `SCENE_MRT_COUNT`, takže
   robot po respawnu nebo nová mokrá skvrna (kreslené poprvé po přepnutí) měly jinou variantu než všechno, co
   zahřátí vidělo. Typicky 4–8 efektů a pipeline po Vysoké/Střední → Nízké.
3. **Zbraně postavené až při sebrání** (jen BFG měla `preload`): jejich efekty z bazénů (paprsky, balónky, skvrny)
   se zaregistrovaly do zahřátí až po něm, takže se přeložily při prvním výstřelu. To platí i pro skutečné sebrání zbraně
   za hry.
4. **Zbraň v ruce svítila jen ta aktivní**: při načtení ještě žádná není v ruce (zvedá se), zahřátí ji tedy kreslilo
   jen s ambientem a její průhledná nádržka se 4 světly dostala pipeline až v boji.
5. **Doplňková tmavá světla pohyblivých věcí měla bílý odlesk** (`specular`), všechna světla levelu černý: robot nebo
   zbraň v místnosti s méně než 3 lampami (doplněné tmavými) měly define `SPECULARTERM`, v místnosti s dost lampami ne.
   Přechod mezi místnostmi tak mohl přeložit shader i za hry mimo souboj.
6. **Mokrá skvrna na nataženém dílu robota** (`NONUNIFORMSCALING`): zahřátí kreslilo jen skvrnu s měřítkem 1.
7. **Stínová mapa lampy po změně velikosti neměla hloubkový buffer**: rychlá změna velikosti mapy ze „Zasekávání na
   Macu“ přeskočí Babylonův handler, který buffer vytváří. Vrhači se pak kreslili bez testu hloubky (ve stínové mapě
   vyhrál poslední nakreslený, ne nejbližší) a v jiném stavu, než který zahřátí postavilo. To byla ta „1 pipeline na
   trase, nevystopovaná“ z „Souboje“.

| `perf-combat.spec.ts` | Před | Po |
| --- | --- | --- |
| Měřená okna (12 kombinací předvolba × 720p/1080p × CPU 1×/4×), překlady + pipeline | `low-720` 0 + 1, v A/B i `high-1080` 0 + 1 a `low-1080-x4` 0 + 1 | **0 + 0 ve všech** (2 plné běhy) |
| První boj (Vysoké 1080p, neměřený) | 1 + 2 (paprsek hasičáku) | **0 + 0** |
| Procházka trasou na Vysoké (27 stínových lamp) | 0 + ≤ 1 (test dovoloval 2) | **0 + 0** (test teď chce 0) |
| WebGL2 Vysoké / Nízké 1080p, adaptace na Nízké s CPU 6× | 0 | 0 |
| Vysoké 1080p CPU snímku průměr / p95 | 9,4–9,7 / 13,6–13,7 ms | 9,4–9,7 / 13,4–13,8 ms |
| Nízké 1080p CPU 4× v boji | 35,0–35,4 fps | 34,2–37,4 fps |

Statická scéna (`perf.spec.ts`, tři běhy střídavě před / po): Nízké s CPU 4× **32,8 / 33,4 / 33,5 → 32,6 / 33,3 /
33,0 fps** (test 4, mez 30, prochází), Vysoké CPU snímku 9,88–9,98 → 9,73–9,82 ms, načtení do hratelného stavu
2,39–2,42 → 2,51–2,54 s (+ ~130 ms: při načtení se staví a zahřívají všechny zbraně; mez 5 s). `hitches.spec.ts`:
procházka Střední 720p@2× 0 snímků > 33 ms po zahřátí (nejdelší 30,7 ms), souboj Vysoké a Nízké 720p@2× 0 po 3 s.

Cena oprav a co ji vyrovnalo: postavené zbraně přidaly ~6 nečinných systémů částic. Babylon každý spuštěný systém
v každém snímku animuje a kreslí, i prázdný (kontrola připravenosti, defines, prázdné nahrání). `DropletEmitter` teď
nečinný systém zastaví a další kapka ho zase spustí. Seřazené defines se počítají jen pro materiály meshů (mají
`PREPASS`), ne pro image processing částic, který se vypisuje třikrát za snímek a systém. Seznam meshů zbraní pro
osvětlení se v `RoomLighting` nekontroluje znovu, když je to stále stejné pole. CPU profil statické scény (Nízké,
CPU 4×) je pak před i po stejný: částice 1,5–1,9 %, `RoomLighting` 0,6–0,7 %.

**Nízké s CPU 4× ≥ 30 fps (`perf.spec.ts` test 4)** dnes prochází i před touto změnou (32–33 fps při load average
3–5). Dřívějších 20–21 fps se na cafaee4 nepodařilo zopakovat, nejspíš to bylo vytížením stroje (sonda „Souboj“
uvádí load až 20). Sloučení dílů robotů do méně meshů (141 z ~684 draw callů ve startovním pohledu) se nedělalo.
Díly jsou samostatné cíle zásahu (`DamageTargets`) i trosky po zničení (`LooseDebris`) a nesou mokré skvrny a oči
s vlastní animací, takže by se změnilo, jak se robot rozpadá a co zasáhne. Zbytek ceny je kreslení: `(program)`
~23 %, `_draw`, uniformy.
