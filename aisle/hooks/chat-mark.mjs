// Each chat's own read mark (job d23): this names the chat in AIsle's read_chat and whoami, so a worker chat's
// read no longer takes the new messages out of the listening chat's next read. What it adds, and where, is decided
// in chat-mark-rules.mjs: only on the main loop, only to those two tools, and only where that server's read_chat
// says it takes `chat`; there a call never carries a `chat` the model wrote. A hooks module, like update.mjs and
// link.mjs: no Node, `$` reaches everything outside, and nothing here may throw or make the person wait. Anything
// that goes wrong sends the call as the model made it, which is how every call went before. It reaches no network,
// runs no program and changes no setting. It writes one file, in the plugin's own data folder: `named-<session>`,
// which tells this chat's listener (listen.sh) to name the chat to the room too, from then on.
import { CHAT_TOOLS, takesChat, anyTakesChat, chatIdOf, withChat, namedFileOf } from './chat-mark-rules.mjs';

/** Tell this chat's listener that its reads are named, once: the file holds the chat's 32 hex. Never throws. */
async function tellListener($, sessionId, chat) {
  try {
    const file = chat ? namedFileOf($.plugin.root, sessionId) : null;
    if (file && !(await $.fs.exists(file))) await $.fs.write(file, `${chat}\n`);
  } catch {
    // The listener names no chat to /watch; the reads still name it.
  }
}

/** The call with this chat named, or the call as it came. */
async function named($, e) {
  let aisle = false;
  try {
    aisle = takesChat(await $.tool.list(), e.tool);
    if (!aisle) return e;
    const sessionId = e.agentId === undefined ? await $.session.id() : null;
    const chat = sessionId ? await chatIdOf(sessionId) : null;
    if (chat) await tellListener($, sessionId, chat);
    return withChat(e, chat);
  } catch {
    // On an AIsle room that takes `chat`, never one the model wrote; anywhere else, the call as it came.
    return aisle ? withChat(e, null) : e;
  }
}

/**
 * At a main-loop turn's start, before the chat has called anything: if its AIsle room takes `chat`, its listener
 * may name it from now on, so a worker chat's read is kept from this chat's first wake, not only from its first
 * read. A file already there costs one look.
 */
async function atTurn($) {
  try {
    const sessionId = await $.session.id();
    const chat = await chatIdOf(sessionId);
    const file = chat ? namedFileOf($.plugin.root, sessionId) : null;
    if (!file || (await $.fs.exists(file))) return;
    if (anyTakesChat(await $.tool.list())) await $.fs.write(file, `${chat}\n`);
  } catch {
    // Then the chat's first named read tells its listener (tellListener).
  }
}

export const register = (on) => {
  // A hook that fails before it passed the call on lets the call go ahead as it came. The engine takes
  // `.catch` only chained where on() is called: a registration kept in a variable, or `?.catch`, makes it
  // refuse the whole hooks module, and with it the self-update, the way back and the link (measured with
  // `claude plugin validate` and a headless run, 2.1.299, 2026-10-21).
  on('tool.call', { tool: CHAT_TOOLS }, async ($, e, next) => next(await named($, e))).catch(($, e, next) => next(e));
  // Observe only: the turn goes ahead whatever this does. A subagent's turn is not this chat's.
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e);
    await atTurn($);
    return next(e);
  }).catch(($, e, next) => next(e));
};
