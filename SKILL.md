---
name: zodziu-formos
description: >-
  Reference for building "Žodžių formos" — an offline Lithuanian word-form
  (morphological) dictionary web app. Covers parsing the Lithuanian Hunspell
  morphological lexicon, expanding full inflection paradigms, mapping tags to
  Lithuanian grammatical abbreviations, building an SQLite database, and
  serving a searchable UI with Node.js (pnpm) + Express + EJS + htmx +
  node:sqlite. Use this whenever the task is to (re)implement, extend, or debug
  this project or any offline morphological dictionary built from a Hunspell
  .aff/.dic lexicon.
---

# Žodžių formos — implementation reference

This document is a complete, self-contained reference for rebuilding this
project from scratch. It captures the data source, the (non-obvious) Hunspell
file format, the paradigm-expansion algorithm, the tag→abbreviation mapping,
the database schema, the web app, and — most importantly — every gotcha that
cost real debugging time.

---

## 1. What the app does

An offline Lithuanian morphological dictionary. For any word you type — a
dictionary form or **any** inflected form — it shows:

- the lemma and the grammatical analysis, e.g.

  ```
  namas gramatinės formos
  namas →
  namas – daiktavardis, vyr. g.,V.,vns.
  ```

- the full inflection paradigm as tables (noun case/number grid, verb
  mood/tense/person grid, adjective degree × definiteness × gender grids, …)

- alphabetical browsing (A–Z) and autocomplete.

Final scale: **187,602 lemmas → 27,556,031 word forms** (≈3.5 GB SQLite DB).

---

## 2. Tech stack

| Concern | Choice |
|---|---|
| Runtime | Node.js ≥ 22.5 (built-in `node:sqlite` — **no native DB dependency**) |
| Package manager | pnpm |
| HTTP | Express 4 |
| Templates | EJS (server-side rendered pages + fragments) |
| Interactivity | htmx 2 (autocomplete + "load more"), vendored at `public/js/htmx.min.js` |
| Database | SQLite via `node:sqlite` (`DatabaseSync`) |

Dependencies (all of `package.json`): `ejs`, `express`, `htmx.org`. Nothing else.

---

## 3. Data source

The morphological data is the **Lithuanian Hunspell dictionary by Virginijus
Dadurkevičius** — a DLKŽ-derived morphological lexicon shipped as a Hunspell
`.aff` + `.dic` pair that encodes **full inflection paradigms + grammatical
tags** (not just spellcheck forms).

