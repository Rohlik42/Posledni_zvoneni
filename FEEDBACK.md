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
