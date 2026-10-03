# LEGACY — obsah převzatý ze staré hry „Poslední zvonění“

Podklad pro novou hru **MALGYM 2066** (Babylon.js FPS, roboti obsadili školu, zajatí učitelé kladou kvízové otázky).
Z původní hry se přebírá **obsah, ne kód**. Stará hra leží v `legacy/` (`legacy/game.js`, `legacy/index.html`, `legacy/style.css`, `legacy/README.md`); čísla řádků odpovídají commitu `6e5ac74`.
Pozor: `legacy/index.html` a `legacy/style.css` mají většinu obsahu na jednom dlouhém řádku. Proto je u citací uveden i hledaný řetězec.

---

## 1. Učitelé — **převzít beze změny**

Zdroj: `legacy/game.js:183-192` (`teacherRoster`), místnosti `legacy/game.js:30-45` (`rooms`), seznam také v `legacy/README.md:59`.

| # | Příjmení | Předmět | Místnost ve staré mapě | Barva saka (viz pozn.) |
|---|---|---|---|---|
| 0 | Šiklová | Matematika | 101 · Matematika | `#8373bc` |
| 1 | Komoň | Čeština | 102 · Čeština | `#d38d64` |
| 2 | Underlová | Angličtina | 103 · Angličtina | `#5b9990` |
| 3 | Lambertová | Zeměpis | 104 · Zeměpis | `#8373bc` |
| 4 | Taušl | Tělocvik | 203 · Tělocvična | `#d38d64` |
| 5 | Doležalová | Dějepis | 105 · Dějepis | `#5b9990` |
| 6 | Ditrichová | Hudebka | 201 · Hudebka | `#8373bc` |
| 7 | Novotná | Výtvarka | 202 · Výtvarka | `#d38d64` |
| 8 | **NOVÝ – vymyslí agent** | **Fyzika** | (stará mapa: `204 · Fyzika a informatika`, tam ale žádný učitel nebyl) | — |

- Pořadí v rosteru je kanonické a předměty se píšou přesně takto (např. „Tělocvik“, ne „Tělocvična“; „Hudebka“, „Výtvarka“).
- Nový fyzikář je jediný přidaný učitel. Jméno a příjmení vymyslí agent (fiktivní). V této tabulce záměrně chybí.
- **Barvy sak** (`legacy/game.js:207`): paleta `['#8373bc','#d38d64','#5b9990'][index%3]`. Index je pořadí spawnu, ne pevná vlastnost učitele. Tabulka uvádí barvy pro prvních 8 spawnů. Od 9. učitele (opakování rosteru) se barvy posunou.
- **Model učitele** (`legacy/game.js:206-217`): sako (barva výše), kůže `#f2c59e`, vlasy `#57433c`, bílá košile `#fff6dc`, kravata `#dfb857`, kalhoty `#344c66`, boty `#26313c`, brýle (kov `#536975` + bílá skla), v ruce červená kniha `#ed5564`. Nad hlavou je zdravotní pruh `#8bb965` (0,7 m). Před útokem se ukáže červený vykřičník „!“ (`#d34251` na `#fff3cf`, billboard).
- **Jmenovka** (`legacy/game.js:194-205`, pozice `legacy/game.js:326`):
  - textura 512×160 px, pozadí `rgba(14,25,34,0.78)`;
  - 1. řádek: příjmení, `bold 70px Arial`, `#ffffff`, y = 52;
  - 2. řádek: předmět, `46px Arial`, `#c6e3df`, y = 119;
  - rovina 2,05 × 0,64 m, 2,55 m nad kořenem učitele, vždy natočená ke kameře, nesvítí (emissive, `disableLighting`);
  - zůstává i nad duchem, dokud nedorazí do sborovny.
- **Hlášky učitelů:** ve zdrojích **žádné nejsou**. Učitelé nemají vlastní repliky. Jediný text spojený s jejich útokem je toast „POZOR! Učitel píše poznámku!“ (`legacy/game.js:302`). Repliky a kvízové otázky musí vzniknout nově.

---

## 2. Obtížnost (Doom-style)

