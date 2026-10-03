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
