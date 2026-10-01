# Poslední zvonění — Babylon.js

Skutečný 3D prohlížečový prototyp školního survivalu. Babylon.js 9.29.0 je uložen lokálně v `vendor/babylon.js`. Hra má 3D geometrii, volný pohled nahoru a dolů, viditelné tělo a nohy, osvětlení, stíny a míření pomocí 3D paprsku.

Spuštění: `node server.cjs`, potom http://127.0.0.1:4173. Lze také otevřít `index.html` v desktopovém prohlížeči s WebGL. Samotná hra nepotřebuje internet; volitelný font má lokální náhradu.

- WASD: pohyb. Myš: rozhlížení ve všech směrech.
- Levé tlačítko: útok. 1–4 nebo kolečko: tužka, pero, nůžky, kružítko.
- Pravé tlačítko: svačina (+50) nebo pití (+30), podle chybějících životů a zásob. Plné zdraví nespotřebuje zásoby.
- Mezerník: skok. Levý nebo pravý Shift: sprint. Escape: pauza.
- Pokud prohlížeč odmítne uzamčení kurzoru, hra přejde na rozhlížení pohybem běžného kurzoru. Pro neomezené otáčení použij samostatnou kartu v Chrome nebo Edge.

Hráč má maximálně 150 životů. Známky 2–5 způsobují 20–50 poškození. Dvojka je žlutá, trojka oranžová, čtyřka oranžovočervená a pětka červená. Letí jako velká čitelná čísla. Poznámka je samostatný fialový odznak s vykřičníkem a textem POZNÁMKA / 100 DMG. Jedničky učitelé nehází. Učitelé útok oznámí vykřičníkem; poznámku také textovým upozorněním. Horizont zůstává vodorovný při každém směru pohledu. Zásah krátce posune kameru do stran bez jejího naklánění a zčervená okraje obrazovky.

Po odeslání všech učitelů do sborovny začíná další den. Učitelé postupně sílí a přibývají. Denně dostaneš jednu svačinu a pití; další zásoby leží ve škole. Učitelé hledají cestu mezi místnostmi po mřížce, na složitější obcházení nábytku lze jejich AI dále rozšířit.

Engine: https://www.babylonjs.com/ (Apache-2.0). Verze je zaznamenaná v `vendor/version.txt` a licence v `vendor/LICENSE.md`.

## Cache na GitHub Pages

Odkazy v `index.html` používají `?v=<SHA-256 otisk obsahu>` pro herní skript, CSS i Babylon.js. Změněný soubor tak dostane novou URL; nezměněný může dál využívat cache. Funguje při běžném nasazení souborů z větve, bez vlastního serveru nebo buildu na Pages.

Spusť `node update-assets.cjs` po změně souborů a commitni také aktualizovaný `index.html`. V tomto checkoutu je automatické verzování při commitu zapnuté. Po klonování ho zapneš příkazem `git config core.hooksPath .githooks`. Hook potřebuje Node.js a úplně staged změny herního skriptu, stylů a HTML; částečné stagingy těchto souborů odmítne, aby se verze nezapsala pro jiný obsah než v commitu.

Samotné HTML může zůstat krátce v cache GitHub Pages. Pro okamžité načtení po dokončeném deployi použij Ctrl+F5 nebo otevři stránku s novým parametrem, například `?release=<commit>`. Již otevřená hra se během hraní sama nepřenačítá. Lokální server používá `Cache-Control: no-store`; na GitHub Pages tento lokální server neběží.
