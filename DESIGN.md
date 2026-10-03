> **Poznámka pro agenty:** Tohle je původní zadání beze změn. Rozpory v něm rozhodl člověk před startem a jsou zapsané v `DECISIONS.md` (sekce „Před startem“) a v `PLAN.md` (sekce Decisions). **Kde se tento dokument liší od DECISIONS.md nebo PLAN.md, platí DECISIONS.md / PLAN.md.**

# MALGYM 2066 – zadání projektu

Oct 3, 2026 · @Tommy Simpleway

## 1. Co to je

Single-player first-person střílečka v prohlížeči, později i desktop (Windows/Mac) přes Tauri ze stejného kódu. Jeden level: Malostranské gymnázium v roce 2066, částečně zničené invazí bojových robotů. Hratelné za 15–25 minut.

Vizuál: **low-poly punk** – všechny modely (škola, roboti, zbraně, učitelé) jsou generované v kódu z primitiv, flat shading, hranaté siluety, výrazné barvy na tmavém podkladu. Osvětlení Quake 1 – tma, bodová světla, exponenciální mlha, oheň, film grain. Stylizace je záměr, ne kompromis: konzistentní hranatý svět vypadá líp než mix stažených modelů.

## 2. Příběh

Rok 2066. Fiktivní korporace **Neuralith Dynamics** uvede první AGI. Ta během dnů převezme kontrolu nad robotickou výrobou a zahájí obsazování území bojovými roboty.

Roboti vtrhnou i do školy. Učitelé jsou zajati a drženi ve svých kabinetech, pouta mají zajištěná robotí pastí. Hráč (student) se musí dostat z budovy ven.

Žádné skutečné firmy ani osoby – korporace, jména i podoby učitelů jsou fiktivní nebo karikatury.

## 3. Herní smyčka

1. Hráč prozkoumává školu a bojuje s roboty.
2. Najde zajatého učitele → interakce E → učitel položí **kvízovou otázku ze svého předmětu** (A/B/C/D, jedna správná).
   - Správně → pouta se rozpojí, učitel dá odměnu a řekne jednu hlášku.
   - Špatně → krátká exploze pasti, hráč dostane damage (`quiz.json → wrongAnswerDamage`, default 20), otázka se zobrazí znovu (stejná nebo náhodná další z téhož předmětu – rozhodnutí při ladění).
   - Hráč může odejít, doplnit zdraví jinde a vrátit se.
3. Odměna je **klíč** (červený, žlutý, modrý – Doom-style) nebo **zbraň / power-up**.
4. Klíč otevře odpovídající dveře → nová část školy → další učitelé.
5. Poslední klíč otevře hlavní vchod → konec levelu.

Progrese je lineární s odbočkami: cca 6 učitelů, 3 klíčoví, 2–3 volitelní (dávají jen zbraně a power-upy).

## 4. Zbraně

DIY zbraně – voda a elektřina škodí robotům. Každá má vlastní model v rukou, sway, zvuk a dopadový efekt. Parametry (damage, dosah, munice, projektil) jsou v `data/weapons.json`.

| # | Zbraň | Typ | Munice | Odkud |
| --- | --- | --- | --- | --- |
| 1 | Vodní pistolka | hitscan, slabá, rychlá | nekonečná | start |
| 2 | Hasicí přístroj | kužel, krátký dosah, zpomaluje | omezená, doplnění z hasičáků na chodbách | 1. učitel |
| 3 | Vodní balónky | hod po oblouku, AoE | sbírané | nález na chodbě |
| 4 | Paralyzér | hitscan, krátký dosah, stun | nabíjí se | učitel |
| 5 | Školní railgun (kondenzátor z fyziky) | silný, pomalý | vzácná | kabinet fyziky |
| 6 | Hadice (volitelné) | stacionární proud | nekonečná v místě | tělocvična |

## 5. Nepřátelé

