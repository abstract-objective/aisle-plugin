// What the AIsle plugin's read allow decides (D161, job d161h), kept apart from Claude Code so node can test it. The
// module beside it, allow.mjs, runs inside Claude Code and writes the file listen.sh reads.
//
// Why: AIsle's four read-only tools (whoami, read_chat, read_plan, estimate) each asked once in every folder until the
// person allowed them, and a chat its listener woke while the person was away could wait at that prompt. D161 chose
// option A: the plugin's PreToolUse hook (listen.sh) answers "allow" for those four, never for post_message or
// get_skill (which retires the folder's watch token), and only on AIsle's own server.
//
// listen.sh cannot see which server a tool is on: a hook's input has the tool's name, `mcp__<server>__<tool>`, and the
// server part is whatever the person named it (claude_ai_AIsle, a connector's id, a room key's own name). Only this
// module sees the chat's tools, so it writes the AIsle servers it finds into `servers-<session>` in the plugin's data
// folder (listen.sh's $DATA), one line, `|server|server|`, which bash matches by its own pattern matching. A server is
// AIsle's the way d23 and D124 already take it: its read_chat says CHAT_MARK_WORDS. A tool list holds names and
// descriptions only, so a server that copied those words would be taken as AIsle's here as it is there; listen.sh
// then allows only an input of the shape AIsle's own schemas take, so such a server gets at most a room's title.
//
// The first look writes the file even when it found none (`||`), so its being there tells listen.sh that this chat's
// module looked: listen_here is then filled only on a server named in it. A chat with no file runs an older module
// (one opened before this version: D84 hands it the new listen.sh, not this module), and keeps listen_here's fill as
// before. The set only grows within a session, so a turn that starts while a connector reconnects takes nothing away.

import { CHAT_MARK_WORDS, sessionText } from './chat-mark-rules.mjs';
import { dataFolderFromRoot } from './reopen-rules.mjs';

/** The four tools D161 lets run with no prompt, on AIsle's own server only. It mirrors listen.sh's case, which decides. */
export const READ_TOOLS = Object.freeze(['whoami', 'read_chat', 'read_plan', 'estimate']);

/** A server name listen.sh can match exactly: letters, digits, `_` and `-` (listen.sh refuses any other). */
export const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

/** The server part of an AIsle tool's name, when it is one bash can match; else null. */
export function serverOfTool(name) {
  const m = /^mcp__(.+)__(whoami|read_chat|read_plan|estimate|listen_here|post_message)$/.exec(String(name ?? ''));
  return m && SERVER_NAME.test(m[1]) ? m[1] : null;
}

/** The AIsle servers in a chat's tool list: each server whose read_chat says CHAT_MARK_WORDS, sorted, once each. */
export function aisleServersOf(tools) {
  if (!Array.isArray(tools)) return [];
  const found = new Set();
  for (const t of tools) {
    const server = /__read_chat$/.test(String(t?.name ?? '')) ? serverOfTool(t.name) : null;
    if (server && typeof t.description === 'string' && t.description.includes(CHAT_MARK_WORDS)) found.add(server);
  }
  return [...found].sort();
}

/** Names bash can match, sorted, once each. */
const namesOf = (list) => [...new Set(list.filter((s) => SERVER_NAME.test(s)))].sort();

/** The servers a file names, as listen.sh reads them: each name between two `|`. */
export function parseServers(text) {
  return namesOf([...String(text ?? '').matchAll(/[|]([A-Za-z0-9_-]+)(?=[|])/g)].map((m) => m[1]));
}

/**
 * The text to write: the servers the file had and the ones found, `|a|b|` and a newline; null when the file already
 * says exactly that. With no file (`had` null) it is written even with none found.
 */
export function serversText(had, found) {
  const text = `|${namesOf([...parseServers(had), ...(Array.isArray(found) ? found : [])]).join('|')}|\n`;
  return had !== null && had !== undefined && String(had).trim() === text.trim() ? null : text;
}

/** `servers-<session>` in the plugin's data folder; null with no such folder (a copy not installed from a marketplace) or no session id. */
export function serversFileOf(root, sessionId) {
  const data = dataFolderFromRoot(root);
  const sid = sessionText(sessionId);
  return data && sid.length >= 8 && sid !== 'unknown' && sid !== 'worker' ? `${data}/servers-${sid}` : null;
}
