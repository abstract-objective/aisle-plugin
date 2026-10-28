// How AIsle's keep rule finds a chat's known goal (D126 (1), job kg9). The design is
// research/d126-keep-going/design.md 3a and 3d case 3; the facts are kg1-facts.md 4, 6 and 8; the plan and its choices
// are research/d126-keep-going/kg9-plan.md. The keep rule itself is the gate section 10 (keepStop, job kg2), whose
// `goal` input this file makes: { kind: 'job' | 'typed' | 'queue', id, role: 'worker' | 'brain', expected?, standAside?,
// forged? }, or null.
//
// A goal is found only from what D126 names, from local files and the plugin's own records, never by asking:
//   1. .aisle-job at the project root (tools/job.mjs take);
//   2. a `Claim: <job> ...` this chat posted: its own post_message call in transcript_path, confirmed by the room's
//      answer "Posted as #";
//   3. an open plan job whose agent field names this chat: its chat id (chat-mark-rules.mjs), its session id, or the
//      branch its worktree is on;
//   4. a `Goal:` line in a prompt the person typed, typed as the transcript shows it (kg1 fact 4);
//   5. a queue or a job kept by tools/job.mjs keep / keep --worker, in the signed goal store in the plugin's data
//      folder (kg3's proof-format.md section 5); a record whose signature fails is held as edited, never read as none.
// And only while the plugin's own data folder says `keep: on` (design 3a: on by default in Ofir's projects, by his
// words of 2026-10-27). It stands aside while the built-in /goal holds the session, so a chat never has two holders. A
// chat with none of these, or with keep off, has no goal and is never held.
//
// It also makes the record of the person's [your user] limit by kg1 fact 8's route: from a read_chat answer, the newest
// line the room marks [your user] that is not an assistant's, kept as { seq, limit, at, session } and signed, never its
// text (roomLimitRecord).
//
// Nothing here reads a file itself: every read goes through `io.text(path)`, which the caller gives (node:fs in a command
// hook or a test, or ioFromHooks($) in the hooks module). It writes nothing, runs nothing, asks nothing and reaches no
// network. It never reads a path under ~/.claude/settings*, and never takes the switch or the store from a data folder
// inside the project. It imports only its sibling rules files, as the other hook modules do; not the gate (the plugin
// keeps the gate unnamed until it goes live, its gate test's "inert" check), so what it needs from the gate and engine/ is
// copied below and test/keep-goal.test.mjs pins each copy to its source. Signatures use the environment's own Web
// Crypto (crypto.subtle), as chat-mark-rules.mjs's chatIdOf does.
//
// Inert: hooks.json names nothing here and nothing calls findGoal on a real chat. index.mjs names this file (KEEP_MODULE)
// without loading it, and
// KEEP.wired is false. Job kg4 switches it on (kg9-plan.md, "How kg4 switches it on").
import { chatIdOf, sessionText } from './chat-mark-rules.mjs';

/** The plugin data's own folder for D126 (tools/oversee.mjs KEEP_DIR). */
export const KEEP_DIR = '.aisle-keep';
/** `<data>/.aisle-keep/settings.txt`: a line `keep: on` turns the rule on for this computer (design 3a). */
export const SETTINGS_FILE = 'settings.txt';
/** The goal store, `<data>/.aisle-keep/goals/<session>.json` (tools/job.mjs goalPath). */
export const GOALS_DIR = 'goals';
/** The job file a worktree holds (the gate JOB_FILE, chain.mjs JOB_FILE). */
export const JOB_FILE = '.aisle-job';
/** The plan, from the project root. */
export const PLAN_FILE = 'aisle/PLAN.md';
/** What /goal's own argument says to end it with (docs-facts.md, goal.md). */
export const GOAL_CLEAR_WORDS = Object.freeze(['clear', 'stop', 'off', 'reset', 'none', 'cancel']);
/** False until job kg4 wires the rule; nothing in the plugin calls findGoal on a real chat while it is. */
export const KEEP_WIRED = false;

// ---- 1. Copies, each pinned to its source by test/keep-goal.test.mjs ----------------------------------------------------

