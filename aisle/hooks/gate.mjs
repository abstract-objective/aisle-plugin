// AIsle's gate, its rules (D113, job cl4a). The design is research/R30-core-loop/part1b-gate-overseer-evidence.md §1,
// as research/R30-core-loop/revise.md changed it; the plan is research/R30-core-loop/cl4a/00-plan.md; the rules file a
// person edits is aisle/GATE.md, whose line numbers every refusal names.
//
// Every rule is a pure function: plain inputs in, { decision: 'allow' | 'deny', message } out. Its inputs are
//   event  the hook's JSON fields it needs (hook_event_name, tool_name, tool_input, cwd, agent_id, stop_hook_active);
//   job    the worktree's .aisle-job, read by readJob() (or its text, read here), or null;
//   state  the counts and facts the caller gathered (tokens, workers running, the plan before an edit, ...);
//   gate   aisle/GATE.md read by parseGate(), or null for the defaults (the same numbers as AO's file, pinned by a test).
// No rule reads a file, the clock or the environment: the hook (job cl4) and the foreman (job cl6) read them and pass
// what they found. When the job is missing or names no job, every rule allows before it reads anything else: the gate
// does nothing in a chat with no .aisle-job (D113).
//
// Inert: nothing imports this file yet, and hooks.json names no matcher for it. Job cl4 wires the matchers to gate(),
// startContext(), editLine() and resumeNote(); job cl6's foreman calls foremanStart() and foremanTick().
//
// It imports nothing. The plugin ships alone, from its own repository, so it cannot reach engine/, and node:path's
// resolve reads the process's folder. What it needs from engine/aisle/chain.mjs (the job file) and
// engine/aisle/oversee.mjs (what "under owns" means, the plan's own files) is copied below, and test/gate.test.mjs pins
// every copy to its source.

// ---- 1. Copies, each pinned to its source by test/gate.test.mjs --------------------------------------------------------

/** The file a worker's worktree holds while it works on one job (chain.mjs JOB_FILE). */
export const JOB_FILE = '.aisle-job';
/** `chain: every` re-delivers the packet at every start (arm A); `chain: once` leaves it to the brief (arm B). */
export const CHAIN_MODES = Object.freeze(['every', 'once']);
/** The packet is always shorter than this (chain.mjs CHAIN_MOST). */
export const CHAIN_MOST = 1940;
/** The caps per job until aisle/GATE.md says otherwise (chain.mjs GATE_CAPS). */
export const GATE_CAPS = Object.freeze({ turns: 150, minutes: 60 });
/** A worker's own files at the repo root, never merged (oversee.mjs WORKER_FILES). */
export const WORKER_FILES = Object.freeze(['RESUME.md', '.aisle-job', '.aisle-job.log', '.aisle-job.usage']);

/** The rules file, as every refusal names it. */
export const GATE_FILE = 'aisle/GATE.md';
/** A refusal is at most this long (part 1b §1c). */
export const MESSAGE_MOST = 300;

const dirOf = (p) => (String(p).includes('/') ? String(p).slice(0, String(p).lastIndexOf('/')) : '');
/** The plan's own files, which no worker writes whatever its owns say (oversee.mjs planFiles). */
export function planFiles(planPath = 'aisle/PLAN.md') {
  const d = dirOf(planPath);
  const at = (x) => [d, x].filter(Boolean).join('/');
  return { files: [planPath, at('GATE.md')], folders: [at('frames')] };
}

const GLOB = /[*?[\]{}]/;
/** A glob as owns writes it → a RegExp over a whole path (oversee.mjs globRegExp). */
export function globRegExp(glob) {
  let re = '', i = 0, brace = 0;
  const g = String(glob);
  while (i < g.length) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { i += 2; if (g[i] === '/') { re += '(?:.*/)?'; i++; } else re += '.*'; continue; }
      re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') { const end = g.indexOf(']', i + 1); if (end < 0) re += '\\['; else { re += `[${g.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`; i = end; } }
    else if (c === '{') { re += '(?:'; brace++; }
    else if (c === '}' && brace) { re += ')'; brace--; }
    else if (c === ',' && brace) re += '|';
    else re += c.replace(/[.+^$|()\\]/g, '\\$&');
    i++;
  }
  return new RegExp(`^${re}${')'.repeat(brace)}$`);
}

/** Whether `path` is under one owns item: the file, inside the folder it names, or matched by its glob (oversee.mjs inOwns). */
export function inOwns(path, ownsPaths = []) {
  const p = String(path);
  const parts = p.split('/');
  return ownsPaths.some((item) => {
    const o = String(item).replace(/\/$/, '');
    if (!GLOB.test(o)) return p === o || p.startsWith(`${o}/`);
    const re = globRegExp(o);
    for (let k = parts.length; k >= 1; k--) if (re.test(parts.slice(0, k).join('/'))) return true;
    return false;
  });
}

/** A secret by its file name (oversee.mjs secretPathKind), plus where Claude Code keeps the AIsle key and its sign-in. */
export function secretFileKind(p) {
  const base = String(p).split(/[\\/]/).pop();
  if (/^\.env$/i.test(base) || (/^\.env\..+/i.test(base) && !/\.(example|sample|template|dist)$/i.test(base))) return 'a .env file';
  if (/\.(pem|p12|pfx|key)$/i.test(base)) return 'a private key file';
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/i.test(base)) return 'an SSH private key';
  // The repo's .gitignore: the AIsle key "is in ~/.claude.json"; Claude Code keeps its own sign-in in .credentials.json.
  if (/^\.claude\.json$/i.test(base)) return 'Claude Code\'s settings, which hold the AIsle key';
  if (/^\.credentials\.json$/i.test(base)) return 'Claude Code\'s sign-in';
  return '';
}

/** The .aisle-job text → its fields (chain.mjs readJobFile), plus its owns and budget read, or null when it names no job. */
export function readJob(text) {
  const all = String(text ?? '').split(/\r?\n/);
  const fields = {};
  let i = 0;
  for (; i < all.length; i++) {
    const l = all[i];
    if (!l.trim()) { i++; break; }
    if (l.trim().startsWith('#')) continue;
    const m = /^([a-z][a-z -]*):\s?(.*)$/i.exec(l.trim());
    if (m) fields[m[1].toLowerCase()] = m[2].trim();
  }
  if (!fields.job) return null;
  const chain = CHAIN_MODES.includes(fields.chain) ? fields.chain : 'every';
  const packet = all.slice(i).filter((l) => l.trim()).join('\n');
  const owns = fields.owns || 'not set';
  const budget = fields.budget || '';
  return { id: fields.job, taken: fields.taken || '', chain, owns, budget, packet, scope: readOwnsLine(owns), limits: readBudget(budget) };
}

/** The job file's owns line ("a, b", "see mission", "none", "not set") → { paths, mission, none, set }. */
export function readOwnsLine(text) {
  const t = String(text ?? '').trim();
  if (!t || /^not set$/i.test(t)) return { paths: [], mission: false, none: false, set: false };
  const out = { paths: [], mission: false, none: false, set: true };
  for (const item of t.split(',').map((s) => s.trim().replace(/^\.\//, '')).filter(Boolean)) {
    if (/^see\s+(?:the\s+)?mission$/i.test(item)) out.mission = true;
    else if (/^none$/i.test(item)) out.none = true;
    else out.paths.push(item);
  }
  return out;
}

/** The job file's budget line ("150t 60m") → { turns, minutes }, each only when written. */
export function readBudget(text) {
  const t = String(text ?? '');
  const turns = /(\d+)\s*t\b/i.exec(t), minutes = /(\d+)\s*m\b/i.exec(t);
  return { ...(turns ? { turns: Number(turns[1]) } : {}), ...(minutes ? { minutes: Number(minutes[1]) } : {}) };
}

// ---- 2. Text --------------------------------------------------------------------------------------------------------

/** Text as one line. */
export const flat = (text) => String(text ?? '').replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim();
/** Text cut to at most `n` characters, ending in "…" when cut. */
export function cut(text, n) {
  const s = flat(text);
  if (s.length <= n) return s;
  if (n < 2) return n === 1 ? '…' : '';
  let end = n - 1;
  const before = s.charCodeAt(end - 1);
  if (before >= 0xd800 && before <= 0xdbff) end--;
  return `${s.slice(0, end).trimEnd()}…`;
}
/** A whole number with commas: 2610000 → "2,610,000". */
export const commas = (n) => String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * A refusal in part 1b §1c's one shape, at most MESSAGE_MOST characters (the fact is cut first):
 * "AIsle gate, <rule>: <the fact> (<the limit>). Do instead: <one step>. Rule: aisle/GATE.md line <n>."
 */
export function denyMessage(rule, fact, limit, step, line) {
  const end = (s) => flat(s).replace(/[.\s]+$/, '');
  const head = `AIsle gate, ${rule}: `;
  const tail = ` (${cut(end(limit), 90)}). Do instead: ${end(cut(end(step), 110))}. Rule: ${GATE_FILE} line ${line}.`;
  return `${head}${end(cut(end(fact), Math.max(20, MESSAGE_MOST - head.length - tail.length)))}${tail}`;
}

// ---- 3. Paths -------------------------------------------------------------------------------------------------------

/**
 * A path → { lead, segs }: forward slashes, "." and ".." folded; lead is "c:/", "/", "//" or "" (relative). On a Windows
 * lead each name is cut as Windows cuts it: trailing dots and blanks dropped, and a ":" stream ("PLAN.md::$DATA") taken
 * off, so "aisle/PLAN.md." is aisle/PLAN.md (review R11).
 */
function splitPath(p) {
  let s = String(p ?? '').trim().replace(/\\/g, '/');
  const gitBash = /^\/([a-z])(?:\/|$)/i.exec(s);
  if (gitBash) s = `${gitBash[1]}:/${s.slice(3)}`;
  const lead = /^[a-z]:\//i.test(s) ? s.slice(0, 3).toLowerCase() : /^[a-z]:$/i.test(s) ? `${s.toLowerCase()}/` : s.startsWith('//') ? '//' : s.startsWith('/') ? '/' : '';
  const win = /^[a-z]:\/$/.test(lead) || lead === '//';
  const segs = [];
  for (let seg of s.slice(lead.length).split('/')) {
    if (/^[a-z]:$/i.test(seg)) continue;
    if (win && seg !== '.' && seg !== '..') seg = seg.split(':')[0].replace(/[. ]+$/, '');
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (segs.length && segs.at(-1) !== '..') segs.pop(); else if (!lead) segs.push('..'); continue; }
    segs.push(seg);
  }
  return { lead, segs };
}

/**
 * Where a path falls against the project's root → { inside, rel, windows }: rel is the path inside the root with "/"
 * (case kept). A relative path is taken from `cwd`, else from the root. Throws when no root or cwd is absolute.
 */
export function placePath(path, { root = '', cwd = '' } = {}) {
  const base = splitPath(root || cwd);
  if (!base.lead) throw new Error('the gate was given no folder to place the path in');
  let p = splitPath(path);
  if (!p.lead) {
    const from = splitPath(cwd && splitPath(cwd).lead ? cwd : root);
    p = splitPath(`${from.lead}${[...from.segs, ...p.segs].join('/')}`);
  }
  const windows = /^[a-z]:\/$/.test(base.lead) || base.lead === '//';
  const same = (a, b) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (!same(p.lead, base.lead) || p.segs.length < base.segs.length) return { inside: false, rel: '', windows };
  for (let i = 0; i < base.segs.length; i++) if (!same(p.segs[i], base.segs[i])) return { inside: false, rel: '', windows };
  return { inside: true, rel: p.segs.slice(base.segs.length).join('/'), windows };
}

/** inOwns, with Windows paths compared without case. */
const owned = (rel, paths, windows) => (windows ? inOwns(rel.toLowerCase(), paths.map((x) => x.toLowerCase())) : inOwns(rel, paths));
/** The path a file tool names. */
const toolPath = (event) => event?.tool_input?.file_path ?? event?.tool_input?.notebook_path ?? event?.tool_input?.path ?? '';
/** The project's root: the folder that holds .aisle-job, else the hook's cwd. */
const rootOf = (ctx) => ctx.state.root || ctx.event.cwd || '';

// ---- 4. Shell commands ----------------------------------------------------------------------------------------------

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Grep']);
// Words that run the command after them, and the options of theirs that take a value (review R3).
const WRAPPERS = new Set(['sudo', 'env', 'command', 'builtin', 'exec', 'nohup', 'time', 'nice', 'timeout', 'stdbuf', 'xargs']);
const WRAPPER_ARGS = {
  nice: /^-n$/, timeout: /^-(s|k)$|^--(signal|kill-after)$/, sudo: /^-(u|g|C|D|h|p|r|t|U)$/, env: /^-(u|C)$|^--(unset|chdir)$/,
  xargs: /^-(n|L|I|P|s|d|E|a)$|^--(max-args|max-lines|replace|max-procs|max-chars|delimiter|eof|arg-file)$/, stdbuf: /^-(i|o|e)$/,
};
// Shell words in front of a command: "if git push; then ...", "{ git push; }", "! git push".
const KEYWORDS = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
// powershell's options that take a value, before its command.
const PS_ARGS = /^-(ExecutionPolicy|ep|ex|WindowStyle|w|win|Version|v|WorkingDirectory|wd|ConfigurationName|config|OutputFormat|of|o|InputFormat|if|inp|PSConsoleFile|psc|EncodedCommand|e|ec|enc)$/i;

/** A heredoc's word after "<<" or "<<-" at s[i] → { word, dash, end } (end: the index after the word), or null ("<<<"). */
function heredocWord(s, i) {
  if (s[i + 2] === '<') return null;
  let j = i + 2;
  const dash = s[j] === '-';
  if (dash) j++;
  while (s[j] === ' ' || s[j] === '\t') j++;
  let word = '';
  while (j < s.length && !/[\s;&|()<>]/.test(s[j])) {
    const c = s[j];
    if (c === "'" || c === '"') { const k = s.indexOf(c, j + 1); if (k < 0) break; word += s.slice(j + 1, k); j = k + 1; continue; }
    if (c === '\\') { word += s[j + 1] ?? ''; j += 2; continue; }
    word += c;
    j++;
  }
  return word ? { word, dash, end: j } : null;
}

/** The index of the newline that ends a heredoc body starting at `from` (the line equal to its word), or the end. */
function heredocEnd(s, from, { word, dash }) {
  let i = from;
  while (i < s.length) {
    let j = s.indexOf('\n', i);
    if (j < 0) j = s.length;
    let line = s.slice(i, j).replace(/\r$/, '');
    if (dash) line = line.replace(/^\t+/, '');
    if (line === word) return j;
    i = j + 1;
  }
  return s.length;
}

/** The index of the ")" that closes the "(" at s[open] of a "$(", past quotes and heredoc bodies inside it, or the end. */
function substEnd(s, open) {
  let level = 0, pending = [];
  for (let j = open; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === "'") { const k = s.indexOf("'", j + 1); j = k < 0 ? s.length : k; continue; }
    if (c === '"') { let k = j + 1; while (k < s.length && s[k] !== '"') k += s[k] === '\\' ? 2 : 1; j = k; continue; }
    if (c === '<' && s[j + 1] === '<') { const h = heredocWord(s, j); if (h) { pending.push(h); j = h.end - 1; continue; } }
    if (c === '\n' && pending.length) { for (const h of pending) j = heredocEnd(s, j + 1, h); pending = []; continue; }
    if (c === '(') level++;
    else if (c === ')' && --level === 0) return j;
  }
  return s.length;
}

