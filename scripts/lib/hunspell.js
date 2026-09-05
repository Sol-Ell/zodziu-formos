// Minimal Hunspell .aff/.dic parser + paradigm expander, specialised for the
// Lithuanian morphological dictionary by Virginijus Dadurkevičius
// (github.com/dadurka/hunspell_morphology_lt). It understands:
//   - FLAG num (numeric flags)
//   - AF  (alias groups: paradigm number -> list of SFX/PFX flags)
//   - AM  (morphological aliases: number -> "po:..." / "is:..." tag)
//   - SFX/PFX rules including continuation classes ("add/flag" in the add field)
//   - FULLSTRIP, NEEDAFFIX, CIRCUMFIX markers
//
// It expands each dictionary lemma into every inflected surface form with its
// accumulated morphological tags, then maps those tags onto the canonical
// feature codes used by the rest of the app (see src/tags.js).

// --- Parsing ----------------------------------------------------------------

export function parseAff(text) {
  const lines = text.split('\n');
  const af = new Map(); // group number -> flags[]
  const am = new Map(); // alias number -> tag string
  const sfx = new Map(); // flag -> rules[]
  const pfx = new Map();
  let needaffix = null;
  let circumfix = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+#.*$/, '').trim();
    if (!line) continue;
    const parts = line.split(/\s+/);

    if (parts[0] === 'AF') {
      const n = Number(parts[1]);
      for (let k = 0; k < n; k++) {
        const l = lines[++i].trim();
        // Format: "AF flag1,flag2,... # groupNumber"
        const m = l.match(/^AF\s+([0-9,]+)\s*#\s*(\d+)/);
        if (m) af.set(Number(m[2]), m[1].split(','));
      }
    } else if (parts[0] === 'AM') {
      const n = Number(parts[1]);
      for (let k = 0; k < n; k++) {
        const l = lines[++i].trim();
        // Format: "AM tag" (e.g. "AM po:noun")
        am.set(k + 1, l.replace(/^AM\s+/, ''));
      }
    } else if (parts[0] === 'SFX' || parts[0] === 'PFX') {
      const table = parts[0] === 'SFX' ? sfx : pfx;
      const flag = parts[1];
      const count = Number(parts[3]);
      if (!table.has(flag)) table.set(flag, []);
      for (let k = 0; k < count; k++) {
        const l = lines[++i].replace(/\s+#.*$/, '').trim();
        const r = parseRule(l);
        if (r) table.get(flag).push(r);
      }
    } else if (parts[0] === 'NEEDAFFIX') {
      needaffix = parts[1];
    } else if (parts[0] === 'CIRCUMFIX') {
      circumfix = parts[1];
    }
  }

  return { af, am, sfx, pfx, needaffix, circumfix };
}

function parseRule(line) {
  // "SFX flag strip add cond [morph]" (6 fields) or a header "SFX flag Y N" (4).
  const parts = line.split(/\s+/);
  if (parts.length < 6) return null;
  const addField = parts[3];
  const slash = addField.indexOf('/');
  let add = addField;
  let cont = null;
  if (slash >= 0) {
    add = addField.slice(0, slash);
    cont = addField.slice(slash + 1);
  }
  if (add === '0') add = ''; // "0" = add nothing
  return {
    strip: parts[2] === '0' ? '' : parts[2],
    add,
    cond: parts[4],
    morph: parts[5],
    cont,
  };
}

export function parseDic(text) {
  const lines = text.split('\n');
  const entries = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\s+#.*$/, '').trim();
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const wordPart = line.slice(0, tab);
    const posAlias = Number(line.slice(tab + 1).trim());
    const slash = wordPart.indexOf('/');
    const word = slash >= 0 ? wordPart.slice(0, slash) : wordPart;
    const flagStr = slash >= 0 ? wordPart.slice(slash + 1) : '';
    entries.push({ word, flags: flagStr ? flagStr.split('/').filter(Boolean) : [], posAlias });
  }
  return entries;
}

// --- Condition matching ------------------------------------------------------