/** the gate LIMIT_PHRASES (design 3d case 3, kg2-notes 6). */
export const LIMIT_PHRASES = Object.freeze(['stop', 'pause', 'hold on', 'wait', 'only part', 'and stop', 'until i say', 'don\'t continue', 'do not continue', 'dont continue', 'that\'s all', 'that is all', 'thats all']);
const NEGATIONS = new Set(['don\'t', 'dont', 'do not', 'never', 'no', 'not', 'without', 'can\'t', 'cannot', 'won\'t']);
/** the gate holdsLimit: whether text sets a limit, one of LIMIT_PHRASES as whole words, not right after a negation. */
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

/** the gate readJsonl: a transcript (JSONL text or its parsed lines) → the lines, skipping any that do not parse. */
export function readJsonl(text) {
  if (Array.isArray(text)) return text;
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch { /* a torn last line */ } }
  return out;
}

/** chain.mjs readJobFile, the id only: the `job:` field of .aisle-job's head, or ''. */
export function jobFileId(text) {
  for (const l of String(text ?? '').split(/\r?\n/)) {
    if (!l.trim()) break;
    if (l.trim().startsWith('#')) continue;
    const m = /^([a-z][a-z -]*):\s?(.*)$/i.exec(l.trim());
    if (m && m[1].toLowerCase() === 'job') return m[2].trim();
  }
  return '';
}

// engine/aisle/plan.mjs readChecks, as it reads a checks field (cutChecks, readCheck, repoPath, isRepoPath).
const OPEN_QUOTES = '"“', CLOSE_QUOTES = '"”';
const goodPath = (p) => !/^(\/|[A-Za-z]:|~)/.test(p) && !p.split('/').includes('..') && !p.includes('\\');
const isLoopPath = (p) => Boolean(p) && !/[\s:$%]/.test(p) && p[0] !== '-' && goodPath(p)
  && p.replace(/\/$/, '').split('/').every((s) => s && s !== '.' && s.toLowerCase() !== '.git');
