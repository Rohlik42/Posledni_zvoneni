# Poslední zvonění — Babylon.js

Skutečný 3D prohlížečový prototyp školního survivalu. Babylon.js 9.29.0 je uložen lokálně v `vendor/babylon.js`. Hra má 3D geometrii, volný pohled nahoru a dolů, viditelné tělo a nohy, osvětlení, stíny a míření pomocí 3D paprsku.

Spuštění: `node server.cjs`, potom http://127.0.0.1:4173. Lze také otevřít `index.html` v desktopovém prohlížeči s WebGL. Samotná hra nepotřebuje internet; volitelný font má lokální náhradu.

- WASD: pohyb. Myš: rozhlížení ve všech směrech.
- Levé tlačítko: útok. 1–4 nebo kolečko: tužka, pero, nůžky, kružítko.
- Pravé tlačítko: svačina (+50) nebo pití (+30), podle chybějících životů a zásob. Plné zdraví nespotřebuje zásoby.
- Mezerník: skok. Levý nebo pravý Shift: sprint. Stisk kolečka myši: otevřít/zavřít blízké dveře. Escape: pauza.
- Pokud prohlížeč odmítne uzamčení kurzoru, hra přejde na rozhlížení pohybem běžného kurzoru. Pro neomezené otáčení použij samostatnou kartu v Chrome nebo Edge.

Hráč má maximálně 150 životů. Známky 2–5 způsobují základních 20–50 poškození, které násobí zvolená obtížnost. Dvojka je žlutá, trojka oranžová, čtyřka oranžovočervená a pětka červená. Letí jako velká čitelná čísla. Poznámka je samostatný fialový odznak s vykřičníkem a textem POZNÁMKA a aktuálním poškozením (základ je 100 DMG). Jedničky učitelé nehází. Učitelé útok oznámí vykřičníkem; poznámku také textovým upozorněním. Horizont zůstává vodorovný při každém směru pohledu. Zásah krátce posune kameru do stran bez jejího naklánění a zčervená okraje obrazovky.

Po odeslání všech učitelů do sborovny začíná další den. Učitelé postupně sílí a přibývají. Další zásoby najdeš pouze v jídelně; při přechodu dne se v jídelně obnoví, do inventáře se samy nepřidávají. Učitelé hledají cestu mezi místnostmi po mřížce, na složitější obcházení nábytku lze jejich AI dále rozšířit.

Engine: https://www.babylonjs.com/ (Apache-2.0). Verze je zaznamenaná v `vendor/version.txt` a licence v `vendor/LICENSE.md`.

## Cache na GitHub Pages

Odkazy v `index.html` používají `?v=<SHA-256 otisk obsahu>` pro herní skript, CSS i Babylon.js. Změněný soubor tak dostane novou URL; nezměněný může dál využívat cache. Funguje při běžném nasazení souborů z větve, bez vlastního serveru nebo buildu na Pages.

Spusť `node update-assets.cjs` po změně souborů a commitni také aktualizovaný `index.html`. V tomto checkoutu je automatické verzování při commitu zapnuté. Po klonování ho zapneš příkazem `git config core.hooksPath .githooks`. Hook potřebuje Node.js a úplně staged změny herního skriptu, stylů a HTML; částečné stagingy těchto souborů odmítne, aby se verze nezapsala pro jiný obsah než v commitu.

Samotné HTML může zůstat krátce v cache GitHub Pages. Pro okamžité načtení po dokončeném deployi použij Ctrl+F5 nebo otevři stránku s novým parametrem, například `?release=<commit>`. Již otevřená hra se během hraní sama nepřenačítá. Lokální server používá `Cache-Control: no-store`; na GitHub Pages tento lokální server neběží.

## Obtížnosti

Před startem vybíráš jednu z pěti obtížností v nabídce inspirované klasickými akčními hrami. Každá má vlastní původní SVG portrét a motto podle autorova návrhu; Ultrašprt místo motta ukazuje časově závislou Schrödingerovu rovnici. Výběr platí po celý pokus a po prohře jej lze změnit. Hráč má vždy 150 životů, stejnou rychlost i poškození zbraní.

