// "No AIsle tools here" (D69 step 2, plugin 0.3.12). When a chat opens with the AIsle plugin and none of AIsle's
// tools, one strip above the chat box says so and gives the one step: Link your Claude, the fast start's own
// link. Never more than one strip in a chat, never when AIsle's tools are here, and Not now quiets it on this
// computer for a week. It goes by itself once AIsle's tools are there.
// How it tells is in link-rules.mjs: `$.tool.list()`, not verified on Ofir's PCs (R21 findings 2b), so an
// answer it cannot trust shows nothing and the skill's own no-tools line stays the way back.
// A hooks module, like update.mjs and reopen.mjs: no Node, `h` is the element factory and `$` reaches everything
// outside, and nothing here may throw or make the person wait. It reads the chat's tool list and its own store
// key; it reaches no network, runs no program and changes no setting.
import {
  LINK_CLAUDE, LINK_LABEL, FIRST_LOOK_MS, SURE_AFTER_MS, RECHECK_MS, lookAt, quiet, missingLine, afterLine,
} from './link-rules.mjs';

/** When Not now was pressed, for every chat on this computer. */
const HIDDEN_AT = 'linkHiddenAt';

let shown = false;   // the strip is up in this chat
let done = false;    // this chat has had its strip, or AIsle's tools: never another
let looking = null;  // the timer that looks again while the strip is up

/** What the chat's tool list says now: 'aisle', 'none' or 'unknown'. */
async function tools($) {
  try {
    return lookAt(await $.tool.list());
  } catch {
    return 'unknown';
  }
}

function draw($, up) {
  shown = up;
  $.ui.invalidate('ui.render');
  if (up && !looking) looking = $.clock.every(RECHECK_MS, () => recheck($));
  if (!up && looking) {
    looking.cancel();
    looking = null;
  }
}

/** The first look; a 'none' is looked at again before anything shows. */
async function first($) {
  try {
    if (done) return;
    const seen = await tools($);
    if (seen !== 'none') {
      // AIsle's tools are here, or the list cannot be trusted: nothing to show in this chat.
      done = true;
      return;
    }
    $.clock.after(SURE_AFTER_MS, () => sure($));
  } catch {
    done = true;
  }
}

/** The second look: the strip shows only if it agrees, and Not now does not hold. */
async function sure($) {
  try {
    if (done) return;
    done = true;
    if ((await tools($)) !== 'none') return;
    if (quiet(await $.store.get(HIDDEN_AT), await $.clock.now())) return;
    draw($, true);
  } catch {
    // Never in the person's way.
  }
}

/** While the strip is up: it goes as soon as AIsle's tools are there. */
async function recheck($) {
  try {
    if (shown && (await tools($)) === 'aisle') draw($, false);
  } catch {
    // It stays up; Not now takes it away.
  }
}

async function notNow($) {
  if (!shown) return;
  draw($, false);
  try {
    await $.store.set(HIDDEN_AT, await $.clock.now());
  } catch {
    // Unsaved, the next chat shows it again: a strip too many, nothing worse.
  }
}

export const register = (on) => {
  // When a chat opens, interactive or not (the desktop app's chats among them). A matcher, because a plugin may
  // hook session.start only once without one, and update.mjs has that one.
  on('session.start', { isInteractive: [false, true] }, async ($, e, next) => {
    const started = await next(e);
    // After the chat is ready and its MCP servers have had time to connect, so the first prompt never waits on it.
    $.clock.after(FIRST_LOOK_MS, () => first($));
    return started;
  });

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (!shown || e.props.hasSurvey) return next(e);
    const { Box, Button, Link, Text } = $.ui.resolve(e);
    return h(Box, null,
      // A Link is inline: it sits inside the Text, between its words.
      h(Text, null, `${missingLine} `, h(Link, { href: LINK_CLAUDE, label: LINK_LABEL }), `${afterLine} `),
      h(Button, { key: 'aisle-link-later', label: 'Not now', role: 'dismiss', onPress: () => notNow($) }));
  });
};