/**
 * A command line → its simple commands, each as words: cut at ; & | ( ) newlines, $( and backticks (in PowerShell a
 * backtick escapes), quotes taken off. A heredoc's body ("<<EOF ... EOF") and a PowerShell here-string ("@' ... '@") are
 * data, never commands (review R1). A redirect's file is no word of the command: each command array carries it, not
 * enumerable, as `out` (written by > or >>) or `in` (read by <); "2>&1" is no file. A command inside "$( )", bash -c,
 * sh -c, eval, Invoke-Expression, powershell (with or without -Command), cmd /c or wsl is read too, three deep at most.
 * A sieve, said so in part 1b: it reads the command a model writes plainly, not one built to hide.
 */
export function shellCommands(command, { powershell = false } = {}, depth = 0) {
  const s = String(command ?? '');
  const out = [], inner = [];
  let words = [], outs = [], ins = [], w = '', inWord = false, q = null, redir = null, pending = [];
  const endWord = () => {
    if (inWord) { if (redir === 'out') outs.push(w); else if (redir === 'in') ins.push(w); else if (redir !== 'fd') words.push(w); redir = null; }
    w = '';
    inWord = false;
  };
  const endCmd = () => { endWord(); if (words.length || outs.length || ins.length) out.push({ words, outs, ins }); words = []; outs = []; ins = []; redir = null; };
  const esc = powershell ? '`' : '\\';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") { if (c === "'") q = null; else w += c; continue; }
    if (q === '"') {
      if (c === '"') { q = null; continue; }
      // Inside "...", bash's backslash escapes only " \ $ ` and a newline (so "C:\Users" keeps its backslashes);
      // PowerShell's backtick escapes any character.
      if (c === esc && i + 1 < s.length && (powershell || '"\\$`\n'.includes(s[i + 1]))) { w += s[++i]; continue; }
      if (c === '$' && s[i + 1] === '(') {
        const j = substEnd(s, i + 1);
        inner.push(s.slice(i + 2, j));
        w += s.slice(i, j + 1);
        i = j;
        continue;
      }
      if (c === '`' && !powershell) { const j = s.indexOf('`', i + 1); inner.push(s.slice(i + 1, j < 0 ? s.length : j)); i = j < 0 ? s.length : j; continue; }
      w += c;
      continue;
    }
    if (powershell && c === '@' && (s[i + 1] === "'" || s[i + 1] === '"')) {
      const open = /^@(['"])[ \t]*\r?\n/.exec(s.slice(i, i + 64));
      if (open) {
        const close = s.indexOf(`\n${open[1]}@`, i);
        const end = close < 0 ? s.length : close;
        w += s.slice(i + open[0].length, end).replace(/\r$/, '');
        inWord = true;
        i = close < 0 ? s.length : close + 2;
        continue;
      }
    }
    if (c === "'" || c === '"') { q = c; inWord = true; continue; }
    if (c === esc && i + 1 < s.length) { if (s[i + 1] === '\n') { i++; continue; } w += s[++i]; inWord = true; continue; }
    if (c === '$' && s[i + 1] === '(') { endCmd(); i++; continue; }
    if (c === '\n' && pending.length) { endCmd(); for (const h of pending) i = heredocEnd(s, i + 1, h); pending = []; continue; }
    if (!powershell && c === '<' && s[i + 1] === '<') {
      const h = heredocWord(s, i);
      if (h) { endWord(); pending.push(h); i = h.end - 1; continue; }
      if (s[i + 2] === '<') { endWord(); redir = 'fd'; i += 2; continue; }
    }
    if (c === '>' || c === '<' || (c === '&' && s[i + 1] === '>')) {
      // "2>" and "2>&1": the 2 is a stream, no word; "&>" sends both streams.
      if (inWord && /^\d+$/.test(w) && /\d/.test(s[i - 1])) { w = ''; inWord = false; } else endWord();
      if (c === '&') i++;
      if (s[i] === '>' && s[i + 1] === '>') i++;
      if (s[i + 1] === '&') { i++; redir = 'fd'; } else redir = s[i] === '<' ? 'in' : 'out';
      continue;
    }
    if (';&|()\n\r'.includes(c) || (c === '`' && !powershell) || (powershell && (c === '{' || c === '}'))) { endCmd(); continue; }
    if (c === ' ' || c === '\t') { endWord(); continue; }
    w += c;
    inWord = true;
  }
  endCmd();
  const all = [];
  for (const cmd of out) {
    const words2 = unwrap(cmd.words);
    if (!words2.length && !cmd.outs.length) continue;
    Object.defineProperty(words2, 'out', { value: cmd.outs });
    Object.defineProperty(words2, 'in', { value: cmd.ins });
    all.push(words2);
    if (depth >= 3 || !words2.length) continue;
    const prog = progName(words2[0]);
    const rest = words2.slice(1);
    const more = (text, ps = false) => all.push(...shellCommands(text, { powershell: ps }, depth + 1));
    if (SHELLS.has(prog)) {
      const at = rest.findIndex((x) => /^-[a-z]*c[a-z]*$/i.test(x));
      if (at >= 0 && rest[at + 1] !== undefined) more(rest[at + 1]);
    } else if (prog === 'eval') more(rest.join(' '), powershell);
    else if (prog === 'iex' || prog === 'invoke-expression') more(rest.filter((x) => !/^-command$/i.test(x)).join(' '), true);
    else if (prog === 'powershell' || prog === 'pwsh') {
      for (let k = 0; k < rest.length; k++) {
        if (/^-(c|command)$/i.test(rest[k])) { more(rest.slice(k + 1).join(' '), true); break; }
        if (/^-(f|file)$/i.test(rest[k])) break;
        if (PS_ARGS.test(rest[k])) { k++; continue; }
        if (!rest[k].startsWith('-')) { more(rest.slice(k).join(' '), true); break; }
      }
    } else if (prog === 'cmd') {
      const at = rest.findIndex((x) => /^\/[ck]$/i.test(x));
      if (at >= 0) more(rest.slice(at + 1).join(' '));
    } else if (prog === 'wsl') {
      // wsl's own options, then the command, after "--" or "-e" or plainly: "wsl git push".
      for (let k = 0; k < rest.length; k++) {
        if (/^(-d|--distribution|-u|--user|--cd|--shell-type)$/.test(rest[k])) { k++; continue; }
        if (rest[k] === '--' || rest[k] === '-e' || rest[k] === '--exec') { more(rest.slice(k + 1).join(' ')); break; }
        if (!rest[k].startsWith('-')) { more(rest.slice(k).join(' ')); break; }
      }
    }
  }
  for (const text of inner) if (depth < 3) all.push(...shellCommands(text, { powershell }, depth + 1));
  return all;
}

/** A program's name: its file name, lowercase, without .exe, .cmd or .bat. */
export const progName = (word) => String(word ?? '').split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat)$/, '');

/** A command's words without leading "X=1" settings, shell keywords and wrappers (sudo, env, timeout 900, nice -n 5, ...). */
function unwrap(words) {
  let i = 0;
  for (let guard = 0; guard < 20 && i < words.length; guard++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || KEYWORDS.has(words[i])) { i++; continue; }
    const p = progName(words[i]);
    if (!WRAPPERS.has(p)) break;
    i++;
    while (i < words.length && (words[i].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]))) {
      if (WRAPPER_ARGS[p]?.test(words[i])) i++;
      i++;
    }
    if (p === 'timeout' && /^\d/.test(words[i] ?? '')) i++;
  }
  return words.slice(i);
}

/** git's words → { sub, args, before }, past -C <dir>, -c <k=v> and the other options before the subcommand (before). */
function gitSub(words) {
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) i += /^(-C|-c|--git-dir|--work-tree|--namespace|--exec-path)$/.test(words[i]) ? 2 : 1;
  return { sub: (words[i] || '').toLowerCase(), args: words.slice(i + 1), before: words.slice(1, i) };
}
/** The words that are not options. */
const positional = (args) => args.filter((a) => !a.startsWith('-'));

/** Each command with the folder it runs in, following a "cd <dir>" (pushd, Set-Location) earlier in the line (review R5). */
function withCwd(cmds, ctx) {
  let cwd = ctx.event.cwd || rootOf(ctx);
  return cmds.map((w) => {
    const here = cwd;
    if (['cd', 'pushd', 'chdir', 'set-location', 'sl'].includes(progName(w[0]))) {
      const to = positional(w.slice(1))[0];
      if (to && !/^[$%~]/.test(to)) {
        const base = splitPath(cwd), p = splitPath(to);
        cwd = p.lead ? to : `${base.lead}${[...base.segs, ...p.segs].join('/')}`;
      }
    }
    return { w, cwd: here };
  });
}

// Programs that delete or move what they name, that write their last word, and that write every file they name.
const DELETES = new Set(['rm', 'rmdir', 'del', 'erase', 'rd', 'remove-item', 'ri', 'unlink', 'shred', 'mv', 'move', 'move-item', 'mi', 'ren', 'rename', 'rename-item', 'rni']);
const COPIES = new Set(['cp', 'copy', 'copy-item', 'cpi', 'install', 'ln', 'xcopy']);
const WRITES = new Set(['tee', 'tee-object', 'set-content', 'sc', 'add-content', 'ac', 'out-file', 'clear-content', 'clc', 'new-item', 'ni', 'touch', 'truncate']);

/**
 * The files a shell command writes or deletes, as { path, verb, del } (del: deleting or moving, so a folder above the file
 * counts too): a redirect's file, what rm, mv or Remove-Item names, cp's last word, what tee or Set-Content names, sed -i
 * and perl -i's files, git clean -x (it deletes ignored files, .aisle-job among them), git rm, mv, restore and checkout.
 */
function shellWrites(w) {
  const out = (w.out || []).map((path) => ({ path, verb: '>', del: false }));
  const prog = progName(w[0]);
  const rest = w.slice(1);
  const pos = positional(rest);
  const each = (verb, del, list = pos) => { for (const path of list) out.push({ path, verb, del }); };
  if (DELETES.has(prog)) each(prog, true);
  else if (COPIES.has(prog) && pos.length) each(prog, false, [pos.at(-1)]);
  else if (WRITES.has(prog)) each(prog, false);
  else if ((prog === 'sed' || prog === 'perl') && rest.some((a) => /^-[a-zA-Z]*i|^--in-place/.test(a))) each(`${prog} -i`, false);
  else if (prog === 'git') {
    const { sub, args } = gitSub(w);
    const gpos = positional(args);
    if (sub === 'clean' && args.some((a) => /^-[a-zA-Z]*[xX]/.test(a))) each('git clean -x', true, gpos.length ? gpos : ['.']);
    else if (sub === 'rm' || sub === 'mv') each(`git ${sub}`, true, gpos);
    else if (sub === 'restore') each('git restore', false, gpos);
    else if (sub === 'checkout') each('git checkout', false, args.includes('--') ? positional(args.slice(args.indexOf('--') + 1)) : gpos);
  }
  return out;
}

/** The job file and the files beside it that the gate reads. */
const JOB_FILE_RE = /^\.aisle-job(\..*)?$/i;
const JOB_FILES = [JOB_FILE, '.aisle-job.usage', '.aisle-job.log'];

/**
 * Which of the gate's own files a path a command names would write → { what, job } or null: the job file and its kin at
 * the root, the plan's own files and folder. A glob counts when it would match one; for a delete, a folder above one too.
 */
function gateFileHit(word, del, ctx, cwd) {
  if (/^[$%~]/.test(word)) return null;
  const at = placePath(word, { root: rootOf(ctx), cwd });
  if (!at.inside) return null;
  const low = (x) => (at.windows ? x.toLowerCase() : x);
  const rel = low(at.rel);
  const { files, folders } = planFiles(ctx.state.planPath || 'aisle/PLAN.md');
  const re = GLOB.test(rel) ? globRegExp(rel) : null;
  const is = (x) => (re ? re.test(x) : rel === x);
  if (!re && JOB_FILE_RE.test(rel)) return { what: at.rel, job: true };
  for (const f of [...JOB_FILES, ...files, ...folders]) {
    const g = low(f);
    const folder = folders.includes(f);
    if (is(g) || (folder && rel.startsWith(`${g}/`))) return { what: f, job: JOB_FILES.includes(f) };
    if (del) { const segs = g.split('/'); for (let k = 0; k < segs.length; k++) if (is(segs.slice(0, k).join('/'))) return { what: f, job: JOB_FILES.includes(f) }; }
  }
  return null;
}

