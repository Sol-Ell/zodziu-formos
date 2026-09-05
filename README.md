# Žodžių formos — offline Lithuanian word-form dictionary

A self-contained, offline **Lithuanian word-form (morphological) dictionary**.
Type any Lithuanian word — a dictionary form or any inflected form — and get its
grammatical analysis and full inflection paradigm, plus alphabetical browsing
and autocomplete.

Built with **Node.js (pnpm) + Express + EJS + HTMX + SQLite** (Node's built-in
`node:sqlite`, so there are no native/compiled database dependencies).

## Data source

The morphological data is derived from the **Lithuanian Hunspell dictionary by
Virginijus Dadurkevičius**, distributed under the **MPL 1.1 / GPLv3+ / LGPLv3+**
tri-license:

- Repository: <https://github.com/dadurka/hunspell_morphology_lt>
- Snapshot used (`data/source/lt_LT.aff` + `data/source/lt_LT.dic`, v1.0.59):
  also mirrored at CLARIN-LT, handle `20.500.11821/64`
  (<https://clarin-repo.lt/>).

The `.aff`/`.dic` files encode ~187,000 lemmas with full inflection paradigms
(all cases/genders/numbers, verb moods/tenses/persons, participles, degrees).
`scripts/lib/hunspell.js` is a small, self-contained parser + expander that
turns each `lemma + paradigm flag` into every inflected surface form with its
grammatical tags, and maps those tags onto Lithuanian grammatical abbreviations.

### Scope

The importer keeps the complete paradigm data: all seven standard cases plus the
**illative** (`naman`, `namuosna` — labelled `Il.`), the **dual** number
(`mudu`, `mudvi` — labelled `dvs.`), the verb **supine** (`supynas`, e.g.
`eitų`) and **būdinys** (`eite`, `eitinai`), and **negative verbs**
(`neabejoti`, …) as their own lemmas. Colloquial short/rare spelling variants
(e.g. `namam`, `namuos`) are kept as alternates of the same analysis. Auxiliary
"principal form" markers in the source lexicon are ignored, as they carry no
independent analysis of their own.

## Requirements

- Node.js **>= 22.5** (uses the built-in `node:sqlite` module)
- pnpm

## Build & run

```bash
pnpm install

# Build the database (a few minutes; writes data/zodynas.db)
pnpm run seed

# Start the web app
pnpm start
```

Then open <http://localhost:4000> (override with the `PORT` env var).

### Rebuilding from scratch

```bash
node scripts/build-db.js          # reads data/source/lt_LT.{aff,dic}
PORT=4000 node src/server.js
```

## Layout

- `src/server.js` — Express app and routes (search, autocomplete, detail, browse)
- `src/db.js` — SQLite access (`node:sqlite`)
- `src/render.js` — paradigm rendering per part of speech
- `src/tags.js` — grammatical tag set + analysis-string builder
- `src/schema.sql` — database schema
- `scripts/lib/hunspell.js` — Hunspell `.aff`/`.dic` parser, paradigm expander, tag mapper
- `scripts/build-db.js` — builds `data/zodynas.db`
- `scripts/preview.mjs` — dev helper: print a lemma's expanded paradigm
- `views/` — EJS templates
- `public/` — CSS + vendored htmx

## License

- **Application code** in this repository is licensed under the **MIT License**
  (see `LICENSE`).
- **Bundled morphological data** (`data/source/lt_LT.aff`, `lt_LT.dic`) is
  © Virginijus Dadurkevičius and licensed under **MPL 1.1 / GPLv3+ / LGPLv3+**
  (see the header of the `.aff` file and `NOTICE`).
