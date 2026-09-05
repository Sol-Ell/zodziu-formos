// Build the SQLite morphological dictionary from the Lithuanian Hunspell
// lexicon (.aff + .dic). Run once:
//   node scripts/build-db.js
//
// Sources (see README):
//   data/source/lt_LT.aff  +  data/source/lt_LT.dic
// (Virginijus Dadurkevičius, github.com/dadurka/hunspell_morphology_lt)

import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseAff, parseDic, expandEntry, mapTags, POS_MAP } from './lib/hunspell.js';
import { fold } from '../src/util.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const AFF = process.env.AFF || path.join(root, 'data/source/lt_LT.aff');
const DIC = process.env.DIC || path.join(root, 'data/source/lt_LT.dic');
const DB = process.env.DB_PATH || path.join(root, 'data/zodynas.db');

if (!existsSync(AFF) || !existsSync(DIC)) {
  console.error('Missing source files. Expected:', AFF, DIC);
  process.exit(1);
}

console.log('Parsing affix file…');
const aff = parseAff(readFileSync(AFF, 'utf8'));
console.log(`  AF groups: ${aff.af.size}, AM aliases: ${aff.am.size}, SFX flags: ${aff.sfx.size}`);

console.log('Parsing dictionary…');
const dic = parseDic(readFileSync(DIC, 'utf8'));
console.log(`  ${dic.length} dictionary entries`);

console.log('Preparing database…');
if (existsSync(DB)) unlinkSync(DB);
const db = new DatabaseSync(DB);
db.exec(readFileSync(path.join(root, 'src/schema.sql'), 'utf8'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');

const insertLemma = db.prepare('INSERT INTO lemmas (lemma, lemma_folded, pos) VALUES (?, ?, ?)');
const selectLemma = db.prepare('SELECT id FROM lemmas WHERE lemma_folded = ? AND pos = ?');
const insertForm = db.prepare(`
  INSERT INTO forms
    (lemma_id, surface, surface_folded, pos, gender, case_, number, person,
     tense, mood, degree, definiteness, form_kind, participle, reflexive)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const lemmaCache = new Map();
function getLemmaId(lemma, pos) {
  const key = fold(lemma) + '\u0000' + pos;
  if (lemmaCache.has(key)) return lemmaCache.get(key);
  insertLemma.run(lemma, fold(lemma), pos);
  const id = selectLemma.get(fold(lemma), pos).id;
  lemmaCache.set(key, id);
  return id;
}

console.log('Expanding paradigms and inserting…');
const started = Date.now();
db.exec('BEGIN');
let forms = 0;
let skippedEntries = 0;
let skippedForms = 0;
let lastLog = 0;

for (let i = 0; i < dic.length; i++) {
  const entry = dic[i];
  const poTag = (aff.am.get(entry.posAlias) || '').split(/\s+/).find((t) => t.startsWith('po:'));
  const pos = POS_MAP[poTag];
  if (!pos) {
    skippedEntries++;
    continue;
  }

  const lemmaId = getLemmaId(entry.word, pos);

  for (const { surface, tags } of expandEntry(entry, aff)) {
    const f = mapTags(tags);
    if (f.dropped || !f.pos) {
      skippedForms++;
      continue;
    }
    insertForm.run(
      lemmaId,
      surface,
      fold(surface),
      f.pos,
      f.gender,
      f.case_,
      f.number,
      f.person,
      f.tense,
      f.mood,
      f.degree,
      f.definiteness,
      f.form_kind,
      f.participle,
      f.reflexive,
    );
    forms++;
  }

  if (i - lastLog >= 5000) {
    lastLog = i;
    const rate = Math.round((i / (Date.now() - started)) * 1000);
    process.stdout.write(`\r  ${i.toLocaleString('lt-LT')} / ${dic.length.toLocaleString('lt-LT')} entries, ${forms.toLocaleString('lt-LT')} forms (${rate} entries/s)`);
  }
}

db.exec('COMMIT');
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_forms_surface ON forms(surface_folded);
  CREATE INDEX IF NOT EXISTS idx_forms_lemma   ON forms(lemma_id);
  CREATE INDEX IF NOT EXISTS idx_lemmas_lemma  ON lemmas(lemma_folded);
  ANALYZE;
`);

const seconds = ((Date.now() - started) / 1000).toFixed(1);
const distinctLemmas = db.prepare('SELECT COUNT(*) AS n FROM lemmas').get().n;
console.log(`\nDone in ${seconds}s.`);
console.log(`  distinct lemmas: ${distinctLemmas.toLocaleString('lt-LT')}`);
console.log(`  forms:  ${forms.toLocaleString('lt-LT')}`);
console.log(`  skipped entries (unknown POS): ${skippedEntries.toLocaleString('lt-LT')}`);
console.log(`  skipped forms: ${skippedForms.toLocaleString('lt-LT')}`);
db.close();