const isRepoPath = (p) => isLoopPath(p) && !/[*?[\]{}]/.test(p);
const repoPath = (p) => String(p ?? '').trim().replace(/^\.\//, '');
function cutChecks(s) {
  const out = [];
  let from = 0, open = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (open) { if (CLOSE_QUOTES.includes(c)) open = false; } else if (OPEN_QUOTES.includes(c)) open = true;
    else if (c === ';') { out.push(s.slice(from, i).trim()); from = i + 1; }
  }
  out.push(s.slice(from).trim());
  return out;
}
function quotedHead(s) {
  if (!OPEN_QUOTES.includes(s[0])) return null;
  for (let i = s.length - 1; i > 0; i--) if (CLOSE_QUOTES.includes(s[i])) return { text: s.slice(1, i).trim(), after: s.slice(i + 1) };
  return null;
}
function readCheck(item) {
  const t = String(item ?? '').trim();
  const head = /^(test|commit|live|file|grep!?|judge)(?=[\s"“]|$)/i.exec(t);
  if (!head) return null;
  const kind = head[1].toLowerCase();
  const rest = t.slice(head[0].length).trim();
  if (kind === 'commit' || kind === 'live') return rest ? null : { kind };
  if (kind === 'test' || kind === 'file') { const path = repoPath(rest); return isRepoPath(path) ? { kind, path } : null; }
  const q = quotedHead(rest);
  if (!q || !q.text) return null;
  if (kind === 'judge') return q.after.trim() ? null : { kind, text: q.text };
  const path = repoPath(q.after);
  return /^\s/.test(q.after) && isRepoPath(path) ? { kind, text: q.text, path } : null;
}
/** A checks field → the checks plan.mjs reads from it (the bad items dropped), each said once. */
export function readChecks(text) {
  const checks = [], kept = new Set();
  for (const it of cutChecks(String(text ?? ''))) {
    if (!it) continue;
    const c = readCheck(it);
    if (!c) continue;
    const key = `${c.kind}\n${c.text ?? ''}\n${c.path ?? ''}`;
    if (!kept.has(key)) { kept.add(key); checks.push(c); }
  }
  return checks;
}

const JOB_LINE = /^\s*(?:[-*]\s+)?Job\s+([A-Za-z0-9][\w.-]*)\s*:/;
const PLAN_STATUSES = ['done', 'in progress', 'blocked', 'not started'];
/**
 * A plan's text → Map of job id → { id, status, agent, open, checks }, read as engine/aisle/plan.mjs reads a job line
 * (the gate planJobs splits it the same way): fields on " | " up to "Done when:". open: not done, not closed, not parked
 * (plan.mjs isOpenJob). A job said twice keeps its first line, as the plan's own reader refuses the second.
 */
export function planJobs(text) {
  const out = new Map();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = JOB_LINE.exec(line);
    if (!m || out.has(m[1])) continue;
    let status = '', agent = '', checks = '', closed = false, parked = false;
    for (const f of line.slice(m[0].length).split(/\s+\|\s+/).slice(1).map((x) => x.trim())) {
      let g;
      if (/^done when\s*:?/i.test(f)) break;
      if ((g = /^status\s*:?\s*(.*)$/i.exec(f))) status = g[1].trim().toLowerCase();
      else if ((g = /^agent\s*:?\s*(.*)$/i.exec(f))) agent = g[1].trim();
      else if ((g = /^checks\s*:\s*(.*)$/i.exec(f))) checks = g[1].trim();
      else if (/^closed\s*:\s*\S/i.test(f)) closed = true;
      else if (/^parked\s*:\s*\S/i.test(f)) parked = true;
    }
    const st = PLAN_STATUSES.includes(status) ? status : null;
    out.set(m[1], { id: m[1], status: st, agent: /^(none|-|)$/i.test(agent) ? '' : agent, open: st !== 'done' && !closed && !parked, checks: readChecks(checks) });
  }
  return out;
}

// ---- 2. Text, time, paths -----------------------------------------------------------------------------------------------

const JOB_ID = /^[A-Za-z0-9][\w.-]*$/;
const ms = (iso) => { const t = Date.parse(String(iso ?? '')); return Number.isFinite(t) ? t : 0; };
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (typeof b === 'string' ? b : b?.type === 'text' || b?.text !== undefined ? String(b.text ?? '') : '')).join('\n') : '');
const TASK_NOTE = /^\s*<task-notification>/i;

/** A path with `/` only, no trailing `/`, a Windows drive in lower case. */
export const normPath = (p) => {
  const s = String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:/.test(s) ? s[0].toLowerCase() + s.slice(1) : /^\/[a-zA-Z]\//.test(s) ? `${s[1].toLowerCase()}:${s.slice(2)}` : s;
};
const join = (...parts) => parts.filter((x) => x !== '' && x != null).map(String).join('/').replace(/\\/g, '/').replace(/(?<!^)\/{2,}/g, '/');
/** Whether `p` is `folder` or inside it, on any spelling of the same path. */
export function insideFolder(p, folder) {
  const a = normPath(p), b = normPath(folder);
  if (!a || !b) return false;
  const win = /^[a-z]:/.test(a) || /^[a-z]:/.test(b);
  const x = win ? a.toLowerCase() : a, y = win ? b.toLowerCase() : b;
  return x === y || x.startsWith(`${y}/`);
}
/**
 * Whether a path is Claude Code's settings (`~/.claude/settings*`, and a project's `.claude/settings*` too), which this
 * file never reads; `home`, when given, also refuses `~/.claude` itself as a data folder.
 */
export function isClaudeSettings(p, home = '') {
  if (/(^|\/)\.claude\/settings[^/]*(\/|$)/i.test(normPath(p))) return true;
  return Boolean(home) && normPath(p).toLowerCase() === `${normPath(home)}/.claude`.toLowerCase();
}

/** settings.txt's text → 'on', 'off', or '' when it says neither: the last `keep:` line wins. */
export function keepSwitch(text) {
  let v = '';
  for (const l of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s*keep\s*:\s*(on|off)\s*$/i.exec(l);
    if (m) v = m[1].toLowerCase();
  }
  return v;
}

// ---- 3. Signatures (HMAC-SHA256 over JSON.stringify of the record without `hmac`; the gate verifyRecord) ------------