// ---- 5. The plan, for the done rule ---------------------------------------------------------------------------------

const JOB_LINE = /^\s*(?:[-*]\s+)?Job\s+([A-Za-z0-9][\w.-]*)\s*:/;

// A path a "file" item may name, as engine/aisle/plan.mjs's goodPath and isRepoPath read it: inside the repo, one word,
// no ":", "$" or "%", no leading "-", no empty or "." folder, nothing in .git, no glob.
const goodPath = (p) => !/^(\/|[A-Za-z]:|~)/.test(p) && !p.split('/').includes('..') && !p.includes('\\');
const isRepoPath = (p) => Boolean(p) && !/[\s:$%]/.test(p) && p[0] !== '-' && goodPath(p)
  && p.replace(/\/$/, '').split('/').every((s) => s && s !== '.' && s.toLowerCase() !== '.git') && !/[*?[\]{}]/.test(p);

/**
 * An evidence field → the kind of each item, in order, read as engine/aisle/plan.mjs's readEvidence reads it ("commit
 * <7 to 40 hex>", "test <x>", "log <x>", "live: <x>", "seen: <x>", "file <repo path>", "none recorded"); null for an
 * item it marks bad (review R14; a test pins the two).
 */
export function evidenceKinds(text) {
  return String(text ?? '').split(';').map((x) => x.trim()).filter(Boolean).map((it) => {
    let m;
    if (/^commit\s+[0-9a-f]{7,40}$/i.test(it)) return 'commit';
    if ((m = /^(test|log)\s+\S/i.exec(it))) return m[1].toLowerCase();
    if ((m = /^(live|seen)\s*:?\s+\S/i.exec(it)) || (m = /^(live|seen)\s*:\s*\S/i.exec(it))) return m[1].toLowerCase();
    if (/^none recorded$/i.test(it)) return 'none recorded';
    if (/^file(?=[\s:])/i.test(it)) return isRepoPath(it.slice(4).replace(/^\s*:?\s*/, '').trim().replace(/^\.\//, '')) ? 'file' : null;
    return null;
  });
}

/**
 * A plan's text → Map of job id → { done, evidence }: fields split on " | " up to "Done when:", as plan.mjs does; evidence
 * counts the items plan.mjs reads as good, "none recorded" not among them.
 */
export function planJobs(text) {
  const out = new Map();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = JOB_LINE.exec(line);
    if (!m) continue;
    let status = '', ev = '';
    for (const f of line.slice(m[0].length).split(' | ').slice(1).map((x) => x.trim())) {
      let g;
      if (/^done when\s*:?/i.test(f)) break;
      if ((g = /^status\s*:?\s*(.*)$/i.exec(f))) status = g[1].trim().toLowerCase();
      else if ((g = /^evidence\s*:\s*(.*)$/i.exec(f))) ev = g[1];
    }
    const good = evidenceKinds(ev).filter((k) => k && k !== 'none recorded').length;
    out.set(m[1], { done: ['done', 'complete', 'completed', 'finished'].includes(status), evidence: good });
  }
  return out;
}

/** The jobs a change turns done with no evidence but "none recorded" (part 1b §1b, "done without evidence"). */
export function doneWithoutEvidence(before, after) {
  const was = planJobs(before);
  const out = [];
  for (const [id, j] of planJobs(after)) if (j.done && !j.evidence && !was.get(id)?.done) out.push(id);
  return out;
}

/**
 * A file's text after an Edit, MultiEdit or Write (revise.md T8: PreToolUse sees only old and new strings, so the file is
 * rebuilt before it is read), or null when an edit would not apply (Claude Code then refuses the edit itself).
 */
export function textAfterEdit(before, toolName, input = {}) {
  if (toolName === 'Write') return String(input.content ?? '');
  const lf = (s) => String(s ?? '').replace(/\r\n/g, '\n');
  let text = lf(before);
  for (const e of toolName === 'MultiEdit' ? input.edits || [] : [input]) {
    const from = lf(e?.old_string), to = lf(e?.new_string);
    if (!from) { if (!text) { text = to; continue; } return null; }
    if (!text.includes(from)) return null;
    text = e.replace_all ? text.split(from).join(to) : text.replace(from, () => to);
  }
  return text;
}

// ---- 6. aisle/GATE.md -----------------------------------------------------------------------------------------------

const num = (s) => { const m = /^\$?\s*([\d,]+(?:\.\d+)?)(?=\s|$|[,;])/.exec(String(s).trim()); if (!m) return undefined; const n = Number(m[1].replace(/,/g, '')); return Number.isFinite(n) && n >= 0 ? n : undefined; };
const whole = (s) => { const n = num(s); return Number.isInteger(n) ? n : undefined; };
const noneOr = (f) => (s) => (/^none\b/i.test(String(s).trim()) ? null : f(s));
const hhmm = (h, m) => Number(h) * 60 + Number(m);
const clock = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** The values a GATE.md line holds, read strictly: undefined means "cannot be read" (a problem; the default holds). */
const READ = {
  number: whole,
  tokens: (s) => { const m = /^([\d,]+)\s*context\s*\+\s*([\d,]+)\s*output\b/i.exec(String(s).trim()); return m ? { context: whole(m[1]), output: whole(m[2]) } : undefined; },
  price: noneOr((s) => { const m = /^\$?([\d.]+)\s*context\s*,\s*\$?([\d.]+)\s*output\b/i.exec(String(s).trim()); return m && Number.isFinite(+m[1]) && Number.isFinite(+m[2]) ? { context: +m[1], output: +m[2] } : undefined; }),
  dollars: noneOr(num),
  depth: (s) => { const m = /^(\d+)(?:\s*,\s*at most\s+(\d+)\s+alive)?\b/i.exec(String(s).trim()); return m ? { depth: Number(m[1]), alive: m[2] === undefined ? 3 : Number(m[2]) } : undefined; },
  night: (s) => {
    const t = String(s).trim();
    if (/^yes\b/i.test(t)) return { yes: true };
    const m = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/.exec(t);
    return m && +m[1] < 24 && +m[3] <= 24 && +m[2] < 60 && +m[4] < 60 ? { yes: false, from: hhmm(m[1], m[2]), to: hhmm(m[3], m[4]) } : undefined;
  },
  stop: (s) => { const m = /(\d+)\s*minutes?/i.exec(String(s)); return { minutes: m ? Number(m[1]) : 10 }; },
  text: (s) => String(s).trim(),
};

/**
 * aisle/GATE.md's text → { rules: { <key>: { line, value, kind, text, why, retired? } }, problems }. The rules block ends
 * at the first "## " heading; "#" lines are comments. A line the gate does not know, a rule twice, or a value it cannot
 * read is a problem, never a guess (part 1b §1e): the line is skipped, or its rule keeps its default. "guide" in the
 * second column makes the rule a note (kind 'guide'); anything else is 'stop'. "retired: <name>" takes the rule out: it
 * keeps its line and allows (kind 'retired', review R6). A rule missing from the file keeps its default and a problem
 * says so; its refusals then name AO's line for it, which in a project's own file may hold another rule (review R15:
 * the problems are for cl4 to show the keeper, cl4a/wishes.md 10).
 */
export function parseGate(text) {
  const rules = {}, problems = [];
  const lines = String(text ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const n = i + 1;
    if (/^##\s/.test(t)) break;
    if (!t || t.startsWith('#')) continue;
    const m = /^([^:|]+):\s*(.*)$/.exec(t);
    if (!m) { problems.push(`line ${n}: not "<name>: <value> | <stop or guide> | <why>"`); continue; }
    const name = m[1].trim().toLowerCase();
    if (name === 'retired') {
      const [gone = '', , why = ''] = m[2].split('|').map((x) => x.trim());
      const def = BY_NAME.get(gone.toLowerCase());
      if (!def) { problems.push(`line ${n}: retired "${cut(gone, 60)}" is not a rule the gate knows; not guessed`); continue; }
      if (rules[def.key]) { problems.push(`line ${n}: "${gone.toLowerCase()}" again; line ${rules[def.key].line} holds`); continue; }
      rules[def.key] = { line: n, value: def.value, kind: 'retired', text: '', why, retired: true };
      continue;
    }
    const def = BY_NAME.get(name);
    if (!def) { problems.push(`line ${n}: "${cut(name, 60)}" is not a rule the gate knows; not guessed`); continue; }
    if (rules[def.key]) { problems.push(`line ${n}: "${name}" again; line ${rules[def.key].line} holds`); continue; }
    const [valueText = '', kindText = '', why = ''] = m[2].split('|').map((x) => x.trim());
    let value = READ[def.read](valueText);
    if (value === undefined) { problems.push(`line ${n}: ${name}: "${cut(valueText, 40)}" cannot be read; the default holds`); value = def.value; }
    rules[def.key] = { line: n, value, kind: /^guide\b/i.test(kindText) ? 'guide' : 'stop', text: valueText, why };
  }
  for (const def of [...RULES, ...VALUES]) if (!rules[def.key] && text != null && String(text).trim()) problems.push(`"${def.gateName}" is not in the file; its default holds`);
  return { rules, problems };
}

const valueOf = (key, gate) => {
  const r = gate?.rules?.[key];
  if (r) return r.value;
  return [...RULES, ...VALUES].find((d) => d.key === key).value;
};
const lineOf = (rule, gate) => gate?.rules?.[rule.key]?.line ?? rule.line;

/** A job's caps: its budget line, never above the gate's turns and minutes per job (as chain.mjs jobBudget holds them). */
export function jobCaps(job, gate = null) {
  const turns = valueOf('turns', gate), minutes = valueOf('minutes', gate);
  const b = job?.limits || readBudget(job?.budget);
  return { turns: Math.min(b.turns ?? turns, turns), minutes: Math.min(b.minutes ?? minutes, minutes) };
}

/** Tokens as estimated dollars at a price per million tokens ({ context, output }). */
export const dollarsOf = (tokens, price) => (Number(tokens.context) / 1e6) * price.context + (Number(tokens.output) / 1e6) * price.output;

// ---- 7. The rules ---------------------------------------------------------------------------------------------------

/** A count the caller must pass; missing, it throws, and the runner holds the rule's mode (closed: deny; open: allow). */
function need(value, what) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`the gate cannot count ${what} (no count was given)`);
}
const ALLOW = Object.freeze({ decision: 'allow', message: '' });
const onlyPath = (rel, full) => rel || flat(full);
const ownsText = (job, extra = []) => {
  const s = job.scope;
  const paths = [...s.paths, ...extra];
  return paths.length ? paths.join(', ') : s.mission ? 'what its mission file lists' : 'none';
};
const SAVE = 'commit, write RESUME.md, end';

/** A git add, commit, status, diff or log in this worktree: no -c, -C, --git-dir, --work-tree or --exec-path before it (R12). */
const gitSave = (w) => {
  if (progName(w[0]) !== 'git') return false;
  const { sub, before } = gitSub(w);
  return ['add', 'commit', 'status', 'diff', 'log'].includes(sub) && !before.some((a) => /^(-c|-C|--git-dir|--work-tree|--exec-path|--namespace)(=|$)/.test(a));
};

/**
 * Save steps still go through when a money rule refuses, so the worker can do what the refusal says (part 1b §1c:
 * "Do instead: commit, write RESUME.md, end"): a write of RESUME.md at the root, or shell commands that are all git add,
 * commit, status, diff or log, with a bare `cat` that feeds a commit its message from a heredoc (Claude Code's own
 * `git commit -m "$(cat <<'EOF' ... EOF)"`, review R1), and no redirect into a file.
 */
function isSaveStep(ctx) {
  const { event } = ctx;
  if (EDIT_TOOLS.has(event.tool_name)) {
    try { const at = placePath(toolPath(event), { root: rootOf(ctx), cwd: event.cwd }); return at.inside && at.rel === 'RESUME.md'; } catch { return false; }
  }
  if (SHELL_TOOLS.has(event.tool_name)) {
    const cmds = shellCommands(event.tool_input?.command, { powershell: event.tool_name === 'PowerShell' });
    const feed = (w) => progName(w[0]) === 'cat' && !positional(w.slice(1)).length && !w.in.length;
    return cmds.some(gitSave) && cmds.every((w) => !w.out.length && (gitSave(w) || feed(w)));
  }
  return false;
}

/**
 * The first new branch, worktree, session, app or folder a command makes → its words for the fact, or ''. A folder at the
 * top of the worktree is judged by its first name, for "mkdir newapp" and "mkdir -p newapp/src" alike: in the job's owns
 * (or under one of their top folders), or among the top folders the caller lists (state.topFolders), it is no new app;
 * with no list the gate cannot tell, and says so (the rule is open, so that is logged, not refused). Review R5.
 */
