// What the AIsle plugin's computer id decides (D124, job f23), kept apart from Claude Code so node can test it. The
// module beside it, computer.mjs, runs inside Claude Code and fills `computer`, with `chat`, into AIsle's post_message
// and listen_here.
//
// Why: Ofir, 2026-10-26, "WHEN THE SAME ACCOUNT IS ON 2 DIFFERENT PCS - EACH NEED TO HAVE DIFFERENT IDENTITY". Before
// it, the room took every post by any assistant of a person as that person's own, so one of his computers never woke
// another. A post now names its computer, and is "own" to a listener only when it names the listener's own.
//
// What leaves the computer, in one field, `<id>:<account>:<host>`:
// - <id>: 32 random hex, made once on this computer and kept in the plugin's data folder (`computer-id`);
// - <account>: 32 hex of sha256("aisle-claude-account:" + Claude Code's own account id), read from Claude Code's local
//   config (`oauthAccount.accountUuid` in `.claude.json`, that field and nothing else), or nothing when it holds none
//   (Claude Code signed out). Never the email, the account's name, or anything of `.credentials.json`;
// - <host>: this computer's hostname, lowercased, which the listener (listen.sh) writes as bash knows it
//   (`computer-name`), or nothing. The room shows it on this computer's posts until the person renames the computer.
// The room keeps none of them as sent: each is hashed again with the person's own id.
//
// When: only on an AIsle room (its read_chat says the words of d23), and only once this computer has heard a room
// say that it tells computers apart (whoami's "Your computers:" line, which listen.sh marks with the file
// `computers`): a room from before D124 declares neither field, and the plugin never sends one a room does not
// declare. Until then, a value a model wrote is taken out, so a post that names a computer is always the plugin's.
//
// And the listener: once this chat's posts name this computer, the module writes `pc-<session>` (the id), and
// listen.sh names the same computer to /watch (`pc=`) from that file alone. So a chat whose listener names its
// computer always names it on its posts too, and is never woken by its own post.

import { CHAT_MARK_WORDS, sessionText } from './chat-mark-rules.mjs';

/** The two tools that take `computer` (and `chat`), by the name the model calls them. */
export const COMPUTER_TOOLS = /^mcp__.+__(post_message|listen_here)$/;

/** The server part of an MCP tool's name and the tool, or null for any other tool. */
export function computerToolOf(name) {
  const m = /^mcp__(.+)__(post_message|listen_here)$/.exec(String(name ?? ''));
  return m ? { server: m[1], tool: m[2] } : null;
}

/** Whether the server behind this tool is an AIsle room from d23 on: its read_chat, in the chat's own list, says CHAT_MARK_WORDS. */
export function aisleRoom(tools, name) {
  const t = computerToolOf(name);
  if (!t || !Array.isArray(tools)) return false;
  const read = tools.find((x) => x?.name === `mcp__${t.server}__read_chat`);
  return typeof read?.description === 'string' && read.description.includes(CHAT_MARK_WORDS);
}

/** The words of whoami's line that say a room tells computers apart (server: engine/aisle/computers.mjs COMPUTERS_LINE). */
export const COMPUTERS_WORDS = 'Your computers: ';

/** The plugin's files for it, in its data folder (listen.sh's $DATA). */
export const COMPUTER_ID_FILE = 'computer-id';
export const COMPUTER_NAME_FILE = 'computer-name';
export const COMPUTERS_FLAG = 'computers';
/** The file that tells this chat's listener its computer, once its posts name it: `pc-<session>`. */
export const pcFileOf = (data, sessionId) => {
  const sid = sessionText(sessionId);
  return data && sid.length >= 8 && sid !== 'unknown' && sid !== 'worker' ? `${data}/pc-${sid}` : null;
};

/** A computer id as kept and sent: 32 lowercase hex, from the first line of a file; else null. */
export function parseComputerId(text) {
  const first = String(text ?? '').split(/\r?\n/)[0].trim();
  return /^[0-9a-f]{32}$/.test(first) ? first : null;
}

/** 32 random hex, through the environment's own Web Crypto. */
export function newComputerId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** A hostname as the field carries it: lowercase, letters, digits and `. _ -`, at most 63, starting with a letter or digit; else null. */
export function hostOf(raw) {
  const t = String(raw ?? '').split(/\r?\n/)[0].trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 63);
  return t || null;
}

/**
 * Where Claude Code keeps its own local config: the one file it reads, `.claude.json` in CLAUDE_CONFIG_DIR when that is
 * set to something (as it is, no trim and no ~), else in the home folder (claudeHomeOf: the variable os.homedir() reads first).
 * Claude Code 2.1.309 reads `join(process.env.CLAUDE_CONFIG_DIR || homedir(), '.claude.json')` and no second
 * file (job bh7). Job bh2: so a config folder with no file yet (a second account) names no account, never the home's,
 * and a signed-out file names none either. An empty list only with no value and no home.
 */
