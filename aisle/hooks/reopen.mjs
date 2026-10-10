// The way back after a restart (D56). When the app or the computer closes, the listening loop of every folder
// that said yes dies with it, and nothing brings it back until that folder's chat opens again. So when a chat
// opens in any folder, this looks, with no server call, for a folder whose loop stopped (its beat, which
// listen.sh writes at every turn, is old), and shows one strip above the chat box. Reopen opens the app's own
// link to that folder's chat, which starts listening once it is sent any message (the app starts a chat only
// then), and the strip says so until it does; Not now leaves it until that folder has listened and stopped
// again. If Reopen fails, the strip says the one thing to do instead, and one dim line in the transcript says
// why. It never opens a window by itself (AUTO_REOPEN, Ofir's choice).
// The desktop app only, in 0.3.8 (drawsOn, looksIn): the beat cannot tell an app that closed from a chat
// closed on purpose, and in the terminal every exit would bring a strip.
// A hooks module, like update.mjs: no Node, `h` is the element factory and `$` reaches everything outside,
// and nothing here may throw or make the person wait. It reads the plugin's own data folder, and checks that
// each folder named there is still on the computer; nothing else.
import {
  AUTO_REOPEN, LOOK_AFTER_MS, REOPEN_TIMEOUT_MS, RECHECK_MS, dataFolderFromRoot, onWindows, hostPath,
  offers, remember, listeningAgain, drawsOn, looksIn, askLine, openingLine, openedNote, sidebarLine, failedNote,
  resumeLink, openLinkCommand, shortReason,
} from './reopen-rules.mjs';

/** What the store keeps of the offers answered, for every chat on this computer. */
const ANSWERED = 'reopenAnswered';

let cwd = '';        // the folder this chat runs in
let me = '';         // this chat's session id
let shown = null;    // { offer, state: 'ask' | 'opening' | 'opened' | 'sidebar' } while the strip is up
let looking = null;  // the timer that looks again while the strip is up

/** The offers the data folder holds now, newest stop first. */
async function gather($) {
  const data = dataFolderFromRoot($.plugin.root);
  if (!data || !(await $.fs.exists(`${data}/folders`))) return [];
  const windows = onWindows($.plugin.root);
  // When each loop last ended to wake its chat with a message.
  const answering = {};
  for (const f of await $.fs.list(data)) {
    const m = /^after-([A-Za-z0-9-]+)$/.exec(f.name);
    if (m && f.kind === 'file') answering[m[1]] = f.mtimeMs;
  }
  const folders = [];
  for (const d of await $.fs.list(`${data}/folders`)) {
    if (d.kind !== 'dir' || !/^[0-9a-f]{16}$/.test(d.name)) continue;
    try {
      const dir = `${data}/folders/${d.name}`;
      const files = {};
      for (const f of await $.fs.list(dir)) if (f.kind === 'file') files[f.name] = f.mtimeMs;
      // Read further only a folder that said yes and has a chat and a beat: most folders were only asked.
      if (!('answered' in files) || 'stopped' in files || 'refused' in files || !('helper' in files) || !('path' in files) || !('beat' in files)) continue;
      const text = (name) => (name in files ? $.fs.read(`${dir}/${name}`) : '');
      const folder = { id: d.name, files, helper: await text('helper'), path: await text('path'), beat: await text('beat'), role: await text('role') };
      folder.pathExists = await $.fs.exists(hostPath(folder.path, windows));
      folders.push(folder);
    } catch {
      // A folder half written, or removed while it was read: nothing to offer.
    }
  }
  return offers(folders, { now: await $.clock.now(), cwd, sessionId: me, answering, answered: await $.store.get(ANSWERED) });
}

/** Whether the offer's folder listens again: a new, fresh beat. */
async function listening($, o) {
  const data = dataFolderFromRoot($.plugin.root);
  const beat = await $.fs.read(`${data}/folders/${o.id}/beat`).catch(() => '');
  return listeningAgain(beat, o, await $.clock.now());
}

function draw($, next) {
  shown = next;
  $.ui.invalidate('ui.render');
  keepLooking($);
}

/** While the strip is up it looks again now and then, so it goes as soon as its folder listens again. */
function keepLooking($) {
  const up = shown !== null && shown.state !== 'opening';
  if (up && !looking) looking = $.clock.every(RECHECK_MS, () => look($));
  if (!up && looking) {
    looking.cancel();
    looking = null;
  }
}

