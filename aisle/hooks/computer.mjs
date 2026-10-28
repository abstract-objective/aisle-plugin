// Each computer is its own identity (D124, job f23): this names the computer, and the chat, in AIsle's post_message
// and listen_here, so a post is "own" only to the listeners of the computer it came from, and a person's other
// computers are woken by it. What it adds, and when, is decided in computer-rules.mjs. A hooks module, like
// chat-mark.mjs: no Node, `$` reaches everything outside, and nothing here may throw or make the person wait. Anything
// that goes wrong sends the call with no computer, which the room takes as it took every post before D124. It reaches
// no network and runs no program. It reads Claude Code's own local config for its account id alone, at most once in
// 10 minutes. It writes only in the plugin's own data folder: `computer-id` once per computer, and `pc-<session>`,
// which tells this chat's listener (listen.sh) to name the computer to the room too, from then on.
import { anyTakesChat, chatIdOf } from './chat-mark-rules.mjs';
import {
  COMPUTER_TOOLS, aisleRoom, COMPUTER_ID_FILE, COMPUTER_NAME_FILE, COMPUTERS_FLAG, pcFileOf, parseComputerId,
  newComputerId, hostOf, configFilesOf, claudeAccountIdOf, claudeAccountHashOf, computerField, withComputer, ACCOUNT_READ_MS,
} from './computer-rules.mjs';
import { dataFolderFromRoot } from './reopen-rules.mjs';

/** The text of a file, or '' when it is not there or cannot be read. Never throws. */
async function textOf($, file) {
  try {
    return (await $.fs.exists(file)) ? String(await $.fs.read(file)) : '';
  } catch {
    return '';
  }
}

/** This computer's id: the one kept in the data folder, else a new one written there and read back. Null on failure. */
async function computerIdOf($, data) {
  const file = `${data}/${COMPUTER_ID_FILE}`;
  const kept = parseComputerId(await textOf($, file));
  if (kept) return kept;
  await $.fs.write(file, `${newComputerId()}\n`);
  // Read back, so two chats that made one at the same moment both use the one that stayed.
  return parseComputerId(await textOf($, file));
}

/** The time, from the engine's clock when it has one. */
const nowOf = async ($) => {
  try { return Number(await $.clock.now()); } catch { return Date.now(); }
};

/** The hash of Claude Code's own account, read again at most every 10 minutes (`kept` is one registration's). */
async function accountOf($, kept) {
  const t = await nowOf($);
  if (Number.isFinite(t) && t - kept.at < ACCOUNT_READ_MS && t >= kept.at) return kept.account;
  let account = null;
  try {
    // Each name written out: the engine lists the variables a module reads, from the call sites.
    const quiet = (p) => Promise.resolve(p).catch(() => '');
    const configDir = await quiet($.env.get('CLAUDE_CONFIG_DIR'));
    const home = await quiet($.env.get('HOME'));
    const userProfile = await quiet($.env.get('USERPROFILE'));
    for (const file of configFilesOf({ configDir, home, userProfile })) {
      const text = await textOf($, file);
      if (!text) continue;
      account = await claudeAccountHashOf(claudeAccountIdOf(text));
      break;
    }
  } catch {
    account = null;
  }
  kept.at = t;
  kept.account = account;
  return account;
}

/** This computer's hostname: what listen.sh wrote, else Windows' COMPUTERNAME. Null when neither. */
async function hostOfHere($, data) {
  const written = hostOf(await textOf($, `${data}/${COMPUTER_NAME_FILE}`));
  if (written) return written;
  try { return hostOf(await $.env.get('COMPUTERNAME')); } catch { return null; }
}

/** Tell this chat's listener its computer, once: the file holds the id. Never throws. */
async function tellListener($, data, sessionId, id) {
  try {
    const file = pcFileOf(data, sessionId);
    if (file && parseComputerId(await textOf($, file)) !== id) await $.fs.write(file, `${id}\n`);
  } catch {
    // The listener names no computer to /watch, and keeps the rule from before D124; the posts still name it.
  }
}

/** The computer field for this computer, and its data folder, once a room said it tells computers apart; else null. */
async function here($, kept) {
  const data = dataFolderFromRoot($.plugin.root);
  if (!data || !(await $.fs.exists(`${data}/${COMPUTERS_FLAG}`))) return null;
  const id = await computerIdOf($, data);
  if (!id) return null;
  return { data, id, field: computerField({ id, account: await accountOf($, kept), host: await hostOfHere($, data) }) };
}

/** The call with this computer and chat named, or with none a model wrote, or as it came. */
async function filled($, e, kept) {
  let aisle = false;
  try {
    aisle = aisleRoom(await $.tool.list(), e.tool);
    if (!aisle) return e;
    const on = await here($, kept);
    if (!on) return withComputer(e);
    let sessionId = null;
    try { sessionId = await $.session.id(); } catch { sessionId = null; }
    if (sessionId) await tellListener($, on.data, sessionId, on.id);
    const chat = e.agentId === undefined && sessionId ? await chatIdOf(sessionId) : null;
    return withComputer(e, { computer: on.field, chat });
  } catch {
    return aisle ? withComputer(e) : e;
  }
}

/**
 * At a main-loop turn's start, before the chat has called anything: on a computer whose room tells computers apart,
 * this chat's listener may name the computer from now on, since every post of this chat will. Called by chat-mark.mjs's
 * own turn.start, since the engine refuses a second turn.start with no matcher (`claude plugin validate`, 2.1.308).
 * The flag first: on a computer no room marked, a turn costs one look. Never throws.
 */
export async function computerAtTurn($) {
  try {
    const data = dataFolderFromRoot($.plugin.root);
    if (!data || !(await $.fs.exists(`${data}/${COMPUTERS_FLAG}`))) return;
    const sessionId = await $.session.id();
    const file = pcFileOf(data, sessionId);
    if (!file || (await $.fs.exists(file))) return;
    if (!anyTakesChat(await $.tool.list())) return;
    const id = await computerIdOf($, data);
    if (id) await tellListener($, data, sessionId, id);
  } catch {
    // Then the chat's first post tells its listener (tellListener).
  }
}

export const register = (on) => {
  const kept = { at: -Infinity, account: null };
  // A hook that fails before it passed the call on lets the call go ahead as it came, as chat-mark.mjs's does. The
  // engine takes `.catch` only chained where on() is called.
  on('tool.call', { tool: COMPUTER_TOOLS }, async ($, e, next) => next(await filled($, e, kept))).catch(($, e, next) => next(e));
};
