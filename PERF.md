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
ve fázi 21), proto rozhoduje CPU čas“. 60 fps pozastavené hry je vsync strop, ne důkaz omezení CPU. Že CPU čas je větší
než GPU čas, ukázalo až měření GPU ve fázi 27.) Odemčení rAF (`--disable-frame-rate-limit
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
GPU čas snímku je rozdíl časových razítek od prvního příkazu snímku (upload encoder) po konec render encoderu. Babylon
měří jeden snímek najednou, proto má okno 5 s ~150 vzorků na 301 snímků. Bez parametru se engine vytváří jako dřív a
`stats().gpuFrameMs` je `null`. Hlídá to boot smoke i test 1. Dva běhy quick gate po sobě:

| Měření | Běh 1 | Běh 2 |
| --- | --- | --- |
| Vysoké, 1080p, `?gpuTiming=1`: GPU čas snímku min / průměr / max | 0,02 / **1,53** / 1,90 ms (150 vzorků) | 0,02 / **1,69** / 4,35 ms (149 vzorků) |
| tamtéž: fps (rAF) | 60,1 | 60,0 |
| tamtéž: CPU čas snímku min / průměr / max | 7,9 / 9,0 / 12,3 ms | 7,9 / 9,06 / 12,2 ms |
| tamtéž: draw cally min / průměr / max | 925 / 1012 / 1097 | 925 / 1012 / 1097 |
| Vysoké bez parametru (test 3): fps / CPU čas průměr | 60,0 / 7,81 ms | 60,0 / 8,06 ms |
| Vysoké bez parametru: draw cally min / průměr / max | 879 / 965 / 1073 | 879 / 966 / 1075 |
| Nízké + CPU 4× (test 4): fps / CPU čas průměr | 44,0 / 21,3 ms | 41,4 / 22,6 ms |
| Autodetekce nahoru (test 1) | Střední 57,3 → Vysoké, 60,0 → zůstává | Střední 57,5 → Vysoké, 60,0 → zůstává |
| Autodetekce dolů (test 5, CPU 8×, ruční Střední → `auto`) | Střední 10,1 → Nízké, 17,6 → zůstává | Střední 9,5 → Nízké, 16,9 → zůstává |
| Načtení do hratelného stavu | 1,74 s | 1,76 s |

Jednorázové sondy, nejsou v testu: Střední 1,51 ms, Nízké 1,11–1,24 ms (render 1152×648). Vysoké při 4× počtu pixelů
(deviceScaleFactor 2, render 3840×2160) má 1,97–2,10 ms a stále **60,0 fps** při CPU čase 8,9–9,1 ms. Razítka jednotlivých
průchodů (`timestampWrites`) vrací na Metalu nesmysl (součet 43 ms průměr a 242 ms max za snímek při 60 fps), proto se
nepoužila.

Mez v testu: průměrný GPU čas snímku na Vysoké ≤ **5 ms** (`HIGH_MAX_GPU_FRAME_MS`, DECISIONS „Fáze 27“). To jsou ~3×
naměřené hodnoty a ze 16,7 ms snímku zůstane 11,7 ms volných. Hodnoty jsou stabilní: průměr 1,53 a 1,69 ms v testu,
1,55–1,70 ms v sondách. Jednotlivá razítka mají odlehlé hodnoty (~0,02 ms, jednou 4,35 ms), průměr okna ne.

**Jak číst čísla.**
- Rezerva pod vsync stropem = větší z CPU a GPU času, protože CPU připravuje další snímek, zatímco GPU kreslí
  předchozí. CPU čas je 7,8–8,1 ms a GPU čas 1,5–1,7 ms, takže rozhoduje CPU a rezerva je ~8,6 ms ze 16,7.
- GPU čas jsou razítka zapsaná mimo render passy. Na Apple GPU (Metal, tile-based) proto berte číslo jako dolní odhad
  práce GPU, ne její přesnou cenu. Malý nárůst při 4× pixelech (1,6 → 2,1 ms) ukazuje stejným směrem. Nezávislý důkaz
  rezervy GPU je, že Vysoké drží 60 fps i ve 3840×2160.
- Kolik fps by hra měla bez stropu, z toho nevyplývá. Snímek omezuje i prezentace a kompozitor a sonda s odemčeným rAF
  (fáze 25) narazila na další strop ~120 Hz. Proto už tu není tvrzení „≈ 125 fps“.
- S `?gpuTiming=1` je CPU čas o ~1,2 ms vyšší (9,0 vs 7,8–8,1 ms) a snímek má ~46 draw callů navíc (925–1097 vs
  879–1075). Pravděpodobně jde o čtení razítek (`mapAsync`) a o jiný stav čerstvé hry v novém kontextu. Příčina se
  nezkoumala, protože test 6 hlídá jen GPU čas. Mez CPU času (12 ms) hlídá test 3 bez parametru.
- Vsync strop `fps ≥ 57` zůstává jako kontrola. GPU regresi (stíny, SSAO, bloom) teď zachytí i mez 5 ms, dřív jen pokles
  fps pod strop.
- Měří to jen Chromium s `--enable-unsafe-webgpu` (perf test). Běžný Chrome 153 nemá `GPUCommandEncoder.writeTimestamp`,
  Babylon pak hlásí 0 a `stats().gpuFrameMs` zůstane `null`. Ověřeno ve vizuální kontrole fáze 27.