/** Hunspell suffix condition. Matches the last N characters of the word, where
 *  `[abc]`/`[^abc]` classes count as a single position and `.` matches any. */
function condMatch(cond, word) {
  if (cond === '.' || cond === '') return true;
  const positions = [];
  for (let i = 0; i < cond.length; i++) {
    if (cond[i] === '[') {
      const j = cond.indexOf(']', i);
      if (j < 0) return false;
      positions.push(cond.slice(i, j + 1));
      i = j;
    } else {
      positions.push(cond[i]);
    }
  }
  if (positions.length > word.length) return false;
  const start = word.length - positions.length;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const wc = word[start + i];
    if (p[0] === '[') {
      const neg = p[1] === '^';
      const set = neg ? p.slice(2, -1) : p.slice(1, -1);
      const inSet = set.includes(wc);
      if (neg ? inSet : !inSet) return false;
    } else if (p !== wc) {
      return false;
    }
  }
  return true;
}

// --- Expansion ---------------------------------------------------------------

const MARKER_FLAGS = new Set(['65520', '65521']);

/**
 * Expand one dictionary entry into { surface, tags[] } records.
 * `tags` always starts with the part-of-speech tag (from the .dic row).
 */
export function expandEntry(entry, aff) {
  // The base morph can be a single "po:..." tag or, rarely, a multi-tag string
  // such as "po:noun is:Masc" (nouns with an explicitly declared gender).
  const poTags = (aff.am.get(entry.posAlias) || 'po:noun').split(/\s+/).filter(Boolean);
  const results = new Map(); // surface -> array of tag-arrays (unique)

  const record = (surface, tags) => {
    const key = surface + '\u0000' + tags.join('\u0001');
    if (!results.has(surface)) results.set(surface, []);
    const list = results.get(surface);
    if (!list.some((t) => t.join() === tags.join())) list.push(tags);
  };

  // A flag reference (from .dic or a continuation class) is an AF group number;
  // expand it to the raw SFX/PFX flags it bundles. Fall back to a raw flag when
  // there is no AF group with that number.
  const resolveFlags = (flags) => {
    const out = [];
    for (const f of flags) {
      const group = aff.af.get(Number(f));
      if (group) out.push(...group.filter((g) => !MARKER_FLAGS.has(g)));
      else out.push(f);
    }
    return out;
  };

  const initialFlags = resolveFlags(entry.flags);

  if (!initialFlags.length) {
    // Indeclinable word: only the bare form exists.
    record(entry.word, poTags);
    return [...results.entries()].map(([surface, tags]) => ({ surface, tags: tags[0] }));
  }

  const walk = (word, tags, flags, depth) => {
    if (depth > 6) return; // safety against pathological continuation loops
    for (const flag of flags) {
      const rules = aff.sfx.get(flag) || [];
      for (const r of rules) {
        if (!word.endsWith(r.strip)) continue;
        if (!condMatch(r.cond, word)) continue;
        const stem = word.slice(0, word.length - r.strip.length);
        const surface = stem + r.add;
        const morph = String(aff.am.get(Number(r.morph)) || r.morph).split(/\s+/).filter(Boolean);
        const newTags = [...tags, ...morph];
        record(surface, newTags);
        if (r.cont) walk(surface, newTags, resolveFlags([r.cont]), depth + 1);
      }
    }
  };

  walk(entry.word, poTags, initialFlags, 0);

  // If no affix rule regenerated the bare lemma (should not normally happen for
  // declinable words, since paradigms include a null rule), keep the bare form.
  if (!results.has(entry.word)) {
    record(entry.word, poTags);
  }

  // Drop tag-sets that are a proper subset of another tag-set for the same
  // surface. These are intermediate continuation forms (e.g. a comparative
  // "gražesnis" tagged only is:Comp before the case-ending rules applied);
  // only the fully-inflected analyses should remain.
  const isSubset = (a, b) => a.every((t) => b.includes(t));
  const out = [];
  for (const [surface, tagSets] of results) {
    const maximal = tagSets.filter(
      (tags) => !tagSets.some((other) => other !== tags && tags.length < other.length && isSubset(tags, other)),
    );
    for (const tags of maximal) out.push({ surface, tags });
  }
  return out;
}

