-- Schema for the offline Lithuanian word-form dictionary.

PRAGMA journal_mode = WAL;

-- One row per lemma (canonical dictionary form + part of speech).
CREATE TABLE IF NOT EXISTS lemmas (
  id           INTEGER PRIMARY KEY,
  lemma        TEXT NOT NULL,          -- canonical form, e.g. "namas"
  lemma_folded TEXT NOT NULL,          -- Lithuanian-aware lowercase, for lookup
  pos          TEXT NOT NULL           -- part of speech, e.g. "daiktavardis"
);

-- One row per inflected word form (surface -> lemma + grammatical features).
-- Feature columns use short canonical codes (see src/tags.js); a single
-- surface form may appear multiple times when it is grammatically ambiguous.
CREATE TABLE IF NOT EXISTS forms (
  id            INTEGER PRIMARY KEY,
  lemma_id      INTEGER NOT NULL REFERENCES lemmas(id) ON DELETE CASCADE,
  surface       TEXT NOT NULL,         -- the written form, e.g. "gražesniems"
  surface_folded TEXT NOT NULL,        -- lowercase, for case-insensitive lookup
  pos           TEXT NOT NULL,         -- denormalised from lemmas for grouping
  gender        TEXT,                  -- m | f | n
  case_         TEXT,                  -- V | K | N | G | IN | VT | S
  number        TEXT,                  -- vns | dgs
  person        TEXT,                  -- p1 | p2 | p3 | p1p | p2p | p3p
  tense         TEXT,                  -- pres | past | pastFreq | fut
  mood          TEXT,                  -- ind | subj | imp
  degree        TEXT,                  -- pos | comp | sup
  definiteness  TEXT,                  -- indef | def
  form_kind     TEXT,                  -- 'pagr. f.' | bendratis | dalyvis | pusdalyvis | padalyvis
  participle    TEXT,                  -- veik | nev | reik
  reflexive     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_forms_surface ON forms(surface_folded);
CREATE INDEX IF NOT EXISTS idx_forms_lemma   ON forms(lemma_id);
CREATE INDEX IF NOT EXISTS idx_lemmas_lemma  ON lemmas(lemma_folded);