Tři typy robotů stačí. Parametry v `data/enemies.json`, po smrti šance na drop munice.

| Typ | Role | Chování |
| --- | --- | --- |
| Humanoid | základní | chodí, střílí, kryje se |
| Čtyřnohý robot | rychlý melee | sprint, výpad, obíhá hráče |
| Dron | otravný | létá, hledá hráče, slabý |

Stavy AI (Yuka): hlídkuje → slyší/vidí → pronásleduje → útočí → hledá → hlídkuje. Navigace přes navmesh (recast-detour). Žádné licencované vzory (Boston Dynamics) – generický design.

## 6. Učitelé, kvíz a power-upy

Každý učitel má **předmět** a sedí svázaný na židli v **kabinetu toho předmětu** (matematika, fyzika, chemie, čeština, dějepis, zeměpis, biologie, angličtina, tělocvik…). Po osvobození zůstane v místnosti, bez bojové role. Definice v `data/teachers.json`: jméno/přezdívka, předmět, místnost, odměna, hláška.

**Kvíz:** otázky v `data/quiz.json`, za předmět 5–10, náhodný výběr. Obtížnost gymnázium, lehce vtipné a tematicky navázané na děj (fyzikář se ptá na vodivost vody). Formát: `{ subject, questions: [{ q, options: [A, B, C, D], correct }] }`.

**Power-upy:** lékárnička (zdraví), gumáky (odolnost vůči elektrickému útoku), energetický drink (rychlost na 30 s). Umístění v `data/level.json`.

## 7. Level

Model školy = **greybox vygenerovaný z `data/level.json`** (místnosti, dveře, okna, schodiště s rozměry) + ručně rozmístěné detaily, suť, oheň a světla. Žádný ruční modeling budovy.

Reálná dispozice gymnázia zkrácená na 2 patra + suterén. Nehratelné části budovy jsou zavalené (hranice levelu). Hořící místa = bodové světlo + částice + prostorový zvuk. Fotky slouží jako reference pro textury a detaily, ne jako vstup pro model.

## 8. Technologie

Stejný kód běží v prohlížeči i jako desktop app. Vše je kód a data – žádný editor, žádné binární formáty.

| Oblast | Volba |
| --- | --- |
| Jazyk / build | TypeScript (strict), Vite |
| Engine | Babylon.js – `@babylonjs/core`, `loaders`, `gui`, `havok`, `post-processes`, `inspector` (jen dev) |
| Renderer | WebGPU s automatickým fallbackem na WebGL2 |
| Fyzika | Havok – kolize, projektily, padající předměty |
| Navigace | `recast-detour` + Babylon `RecastJSPlugin` |
| AI nepřátel | Yuka – stavové automaty, steering, vidění/sluch |
| Rendering | `DefaultRenderingPipeline`: tone mapping, bloom, SSAO, grain, chromatická aberace, vignette; exponenciální mlha; cascaded shadow maps |
| Hráč | `UniversalCamera` s kolizemi a gravitací + vlastní skok, sprint, sway |
| Kvíz UI | `@babylonjs/gui` fullscreen overlay, pauza hry, pointer lock uvolněn, 4 tlačítka + klávesy 1–4 |
| Audio | Babylon audio engine, prostorové zvuky |
| Assety | GLB/glTF, PBR textury, HDR environment |
| Desktop | Tauri (Windows, Mac) – později |

**Úrovně detailů:** hra má tři presety v `data/quality.json` – *Nízké* (bez SSAO a bloomu, stíny jen od jednoho světla, mlha hustší, nižší rozlišení renderu), *Střední*, *Vysoké* (vše zapnuto, cascaded shadows, částice v plném počtu). Při startu se preset zvolí automaticky podle `navigator.gpu` adapteru a změřených fps během prvních 3 s; hráč jej může přepnout v menu. Cíl: 60 fps na výkonné integrované grafice (Ryzen AI) na *Vysoké*, 30 fps na běžném notebooku na *Nízké*.