// --- Tag -> canonical feature mapping ----------------------------------------

export const POS_MAP = {
  'po:noun': 'daiktavardis',
  'po:noun_first_name': 'daiktavardis',
  'po:noun_family_name': 'daiktavardis',
  'po:noun_geographic_name': 'daiktavardis',
  'po:noun_proper_name': 'daiktavardis',
  'po:noun_reflexive': 'daiktavardis',
  'po:adjective': 'būdvardis',
  'po:verb': 'veiksmažodis',
  'po:verb_reflexive': 'veiksmažodis',
  'po:verb_negative': 'veiksmažodis',
  'po:verb_reflexive_negative': 'veiksmažodis',
  'po:numeral_cardinal': 'skaitvardis',
  'po:numeral_ordinal': 'skaitvardis',
  'po:numeral_roman': 'skaitvardis',
  'po:pronoun': 'įvardis',
  'po:adverb': 'prieveiksmis',
  'po:preposition_Gen': 'prielinksnis',
  'po:preposition_Acc': 'prielinksnis',
  'po:preposition_Dat': 'prielinksnis',
  'po:preposition_Inst': 'prielinksnis',
  'po:conjunction': 'jungtukas',
  'po:particle': 'dalelytė',
  'po:interjection': 'jaustukas',
  'po:onomatopoeic': 'ištiktukas',
  'po:abbreviation': 'santrumpa',
  'po:acronym': 'santrumpa',
};

/** Strip variant suffixes like `_short`, `_rare`, `_deprecated`, `_long`. */
function stripVariants(tag) {
  let t = tag;
  for (;;) {
    const m = t.match(/_(short|rare|deprecated|long)$/);
    if (!m) return t;
    t = t.slice(0, -m[1].length - 1);
  }
}

const CASE_MAP = { Nom: 'V', Gen: 'K', Dat: 'N', Acc: 'G', Inst: 'IN', Loc: 'VT', Voc: 'S', Il: 'IL' };
const TENSE_MAP = { Pres: 'pres', Past: 'past', PastFreq: 'pastFreq', Fut: 'fut' };

function personFrom(sgPl, roman) {
  if (roman === 'III') return 'p3';
  if (sgPl === 'Sg') return roman === 'I' ? 'p1' : 'p2';
  return roman === 'I' ? 'p1p' : 'p2p';
}

