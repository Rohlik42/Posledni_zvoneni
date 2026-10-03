# Matterport reference – Malostranské gymnázium

Zdroj: veřejná 3D prohlídka https://my.matterport.com/show/?m=yiD42eykUPx (stažené 2026-10-03).
Slouží jako **reference** pro dispozici (`data/level.json`) a jako **zdroj fotek povrchů** pro textury.
Za běhu hry se odsud nic nenačítá napřímo; textury vznikají skriptem do `public/textures/` (viz PLAN.md).
Agent nemá k Matterportu síťový přístup – všechno potřebné je tady.

## Patra

Budova má 6 úrovní. Číslování = Matterport „Floor N“, stejné v `rooms.json` (`floor`) i v názvech souborů.

| Floor | Soubor | Co tam je (podle popisků) |
| --- | --- | --- |
| 1 | `floorplans/floor1_sklep.jpg` | sklepy, technické místnosti, schodiště |
| 2 | `floorplans/floor2_vstupni_podlazi.jpg` | HLAVNÍ VCHOD (z ulice Josefská, v půdorysu dole vlevo), bufet, tělocvična č.1 (velká, parkety), tělocvična č.2, boulder, šatny (pánská/dámská), učebna 10, 12, venkovní hřiště (dvůr) |
| 3 | `floorplans/floor3_prvni_patro.jpg` | ředitelna, sekretariát, zástupce ředitele, učebny 20, 21, 25, 26, 29a, 29b, kuchyňka |
| 4 | `floorplans/floor4_druhe_patro.jpg` | učebny 30–37 |
| 5 | `floorplans/floor5_treti_patro.jpg` | laboratoř, ateliéry 1–2, učebny 40–46 |
| 6 | `floorplans/floor6_podkrovi.jpg` | podkroví s trámy: knihovna, učebna 50, terasa s výhledem na Prahu |

`views/labels_floor2.jpg`, `labels_floor3.jpg` a `labels_floor6.jpg` jsou snímky z prohlídky s popisky místností. Podle nich přiřaď čísla v půdorysech ke jménům.
Čísla vepsaná v `floorplans/*.jpg` (1–83) jsou interní ID místností Matterportu, ne čísla učeben.

## Měřítko půdorysů

- `floorplans/*.jpg`: 4968 × 3043 px, ortografický pohled shora, **≈ 85 px = 1 m** (42 ppm × 4968/2455). Vlevo dole je měřítko 0–3 m, ověř ho.
- Všech 6 obrázků má **stejný výřez**, takže pixel (x, y) odpovídá stejnému místu na každém patře. Podle toho se zarovnají schodiště a nosné zdi.
- Výšky pater z kamer: Floor 2 ≈ −3.2 m, 3 ≈ 1.5 m, 4 ≈ 6.5 m, 5 ≈ 11.6 m, 6 ≈ 15.9 m (výška kamery, ne podlahy). Konstrukční výška patra je tedy **≈ 5 m**: vysoké stropy, budova z 19. století.
- Půdorys celé budovy je zhruba 55 × 25 m. Páteří je dlouhá chodba se šachovnicovou dlažbou (v půdorysu vodorovně). Z ní vedou nahoru dvě kratší křídla. Hlavní schodiště je u levého konce chodby, druhé uprostřed (orientace = jak je kreslí půdorys, ne světové strany).

## rooms.json

Pojmenované pohledy z prohlídky: `name`, `floor` a `camera` (pozice kamery v metrech v souřadnicích Matterportu, kde y je výška).
Pozice je **místo, kde stál fotograf**, ne střed místnosti. Ber ji jen jako hrubou orientaci (které patro, která strana budovy).
Osy: x v Matterportu zhruba odpovídá −x v půdorysu. Přesné mapování si při potřebě zkalibruj na dvou známých bodech (hlavní vchod, tělocvična č.1).

## Panoramata – zdroj textur

`panoramas/<místo>/{a,b,c,d}.jpg` jsou čtyři boční stěny krychlové mapy (1024², FOV 90°) a `down.jpg` je pohled kolmo dolů na podlahu.
Seznam míst je v `panoramas/index.json`. Nejužitečnější:

| Povrch | Kde vzít |
| --- | --- |
| šachovnicová dlažba chodeb | `floorplans/floor4_druhe_patro.jpg` (chodba, ortografická, přesné měřítko) nebo `chodba_*/down.jpg` |
| parkety tělocvičny + čáry hřiště | `floorplans/floor2_vstupni_podlazi.jpg` (tělocvična č.1), `telocvicna_parkety/` |
| dřevěný obklad stěn tělocvičny, žebřiny | `telocvicna_obklad/`, `telocvicna_parkety/` |
| linoleum učeben (oranžové / žluté / zelené) | půdorysy pater 3, 4 a 5, `ucebna_zelena/down.jpg` |
| bílá omítka, okna s kastlíky, radiátory | `chodba_dvere_okna/`, `chodba_kvetiny/` |
| masivní dřevěné dveře se zárubní | `chodba_dvere/`, `chodba_dvere_okna/`, `vstupni_hala/` |
| modré plechové skříňky | `satna_skrinky/`, `satna_skrinky2/` |
| litinové zábradlí, schody | `schodiste_litina/`, `schodiste_zabradli/` |
| trámy podkroví, knihovna | `podkrovi_tramy/`, `knihovna_podkrovi/` |
| laboratoř (fyzika/chemie) | `laborator_fyzika/`, `laborator_chemie/` |
| dlažba dvora, boulder stěna | `dvur_boulder/` |
| fasáda, ulice Josefská | `ulice_fasada/`, `views/fasada_vchod.jpg` |
| střechy Malé Strany (výhled z oken) | `terasa_vyhled/` |
| venkovní hřiště (červený povrch) | `hriste_venku/` |

Fotky mají zapečené osvětlení a perspektivu. Než z nich bude dlaždicová textura, je potřeba vyříznout rovný úsek, srovnat jas a udělat ji bezešvou (blend okrajů nebo mirror). Pro stylizaci low-poly punk je zmenši na 256–512 px a sniž počet barev.

## views/

Pohledy na celou budovu (dollhouse) shora a z boku, fasáda u vchodu a hudebna (učebna 31).

## Licence

Prohlídka patří škole / autorovi skenu. Používáme ji jen jako referenci a zdroj textur pro nekomerční školní projekt; záznam je v `ASSETS.md`.
Kdyby to škola nechtěla, `reference/` se smaže a textury se přegenerují procedurálně (fallback ze sekce 13 DESIGN.md).
