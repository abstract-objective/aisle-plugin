// The gap check (D128 (b), job gc1): for each area of the company map, where it lives in a plan, or
// MISSING, or SCATTERED, with the job ids that say so. Pure: it reads a parsed plan (parsePlan's result)
// and the map, and does no I/O. Rules (research/gc1-gaps/00-plan.md, 02-plan-gaps.md's verdicts):
//   covered   one place holds the area: a Domain or Sub-domain whose title names it (the map's home words),
//             or, with no named home, all its jobs sit in one domain. Jobs elsewhere are outliers.
//   scattered jobs in two or more domains and no place names the area.
//   missing   no job names the area, or a part the area needs has no job (the covered parts are said).
//   partial   only jobs that touch the area (02's "for evidence only").
//   later     a LATER area whose only lines wait: parked jobs, or jobs that only touch it.
// An area AIsle itself gives every project (the map's `aisle`: the goal file, the plan, the walls) and that has no
// job lives there ("AIsle: aisle/GOAL.md"), so a new project's plan is not told it misses its own goal.
// A closed job never counts; parked and done jobs do, as in 02 (c9 and c6 parked, d16 done).
import { COMPANY_MAP, FIRST_JOBS, DEPT_NAMES } from './company-map.mjs';

export const VERDICTS = ['covered', 'scattered', 'missing', 'partial', 'later'];

