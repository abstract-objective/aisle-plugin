// What the AIsle plugin's chat marks decide (job d23), kept apart from Claude Code so node can test it. The module
// beside it, chat-mark.mjs, runs inside Claude Code and names the chat in AIsle's read_chat and whoami.
//
// Why: a read mark was the connection's, one per sign-in and room, so a worker chat's read took the new messages
// out of the listening chat's next read, and the listener still woke that chat for them (the steering run's case
// s15). Each chat now keeps its own mark in the room, and the room needs to know which chat is reading.
//
// What leaves the computer is not the session id: sha256("aisle-chat:" + session id), its first 32 hex. The
// listener (scripts/listen.sh) sends the same value as `chat=` on /watch, read from the file this module writes
// (namedFileOf) once it names the chat, so the room can match a chat's reads to its wakes, and a chat whose reads
// go unnamed is never given a place of its own by its listener alone (the d23 review's finding 2).

import { dataFolderFromRoot } from './reopen-rules.mjs';

/**
 * The words AIsle's read_chat description carries once the room keeps a mark per chat (server/mcp.mjs
 * CHAT_MARK_WORDS; a test holds the two equal). A tool list is the only thing the plugin can read about a server
 * (names, descriptions, nothing of a schema, no server name it can trust), and these words say both that the server
 * is AIsle and that it declares `chat`. A server without them (another vendor's read_chat, or an AIsle room from
 * before d23) is called exactly as the model called it: the engine checks a call against the tool's schema, and an
 * older AIsle schema is closed.
 */
export const CHAT_MARK_WORDS = 'each chat keeps its own place';

/** The two tools that take `chat`, by the name the model calls them: `mcp__<server>__read_chat`, `..._whoami`. */
export const CHAT_TOOLS = /^mcp__.+__(read_chat|whoami)$/;

/** The server part of an MCP tool's name and the tool, or null for any other tool. */
export function chatToolOf(name) {
  const m = /^mcp__(.+)__(read_chat|whoami)$/.exec(String(name ?? ''));
  return m ? { server: m[1], tool: m[2] } : null;
}

/**
 * Whether the server behind this tool takes `chat`: its read_chat, in the chat's own tool list, says
 * CHAT_MARK_WORDS. Anything else (no list, a list without that tool, other words) is no.
 */
export function takesChat(tools, name) {
  const t = chatToolOf(name);
  if (!t || !Array.isArray(tools)) return false;
  const read = tools.find((x) => x?.name === `mcp__${t.server}__read_chat`);
  return typeof read?.description === 'string' && read.description.includes(CHAT_MARK_WORDS);
}

/**
 * Whether any AIsle room in this tool list takes `chat`: some server's read_chat says CHAT_MARK_WORDS. What a
 * chat's first turn checks, before it has called anything, so its listener can name it from then on.
 */
export function anyTakesChat(tools) {
  return Array.isArray(tools) && tools.some((x) => /^mcp__.+__read_chat$/.test(String(x?.name ?? '')) && typeof x.description === 'string' && x.description.includes(CHAT_MARK_WORDS));
}

/** The characters listen.sh keeps of a session id (`${FV//[!A-Za-z0-9-]/}`), so both sides hash the same text. */
export const sessionText = (id) => String(id ?? '').replace(/[^A-Za-z0-9-]/g, '');

/** sha256 as hex, through the environment's own Web Crypto (Claude Code's module environment, and node). */
async function sha256hex(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** What names this chat to the room: 32 hex of sha256("aisle-chat:" + session id), or null without an id. */
export async function chatIdOf(sessionId) {
  const sid = sessionText(sessionId);
  if (sid.length < 8 || sid === 'unknown' || sid === 'worker') return null;
  return (await sha256hex(`aisle-chat:${sid}`)).slice(0, 32);
}

/**
 * The call as it goes to an AIsle room that takes `chat`. On the main loop, every argument the model gave and
 * `chat` set to this chat's (a `chat` the model guessed is replaced). Anywhere else (inside a subagent, where
 * `agentId` is set and which is not the chat the listener wakes, or with no session id) the same call without any
 * `chat`, so it reads from the connection's mark, as before, and a value a model wrote never reaches the room
 * (the d23 review's finding 5). A call with nothing to change is passed on as it came.
 */
export function withChat(e, chat) {
  if (!e) return e;
  if (e.agentId === undefined && chat) return { ...e, chat };
  if (!Object.hasOwn(e, 'chat')) return e;
  const { chat: _guessed, ...rest } = e;
  return rest;
}

/**
 * The file that tells this chat's listener its name in the room: `named-<session>` in the plugin's data folder,
 * the one listen.sh keeps as $DATA, holding the chat's 32 hex. Null where there is no such folder (a copy not
 * installed from a marketplace) or no session id.
 */
export function namedFileOf(root, sessionId) {
  const data = dataFolderFromRoot(root);
  const sid = sessionText(sessionId);
  return data && sid.length >= 8 && sid !== 'unknown' && sid !== 'worker' ? `${data}/named-${sid}` : null;
}
