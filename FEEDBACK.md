# FEEDBACK — zpětná vazba od člověka

## 2026-10-03 — boxroom po fázi 2 (pohyb)

- **Chůze je dobrá**, ovládání a pohyb neměnit.
- **Světlo se mění u zdi:** když se hráč přiblíží ke zdi, osvětlení zdi se změní, jako by hráč nesl vlastní světlo. Na pohledu nezávislá scéna nesmí takhle reagovat na pozici kamery.
  Podezření (ověř A/B snímky ze stejné pozice 0,5 m a 3 m od zdi): (1) SSAO2 s `radius: 2.0` / `totalStrength: 2.0` v `data/rendering.json` je na tuhle vzdálenost příliš silné a závislé na pohledu; (2) spekulární odlesky bodových světel na stěnách (StandardMaterial s výchozí bílou `specularColor` dělá „baterku“, která se hýbe s pohledem). Low-poly flat styl spekulár nepotřebuje. Oprav příčinu, ne jen tuhle scénu: platí pro všechny materiály a pro level.

Zapracováno 2026-10-03 (fáze 5: světlo u zdi)

## 2026-10-03 22:30 — robot + greybox levelu (po fázích 4 a 9)

- **Střelba do robota funguje dobře.** Chybí zaměřovač (řeší fáze 5, ověřit, že po merge je vidět ve všech scénách s hráčem včetně `?scene=level`).
- **Chůze školou OK.**
- **Výhled z oken (Praha) je moc malá textura a nenavazuje.** Nahradit jedním souvislým panoramatem kolem celé budovy → Phase F1.
- **Problikávání (z-fighting):** na spoustě míst jsou dvě plochy na stejném místě a blikají. Je potřeba systematicky najít a opravit → Phase F1.

Zapracováno 2026-10-03

## 2026-10-04 ráno — po celém běhu

- **Svislé pruhy ve výhledu z oken jsou problém** (`screenshots/24-game.png`).
- **Skybox měl být skutečná fotka Prahy**, ne silueta; to se po cestě ztratilo → Phase F2 (fotka z terasy školy s převodem den→noc, bez per-sloupcového zpracování).

Zapracováno 2026-10-04

## 2026-10-04 — fasády do skyboxu
- Pod linií střech je prázdná tma → doplnit fasády. Zapracováno 2026-10-04 (fasády Josefské a dvora z Matterportu, `tools/rectify-facades.ts` + `FacadeRing`).

## 2026-10-04 — ovládání bez tlačítek myši (touchpad) a cheaty

- **Všechny akce musí jít i na klávesnici:** na touchpadu předpokládáme myš bez tlačítek, takže střílení, otevírání dveří a další věci musí mít klávesu.
- **Cheaty jako v Doomu:** IDDQD (nesmrtelnost), IDKFA (všechny zbraně, náboje a klíče), IDCLIP (průchod zdmi).

Zapracováno 2026-10-04 (F střelba i držením, Q dveře, ] [ Tab zbraně, šipky rozhlížení, Enter myš do hry a pokračování, menu ↑↓←→ + Enter + Esc; cheaty IDDQD / IDKFA / IDCLIP; testy `keyboard-only.spec.ts` a `cheats.spec.ts`)

## 2026-10-04 — světelnost

- **„Pojďme trochu zvednout světelnost. Chci temnou atmosféru, ale ne aby v chodbách byla literally tma, na to se nedá koukat.“**

Zapracováno 2026-10-04 (chladný měsíční ambient, delší dosah lamp, slabší vinětace, mlha dál, zářivka při výpadku nezhasne úplně, 2 nová světla v boční chodbě a hale 2. patra, měsícem nasvícené fasády za okny; měření `tests/e2e/lighting.spec.ts`, snímky `screenshots/light-before-*` / `light-after-*`, čísla v DECISIONS „FEEDBACK 2026-10-04 — světelnost“)

## 2026-10-04 — vyvážení zbraní

- „Ještě zkusíme víc vyvážit zbraně. Pistolka je hodně silná vlastně oproti ostatním. Potřebujeme, aby ty ostatní byly upgrade a aby se s nimi fakt dalo trefit. Hasičák musí mít větší dostřel než pistolka. Nemusí být tolik spray, může to prostě fungovat jako silnější hadice s vodou — paprsek, co dostřelí dál a silněji než pistolka. Naproti tomu paralyzér může být více na blízko a s širším dosahem blesku. Railgun ‚nekonečný‘ dostřel.“

Zapracováno 2026-10-04 (pistolka slabší: TTK humanoida 1,0 → 1,5 s, dostřel 20 m; hasičák = proud vody na 34 m, 63 DPS; paralyzér 3,5 m, ale blesk v kuželu 80° na všechny; railgun do první zdi (300 m); hadice 24 m; tlustý proud a pomoc s mířením `aimAssistDeg`/`beamRadius`; tabulka před/po v DECISIONS.md, měření `weapons-balance.spec.ts` ve scéně `weapons-long`, testy `weapons-all.spec.ts`)

## 2026-10-04 — lidé jako opravdové modely

- „Roboti jsou dobří v současném low-poly, ale na lidi bych chtěl opravdový model, aby nebyli z kostiček.“ (schválen Quaternius „Ultimate Modular Men + Women“, CC0)

Zapracováno 2026-10-04 (učitelé jsou glTF postavy Quaternius, 8 modelů v `public/models/people/` zmenšených na 3,2 MB; svázaní na židli procedurální pózou z kostí, po osvobození vstanou, zamávají a stojí v klidové animaci; roboti, zbraně a rekvizity dál z primitiv; snímky `screenshots/people-seated.png`, `people-standing.png`, `people-gallery.png`, test `tests/e2e/people.spec.ts`, rozhodnutí v DECISIONS „FEEDBACK 2026-10-04 — Lidé jako opravdové modely“)

