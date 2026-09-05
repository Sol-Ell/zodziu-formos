// Dev helper: expand a lemma and print its forms + mapped analysis.
// Usage: node scripts/preview.mjs <word> [<word> ...]
import { readFileSync } from 'node:fs';
import { parseAff, parseDic, expandEntry, mapTags } from './lib/hunspell.js';
import { analysis } from '../src/tags.js';

const aff = parseAff(readFileSync(process.env.AFF || 'data/source/lt_LT.aff', 'utf8'));
const dic = parseDic(readFileSync(process.env.DIC || 'data/source/lt_LT.dic', 'utf8'));

for (const word of process.argv.slice(2)) {
  const entries = dic.filter((e) => e.word === word);
  console.log(`\n########## ${word} (${entries.length} dict entr${entries.length === 1 ? 'y' : 'ies'}) ##########`);
  if (!entries.length) {
    console.log('  (not found in dictionary)');
    continue;
  }
  for (const e of entries) {
    const forms = expandEntry(e, aff);
    console.log(`  -- entry "${e.word}" flags=[${e.flags}] posAlias=${e.posAlias} -> ${forms.length} forms`);
    const seen = new Map();
    for (const { surface, tags } of forms) {
      const f = mapTags(tags);
      if (f.dropped) continue;
      const a = analysis(f.pos, f);
      const key = a;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(surface);
    }
    for (const [a, surfaces] of [...seen.entries()].sort()) {
      console.log(`    ${surfaces.join(', ')}  =>  ${a}`);
    }
  }
}