function newWorkIn(cmds, ctx) {
  const { job, state } = ctx;
  let unsure = '';
  const listOrDelete = /^(-d|-D|--delete|-l|--list|-a|--all|-r|--remotes|-v|-vv|--verbose|--show-current|--contains|--no-contains|--merged|--no-merged|--points-at|--format(=.*)?|--sort(=.*)?|--column|--no-column|-u|--set-upstream-to(=.*)?|--unset-upstream|--edit-description)$/;
  for (const { w, cwd } of withCwd(cmds, ctx)) {
    const prog = progName(w[0]);
    const rest = w.slice(1);
    if (prog === 'git') {
      const { sub, args } = gitSub(w);
      // A short flag may carry its name: "-bnew", "-cnew" (review R3).
      if (sub === 'checkout' && args.some((a) => /^-(?!-)[a-zA-Z]*[bB]|^--orphan(=|$)/.test(a))) return 'git checkout -b makes a new branch';
      if (sub === 'switch' && args.some((a) => /^-(?!-)[a-zA-Z]*[cC]|^--(create|force-create|orphan)(=|$)/.test(a))) return 'git switch -c makes a new branch';
      if (sub === 'worktree' && (args[0] || '').toLowerCase() === 'add') return 'git worktree add makes a new worktree';
      if (sub === 'branch' && positional(args).length && !args.some((a) => listOrDelete.test(a))) return `git branch ${cut(positional(args)[0], 40)} makes a new branch`;
      if (sub === 'init') return 'git init makes a new repository';
      if (sub === 'clone') return 'git clone makes a new copy of a repository';
      continue;
    }
    if (prog === 'claude' || prog === 'codex' || prog === 'code' || prog === 'cursor') {
      if (rest.length && rest.every((a) => /^(--version|-v|--help|-h)$/.test(a))) continue;
      return `${prog} starts a new ${prog === 'code' || prog === 'cursor' ? 'editor session' : 'AI session'}`;
    }
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(prog)) {
      const first = (positional(rest)[0] || '').toLowerCase();
      if (first === 'init' || first === 'create') return `${prog} ${first} makes a new app`;
      if ((first === 'exec' || first === 'dlx') && /^create-/.test(positional(rest)[1] || '')) return `${prog} ${first} ${cut(positional(rest)[1], 30)} makes a new app`;
      continue;
    }
    if (['npx', 'pnpx', 'bunx'].includes(prog)) {
      const first = positional(rest)[0] || '';
      if (/^(create-|@[^/]+\/create)/.test(first) || /^(degit|giget|tiged)(@|$)/.test(first)) return `${prog} ${cut(first, 30)} makes a new app`;
      continue;
    }
    if (prog === 'gh' && (rest[0] || '').toLowerCase() === 'repo' && /^(create|fork)$/i.test(rest[1] || '')) return `gh repo ${rest[1].toLowerCase()} makes a new repository`;
    const mk = prog === 'mkdir' || prog === 'md' ? rest.filter((a, i) => !a.startsWith('-') && rest[i - 1] !== '-m' && rest[i - 1] !== '--mode')
      : prog === 'new-item' && rest.some((a, i) => /^-itemtype$/i.test(rest[i - 1] || '') && /^(directory|dir)$/i.test(a))
        ? rest.filter((a, i) => !a.startsWith('-') && !/^-(itemtype|name|value)$/i.test(rest[i - 1] || ''))
        : [];
    for (const target of mk) {
      if (/^[$%~]/.test(target)) continue;
      const at = placePath(target, { root: rootOf(ctx), cwd });
      const temp = (state.tempDirs || []).some((d) => { try { return placePath(target, { root: d, cwd }).inside; } catch { return false; } });
      if (!at.inside) { if (temp || /^\/tmp(\/|$)/.test(String(target).replace(/\\/g, '/'))) continue; return `mkdir ${cut(target, 50)} makes a new folder outside the worktree`; }
      if (!job.scope.set) continue;
      const segs = at.rel.split('/').filter(Boolean);
      if (!segs.length) continue;
      const tops = new Set(job.scope.paths.map((p) => p.split('/')[0]).filter((s) => !GLOB.test(s)).map((s) => (at.windows ? s.toLowerCase() : s)));
      const top = at.windows ? segs[0].toLowerCase() : segs[0];
      if (tops.has(top) || owned(at.rel, job.scope.paths, at.windows)) continue;
      if (!Array.isArray(state.topFolders)) { unsure = 'the gate was given no list of the top folders, so it cannot tell a new one'; continue; }
      if (!state.topFolders.map((s) => (at.windows ? String(s).toLowerCase() : String(s))).includes(top)) return `mkdir ${cut(at.rel, 50)} makes a new top-level folder outside the job's owns`;
    }
  }
  if (unsure) throw new Error(unsure);
  return '';
}

/** The first push, deploy, publish or global install in a command → { what, step } or null. */
function pushIn(cmds) {
  for (const w of cmds) {
    const prog = progName(w[0]);
    const rest = w.slice(1);
    const pos = positional(rest).map((a) => a.toLowerCase());
    if (prog === 'git' && gitSub(w).sub === 'push') return { what: 'git push sends the work out of the worktree', step: 'commit only; the foreman pushes the job branch' };
    const script = SHELLS.has(prog) || prog === 'source' || prog === '.' || prog === 'node' ? positional(rest)[0] || '' : w[0];
    const scriptPath = String(script).replace(/\\/g, '/');
    if (/(^|\/)deploy\//.test(scriptPath) && /\.(sh|mjs|js)$/.test(scriptPath)) return { what: `${cut(script, 40)} deploys`, step: 'commit only; the keeper deploys after the merge' };
    if (/(^|\/)push\.sh$/.test(scriptPath)) return { what: `${cut(script, 40)} deploys`, step: 'commit only; the keeper deploys after the merge' };
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(prog) && pos[0] === 'publish') return { what: `${prog} publish publishes a package`, step: 'commit only; a release is the keeper\'s' };
    if (prog === 'gh' && pos[0] === 'release' && !/^(list|view|download)$/.test(pos[1] || '')) return { what: 'gh release makes or changes a release', step: 'commit only; a release is the keeper\'s' };
    const global = rest.some((a) => /^(-g|--global|--location=global)$/.test(a));
    if ((prog === 'npm' && /^(i|in|ins|inst|insta|instal|install|isnt|isntall|add)$/.test(pos[0] || '') && global)
      || (['pnpm', 'bun'].includes(prog) && /^(add|install|i)$/.test(pos[0] || '') && global)
      || (prog === 'yarn' && pos[0] === 'global' && pos[1] === 'add')) return { what: `${prog} installs a package for the whole computer`, step: 'install inside the worktree only, or write "Need: <job> <package> <why>" in RESUME.md' };
  }
  return null;
}

/**
 * An AIsle key in its minted shape, as engine/aisle/secrets.mjs's ownShape reads it: prefix, an id of 16 to 64, ".", a
 * secret of exactly 43, and no more of the token after it. So the listener's fingerprint `watch_<id>.<64 hex>` is not one
 * (review R10), nor a bare prefix in code. Weaker than secrets.mjs, which also asks that the 43 look random; a test pins
 * the two on minted keys.
 */
export const KEY_SHAPE = /(?:aisle_|aisle-at_|aisle-rt_|aisle-ac_|watch_|inv_)[A-Za-z0-9_-]{16,64}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9]|[_-]+[A-Za-z0-9])/;

// Commands that name a file without reading it, and search programs whose first word is a pattern, not a file (R4).
const NO_READ = new Set(['ls', 'dir', 'test', '[', '[[', 'stat', 'file', 'test-path', 'get-item', 'gi', 'get-childitem', 'gci', 'echo', 'printf', 'write-output', 'write-host']);
const SEARCHES = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'findstr', 'select-string', 'sls']);
/** A file glob read as the file it would match: ".env*" as ".env.local", "**\/.env" as ".env", "*.pem" as a key file. */
const globAsFile = (glob) => String(glob).replace(/^(\*\*\/|\*\/)+/, '').replace(/\*$/, '.local');

/**
 * The words of a command that may name a file it reads, for the secrets rule: every word and the file after "<", but not
 * the pattern of grep, rg, findstr or Select-String, not jq's filter, nothing of ls, test, echo or git check-ignore,
 * ls-files and status (they name a file without reading it). A search's glob is read as the file it would match.
 */
function readWords(w) {
  const prog = progName(w[0]);
  const rest = w.slice(1);
  const git = prog === 'git' ? gitSub(w) : null;
  if (NO_READ.has(prog) || (git && ['check-ignore', 'ls-files', 'status'].includes(git.sub))) return [...w.in];
  if (SEARCHES.has(prog) || git?.sub === 'grep') {
    const args = git ? git.args : rest;
    const out = [...w.in];
    let pattern = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (/^(-e|--regexp|-pattern)$/i.test(a)) { pattern = true; i++; continue; }
      if (/^(-f|--file|-path|-literalpath)$/i.test(a)) { if (args[i + 1] !== undefined) out.push(args[i + 1]); i++; continue; }
      if (/^(-g|--glob|--iglob|--include)$/.test(a)) { if (args[i + 1] !== undefined) out.push(globAsFile(args[i + 1])); i++; continue; }
      if (/^--(glob|iglob|include)=/.test(a)) { out.push(globAsFile(a.slice(a.indexOf('=') + 1))); continue; }
      if (/^(-A|-B|-C|-m|-d|-D|-t|-T|-j|-M|--max-count|--context|--after-context|--before-context|--type|--type-not|--threads|--max-columns)$/.test(a)) { i++; continue; }
      if (a.startsWith('-') || (prog === 'findstr' && a.startsWith('/'))) continue;
      if (!pattern) { pattern = true; continue; }
      out.push(a);
    }
    return out;
  }
  if (prog === 'jq' || prog === 'yq' || prog === 'gojq') {
    const out = [...w.in];
    let filter = false;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (/^--(arg|argjson|slurpfile|rawfile)$/.test(a)) { if (/file$/.test(a) && rest[i + 2] !== undefined) out.push(rest[i + 2]); i += 2; continue; }
      if (/^(--indent|-L)$/.test(a)) { i++; continue; }
      if (/^(-f|--from-file)$/.test(a)) { filter = true; if (rest[i + 1] !== undefined) out.push(rest[i + 1]); i++; continue; }
      if (a.startsWith('-')) continue;
      if (!filter) { filter = true; continue; }
      out.push(a);
    }
    return out;
  }
  return [...w, ...w.in];
}

/**
 * A staged diff (`git diff --cached`) → how many secrets it adds, by what the plugin can see without engine/: a file
 * added or changed whose name is a secret, and an added line holding an AIsle key in its minted shape. Weaker than
 * engine/aisle/secrets.mjs, which the overseer runs before it merges (closed there); a count for the secrets rule's
 * state.scan when the project has no scan of its own (cl4a/wishes.md 2).
 */
export function diffSecretHits(diff) {
  let hits = 0;
  for (const line of String(diff ?? '').split(/\r?\n/)) {
    const file = /^\+\+\+ b\/(.+)$/.exec(line);
    if (file) { if (secretFileKind(file[1].trim())) hits++; continue; }
    if (line.startsWith('+') && !line.startsWith('+++') && KEY_SHAPE.test(line)) hits++;
  }
  return hits;
}

/**
 * The rules, in aisle/GATE.md's order. Each: key, name (in the refusal), gateName (its GATE.md name), line (its line in
 * AO's aisle/GATE.md, pinned by a test), event and tools (where it is meant to run), mode ('closed' or 'open'), waits (the
 * cl1 fact its wiring rests on, beyond "a claude -p run loads the plugin's hooks"), read and value (its GATE.md value and
 * default), and check(ctx) → { decision, message }, where ctx also holds limit (the value), line, id and say(fact, limit,
 * step) for a refusal.
 */
