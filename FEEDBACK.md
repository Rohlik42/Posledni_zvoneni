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

Doplněno 2026-10-04: po změně předvolby, při prvním sebrání zbraně nebo při přechodu robota do místnosti s jiným počtem lamp se ještě dál překládaly shadery. Zahřátí shaderů teď za menu nebo pauzou postaví každou použitou variantu, i ze zbraní, které hráč ještě nemá. V boji se ve všech předvolbách, rozlišeních a i s CPU 4× nepřeloží nic (dřív 5–12 překladů a pipeline za 32 s boje po načtení nebo přepnutí). Stínová mapa lampy se po výměně kreslila bez testu hloubky, opraveno. Čísla v PERF.md „Překlady po přepnutí předvolby“, rozhodnutí v DECISIONS „Zahřátí shaderů pokrývá každou použitou variantu“.

## 2026-10-04 — railgun
- „Nabíjení z railgunu dáme pryč. Je to zajímavé, ale nedá se s tím hrát. Pojďme udělat normálně okamžitý výstřel a pak velkou cooldown jako v Quake 3… chvilku cooldown, rozumně.“ Zapracováno 2026-10-04 (okamžitý výstřel, prodleva 1,2 s, cívky ukazují připravenost).
- „Necháme ten railgun 1,5 a ty cívky hrozně svítí. Dej je tmavší i když jsou na max, a ať po výstřelu zhasne pořádně všechno. Nech svítit jenom tu cívku vepředu, další bloky u ruky ať nesvítí.“ Zapracováno 2026-10-04.

## 2026-10-04 — neviditelné dveře a šedivá budova zvenku

- „První schodiště nahoře má neviditelné dveře, které musím otevřít. Buď tam nemají být, nebo ať jsou vidět.“
- „Budova školy je zvenku šedivá, což je vidět pohledem z okna. Musíme aplikovat nějaké textury.“

Zapracováno 2026-10-04 (neviditelné byly červené dveře `d-f4-stair-mid` nahoře na prostředním schodišti a stejně tak žluté `d-f3-yellow`: dvoukřídlé dveře mají panty ve spáře mezi místnostmi a vyhledání místnosti je zařadilo do chodby vstupního podlaží o dvě patra níž, takže je ořezávání místností nikdy nevykreslilo, zatímco kolize zavřených dveří zůstala; `Level.roomAt` už nebere místnost, nad jejímž patrem bod leží; dveře zůstávají, protože jsou zámkem červeného klíče; test `tests/e2e/doors-visible.spec.ts` u všech dveří z obou stran, snímky `screenshots/door-stair-top-before.png` / `-after.png`. Fasáda: textury z fotek školy z Matterportu — omítka, pásová bosáž přízemí a sokl z kvádrů bosáže, kordonové římsy u každého patra, hlavní římsa a střecha, šambrány s parapetní a nadokenní římsou kolem venkovních oken, malovaná okna v řadách na prázdných stěnách a fasáda protažená k zemi pod místnostmi, pod kterými level nic nemá; dál svítí jen měsíc a záře města zespodu; `src/level/FacadeBuilder.ts`, test `tests/data/facade.test.ts`, snímky `screenshots/exterior-from-ucebna30-before.png` / `-after.png`, `exterior-from-fyzika-before.png` / `-after.png`, rozhodnutí v DECISIONS „FEEDBACK 2026-10-04 — Neviditelné dveře a fasáda školy“)
- „Ten railgun je zminimalizovaný trochu moc. Cívky měly být v celé přední části hlavně… mají tam být asi čtyři.“ Zapracováno 2026-10-04 (svítí všechny čtyři cívky na hlavni, během prodlevy se rozsvěcují postupně).

## 2026-10-04 — hasičák a balónky z chodby, BFG 9000 místo hadice

