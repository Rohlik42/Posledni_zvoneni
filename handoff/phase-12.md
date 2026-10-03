# Phase 12 — Quiz content (handoff)

Branch: `worktree-wf_c12d8fbe-c51-4` · worktree: `.claude/worktrees/wf_c12d8fbe-c51-4` · base: main @ 8a80181 (merged in).
Status: **done** (milestones understood → implemented → tests → visual → done all committed).

## What changed
- `data/quiz.json` (new; also creates the `data/` directory, which did not exist on main — without it `tests/data/data-files.test.ts` fails on `readdirSync("data")`).
  - Format per DECISIONS #16: `{ "wrongAnswerDamage": 20, "subjects": [{ "subject", "questions": [{ "q", "options": [4], "correct": 0–3 }] }] }`. No other keys.
  - 9 subjects, spelled as LEGACY §1: Matematika 8, Čeština 8, Angličtina 8, Zeměpis 8, Tělocvik 8, Dějepis 8, Hudebka 8, Výtvarka 7, Fyzika 9 → **72 questions**.
  - Correct answers: globally A/B/C/D = 18/18/18/18; per subject 2/2/2/2 (Výtvarka 2/2/2/1, Fyzika 2/2/2/3), so a player who only sees one teacher cannot guess by letter.
  - Story tie-ins: Neuralith Dynamics, humanoid robots, robotí past, water/electricity (Fyzika: why tap water conducts = ions, distilled vs sea water, Ohm's law, 12 V × 2 A, railgun = Lorentz force). English text only in Angličtina. No real persons from the school; only historical/artistic figures (Masaryk, Karel IV., Smetana, Dvořák, Mozart, Leonardo, van Gogh, Mucha, Picasso, Němcová, Erben).
  - Fact check: every correct answer was verified while writing (numeric ones recomputed: 3 m/s × 120 s = 360 m; 15 % z 80 = 12; 3·6−7 = 11; 6-8-10; 2¹⁰ = 1024; (6−2)·180 = 720°; primes < 20 = 8; 10 V / 20 Ω = 0,5 A; 12 V · 2 A = 24 W). Deliberately avoided disputed items (Nile vs Amazon, RYB vs RGB complementary colours, "roboti/roboty" which ÚJČ allows both, "who coined robot").
  - Distractors avoid "všechny uvedené"-type options, so the game may safely shuffle options at runtime if phase 11 wants to.
- `tests/data/quiz.test.ts` (new, `node:test` via tsx, runs in `npm run test:data` → `npm test`): top-level schema (only `wrongAnswerDamage` > 0 and `subjects`), all 9 required subjects exactly once, 5–10 questions each, no unexpected subject, non-empty `q`, exactly 4 non-empty options, options unique per question (case-insensitive, `cs` locale), `correct` integer 0–3, no duplicate questions across the file, no letter > 40 % of correct answers.

## Verified (numbers)
- `npm run typecheck`: 0 errors.
- `npm test` (PW_PORT=5305): data tests 6/6 pass (5 new + `data/*.json parse`), smoke 1/1 pass.
- Visual check: `npx vite --port 5305` → `/` screenshot after 4 s: the scaffold's empty dark scene renders, no change expected (this phase touches no UI or engine code). `/data/quiz.json` is served by Vite.
- Server on 5305 killed after the check.

## Flags / for next phases
- Phase 11 (QuizSystem) can import `data/quiz.json` as-is; subject strings match LEGACY §1 exactly (teachers.json should use the same `subject` strings to look up questions).
- Questions contain Czech typographic quotes („…“), `…`, `²`, `³`, `Ω`, `°`, `π` — the quiz UI font must render them (Inter/Barlow have them; system fallback too).
- Longest question ≈ 95 characters; the quiz UI should wrap text.
- Human review item already exists in PLAN Backlog ("Projít kvízové otázky").

## Sample for human review (3 random per subject; correct answer in bold)
**Matematika** (8 otázek)
- Ze 80 robotů ve škole jich 15 % zrezivělo od vodní pistolky. Kolik to je robotů? — A) 15 · B) 8 · **C) 12** · D) 10
- Odvěsny pravoúhlého trojúhelníku mají 6 cm a 8 cm. Jak dlouhá je přepona? — A) 14 cm · B) 12 cm · C) 48 cm · **D) 10 cm**
- Neuralith Dynamics má 2 na desátou serverů. Kolik to je? — A) 512 · B) 2048 · C) 1000 · **D) 1024**