Zdroj hodnot: `legacy/game.js:138-145` (`difficulties`). Použití: `legacy/game.js:149` (incoming), `:150` (health), `:301` (speed), `:209` + `:302` (pace), `:237` (extra), `:246` (food/drink), `:242-243` (foundFood/foundDrink). Přehled je také v `legacy/README.md:23-29`.
**Výchozí obtížnost:** `truant` = Záškoláček (`legacy/game.js:145`, v HTML atribut `checked`).

| # | id | Název | Podtitul | incoming | health | speed | pace | extra | food | drink | foundFood | foundDrink |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| I | `baby` | Mimino | I · VELMI LEHKÁ | 0.5 | 0.65 | 0.65 | 1.5 | −1 | 5 | 4 | 8 | 6 |
| II | `schoolkid` | Školáček | II · LEHKÁ | 0.75 | 0.85 | 0.8 | 1.2 | 0 | 4 | 3 | 7 | 5 |
| III | `truant` | Záškoláček | III · NORMÁLNÍ | 1 | 1 | 1 | 1 | 0 | 3 | 2 | 6 | 4 |
| IV | `rascal` | Raubíř | IV · TĚŽKÁ | 1.3 | 1.25 | 1.2 | 0.8 | 2 | 2 | 1 | 4 | 3 |
| V | `ultra` | Ultrašprt | V · NEMILOSRDNÁ | 1.65 | 1.5 | 1.4 | 0.65 | 4 | 1 | 1 | 2 | 2 |

Význam polí:

| Pole | Co dělá ve staré hře |
|---|---|
| `incoming` | násobí každé poškození hráče, výsledek se zaokrouhlí: `Math.round(amount*incoming)` |
| `health` | životy učitele `Math.round((65+day*10)*health)` |
| `speed` | rychlost učitele `(1.3+min(day,12)*0.09)*speed` m/s |
| `pace` | násobí prodlevy útoků: první cooldown `(2+rand*2)*pace`, další `(2.2+rand*1.8)*pace`, nápřah `0.65*pace` (známka) / `1.4*pace` (poznámka) |
| `extra` | počet učitelů za den `max(2, min(3+day+extra, 12))` |
| `food` / `drink` | počáteční svačiny / pití v inventáři |
| `foundFood` / `foundDrink` | kolik svačin / pití se každý den objeví v jídelně |

Hráč má na všech obtížnostech 150 životů a stejné zbraně (`legacy/index.html:3`, text `choice-hint`).

### Motta a portréty

Všechny portréty jsou inline SVG v `legacy/index.html:3`. Hledej `<svg class="difficulty-face"` nebo `value="baby"` / `"schoolkid"` / `"truant"` / `"rascal"` / `"ultra"`. Lze je převzít beze změny.
- viewBox 96×96;
- pozadí radiální gradient `#5e3430` → `#1c1516`, rámeček `#744b36`;
- pleť gradient `#ffe0a6` → `#bf7759`, uši `#c98b65`, bělmo `#fff2d1`, obrys `#38282b` (2 px, kulaté konce);
- ID gradientů se číslují `skin0..4` / `bg0..4`, aby nekolidovala.

| Obtížnost | Motto (přesně) | Portrét |
|---|---|---|
| Mimino | „Mami, já chci do školy!“ | holohlavé miminko s jednou kudrnou na temeni, velké kulaté oči, dudlík (`#8eb8bb`), tričko `#789d93` |
| Školáček | „Mami, já nechci do školy!“ | učesaný hnědý účes `#56342c`, mírný úsměv, tričko `#7293aa` |
| Záškoláček | „Učí se dobře? To nemohu říct…“ | rozcuchané špičaté vlasy `#573d31`, zornice stočené stranou, zdvižené/šikmé obočí, křivý úšklebek, tričko `#aa814d` |
| Raubíř | „NEVYLUČUJ!“ | tmavé ostré vlasy `#38282a`, zamračené obočí do V (tlusté), vyceněné zuby (mřížka), tričko `#a14e45` |
| Ultrašprt | *(místo motta MathML rovnice)* iℏ ∂ψ/∂t = [−ℏ²/2m ∇² + V] ψ | šprt: pár trčících vlasů, velké kulaté brýle `#d7ecea`, dva přední „králičí“ zuby, tričko `#64577d` |

