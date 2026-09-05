// Renders a lemma's inflection paradigm as HTML for each part of speech.

import { esc } from './util.js';
import { GENDER, CASE, PERSON, DEGREE, DEFINITENESS, PARTICIPLE, FORM_KIND, analysis } from './tags.js';

const CASES = ['V', 'K', 'N', 'G', 'IN', 'VT', 'S'];
const NUMBERS = ['vns', 'dgs'];
const NUMBER_HEADER = { vns: 'Vienaskaita', dgs: 'Daugiskaita', dual: 'Dviskaita' };
const PERSONS = ['p1', 'p2', 'p3', 'p1p', 'p2p', 'p3p'];
const TENSES = ['pres', 'past', 'pastFreq', 'fut'];
const GENDERS = ['m', 'f', 'n'];

const DEGREE_SECTION = {
  pos: 'Nelyginamasis laipsnis:',
  comp: 'Aukštesnysis laipsnis:',
  sup: 'Aukščiausiasis laipsnis:',
};
const DEF_SECTION = { indef: 'Neįvardžiuotinės formos', def: 'Įvardžiuotinės formos' };
const GENDER_SECTION = { m: 'Vyriškoji giminė', f: 'Moteriškoji giminė', n: 'Bevardė giminė' };
const TENSE_SECTION = {
  pres: 'Esamasis laikas',
  past: 'Būtasis kartinis laikas',
  pastFreq: 'Būtasis dažninis',
  fut: 'Būsimasis laikas',
};
const PARTICIPLE_SECTION = {
  veik: 'Veikiamosios rūšies dalyvis',
  nev: 'Neveikiamosios rūšies dalyvis',
  reik: 'Reikiamybės dalyvis',
};

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Distinct, deterministically-ordered list of values. */
function sortedUnique(list) {
  return [...new Set(list)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Cell content. Only masculine forms carry the "(vyr. g.)" gender annotation,
 *  exactly as on the original site (feminine/neuter cells are unannotated). */
function cellHtml(forms, pred) {
  const matches = forms.filter(pred);
  if (!matches.length) return '';
  const text = sortedUnique(matches.map((f) => f.surface)).join(', ');
  const g = matches[0].gender;
  const hint = g === 'm' ? ` <span class="g">(${esc(GENDER.m)})</span>` : '';
  return `${esc(text)}${hint}`;
}

function cellText(forms, pred) {
  return sortedUnique(forms.filter(pred).map((f) => f.surface)).join(', ');
}

/** Case × number grid. Illative (Il.) and dual (Dviskaita) columns are shown
 *  only when the paradigm actually has such forms. */
function caseNumberGrid(forms, { cases, numbers } = {}) {
  const hasIl = forms.some((f) => f.case_ === 'IL');
  const hasDual = forms.some((f) => f.number === 'dual');
  const casesList = cases || (hasIl ? [...CASES, 'IL'] : CASES);
  const numbersList = numbers || (hasDual ? [...NUMBERS, 'dual'] : NUMBERS);

  let html = '<table class="grid"><thead><tr><th></th>';
  for (const n of numbersList) html += `<th>${NUMBER_HEADER[n]}</th>`;
  html += '</tr></thead><tbody>';
  for (const c of casesList) {
    html += `<tr><th class="case">${CASE[c]}</th>`;
    for (const n of numbersList) {
      html += `<td>${cellHtml(forms, (f) => f.case_ === c && f.number === n)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

// ---------------------------------------------------------------------------
// Nouns
// ---------------------------------------------------------------------------
export function renderNoun(forms) {
  return `<div class="paradigm">${caseNumberGrid(forms)}</div>`;
}

// ---------------------------------------------------------------------------
// Adjectives (degree × definiteness × gender × case × number)
// ---------------------------------------------------------------------------
export function renderAdjective(forms) {
  let html = '<div class="paradigm"><div class="pos-line">Kalbos dalis: būdvardis</div>';
  for (const d of ['pos', 'comp', 'sup']) {
    const dForms = forms.filter((f) => f.degree === d);
    if (!dForms.length) continue;
    html += `<section class="degree"><h4>${DEGREE_SECTION[d]}</h4>`;
    for (const def of ['indef', 'def']) {
      const defForms = dForms.filter((f) => f.definiteness === def);
      if (!defForms.length) continue;
      html += `<div class="def"><h5>${DEF_SECTION[def]}</h5>`;
      for (const g of GENDERS) {
        const gForms = defForms.filter((f) => f.gender === g);
        if (!gForms.length) continue;
        html += `<div class="gender"><h6>${GENDER_SECTION[g]}</h6>${caseNumberGrid(gForms)}</div>`;
      }
      html += '</div>';
    }
    html += '</section>';
  }
  html += '</div>';
  return html;
}

// ---------------------------------------------------------------------------
// Verbs (moods × tenses × persons, plus non-finite forms)
// ---------------------------------------------------------------------------
function verbMoodGrid(forms, { title, columns }) {
  let html = `<section class="mood"><h4>${title}</h4>`;
  html += '<table class="grid"><thead><tr><th></th>';
  for (const col of columns) html += `<th>${col.label}</th>`;
  html += '</tr></thead><tbody>';
  for (const p of PERSONS) {
    // Lithuanian 3rd-person verb forms are number-neutral, so the same forms
    // fill both the "Jis/ji" (p3) and "Jie/jos" (p3p) rows.
    const personCode = p === 'p3p' ? 'p3' : p;
    html += `<tr><th class="person">${cap(PERSON[p])}</th>`;
    for (const col of columns) {
      html += `<td>${cellText(forms, (f) => f.person === personCode && col.pred(f)) || '-'}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table></section>';
  return html;
}

export function renderVerb(forms) {
  let html = '<div class="paradigm">';

  const ind = forms.filter((f) => f.mood === 'ind');
  if (ind.length) {
    html += verbMoodGrid(ind, {
      title: 'Tiesioginė nuosaka',
      columns: TENSES.map((t) => ({ label: TENSE_SECTION[t], pred: (f) => f.tense === t })),
    });
  }
  for (const [mood, title] of [
    ['subj', 'Tariamoji nuosaka'],
    ['imp', 'Liepiamoji nuosaka'],
  ]) {
    const m = forms.filter((f) => f.mood === mood);
    if (!m.length) continue;
    html += verbMoodGrid(m, {
      title,
      columns: [{ label: '', pred: () => true }],
    });
  }

  html += renderVerbNonFinite(forms);
  html += '</div>';
  return html;
}

function renderVerbNonFinite(forms) {
  const nf = forms.filter((f) => f.form_kind && f.form_kind !== 'pagr. f.');
  if (!nf.length) return '';

  let html = '<section class="nonfinite">';

  // Participles decline like adjectives, grouped by voice and tense.
  const participles = nf.filter((f) => f.form_kind === 'dalyvis');
  for (const pk of ['veik', 'nev', 'reik']) {
    const pForms = participles.filter((f) => f.participle === pk);
    if (!pForms.length) continue;
    for (const t of TENSES) {
      const tForms = pForms.filter((f) => f.tense === t);
      if (!tForms.length) continue;
      html += `<div class="def"><h5>${PARTICIPLE_SECTION[pk]} · ${TENSE_SECTION[t]}</h5>`;
      for (const g of GENDERS) {
        const gForms = tForms.filter((f) => f.gender === g);
        if (!gForms.length) continue;
        html += `<div class="gender"><h6>${GENDER_SECTION[g]}</h6>${caseNumberGrid(gForms)}</div>`;
      }
      html += '</div>';
    }
  }

  // Indeclinable non-finite forms: pusdalyvis, padalyvis, supynas, būdinys.
  for (const fk of ['pusdalyvis', 'padalyvis', 'bendratis', 'supynas', 'būdinys']) {
    const fkForms = nf.filter((f) => f.form_kind === fk);
    if (!fkForms.length) continue;
    const items = sortedUnique(fkForms.map((f) => `${f.surface} — ${analysis(f.pos, f)}`));
    html += `<div class="def"><h5>${FORM_KIND[fk] ?? fk}</h5><ul class="plain">${items
      .map((i) => `<li>${esc(i)}</li>`)
      .join('')}</ul></div>`;
  }

  html += '</section>';
  return html;
}

// ---------------------------------------------------------------------------
// Numerals, pronouns, participles (nominal grids)
// ---------------------------------------------------------------------------
function renderNominal(forms) {
  const dual = forms.filter((f) => f.number === 'dual');
  const main = forms.filter((f) => f.number !== 'dual');

  let html = '<div class="paradigm">';
  const genders = sortedUnique(main.map((f) => f.gender).filter(Boolean));
  if (genders.length > 1) {
    for (const g of GENDERS) {
      const gForms = main.filter((f) => f.gender === g);
      if (!gForms.length) continue;
      html += `<div class="gender"><h6>${GENDER_SECTION[g]}</h6>${caseNumberGrid(gForms)}</div>`;
    }
  } else {
    html += caseNumberGrid(main);
  }

  // Dual forms are gender-specific and number-only (dviskaita).
  if (dual.length) {
    html += '<section class="dual"><h5>Dviskaita</h5>';
    for (const g of GENDERS) {
      const gForms = dual.filter((f) => f.gender === g);
      if (!gForms.length) continue;
      html += `<div class="gender"><h6>${GENDER_SECTION[g]}</h6>${caseNumberGrid(gForms, { numbers: ['dual'] })}</div>`;
    }
    const genderless = dual.filter((f) => !f.gender);
    if (genderless.length) html += caseNumberGrid(genderless, { numbers: ['dual'] });
    html += '</section>';
  }
  html += '</div>';
  return html;
}

// ---------------------------------------------------------------------------
// Invariable words (adverbs, particles, prepositions, ...)
// ---------------------------------------------------------------------------
function renderInvariable(forms) {
  const items = sortedUnique(forms.map((f) => f.surface));
  return `<div class="paradigm"><p class="invariable">${items.map((s) => esc(s)).join(', ')}</p></div>`;
}

/** Dispatch to the correct renderer based on the part of speech. */
export function renderParadigm(forms) {
  const pos = forms[0]?.pos;
  switch (pos) {
    case 'daiktavardis':
      return renderNoun(forms);
    case 'būdvardis':
      return renderAdjective(forms);
    case 'veiksmažodis':
      return renderVerb(forms);
    case 'skaitvardis':
    case 'įvardis':
    case 'dalyvis':
      return renderNominal(forms);
    default:
      return renderInvariable(forms);
  }
}