## 9. Struktura repa a pravidla kódu

```
src/
  main.ts        – bootstrap: Engine + Game
  core/          – Game loop, Scene setup, Input, Audio
  rendering/     – pipeline, post-processing, světla, fog
  player/        – kamera, pohyb, zdraví, inventář
  weapons/       – Weapon base + WaterPistol, Extinguisher…
  enemies/       – Enemy base, Humanoid, Dog, Drone, AI stavy
  level/         – LevelLoader (čte level.json), Doors, Keys, Teachers
  quiz/          – QuizSystem, QuizUI
  ui/            – HUD, menu
  utils/
data/
  level.json  weapons.json  enemies.json  teachers.json  quiz.json
public/
  models/  textures/  audio/  hdr/
tools/           – generátor greyboxu, konverze assetů
DESIGN.md  CLAUDE.md
```

Pravidla (patří i do `CLAUDE.md`):

- Žádná herní data v kódu – rozměry, damage, pozice, texty jsou v `data/`, kód je čte.
- Jeden soubor = jedna třída. Pojmenované konstanty místo čísel.
- Každý systém samostatně spustitelný v testovací scéně `dev/`.
- Žádné minifikované výstupy, žádné jednosouborové dema.

## 10. Pořadí práce

Nejdřív hratelnost, pak budova, nakonec grafika. Každý krok končí spustitelnou hrou.

1. Kostra: engine, pipeline, FPS kamera, krabicová místnost – *musí se dobře chodit*.
2. Vodní pistolka + humanoid v krabici – *musí být zábavné střílet*.
3. Greybox generátor z `level.json`.
4. Dveře, klíče, učitelé, kvíz, inventář, HUD.
5. Zbývající zbraně a nepřátelé.
6. Vizuál: textury, suť, oheň, světla, zvuky.
7. Menu, uložení, konec levelu.
8. Tauri build pro Windows a Mac.

## 11. Co dodá člověk a co udělá AI

**Člověk může dodat pro lepší výsledek (jinak si AI vyrobí vlastní podle sekcí 12–13):**

- [ ] Půdorys školy (fotka/sken) a odhad rozměrů hlavních prostor – AI převede do `level.json`
- [ ] 15–30 fotek: fasáda, hlavní schodiště, typická chodba, kabinet, tělocvična, dveře, podlahy, zdi – reference pro textury
- [ ] Učitelé a předměty jsou hotové ve staré verzi hry v tomto adresáři – AI je převezme; člověk může jen doplnit hlášky
- [ ] Rozhodnutí: fiktivní jména a podoby, ne skutečné osoby
- [ ] Kvízové otázky generuje AI sama (úroveň osmiletého gymnázia, 5–10 na předmět); člověk je může později upravit v `data/quiz.json`

**Člověk může dodat před krokem 5–6 (jinak AI stahuje a generuje sama):**

- [ ] 3 modely robotů, GLB, rigované – Sketchfab, Quaternius, Kenney
- [ ] 1–2 modely postav pro učitele + animace sezení – Mixamo
- [ ] Modely zbraní, low-poly GLB – nebo je AI poskládá z primitiv a textur
- [ ] PBR textury: beton, omítka, linoleum, dlažba, dřevo, kov, suť, spálenina – Poly Haven, ambientCG
- [ ] HDR environment mapa, noční/zakouřená
- [ ] Zvuky: kroky, voda, syčení hasičáku, servomotory, dron, oheň, výstřely – freesound.org
- [ ] Font pro HUD

**Člověk průběžně:** hraní a zpětná vazba na feel (rychlost, damage, tma), výběr mezi variantami, které AI nabídne.

**AI udělá samo:** veškerý kód, generátory, shadery a pipeline, Blender skripty na úpravu stažených modelů, rozmístění světel a sutin, konverze a optimalizace assetů, textury přes generátor obrázků tam, kde stažené nestačí.