- Rovnice je časově závislá Schrödingerova rovnice, MathML `class="schrodinger"`, `aria-label="Časově závislá Schrödingerova rovnice"`, barva `#d3c4e3` (`legacy/style.css:16`).
- Nadpis výběru: „VYBER SI OBTÍŽNOST“, podnadpis „JAK TVRDÉ BUDE VYUČOVÁNÍ?“.
- Nápověda: „Vyšší obtížnost znamená odolnější a rychlejší učitele, častější útoky, větší poškození a méně zásob. Ty máš vždy 150 životů a stejné zbraně. Obtížnost platí pro celý pokus.“
- Styl výběru (`legacy/style.css:15-16`): „warm steel and red lettering“. Řádek má výběrovou šipku ▶ a značku ◆. Jméno obtížnosti je `800 30px Barlow Condensed`, verzálky, `#c66d54`. Vybraný řádek: jméno `#ffe2a0`, rámeček `#d4a765`.

### Mapování na novou hru — **NÁVRH**

Názvy, id, motta a portréty převzít beze změny. Násobiče mapovat takto (jde jen o návrh, ladí se hraním):

| Parametr nové hry | Zdroj ve staré hře | Návrh |
|---|---|---|
| Životy hráče | konstanta 150 na všech obtížnostech | ponechat stejné pro všechny obtížnosti, obtížnost řídit přes poškození |
| Poškození od robotů | `incoming` | `dmg = round(base * incoming)` |
| Poškození za špatnou odpověď v kvízu | `incoming` (obdoba „poznámky“ za 100 × incoming) | `round(base_quiz * incoming)`; „poznámka“ může být vzorem pro těžký trest |
| Počet nepřátel | `extra` (+ růst podle dne) | `count = clamp(base + extra, min, max)` |
| Životy robotů | `health` | `hp = base * health` |
| Rychlost robotů | `speed` | `v = base * speed` |
| Frekvence útoků robotů | `pace` | cooldowny a nápřahy `* pace` (méně = častěji) |
| Počáteční zásoby | `food`, `drink` | startovní léčivé předměty |
| Pickupy na mapě | `foundFood`, `foundDrink` | počet léčivých pickupů v levelu |

---

## 3. Texty (přesné citace)

### Úvod a menu (`legacy/index.html:2-3`)
- `<title>`: „Školní survival • Poslední zvonění“
- Štítek: „KRESLENÝ ŠKOLNÍ SURVIVAL“; nadpis: „Poslední<br>*zvonění.*“ (druhé slovo zvýrazněné)
- Úvodní text (`id="intro"`):
  > **Učitelé rozdávají známky. Ty máš penál.**
  > V téhle škole létají pětky vzduchem a poznámka má základní poškození 100 životů. Vyber si obtížnost, popadni školní výbavu a zkus přežít co nejvíc dní!
  >
  > Prohledej učebny a pošli všechny učitele v podobě duchů do sborovny. Pak zazvoní a začne další, těžší den. Tužku, pero a kružítko házíš; nůžkami stříháš jen na blízko.
  >
  > Začínáš se **150 životy** a omezenými zásobami. Další svačiny a pití najdeš **pouze v jídelně**. Vyhýbej se známkám a kryj se za zdmi nebo zavřenými dveřmi. Když životy dojdou, školní den končí.
- Legenda útoků: velké barevné číslice 2, 3, 4, 5 a odznak „! POZNÁMKA · 100 DMG“
- Statistiky: „**150** životů“ · „**4** zbraně“ · „**∞** dní“
- Tlačítko start: „JDEME DO ŠKOLY →“; po smrti „ZKUSIT ZNOVU →“; při pauze „ZPÁTKY DO HRY →“ (`legacy/game.js:269`, `:339-340`)

### Ovládání (`legacy/index.html:3-14`, sbalitelné „JAK SE TO HRAJE“)
| Klávesa | Popis |
|---|---|
| W A S D | Chůze dopředu, doleva, dozadu a doprava |
| Pohyb myší | Rozhlížení a míření, včetně pohledu nahoru a dolů |
| Shift + pohyb | Sprint — podrž levý nebo pravý Shift |
| Mezerník | Skok |
| Levé tlačítko myši | Hod předmětu; s nůžkami stříhání na blízko |
| Pravé tlačítko myši | Svačina (+50 HP) nebo pití (+30 HP), podle chybějících životů a zásob |
| 1 2 3 4 / otáčení kolečkem | Tužka, pero, nůžky, kružítko |
| Stisk kolečka myši | Otevřít nebo zavřít nejbližší dveře — přistup k nim a sleduj nápovědu |
| Esc | Pauza a uvolnění kurzoru; pokračuješ tlačítkem v menu |
| M / tlačítko 🔊 | Zapnout nebo vypnout zvuky |

