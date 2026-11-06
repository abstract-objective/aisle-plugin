// AIsle's read allow (D161, job d161h): this tells the chat's listener (listen.sh) which of the chat's servers are
// AIsle's, so its PreToolUse lets whoami, read_chat, read_plan and estimate run with no prompt there and nowhere else,
// and fills listen_here only there. What counts, and the file's form, are in allow-rules.mjs. A hooks module part, like
// chat-mark.mjs: no Node, `$` reaches everything outside, and nothing here may throw or make the person wait. It
// reaches no network, runs no program and changes no setting. It writes one file, in the plugin's own data folder:
// `servers-<session>`, written again only when it would say more.
import { aisleServersOf, serverOfTool, serversFileOf, parseServers, serversText } from './allow-rules.mjs';

/** This chat's file and what it holds now (null when it is not there); null for both where there is none to keep. */
async function fileOf($) {
  const file = serversFileOf($.plugin.root, await $.session.id());
  if (!file) return null;
  return { file, had: (await $.fs.exists(file)) ? String(await $.fs.read(file)) : null };
}

/**
 * At a main-loop turn's start (chat-mark.mjs's turn.start: the engine takes only one with no matcher): the AIsle
 * servers of this chat's tool list join the file, which the first turn writes even when there are none. Once the file
 * names one, a turn costs one look and one read, and no tool list. Never throws.
 */
export async function allowAtTurn($) {
  try {
    const f = await fileOf($);
    if (!f || parseServers(f.had).length) return;
    const text = serversText(f.had, aisleServersOf(await $.tool.list()));
    if (text !== null) await $.fs.write(f.file, text);
  } catch {
    // Then AIsle's reads ask, as before D161, until a later turn or call writes the file.
  }
}

/**
 * At a call the hooks module already took as AIsle's (chat-mark.mjs's read_chat and whoami, computer.mjs's
 * post_message and listen_here): its server joins the file, for a server the turn's start did not see yet (still
 * connecting, or added since). Never throws.
 */
export async function allowServer($, tool) {
  try {
    const server = serverOfTool(tool);
    const f = server ? await fileOf($) : null;
    if (!f || parseServers(f.had).includes(server)) return;
    const text = serversText(f.had, [server]);
    if (text !== null) await $.fs.write(f.file, text);
  } catch {
    // Then the next turn's start takes it.
  }
}