- „Hasičák a balónky chci, aby se dalo samo zvednout z chodby. To není zbraň, ale přímo ty náboje jsou to, co se použije… Učitelé ať dávají jenom speciální zbraně, jako je paralyzér a railgun. Hadici v tělocvičně zrušíme, ta je matoucí a k hasičáku nadbytečná. Chci tam ale mít BFG9000, to může dělat pěkný EMP pulz, co vykosí všechno v okolí a nabíjet se fakt dlouho. Může jet na stejné kondenzátory jako railgun… BFG jich bude potřebovat víc na jeden výstřel. Asi by ho mohl mít matikář… Zároveň ale potřebuju, aby byl k dispozici později než railgun.“
- Doplněno: BFG jako v Doomu — stisk ho roztočí (asi 1 s, výstřel přijde sám, i když hráč pustí), pak vyletí velká pomalá zářící plazmová koule a EMP vybuchne až v místě dopadu.

Zapracováno 2026-10-04 (hasičák leží na chodbě 2. patra hned za schodišťovou halou a dávají ho i nástěnné hasičáky; balíček balónků zbraň dá, když ji hráč nemá, jinak přidá balónky; učitelé dávají jen paralyzér, railgun, BFG 9000, klíče a power-upy; Šiklová (matematika) a Doležalová (dějepis) si vyměnily kabinety, BFG dává Šiklová na trase až po railgunu; hadice, hydrant, jejich modely a zvuk jsou pryč, slot 6 je BFG 9000: 1 s roztočení, plazmová koule 18 m/s, EMP 12 m kolem dopadu na stejném patře zničí každého robota i na Ultrašprt, roboti do 16 m ztuhnou, hráče nezraní, nabíjení 10 s i v pouzdře; kondenzátory jsou společná munice railgunu (1) a BFG (4), strop 12, v HUD „kond.“ a řádek nabíjení; efekty BFG jsou předpřipravené při načtení — první výstřel bez překladu shaderu, nejdelší snímek ~30 ms; snímky `screenshots/bfg-ready.png`, `bfg-spinup.png`, `bfg-ball-flying.png`, `bfg-explosion.png`, `bfg-recharging.png`, `pickup-extinguisher.png`; testy `tests/e2e/bfg.spec.ts`, `weapons-all.spec.ts`, `playthrough.spec.ts` (BFG vyčistí tělocvičnu), datové testy pořadí na trase; rozhodnutí v DECISIONS „FEEDBACK 2026-10-04 — BFG 9000, kondenzátory, hasičák a balónky z chodby“)

## 2026-10-04 — hasičák až v dalším patře, balónky od lidí

- „Ty balónky a hasicí přístroj jsou hned v první chodbě. Ať je hasičák až v dalším patře dole. Ať na prvním patře najde jenom první extra zbraň.“
- Doplněno: na 2. patře žádný nástěnný hasičák; náplně (kanystry) do hasičáku zrušit, hasičák doplňují jen hasičáky; „balónky od lidí a na chodbě, kondenzátory z robotů“.

Zapracováno 2026-10-04 (na startovním 2. patře je jediná extra zbraň vodní balónky: balíček na chodbě se posunul za kabinet zeměpisu (x 32), další leží v učebně 33 a balíček (+4) přidávají k power-upům Ditrichová, Lambertová a Novotná; hasicí přístroj leží až na chodbě 1. patra hned u prostředního schodiště, před prvním robotem i nástěnnými hasičáky; 2. patro nemá žádný nástěnný hasičák a nástěnné hasičáky jinde jen doplní nádržku, hasičák nedají; kanystry `ammo-extinguisher` i jejich model jsou pryč — munice jsou jen hasičák, balónky a kondenzátory; roboti pouštějí jen kondenzátory (humanoid 25 %, čtyřnožec a dron 15 %), strop zásoby 12 drží BFG pořád vzácné; snímky `screenshots/pickup-balloons-f4.png`, `pickup-extinguisher-f3.png`; testy `progression.test.ts` (nic, co dá hasičák, na 2. patře; hasičák poprvé v 1. patře; balónky ne do 10 m od startu), `doors-pickups.test.ts` (jen tři druhy munice, roboti jen kondenzátory), `playthrough.spec.ts`, `pickups-walk.spec.ts` (nástěnný hasičák bez hasičáku nic nedá), `doors-keys.spec.ts`; rozhodnutí v DECISIONS „FEEDBACK 2026-10-04 — Hasičák až v 1. patře, balónky od lidí a na chodbě, kondenzátory z robotů“)