- Poznámka pod tabulkou: „Hra je pro počítač s klávesnicí a myší. Zvuky se spustí po kliknutí na start. Pokud prohlížeč neuzamkne kurzor, můžeš se rozhlížet běžným pohybem myši; pro neomezené otáčení otevři hru v samostatné kartě.“
- Spodní lišta HUD: „WASD pohyb · MYŠ rozhlížení · LEVÉ útok · PRAVÉ léčení · MEZERNÍK skok · SHIFT sprint · 1–4 / OTÁČENÍ KOLEČKA zbraň · STISK KOLEČKA dveře · ESC pauza · M zvuk“

### HUD (`legacy/index.html:3`, `legacy/game.js:173`, `:322`)
- Levý horní roh: „ŠKOLNÍ SURVIVAL“ / „POSLEDNÍ ZVONĚNÍ“
- Uprostřed: „DEN **01**“; podtitul na začátku „PŘIPRAV SE NA VYUČOVÁNÍ“, během hry „UČITELÉ: {n} • PŘEŽIJ VYUČOVÁNÍ“
- Vpravo: „♥ ŽIVOTY {hp} / 150“ + pruh
- Zásoby: „PRAVÉ TLAČÍTKO 🥪 {n} +50 HP“, „PRAVÉ TLAČÍTKO 🧃 {n} +30 HP“
- „Obtížnost: {název}“; „! POZNÁMKA · {dmg} DMG“
- Sloty zbraní: „{1–4} **Tužka** HOD • 18 DMG“ atd. (`legacy/game.js:153-154`)
- Místo: název místnosti, jinak „Hlavní chodba“. Nápověda u dveří: „STISK KOLEČKA — otevřít {název}“ / „zavřít {název}“
- Zvuk: „🔊 Zvuk zapnutý“ / „🔇 Zvuk vypnutý“, title „M: zapnout nebo vypnout zvuky“ (`legacy/game.js:27`)
- Zaměřovač: „+“

### Toasty a konec hry (`legacy/game.js`)
| Text | Kdy | Řádek |
|---|---|---|
| „DEN {n} — prohledej učebny, zásoby jsou v jídelně.“ | začátek dne | 244 |
| „POZOR! Učitel píše poznámku!“ | učitel chystá poznámku | 302 |
| „Duch učitele odlétá ke sborovně!“ | učitel poražen | 249 |
| „ZVONÍ! Den přežitý.“ | všichni učitelé poraženi | 318 |
| „CHŘUP CHŘUP! Svačina +{n} životů“ | snědena svačina | 268 |
| „GLO GLO GLO! Pití +{n} životů“ | vypito pití | 268 |
| „Máš plné životy. Zásoby si schovej!“ | léčení při plném HP | 268 |
| „Zásoby došly! Prohledej školu.“ | žádné zásoby | 268 |
| „Našel jsi svačinu!“ / „Našel jsi pití!“ | sebrání pickupu | 317 |
| „Otevřeno: {dveře}“ / „Zavřeno: {dveře}“ | dveře | 98 |
| „Ustup od dveří, než je zavřeš.“ | hráč stojí ve dveřích | 98 |
| „Myš bez uzamčení: rozhlížej se pohybem kurzoru. Esc = pauza.“ | pointer lock selhal | 338 |
| „Přestávka. Tvoje hra je pozastavená.“ | pauza (text v menu) | 339-340 |
| „Dokončené dny: {day-1}. Učitelé ve sborovně: {kills}.“ | smrt (text v menu) | 269 |

Nápisy ve 3D: „VÝDEJ JÍDLA A PITÍ“ (`:125`), „← VCHOD   |   JÍDELNA →“ (`:134`), „HLAVNÍ VCHOD“, „Jídelna · druhý vstup“ (`:95`), tabule „Fyzika / Informatika“ (`:107`).

---

## 4. Barvy a styl