const subtle = () => globalThis.crypto?.subtle;
const bytesOf = (x) => (x instanceof Uint8Array ? x : new TextEncoder().encode(String(x ?? '')));
const hexOf = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const hasKey = (key) => (typeof key === 'string' ? key.length > 0 : key instanceof Uint8Array && key.length > 0);
async function hmacHex(key, message) {
  const k = await subtle().importKey('raw', bytesOf(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hexOf(await subtle().sign('HMAC', k, bytesOf(message)));
}
/** sha256 of text as hex (Web Crypto). */
export const sha256Hex = async (text) => hexOf(await subtle().digest('SHA-256', bytesOf(text)));
/** A key's public name, the first 16 hex of its SHA-256 (the gate keyId, oversee.mjs keyId). */
export const keyId = async (key) => (await sha256Hex(bytesOf(key))).slice(0, 16);
/** Whether a record carries a good signature made with `key`. Never throws. */
export async function verifyRecord(key, record) {
  try {
    if (!hasKey(key) || !record || typeof record !== 'object' || Array.isArray(record)) return false;
    const { hmac, ...body } = record;
    if (typeof hmac !== 'string' || !/^[0-9a-f]{64}$/i.test(hmac)) return false;
    const want = await hmacHex(key, JSON.stringify(body));
    let diff = 0;
    for (let i = 0; i < 64; i++) diff |= want.charCodeAt(i) ^ hmac.toLowerCase().charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}
/** A record signed the way the gate signRecord signs it: its fields as given, then `hmac`. */
export async function signRecord(key, record) {
  if (!hasKey(key)) throw new Error('no key to sign with');
  const { hmac: _drop, ...body } = record || {};
  return { ...body, hmac: await hmacHex(key, JSON.stringify(body)) };
}

// ---- 4. The transcript: the chat's own posts, the person's typed prompts, /goal ----------------------------------------

/** Whether a user line starts a turn the person typed (the gate typedOrigins: turnOrigin human or sdk). */
function typedTurn(e) {
  const turn = String(e.turnOrigin ?? '').toLowerCase(), kind = String(e.origin?.kind ?? '').toLowerCase();
  return (turn === 'human' || turn === 'sdk' || (!turn && kind === 'human')) && kind !== 'task-notification';
}
const NOT_TYPED = new Set(['scheduled', 'system', 'task_notification', 'task-notification']);

/**
 * The prompts the person typed, in order → [{ promptId, text, at }]: the user line that starts each turn whose origin is
 * typed (only the first line of a promptId: a later one with the same id is not the turn's), and each prompt typed
 * mid-turn (a queued_command attachment with commandMode "prompt"). Scheduled prompts, task notifications, wakes,
 * tool results and subagents' lines are never typed (kg1 fact 4). A transcript with no origin fields has none.
 */
export function typedPrompts(transcript) {
  const out = [], seen = new Set();
  for (const e of readJsonl(transcript)) {
    if (!e || typeof e !== 'object' || e.isSidechain === true) continue;
    if (e.type === 'user' && e.promptId && !seen.has(e.promptId) && (e.turnOrigin || e.origin || e.promptSource)) {
      seen.add(e.promptId);
      if (!typedTurn(e) || e.isMeta === true) continue;
      const text = textOf(e.message?.content);
      if (text.trim() && !TASK_NOTE.test(text)) out.push({ promptId: String(e.promptId), text, at: ms(e.timestamp) });
      continue;
    }
    const a = e.type === 'attachment' ? e.attachment : null;
    if (a?.type === 'queued_command' && a.commandMode === 'prompt' && String(a.origin?.kind ?? '').toLowerCase() !== 'task-notification') {
      const text = textOf(a.prompt);
      if (text.trim() && !TASK_NOTE.test(text)) out.push({ promptId: String(e.promptId ?? ''), text, at: ms(e.timestamp) });
    }
  }
  return out;
}

const GOAL_LINE = /^\s*goal\s*:\s*(\S.*)$/im;
/** The newest `Goal:` line the person typed → { words, at, promptId } or null (design 3a source 4). */
export function typedGoal(transcript) {
  let found = null;
  for (const p of typedPrompts(transcript)) {
    const m = GOAL_LINE.exec(p.text);
    if (m) found = { words: m[1].trim().slice(0, 4000), at: p.at, promptId: p.promptId };
  }
  return found;
}

const POSTED = /(^|\n)\s*Posted as #\d+/;
/**
 * This chat's own posts the room took → [{ body, at }]: each post_message call of the main chat (an AIsle room's tool,
 * `mcp__<server>__post_message`), whose answer says "Posted as #". A subagent's call (isSidechain), a call the room
 * refused, and a call with no answer yet are not posts.
 */
export function ownPosts(transcript) {
  const calls = new Map(), out = [];
  for (const e of readJsonl(transcript)) {
    if (!e || typeof e !== 'object' || e.isSidechain === true) continue;
    const content = Array.isArray(e.message?.content) ? e.message.content : [];
    if (e.type === 'assistant') {
      for (const b of content) if (b?.type === 'tool_use' && /^mcp__.+__post_message$/.test(String(b.name ?? '')) && b.id) calls.set(b.id, String(b.input?.body ?? ''));
    } else if (e.type === 'user') {
      for (const b of content) {
        if (b?.type !== 'tool_result' || !calls.has(b.tool_use_id) || b.is_error === true) continue;
        if (POSTED.test(textOf(b.content))) out.push({ body: calls.get(b.tool_use_id), at: ms(e.timestamp) });
        calls.delete(b.tool_use_id);
      }
    }
  }
  return out;
}

const CLAIM_LINE = /^\s*Claim:\s*(\S+)/gim;
/** The newest `Claim: <job> ...` line among this chat's own posts → { job, at } or null (design 3a source 2). */
export function claimOf(transcript) {
  let found = null;
  for (const p of ownPosts(transcript)) {
    for (const m of p.body.matchAll(CLAIM_LINE)) {
      const job = m[1].replace(/[.,;:]+$/, '');
      if (JOB_ID.test(job)) found = { job, at: p.at };
    }
  }
  return found;
}

const COMMAND = /<command-name>\s*\/goal\s*<\/command-name>/i;
const ARGS = /<command-args>([\s\S]*?)<\/command-args>/i;
/**
 * Whether the built-in /goal holds this session → { active, at, promptId }. Only a /goal the CLI ran as a command counts:
 * a user line holding `<command-name>/goal</command-name>` that no scheduled or system turn sent (a /goal a model
 * schedules reaches it as plain text and sets nothing, kg1 fact 6). A later `/goal clear` (or stop, off, reset, none,
 * cancel) ends it; `/goal` alone changes nothing. With `signedIds` (the promptIds of the signed UserPromptSubmit
 * records, from the caller), the command's promptId must be among them, so a line written into the transcript by hand
 * does not set the rule aside.
 */
export function goalCommand(transcript, { signedIds = null } = {}) {
  let state = { active: false, at: 0, promptId: '' };
  for (const e of readJsonl(transcript)) {
    if (!e || typeof e !== 'object' || e.isSidechain === true || e.type !== 'user') continue;
    const text = textOf(e.message?.content);
    if (!COMMAND.test(text)) continue;
    if (NOT_TYPED.has(String(e.turnOrigin ?? '').toLowerCase()) || NOT_TYPED.has(String(e.origin?.kind ?? '').toLowerCase())) continue;
    if (signedIds && !signedIds.has(String(e.promptId ?? ''))) continue;
    const args = (ARGS.exec(text)?.[1] ?? '').trim();
    if (!args) continue;
    state = GOAL_CLEAR_WORDS.includes(args.toLowerCase()) ? { active: false, at: ms(e.timestamp), promptId: String(e.promptId ?? '') }
      : { active: true, at: ms(e.timestamp), promptId: String(e.promptId ?? '') };
  }
  return state;
}

// ---- 5. The [your user] limit (kg1 fact 8) ------------------------------------------------------------------------------

// chat.mjs HEADER_LINE and readTranscriptMessage, as read_chat prints a message: its header, then each line after "> ".
const HEADER_LINE = /^#(\d{1,12}) ([^[\]\n]+?)( \[role: [^[\]\n]*\])?( \[you\]| \[your user\])? · (\d{4}-\d\d-\d\d \d\d:\d\dZ):$/;
/** One message as read_chat printed it → { seq, agent, mark, body } or null (chat.mjs readTranscriptMessage). */
export function readMessage(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/);
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  while (lines.length && !lines[0].trim()) lines.shift();
  const h = lines.length ? HEADER_LINE.exec(lines[0]) : null;
  if (!h) return null;
  const body = [];
  for (const l of lines.slice(1)) {
    if (l === '>') body.push('');
    else if (l.startsWith('> ')) body.push(l.slice(2));
    else return null;
  }
  if (!body.length) return null;
  let author = h[2];
  let agent = false;
  for (const s of [' (no longer in this room)', ' (deleted account)', ' (agent)']) if (author.endsWith(s)) { if (s === ' (agent)') agent = true; author = author.slice(0, -s.length); }
  return { seq: Number(h[1]), agent, mark: h[4] ? h[4].slice(2, -1) : '', body: body.join('\n') };
}

/** read_chat's answer, in whatever shape the hook gives it (text, content blocks, { content }) → its text. */
const answerText = (r) => (typeof r === 'string' ? r : Array.isArray(r) ? r.map(answerText).join('\n') : r && typeof r === 'object' ? (r.text !== undefined ? String(r.text) : answerText(r.content ?? '')) : '');

/**
 * A PostToolUse on an AIsle room's read_chat → the signed record of the newest [your user] line it shows,
 * { session, seq, limit, at, hmac }, or null when it shows none, the tool is another, or there is no key. Only the room
 * sets the mark (D125, job d49), only on a person's own line; an assistant's post never counts, and nor does another
 * member's. The text is tested in memory and never kept. The caller keeps the record with the highest seq.
 */
export async function roomLimitRecord({ event = {}, key = null, at = '' } = {}) {
  if (!hasKey(key) || event.hook_event_name !== 'PostToolUse' || !/^mcp__.+__read_chat$/.test(String(event.tool_name ?? ''))) return null;
  let newest = null;
  for (const block of answerText(event.tool_response).split(/\n\n/)) {
    const m = readMessage(block);
    if (m && m.mark === 'your user' && !m.agent && (!newest || m.seq > newest.seq)) newest = m;
  }
  if (!newest) return null;
  return signRecord(key, { session: String(event.session_id ?? ''), seq: newest.seq, limit: holdsLimit(newest.body), at: String(at) });
}

// ---- 6. Finding the goal -------------------------------------------------------------------------------------------------

/** The names a plan's agent field may give this chat: its chat id, its session id, its worktree's branch. */
export async function chatNames({ session = '', branch = '' } = {}) {
  const names = [];
  const chat = await chatIdOf(session);
  if (chat) names.push(chat);
  const sid = sessionText(session);
  if (sid.length >= 8) names.push(sid);
  const b = String(branch ?? '').trim();
  if (b && !['master', 'main', 'head', 'trunk', 'develop'].includes(b.toLowerCase())) names.push(b);
  return names.map((x) => x.toLowerCase());
}

/** The branch a folder's checkout is on, from its .git (a folder, or a worktree's `gitdir:` file), or ''. Never throws. */
export async function branchOf(io, root) {
  try {
    let git = await io.text(join(root, '.git', 'HEAD'));
    if (git == null) {
      const pointer = await io.text(join(root, '.git'));
      const dir = /^gitdir:\s*(.+)$/m.exec(String(pointer ?? ''))?.[1]?.trim();
      if (!dir) return '';
      const abs = /^([A-Za-z]:|\/)/.test(dir) ? dir : join(root, dir);
      git = await io.text(join(abs, 'HEAD'));
    }
    return /^ref:\s*refs\/heads\/(.+)$/m.exec(String(git ?? ''))?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

/** The project root: the nearest folder up from `cwd` that holds aisle/PLAN.md, or ''. */
export async function projectRoot(io, cwd) {
  let dir = normPath(cwd);
  for (let i = 0; i < 40 && dir; i++) {
    if ((await io.text(join(dir, PLAN_FILE))) != null) return dir;
    const up = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
    if (!up || up === dir || /^[a-z]:$/i.test(dir)) break;
    dir = up;
  }
  return '';
}

const safeSession = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
/** The goal store's file for a session (tools/job.mjs goalPath). */
export const goalFile = (data, session) => join(data, KEEP_DIR, GOALS_DIR, `${safeSession(session)}.json`);

/**
 * The goal store's record for this session (kg3 section 5) → { ok, forged, record } or null when there is none. A record
 * that does not parse, whose signature fails, that names another key or another session, is `forged`: the hold stays
 * (kg2's "the goal record of this chat was edited by hand"), never read as no goal.
 */
export async function storeRecord(text, { key = null, session = '' } = {}) {
  if (text == null || !String(text).trim()) return null;
  let r;
  try { r = JSON.parse(String(text)); } catch { return { ok: false, forged: true, record: null }; }
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, forged: true, record: null };
  const signed = hasKey(key) && r.v === 1 && (r.key === undefined || r.key === await keyId(key)) && await verifyRecord(key, r);
  const mine = String(r.session ?? '') === String(session);
  return { ok: signed && mine, forged: !(signed && mine), record: r };
}

const jobGoal = (id, plan, source, at = 0) => ({ kind: 'job', id, role: 'worker', expected: plan?.get(id)?.checks ?? [], source, at });

/** A store record → the goal it keeps (kind job, queue for the brain, worker slots). */
function storeGoal(s, plan) {
  const r = s.record || {};
  const jobs = Array.isArray(r.jobs) ? r.jobs.map(String).filter((j) => JOB_ID.test(j)) : [];
  const at = ms(r.set);
  let g;
  if (r.kind === 'worker') g = { kind: 'queue', id: `slots:${String(r.machine || 'here').slice(0, 40)}`, role: 'worker', machine: String(r.machine || 'here'), source: 'store', at };
  else if (r.kind === 'queue' || jobs.length > 1) g = { kind: 'queue', id: `queue:${jobs.join(',')}`.slice(0, 200), role: 'brain', jobs, source: 'store', at };
  else if (jobs.length === 1) g = jobGoal(jobs[0], plan, 'store', at);
  else g = { kind: 'job', id: 'goal-record', role: 'worker', expected: [], source: 'store', at };
  return s.forged ? { ...g, forged: true } : g;
}

/**
 * The known goal from what the caller read → the goal keepStop takes, or null (no hold). Pure.
 *   on        keep: on in the plugin's data (design 3a); off or missing: null.
 *   goalCmd   goalCommand()'s answer: an active /goal stands the rule aside.
 *   store     storeRecord()'s answer, or null.
 *   claim     claimOf()'s answer, or null; typed: typedGoal()'s, or null.
 *   jobFile   the id .aisle-job names, or ''.
 *   plan      planJobs() of the project's plan, or null; names: chatNames().
 * The newest of the store, the chat's own Claim: and the person's typed Goal: wins (each says the goal at a moment);
 * then .aisle-job, then a plan job whose agent names the chat. A Claim:, .aisle-job or agent job counts only as an
 * open job of the plan. The store's goal stands on its signature alone: a plan the model can edit never ends it.
 */
export function pickGoal({ on = false, goalCmd = null, store = null, claim = null, typed = null, jobFile = '', plan = null, names = [] } = {}) {
  if (!on) return null;
  const open = (id) => Boolean(id) && plan instanceof Map && plan.get(id)?.open === true;
  const timed = [];
  if (store) timed.push(storeGoal(store, plan));
  if (claim && open(claim.job)) timed.push(jobGoal(claim.job, plan, 'claim', claim.at));
  if (typed) timed.push({ kind: 'typed', id: `goal-${typed.hash || 'typed'}`, role: 'worker', words: typed.words, source: 'typed', at: typed.at });
  const order = { store: 3, typed: 2, claim: 1 };
  timed.sort((a, b) => (b.at - a.at) || (order[b.source] - order[a.source]));
  let goal = timed[0] || null;
  if (!goal && open(jobFile)) goal = jobGoal(jobFile, plan, 'job file');
  if (!goal && plan instanceof Map && names.length) {
    for (const j of plan.values()) if (j.open && j.agent && names.includes(j.agent.toLowerCase())) { goal = jobGoal(j.id, plan, 'agent'); break; }
  }
  if (goalCmd?.active) return { ...(goal || { kind: 'typed', id: '/goal', role: 'worker', source: '/goal' }), standAside: true };
  return goal;
}

/**
 * Reads what D126 (1) names, through `io`, and finds the goal → { goal, why, read }.
 *   root            the project root (projectRoot()), or '' when the folder holds no plan;
 *   data            the plugin's data folder (CLAUDE_PLUGIN_DATA in a command hook; reopen-rules.mjs dataFolderFromRoot in
 *                   the hooks module; tools/oversee.mjs dataDir); refused when inside the project or Claude's settings;
 *   session         the hook input's session_id; transcript: its text, or transcriptPath to read it;
 *   key             the proof key's bytes (the caller reads them; the hooks module's $.fs reads text only);
 *   signedIds       the promptIds of this session's signed UserPromptSubmit records, when the caller has them;
 *   branch          the worktree's branch, else read from root's .git;  home: the person's home folder.
 * It never throws: a read that fails counts as nothing there, so a bug never holds a chat.
 */
export async function findGoal(io, { root = '', data = '', session = '', transcript = null, transcriptPath = '', key = null, signedIds = null, branch = null, home = '' } = {}) {
  const read = {};
  try {
    const safe = (p) => p && !isClaudeSettings(p, home);
    const text = async (p) => { if (!safe(p)) return null; try { const t = await io.text(p); return t == null ? null : String(t); } catch { return null; } };
    const dataOk = Boolean(data) && !(root && insideFolder(data, root)) && !isClaudeSettings(data, home);
    read.data = dataOk ? 'plugin data' : data ? 'refused' : 'none';
    const on = dataOk && keepSwitch(await text(join(data, KEEP_DIR, SETTINGS_FILE))) === 'on';
    read.on = on;
    if (!on) return { goal: null, why: 'keep is not on in the plugin\'s data', read };
    const tx = transcript ?? (transcriptPath ? await text(transcriptPath) : null);
    const lines = readJsonl(tx ?? '');
    const planText = root ? await text(join(root, PLAN_FILE)) : null;
    const plan = planText == null ? null : planJobs(planText);
    const t = typedGoal(lines);
    const typed = t ? { ...t, hash: (await sha256Hex(t.words)).slice(0, 12) } : null;
    const inputs = {
      on,
      goalCmd: goalCommand(lines, { signedIds: signedIds ? new Set(signedIds) : null }),
      store: session ? await storeRecord(await text(goalFile(data, session)), { key, session }) : null,
      claim: claimOf(lines),
      typed,
      jobFile: root ? jobFileId(await text(join(root, JOB_FILE))) : '',
      plan,
      names: await chatNames({ session, branch: branch ?? (root ? await branchOf({ text }, root) : '') }),
    };
    Object.assign(read, { plan: Boolean(plan), transcript: lines.length, store: inputs.store ? (inputs.store.forged ? 'forged' : 'ok') : 'none', claim: inputs.claim?.job ?? '', typed: Boolean(typed), jobFile: inputs.jobFile, goalCmd: inputs.goalCmd.active });
    const goal = pickGoal(inputs);
    return { goal, why: goal ? (goal.standAside ? 'the built-in /goal holds this session' : `found from ${goal.source}`) : 'no known goal', read };
  } catch (e) {
    return { goal: null, why: `error: ${String(e?.message || e).slice(0, 120)}`, read };
  }
}

/** The hooks module's reader: text through `$.fs`, null when a file is not there. Never throws. */
export const ioFromHooks = ($) => ({
  text: async (p) => { try { return (await $.fs.exists(p)) ? String(await $.fs.read(p)) : null; } catch { return null; } },
});

/** What index.mjs re-exports, inert: kg4 calls findGoal and roomLimitRecord from the hooks it wires. */
export const KEEP = Object.freeze({ wired: KEEP_WIRED, findGoal, pickGoal, roomLimitRecord, ioFromHooks, projectRoot });
