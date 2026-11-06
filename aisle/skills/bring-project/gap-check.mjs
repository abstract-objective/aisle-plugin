#!/usr/bin/env node
// bring-project's gap check (D128 (b), job gc1): reads the project's aisle/PLAN.md, says which areas of the company
// map (company-map.mjs, 49 areas a software product company needs) it has no job for, and offers one first job for
// each area missing now. It prints only: it writes no file and posts nothing. A first job goes into the plan only
// when the person says yes: `--add P5,C1` prints the lines for the areas they said yes to, optional until kept.
//   node gap-check.mjs --dir <the project's folder>            the missing now-areas, each with its first job
//   node gap-check.mjs --dir <the project's folder> --add P5   the plan lines for those areas, to paste
// gaps.mjs and company-map.mjs are the AO engine's own files (engine/aisle/), copied here byte for byte (a test).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gapReport, missingNow } from './gaps.mjs';
import { COMPANY_MAP, FIRST_JOBS, DEPT_NAMES } from './company-map.mjs';

const KIND = /^(\s*)(?:[-*]\s+|\d+\.\s+)?(Owner|Overseer|Domain|Sub[- ]?domain|Job)\b\s*([^:|]*?)\s*:\s*(.*)$/i;
const KINDS = { owner: 'Owner', overseer: 'Overseer', domain: 'Domain', 'sub-domain': 'Sub-domain', 'sub domain': 'Sub-domain', subdomain: 'Sub-domain', job: 'Job' };

// The plan's tree as the gap check reads it: each line's kind, id, title, parent, and the fields that say a job is
// closed, parked or on the shelf. engine/aisle/plan.mjs's parsePlan reads more; the test holds the two to the same
// verdicts on AO's plan.
export function readTree(text) {
  const nodes = [];
  const stack = [];
  for (const raw of String(text ?? '').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = KIND.exec(raw);
    if (!m) continue;
    const kind = KINDS[m[2].toLowerCase()] || '';
    if (!kind) continue;
    const indent = m[1].replace(/\t/g, '  ').length;
    const [title, ...fields] = m[4].split(/\s+\|\s+/);
    const node = { kind, id: kind === 'Job' ? m[3].trim() : '', title: title.trim(), indent, parent: null, closed: null, parked: null, step: '', waitNote: '' };
    for (const f of fields) {
      const fm = /^(closed|parked|blocks|step)\b\s*:?\s*(.*)$/i.exec(f.trim());
      if (!fm) continue;
      const key = fm[1].toLowerCase();
      if (key === 'closed') node.closed = { text: fm[2] };
      else if (key === 'parked') node.parked = { words: fm[2], reason: '' };
      else if (key === 'blocks') node.waitNote = fm[2];
      else node.step = fm[2].trim().toLowerCase();
    }
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    node.parent = stack.at(-1) || null;
    stack.push(node);
    nodes.push(node);
  }
  return { nodes };
}

// The missing now-areas of a plan's text that 05-first-jobs.md gives a first job, each with that job.
export function offers(text) {
  return missingNow(gapReport(readTree(text))).filter((row) => FIRST_JOBS[row.id])
    .map((row) => ({ id: row.id, name: row.name, dept: row.dept, job: FIRST_JOBS[row.id], covered: row.parts.filter((p) => p.jobs.length).map((p) => p.name) }));
}
// The missing now-areas with no first job to offer: named only.
export const unoffered = (text) => missingNow(gapReport(readTree(text))).filter((row) => !FIRST_JOBS[row.id]).map((row) => ({ id: row.id, name: row.name }));

// The plan lines for the areas the person said yes to: one Domain per department, tagged with it (D76), a Sub-domain,
// and the jobs, optional until kept. Ids are cm1, cm2, … unused in the plan. → { lines, refused }.
export function addLines(text, ids) {
  const want = [...new Set(String(ids ?? '').split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const open = offers(text);
  const picked = open.filter((o) => want.includes(o.id));
  const refused = want.filter((id) => !picked.some((o) => o.id === id));
  const tree = readTree(text);
  const used = new Set(tree.nodes.filter((n) => n.kind === 'Job').map((n) => n.id.toLowerCase()));
  const dom = tree.nodes.find((n) => n.kind === 'Domain');
  const pad = ' '.repeat(dom ? dom.indent : 4);
  let n = 0;
  const nextId = () => { do n++; while (used.has(`cm${n}`)); return `cm${n}`; };
  const lines = [];
  const notes = [];
  for (const dept of Object.keys(DEPT_NAMES)) {
    const here = picked.filter((o) => o.dept === dept);
    if (!here.length) continue;
    const title = `${DEPT_NAMES[dept]}, around the product (company map)`;
    const jobs = here.map((o) => `${pad}    Job ${nextId()}: ${o.job.title} | owner AI | agent none | status not started | priority optional | type ${o.job.type} | hours: ${o.job.hours} | Blocks: none | Done when: ${o.job.doneWhen}`);
    // A second yes later: the Domain an earlier one added is there already, so only its jobs go in, at its end.
    if (tree.nodes.some((n) => n.kind === 'Domain' && n.title === title)) notes.push({ under: `${title} → First jobs`, lines: jobs });
    else lines.push(`${pad}Domain: ${title} | dept ${dept}`, `${pad}  Sub-domain: First jobs`, ...jobs);
  }
  return { lines, refused, notes };
}

export function report(text, { file = 'aisle/PLAN.md', self = 'gap-check.mjs', dir = '.' } = {}) {
  const list = offers(text);
  const rest = unoffered(text);
  const head = `The company map (${COMPANY_MAP.areas.length} areas a software product company needs) against ${file}:`;
  const also = rest.length ? [`Also with no job, and no first job to offer: ${rest.map((r) => `${r.id} ${r.name}`).join(', ')}.`] : [];
  if (!list.length) return [`${head} every area this project needs now that has a first job to offer has a job. Nothing to offer.`, ...also].join('\n');
  return [
    `${head} ${list.length === 1 ? '1 area this project needs now has' : `${list.length} areas this project needs now have`} no job.`,
    ...list.map((o) => `- ${o.id} ${o.name} (${DEPT_NAMES[o.dept]})${o.covered.length ? `, though ${o.covered.join(' and ')} has a job` : ''}: first job "${o.job.title}", ${o.job.hours} ${o.job.hours === '1' ? 'hour' : 'hours'}, optional until kept.`),
    ...also,
    'None is added without a yes. Ask your user once which to add; then print their lines with',
    `  node "${self}" --dir "${dir}" --add ${list.map((o) => o.id).join(',')}`,
    'with only the ids they said yes to, and paste the lines into aisle/PLAN.md where its # lines say.',
  ].join('\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? '' : null; };
  const dir = opt('--dir') ?? '.';
  let text;
  try { text = readFileSync(join(dir, 'aisle', 'PLAN.md'), 'utf8'); } catch {
    console.log(`No aisle/PLAN.md in ${dir}: write the plan first, then run the check.`);
    process.exit(1);
  }
  const add = opt('--add');
  if (add !== null) {
    const { lines, refused, notes } = addLines(text, add);
    for (const id of refused) console.log(`# ${id}: not an area this plan misses now with a first job to offer; nothing added for it.`);
    if (lines.length) console.log(`# At the end of the tree:\n${lines.join('\n')}`);
    for (const n of notes) console.log(`# At the end of the existing "${n.under}":\n${n.lines.join('\n')}`);
  } else if (args.includes('--json')) console.log(JSON.stringify(offers(text), null, 2));
  else console.log(report(text, { self: process.argv[1], dir }));
}
