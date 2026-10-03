# STEER — instrukce operátora (čti před každou akcí, mají přednost před seedem)

1. **Výběr dávky:** když `handoff/STATE.json` nemá `continueWith`, **negroomuj**, dokud v tabulce „Rozvrh a ověřování“ v PLAN.md existuje řádek s fázemi bez bloku `**Done`. Vezmi první takový řádek a postav z něj `continueWith` (base args z `.claude/nightshift.json`, `serial` a `parallel` přesně podle tabulky, porty od `portBase` nahoru). Každé fázi dej `phases[id].tests = ["npm run typecheck", "npm test", "npx playwright test <spec>"]`, kde `<spec>` je soubor z řádku „Quick gate:“ v její sekci. Když tam stojí „výchozí“, nech jen první dvě položky. Fáze ze starších řádků, které nejsou Done, přidej do `serial` na začátek.
2. Groom spusť až ve chvíli, kdy jsou všechny fáze z tabulky Done. Pak platí seed.
3. **Rychlost:** neověřuj nad rámec quick gate a shift gate. Žádné další běhy plné sady, žádná videa, fps jen ve fázích 21 a 24.
4. Po směně 2 (Weapon feel) a směně 5 (Visual pass) pokračuj dál. Člověk hraje mezitím a výsledek zapíše do FEEDBACK.md. Pokud FEEDBACK.md existuje a nemá záznam „zapracováno“, další směna začne fází, kterou z něj vytvoří groomer, a ta jde v `serial` první.
5. Nikdy nepushuj.