export const RULES = Object.freeze([
  {
    key: 'workers', name: 'workers', gateName: 'workers per machine', line: 7, read: 'number', value: 3,
    event: 'none: the foreman, before it starts a worker', tools: null, mode: 'closed', waits: '',
    check: ({ state, limit, say }) => {
      const n = need(state.running, 'the workers running on this machine');
      return n >= limit ? say(`this machine already runs ${n} worker${n === 1 ? '' : 's'}`, `at most ${limit} per machine`, 'leave the job queued; the next free slot takes it') : ALLOW;
    },
  },
  {
    key: 'turns', name: 'turns', gateName: 'turns per job', line: 8, read: 'number', value: GATE_CAPS.turns,
    event: 'none: --max-turns on the claude -p call; this answers the same question from a count', tools: null, mode: 'closed', waits: '',
    check: ({ state, job, gate, id, say }) => {
      const cap = jobCaps(job, gate).turns;
      const n = need(state.turns, `job ${id}'s turns`);
      return n >= cap ? say(`job ${id} has taken ${n} turns`, `cap ${cap} turns`, SAVE) : ALLOW;
    },
  },
  {
    key: 'minutes', name: 'minutes', gateName: 'minutes per job', line: 9, read: 'number', value: GATE_CAPS.minutes,
    event: 'none: the foreman\'s timer', tools: null, mode: 'closed', waits: '',
    check: ({ state, job, gate, id, say }) => {
      const cap = jobCaps(job, gate).minutes;
      const n = need(state.minutes, `job ${id}'s minutes`);
      return n >= cap ? say(`job ${id} has run ${Math.floor(n)} minutes`, `cap ${cap} minutes`, 'end now; the foreman commits what is on disk as unfinished') : ALLOW;
    },
  },
  {
    key: 'batchHours', name: 'batch hours', gateName: 'hours per batch', line: 10, read: 'number', value: 4,
    event: 'none: the foreman, before it starts a worker', tools: null, mode: 'closed', waits: '',
    check: ({ state, limit, say }) => {
      const h = need(state.batchHours, 'the batch\'s hours');
      return h >= limit ? say(`the batch has run ${Math.round(h * 10) / 10} hours`, `at most ${limit} hours per batch`, 'start nothing new until the keeper has checked every Done: line') : ALLOW;
    },
  },
  {
    key: 'tokens', name: 'budget', gateName: 'tokens per job', line: 11, read: 'tokens', value: Object.freeze({ context: 2000000, output: 32000 }),
    event: 'PreToolUse', tools: '*', mode: 'closed', waits: 'the hook\'s median milliseconds',
    check: (ctx) => {
      const { state, limit, id, say } = ctx;
      if (isSaveStep(ctx)) return ALLOW;
      if (state.tokensError) return say(`the gate cannot count your tokens (${cut(state.tokensError, 60)})`, 'fail-closed', `stop: ${SAVE}`);
      const t = state.tokens;
      if (!t || typeof t.context !== 'number' || typeof t.output !== 'number') return say('the gate cannot count your tokens (no count was given)', 'fail-closed', `stop: ${SAVE}`);
      if (t.context >= limit.context) return say(`job ${id} has used about ${commas(t.context)} context tokens`, `cap ${commas(limit.context)}`, SAVE);
      if (t.output >= limit.output) return say(`job ${id} has written about ${commas(t.output)} output tokens`, `cap ${commas(limit.output)}`, SAVE);
      return ALLOW;
    },
  },
  {
    key: 'dollars', name: 'dollars', gateName: 'dollars per job', line: 13, read: 'dollars', value: null,
    event: 'PreToolUse', tools: '*', mode: 'closed', waits: 'the rate, from the price page',
    check: (ctx) => {
      const { state, limit, gate, id, say } = ctx;
      const price = valueOf('price', gate);
      if (limit == null || price == null) return ALLOW;
      if (isSaveStep(ctx)) return ALLOW;
      const t = state.tokens;
      if (state.tokensError || !t || typeof t.context !== 'number' || typeof t.output !== 'number') return say('the gate cannot count your tokens, so not your dollars either', 'fail-closed', `stop: ${SAVE}`);
      const d = dollarsOf(t, price);
      return d >= limit ? say(`job ${id} has used about $${d.toFixed(2)} by list price, an estimate`, `cap $${limit}`, SAVE) : ALLOW;
    },
  },
  {
    key: 'batchDollars', name: 'batch dollars', gateName: 'dollars per batch', line: 14, read: 'dollars', value: null,
    event: 'none: the foreman, before it starts a worker', tools: null, mode: 'closed', waits: 'the rate, from the price page',
    check: ({ state, limit, gate, say }) => {
      if (limit == null || valueOf('price', gate) == null) return ALLOW;
      const d = need(state.batchDollars, 'the batch\'s dollars');
      return d >= limit ? say(`the batch has used about $${d.toFixed(2)} by list price, an estimate`, `cap $${limit} per batch`, 'start nothing new in this batch') : ALLOW;
    },
  },
  {
    key: 'fanout', name: 'fan-out', gateName: 'subagent depth', line: 15, read: 'depth', value: Object.freeze({ depth: 1, alive: 3 }),
    // "Task" is the same tool's name in older Claude Code (review R8).
    event: 'PreToolUse', tools: ['Agent', 'Task'], mode: 'closed', waits: 'a PreToolUse Agent matcher can deny a spawn',
    check: ({ event, state, limit, id, say }) => {
      if (limit.depth === 0) return say(`job ${id} may start no subagent`, 'depth 0', 'do the lookup yourself');
      if (event.agent_id && limit.depth <= 1) return say(`a subagent of ${id} may not start a subagent`, `depth ${limit.depth}`, 'do the lookup yourself');
      const n = need(state.subagentsAlive, `job ${id}'s running subagents`);
      return n >= limit.alive ? say(`job ${id} already has ${n} subagents running`, `at most ${limit.alive} alive`, 'wait for one to return, or do the lookup yourself') : ALLOW;
    },
  },
  {
    key: 'workflows', name: 'workflows', gateName: 'workflows in a worker', line: 16, read: 'number', value: 0,
    event: 'PreToolUse', tools: ['Workflow'], mode: 'closed', waits: 'a PreToolUse Workflow matcher can deny a run',
    check: ({ state, limit, id, say }) => {
      if (limit === 0) return say(`job ${id} may start no workflow`, 'workflows in a worker: 0', 'do the steps yourself, one at a time');
      const n = need(state.workflows, `job ${id}'s workflows`);
      return n >= limit ? say(`job ${id} has already started ${n} workflow${n === 1 ? '' : 's'}`, `at most ${limit}`, 'do the steps yourself, one at a time') : ALLOW;
    },
  },
  {
    key: 'newWork', name: 'new branch or app', gateName: 'new branch, worktree, session, app', line: 17, read: 'text', value: 'none beyond the job\'s owns',
    event: 'PreToolUse', tools: ['Bash', 'PowerShell'], mode: 'open', waits: '',
    check: (ctx) => {
      const { event, id, say } = ctx;
      const what = newWorkIn(shellCommands(event.tool_input?.command, { powershell: event.tool_name === 'PowerShell' }), ctx);
      return what ? say(what, 'none beyond the job\'s owns', 'stay in this branch and worktree, in your owns; for more, write "Need: <what> <why>" in RESUME.md') : ALLOW;
    },
  },
  {
    key: 'scope', name: 'scope', gateName: 'edits outside owns', line: 18, read: 'text', value: 'deny',
    event: 'PreToolUse', tools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'], mode: 'open', waits: '',
    check: (ctx) => {
      const { event, state, job, id, say } = ctx;
      const full = toolPath(event);
      if (!String(full).trim()) throw new Error('the call names no file');
      const at = placePath(full, { root: rootOf(ctx), cwd: event.cwd });
      const step = (p) => `write "Need: ${id} ${cut(p, 40)} <why>" in RESUME.md and go on without it; the keeper decides`;
      if (!at.inside) {
        // The temp folders the caller names (a worker's scratch files) are no app beside the job's.
        if ((state.tempDirs || []).some((d) => { try { return placePath(full, { root: d, cwd: event.cwd }).inside; } catch { return false; } })) return ALLOW;
        return say(`${cut(full, 90)} is outside job ${id}'s worktree`, `owns: ${cut(ownsText(job), 70)}`, step(full));
      }
      if (at.rel === 'RESUME.md') return ALLOW;
      const s = job.scope;
      if (!s.set) throw new Error(`job ${id} has no owns on its plan line, so the gate cannot scope it`);
      if (owned(at.rel, s.paths, at.windows)) return ALLOW;
      if (s.mission) {
        if (!Array.isArray(state.missionOwns)) throw new Error(`job ${id}'s owns are in its mission file, which was not read`);
        if (owned(at.rel, state.missionOwns, at.windows)) return ALLOW;
      }
      const extra = s.mission ? state.missionOwns : [];
      return say(`${onlyPath(at.rel, full)} is not in job ${id}'s owns`, cut(ownsText(job, extra), 90), step(at.rel));
    },
  },
  {
    key: 'push', name: 'push or deploy', gateName: 'push, deploy, publish, install global', line: 19, read: 'text', value: 'deny in a worker',
    event: 'PreToolUse', tools: ['Bash', 'PowerShell'], mode: 'open', waits: '',
    check: ({ event, say }) => {
      const hit = pushIn(shellCommands(event.tool_input?.command, { powershell: event.tool_name === 'PowerShell' }));
      return hit ? say(hit.what, 'deny in a worker', hit.step) : ALLOW;
    },
  },
  {
    key: 'secrets', name: 'secrets', gateName: 'secrets', line: 20, read: 'text', value: 'no read of .env, key files, .claude.json or .credentials.json; no aisle_, watch_ or inv_ key in a command; no commit with one',
    event: 'PreToolUse', tools: ['Read', 'Grep', 'Bash', 'PowerShell'], mode: 'open', waits: '',
    check: ({ event, state, say }) => {
      const step = 'work without it; if the job needs the value, write "Need: <job> <what> <why>" in RESUME.md';
      if (READ_TOOLS.has(event.tool_name)) {
        const p = toolPath(event);
        const kind = p ? secretFileKind(String(p).replace(/[\\/]+$/, '')) : '';
        if (kind) return say(`${cut(String(p).split(/[\\/]/).pop(), 40)} is ${kind}`, 'no read of a secret', step);
        const glob = String(event.tool_input?.glob ?? '');
        const gkind = glob ? secretFileKind(globAsFile(glob)) : '';
        if (gkind) return say(`the search reads ${gkind} (${cut(glob, 30)})`, 'no read of a secret', step);
        return ALLOW;
      }
      const command = String(event.tool_input?.command ?? '');
      if (KEY_SHAPE.test(command)) return say('the command holds an AIsle key', 'no key in a command', 'take the key out of the command; the program reads it from where it is kept');
      const cmds = shellCommands(command, { powershell: event.tool_name === 'PowerShell' });
      for (const w of cmds) {
        for (const word of readWords(w)) {
          for (const part of word.split('=')) {
            // A file name holds no blank here, so a commit message that ends in ".key" is not taken for a key file.
            if (/\s/.test(part.replace(/[\\/]+$/, '').split(/[\\/]/).pop())) continue;
            const kind = secretFileKind(part.replace(/[\\/]+$/, ''));
            if (kind) return say(`the command names ${cut(part.split(/[\\/]/).pop(), 40)}, ${kind}`, 'no read of a secret', step);
          }
        }
      }
      if (cmds.some((w) => progName(w[0]) === 'git' && gitSub(w).sub === 'commit')) {
        const hits = state.scan?.hits;
        if (typeof hits !== 'number') throw new Error('the secret scan of the staged change gave no count');
        if (hits > 0) return say(`the secret scan found ${hits} secret${hits === 1 ? '' : 's'} in the staged change`, 'no commit with a secret', 'take the secret out of the staged files, then commit');
      }
      return ALLOW;
    },
  },
  {
    key: 'night', name: 'night', gateName: 'night', line: 21, read: 'night', value: Object.freeze({ yes: false, from: 0, to: 420 }),
    event: 'none: the foreman, before it starts a worker', tools: null, mode: 'closed', waits: '',
    check: ({ state, limit, say }) => {
      if (limit.yes) return ALLOW;
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(state.localTime ?? '').trim());
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error('the gate was given no local time it can read');
      const t = hhmm(m[1], m[2]);
      const inside = limit.from <= limit.to ? t >= limit.from && t < limit.to : t >= limit.from || t < limit.to;
      return inside ? say(`it is ${clock(t)} local, inside the night`, `no Send ${clock(limit.from)}-${clock(limit.to)} local`, `leave the job queued until ${clock(limit.to)}`) : ALLOW;
    },
  },
  {
    key: 'planFile', name: 'plan file', gateName: 'plan file', line: 22, read: 'text', value: 'a worker never writes aisle/PLAN.md, aisle/GATE.md, aisle/frames/ or its .aisle-job',
    event: 'PreToolUse', tools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'], mode: 'closed', waits: '',
    check: (ctx) => {
      const { event, state, id, say } = ctx;
      if (SHELL_TOOLS.has(event.tool_name)) {
        // The same files written from the shell: rm .aisle-job, git clean -x, sed -i on GATE.md, > aisle/PLAN.md (review R2).
        // A sieve like the other shell rules; the gate's own reading of its files is cl4's (cl4a/wishes.md 7 and 8).
        for (const { w, cwd } of withCwd(shellCommands(event.tool_input?.command, { powershell: event.tool_name === 'PowerShell' }), ctx)) {
          for (const t of shellWrites(w)) {
            const hit = gateFileHit(t.path, t.del, ctx, cwd);
            if (!hit) continue;
            const did = `${t.verb === '>' ? `> ${cut(t.path, 40)}` : `${t.verb} ${cut(t.path, 40)}`} ${t.del ? 'deletes' : 'writes'}`;
            if (hit.job) return say(`${did} ${hit.what}, the gate's own record of job ${id}`, 'plan file: a worker never writes its .aisle-job', 'leave it; the foreman writes it');
            const { files, folders } = planFiles(state.planPath || 'aisle/PLAN.md');
            return say(`${did} ${hit.what}, the plan's own file, which no worker writes`, `plan file: ${[...files, ...folders.map((f) => `${f}/`)].join(', ')}`, 'write the change you need in RESUME.md as "Plan: <change>"; the keeper writes the plan');
          }
        }
        return ALLOW;
      }
      const at = placePath(toolPath(event), { root: rootOf(ctx), cwd: event.cwd });
      if (!at.inside) return ALLOW;
      const rel = at.windows ? at.rel.toLowerCase() : at.rel;
      const { files, folders } = planFiles(state.planPath || 'aisle/PLAN.md');
      const low = (x) => (at.windows ? x.toLowerCase() : x);
      if (/^\.aisle-job(\..*)?$/i.test(rel)) return say(`${at.rel} is the gate's own record of job ${id}`, 'plan file: a worker never writes its .aisle-job', 'leave it; the foreman writes it');
      if (files.map(low).includes(rel) || folders.map(low).some((f) => rel === f || rel.startsWith(`${f}/`))) {
        return say(`${at.rel} is the plan's own file, which no worker writes`, `plan file: ${[...files, ...folders.map((f) => `${f}/`)].join(', ')}`, 'write the change you need in RESUME.md as "Plan: <change>"; the keeper writes the plan');
      }
      return ALLOW;
    },
  },
  {
    key: 'done', name: 'done', gateName: 'done', line: 23, read: 'text', value: 'no line turns done without an evidence item that is not "none recorded"',
    event: 'PreToolUse', tools: ['Edit', 'Write', 'MultiEdit'], mode: 'open', waits: '',
    check: (ctx) => {
      const { event, state, say } = ctx;
      const at = placePath(toolPath(event), { root: rootOf(ctx), cwd: event.cwd });
      const plan = state.planPath || 'aisle/PLAN.md';
      if (!at.inside || (at.windows ? at.rel.toLowerCase() !== plan.toLowerCase() : at.rel !== plan)) return ALLOW;
      if (typeof state.planBefore !== 'string') throw new Error('the gate was not given the plan as it is before the edit');
      const after = textAfterEdit(state.planBefore, event.tool_name, event.tool_input || {});
      if (after === null) return ALLOW;
      const ids = doneWithoutEvidence(state.planBefore, after);
      return ids.length ? say(`${ids.length === 1 ? 'job' : 'jobs'} ${cut(ids.join(', '), 60)} would turn done with no evidence`, 'evidence: commit, test, log, live, seen or file', 'add the evidence item, or leave the status as it is') : ALLOW;
    },
  },
  {
    key: 'stop', name: 'stop', gateName: 'stop', line: 24, read: 'stop', value: Object.freeze({ minutes: 10 }),
    event: 'Stop', tools: null, mode: 'open', waits: '',
    check: ({ event, state, limit, id, say }) => {
      if (event.stop_hook_active) return ALLOW;
      const { dirty, resumeAgeMinutes: age } = state;
      if (dirty === undefined && age === undefined) throw new Error('the gate was given no worktree state');
      const noResume = age === null || (typeof age === 'number' && age > limit.minutes);
      if (dirty !== true && !noResume) return ALLOW;
      const fact = dirty === true
        ? `job ${id} has uncommitted changes${noResume ? ` and no RESUME.md from the last ${limit.minutes} minutes` : ''}`
        : `job ${id} has no RESUME.md from the last ${limit.minutes} minutes`;
      return say(fact, 'commit and write RESUME.md before ending', 'commit your work, write RESUME.md (what is done, what is next), then end');
    },
  },
].map((r) => Object.freeze(r)));

