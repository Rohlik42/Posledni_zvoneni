# Poslední zvonění — Babylon.js

Skutečný 3D prohlížečový prototyp školního survivalu. Babylon.js 9.29.0 je uložen lokálně v `vendor/babylon.js`. Hra má 3D geometrii, volný pohled nahoru a dolů, viditelné tělo a nohy, osvětlení, stíny a míření pomocí 3D paprsku.

Spuštění: `node server.cjs`, potom http://127.0.0.1:4173. Lze také otevřít `index.html` v desktopovém prohlížeči s WebGL. Samotná hra nepotřebuje internet; volitelný font má lokální náhradu.

- WASD: pohyb. Myš: rozhlížení ve všech směrech.
- Levé tlačítko: útok. 1–4 nebo kolečko: tužka, pero, nůžky, kružítko.
- Pravé tlačítko: svačina (+50) nebo pití (+30), podle chybějících životů a zásob. Plné zdraví nespotřebuje zásoby.
- Mezerník: skok. Levý nebo pravý Ctrl: sprint. Escape: pauza.
- Pokud prohlížeč odmítne uzamčení kurzoru, hra přejde na rozhlížení pohybem běžného kurzoru. Pro neomezené otáčení použij samostatnou kartu v Chrome nebo Edge.

Hráč má maximálně 150 životů. Známky 1–5 způsobují 10–50 poškození, poznámka 100. Učitelé útok oznámí vykřičníkem; poznámku také textovým upozorněním. Zásah krátce zatřese kamerou a zčervená okraje obrazovky.

Po odeslání všech učitelů do sborovny začíná další den. Učitelé postupně sílí a přibývají. Denně dostaneš jednu svačinu a pití; další zásoby leží ve škole. Učitelé hledají cestu mezi místnostmi po mřížce, na složitější obcházení nábytku lze jejich AI dále rozšířit.

Engine: https://www.babylonjs.com/ (Apache-2.0). Verze je zaznamenaná v `vendor/version.txt` a licence v `vendor/LICENSE.md`.
