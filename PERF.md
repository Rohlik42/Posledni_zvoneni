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
| Vysoké (vše zapnuto, stíny 2 světel), 1080p | 37 fps (vše zapnuto, stíny vždy) | **60 fps** (vsync strop), 1042 draw callů, 848 aktivních meshů |
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