### Písma
- `Barlow Condensed` 600/800 (nadpisy, číslo dne, názvy obtížností) a `Inter` 400/600/800 (UI). Načítají se z Google Fonts, záloha Arial (`legacy/style.css:1`).
- Texty v 3D texturách (jmenovky, známky, cedule) používají Arial (`legacy/game.js:58`, `:199-200`, `:279-283`).

### UI paleta (`legacy/style.css:2`, `:4`, `:8`, `:10`, `:12`, `:16`)
| Účel | Barva |
|---|---|
| Pozadí stránky, stín textu HUD | `#182b36` |
| Panely HUD (sloty, zásoby, místo) | `#142d38` s průhledností (`df`, `d9`, `bf`), pruh `#162b39bd` |
| Pruh životů OK / pod 50 HP | `#a5ed63` / `#ff7580` (`legacy/game.js:173`) |
| Aktivní slot zbraně | rámeček a text `#bcf274`, pozadí `#314438` |
| Toast / nápověda dveří | `#e3ffb9` / `#e4ffb9` |
| Viněta zranění | inset shadow `#ff283c` |
| Zaměřovač normál / zásah | `#ffffffaa` / `#baff6c` (`legacy/game.js:334`) |
| Overlay menu | gradient `#102532ed` → `#10253265`, blur 4px |
| Tlačítko | `#baf17a`, text `#203528`, spodní stín `#688e44` |
| Štítek / zvýraznění nadpisu (finální přepis) | `#d8b17b` / `#e1a36f` (původně `#c2f189` / `#b9ef78`) |
| Výběr obtížnosti | rámeček `#644332`, pozadí `#281e1bf5` → `#151315fa`, legenda `#e8b474`, jména `#c66d54`, vybrané `#ffe2a0` / `#d4a765` / `#f2ce85` |
| Odznak poznámky | `#681b45` + `#ffe18a` |
| Sekundární text | `#c5d6dd`, `#b9cdd5`, `#9db5bf`, `#ccdde1` |

Barvy známek (`legacy/game.js:272`, `legacy/index.html:3`):
- 2 = `#ffe348` (žlutá), 3 = `#ff9e32` (oranžová), 4 = `#ff652e` (oranžovočervená), 5 = `#ff3348` (červená);
- obrys číslic `#392937`, `900 420px Arial`.

Odznak poznámky (`legacy/game.js:277-281`):
- obdélník `#681b45` se zaobleným rámem `#ffe18a`;
- velké „!“ `#ffe18a`, „POZNÁMKA“ bílé `900 76px`, „{n} DMG“ `#ffe18a`.

### 3D materiály (`legacy/game.js:4-6`, `:53`, `:65`, `:82`, `:146`, `:218`)
| Materiál | Barva | Materiál | Barva |
|---|---|---|---|
| obloha (clearColor) | `#aacddc` | mlha (exp 0.009) | `#b2cbd0` |
| zem hemisf. světla | `#657e89` | omítka zdí | `#efe6c9` |
| spodní tyrkys. sokl | `#65a8a3` | lišta / kravata / klika | `#dfb857` |
| podlaha | `#a9b7ad` | strop | `#ece9da` |
| dřevo | `#cda36a` | kov | `#536975` |
| tabule | `#234f49` (text `#e6e8c6`) | papír / bílá | `#fff6dc` |
| kůže | `#f2c59e` | vlasy | `#57433c` |
| kalhoty | `#344c66` | boty | `#26313c` |
| červená | `#ed5564` | tužka (žlutá) | `#f2bf48` |
| pero (modrá) | `#65a8ee` | kružítko (fialová) | `#b596e5` |
| ocel | `#c9d6dd` | chléb | `#e7b76b` |
| salát / koruny stromů | `#8bb965` | voda / glóbus | `#6bbad3` |
| sklo oken (alpha 0.2) | `#b7e8f4` | tráva venku | `#72a96c` |
| oblečení hráče | `#65a8ee` | duch (alpha 0.62) | `#b1f5ed` |
| cedule (text/pozadí) | `#274d52` / `#fff3cf` | | |

Celkový dojem: světlý, „kreslený“ pastelový interiér a tmavě modrozelené HUD s limetkovými akcenty. Výběr obtížnosti je naopak v teplé arkádové paletě (rezavá, měď).

---

## 5. Zvuky (Web Audio, syntetické) — `legacy/game.js:9-28`