| Obtížnost | Příchozí poškození | Odolnost učitelů | Rychlost učitelů | Prodlevy útoků | Učitelé navíc | Počáteční svačiny / pití | Denní nálezy v jídelně |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Mimino | 50 % | 65 % | 65 % | 150 % | −1 | 5 / 4 | 8 / 6 |
| Školáček | 75 % | 85 % | 80 % | 120 % | 0 | 4 / 3 | 7 / 5 |
| Záškoláček | 100 % | 100 % | 100 % | 100 % | 0 | 3 / 2 | 6 / 4 |
| Raubíř | 130 % | 125 % | 120 % | 80 % | +2 | 2 / 1 | 4 / 3 |
| Ultrašprt | 165 % | 150 % | 140 % | 65 % | +4 | 1 / 1 | 2 / 2 |

Záškoláček je výchozí obtížnost a zachovává původní vyvážení hry. Poškození se zaokrouhluje na celé životy. Odznak poznámky i legenda ukazují aktuální poškození podle obtížnosti.

## Zvuky, duchové a nové křídlo

Zvuky jsou vlastní syntetické efekty přes Web Audio: každá zbraň má odlišný zvuk, svačina křupe, pití bublá a na konci zazní krátké komické říhnutí. Zvuk se aktivuje kliknutím na start; M nebo tlačítko se zvukem jej vypne a zapne. Další efekty doprovázejí zásah, sebrání zásob, ducha a konec dne.

Poražený učitel se promění v průsvitného ducha s očima a vlnícím se pohybem. Už neútočí a nelze jej znovu zasáhnout. Odpluje chodbou ke dveřím sborovny a zmizí. Po posledním učiteli další den počká na odchod duchů.

Škola nyní zabírá 142,5 × 62,5 metru. Na severní straně hlavní chodby jsou učebny 101 Matematika, 102 Čeština, 103 Angličtina, 104 Zeměpis, 105 Dějepis, 106 Knihovna a sborovna. Na jižní straně jsou 201 Hudebka, 202 Výtvarka, 203 Tělocvična, velká jídelna se dvěma vstupy, 204 Fyzika a informatika, WC kluci a WC holky. Chodbu lemují skříňky mimo dveřní otvory.

Jídelna má 37,5 × 25 metrů, jídelní stoly, lavičky a výdejní pult. Je jediným místem nálezů jídla a pití. Počet denních nálezů a počátečních zásob určuje obtížnost podle tabulky výše. Učitelé se objevují pouze v učebně odpovídající svému předmětu; z otevřené učebny mohou hráče pronásledovat.

Dveře ovládá stisk kolečka myši z blízkosti do 3,5 metru a obrazovka ukazuje název místnosti i nápovědu. Zavřené dveře blokují chůzi, výhled pro útok a oba typy střel. Při novém pokusu jsou opět zavřené. Vstupní dveře jsou na západním konci hlavní chodby. Okna jsou skutečné otvory se sklem na severní a jižní vnější stěně, za nimi jsou školní pozemky a stromy; sklo zastaví střely. Učitelé ověřují přímou viditelnost při přípravě i provedení útoku, letící známky kontrolují celý úsek pohybu proti překážkám. Zdi, zavřené dveře i nábytek je zastaví. Pevná geometrie je sloučena podle materiálu pro rychlejší vykreslení.

## Házení předmětů

Tužka, pero a kružítko jsou viditelné 3D předměty, které se házejí ve směru míření. Poškození způsobují až po dopadu; mají mírný pokles gravitací a zastaví je stěny, podlaha, strop i hlavní nábytek. Kružítko se za letu přetáčí. Nůžky zůstávají na blízko a při útoku zavírají a otevírají čepele. Hod doprovází svištění, dopad krátké klepnutí a nůžky kovové cvaknutí. Po hodu se další předmět objeví v ruce po skončení prodlevy útoku; prototyp má neomezenou zásobu předmětů z penálu.

## Jména učitelů

Nad učiteli je cedulka s bílým příjmením a druhým řádkem s předmětem, která se vždy natáčí k hráči. Seznam: Šiklová — Matematika; Komoň — Čeština; Underlová — Angličtina; Lambertová — Zeměpis; Taušl — Tělocvik; Doležalová — Dějepis; Ditrichová — Hudebka; Novotná — Výtvarka. Učitelé se přidávají s dalšími dny jako dosud; při větším počtu se seznam opakuje. Cedulka doprovází také ducha a zmizí, když dorazí ke sborovně.

Otáčení kolečkem nadále přepíná zbraně; stisk kolečka ovládá dveře. Úvodní menu obsahuje rozvedený příběh a úplný přehled ovládání ve sbalitelném panelu.