/** The values a rule reads that are not rules themselves. */
export const VALUES = Object.freeze([Object.freeze({ key: 'price', gateName: 'price per million tokens', line: 12, read: 'price', value: null })]);
const BY_NAME = new Map([...RULES, ...VALUES].map((d) => [d.gateName, d]));
const BY_KEY = new Map(RULES.map((r) => [r.key, r]));

// ---- 8. Running the rules -------------------------------------------------------------------------------------------

/** Whether a job (as readJob reads it) names a job. */
const hasJob = (job) => Boolean(job && typeof job.id === 'string' && job.id.trim());
/** The job a caller passed: readJob's object, or the file's text. */
const jobOf = (job) => (typeof job === 'string' ? readJob(job) : job || null);

/**
 * One rule on one call → { decision, message, rule, line } (plus failed: true when its check could not run, guide: true
 * when the file made it a note, retired: true when the file took it out). No job: allow, before anything else is read. A check that throws holds the rule's mode:
 * closed denies ("the gate cannot check ..."), open allows with a note for the log. A "guide" line turns a deny into an
 * allow that keeps the message (not the stop rule, whose hold is the guidance).
 */
export function runRule(rule, { event = {}, job = null, state = {}, gate = null } = {}) {
  const j = jobOf(job);
  // No job: allow, before the gate's file or anything else is read (review R16).
  if (!hasJob(j)) return { ...ALLOW, rule: rule.key, line: rule.line };
  const line = lineOf(rule, gate);
  const base = { rule: rule.key, line };
  if (gate?.rules?.[rule.key]?.retired) return { ...ALLOW, retired: true, ...base };
  const id = cut(j.id, 40);
  const say = (fact, limit, step) => ({ decision: 'deny', message: denyMessage(rule.name, fact, limit, step, line), ...base });
  const ctx = { event: event || {}, job: j, state: state || {}, gate, limit: valueOf(rule.key, gate), line, id, say };
  let res;
  try {
    res = rule.check(ctx);
  } catch (e) {
    const why = cut(e?.message || String(e), 120);
    if (rule.mode === 'open') return { decision: 'allow', message: `AIsle gate, ${rule.name}: the check could not run (${why}); allowed and logged (fail-open).`, failed: true, ...base };
    return { ...say(why, 'fail-closed', rule.key === 'workers' || rule.key === 'batchHours' || rule.key === 'batchDollars' || rule.key === 'night' ? 'start nothing until the foreman can count it' : SAVE), failed: true };
  }
  if (res.decision === 'deny' && rule.key !== 'stop' && gate?.rules?.[rule.key]?.kind === 'guide') return { ...res, decision: 'allow', guide: true };
  return { ...res, ...base };
}

/** The rules a hook event and tool run, in the order they are asked: money first, then the fixed lists, then the sieves. */
const HOOK_ORDER = ['tokens', 'dollars', 'planFile', 'done', 'scope', 'secrets', 'push', 'newWork', 'fanout', 'workflows', 'stop'];
const runs = (rule, name, tool) => rule.event === name && (rule.tools === null || rule.tools === '*' || rule.tools.includes(tool));

/** The first refusal among `keys`, or allow with every note (fail-open checks and guide lines) for the log. */
function first(keys, ctx) {
  const notes = [];
  for (const key of keys) {
    const r = runRule(BY_KEY.get(key), ctx);
    if (r.decision === 'deny') return { ...r, notes };
    if (r.message) notes.push(r);
  }
  return { ...ALLOW, notes };
}

/**
 * The gate on one hook call (PreToolUse or Stop) → the first refusal, else allow with notes. Job cl4 turns a deny into
 * the hook's answer: PreToolUse permissionDecision "deny" with the message as its reason, Stop decision "block". Any other
 * event, or no job, allows.
 */
export function gate(ctx = {}) {
  const event = ctx.event || {};
  if (!hasJob(jobOf(ctx.job))) return { ...ALLOW, notes: [] };
  const keys = HOOK_ORDER.filter((k) => runs(BY_KEY.get(k), event.hook_event_name, event.tool_name));
  return first(keys, ctx);
}

/** The foreman, before it starts a worker on the job (cl6): workers per machine, hours per batch, dollars per batch, night. */
export const foremanStart = (ctx = {}) => first(['workers', 'batchHours', 'batchDollars', 'night'], ctx);
/** The foreman, while a worker runs (cl6): a deny means end the run at its cap. */
export const foremanTick = (ctx = {}) => first(['turns', 'minutes'], ctx);

// ---- 9. Not rules: what the hooks serve at a start, arm A's line before an edit, the RESUME.md note ----------------

/**
 * SessionStart (every source, compact included) and SubagentStart → the additionalContext to serve: the packet from
 * .aisle-job, and for a subagent one line more. Nothing with no job, and nothing on "chain: once" (arm B gets the chain in
 * its brief only, part 1a §3b, revise.md T1).
 */
export function startContext({ event = {}, job = null } = {}) {
  const j = jobOf(job);
  if (!hasJob(j) || j.chain === 'once' || !j.packet.trim()) return '';
  const sub = event.hook_event_name === 'SubagentStart';
  if (!sub && event.hook_event_name !== 'SessionStart') return '';
  // The whole answer, the subagent's line included, stays shorter than CHAIN_MOST (D113 (3), review R20).
  const line = `You are a subagent of job ${cut(j.id, 40)}: return a short answer; start no subagent and no workflow.`;
  const room = sub ? CHAIN_MOST - 2 - line.length : CHAIN_MOST - 1;
  const packet = j.packet.length > room ? `${j.packet.slice(0, room - 1)}…` : j.packet;
  return sub ? `${packet}\n${line}` : packet;
}

/** revise.md T6: after this many minutes with no fresh RESUME.md, PostToolUse serves a note; guidance, never a refusal. */
export const RESUME_NOTE_MINUTES = 5;

/**
 * PostToolUse → the note "write RESUME.md now" (revise.md T6, review R7), or '' when none is due: no job, another event,
 * RESUME.md younger than RESUME_NOTE_MINUTES, the last note younger than that (state.noteAgeMinutes, so it is said at most
 * once in that time), or no age gathered (a note is guidance, so nothing is said that the gate cannot back). The saving
 * itself is driven from outside: the foreman commits the worktree every 10 minutes (T6).
 */
export function resumeNote({ event = {}, job = null, state = {} } = {}) {
  const j = jobOf(job);
  if (!hasJob(j) || event.hook_event_name !== 'PostToolUse') return '';
  const age = state.resumeAgeMinutes;
  if (age !== null && typeof age !== 'number') return '';
  if (typeof age === 'number' && age < RESUME_NOTE_MINUTES) return '';
  if (typeof state.noteAgeMinutes === 'number' && state.noteAgeMinutes < RESUME_NOTE_MINUTES) return '';
  const fact = age === null ? 'there is no RESUME.md yet' : `RESUME.md is ${Math.floor(age)} minutes old`;
  return `AIsle job ${cut(j.id, 40)}: ${fact}; write RESUME.md now (what is done, what is next), then go on. A note (SAVE THE JOB), not a refusal.`;
}

/** Arm A's one line before an Edit or Write (part 1a §3b): whether the path is in the job's owns. '' when not served. */
export function editLine({ event = {}, job = null, state = {} } = {}) {
  const j = jobOf(job);
  if (!hasJob(j) || j.chain === 'once' || !EDIT_TOOLS.has(event.tool_name)) return '';
  try {
    const at = placePath(toolPath(event), { root: state.root || event.cwd, cwd: event.cwd });
    const extra = Array.isArray(state.missionOwns) ? state.missionOwns : [];
    const mine = at.inside && (at.rel === 'RESUME.md' || owned(at.rel, [...j.scope.paths, ...extra], at.windows));
    return `AIsle job ${cut(j.id, 40)}: you own ${cut(ownsText(j, extra), 160)}; ${cut(at.rel || toolPath(event), 80)} is ${mine ? 'in' : 'not in'} your owns.`;
  } catch {
    return '';
  }
}

// ---- 10. The keep rule and the person's-limit rule (D126 (3), job kg2) ---------------------------------------------
//
// research/d126-keep-going/design.md 3b to 3d, as its section 9 answered the tilt review; kg1-facts.md facts 4, 7 and 8;
// the choices design.md left open are in research/d126-keep-going/kg2-notes.md. Not one of RULES: it has its own entry
// point, keepStop(), since every gate rule allows at once with no .aisle-job, and this one acts on any known goal (3a).
// The caller (job kg4, with kg9's goal lookups) reads the files, the clock and the transcript and passes what it found;
// nothing here reads them. GATE.md lines 25 to 28 are written by the keeper in kg4; until then the numbers below hold.
// Inert like the rest of this file: nothing imports it.

/** The lines of aisle/GATE.md the keep rule's answers name (kg4 writes them after line 24). */
export const KEEP_LINES = Object.freeze({ keep: 25, noProgress: 26, perJob: 27, perChat: 28 });
/** D126 (3e): the caps. A cap lets the stop through and the job goes back to the queue. */
export const KEEP_LIMITS = Object.freeze({ blocksNoProgress: 3, tokensNoProgress: 1500000, blocksPerJob: 40, tokensPerWindow: 10000000, windowMinutes: 300, cronMinutes: 60 });
/** A wall's kinds (Ofir's list of what only a person can do); a decision is never one (D110). */
export const WALL_KINDS = Object.freeze(['hands', 'money', 'consent', 'irreversible']);
/** design.md 3d case 3: a typed prompt that starts with, or holds as a phrase, one of these sets a limit. */
export const LIMIT_PHRASES = Object.freeze(['stop', 'pause', 'hold on', 'wait', 'only part', 'and stop', 'until i say', 'don\'t continue', 'do not continue', 'dont continue', 'that\'s all', 'that is all', 'thats all']);
/** The proof tools/oversee.mjs --dry-run --proof writes at the worktree's root (job kg3). */
export const PROOF_FILE = '.aisle-job.proof';

