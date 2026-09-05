import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb } from './db.js';
import { renderParadigm } from './render.js';
import { analysis } from './tags.js';
import { esc, fold } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const PORT = Number(process.env.PORT) || 4000;
const DB_PATH = process.env.DB_PATH || path.join(root, 'data', 'zodynas.db');

const { stmts } = openDb(DB_PATH);

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(root, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(root, 'public')));

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'Y', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T', 'U', 'V', 'Z'];
const PER_PAGE = 500;
app.locals.LETTERS = LETTERS;
app.locals.esc = esc;

/** All analyses (rows) matching a surface form, each with its display string. */
function findAnalyses(word) {
  return stmts.findForms.all(fold(word)).map((r) => ({ ...r, analysisStr: analysis(r.pos, r) }));
}

/** Distinct lemmas represented by a set of analyses. */
function distinctLemmas(analyses) {
  const seen = new Set();
  const out = [];
  for (const a of analyses) {
    if (seen.has(a.lemma_id)) continue;
    seen.add(a.lemma_id);
    out.push(a);
  }
  return out;
}

/** Prefix-based suggestions (for autocomplete and not-found pages). */
function prefixSuggestions(word, limit = 8) {
  return stmts.suggest.all(`${fold(word)}%`, limit).map((r) => r.surface);
}

// --- Home ------------------------------------------------------------------
app.get('/', (req, res) => {
  const { n: formCount } = stmts.countForms.get();
  const { n: lemmaCount } = stmts.countLemmas.get();
  res.render('index', { title: 'Žodžių formų žodynas', formCount, lemmaCount });
});

// --- Word-form detail page -------------------------------------------------
app.get('/zodzio-formos/:word', (req, res) => {
  const word = req.params.word;
  const analyses = findAnalyses(word);

  if (!analyses.length) {
    return res.status(404).render('not-found', {
      title: `${word} gramatinės formos`,
      word,
      suggestions: prefixSuggestions(word),
    });
  }

  const primary = analyses[0];
  const lemmaForms = stmts.formsByLemma.all(primary.lemma_id);
  res.render('word', {
    title: `${word} gramatinės formos`,
    word,
    analyses,
    lemma: primary.lemma,
    otherLemmas: distinctLemmas(analyses).slice(1),
    paradigmHtml: renderParadigm(lemmaForms),
  });
});

// --- Search (form submit) --------------------------------------------------
app.post('/search', (req, res) => {
  const word = (req.body.word || '').trim();
  if (!word) return res.redirect('/');
  res.redirect(`/zodzio-formos/${encodeURIComponent(word)}`);
});

// --- Autocomplete suggestions (htmx fragment) ------------------------------
app.post('/search/suggestion', (req, res) => {
  const q = (req.body.word || req.body.data || '').trim();
  if (q.length < 3) return res.send('');
  res.render('partials/suggestions', { suggestions: prefixSuggestions(q, 10) });
});

// --- Alphabetical browse ---------------------------------------------------
app.get('/:letter/page/:page', (req, res) => {
  const letter = req.params.letter.toUpperCase();
  if (!LETTERS.includes(letter)) return res.status(404).send('');
  const page = Math.max(1, Number(req.params.page) || 1);
  const rows = stmts.browse.all(`${letter.toLowerCase()}%`, PER_PAGE, (page - 1) * PER_PAGE);
  res.render('partials/browse-more', { rows, letter, page, hasMore: rows.length === PER_PAGE });
});

app.get('/:letter', (req, res) => {
  const letter = req.params.letter.toUpperCase();
  if (!LETTERS.includes(letter)) return res.redirect('/');
  const rows = stmts.browse.all(`${letter.toLowerCase()}%`, PER_PAGE, 0);
  res.render('letter', {
    title: `Žodžiai iš ${letter} raidės`,
    rows,
    letter,
    page: 1,
    hasMore: rows.length === PER_PAGE,
  });
});

app.listen(PORT, () => {
  const { n: formCount } = stmts.countForms.get();
  const { n: lemmaCount } = stmts.countLemmas.get();
  console.log(`Žodžių formos ready at http://localhost:${PORT}`);
  console.log(`  lemmas: ${lemmaCount}, word forms: ${formCount}`);
});