## 2026-10-04 — sloty, přepnutí na novou zbraň, motto
- „Prohodíme balónky a hasičák, balónky jsou zbraň 2. Zároveň když poprvé sebereš novou zbraň, ať se to na ni přepne.“ Zapracováno 2026-10-04.
- „A Raubíř je ‚Nevyluzujte!‘ jako nevyluzujte zvuky.“ Zapracováno 2026-10-04.
- „Fyzikář se bude jmenovat Jungwirth.“ Zapracováno 2026-10-04.
- „Předěláme ty testy, dáme tam jenom 1 2 3 4, písmenka pryč, je to matoucí.“ Zapracováno 2026-10-04 (tlačítka kvízu jen s čísly 1–4).
- „BFG má vypadat nějak takhle (Sketchfab BFG 9000), předělej to.“ Zapracováno 2026-10-04.

## 2026-10-04 — textury vnitřních stěn
- „Všiml jsem si, že chybí textury na stěnách uvnitř budovy. Doplň je, kde to dává smysl, a také podle skutečné mapy, aby to zhruba sedělo, kde co je.“

Zapracováno 2026-10-04 (každá místnost má styl stěn v `data/interior.json` podle skutečné místnosti z Matterportu: chodby a schodišťové haly bílá omítka s krémovým olejovým soklem do 1,5 m a černým obkladem u podlahy, učebny 2. patra smrková lamperie, ostatní učebny krémové stěny se soklem, laboratoř (kabinet fyziky) bílý obklad, ateliér mátový obklad, ředitelna (kabinet češtiny) ořechová dýha, předpokoj ředitelny oranžový obklad, tělocvična lamperie do 2 m a nad ní bílé stěny místo dřeva až ke stropu, vstupní chodba a zádveří tmavé rámové obložení, šatna hrubá vápenná omítka, schodiště bílá omítka; 7 nových textur z fotek školy (`tools/matterport-textures.ts`); dveře, zárubně a okna beze změny; noční jas zůstal (`lighting.spec.ts`); snímky `screenshots/interior-<místnost>-before.png` / `-after.png`, test `tests/data/interior.test.ts` a `tests/e2e/interior.spec.ts`; mapování místností v DECISIONS „FEEDBACK 2026-10-04 — Textury vnitřních stěn podle skutečné školy“)

## 2026-10-04 — BFG se nabíjí jako v Doomu 3
- Návrh (schválený): držením spouště se BFG nabíjí po stupních, každý stupeň 1 s a jeden kondenzátor; čtyři zelená žebra předního bloku se rozsvěcují po jednom odzadu dopředu; když je kondenzátorů méně, nabíjení se zastaví na jejich počtu (zbylá žebra tmavá, cvaknutí, HUD např. „2/4“). Puštění vystřelí kouli síly n a vezme n kondenzátorů, EMP 6 / 9 / 12 / 15 m; puštění před první sekundou nic nestojí; žádné přebití; místo roztočení a 10s nabíjení jen 2s prodleva; kvílení stoupá po stupních, zbraň se víc chvěje, svit tlumený; HUD „NABÍJENÍ n/4“ a pruh prodlevy; F funguje stejně; přepnutí zbraně nabíjení zruší.