async function look($) {
  try {
    if (shown?.state === 'opening') return;
    if (shown) {
      // While the strip is up only its own folder is looked at again (one read, not the whole data folder):
      // it goes once that folder listens again, or once another chat answered it.
      const o = shown.offer;
      const gone = (await listening($, o)) || (shown.state === 'ask' && (await $.store.get(ANSWERED))?.[o.id] === o.key);
      if (!gone || shown?.offer !== o) return;
      draw($, null);
    }
    const list = await gather($);
    if (shown) return; // a press came in meanwhile
    const next = list[0] ?? null;
    if (AUTO_REOPEN && next) return void reopen($, next);
    if (next) draw($, { offer: next, state: 'ask' });
  } catch {
    // Never in the person's way: the next chat to open looks again.
  }
}

/** Answered for this stop, in every chat on this computer: no new offer until the folder listens and stops again. */
async function answer($, o) {
  try {
    await $.store.set(ANSWERED, remember(await $.store.get(ANSWERED), o));
  } catch {
    // Unsaved, it is offered again in the next chat: a strip too many, never a window.
  }
}

async function reopen($, o) {
  draw($, { offer: o, state: 'opening' });
  await answer($, o);
  let ok = false;
  let why = '';
  try {
    // The app's own link for that chat, handed to the system the way Claude Code's own desktop flag does: that
    // command itself refuses to run here, since a hooks module captures what it writes (resumeLink).
    const link = resumeLink(o.helper);
    const windows = onWindows($.plugin.root);
    if (!link) why = 'no session id for that chat';
    else {
      const command = openLinkCommand(link, windows, windows ? await $.env.get('SystemRoot') : '');
      const ran = await $.process.run(command, { cwd: hostPath(o.path, windows), stdin: '', timeoutMs: REOPEN_TIMEOUT_MS });
      ok = ran.exitCode === 0;
      if (!ok) why = `exit ${ran.exitCode}${shortReason(ran.stderr) ? `: ${shortReason(ran.stderr)}` : ''}`;
    }
  } catch (err) {
    // It could not start, or ran past its time: the strip says what to do instead.
    why = shortReason(err?.message ?? err);
  }
  if (!ok) {
    note($, failedNote(o.name, why));
    return draw($, { offer: o, state: 'sidebar' });
  }
  // The link went through, and the app shows that chat. It starts only on a message, so the strip says to send
  // one, here too, until that folder's loop goes round (look, every RECHECK_MS); it never runs the link again.
  $.ui.toast(openedNote(o.name), { timeoutMs: 8000 });
  draw($, { offer: o, state: 'opened' });
}

/** A dim line in this chat's transcript, never sent to Claude: why a press did not work, for whoever looks. */
function note($, text) {
  try {
    $.ui.log(text);
  } catch {
    // The strip still says what to do.
  }
}

/** Reopen, pressed: once, for the offer the strip shows. */
function pressReopen($, o) {
  if (shown?.offer !== o || shown.state !== 'ask') return;
  reopen($, o);
}

/** Not now, or Hide: this stop is answered, and the next folder that stopped, if any, shows. */
async function later($, o) {
  if (shown?.offer !== o) return;
  draw($, null);
  await answer($, o);
  await look($);
}

async function first($) {
  try {
    me = String((await $.session.id()) ?? '');
    if (!cwd) cwd = String((await $.session.cwd()) ?? '');
  } catch {
    return;
  }
  // A chat only in the terminal, the editor or on the phone looks at nothing: the strip is the desktop's.
  let surfaces = [];
  try {
    surfaces = await $.session.surfaces();
  } catch {
    // Unknown: it looks, and only a desktop drawing shows the strip.
  }
  if (!looksIn(surfaces)) return;
  await look($);
}

export const register = (on) => {
  // When a chat opens, in every chat, interactive or not. A matcher, because a plugin may hook session.start
  // only once without one (`claude plugin validate` refuses a second), and update.mjs has that one.
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    const started = await next(e);
    cwd = String(e.cwd ?? '');
    // After the chat is ready, so the first prompt never waits on it.
    $.clock.after(LOOK_AFTER_MS, () => first($));
    return started;
  });

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (!shown || e.props.hasSurvey || !drawsOn(e.surface)) return next(e);
    const { Box, Button, Text } = $.ui.resolve(e);
    const { offer: o, state } = shown;
    const hide = (label) => h(Button, { key: 'aisle-reopen-later', label, role: 'dismiss', onPress: () => later($, o) });
    if (state === 'opening') return h(Box, null, h(Text, null, openingLine(o.name)));
    if (state === 'opened') return h(Box, null, h(Text, null, `${openedNote(o.name)} `), hide('Hide'));
    if (state === 'sidebar') return h(Box, null, h(Text, null, `${sidebarLine(o.name)} `), hide('Hide'));
    return h(Box, null,
      h(Text, null, `${askLine(o.name)} `),
      h(Button, { key: 'aisle-reopen', label: 'Reopen', variant: 'primary', onPress: () => pressReopen($, o) }),
      hide('Not now'));
  });
};