const hits = (words, text) => (words || []).some((w) => w.test(String(text || '')));
// A job is read by its title; a parked or shelf idea also by its note, which holds the idea's research (02 read
// c6's "a merchant of record" there).
const shelved = (j) => Boolean(j.parked) || j.step === 'shelf';
const textOf = (j) => (shelved(j) ? [j.title, j.parked?.words, j.parked?.reason, j.waitNote] : [j.title]).filter(Boolean).join(' ');
const short = (title) => String(title || '').replace(/\s*\(.*$/, '').trim();

function placeOf(node) {
  let sub = null;
  for (let n = node.parent; n; n = n.parent) {
    if (n.kind === 'Sub-domain' && !sub) sub = n;
    if (n.kind === 'Domain') return { dom: n, sub };
  }
  return { dom: null, sub };
}

const under = (node, place) => {
  for (let n = node.parent; n; n = n.parent) if (n === place) return true;
  return false;
};

const pathOf = (place) => {
  if (!place) return '';
  if (place.kind === 'Domain') return short(place.title);
  const { dom } = placeOf(place);
  return dom ? `${short(dom.title)} → ${short(place.title)}` : short(place.title);
};

function judge(area, jobs, places, texts) {
  const homes = places.filter((p) => hits(area.home, p.title));
  const homed = new Map(homes.map((h) => [h, jobs.filter((j) => under(j, h))]));
  const named = jobs.filter((j) => hits(area.words, texts.get(j)));
  const parts = (area.parts || []).map((p) => ({ name: p.name, need: Boolean(p.need), jobs: jobs.filter((j) => hits(p.words, texts.get(j))) }));
  const found = new Set([...named, ...parts.flatMap((p) => p.jobs)]);
  for (const list of homed.values()) for (const j of list) found.add(j); // a home's jobs are the area's
  const touched = area.touch ? jobs.filter((j) => !found.has(j) && hits(area.touch, texts.get(j))) : [];
  const all = [...found];
  const ids = (list) => list.map((j) => j.id);
  const byDomain = new Map();
  for (const j of all) {
    const key = pathOf(placeOf(j).dom) || '(no domain)';
    byDomain.set(key, [...(byDomain.get(key) || []), j.id]);
  }
  const row = {
    id: area.id, name: area.name, dept: area.dept, when: area.when, first: area.first || '',
    verdict: '', lives: '', jobs: ids(all), touch: ids(touched),
    domains: [...byDomain].map(([place, list]) => ({ place, jobs: list })),
    parts: parts.map((p) => ({ name: p.name, need: p.need, jobs: ids(p.jobs) })),
    missingParts: parts.filter((p) => !p.jobs.length).map((p) => p.name),
  };
  const later = area.when === 'later';
  if (!all.length) {
    if (area.aisle && !touched.length) { row.verdict = 'covered'; row.lives = `AIsle: ${area.aisle}`; return row; }
    row.verdict = touched.length ? (later ? 'later' : 'partial') : 'missing';
    return row;
  }
  if (parts.some((p) => p.need && !p.jobs.length)) { row.verdict = 'missing'; return row; }
  if (later && all.every((j) => j.parked)) { row.verdict = 'later'; return row; }
  // The narrowest home that holds jobs: a Sub-domain before a Domain, then the one with the most jobs.
  const ranked = homes
    .map((h) => ({ h, n: homed.get(h).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => (a.h.kind === b.h.kind ? 0 : a.h.kind === 'Sub-domain' ? -1 : 1) || b.n - a.n);
  if (ranked.length) { row.verdict = 'covered'; row.lives = pathOf(ranked[0].h); return row; }
  if (byDomain.size === 1) { row.verdict = 'covered'; row.lives = [...byDomain.keys()][0]; return row; }
  row.verdict = 'scattered';
  return row;
}

// gapReport(plan, map): one row per area, in the map's order.
export function gapReport(plan, map = COMPANY_MAP) {
  const nodes = plan?.nodes || [];
  const jobs = nodes.filter((n) => n.kind === 'Job' && !n.closed);
  const places = nodes.filter((n) => n.kind === 'Domain' || n.kind === 'Sub-domain');
  const texts = new Map(jobs.map((j) => [j, textOf(j)]));
  return map.areas.map((area) => judge(area, jobs, places, texts));
}

// The areas a project needs now and has no job for: what read_plan, the plan page and bring-project name.
export const missingNow = (report) => report.filter((r) => r.verdict === 'missing' && r.when === 'now');

// The map in plain words for people: aisle/COMPANY-MAP.md is this text (a test holds the two equal).
export function mapText(map = COMPANY_MAP) {
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|');
  const out = [
    '# The company map',
    '',
    `The areas a software product company needs, each marked now or later (D128 (b), job gc1; version ${map.version}).`,
    'From `research/plan-gaps/01-company-map.md`; the data is `engine/aisle/company-map.mjs`, and this file is made',
    "from it (`mapText` in `engine/aisle/gaps.mjs`). The gap check reads a plan against it: each area lives in a place,",
    'is SCATTERED over several domains, or is MISSING. read_plan, the plan page and bring-project name the missing',
    'now-areas; bring-project offers the first job below for each, added only on the person\'s yes.',
  ];
  for (const dept of Object.keys(DEPT_NAMES)) {
    const areas = map.areas.filter((a) => a.dept === dept);
    if (!areas.length) continue;
    out.push('', `## ${DEPT_NAMES[dept]}`, '', '| id | Area | When | AIsle gives it | First job offered |', '|---|---|---|---|---|');
    for (const a of areas) {
      const j = FIRST_JOBS[a.id];
      out.push(`| ${a.id} | ${cell(a.name)} | ${a.when} | ${cell(a.aisle || '')} | ${j ? cell(`${j.title} (05's ${j.from})`) : ''} |`);
    }
  }
  return `${out.join('\n')}\n`;
}

// The line read_plan's head carries (planReport's `gaps`): the missing now-areas of a parsed plan, or ''.
export const planGaps = (plan) => gapLine(gapReport(plan));

export const GAP_LINE_MAX = 300;
export const GAP_HEAD = 'Missing for now (company map): ';
// One short line: "Missing for now (company map): docs, a support channel, a trust page."
export function gapLine(report, { max = GAP_LINE_MAX } = {}) {
  const names = missingNow(report).map((r) => r.name);
  if (!names.length) return '';
  const head = GAP_HEAD;
  let line = `${head}${names.join(', ')}.`;
  if (line.length <= max) return line;
  const kept = [];
  for (const n of names) {
    const more = names.length - kept.length - 1;
    const next = `${head}${[...kept, n].join(', ')} and ${more} more.`;
    if (next.length > max) break;
    kept.push(n);
  }
  return `${head}${kept.join(', ')} and ${names.length - kept.length} more.`;
}