Zapracováno 2026-10-04 (stupně po 1 s, nejvýš min(4, kondenzátory v zásobě), puštění vystřelí kouli síly n za n kondenzátorů, EMP 6 / 9 / 12 / 15 m a ztuhnutí 10 / 13 / 16 / 19 m, koule větší a jasnější se stupněm; žebra rib1–rib4 se rozsvěcují po jednom (nabíjené roste během své sekundy), jádro a průduchy svítí s nabitím, plně nabité jemně pulzuje, po výstřelu tma; kvílení `bfgCharge1`–`4` stoupá po stupních, na stropu zásoby cvakne `bfgDeny`; HUD „NABÍJENÍ n/4“, se stropem „NABÍJENÍ 2/4 · MAX 2“, po výstřelu „CHLAZENÍ…“ s pruhem 2 s; BFG nemá vlastní zásobník, bere rovnou ze společných kondenzátorů (při předání +4); přepnutí zbraně nabíjení zruší; plné nabití: TTK 4,1 s, dostřel 87,8 m; první plně nabitý výstřel bez překladu shaderu, nejdelší snímek ~28 ms; snímky `screenshots/bfg-charge-1.png` … `bfg-charge-4.png`, `bfg-blast-4.png`, `bfg-charge-capped.png`, `bfg-ball-flying.png`, `bfg-ready.png`; testy `tests/e2e/bfg.spec.ts`, `weapons-all.spec.ts`, `weapons-balance.spec.ts`, `playthrough.spec.ts`, `keyboard-only.spec.ts`, `cheats.spec.ts`; rozhodnutí v DECISIONS „FEEDBACK 2026-10-04 — BFG 9000 se nabíjí jako v Doomu 3“)
- „Svítící pruhy i nahoře.“ Zapracováno 2026-10-04.

## 2026-10-04 — BFG velký, široký a bílý s obvody, chlazení 5 s
- „Podívej se, jak vypadá tradiční BFG v Doomovi. Je důležitý, aby bylo fakt velký. To znamená, je to široká zbraň. A vepředu je ta část s těma pruhama, tu můžeš klidně trošku natáhnout, aby se tam daly vidět nula až čtyři rozsvícené pruhy. Ale důležitý je, že ta zbraň je bílá a jsou na ní vidět ty různé komplikované obvody. Zkus ten vzhled předělat, aby to vypadalo víc takhle.“
- Doplněno: hlavní předloha je koncept „Classic BFG-9000“ z Doom Eternal (bílá, obvody, dobře čitelná i z boku), nabíjení musí být jasně vidět — čtyři zelené prvky se rozsvěcují po jednom.
- „Chlazení klidně 5 s, ty 2 jsou málo.“

Zapracováno 2026-10-04 (nový model z primitiv 940 trojúhelníků: široké teple bílé pouzdro s obvody — černý středový kanál, dvě bílé trubky se zelenými kapslemi (svítí s nabitím), mosazné kondenzátory, červené kontrolky a LED lišta, tmavé spoje, z boku spáry, červený LED panel a kulaté tlačítko; před ním bílý nabíjecí pás se čtyřmi žebry, která ho obepínají shora i po stranách a rozsvěcují se po jednom jasně zeleně (`neon.charge`), na zadní stěně pásu červené pruhy a měděná deska jako u Dooma 1993; vpředu černý žebrovaný blok ústí s jádrem; v ruce je zbraň uprostřed dole, přes polovinu šířky obrazu, mírně zvednutá, aby byla horní strana pásu a 0–4 pruhy vidět, zaměřovač volný; chlazení po výstřelu 5 s; snímky `screenshots/bfg-look-0.png`, `bfg-look-2.png`, `bfg-look-4.png`, `bfg-look-side.png`, `bfg-look-gallery.png`; testy `model-budget.spec.ts`, `bfg.spec.ts`, `weapons-all.spec.ts`, `weapons-balance.spec.ts`, `keyboard-only.spec.ts`, datový test chlazení 5 s; rozhodnutí v DECISIONS „FEEDBACK 2026-10-04 — BFG 9000 jako Classic BFG-9000, chlazení 5 s“)

## 2026-10-04 — BFG podle konceptu z boku
- „Předěláme BFG, ať je víc jako tahle (koncept BFG 9000 z boku), nabití stačí ukazovat bočními zelenými a bílými pruhy.“