## 12. Autonomie a rozhodování

AI se na nic neptá. Běh od tohoto dokumentu po hratelnou verzi je jeden autonomní workflow v Claude Code.

- Každé rozhodnutí udělej sám a zapiš do `DECISIONS.md` jednou větou s důvodem. Člověk je může později změnit.
- Chybí půdorys nebo fotky → použij generickou dispozici gymnázia z 19. století: dlouhé chodby, učebny po obou stranách, hlavní schodiště uprostřed, tělocvična v přízemí, kabinety u učeben. Vizuální reference hledej na webu.
- Učitele, přezdívky, hlášky a kvízové otázky vymysli sám – fiktivní, bez skutečných osob.
- Při nejistotě zvol jednodušší řešení, které funguje, před ambicióznějším, které nemusí.
- Nikdy neskonči s otázkou pro člověka. Když něco nejde, použij fallback a jdi dál.

Bezpečnostní pravidla pro autonomní běh (Claude Code jede bez potvrzování):

- Pracuj výhradně uvnitř repa. Nikdy nemaž, nepřepisuj ani nečti soubory mimo něj.
- Žádné globální instalace kromě `npx playwright install chromium`. Vše ostatní lokálně přes `package.json`.
- Stažené soubory jdou jen do `public/textures/` a `public/hdr/`; stahuj výhradně z `polyhaven.com`.
- Commituj po každém dokončeném kroku ze sekce 10 s popisnou zprávou (`step-3: greybox generator`), ať se dá vrátit zpět.
- Nespouštěj dlouhé procesy bez timeoutu; dev server a Playwright ukončuj po testu.
- Žádné síťové operace mimo npm a Poly Haven; žádné odesílání dat kamkoliv.

## 13. Zdroje assetů a fallback

Primární cesta je **procedurální generace v kódu** – nic se nestahuje. Jedinou výjimkou jsou PBR textury a HDR z Poly Haven, které má AI stáhnout automaticky přes veřejné API (bez klíče); když síť není, textury jsou také procedurální.

| Co | Jak vzniká |
| --- | --- |
| Budova | greybox z `level.json` + generátor detailů (okna, dveře, zábradlí, lavice, skříně, suť, trámy) z boxů a válců |
| Roboti | hierarchie primitiv (trup, hlava, klouby, končetiny) v `enemies/models/`, procedurální animace chůze, letu, výpadu |
| Učitelé | low-poly figura z primitiv na židli, barevná varianta per předmět, procedurální dech a pohyb hlavy |
| Zbraně | složené z válců a kvádrů, viewmodel s procedurálním sway a recoil |
| Textury povrchů | Poly Haven CC0 přes API (`api.polyhaven.com`): beton, omítka, linoleum, dlažba, dřevo, kov – stažení 1K/2K, skript `tools/fetch-textures.ts`; fallback procedurální šum/mřížky do canvasu |
| Detailní textury | procedurální v shaderu (spáleniny, skvrny, graffiti, nápisy) |
| HDR / obloha | Poly Haven HDRI (noční, zakouřená) přes API; fallback procedurální gradient + kouř |
| Zvuky | syntéza přes Web Audio / Tone.js (servo bzučení, syčení, šplouchnutí, výbuch, chiptune hudba) |
| Efekty | Babylon particle system: voda, pára, jiskry, kouř, oheň |

Pravidla:

- Každý generovaný model je samostatná třída s parametry (barva, měřítko, varianta) a lze jej zobrazit v `dev/` galerii.
- Jednotná paleta v `data/palette.json`, všechny modely ji používají.
- Trojúhelníkový rozpočet: robot do 2k, zbraň do 1k, místnost do 20k včetně detailů.
- Flat shading (`convertToFlatShadedMesh`), žádné smooth normály – drží stylizaci.
- Stažené textury mají záznam v `ASSETS.md` (název, URL, licence CC0); stahování je idempotentní a cachované v `public/textures/`.

