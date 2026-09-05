// Build a small sample database (a handful of lemmas) for quick server testing.
// The full database is built by scripts/build-db.js.
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseAff, parseDic, expandEntry, mapTags, POS_MAP } from './lib/hunspell.js';
import { fold } from '../src/util.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.DB_PATH || path.join(root, 'data/sample.db');

const aff = parseAff(readFileSync(path.join(root, 'data/source/lt_LT.aff'), 'utf8'));
const dic = parseDic(readFileSync(path.join(root, 'data/source/lt_LT.dic'), 'utf8'));

const SAMPLE = ['namas', 'knyga', 'eiti', 'gražus', 'aš', 'du', 'su', 'geras', 'bėgti', 'mokykla', 'gražiai'];

if (existsSync(DB)) unlinkSync(DB);
const db = new DatabaseSync(DB);
db.exec(readFileSync(path.join(root, 'src/schema.sql'), 'utf8'));

const insertLemma = db.prepare('INSERT INTO lemmas (lemma, lemma_folded, pos) VALUES (?, ?, ?)');
const insertForm = db.prepare(`
  INSERT INTO forms
    (lemma_id, surface, surface_folded, pos, gender, case_, number, person,
     tense, mood, degree, definiteness, form_kind, participle, reflexive)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const word of SAMPLE) {
  const entries = dic.filter((e) => e.word === word);
  for (const e of entries) {
    const poTag = (aff.am.get(e.posAlias) || '').split(/\s+/).find((t) => t.startsWith('po:'));
    const pos = POS_MAP[poTag];
    if (!pos) continue;
    insertLemma.run(e.word, fold(e.word), pos);
    const { id } = db.prepare('SELECT id FROM lemmas WHERE lemma_folded=? AND pos=?').get(fold(e.word), pos);
    for (const { surface, tags } of expandEntry(e, aff)) {
      const f = mapTags(tags);
      if (f.dropped || !f.pos) continue;
      insertForm.run(id, surface, fold(surface), f.pos, f.gender, f.case_, f.number, f.person, f.tense, f.mood, f.degree, f.definiteness, f.form_kind, f.participle, f.reflexive);
    }
  }
}
const { n: l } = db.prepare('SELECT COUNT(*) n FROM lemmas').get();
const { n: fr } = db.prepare('SELECT COUNT(*) n FROM forms').get();
console.log(`Sample DB ready: ${l} lemmas, ${fr} forms -> ${DB}`);
db.close();