Zapracováno 2026-10-04 (nový model z primitiv 940 trojúhelníků podle bočního pohledu konceptu: dlouhé stříbrošedé pouzdro se šedým bočním panelem, červeným LED panelem, kulatým tlačítkem s červeným prstencem a zadní sponou, nahoře mířidlový blok a dvě trubky přes celou délku s černým válcem mezi nimi, vespod rukojeť a přední rukojeť s rýhami ///, vzadu kostrová pažba; před pouzdrem bílý nabíjecí blok, z jehož boků vystupují čtyři žebra — zelené a bílé pruhy, které se rozsvěcují po jednom; vpředu velký černý žebrovaný blok ústí s mosaznými tyčkami a oválným otvorem; zelené kapsle nahoře (průduchy) jsou pryč, nabití ukazují jen boční pruhy (a jádro v ústí); v ruce je zbraň víc vpravo s běžným natočením, míří dopředu a levý bok s tenkými, řídce rozmístěnými pruhy je vidět; snímky `screenshots/bfg-look-0.png`, `bfg-look-2.png`, `bfg-look-4.png`, `bfg-look-gallery.png`, `bfg-charge-1.png` … `bfg-charge-4.png`; testy `model-budget.spec.ts`, `bfg.spec.ts`, `weapons-all.spec.ts`; rozhodnutí v DECISIONS „FEEDBACK 2026-10-04 — BFG podle konceptu z boku“)
- „Moc natočená, nevypadá, že míří dopředu. Nech normální natočení, pruhy tenčí a víc od sebe.“ Zapracováno 2026-10-04.
- „Zhasnuté pruhy a předek zbraně jsou černočerné. Předek je spíš šedočerný žebrovaný plast a zhasnuté zelené pruhy mají být šedší, aby to vypadalo věrohodně.“ Zapracováno 2026-10-04 (zhasnutá žebra šedozelená, blok ústí šedý plast nad tmavším jádrem, rozsvícená žebra zůstala čistě zelená).
- „Prostřední trubice je taky černočerná. Má být světlejší, třeba průsvitné sklo, a při nabíjení zelenat, 4 pruhy = nejzelenější.“ Zapracováno 2026-10-04 (mátová skleněná trubice s vláknem, zezelená o čtvrtinu za každé rozsvícené žebro).

## 2026-10-04 — vodní pistolka pomaleji
- „Kadence základní pistolky je moc rychlá. Ať střílí pomaleji, pořád je moc silná.“

Zapracováno 2026-10-04 (kadence 6 → 3 výstřely/s při stejném poškození 4 na zásah, tedy polovina DPS: 24 → 12; humanoid na Záškoláčkovi padne za ~2,7 s místo ~1,3 s, zásobník 30 vydrží 10 s; ostatní zbraně beze změny, takže jsou proti pistolce větší upgrade; testy `weapons-data.test.ts`, `weapon.spec.ts`, `weapons-all.spec.ts`, `weapons-balance.spec.ts`, `playthrough.spec.ts`, `keyboard-only.spec.ts`, `arena.spec.ts`)

## 2026-10-04 — BFG ukazuje chlazení
- „BFG potřebuje ukazovat fázi chlazení. Stačí, když boční červený pruh bude normálně tmavší a při chlazení bude jasně červeně svítit.“

Zapracováno 2026-10-04 (boční LED panel je normálně tmavě červený a posunul se dopředu na šedý boční panel, aby byl z pohledu hráče vidět; po výstřelu celých 5 s chlazení jasně svítí červeně (`effect.cooldownColor` neon.robot, `params.cooldownGlow`), po vychladnutí plynule zhasne; snímky `screenshots/bfg-look-cooldown.png`, `bfg-look-0.png`; test `bfg.spec.ts` hlídá hák `ledGlow`: připravená zbraň tma, při chlazení 1 až do konce, po vychladnutí zhasíná)