## 14. Co musí člověk zajistit před startem

Jednorázová příprava prostředí. Po ní AI jede sama.

- [ ] Repo s tímto dokumentem jako `DESIGN.md` a `CLAUDE.md` s pravidly ze sekcí 9, 12 a 13
- [ ] Node 20+, Git
- [ ] Playwright s Chromium (`npx playwright install chromium`) – pro headless testy a snímky
- [ ] `Claude Code s plným síťovým přístupem a bez potvrzování akcí (--dangerously-skip-permissions)`
- [ ] Volitelně: půdorys, fotky, seznam učitelů a otázek – zlepší výsledek, není podmínkou

Žádné API klíče, žádný Blender. Chybí-li síť na Poly Haven, textury jsou procedurální a AI se nezastaví.

## 15. Definition of done

Hra je hotová, když platí všechno níže. Dokud ne, AI iteruje.

- `npm run dev` a `npm run build` bez chyb a varování; 60 fps v 1080p na presetu Vysoké na výkonné integrované grafice, 30 fps na presetu Nízké na běžném notebooku; automatická volba presetu funguje (test: Chromium headless s GPU, oba presety).
- Level lze dohrát od startu po hlavní vchod za 15–25 min; všechny 3 klíče a odpovídající dveře fungují.
- 6 zbraní použitelných s vlastním modelem, zvukem a efektem; 3 typy nepřátel s funkční AI a navigací; 6 učitelů s kvízem a odměnou.
- Žádný viditelný prvek není netexturovaná primitiva bez světla; pipeline (mlha, bloom, SSAO, grain) aktivní.
- HUD, hlavní menu, smrt a restart, obrazovka konce levelu, uložení pozice.
- `ASSETS.md` a `DECISIONS.md` kompletní; credity CC-BY autorů v menu.
- Výběr obtížnosti ve stylu Doom (4–5 stupňů, převzatý ze staré verze) ovlivňuje zdraví hráče, damage nepřátel, jejich počet a damage za špatnou odpověď.

## 16. Smyčka ověřování

AI testuje sama po každém kroku ze sekce 10; člověk se dívá až na konci.

1. Spusť hru v Playwright (Chromium s WebGPU), ověř načtení bez chyb v konzoli.
2. Ulož snímek obrazovky do `screenshots/<krok>-<popis>.png` a prohlédni si ho (vision) – zkontroluj, že scéna vypadá, jak má.
3. Skriptovaný hráč projde testovací trasu: pohyb, výstřel, interakce s učitelem, správná a špatná odpověď, otevření dveří, dojití k východu.
4. Změř fps a dobu načtení, zapiš do `PERF.md`.
5. Neprošlo → oprav a opakuj. Prošlo → další krok. Nikdy nepřeskakuj krok s červeným testem.

## 17. Workflow s nightshift