- Repository: <https://github.com/dadurka/hunspell_morphology_lt>
- Used snapshot: `lt_LT.aff` (v1.0.59) + `lt_LT.dic` (187,602 lemmas), also
  mirrored at CLARIN-LT handle `20.500.11821/64` (<https://clarin-repo.lt/>)
- License: **MPL 1.1 / GPLv3+ / LGPLv3+** (tri-license; redistributable)

The files are committed at `data/source/lt_LT.aff` and `data/source/lt_LT.dic`
(~3.7 MB together).

### Why not other sources

| Source | Verdict |
|---|---|
| LibreOffice / standard lt_LT Hunspell | spellcheck-only, lossy — bad |
| Apertium `apertium-lit` | ~4,600 lemmas — far too small |
| Wiktionary / Wikidata lexemes | <9k lemmas |
| ekalba.lt DLKŽ API | has lemma+POS but **no paradigm data** |

---

## 4. The Hunspell `.aff` / `.dic` format (the hard part)

This dictionary uses `FLAG num` (numeric flags), AF compression, and AM
morphological aliases. You must understand all three.

### 4.1 `.dic`

```
<count>                                  # first line, e.g. 187602
word[/flags]<TAB><am_alias>              # every other line
```

Examples:

| line | meaning |
|---|---|
| `namas/8\t5` | lemma `namas`, AF group **8**, base morph = AM alias **5** (`po:noun`) |
| `eiti/330\t12` | lemma `eiti`, AF group 330, AM alias 12 (`po:verb`) |
| `su\t37` | indeclinable, no flag, AM alias 37 (`po:preposition_Inst`) |
| `alibi\t15` | AM alias 15 resolves to a **multi-tag** string `po:noun is:Masc` |

Gotchas:

- The `/flags` part is an **AF group number**, not a raw SFX flag.
- The tab field is an **AM alias number** (integer). Parse it with `Number()`.
- A few hundred entries resolve to multi-tag strings (see §6.8).

### 4.2 `.aff`

Key directives:

```
SET UTF-8
FLAG num                          # flags are numbers
AF 581                            # then 581 lines:  AF f1,f2,... # groupNumber
AM 1601                           # then 1601 lines: AM tag        (alias = position 1..1601)
SFX <flag> <Y|N> <count>          # then <count> rule lines
PFX <flag> <Y|N> <count>          # (only 4 PFX rules total here)
NEEDAFFIX 65521                   # marker flag
CIRCUMFIX 65520                   # marker flag
FULLSTRIP
```

**AF** — alias groups (paradigm → list of raw SFX flags):

```
AF 967,969,974,976,65521 # 2        # group 2 -> flags 967,969,974,976 (+marker)
```

**AM** — morphological aliases (number → tag). Position in the list = alias
number (1-based, **after** the `AM 1601` header). Examples:

| alias | tag |
|---|---|
| 5 | `po:noun` |
| 8 | `po:adjective` |
| 12 | `po:verb` |
| 15 | `po:noun is:Masc` (multi-tag!) |
| 34 | `po:verb_negative` |
| 38 | `is:Masc_Sg_Nom` |
| 39 | `is:Masc_Sg_Gen` |
| 151 | `is:Def` |
| 152 | `is:Comp` |
| 348 | `is:IForm` (principal-form marker) |

**SFX rules** — `SFX <flag> <strip> <add> <cond> <morph>`:

```
SFX 1 Y 4                          # flag 1, 4 rules
SFX 1 as as . 38                   # strip "as", add "as", cond ".", morph 38  (null rule)
SFX 1 as o  . 39                   # "namas" -> "namo"  (Gen Sg)
SFX 3107 us esnis/521 . 152        # "gražus" -> "gražesnis" + continuation flag 521
```

- `morph` is **always a numeric AM alias** in this dictionary (never a literal).
- `add` may carry a continuation class: `esnis/521` → add `esnis`, then the
  resulting word may take flag **521**.
- `strip`/`add` equal to `0` means **empty string** (add nothing / strip nothing).
- `cond` is a suffix condition matched against the end of the word.

**Continuation flags are AF group numbers too.** Example: `eiti/330` →
AF 330 = `[8787, 8788, 8797, 8798, 8807, 8808, 65521]`; rule
`SFX 8787 eiti eiti/530 . 348` produces `eiti` (morph `is:IForm`) and continues
with flag `530`; **AF 530** = `[14221, 65521]`; `SFX 14221` has 1134 rules (the
whole verb conjugation). So: *resolve every flag reference — from `.dic` and
from continuation — through the AF table first.*

### 4.3 Condition matching

A SFX condition `cond` is matched against the **last N characters** of the word
(left-to-right), where `[...]`/`[^...]` classes count as **one position** and
`.` matches any character. Example: `[^djt]us` matches the 3-char tail of
`gražus` (`žus`) but not `matytus` (`tus`).

```js
function condMatch(cond, word) {
  if (cond === '.' || cond === '') return true;
  const positions = [];                    // expand [..] into single positions
  for (let i = 0; i < cond.length; i++) {
    if (cond[i] === '[') { const j = cond.indexOf(']', i); positions.push(cond.slice(i, j + 1)); i = j; }
    else positions.push(cond[i]);
  }
  if (positions.length > word.length) return false;
  const start = word.length - positions.length;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i], wc = word[start + i];
    if (p[0] === '[') {
      const neg = p[1] === '^';
      const set = neg ? p.slice(2, -1) : p.slice(1, -1);
      if (neg ? set.includes(wc) : !set.includes(wc)) return false;
    } else if (p !== wc) return false;
  }
  return true;
}
```

---

## 5. Paradigm expansion algorithm

One `.dic` entry → many `{ surface, tags[] }` records.

```js
// tags always starts with the base morph tags (po:...)
function expandEntry(entry, aff) {
  const poTags = (aff.am.get(entry.posAlias) || 'po:noun').split(/\s+/).filter(Boolean);
  const results = new Map(); // surface -> array of tag-arrays

  const resolveFlags = (flags) => {
    const out = [];
    for (const f of flags) {
      const g = aff.af.get(Number(f));
      if (g) out.push(...g.filter((x) => !['65520','65521'].includes(x))); // drop markers
      else out.push(f);
    }
    return out;
  };

  const initialFlags = resolveFlags(entry.flags);
  if (!initialFlags.length) { record(entry.word, poTags); return /* bare form */; }

  const record = (surface, tags) => {
    const list = results.get(surface) ?? [];
    if (!list.some((t) => t.join() === tags.join())) { list.push(tags); results.set(surface, list); }
  };

  const walk = (word, tags, flags, depth) => {
    if (depth > 6) return;                       // cycle guard
    for (const flag of flags) {
      for (const r of aff.sfx.get(flag) ?? []) {
        if (!word.endsWith(r.strip)) continue;
        if (!condMatch(r.cond, word)) continue;
        const surface = word.slice(0, word.length - r.strip.length) + r.add;
        const morph = String(aff.am.get(Number(r.morph)) ?? r.morph).split(/\s+/).filter(Boolean);
        record(surface, [...tags, ...morph]);
        if (r.cont) walk(surface, [...tags, ...morph], resolveFlags([r.cont]), depth + 1);
      }
    }
  };

  walk(entry.word, poTags, initialFlags, 0);
  if (!results.has(entry.word)) record(entry.word, poTags);   // indeclinable fallback

  // Subset-drop: drop a tag-set that is a proper subset of another tag-set for
  // the SAME surface. These are intermediate continuation forms, e.g. "gražesnis"
  // tagged only is:Comp before the case-ending rules ran.
  const isSubset = (a, b) => a.every((t) => b.includes(t));
  const out = [];
  for (const [surface, tagSets] of results) {
    const maximal = tagSets.filter(
      (t) => !tagSets.some((o) => o !== t && t.length < o.length && isSubset(t, o)),
    );
    for (const tags of maximal) out.push({ surface, tags });
  }
  return out;
}
```

---

## 6. Tag mapping (`is:`/`po:` → canonical features)

Canonical feature codes stored in the DB, then rendered to Lithuanian
abbreviations at query time.

### 6.1 `po:` → part of speech

| po tag | POS |
|---|---|
| `po:noun`, `po:noun_first_name`, `po:noun_family_name`, `po:noun_geographic_name`, `po:noun_proper_name`, `po:noun_reflexive` | `daiktavardis` |
| `po:adjective` | `būdvardis` |
| `po:verb`, `po:verb_reflexive`, `po:verb_negative`, `po:verb_reflexive_negative` | `veiksmažodis` |
| `po:numeral_cardinal`, `po:numeral_ordinal`, `po:numeral_roman` | `skaitvardis` |
| `po:pronoun` | `įvardis` |
| `po:adverb` | `prieveiksmis` |
| `po:preposition_Gen/Acc/Dat/Inst` | `prielinksnis` |
| `po:conjunction` | `jungtukas` |
| `po:particle` | `dalelytė` |
| `po:interjection` | `jaustukas` |
| `po:onomatopoeic` | `ištiktukas` |
| `po:abbreviation`, `po:acronym` | `santrumpa` |

### 6.2 `is:` inflectional tags (by shape)

First strip variant suffixes repeatedly: `_short`, `_rare`, `_deprecated`, `_long`.

**Finite verbs** — `Indic|Subj|Imper`:

- `Indic_{Pres|Past|PastFreq|Fut}_{Sg_I|Sg_II|Pl_I|Pl_II|III}`
- `Subj_{Sg_I|Sg_II|Pl_I|Pl_II|III}`
- `Imper_{Sg_II|Pl_I|Pl_II|III}`  (no tense; III = 3rd person)

Roman numerals: `I`=1st, `II`=2nd, `III`=3rd. `Sg/Pl` only for I/II.
Person codes: `Sg_I→p1, Sg_II→p2, Pl_I→p1p, Pl_II→p2p, III→p3`.

**Non-finite**:

| tag | form_kind |
|---|---|
| `Inf` | `pagr. f.` |
| `Gerund_{Pres|Past|PastFreq|Fut}` | `padalyvis` (+tense) |
| `HalfPart_{Masc|Fem}_{Sg|Pl}` | `pusdalyvis` (+gender, +number, no case) |
| `Part_{Act|Pass|Nec}_{Pres|Past|PastFreq|Fut}[_Def]_{…Nominal…}` | `dalyvis` (+participle `veik`/`nev`/`reik`, +tense, +`def` if `_Def`, +nominal) |
| `Supine` | `supynas` |
| `Vadv` | `būdinys` |

`IForm`/`PrForm`/`PsForm` are **principal-form markers inherited through
continuation into every derived form** — ignore them (just `continue`), do NOT
drop the form.

**Nominal** — `[PlT_|Coll_]?[Masc|Fem|Neut]?_{Sg|Pl|Dual}?_{Case}?`:

- gender: `Masc→m, Fem→f, Neut→n` (pronouns are gender-less: `Sg_Nom`, `Pl_Gen`)
- number: `Sg→vns, Pl→dgs, Dual→dual`
- case: `Nom→V, Gen→K, Dat→N, Acc→G, Inst→IN, Loc→VT, Voc→S, Il→IL`
- `_possessive` marker (on pronouns) is stripped before case.

**Degree / definiteness** (standalone tags, combined via continuation):

| tag | effect |
|---|---|
| `Comp`, `Comp_Dmn` | degree `comp` |
| `Super` | degree `sup` |
| `Def` | definiteness `def` |
| `Comp_Def`, `Comp_Dmn_Def` | degree `comp` + `def` |
| `Super_Def` | degree `sup` + `def` |
| `Neut` | gender `n` (neuter adjective) |
| `Neut_Comp`, `Neut_Comp_Dmn` | gender `n` + `comp` |
| `Neut_Super` | gender `n` + `sup` |

### 6.3 Post-processing defaults

Adjectives always show degree and definiteness explicitly; the positive/
indefinite values are implicit in the source, so default them:

```js
if (pos === 'būdvardis') { if (!degree) degree = 'pos'; if (!definiteness) definiteness = 'indef'; }
```

---

## 7. Lithuanian abbreviations + analysis string

### 7.1 Labels

| feature | code → label |
|---|---|
| case | `V→V., K→K., N→N., G→G., IN→Įn., VT→Vt., S→Š., IL→Il.` |
| number | `vns→vns., dgs→dgs., dual→dvs.` |
| gender | `m→vyr. g., f→mot. g., n→bev. g.` |
| person | `p1→aš, p2→tu, p3→jis/ji, p1p→mes, p2p→jūs, p3p→jie/jos` |
| tense | `pres→es. l., past→būt. k. l., pastFreq→būt. d. l., fut→būs. l.` |
| mood | `ind→ties. nuos., subj→tar. nuos., imp→liep. nuos.` |
| degree | `pos→nelyg. l., comp→aukšt. l., sup→aukšč. l.` |
| definiteness | `indef→neįv. f., def→įv. f.` |
| participle | `veik→veik. r., nev→nev. r., reik→reik. r.` |

### 7.2 Analysis string format

`POS` followed by `, ` then the feature labels joined by a **bare comma**
(no space):

- `daiktavardis, vyr. g.,V.,vns.`
- `veiksmažodis, aš,es. l.,ties. nuos.`
- `būdvardis, vyr. g.,V.,vns.,aukšt. l.,neįv. f.`

Feature order per POS: noun `[gender, case_, number]`; adjective
`[gender, case_, number, degree, definiteness]`; finite verb
`[person, tense, mood]`. Non-finite verb forms are special-cased:

- `pagr. f.` → `veiksmažodis, pagr. f.`
- `padalyvis` → `veiksmažodis, padalyvis,<tense>`
- `pusdalyvis` → `veiksmažodis, pusdalyvis,<gender>,<number>`
- `dalyvis` → `veiksmažodis, <participle>,<tense>,<gender>,<case>,<number>[,<definiteness>]`
- `supynas` → `veiksmažodis, supynas`
- `būdinys` → `veiksmažodis, būdinys`

---

## 8. Database schema

```sql
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS lemmas (
  id           INTEGER PRIMARY KEY,
  lemma        TEXT NOT NULL,
  lemma_folded TEXT NOT NULL,          -- Lithuanian-aware lowercase, for lookup
  pos          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forms (
  id            INTEGER PRIMARY KEY,
  lemma_id      INTEGER NOT NULL REFERENCES lemmas(id) ON DELETE CASCADE,
  surface       TEXT NOT NULL,
  surface_folded TEXT NOT NULL,
  pos           TEXT NOT NULL,
  gender        TEXT,  -- m | f | n
  case_         TEXT,  -- V | K | N | G | IN | VT | S | IL
  number        TEXT,  -- vns | dgs | dual
  person        TEXT,  -- p1 | p2 | p3 | p1p | p2p | p3p
  tense         TEXT,  -- pres | past | pastFreq | fut
  mood          TEXT,  -- ind | subj | imp
  degree        TEXT,  -- pos | comp | sup
  definiteness  TEXT,  -- indef | def
  form_kind     TEXT,  -- 'pagr. f.' | dalyvis | pusdalyvis | padalyvis | supynas | būdinys
  participle    TEXT,  -- veik | nev | reik
  reflexive     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_forms_surface ON forms(surface_folded);
CREATE INDEX IF NOT EXISTS idx_forms_lemma   ON forms(lemma_id);
CREATE INDEX IF NOT EXISTS idx_lemmas_lemma  ON lemmas(lemma_folded);
```

Import with a single transaction, batched; use `INSERT OR IGNORE` for lemmas
keyed on `(lemma_folded, pos)` so homographs with different POS stay separate
but duplicate same-POS entries merge paradigms.

**Case-insensitive lookup** must use `surface_folded` produced by JavaScript
`String.toLowerCase()` (handles `Ė→ė, Į→į, Ų→ų, Š→š, Ž→ž`); SQLite's `NOCASE`
is ASCII-only and would fail on Lithuanian diacritics.

---

## 9. Web app

### 9.1 Routes

| route | behaviour |
|---|---|
| `GET /` | homepage (counts) |
| `GET /zodzio-formos/:word` | detail page, or 404 "not found" + prefix suggestions |
| `POST /search` | **plain 302 redirect** to `/zodzio-formos/:word` (works without JS) |
| `POST /search/suggestion` | htmx fragment: `<a>` suggestion links (prefix match, limit ~10) |
| `GET /:letter` | browse page (first 500 forms) |
| `GET /:letter/page/:page` | htmx fragment: next 500 forms + OOB button |

Letters: `A B C D E F G H I Y J K L M N O P R S T U V Z` (23 — the original
omits diacritic letters).

### 9.2 Templates

**CRITICAL GOTCHA — Express + EJS has no auto-layout.** There is no built-in
`layout.ejs` mechanism (that needs the extra `express-ejs-layouts` package).
Structure every page as a full HTML document that explicitly includes shared
partials; keep htmx fragments as bare fragments:

```
views/partials/head.ejs     # <head> (title, CSS, htmx script)
views/partials/nav.ejs      # brand + search form + A–Z letters
views/partials/footer.ejs
views/index.ejs             # full page: include head + nav + footer
views/word.ejs              # full page
views/letter.ejs            # full page
views/not-found.ejs         # full page
views/partials/suggestions.ejs   # fragment (autocomplete)
views/partials/browse-more.ejs   # fragment (load more)
```

### 9.3 htmx specifics

**Autocomplete** (input inside the form):

```html
<form method="POST" action="/search">          <!-- normal, non-hx submit -->
  <input name="word" autocomplete="off"
         hx-post="/search/suggestion"
         hx-trigger="keyup changed delay:200ms"
         hx-target="#suggestion" hx-swap="innerHTML">
  <button type="submit">IEŠKOTI</button>
</form>
<div id="suggestion"></div>
```

**Load more** (button appends items and swaps itself via out-of-band swap):

```html
<!-- initial, in letter.ejs -->
<button id="more-btn" class="btn more"
        hx-get="/A/page/2" hx-target="#browse-list" hx-swap="beforeend">
  Rodyti daugiau</button>
```

```html
<!-- partials/browse-more.ejs: the <a> items append to #browse-list,
     and this OOB button replaces the existing #more-btn -->
<a href="...">item</a> …
<button id="more-btn" hx-swap-oob="true"
        hx-get="/A/page/3" hx-target="#browse-list" hx-swap="beforeend">
  Rodyti daugiau</button>
<!-- last page: replace button with an empty span -->
<span id="more-btn" hx-swap-oob="true"></span>
```

### 9.4 Paradigm rendering (per POS)

- **Noun** — one case×number grid; 7 cases + conditional `Il.` row.
- **Adjective** — sections by degree (Nelyginamasis / Aukštesnysis /
  Aukščiausiasis) × definiteness (Neįvardžiuotinės / Įvardžiuotinės) × gender
  (Vyriškoji / Moteriškoji / Bevardė) × case×number.
- **Verb** — Tiesioginė nuosaka (4 tense columns) + Tariamoji + Liepiamoji,
  rows = aš/tu/jis ji/mes/jūs/jie jos; then non-finite section (participles as
  grids, pusdalyvis/padalyvis/supynas/būdinys as lines).
- **Pronoun / numeral** — gender grids, or one grid if gender-less; a separate
  "Dviskaita" section for dual forms.
- **Invariable** (adverb, preposition, particle, …) — one line.

Display rules worth matching:

- Only **masculine** cells carry the `(vyr. g.)` annotation; feminine/neuter
  cells are unannotated.
- **3rd-person verb forms are number-neutral**: the same `p3` forms fill both
  the "Jis/ji" and "Jie/jos" rows (`personCode = p === 'p3p' ? 'p3' : p`).
- Spelling variants of the same analysis are joined with `, ` in one cell.

---

## 10. Build pipeline

```
data/source/lt_LT.aff  ──┐
                         ├─ scripts/lib/hunspell.js (parseAff, parseDic, expandEntry, mapTags)
data/source/lt_LT.dic  ──┘
                                  │
                                  ▼
                       scripts/build-db.js  ──►  data/zodynas.db
                                  │
                                  ▼
                       src/server.js + src/render.js + src/tags.js  ──►  web app
```

Commands:

```bash
pnpm install
pnpm run seed            # == node scripts/build-db.js  (a few minutes)
pnpm start               # == node src/server.js        (PORT=4000)
node scripts/preview.mjs namas   # dev: print one lemma's expanded paradigm
```

---

## 11. Gotchas checklist (read before debugging)

1. **EJS has no auto-layout** — pages must be full HTML documents; fragments
   must not be wrapped.
2. **Continuation flags are AF group numbers**, not raw SFX flags — resolve them
   through the AF table (`resolveFlags`).
3. **`IForm`/`PrForm`/`PsForm`** are inherited principal-form markers; ignore
   them, do not drop the form (dropping them loses all verb forms).
4. **`add="0"` / `strip="0"`** mean empty string, not the literal `"0"`
   (otherwise you get `gražiausi0`).
5. **Subset-drop intermediate forms** — a comparative tagged only `is:Comp`
   (before case rules) must be dropped in favor of `is:Comp + is:Masc_Sg_Nom`.
6. **Multi-tag base morphs** — a few hundred `.dic` rows resolve to
   `po:noun is:Masc`; split morph strings on whitespace everywhere.
7. **Lithuanian case folding** — use JS `toLowerCase()`, not SQLite `NOCASE`.
8. **Adjectives default degree/definiteness** to `pos`/`indef` (renderer filters
   on those exact values).
9. **3rd person (III)** has no number; it fills both plural-table rows.
10. **Masculine-only** gender annotation in cells.
11. **Illative/dual/supine/būdinys/negative verbs** are all kept (not dropped).
12. `pnpm run seed` must point at `scripts/build-db.js` (an early bug pointed it
    at a non-existent `scripts/seed.js`).

---

## 12. Verification words

After building, these should hold (spot-check against a reference dictionary):

| query | expected |
|---|---|
| `namas` | `daiktavardis, vyr. g.,V.,vns.` + 7 cases + `Il. naman / namuosna` |
| `knyga` | three analyses: `V.`, `Įn.`, `Š.` (homograph) |
| `einu` | `veiksmažodis, aš,es. l.,ties. nuos.` |
| `eičiau` | `veiksmažodis, aš,tar. nuos.` |
| `eitų` | `veiksmažodis, supynas` (+ participle homographs) |
| `gražus` | `būdvardis, vyr. g.,V.,vns.,nelyg. l.,neįv. f.` + `└ …Š.…` |
| `gražesnis` | `būdvardis, vyr. g.,V.,vns.,aukšt. l.,neįv. f.` |
| `aš` | `įvardis, V.,vns.` + `mudu – įvardis, vyr. g.,V.,dvs.` |
| `du` | `skaitvardis, vyr. g.,V.,dgs.` |
| `su` | `prielinksnis` |
| `neabejoti` | `veiksmažodis, pagr. f.` (negative verb kept) |
| `alibi` | `daiktavardis, vyr. g.` (multi-tag base morph) |