Základ:
- master gain `0.32`, mute nastaví gain na 0;
- šumový buffer: 0,3 s bílého šumu (mono, `rand*2-1`);
- audio se odemkne kliknutím na start (`legacy/game.js:337`).

Primitiva:
- **tone(f0, f1, dur, delay, type, vol)**: oscilátor, frekvence exponenciálně z `f0` na `f1` (min 20 Hz) za `dur`. Hlasitost lineárně 0 → `vol` za 8 ms, pak exponenciálně na 0,001 v čase `dur`.
- **whoosh(dur=0.18)**: šum → bandpass Q 0,6, střed exponenciálně 2800 → 380 Hz za `dur`. Hlasitost 0,001 → 0,28 za 25 ms, pak exponenciálně k 0,001.
- **crunch()**: šum → bandpass s náhodným středem 1600–3400 Hz, Q 0,7. Hlasitost 0,7 → 0,001 za 0,14 s.

| Zvuk | Kdy | Syntéza |
|---|---|---|
| `pencil` | hod tužkou | whoosh 0,12 s + triangle 650→270 Hz, 0,07 s, vol 0,06 |
| `pen` | hod perem | whoosh 0,16 s + triangle 1100→650 Hz, 0,05 s, vol 0,06 |
| `scissors` | střih nůžkami, **také otevření/zavření dveří** | triangle 2200→800 Hz 0,045 s vol 0,2; po 70 ms triangle 1400→550 Hz 0,04 s vol 0,16 (kovové cvak-cvak) |
| `compass` | hod kružítkem | whoosh 0,24 s + triangle 820→500 Hz, 0,12 s, vol 0,08 |
| `food` | svačina | 3× (po 0,22 s) crunch + triangle 130→90 Hz 0,1 s vol 0,15; v 0,77 s „říhnutí“ sawtooth 105→55 Hz 0,23 s vol 0,11 |
| `drink` | pití | 5× (po 0,13 s) sine (180/270 střídavě)→500 Hz 0,085 s vol 0,3 + o 55 ms později sine 420→120 Hz 0,075 s vol 0,25 (bublání); v 0,78 s říhnutí sawtooth 90→48 Hz 0,2 s vol 0,1 |
| `ghost` | učitel se mění v ducha | sine 240→850 Hz 0,35 s vol 0,25; od 0,3 s triangle 850→280 Hz 0,6 s vol 0,16 |
| `impact` | zásah / dopad předmětu | triangle 220→80 Hz 0,09 s vol 0,2 + crunch |
| `hurt` | hráč zasažen | triangle 180→65 Hz 0,12 s vol 0,18 |
| `bell` | start hry, konec dne | 3× sine 1100→1000 Hz 0,35 s vol 0,18, rozestup 0,18 s |
| `pickup` | sebrání zásoby | sine 600→1100 Hz 0,15 s vol 0,16 |

---

## 6. Mapa staré školy (jen poznámka)

Nová hra použije skutečnou budovu podle Matterport referencí. Stará mapa slouží jen pro kontext.

Rozměry a stavba (`legacy/game.js:29-50`, `:62-64`, `:84-95`):
- mřížka 57 × 25 buněk po 2,5 m, tj. 142,5 × 62,5 m;
- zdi 3,8 m (spodní sokl 1,1 m s lištou), strop 3,85 m;
- hlavní chodba vede od západu na východ (řádky z 11–12, šířka 5 m), lemují ji skříňky (`:133`);
- hlavní vchod je na západním konci chodby;
- okna s reálným sklem jsou na severní a jižní vnější stěně, venku tráva a stromy (`:67-83`).
- **Sever** (místnosti 7 × 9 buněk = 17,5 × 22,5 m): 101 Matematika, 102 Čeština, 103 Angličtina, 104 Zeměpis, 105 Dějepis, 106 Knihovna, Sborovna.
- **Jih** (hloubka 10 buněk = 25 m):
  - 201 Hudebka (klavír), 202 Výtvarka (barvy), 203 Tělocvična (hřiště, koš, lavičky);
  - Jídelna 37,5 × 25 m (stoly, lavice, výdejní pult, dva vstupy);
  - 204 Fyzika a informatika (počítače);
  - WC kluci, WC holky (7,5 m široké).
