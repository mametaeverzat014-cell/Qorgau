/**
 * Verifies every URL in the university dataset actually resolves.
 *
 * Run it from any machine with normal internet access:
 *     npm run check:links
 *
 * Why this exists: the first version of the dataset used deep paths such as
 * /international-applicants and /tuition-fees, written from memory. University
 * sites reorganise those constantly and several 404'd in production. A broken
 * "official source" link is worse than none, because the whole data-honesty
 * claim rests on them. This script makes that failure mode impossible to ship
 * unnoticed.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/data/universities.ts', import.meta.url), 'utf8');

const records = [];
for (const block of src.split(/(?=\n  \{\n    id: ')/)) {
  const id = block.match(/id: '([a-z0-9-]+)'/)?.[1];
  if (!id) continue;
  const fields = {};
  for (const key of ['officialUrl', 'scholarshipUrl', 'admissions', 'tuition', 'scholarships']) {
    const url = block.match(new RegExp(`${key}: '(https://[^']+)'`))?.[1];
    if (url) fields[key] = url;
  }
  records.push({ id, fields });
}

const unique = new Map();
for (const { id, fields } of records) {
  for (const [key, url] of Object.entries(fields)) {
    if (!unique.has(url)) unique.set(url, []);
    unique.get(url).push(`${id}.${key}`);
  }
}

console.log(`Checking ${unique.size} unique URLs across ${records.length} universities...\n`);

const TIMEOUT_MS = 20000;

async function probe(url) {
  const attempt = async (method) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          // Some university sites reject unknown agents outright.
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml',
        },
      });
      return res.status;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    // HEAD first; several sites answer 403/405 to HEAD but serve GET fine.
    const head = await attempt('HEAD');
    if (head < 400) return { ok: true, status: head };
    const get = await attempt('GET');
    return { ok: get < 400, status: get };
  } catch (err) {
    return { ok: false, status: err.name === 'AbortError' ? 'timeout' : 'network error' };
  }
}

const failures = [];
let done = 0;

const urls = [...unique.keys()];
const CONCURRENCY = 6;

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (urls.length) {
      const url = urls.pop();
      const { ok, status } = await probe(url);
      done++;
      process.stdout.write(`\r  ${done}/${unique.size} checked`);
      if (!ok) failures.push({ url, status, used: unique.get(url) });
    }
  }),
);

console.log('\n');
if (failures.length === 0) {
  console.log(`All ${unique.size} URLs resolved successfully.`);
  process.exit(0);
}

console.log(`${failures.length} URL(s) did NOT resolve:\n`);
for (const f of failures) {
  console.log(`  [${f.status}] ${f.url}`);
  console.log(`      used by: ${f.used.join(', ')}\n`);
}
console.log('Fix these in src/data/universities.ts before shipping.');
process.exit(1);