export function configFilesOf({ configDir, home, userProfile }) {
  const dir = setConfigDir(configDir) || claudeHomeOf({ home, userProfile });
  return dir ? [`${trimSlash(dir)}/.claude.json`] : [];
}

const trimSlash = (dir) => (/^[\\/]+$/.test(String(dir)) ? '' : String(dir).replace(/[\\/]+$/, ''));

/** CLAUDE_CONFIG_DIR as Claude Code takes it: the value as it is, with no trim and no ~; '' when unset or empty. */
const setConfigDir = (v) => (typeof v === 'string' ? v : '');

/**
 * The home folder, from the two variables given (job bh7's review, R3): on Windows USERPROFILE when set (a HOME Git
 * Bash sets beside it is not read), else HOME; elsewhere HOME when set (a USERPROFILE that WSL passes in through WSLENV
 * is not read), else USERPROFILE. Null when neither is set. The first choice is the variable Claude Code's homedir()
 * (os.homedir()) reads; the second is a stand-in, since os.homedir() then asks the OS for the account's folder and
 * never reads the other variable: on Windows it never reads HOME (job bh11).
 */
export function claudeHomeOf({ home, userProfile }) {
  return onWin32(userProfile) ? userProfile || home || null : home || userProfile || null;
}

/** Whether this runs on Windows: process.platform, read at each call; in a runtime with no process, a USERPROFILE on a drive. */
function onWin32(userProfile) {
  const platform = typeof process === 'object' && process ? process.platform : '';
  return platform ? platform === 'win32' : /^[A-Za-z]:[\\/]/.test(String(userProfile ?? ''));
}

/**
 * Claude Code's own config folder, the one reading tools/ and the plugin's hooks share (job bh7), as Claude Code
 * 2.1.309 reads it (research/plan-proof/bh7.md): CLAUDE_CONFIG_DIR as it is when set, with no trim and no ~, in NFC
 * (Claude Code's `(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')).normalize('NFC')`), else `.claude` in
 * the home folder, as it is, so that tools/ stay byte for byte as before with the variable unset. An empty
 * value counts as unset, as Claude Code's global file reads it (`CLAUDE_CONFIG_DIR || homedir()`); its config folder
 * would take "" for the folder it runs in, which nothing outside it can know. Null with neither a value nor a home.
 */
export function claudeConfigDirOf({ configDir, home, userProfile }) {
  const set = setConfigDir(configDir);
  if (set) return set.normalize('NFC'); // as Claude Code's config folder (its global file, configFilesOf, is not)
  const h = claudeHomeOf({ home, userProfile });
  return h ? `${trimSlash(h)}/.claude` : null;
}

/**
 * Claude Code's own account id from its local config's text: `oauthAccount.accountUuid` and nothing else, or null
 * (no such field, Claude Code signed out, or a file that is not JSON). Nothing else of the file is kept or returned.
 */
export function claudeAccountIdOf(text) {
  try {
    const id = JSON.parse(String(text ?? ''))?.oauthAccount?.accountUuid;
    return typeof id === 'string' && /^[0-9A-Za-z-]{8,64}$/.test(id) ? id.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** sha256 as hex, through the environment's own Web Crypto. */
async function sha256hex(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** What names this Claude account to the room: 32 hex of sha256("aisle-claude-account:" + its id), or null. */
export async function claudeAccountHashOf(accountId) {
  return accountId ? (await sha256hex(`aisle-claude-account:${accountId}`)).slice(0, 32) : null;
}

/** The field: `<id>:<account>:<host>`, the last two empty when not known. */
export const computerField = ({ id, account = null, host = null }) => `${id}:${account ?? ''}:${host ?? ''}`;

/**
 * The call as it goes to an AIsle room. With a computer: `computer` set to it (on a subagent's call too: it is still
 * this computer), and `chat` set to this chat's on the main loop, taken out elsewhere. Without one (the room has not
 * said it tells computers apart, or anything failed): any `computer` or `chat` a model wrote taken out, so a post that
 * names a computer, or a chat, is always the plugin's. A call with nothing to change is passed on as it came.
 */
export function withComputer(e, { computer = null, chat = null } = {}) {
  if (!e) return e;
  const { computer: _c, chat: _h, ...rest } = e;
  if (computer) return { ...rest, computer, ...(e.agentId === undefined && chat ? { chat } : {}) };
  return Object.hasOwn(e, 'computer') || Object.hasOwn(e, 'chat') ? rest : e;
}

/** How long one read of Claude Code's config is used before it is read again. */
export const ACCOUNT_READ_MS = 10 * 60_000;