- Vybavení učeben (`:101-112`): lavice se židlemi, tabule s názvem předmětu, v zeměpisu glóbus.
- Dveře (`:84-99`, `:174`):
  - křídlo 2,14 × 2,7 m na pantu;
  - ovládání do 3,5 m;
  - zavřené dveře blokují pohyb, výhled i střely;
  - nad dveřmi z obou stran cedule s názvem.
- Učitelé začínají ve své učebně. Poražení duchové letí chodbou ke dveřím sborovny.

---

## 7. Další obsah — **inspirace, nepovinné**

**Hráč** (`legacy/game.js:5`, `:298-300`, `:341-342`):
- 150 HP, výška očí 1,65 m, FOV 1,25 rad;
- chůze 4 m/s, sprint 6,5 m/s, skok vy 4,8 při gravitaci 12;
- citlivost myši 0,0025, pitch ±1,52 rad;
- viditelné tělo a nohy, zásah způsobí krátký boční otřes kamery bez náklonu a červenou vinětu.

**Zbraně z penálu** (`legacy/game.js:153`, `:158-166`, `:252-267`, `:307`):

| Zbraň | DMG | Prodleva | Dosah | Rychlost letu | Chování / vzhled |
|---|---|---|---|---|---|
| Tužka | 18 | 0,25 s | 25 m | 22 m/s | hod; žlutý válec se stříbrným hrotem |
| Pero | 32 | 0,48 s | 30 m | 26 m/s | hod; modrý válec, hrot, klip |
| Nůžky | 55 | 0,65 s | 3,1 m | — | jen nablízko (paprsek); červená očka, čepele se při útoku zavřou a otevřou |
| Kružítko | 42 | 0,7 s | 20 m | 17 m/s | hod; za letu se přetáčí (12 rad/s); nožky žlutá + stříbrná, fialová rukojeť |

Společná pravidla:
- hozené předměty jsou 3D modely ze slotu zvětšené 1,65×;
- působí gravitace 1,2 m/s²;
- poškození se počítá až po dopadu, zastaví je zdi, nábytek, podlaha i strop;
- zásoba předmětů je neomezená;
- výběr zbraně klávesami 1–4 nebo kolečkem.

**Známky a poznámka** (`legacy/game.js:272-296`, `:302`):
- Učitel útočí, jen když vidí hráče a je blíž než 28 m. Zastaví se 5 m od hráče.
- Šance na poznámku je 16 %, jinak padne náhodně známka 2–5. Jedničky se nehází.
- Poškození: známka = číslo × 10 (20–50), poznámka = 100. Obojí se násobí `incoming`.
- Útok oznámí vykřičník nad hlavou. Nápřah trvá 0,65 s, u poznámky 1,4 s a k tomu toast.
- Střely jsou ploché billboardy (velká číslice, odznak POZNÁMKA). Letí rychlostí 7 m/s, poznámka 5,8 m/s. Žijí 8 s a zastaví je zdi a zavřené dveře.
- Pro MALGYM 2066: známky a poznámka se hodí jako trest za špatnou odpověď v kvízu.

**Duchové** (`legacy/game.js:218-233`):
- poražený učitel se změní v průsvitného tyrkysového ducha (hlava, plachta se zoubky, oči, ústa, ručky);
- vlní se nahoru a dolů (`sin(age*5)*0.12`), letí 6,5 m/s chodbou ke sborovně a tam zmizí;
- je neškodný a nejde zasáhnout;
- další den počká, až všichni duchové odletí.

**Jídlo a pití** (`legacy/game.js:234`, `:242-243`, `:268`, `:317`):
- svačina (chléb, salát, chléb) léčí +50 HP, pití (modrá lahev) +30 HP; léčení nepřekročí 150;
- pravé tlačítko vybere automaticky: chybí-li víc než 30 HP, přednostně svačinu, jinak pití;
- při plném HP se nic nespotřebuje;
- pickupy se točí a pohupují, seberou se do 0,8 m;
- objevují se jen v jídelně, jejich počet určuje obtížnost.

**Dny** (`legacy/game.js:236-245`, `:318`):
- po porážce všech učitelů zazvoní zvonek, toast „ZVONÍ! Den přežitý.“ a za 4 s začne další den;
- učitelé sílí (+10 HP/den) a zrychlují (do 12. dne);
- přibývají (3 + den + extra, max 12, min 2).