/** Map a set of tags (["po:...", "is:...", ...]) to canonical feature columns. */
export function mapTags(tags) {
  const f = {
    pos: null,
    gender: null,
    case_: null,
    number: null,
    person: null,
    tense: null,
    mood: null,
    degree: null,
    definiteness: null,
    form_kind: null,
    participle: null,
    reflexive: 0,
    dropped: false,
  };

  for (const raw of tags) {
    if (raw.startsWith('po:')) {
      f.pos = POS_MAP[raw] || null;
      if (raw.includes('reflexive')) f.reflexive = 1;
      continue;
    }
    if (!raw.startsWith('is:')) continue;
    const t = stripVariants(raw.slice(3));

    // "Principal form" markers (IForm/PrForm/PsForm) are inherited through the
    // continuation classes and carry no independent analysis of their own, so
    // they are simply ignored.
    if (t === 'IForm' || t === 'PrForm' || t === 'PsForm') continue;
    if (t === 'Supine') { f.form_kind = 'supynas'; continue; }
    if (t === 'Vadv') { f.form_kind = 'būdinys'; continue; }

    // Degree / definiteness (standalone tags, combined via continuation).
    if (t === 'Comp_Def' || t === 'Comp_Dmn_Def') { f.degree = 'comp'; f.definiteness = 'def'; continue; }
    if (t === 'Super_Def') { f.degree = 'sup'; f.definiteness = 'def'; continue; }
    if (t === 'Comp' || t === 'Comp_Dmn') { f.degree = 'comp'; continue; }
    if (t === 'Super') { f.degree = 'sup'; continue; }
    if (t === 'Def') { f.definiteness = 'def'; continue; }
    if (t === 'Neut') { f.gender = 'n'; continue; }
    if (t === 'Neut_Comp' || t === 'Neut_Comp_Dmn') { f.gender = 'n'; f.degree = 'comp'; continue; }
    if (t === 'Neut_Super') { f.gender = 'n'; f.degree = 'sup'; continue; }

    if (t === 'Inf') { f.form_kind = 'pagr. f.'; continue; }

    if (t.startsWith('Gerund_')) { f.form_kind = 'padalyvis'; f.tense = TENSE_MAP[t.slice(7)] || null; continue; }

    if (t.startsWith('HalfPart_')) { f.form_kind = 'pusdalyvis'; applyNominal(f, t.slice(9)); continue; }

    const part = t.match(/^Part_(Act|Pass|Nec)_([A-Za-z]+)_(.+)$/);
    if (part) {
      f.form_kind = 'dalyvis';
      f.participle = part[1] === 'Act' ? 'veik' : part[1] === 'Pass' ? 'nev' : 'reik';
      f.tense = TENSE_MAP[part[2]] || null;
      let tail = part[3];
      if (tail.startsWith('Def_')) { f.definiteness = 'def'; tail = tail.slice(4); }
      if (tail === 'Neut') { f.gender = 'n'; }
      else applyNominal(f, tail);
      continue;
    }

    const fin = t.match(/^(Indic|Subj|Imper)_(.+)$/);
    if (fin) {
      const kind = fin[1];
      f.mood = kind === 'Indic' ? 'ind' : kind === 'Subj' ? 'subj' : 'imp';
      let rest = fin[2];
      if (kind === 'Indic') {
        const m = rest.match(/^(Pres|Past|PastFreq|Fut)_/);
        if (m) { f.tense = TENSE_MAP[m[1]]; rest = rest.slice(m[1].length + 1); }
      }
      if (rest === 'III') {
        f.person = 'p3';
      } else {
        const m = rest.match(/^(Sg|Pl)_(I|II)$/);
        if (m) f.person = personFrom(m[1], m[2]);
      }
      continue;
    }

    // Plain nominal tag: e.g. Masc_Sg_Nom, Fem_Pl_Gen, PlT_Masc_Pl_Dat, Coll_Masc_Sg_Nom
    applyNominal(f, t);
  }

  // Adjectives always carry degree and definiteness; the positive/indefinite
  // values are implicit in the source tags but shown explicitly by the
  // reference site ("nelyg. l.", "neįv. f.") and required by the renderer.
  if (f.pos === 'būdvardis' && !f.dropped) {
    if (!f.degree) f.degree = 'pos';
    if (!f.definiteness) f.definiteness = 'indef';
  }

  return f;
}

function applyNominal(f, t) {
  let rest = t;
  if (rest.startsWith('PlT_')) rest = rest.slice(4);
  else if (rest.startsWith('Coll_')) rest = rest.slice(5);

  if (rest.startsWith('Masc')) { f.gender = 'm'; rest = rest.slice(4); }
  else if (rest.startsWith('Fem')) { f.gender = 'f'; rest = rest.slice(3); }
  else if (rest.startsWith('Neut')) { f.gender = 'n'; rest = rest.slice(4); }
  // Personal pronouns use gender-less tags ("Sg_Nom", "Pl_Gen", ...).

  rest = rest.replace(/^_/, '');
  if (!rest) return;

  rest = rest.replace(/_possessive$/, '');

  if (rest.startsWith('Sg')) { f.number = 'vns'; rest = rest.slice(2); }
  else if (rest.startsWith('Pl')) { f.number = 'dgs'; rest = rest.slice(2); }
  else if (rest.startsWith('Dual')) { f.number = 'dual'; rest = rest.slice(4); }
  // else: no number segment (e.g. "Masc_Nom" -> case only)

  rest = rest.replace(/^_/, '');
  if (!rest) return; // e.g. "Masc_Sg" (pusdalyvis: no case)

  if (CASE_MAP[rest]) f.case_ = CASE_MAP[rest];
}