## 2026-10-04 — glTF lidé zpomalují, zpět na low-poly

- „Zdá se mi, že ty skutečné modely lidí dost zpomalují, lagne se to, když se blížím k nějakému. Můžeme na to udělat feature flag? Prosím vrátit zpět ty low poly, co tam byly, a tyhle nové umístit za přepínač.“

Zapracováno 2026-10-04 (učitelé jsou zase z kostiček jako dřív — `ProceduralTeacherModel`; glTF postavy jen s nastavením „Realistické postavy učitelů (experimentální, náročnější)“, výchozí vypnuto, platí od dalšího spuštění levelu, nebo `?people=gltf`; bez přepínače se nestáhne žádné `.glb` ani glTF loader; měření lagu a úroveň detailu pózy glTF učitelů v DECISIONS „Učitelé zase z kostiček, glTF lidé za přepínačem“; snímky `screenshots/teacher-lowpoly-seated.png`, `teacher-lowpoly-standing.png`, `settings-realistic-people.png`; testy `tests/e2e/people.spec.ts` v obou režimech)

## 2026-10-04 — domalovat panorama pod střechami
- „Připojil jsi spodní část fasády, ale k té horní vůbec nesedí… spíš horní část chytře doplnit pomocí image generation modelu.“ Zapracováno 2026-10-04 (Gemini Nano Banana 2 outpainting, `tools/outpaint-skyline.ts`).

## 2026-10-04 — výkon v souboji

- „Zkouším hrát na Ryzenu, který má velmi silnou grafiku, ale během souboje, když lítá hodně particles, tak se to dost laguje. Potřebujeme nastavení detailů? Nebo nějakou optimalizaci? Mělo by to běžet i na celkem hloupých počítačích, tak potřebujeme najít způsob, jak to zrychlit.“ Doplněno: na Windows + Chrome to laguje i na Nízké.

Zapracováno 2026-10-04 (příčinou nebyly částice, ale přepojování světel robotů při každé mokré skvrně a rozpadu robota a překlady shaderů za boje; opraveno `RoomLighting`, pevný počet světel pohyblivých věcí, zahřátí shaderů při načtení, střely robotů z bazénu; rozpočty efektů podle předvolby a „Automaticky přizpůsobit výkon“ v menu Kvalita; panel výkonu F3 / `?perf=1` s čísly k nahlášení; měření `tests/e2e/perf-combat.spec.ts`, čísla v PERF.md „Souboj“, rozhodnutí v DECISIONS „FEEDBACK 2026-10-04 — Výkon v souboji“)
## 2026-10-04 — šedá vrstva pod panoramatem, generovat přes Codex
- „Pod původním panoramatem je taková rozmazaná tenká šedá vrstva… je potřeba nejdřív oříznout nebo explicitně přegenerovat. Máme subscription do Codexu, ten umí generovat images.“ Zapracováno 2026-10-04 (Codex backend, maska 0,9° nad atikou, pás bez oparu od atiky + 0,6°).

## 2026-10-04 — zasekávání na Macu po optimalizaci výkonu

- „Když jsem hrál verzi před optimalizacemi, tak mi to na Macu jelo bez sekání. Teď se to občas sekne, jak se něco předpočítává. Asi by bylo lepší všechno, co dává smysl, napočítat on load, a ostatní on the fly, aby nebyly ty větší batche.“ (M1 Mac + Chrome, také Windows + Chrome na Ryzenu)

Zapracováno 2026-10-04 (příčinou na Vysoké byla výměna stínových map lamp při chůzi — Babylon při změně velikosti mapy přestavěl celý stínový generátor, 40–75 ms každé ~2 s v chodbách; teď se mění jen textura. Automatická volba kvality už nepřepíná předvolbu za hry (dřív 230–355 ms), měří a přepíná jen za menu, příběhem nebo pauzou. Automatické přizpůsobení výkonu za hry ubírá jen jiskry a cákance, snížení rozlišení je nová volba „Při zpomalení snížit i rozlišení“, výchozí vypnutá. Co jde předpočítat, se spočítá při načtení, zbytek za hry nejvýš 1,5 ms za snímek (`FrameBudget`); bazény efektů mají pevnou velikost. Na M1 teď žádný snímek nad 50 ms po prvních 3 s na trase ani v souboji (Vysoké i Střední, 720p i 1080p na Retina); panel F3 ukazuje nejdelší snímek za posledních 10 s a důvod posledního zaseknutí, aby šlo nahlásit i z Windows; test `tests/e2e/hitches.spec.ts`, čísla v PERF.md „Zasekávání na Macu“, rozhodnutí v DECISIONS „FEEDBACK 2026-10-04 — Zasekávání na Macu“)

## 2026-10-04 — railgun
- „Nabíjení z railgunu dáme pryč. Je to zajímavé, ale nedá se s tím hrát. Pojďme udělat normálně okamžitý výstřel a pak velkou cooldown jako v Quake 3… chvilku cooldown, rozumně.“ Zapracováno 2026-10-04 (okamžitý výstřel, prodleva 1,2 s, cívky ukazují připravenost).
- „Necháme ten railgun 1,5 a ty cívky hrozně svítí. Dej je tmavší i když jsou na max, a ať po výstřelu zhasne pořádně všechno. Nech svítit jenom tu cívku vepředu, další bloky u ruky ať nesvítí.“ Zapracováno 2026-10-04.
