// Grammatical tag set and Lithuanian abbreviation mapping.
//
// Canonical codes are stored in the database (so they can be sorted/grouped
// reliably); this module maps them to human-readable Lithuanian grammatical
// abbreviations and builds the "analysis" string for a word form.

// --- Parts of speech (displayed as-is) ------------------------------------
export const PARTS_OF_SPEECH = [
  'daiktavardis',
  'būdvardis',
  'veiksmažodis',
  'skaitvardis',
  'įvardis',
  'prieveiksmis',
  'prielinksnis',
  'jungtukas',
  'dalelytė',
  'jaustukas',
  'ištiktukas',
];

// --- Canonical code -> display label --------------------------------------
export const GENDER = { m: 'vyr. g.', f: 'mot. g.', n: 'bev. g.' };
export const CASE = { V: 'V.', K: 'K.', N: 'N.', G: 'G.', IN: 'Įn.', VT: 'Vt.', S: 'Š.', IL: 'Il.' };
export const NUMBER = { vns: 'vns.', dgs: 'dgs.', dual: 'dvs.' };
export const PERSON = { p1: 'aš', p2: 'tu', p3: 'jis/ji', p1p: 'mes', p2p: 'jūs', p3p: 'jie/jos' };
export const TENSE = {
  pres: 'es. l.',
  past: 'būt. k. l.',
  pastFreq: 'būt. d. l.',
  fut: 'būs. l.',
};
export const MOOD = { ind: 'ties. nuos.', subj: 'tar. nuos.', imp: 'liep. nuos.' };
export const DEGREE = { pos: 'nelyg. l.', comp: 'aukšt. l.', sup: 'aukšč. l.' };
export const DEFINITENESS = { indef: 'neįv. f.', def: 'įv. f.' };
export const PARTICIPLE = { veik: 'veik. r.', nev: 'nev. r.', reik: 'reik. r.' };
export const FORM_KIND = {
  'pagr. f.': 'pagr. f.',
  bendratis: 'bendratis',
  dalyvis: 'dalyvis',
  pusdalyvis: 'pusdalyvis',
  padalyvis: 'padalyvis',
  supynas: 'supynas',
  būdinys: 'būdinys',
};

// Sort ranks (lower = earlier) used when ordering paradigm cells.
export const RANK = {
  gender: { m: 0, f: 1, n: 2 },
  case_: { V: 0, K: 1, N: 2, G: 3, IN: 4, VT: 5, S: 6, IL: 7 },
  number: { vns: 0, dgs: 1, dual: 2 },
  person: { p1: 0, p2: 1, p3: 2, p1p: 3, p2p: 4, p3p: 5 },
  tense: { pres: 0, past: 1, pastFreq: 2, fut: 3 },
  mood: { ind: 0, subj: 1, imp: 2 },
  degree: { pos: 0, comp: 1, sup: 2 },
  definiteness: { indef: 0, def: 1 },
};

// Feature order within the analysis string, per part of speech.
const FEATURE_ORDER = {
  daiktavardis: ['gender', 'case_', 'number'],
  būdvardis: ['gender', 'case_', 'number', 'degree', 'definiteness'],
  skaitvardis: ['gender', 'case_', 'number', 'definiteness'],
  įvardis: ['person', 'gender', 'case_', 'number'],
  veiksmažodis: ['person', 'tense', 'mood'],
  dalyvis: ['gender', 'case_', 'number', 'participle'],
  default: ['gender', 'person', 'case_', 'number', 'tense', 'mood', 'degree', 'definiteness', 'participle'],
};

const LABEL = {
  gender: GENDER,
  case_: CASE,
  number: NUMBER,
  person: PERSON,
  tense: TENSE,
  mood: MOOD,
  degree: DEGREE,
  definiteness: DEFINITENESS,
  participle: PARTICIPLE,
};

/** Display label for one feature. */
export function label(feature, code) {
  if (feature === 'form_kind') return FORM_KIND[code] ?? code;
  return (LABEL[feature] && LABEL[feature][code]) ?? code;
}

/**
 * Build the full analysis string, e.g.
 *   "daiktavardis, vyr. g.,V.,vns." or "veiksmažodis, aš,es. l.,ties. nuos.".
 *
 * The original joins every token after the part of speech with a bare comma
 * (no following space); the part of speech itself is followed by ", ".
 */
export function analysis(pos, form) {
  // Non-finite verb forms (bendratis, dalyvis, pusdalyvis, padalyvis) have a
  // layout that differs from finite verb forms.
  if (pos === 'veiksmažodis') {
    if (form.form_kind === 'pagr. f.') return 'veiksmažodis, pagr. f.';

    if (form.form_kind === 'padalyvis') {
      const feats = form.tense ? [label('tense', form.tense)] : [];
      return `veiksmažodis, padalyvis${feats.length ? ',' + feats.join(',') : ''}`;
    }

    if (form.form_kind === 'pusdalyvis') {
      const feats = [];
      if (form.gender) feats.push(label('gender', form.gender));
      if (form.number) feats.push(label('number', form.number));
      return `veiksmažodis, pusdalyvis${feats.length ? ',' + feats.join(',') : ''}`;
    }

    if (form.form_kind === 'dalyvis') {
      const feats = [];
      if (form.participle) feats.push(label('participle', form.participle));
      if (form.tense) feats.push(label('tense', form.tense));
      if (form.gender) feats.push(label('gender', form.gender));
      if (form.case_) feats.push(label('case_', form.case_));
      if (form.number) feats.push(label('number', form.number));
      if (form.definiteness) feats.push(label('definiteness', form.definiteness));
      return feats.length ? `veiksmažodis, ${feats.join(',')}` : 'veiksmažodis, dalyvis';
    }

    if (form.form_kind === 'supynas') return 'veiksmažodis, supynas';
    if (form.form_kind === 'būdinys') return 'veiksmažodis, būdinys';
    // finite verbs fall through to the standard order below
  }

  const order = FEATURE_ORDER[pos] ?? FEATURE_ORDER.default;
  const feats = [];
  for (const key of order) {
    const code = form[key];
    if (code == null || code === '') continue;
    feats.push(label(key, code));
  }

  return feats.length ? `${pos}, ${feats.join(',')}` : pos;
}