// -- SHA-256 and HMAC-SHA256, written out: this file imports nothing, not even a node: module (test/gate.test.mjs).
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (x, n) => (x >>> n) | (x << (32 - n));
const utf8 = (s) => new TextEncoder().encode(String(s ?? ''));
const bytesOf = (x) => (x instanceof Uint8Array ? x : utf8(x));
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** SHA-256 of bytes (a string is taken as UTF-8) → 32 bytes. */
function sha256Bytes(input) {
  const msg = bytesOf(input);
  const len = msg.length;
  const size = Math.ceil((len + 9) / 64) * 64;
  const m = new Uint8Array(size);
  m.set(msg);
  m[len] = 0x80;
  const bitsHigh = Math.floor(len / 0x20000000), bitsLow = (len * 8) >>> 0;
  for (let k = 0; k < 4; k++) { m[size - 8 + k] = (bitsHigh >>> (24 - 8 * k)) & 0xff; m[size - 4 + k] = (bitsLow >>> (24 - 8 * k)) & 0xff; }
  const H = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  for (let off = 0; off < size; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = ((m[off + 4 * i] << 24) | (m[off + 4 * i + 1] << 16) | (m[off + 4 * i + 2] << 8) | m[off + 4 * i + 3]) >>> 0;
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      W[i] = (W[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + W[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) for (let k = 0; k < 4; k++) out[4 * i + k] = (H[i] >>> (24 - 8 * k)) & 0xff;
  return out;
}
/** SHA-256 as lowercase hex (a prompt's hash in its record). */
export const sha256Hex = (input) => hex(sha256Bytes(input));
/**
 * HMAC-SHA256 (RFC 2104) as lowercase hex. The key: the key file's bytes exactly as read (proof-format.md section 2, kg3:
 * `.aisle-keep/proof.key`, 32 raw bytes); a string is taken as its UTF-8 bytes.
 */
export function hmacHex(key, message) {
  let k = bytesOf(key);
  if (k.length > 64) k = sha256Bytes(k);
  const ipad = new Uint8Array(64), opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { ipad[i] = (k[i] ?? 0) ^ 0x36; opad[i] = (k[i] ?? 0) ^ 0x5c; }
  const msg = bytesOf(message);
  const inner = new Uint8Array(64 + msg.length);
  inner.set(ipad); inner.set(msg, 64);
  const outer = new Uint8Array(96);
  outer.set(opad); outer.set(sha256Bytes(inner), 64);
  return sha256Hex(outer);
}
const sameHex = (a, b) => {
  const x = String(a ?? '').toLowerCase(), y = String(b ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(x) || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
};
const hasKey = (key) => (typeof key === 'string' ? key.length > 0 : key instanceof Uint8Array && key.length > 0);
/** A key's public name, as the proof's `key` field holds it: the first 16 hex of SHA-256 over the key's bytes (kg3). */
export const keyId = (key) => sha256Hex(bytesOf(key)).slice(0, 16);

/**
 * The one place a signature is made and checked, so it can be aligned with kg3's writer: HMAC-SHA256, hex, over
 * JSON.stringify of the object without its `hmac` field, keys in the order they were written (the order JSON.parse keeps).
 */
export function signRecord(key, record) {
  if (!hasKey(key)) throw new Error('no key to sign with');
  const { hmac: _drop, ...body } = record || {};
  return { ...body, hmac: hmacHex(key, JSON.stringify(body)) };
}
/** Whether a record (a proof, a typed prompt's record, the room's limit) carries a good signature made with `key`. */
export function verifyRecord(key, record) {
  if (!hasKey(key) || !record || typeof record !== 'object' || Array.isArray(record)) return false;
  const { hmac, ...body } = record;
  return typeof hmac === 'string' && sameHex(hmac, hmacHex(key, JSON.stringify(body)));
}

// -- Time without the clock: ISO text → milliseconds, and the calendar a cron reads.
const daysFromCivil = (y, m, d) => {
  const yy = y - (m <= 2 ? 1 : 0);
  const era = Math.floor(yy / 400), yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
};
const civilFromDays = (z0) => {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097), doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d: doy - Math.floor((153 * mp + 2) / 5) + 1 };
};
/** An ISO 8601 time ("2026-10-27T12:39:08.911Z", or with an offset; none read as UTC) → milliseconds since 1970, or null. */
export function isoMs(text) {
  const t = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(String(text ?? '').trim());
  if (!t) return null;
  const [y, mo, d, h, mi, s] = [1, 2, 3, 4, 5, 6].map((i) => Number(t[i] ?? 0));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  const ms = Number(((t[7] ?? '') + '000').slice(0, 3));
  let off = 0;
  if (t[8] && t[8].toUpperCase() !== 'Z') { const o = /([+-])(\d{2}):?(\d{2})/.exec(t[8]); off = (o[1] === '-' ? -1 : 1) * (Number(o[2]) * 60 + Number(o[3])); }
  return (((daysFromCivil(y, mo, d) * 24 + h) * 60 + mi - off) * 60 + s) * 1000 + ms;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** One cron field → the Set of values it allows, null for "*", or undefined when it cannot be read. */
function cronField(text, lo, hi, names) {
  const t = String(text).toLowerCase();
  if (t === '*' || t === '?') return null;
  const val = (s) => { const i = names ? names.indexOf(s) : -1; if (i >= 0) return i + (names === MONTHS ? 1 : 0); return /^\d+$/.test(s) ? Number(s) : NaN; };
  const out = new Set();
  for (const part of t.split(',')) {
    const m = /^(\*|[a-z0-9]+(?:-[a-z0-9]+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) return undefined;
    const step = m[2] ? Number(m[2]) : 1;
    let from = lo, to = hi;
    if (m[1] !== '*') { const [a, b] = m[1].split('-'); from = val(a); to = b === undefined ? (m[2] ? hi : from) : val(b); }
    if (!Number.isInteger(from) || !Number.isInteger(to) || step < 1 || from < lo || to > hi || from > to) return undefined;
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}
/**
 * A five-field cron schedule (as session_crons gives it, in local time) and the local time now ("YYYY-MM-DDTHH:MM") →
 * the minutes until it is next due, 0 to `within`, or -1 (not due in that time, or not readable). A day of the month and
 * a weekday both set match either, as cron reads them.
 */
export function cronDueIn(schedule, localNow, within = KEEP_LIMITS.cronMinutes) {
  const f = String(schedule ?? '').trim().split(/\s+/);
  const now = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(localNow ?? ''));
  if (f.length !== 5 || !now) return -1;
  const [mi, h, dom, mon, dow] = [cronField(f[0], 0, 59), cronField(f[1], 0, 23), cronField(f[2], 1, 31), cronField(f[3], 1, 12, MONTHS), cronField(f[4], 0, 7, DAYS)];
  if ([mi, h, dom, mon, dow].includes(undefined)) return -1;
  if (dow?.has(7)) dow.add(0);
  const start = (daysFromCivil(Number(now[1]), Number(now[2]), Number(now[3])) * 24 + Number(now[4])) * 60 + Number(now[5]);
  for (let k = 0; k <= within; k++) {
    const t = start + k;
    const day = Math.floor(t / 1440);
    const { m, d } = civilFromDays(day);
    const wd = ((day % 7) + 11) % 7;
    const minute = t % 1440;
    if (mi && !mi.has(minute % 60)) continue;
    if (h && !h.has(Math.floor(minute / 60))) continue;
    if (mon && !mon.has(m)) continue;
    const dayOk = dom && dow ? dom.has(d) || dow.has(wd) : (!dom || dom.has(d)) && (!dow || dow.has(wd));
    if (dayOk) return k;
  }
  return -1;
}

// -- The proof (design.md 3b, 3c).

/** A check's name in a reason: its kind and its file only, never a grep's text or a judge's clause (design.md 3d). */
export function checkLabel(check, judgeNo = 0) {
  const kind = String(check?.kind ?? '').trim().toLowerCase();
  if (kind === 'judge') return judgeNo ? `judge ${judgeNo}` : 'judge';
  if (['test', 'file', 'grep', 'grep!'].includes(kind)) {
    let path = typeof check.path === 'string' ? check.path.trim() : '';
    if (!path) {
      // A name as the plan writes it: 'grep "<text>" <path>'. Drop the kind and every quoted part; the last word is the path.
      const rest = String(check.name ?? '').replace(/^\s*(test|file|grep!?)(?=\s|$)/i, '').replace(/(["“”'])(?:(?!\1)[\s\S])*\1?/g, ' ').trim().split(/\s+/).filter(Boolean);
      path = rest.at(-1) || '';
    }
    return path && !/["“”']/.test(path) ? `${kind} ${cut(path, 80)}` : kind;
  }
  return cut(kind.replace(/[^a-z!-]/g, ''), 20) || 'check';
}
const labels = (checks) => { let j = 0; return checks.map((c) => checkLabel(c, String(c?.kind).toLowerCase() === 'judge' ? ++j : 0)); };

/**
 * The proof's text as the caller read it at the root (proof-format.md section 3, kg3), with the key's bytes, HEAD and
 * whether the worktree is clean → { status, proven, count, total, open, commit }. status, in the order kg3's section 4
 * checks them: none, unreadable (not JSON, or not v 1), no key, unsigned, other key (its `key` names another key), forged
 * (edited, or signed without the key), stale (not HEAD), dirty, other job, ok. Only "ok" gives a count: the checks but
 * `live` passing at HEAD in a signed proof, the only progress there is (3d case 5). proven: ok, every check but `live`
 * passes, at least one `test` or `judge` check passes, the verdict is pass or pending, the proof's own `proven` is not
 * false, and every check the job's line names (`expected`, as engine/aisle/plan.mjs reads them) is there and passes.
 * The rule counts the checks itself rather than trusting `passing` and `proven` alone.
 */
export function proofState({ text = null, key = null, head = '', dirty, job = '', expected = [] } = {}) {
  const out = (status, more = {}) => ({ status, proven: false, count: null, total: 0, open: '', commit: '', ...more });
  if (text == null || !String(text).trim()) return out('none');
  let p;
  try { p = JSON.parse(String(text)); } catch { return out('unreadable'); }
  if (!p || typeof p !== 'object' || Array.isArray(p) || p.v !== 1) return out('unreadable');
  if (!hasKey(key)) return out('no key');
  if (typeof p.hmac !== 'string' || !p.hmac) return out('unsigned');
  if (p.key !== undefined && String(p.key).toLowerCase() !== keyId(key)) return out('other key');
  if (!verifyRecord(key, p)) return out('forged');
  const commit = String(p.commit ?? '').toLowerCase();
  const h = String(head ?? '').toLowerCase();
  if (!/^[0-9a-f]{7,64}$/.test(commit) || !h || !(commit === h || (commit.length >= 7 && h.startsWith(commit)) || (h.length >= 7 && commit.startsWith(h)))) return out('stale', { commit });
  if (dirty !== false) return out('dirty', { commit });
  if (String(p.job ?? '') !== String(job)) return out('other job', { commit });
  const checks = Array.isArray(p.checks) ? p.checks.filter((c) => c && typeof c === 'object') : [];
  const names = labels(checks);
  const passes = (c) => c.ok === true || String(c.verdict ?? '').toLowerCase() === 'pass';
  const counted = checks.map((c, i) => ({ c, label: names[i], kind: String(c.kind ?? '').toLowerCase() })).filter((x) => x.kind !== 'live');
  const passing = counted.filter((x) => passes(x.c)).length;
  const firstOpen = counted.find((x) => !passes(x.c));
  const strong = counted.some((x) => (x.kind === 'test' || x.kind === 'judge') && passes(x.c));
  const missing = (Array.isArray(expected) ? expected : []).filter((e) => e && String(e.kind).toLowerCase() !== 'live').find((e) => {
    const k = String(e.kind).toLowerCase();
    return !counted.some((x) => x.kind === k && passes(x.c) && (k === 'judge' || checkLabel(x.c) === checkLabel(e)));
  });
  const verdictOk = ['pass', 'pending'].includes(String(p.verdict?.outcome ?? p.verdict ?? '').toLowerCase());
  const proven = counted.length > 0 && !firstOpen && strong && !missing && verdictOk && p.proven !== false;
  const open = firstOpen ? firstOpen.label : missing ? checkLabel(missing) : !strong ? 'judge (a clause from the Done when)' : '';
  return out('ok', { proven, count: passing, total: counted.length, open, commit });
}

// -- The person's word (design.md 3d case 3; kg1-facts.md fact 4 and 8).

const NEGATIONS = new Set(['don\'t', 'dont', 'do not', 'never', 'no', 'not', 'without', 'can\'t', 'cannot', 'won\'t']);
/** Whether text sets a limit: it holds one of LIMIT_PHRASES as whole words, not right after a "don't", "never" or "no". */
export function holdsLimit(text) {
  const s = ` ${String(text ?? '').toLowerCase().replace(/[’‘]/g, '\'').replace(/\s+/g, ' ').trim()} `;
  for (const phrase of LIMIT_PHRASES) {
    const re = new RegExp(`(?<=[^a-z'])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^a-z'])`, 'g');
    for (const m of s.matchAll(re)) {
      const before = s.slice(0, m.index).trim().split(' ');
      const last = before.at(-1)?.replace(/[^a-z']/g, '') ?? '';
      const two = before.slice(-2).join(' ').replace(/[^a-z' ]/g, '');
      if (NEGATIONS.has(last) || NEGATIONS.has(two)) continue;
      return true;
    }
  }
  return false;
}

const TASK_NOTE = /^\s*<task-notification>/i;
/**
 * UserPromptSubmit → the record to keep in the plugin's data (signed with the proof key), or null: no key, or a task
 * notification or a listener's wake (it starts with <task-notification>). It keeps the prompt's id, its hash and whether
 * it sets a limit, never its text. `at` is the caller's clock. Whether the prompt was typed is settled at Stop from the
 * transcript (personLimit), since the hook's input has no origin field (kg1 fact 4).
 */
export function promptRecord({ event = {}, key = null, at = '' } = {}) {
  if (!hasKey(key) || event.hook_event_name !== 'UserPromptSubmit') return null;
  const prompt = String(event.prompt ?? '');
  if (!prompt.trim() || TASK_NOTE.test(prompt)) return null;
  return signRecord(key, { session: String(event.session_id ?? ''), promptId: String(event.prompt_id ?? ''), at: String(at), limit: holdsLimit(prompt), hash: sha256Hex(prompt) });
}

/** A transcript (JSONL text or its parsed lines) → the lines, skipping any that do not parse. */
export function readJsonl(text) {
  if (Array.isArray(text)) return text;
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch { /* a torn last line */ } }
  return out;
}
const promptText = (p) => (typeof p === 'string' ? p : Array.isArray(p) ? p.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).join('') : '');
/**
 * The transcript → who sent each prompt (kg1 fact 4): turns, a Map of promptId → 'typed' or 'other' from the user line
 * that starts its turn (turnOrigin human or sdk is typed; scheduled, system or task_notification is not), and queued, the
 * hashes of prompts typed mid-turn (a queued_command attachment with commandMode "prompt").
 */
export function typedOrigins(transcript) {
  const turns = new Map(), queued = new Set();
  for (const e of readJsonl(transcript)) {
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'user' && e.promptId && !turns.has(e.promptId) && (e.turnOrigin || e.origin || e.promptSource)) {
      const turn = String(e.turnOrigin ?? '').toLowerCase(), kind = String(e.origin?.kind ?? '').toLowerCase();
      const typed = (turn === 'human' || turn === 'sdk' || (!turn && kind === 'human')) && kind !== 'task-notification';
      turns.set(e.promptId, typed ? 'typed' : 'other');
    }
    const a = e.type === 'attachment' ? e.attachment : null;
    if (a?.type === 'queued_command' && a.commandMode === 'prompt' && String(a.origin?.kind ?? '').toLowerCase() !== 'task-notification') {
      const t = promptText(a.prompt);
      if (t && !TASK_NOTE.test(t)) queued.add(sha256Hex(t));
    }
  }
  return { turns, queued };
}

/**
 * Whether the person's own word holds a limit now → { limit, from: 'typed' | 'room' | '', typedAt }. Only signed records
 * count. A record counts as typed only when the transcript shows it so: its hash among the prompts typed mid-turn, or it
 * is the first record of a turn whose user line is typed. The newest typed prompt decides; a signed `[your user]` record
 * ({ seq, limit, at }, kg1 fact 8) with a limit decides when it is newer. The hold stays off until the next typed prompt.
 */
export function personLimit({ records = [], transcript = [], room = null, key = null } = {}) {
  const origins = typedOrigins(transcript);
  const firsts = new Set();
  let newest = null;
  for (const r of Array.isArray(records) ? records : []) {
    if (!verifyRecord(key, r)) continue;
    const first = !firsts.has(r.promptId);
    firsts.add(r.promptId);
    if (origins.queued.has(r.hash) || (first && origins.turns.get(r.promptId) === 'typed')) newest = r;
  }
  const typedAt = newest ? isoMs(newest.at) : null;
  if (room && room.limit === true && verifyRecord(key, room)) {
    const at = isoMs(room.at);
    if (!newest || (at !== null && typedAt !== null && at > typedAt)) return { limit: true, from: 'room', typedAt };
  }
  if (newest?.limit === true) return { limit: true, from: 'typed', typedAt };
  return { limit: false, from: '', typedAt };
}

// -- Walls (3d case 2) and waiting on its own work (3d case 4).

const WALL_LINE = /^\s*Wall:\s*(\S+)\s+([A-Za-z-]+)\s*:\s*(\S.*)$/gim;
const NEED_LINE = /^\s*Need:\s*(\S+)\s+(\S+)\s+(\S.*)$/gim;
/**
 * A wall the chat raised for its own job → { wall, how, kind, decision }. A worker: a `Need: <own id> <machine> <step>`
 * this chat posted (posts: [{ text, self, at }], newer than the person's newest typed prompt), or, in a headless run,
 * `Wall: <own id> <hands|money|consent|irreversible>: <step>` in its last message. A decision is never a wall (D110). The
 * brain has no wall exit: a worker's Need: is a job to relay, never the end of its hold.
 */
export function wallOf({ goal = {}, posts = [], lastMessage = '', since = null } = {}) {
  if (goal.role === 'brain' || goal.kind === 'queue') return { wall: false, how: '', kind: '', decision: false };
  const id = String(goal.id ?? '');
  for (const p of Array.isArray(posts) ? posts : []) {
    if (p?.self !== true) continue;
    const at = isoMs(p.at);
    if (since !== null && (at === null || at <= since)) continue;
    for (const m of String(p.text ?? '').matchAll(NEED_LINE)) if (m[1] === id) return { wall: true, how: 'need', kind: 'need', decision: false };
  }
  let decision = false;
  for (const m of String(lastMessage ?? '').matchAll(WALL_LINE)) {
    if (m[1] !== id) continue;
    const kind = m[2].toLowerCase();
    if (WALL_KINDS.includes(kind)) return { wall: true, how: 'wall', kind, decision: false };
    if (/^decision/.test(kind)) decision = true;
  }
  return { wall: false, how: '', kind: '', decision };
}

/** background_tasks types that end by themselves and wake the chat; a shell or a monitor never frees a stop. */
const WAITS_FOR = new Set(['subagent', 'workflow', 'teammate', 'cloudsession', 'cloudtask', 'cloud']);
/**
 * The Stop input → what the chat waits on, { on, id, minutes } or null: its own running subagent, workflow, teammate or
 * cloud task, or its own cron due within `within` minutes (local time now, from the caller).
 */
export function waitingOn({ event = {}, localNow = '', within = KEEP_LIMITS.cronMinutes } = {}) {
  for (const t of Array.isArray(event.background_tasks) ? event.background_tasks : []) {
    const type = String(t?.type ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    const status = String(t?.status ?? 'running').toLowerCase();
    if (WAITS_FOR.has(type) && ['running', 'pending', 'started', 'queued'].includes(status)) return { on: type, id: cut(t.id ?? '', 40), minutes: 0 };
  }
  for (const c of Array.isArray(event.session_crons) ? event.session_crons : []) {
    const k = cronDueIn(c?.schedule, localNow, within);
    if (k >= 0) return { on: 'cron', id: cut(c.id ?? '', 40), minutes: k };
  }
  return null;
}

/**
 * A transcript → tokens used, each message.id counted once (kg1 fact 7): input, cache creation, cache read and output.
 * → { total, window }, window being the part at or after `sinceMs` (by each line's timestamp). A chat's caps add its
 * subagents' own files (kg1 fact 7), which the caller reads and sums.
 */
export function transcriptUsage(transcript, { sinceMs = null } = {}) {
  const seen = new Set();
  let total = 0, window = 0;
  for (const e of readJsonl(transcript)) {
    if (e?.type !== 'assistant') continue;
    const u = e.message?.usage ?? e.usage;
    if (!u || typeof u !== 'object') continue;
    const id = e.message?.id ?? e.messageId;
    if (id) { if (seen.has(id)) continue; seen.add(id); }
    const n = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'].reduce((s, k) => s + (Number.isFinite(Number(u[k])) ? Number(u[k]) : 0), 0);
    total += n;
    if (sinceMs !== null) { const t = isoMs(e.timestamp); if (t !== null && t >= sinceMs) window += n; }
  }
  return { total, window };
}

// -- The entry point.

/**
 * A queue goal (3a source 5) → its progress. The brain: queue.jobs [{ id, merged, wall }], proven when every listed job is
 * merged with evidence, progress the number merged. A worker with free slots: queue { freeSlots, next }, done when no slot
 * is free or tools/job.mjs next finds no job.
 */
function queueState(goal, queue = {}) {
  if (goal.role === 'brain') {
    const jobs = Array.isArray(queue?.jobs) ? queue.jobs : [];
    const merged = jobs.filter((j) => j?.merged === true).length;
    const open = jobs.find((j) => j?.merged !== true && j?.wall !== true);
    const walled = jobs.find((j) => j?.merged !== true && j?.wall === true);
    return { status: 'queue', proven: jobs.length > 0 && merged === jobs.length, count: merged, total: jobs.length, open: open ? cut(open.id, 40) : '', walled: walled ? cut(walled.id, 40) : '' };
  }
  const free = Number(queue?.freeSlots) > 0 && Boolean(queue?.next);
  return { status: 'queue', proven: !free, count: null, total: 0, open: free ? cut(queue.next, 40) : '', walled: '' };
}

const short = (c) => String(c ?? '').slice(0, 8);
/** The reason a held stop is given: at most MESSAGE_MOST characters; a check by its kind and name, never a value. */
function keepReason({ goal, p, state, wall }) {
  const id = cut(goal.id, 40);
  const head = `AIsle keep going (${GATE_FILE} line ${KEEP_LINES.keep}): `;
  const branch = cut(state.branch || '<branch>', 40);
  const run = `run node tools/oversee.mjs ${id} ${branch} --dry-run --proof`;
  const stopWhen = state.headless
    ? `Stop only when the signed proof passes, or end with "Wall: ${id} <hands|money|consent|irreversible>: <step>" for a step only a person can take.`
    : `Stop only when the signed proof passes, or post Need: ${id} <machine> <step> for a step only a person can take.`;
  let fact, next;
  if (goal.role === 'brain') {
    fact = `your queue: ${p.count} of ${p.total} jobs merged`;
    next = p.walled ? `job ${p.walled} waits on a wall: tell Ofir in one line and send the next job${p.open ? ` (${p.open})` : ''}` : p.open ? `send or merge job ${p.open}` : 'merge the jobs that are done';
    return cut(`${head}${fact}; ${next}. Do it now. Stop only when every listed job is merged with evidence.`, MESSAGE_MOST);
  }
  if (goal.kind === 'queue') return cut(`${head}a slot is free and tools/job.mjs next gives job ${p.open}: post Claim: ${p.open} <machine> self, yield to an earlier claim, then work on it.`, MESSAGE_MOST);
  if (p.status === 'ok') { fact = `${p.count} of ${p.total} checks pass at HEAD`; next = `next open: ${p.open}`; }
  else if (p.status === 'none') { fact = 'no signed proof at HEAD'; next = run; }
  else if (p.status === 'stale') { fact = `the proof is for ${short(p.commit)}, not HEAD`; next = run; }
  else if (p.status === 'dirty') { fact = 'the worktree has uncommitted changes'; next = `commit, then ${run}`; }
  else if (p.status === 'goal edited') { fact = 'the goal record of this chat was edited by hand, so the hold stays'; next = 'go on with the job'; }
  else if (p.status === 'other key') { fact = 'the proof was made with another key'; next = run; }
  else if (p.status === 'forged' || p.status === 'unsigned') { fact = 'the proof\'s signature does not check'; next = `only the checker signs one: ${run}`; }
  else if (p.status === 'other job') { fact = 'the proof is for another job'; next = run; }
  else { fact = 'the proof cannot be read'; next = run; }
  const note = wall?.decision ? ' A decision is not a wall (D110): take the recommended one.' : '';
  const body = `job ${id}: ${fact}; ${next}. Do it now.${note} `;
  return cut(`${head}${body}${stopWhen}`, MESSAGE_MOST);
}

/**
 * The keep rule at Stop (design.md 3d) → { decision: 'allow' | 'block', case, message, line, next, log, stalled? }.
 *   event  the Stop hook's input (last_assistant_message, background_tasks, session_crons, session_id);
 *   goal   the known goal (3a, found by kg9): { kind: 'job' | 'typed' | 'queue', id, role: 'worker' | 'brain', expected?,
 *          standAside? (the built-in /goal holds this session), forged? (its signed record failed: hold) }, or null:
 *          no known goal, no hold;
 *   state  what the caller read: head, dirty, proof (the proof file's text), key (the proof key), branch, machine,
 *          headless, records (typed-prompt records), transcript, room (the signed [your user] record), posts (this
 *          room's posts, self marked), localNow ("YYYY-MM-DDTHH:MM"), now (ms), tokens { total, window } (window: the
 *          last 5 hours; both with the chat's subagents), queue (a queue goal's jobs or slots);
 *   hold   the record this function returned last time for the job (kept by the caller in plugin data), or null.
 * The stop goes through only: with no known goal; while the built-in /goal holds the session; on the person's limit;
 * proven; on a wall the chat raised for its own job; while it waits on its own subagent, workflow, teammate, cloud task
 * or a cron due within 60 minutes; or on a cap, with the `Stalled:` line to post. Otherwise it blocks. stop_hook_active
 * frees nothing, and nothing the model writes ends a hold: not a commit, a rerun, a release, a deleted marker, an unsigned
 * or edited proof, a background shell or monitor, another chat's Need: line. `log` holds the case and counts, no text. A
 * check that cannot run lets the stop through (case 'error'), so a bug never traps a person's chat.
 */
export function keepStop({ event = {}, goal = null, state = {}, hold = null, limits = {} } = {}) {
  const L = { ...KEEP_LIMITS, ...(limits || {}) };
  const allow = (kase, line, more = {}, next = hold) => ({ decision: 'allow', case: kase, message: '', line, next, log: { case: kase, job: goal?.id ? cut(goal.id, 40) : '', ...(more.log || {}) }, ...(more.extra || {}) });
  try {
    if (!goal || typeof goal.id !== 'string' || !goal.id.trim()) return allow('no goal', 0);
    if (goal.standAside === true) return allow('stand aside', 0);
    const st = state || {};
    const now = Number.isFinite(st.now) ? st.now : null;
    const total = Number.isFinite(st.tokens?.total) ? st.tokens.total : null;
    const session = String(event?.session_id ?? '');
    const h = hold && hold.job === goal.id
      ? { ...hold }
      : { job: goal.id, best: 0, blocks: 0, jobBlocks: 0, session, tokensAtProgress: total ?? 0, progressAt: now };
    if (h.session !== session) { h.session = session; h.tokensAtProgress = total ?? 0; }
    const p = goal.forged === true ? { status: 'goal edited', proven: false, count: null, total: 0, open: '' }
      : goal.kind === 'queue'
      ? queueState(goal, st.queue)
      : proofState({ text: st.proof, key: st.key, head: st.head, dirty: st.dirty, job: goal.id, expected: goal.expected });
    if (typeof p.count === 'number' && p.count > (h.best ?? 0)) Object.assign(h, { best: p.count, blocks: 0, tokensAtProgress: total ?? h.tokensAtProgress, progressAt: now });
    const counts = { count: p.count, best: h.best, blocks: h.blocks, jobBlocks: h.jobBlocks };
    const limit = personLimit({ records: st.records, transcript: st.transcript, room: st.room, key: st.key });
    if (limit.limit) return allow('limit', KEEP_LINES.keep, { log: { from: limit.from, ...counts } }, h);
    if (p.proven) return allow('proven', KEEP_LINES.keep, { log: counts }, h);
    const wall = wallOf({ goal, posts: st.posts, lastMessage: event?.last_assistant_message, since: limit.typedAt });
    if (wall.wall) return allow('wall', KEEP_LINES.keep, { log: { how: wall.how, kind: wall.kind, ...counts } }, h);
    const wait = waitingOn({ event, localNow: st.localNow, within: L.cronMinutes });
    if (wait) return allow('waiting', KEEP_LINES.keep, { log: { on: wait.on, ...counts } }, h);
    const since = total !== null ? total - (h.tokensAtProgress ?? 0) : 0;
    const window = Number.isFinite(st.tokens?.window) ? st.tokens.window : 0;
    const cap = h.blocks >= L.blocksNoProgress ? ['blocks without progress', KEEP_LINES.noProgress]
      : since >= L.tokensNoProgress ? ['tokens without progress', KEEP_LINES.noProgress]
        : h.jobBlocks >= L.blocksPerJob ? ['blocks per job', KEEP_LINES.perJob]
          : window >= L.tokensPerWindow ? ['tokens per chat', KEEP_LINES.perChat] : null;
    if (cap) {
      const minutes = now !== null && Number.isFinite(h.progressAt) ? Math.max(0, Math.floor((now - h.progressAt) / 60000)) : 0;
      const stalled = `Stalled: ${cut(goal.id, 40)} ${cut(st.machine || 'here', 40).replace(/\s+/g, '-')} ${minutes} min no progress`;
      return allow('cap', cap[1], { log: { cap: cap[0], tokensSince: since, window, ...counts }, extra: { stalled } }, { ...h, capped: cap[0] });
    }
    const next = { ...h, blocks: h.blocks + 1, jobBlocks: (h.jobBlocks ?? 0) + 1 };
    delete next.capped;
    return { decision: 'block', case: 'held', message: keepReason({ goal, p, state: st, wall }), line: KEEP_LINES.keep, next, log: { case: 'held', job: cut(goal.id, 40), status: p.status, ...counts, blocks: next.blocks, jobBlocks: next.jobBlocks } };
  } catch (e) {
    return allow('error', KEEP_LINES.keep, { log: { error: cut(e?.message || String(e), 120) } });
  }
}
