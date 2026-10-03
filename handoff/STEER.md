# STEER — instrukce operátora (čti před každou akcí, mají přednost před seedem)

1. **Výběr dávky:** když `handoff/STATE.json` nemá `continueWith`, **negroomuj**, dokud v tabulce „Rozvrh a ověřování“ v PLAN.md existuje řádek s fázemi bez bloku `**Done`. Vezmi první takový řádek a postav z něj `continueWith`: base args z `.claude/nightshift.json`, `serial` a `parallel` přesně podle tabulky, porty od `portBase` nahoru, unikátní. Fáze ze starších řádků, které nejsou Done, dej na začátek `serial`.
2. **Testy fáze:** v sekci fáze najdi řádek „Quick gate:“. Když uvádí soubory, nastav `phases[id].tests = ["npm run typecheck", "npm run test:data && npx playwright test tests/smoke <soubory oddělené mezerou>"]`. Když říká „výchozí“, `tests` nenastavuj.
3. **FEEDBACK.md:** když existuje a nemá na konci řádek „Zapracováno <datum>“, napiš před výběrem dávky sám novou sekci `## Phase F<n> — FEEDBACK <datum>` v plánovém formátu (Implement / Verification / Do not, body z FEEDBACK.md) a dej ji na začátek `serial`. Po merge do FEEDBACK.md připiš „Zapracováno <datum>“.
4. Groom (podle seedu) spusť až ve chvíli, kdy jsou všechny fáze z tabulky Done.
5. **Rychlost:** neověřuj nad rámec quick gate a shift gate. Žádné další běhy plné sady, žádná videa, fps jen ve fázích 21 a 24. Po směně 2 a 5 nečekej na člověka a pokračuj.
6. Nikdy nepushuj.
