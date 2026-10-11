// What the AIsle plugin's "no AIsle tools here" strip decides (D69 step 2, plugin 0.3.12), kept apart from
// Claude Code so node can test it. The module beside it, link.mjs, runs inside Claude Code: it asks Claude
// Code which tools this chat has, and shows one strip when none of them is AIsle's.
//
// Why (R21 findings, section 3): on PC2 the plugin was installed, but no AIsle MCP server was set up anywhere,
// so the chat had the skill and no tools, and nothing said the one step. The server cannot see such a PC (every
// report needs a folder token, which needs a tool call); the plugin on the PC can, at chat start.
//
// How it tells (findings 2b): `$.tool.list()`, "the tools the model can call now, built-in and MCP alike".
// NOT VERIFIED on Ofir's PCs (the findings say so; the mods API is early access, D48). So this is careful in the
// direction that costs nothing: an answer it cannot trust (the call missing, throwing, or naming no tool at all)
// shows nothing, and the fallback the findings name stays the way back: the skill's own no-tools line
// (skills/aisle/SKILL.md) and whoami's checks. A strip is shown only when the list came back with tools in it
// and none is AIsle's, twice, far enough apart for the claude.ai connector to have connected.

/** The address the AIsle connector is added with: the server's own /mcp (engine/aisle.mjs `connect.headerForm.url`). */
export const AISLE_MCP = 'https://aisle.abstractobjective.dev/mcp';

/**
 * "Link your Claude": the link the fast start's button opens (D50; site/islands/aisle.js claudeInstallLink),
 * claude.ai's Add custom connector dialog with AIsle filled in. A connector reaches every folder and a chat with
 * no folder (findings section 4), which a room key set up for one folder never does.
 */
export const LINK_CLAUDE = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=AIsle&connectorUrl=${encodeURIComponent(AISLE_MCP)}`;

/** The button's words, the fast start's own (engine/aisle.mjs START.claude). */
export const LINK_LABEL = 'Link your Claude';

/** The first look, after the chat is ready: Claude Code connects MCP servers, the claude.ai connector among them, as the chat starts. */
export const FIRST_LOOK_MS = 20 * 1000;

/** The second look, which must agree with the first before the strip shows: a slow connector has had a minute. */
export const SURE_AFTER_MS = 60 * 1000;

/** While the strip is up it looks again this often, and goes as soon as AIsle's tools are there. */
export const RECHECK_MS = 60 * 1000;

/** Not now quiets the strip in every chat on this computer for this long. */
export const QUIET_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a tool is one of AIsle's. The server's name is the person's (`claude_ai_AIsle`, `aisle`, or an id the
 * desktop app gives a connector), so it goes by the tool's own name: `listen_here` and `read_chat` are AIsle's.
 * A tool another server happens to name so only keeps the strip away: the safe direction.
 */
export function isAisleTool(tool) {
  const name = String(tool?.name ?? '');
  return /^mcp__.+__(listen_here|read_chat)$/.test(name);
}

/**
 * What one look found: 'aisle' (AIsle's tools are here), 'none' (the list came back, with tools, and none is
 * AIsle's), or 'unknown' (no list it can trust: nothing is shown on that).
 */
export function lookAt(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return 'unknown';
  if (tools.some(isAisleTool)) return 'aisle';
  // An engine that lists no tool by name at all has not answered.
  return tools.some((t) => typeof t?.name === 'string' && t.name) ? 'none' : 'unknown';
}

/** Whether Not now still holds: within QUIET_MS of the press. A clock that went backwards shows the strip again. */
export function quiet(hiddenAt, now) {
  const at = Number(hiddenAt);
  return at > 0 && now >= at && now - at < QUIET_MS;
}

/** The strip's words before the link. One step, and what it fixes. */
export const missingLine = 'AIsle: this chat has no AIsle tools. One step:';

/** After the link: a connector reaches the chats that start after it, in every folder. */
export const afterLine = ', then start a new chat.';
