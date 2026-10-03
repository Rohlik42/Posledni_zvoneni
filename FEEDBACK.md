# FEEDBACK — zpětná vazba od člověka

## 2026-10-03 — boxroom po fázi 2 (pohyb)

- **Chůze je dobrá**, ovládání a pohyb neměnit.
- **Světlo se mění u zdi:** když se hráč přiblíží ke zdi, osvětlení zdi se změní, jako by hráč nesl vlastní světlo. Na pohledu nezávislá scéna nesmí takhle reagovat na pozici kamery.
  Podezření (ověř A/B snímky ze stejné pozice 0,5 m a 3 m od zdi): (1) SSAO2 s `radius: 2.0` / `totalStrength: 2.0` v `data/rendering.json` je na tuhle vzdálenost příliš silné a závislé na pohledu; (2) spekulární odlesky bodových světel na stěnách (StandardMaterial s výchozí bílou `specularColor` dělá „baterku“, která se hýbe s pohledem). Low-poly flat styl spekulár nepotřebuje. Oprav příčinu, ne jen tuhle scénu: platí pro všechny materiály a pro level.
