import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCHEMA = readFileSync(
  fileURLToPath(new URL('./schema.sql', import.meta.url)),
  'utf8',
);

const FEATURES = [
  'gender',
  'case_',
  'number',
  'person',
  'tense',
  'mood',
  'degree',
  'definiteness',
  'form_kind',
  'participle',
];

/**
 * Open (creating if needed) the SQLite database and return an object with
 * prepared, ready-to-use query helpers. Built on Node's synchronous
 * `node:sqlite`, so there are no async database calls anywhere in the app.
 */
export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  db.exec('PRAGMA foreign_keys = ON;');

  const stmts = {
    findForms: db.prepare(
      'SELECT f.*, l.lemma FROM forms f JOIN lemmas l ON l.id = f.lemma_id WHERE f.surface_folded = ?',
    ),
    formsByLemma: db.prepare(
      'SELECT f.*, l.lemma, l.lemma_folded FROM forms f JOIN lemmas l ON l.id = f.lemma_id WHERE f.lemma_id = ?',
    ),
    lemmaById: db.prepare(
      'SELECT * FROM lemmas WHERE id = ?',
    ),
    suggest: db.prepare(
      `SELECT surface, surface_folded, COUNT(*) AS n
         FROM forms
        WHERE surface_folded LIKE ? ESCAPE '\\'
        GROUP BY surface_folded
        ORDER BY surface_folded
        LIMIT ?`,
    ),
    countForms: db.prepare('SELECT COUNT(*) AS n FROM forms'),
    countLemmas: db.prepare('SELECT COUNT(*) AS n FROM lemmas'),
    // Alphabetical browse: distinct surfaces beginning with a letter.
    browse: db.prepare(
      `SELECT surface, surface_folded, MIN(id) AS id
         FROM forms
        WHERE surface_folded LIKE ? ESCAPE '\\'
        GROUP BY surface_folded
        ORDER BY surface_folded
        LIMIT ? OFFSET ?`,
    ),
  };

  return {
    db,
    stmts,
    FEATURES,
    close: () => db.close(),
  };
}

/** Insert a lemma, returning its id (reusing an existing row if present). */
export function insertLemma(db, { lemma, lemma_folded, pos }) {
  db.prepare(
    'INSERT OR IGNORE INTO lemmas (lemma, lemma_folded, pos) VALUES (?, ?, ?)',
  ).run(lemma, lemma_folded, pos);
  return db.prepare(
    'SELECT id FROM lemmas WHERE lemma_folded = ? AND pos = ?',
  ).get(lemma_folded, pos).id;
}
