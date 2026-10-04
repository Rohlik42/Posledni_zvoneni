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
7,8 ms, tj. hra by dnes bez vsync stropu běžela kolem 125 fps a regrese o víc než ~55 % test zachytí, i když fps zůstanou
na 60. Assert `fps ≥ 57` zůstal jako kontrola stropu. GPU čas (`EngineInstrumentation.gpuFrameTimeCounter`) se
nepoužil: adapter `timestamp-query` umí, ale `EngineFactory` vytváří `WebGPUEngine` bez `enableAllFeatures`, takže
zařízení funkci nemá a `engine.getCaps().timerQuery` není nastavené; zapnout ji by měnilo vytváření enginu pro všechny
hráče kvůli testu. Hra je na tomto stroji omezená CPU (pozastavená = 60 fps už ve fázi 21), proto rozhoduje CPU čas. Odemčení rAF (`--disable-frame-rate-limit
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