**Čeština** (8 otázek)
- Na otázku „komu? čemu?“ odpovídá… — A) 2. pád · B) 4. pád · C) 6. pád · **D) 3. pád**
- „Roboti se blíží rychle.“ Jaký slovní druh je slovo „rychle“? — A) přídavné jméno · **B) příslovce** · C) sloveso · D) předložka
- Které z těchto slov patří mezi vyjmenovaná slova po B? — A) bič · B) bitva · **C) bydlit** · D) bizon

**Angličtina** (8 otázek)
- What is the past simple of „run“? — A) runned · B) runs · C) running · **D) ran**
- Complete: „If it rains, the robots … rust.“ — **A) will** · B) would · C) had · D) were
- Choose the correct sentence. — A) The robot don't like water. · **B) The robot doesn't like water.** · C) The robot not likes water. · D) The robot doesn't likes water.

**Zeměpis** (8 otázek)
- Jak se jmenuje nejvyšší hora Česka? — A) Praděd · **B) Sněžka** · C) Lysá hora · D) Klínovec
- Ve kterém oceánu leží Mariánský příkop, nejhlubší místo na Zemi? — A) v Atlantském · B) v Indickém · C) v Severním ledovém · **D) v Tichém**
- Kolik krajů má Česko včetně hlavního města Prahy? — **A) 14** · B) 13 · C) 8 · D) 16

**Tělocvik** (8 otázek)
- Ve kterém sportu se hraje s pukem? — A) florbal · B) pozemní hokej · **C) lední hokej** · D) curling
- Jak dlouhé je jedno kolo standardní atletické dráhy (po vnitřní dráze)? — A) 200 m · **B) 400 m** · C) 300 m · D) 500 m
- Kolik hráčů jednoho týmu je současně na hřišti ve volejbale? — A) 5 · B) 7 · C) 9 · **D) 6**

**Dějepis** (8 otázek)
- Luddité na začátku 19. století z protestu ničili… — A) okna kostelů · B) železniční mosty · C) tiskárny peněz · **D) stroje v továrnách**
- Který panovník založil Karlův most? — A) Rudolf II. · B) Přemysl Otakar II. · **C) Karel IV.** · D) Josef II.
- Kdo byl prvním prezidentem Československa? — A) Edvard Beneš · **B) Tomáš Garrigue Masaryk** · C) Václav Havel · D) Emil Hácha

**Hudebka** (8 otázek)
- Kolik strun má běžná klasická kytara? — **A) 6** · B) 4 · C) 5 · D) 12
- Ve kterém městě se narodil Wolfgang Amadeus Mozart? — A) ve Vídni · B) v Praze · C) v Berlíně · **D) v Salcburku**
- Kdo složil symfonii Z Nového světa? — A) Bedřich Smetana · **B) Antonín Dvořák** · C) Ludwig van Beethoven · D) Zdeněk Fibich

**Výtvarka** (7 otázek)
- Jakou barvu dostaneš smícháním modré a žluté temperové barvy? — A) fialovou · B) oranžovou · **C) zelenou** · D) hnědou
- Robotí oko svítí RGB diodou. Které barvy znamená zkratka RGB? — A) červená, šedá, bílá · B) růžová, zlatá, modrá · C) červená, žlutá, modrá · **D) červená, zelená, modrá**
- Kdo namaloval obraz Hvězdná noc? — **A) Vincent van Gogh** · B) Claude Monet · C) Paul Cézanne · D) Edvard Munch

**Fyzika** (9 otázek)
- Jak rychle se šíří světlo ve vakuu (přibližně)? — A) 300 000 km/h · **B) 300 000 km/s** · C) 30 000 km/s · D) 3 000 km/s
- Proč voda z kohoutku vede elektrický proud a dělá robotům zkrat? — **A) obsahuje rozpuštěné ionty solí** · B) molekuly vody jsou kovové · C) obsahuje volné elektrony jako měď · D) voda je supravodič
- Při jaké teplotě vře čistá voda za normálního atmosférického tlaku? — A) 90 °C · B) 80 °C · **C) 100 °C** · D) 120 °C
