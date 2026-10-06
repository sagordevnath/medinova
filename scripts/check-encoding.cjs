// Checks whether non-ASCII text in source files is real UTF-8 or literal
// '?' replacement characters (a sign the file was written with the wrong
// encoding). Reads bytes and decodes explicitly rather than trusting stdout.
const fs = require('node:fs');

const files = process.argv.slice(2);
let bad = 0;

for (const f of files) {
  const buf = fs.readFileSync(f);
  const text = buf.toString('utf8');
  const lines = text.split('\n');

  let bangla = 0;
  let questionRuns = 0;
  const offenders = [];

  lines.forEach((l, i) => {
    // Bengali block U+0980–U+09FF.
    if (/[\u0980-\u09FF]/.test(l)) bangla++;
    // Four or more consecutive '?' is a classic mojibake/replacement run.
    const m = l.match(/\?{4,}/g);
    if (m) {
      questionRuns += m.length;
      if (offenders.length < 3) offenders.push(i + 1);
    }
  });

  // U+FFFD is the actual Unicode replacement character.
  const fffd = (text.match(/\uFFFD/g) || []).length;

  if (questionRuns || fffd) {
    bad++;
    console.log(
      `SUSPECT ${f}\n         question-runs=${questionRuns} replacement-chars=${fffd} firstLines=${offenders.join(',')}`,
    );
  } else {
    console.log(`ok      ${f.padEnd(46)} banglaLines=${bangla}`);
  }
}
console.log(`\n${files.length - bad}/${files.length} files clean`);