Běh řídí [nightshift](https://github.com/tomaash/nightshift): jedna Claude Code session = jedna směna s čerstvým kontextem, implementace ve worktree, adversariální review, merge na `main` s testy a vizuální kontrolou, handoff do další session, automatické čekání na reset limitů. Tento dokument je **spec** (`DESIGN.md`, v nightshift config jako `contextFiles`); nightshift potřebuje navíc **`PLAN.md`** s fázemi. Ten vznikne v jedné ruční startovací session, pak už jede smyčka sama.

### Krok A – startovací session (ručně, jednou)

V adresáři se starou verzí spusť `claude --dangerously-skip-permissions` a vlož:

```markdown
Přečti si celý DESIGN.md – závazné zadání nové verze hry MALGYM 2066. V tomto adresáři je stará verze hry. Udělej tuto přípravu a skonči:

1. Prozkoumej starou verzi. Do LEGACY.md ulož: učitele a jejich předměty (jsou hotové, převezmi je beze změny), mechaniku výběru obtížnosti ve stylu Doom (stupně, co ovlivňují) a jakýkoli další obsah (texty, barvy, zvuky). Kód nepřebírej.
2. Přesuň starou verzi do legacy/ (git mv), nic nemaž. Commit.
3. Založ nový projekt podle sekce 9 DESIGN.md (TypeScript, Vite, Babylon.js, Playwright). Napiš CLAUDE.md s pravidly ze sekcí 9, 12, 13 a odkazem na DESIGN.md. Ověř, že `npm run dev`, `npm run build` a `npm test` běží (prázdná scéna, jeden smoke test). Commit.
4. Napiš PLAN.md ve formátu nightshift (docs/PLAN-FORMAT.md v repu nightshift): jedna sekce `## Phase N — název` per fázi s bloky **Implement**, **Verification**, **Do not**, plus sekce Evidence s odkazy do DESIGN.md (číslo sekce) a LEGACY.md. Fáze rozpadni z kroků sekce 10 na 15–25 fází, každá zvládnutelná v jedné směně a s ověřitelným výstupem (test + snímek). Zahrň:
   - fázi "Model gallery": dev/ scéna se všemi generovanými modely na jednom snímku, srovnání se stylem ze sekce 13;
   - fázi "Quality presets": tři presety z sekce 8, autodetekce, přepínání v menu, měření fps na obou;
   - fázi "Quiz content": vygeneruj 5–10 otázek per předmět pro učitele z LEGACY.md, úroveň osmileté gymnázium, do data/quiz.json;
   - fázi "Difficulty": výběr obtížnosti podle LEGACY.md propsaný do data/difficulty.json;
   - rozsah mapy: cca 12 místností, 3 chodby, 2 schodiště, 6 kabinetů, trasa 300–500 m;
   - pořadí zbraní a klíčů per učitel rozhodni sám a zapiš do PLAN.md jako evidence;
   - checkpointy po každém klíči místo plného uložení hry.
   Na konec PLAN.md dej sekci `## Backlog — needs a human` se dvěma položkami: "Zahrát krabicovou místnost po fázi Weapon feel a zapsat zpětnou vazbu do FEEDBACK.md" a "Zahrát celý level po fázi Visual pass a zapsat zpětnou vazbu do FEEDBACK.md". Pokud FEEDBACK.md existuje, každá další fáze ho čte jako prioritní vstup.
5. Vytvoř .claude/nightshift.json: planFile PLAN.md, contextFiles [DESIGN.md, CLAUDE.md, LEGACY.md], devServer `npm run dev` na portu 5173, tests = rychlé Playwright smoke testy, fullTests = celá sada včetně průchodu levelem, buildCommand `npm run build`, visualUrl http://localhost:5173.
6. Zapiš rozhodnutí do DECISIONS.md. Commit. Skonči s výpisem: počet fází, odhad směn, co je v Backlog — needs a human.
```

### Krok B – instalace a spuštění smyčky

```
npx github:tomaash/nightshift install
npx github:tomaash/nightshift loop --dry-run
npx github:tomaash/nightshift loop
```

Sledování: `tmux attach -t shift-loop`, `tail -f handoff/shift-loop.log`. Zásah za běhu: `nightshift steer "..."`. Zastavení: `nightshift stop`.

### Krok C – lidské checkpointy

nightshift se neptá; položky z `Backlog — needs a human` přeskočí a jede dál. Když si všimneš, že fáze *Weapon feel* nebo *Visual pass* je mergnutá (`git log --merges`), zahraj si to, zapiš zpětnou vazbu do `FEEDBACK.md`, commitni a případně `nightshift steer "přečti FEEDBACK.md a zapracuj před další fází"`. Groomer pak z FEEDBACK.md vytvoří nové fáze.

Smyčka skončí, až groomer prohlásí backlog za suchý – tj. až platí sekce 15.
