// The one yes (job su3, su2's path B). Once per computer, a strip above the chat box asks "Keep AIsle up to date by
// itself?". Yes writes Claude Code's own two switches into the person's Claude Code user settings, with a backup of the
// file first, so Claude Code updates AIsle in every chat from then on, the desktop app's too, and nothing in AIsle asks
// about an update again. No is final. A question skipped shows once more a week later at the soonest, then never.
// The answer is kept in the plugin's data folder (`auto-update`), which every chat on this computer reads and which
// outlives each update; the store keeps a copy. An undo puts both switches back: the strip's Undo, and later the slash
// command /aisle-auto-update-off, registered only where the yes changed something. The plugin's own hourly
// self-update (D48, update.mjs) goes on beside it, untouched.
// A hooks module, like update.mjs: no Node, `h` is the element factory and `$` reaches everything outside, and nothing
// here may throw or make the person wait. It writes three files and no others: the user settings file the rules name
// (settingsTarget), its backup beside it, and its answer in the data folder; it reads Claude Code's list of marketplaces.
import {
  pluginIdFromRoot, dataFolderFromRoot, onWindows, marketplaceOf, settingsTarget, readSettings, autoUpdateOn, knownSource,
  planYes, planUndo, onlyTheSwitches, readsBackAs, backupPaths, tempPath, renameCommand, standingAnswer, shouldAsk,
  shownRecord, answerRecord, answerText, ANSWER_FILE, ANSWER_KEY, ASK_AFTER_MS, RECHECK_MS, DRAWS_ON, RENAME_TIMEOUT_MS,
  UNDO_COMMAND, UNDO_DESCRIPTION, QUESTION, YES_LABEL, NO_LABEL, LATER_LABEL, WORKING_LINE, DONE_LINE, NO_NOTE,
  UNDONE_LINE, NOTHING_TO_UNDO, refusedLine,
} from './auto-update-rules.mjs';

let shown = null;    // { state: 'ask' | 'working' | 'done' | 'refused' | 'undone', why } while the strip is up
let drawn = false;   // the question reached the band in this chat
let marked = false;  // and that showing is counted
let looking = null;  // the timer that looks while the question is up
let offered = false; // the undo command is registered in this chat

/** An environment variable, or '' when it is unset or cannot be read. Never throws. */
const quiet = (p) => Promise.resolve(p).then((v) => v ?? '', () => '');
const reason = (err) => String(err?.message ?? err).split(/\r?\n/)[0].slice(0, 160);

/** A file's text, or null when it is not there. */
async function readText($, path) {
  return (await $.fs.exists(path)) ? String(await $.fs.read(path)) : null;
}

/** The answer that stands for this computer, from the data folder and the store. */
async function answerOf($) {
  const data = dataFolderFromRoot($.plugin.root);
  let file = null;
  let stored = null;
  try { file = data ? await readText($, `${data}/${ANSWER_FILE}`) : null; } catch { file = 'unreadable'; }
  try { stored = await $.store.get(ANSWER_KEY); } catch { stored = null; }
  return standingAnswer(file, stored);
}

/** Keeps an answer in the data folder and in the store; either one alone still keeps it. */
async function saveAnswer($, record) {
  const data = dataFolderFromRoot($.plugin.root);
  let kept = false;
  try {
    if (data) {
      await $.fs.write(`${data}/${ANSWER_FILE}`, answerText(record));
      kept = true;
    }
  } catch {
    // The store's copy below.
  }
  try {
    await $.store.set(ANSWER_KEY, record);
    kept = true;
  } catch {
    // The file's, above.
  }
  return kept;
}

/** The settings file this computer's yes may change, from Claude Code's own environment and the plugin's folder. */
async function target($) {
  const root = $.plugin.root;
  const windows = onWindows(root);
  // Each name written out: the engine lists the variables a module reads, from the call sites.
  return settingsTarget({
    root,
    configDir: await quiet($.env.get('CLAUDE_CONFIG_DIR')),
    home: await quiet($.env.get('HOME')),
    userProfile: windows ? await quiet($.env.get('USERPROFILE')) : '',
  });
}

function show($, next) {
  shown = next;
  $.ui.invalidate('ui.render');
  keepLooking($);
}

function keepLooking($) {
  const up = shown?.state === 'ask';
  if (up && !looking) looking = $.clock.every(RECHECK_MS, () => tick($));
  if (!up && looking) {
    looking.cancel();
    looking = null;
  }
}

/** Counts this showing once it was drawn, so a chat whose band showed another strip has not used it up. */
async function markShown($) {
  if (marked || !drawn) return;
  marked = true;
  const record = await answerOf($);
  if (record && record.answer !== 'asked') return;
  await saveAnswer($, shownRecord(record, await $.clock.now()));
}

/** While the question is up: count it once drawn, and take it down once another chat answered it. */
async function tick($) {
  try {
    await markShown($);
    const record = await answerOf($);
    if (shown?.state === 'ask' && record && record.answer !== 'asked') show($, null);
  } catch {
    // The next tick looks again.
  }
}

/** Registers the undo command, where the yes changed this computer's settings. */
async function offerUndo($) {
  if (offered) return;
  try {
    await $.command.register({ name: UNDO_COMMAND, description: UNDO_DESCRIPTION });
    offered = true;
  } catch {
    // The strip's Undo, in the chat that said yes, is still there.
  }
}

/** When a chat opens: ask, if this computer never answered and Claude Code's two switches are not both on already. */
async function look($) {
  try {
    const id = pluginIdFromRoot($.plugin.root);
    if (!id || !dataFolderFromRoot($.plugin.root)) return;
    const record = await answerOf($);
    if (record?.answer === 'yes' && record.undo) await offerUndo($);
    if (!shouldAsk(record, await $.clock.now())) return;
    const t = await target($);
    if (!t.path) return;
    const marketplace = marketplaceOf(id);
    const read = readSettings(await readText($, t.path));
    if (read.ok && autoUpdateOn(read.settings, marketplace).both) return;
    // Set by a managed policy, or another file Claude Code reads: nothing to ask either.
    let merged = null;
    try { merged = await $.settings.read(); } catch { merged = null; }
    if (merged && autoUpdateOn(merged, marketplace).both) return;
    if (!shown) show($, { state: 'ask' });
  } catch {
    // Never in the person's way: the next chat to open looks again.
  }
}

/** A backup of the file's text beside it, read back before anything else is written; its path. */
async function backUp($, path, text, now) {
  for (const backup of backupPaths(path, now)) {
    if (await $.fs.exists(backup)) continue;
    await $.fs.write(backup, text);
    if (String(await $.fs.read(backup)) !== text) throw new Error(`the backup ${backup} did not read back the same, so nothing was changed`);
    return backup;
  }
  throw new Error(`${path} has nine backups from today already, so nothing was changed`);
}

/**
 * Writes the settings: the new text to a temp file beside it, read back, then renamed over the file. Where the rename
 * cannot run, the text is written in place. Read back at the end: if it is not what was meant, the old text goes back.
 */
async function writeSettings($, path, text, settings, old) {
  const tmp = tempPath(path);
  await $.fs.write(tmp, text);
  if (!readsBackAs(await $.fs.read(tmp), settings)) throw new Error(`${tmp} did not read back as written, so nothing was changed`);
  const windows = onWindows($.plugin.root);
  let moved = false;
  try {
    const { argv, env } = renameCommand(tmp, path, { windows, systemRoot: windows ? await quiet($.env.get('SystemRoot')) : '' });
    moved = (await $.process.run(argv, { env, stdin: '', timeoutMs: RENAME_TIMEOUT_MS })).exitCode === 0;
  } catch {
    moved = false;
  }
  if (!moved) await $.fs.write(path, text);
  if (!readsBackAs(await $.fs.read(path), settings)) {
    if (old !== null) await $.fs.write(path, old);
    throw new Error(`${path} did not read back as written, so its old text was put back`);
  }
}

/** The yes: `{ ok }`, `{ gone }` when another chat answered first, or `{ why }`. */
async function sayYes($) {
  try {
    const id = pluginIdFromRoot($.plugin.root);
    const marketplace = marketplaceOf(id);
    const record = await answerOf($);
    if (record && record.answer !== 'asked') return { gone: true };
    const t = await target($);
    if (!t.path) return { why: t.why };
    const now = await $.clock.now();
    const old = await readText($, t.path);
    const read = readSettings(old);
    const source = read.ok && !autoUpdateOn(read.settings, marketplace).marketplace
      ? knownSource(await readText($, t.known).catch(() => null), marketplace) : null;
    const plan = planYes(old, { marketplace, knownSource: source });
    if (plan.kind === 'refused') return { why: `${t.path}: ${plan.why}` };
    let backup = null;
    if (plan.kind === 'write') {
      if (!onlyTheSwitches(read.settings, plan.settings, marketplace)) return { why: 'the change would have touched other settings, so nothing was changed' };
      backup = old === null ? null : await backUp($, t.path, old, now);
      await writeSettings($, t.path, plan.text, plan.settings, old);
    }
    await saveAnswer($, answerRecord('yes', now, { settings: t.path, backup, undo: plan.kind === 'write' ? plan.before : null }));
    if (plan.kind === 'write') await offerUndo($);
    return { ok: true };
  } catch (err) {
    return { why: reason(err) };
  }
}

/** The undo: both switches back as they were before the yes, and the answer is No from then on. Its words. */
async function undo($) {
  try {
    const marketplace = marketplaceOf(pluginIdFromRoot($.plugin.root));
    const record = await answerOf($);
    if (record?.answer !== 'yes' || !record.undo) return NOTHING_TO_UNDO;
    const t = await target($);
    if (!t.path) return refusedLine(t.why);
    const now = await $.clock.now();
    const old = await readText($, t.path);
    const plan = planUndo(old, record.undo, { marketplace });
    if (plan.kind === 'refused') return refusedLine(`${t.path}: ${plan.why}`);
    let backup = null;
    if (plan.kind === 'write') {
      if (!onlyTheSwitches(readSettings(old).settings, plan.settings, marketplace)) return refusedLine('the undo would have touched other settings');
      backup = old === null ? null : await backUp($, t.path, old, now);
      await writeSettings($, t.path, plan.text, plan.settings, old);
    }
    await saveAnswer($, answerRecord('no', now, { undone: true, settings: t.path, backup }));
    return UNDONE_LINE;
  } catch (err) {
    return refusedLine(reason(err));
  }
}

async function pressYes($) {
  if (shown?.state !== 'ask' && shown?.state !== 'refused') return;
  drawn = true;
  await markShown($);
  show($, { state: 'working' });
  const done = await sayYes($);
  if (done.gone) return show($, null);
  show($, done.ok ? { state: 'done' } : { state: 'refused', why: done.why });
}

async function pressNo($) {
  if (shown?.state !== 'ask') return;
  show($, null);
  const record = await answerOf($);
  if (record && record.answer !== 'asked') return;
  if (await saveAnswer($, answerRecord('no', await $.clock.now()))) $.ui.toast(NO_NOTE);
}

/** Not now: this showing counts, and the question may come once more, a week on at the soonest. */
async function pressLater($) {
  if (shown?.state !== 'ask') return;
  drawn = true;
  show($, null);
  await markShown($);
}

async function pressUndo($) {
  if (shown?.state !== 'done') return;
  show($, { state: 'working' });
  const words = await undo($);
  show($, words === UNDONE_LINE ? { state: 'undone' } : { state: 'refused', why: words.replace(/^Nothing was changed: /, ''), undo: true });
}

export const register = (on) => {
  // When a chat opens, interactive or not (the desktop app's chats among them). A matcher, because a plugin may hook
  // session.start only once without one, and update.mjs has that one.
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    const started = await next(e);
    // After the chat is ready, the self-update's check and the way back's look, so the first prompt never waits on it.
    $.clock.after(ASK_AFTER_MS, () => look($));
    return started;
  });

  // The undo, any time later: /aisle-auto-update-off, offered only where the yes changed something.
  on('command.run', { command: UNDO_COMMAND }, async ($) => ({ text: await undo($) })).catch(($, e, next) => next(e));

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (!shown || e.props.hasSurvey || !DRAWS_ON.includes(e.surface)) return next(e);
    const { Box, Button, Text } = $.ui.resolve(e);
    const hide = (label) => h(Button, { key: 'aisle-auto-hide', label, role: 'dismiss', onPress: () => show($, null) });
    const { state, why } = shown;
    if (state === 'working') return h(Box, null, h(Text, null, WORKING_LINE));
    if (state === 'done') {
      return h(Box, null, h(Text, null, `${DONE_LINE} `),
        h(Button, { key: 'aisle-auto-undo', label: 'Undo', onPress: () => pressUndo($) }), hide('Hide'));
    }
    if (state === 'undone') return h(Box, null, h(Text, null, `${UNDONE_LINE} `), hide('Hide'));
    if (state === 'refused') {
      return h(Box, null, h(Text, null, `${refusedLine(why)} `),
        shown.undo ? null : h(Button, { key: 'aisle-auto-retry', label: 'Try again', variant: 'primary', onPress: () => pressYes($) }), hide('Hide'));
    }
    drawn = true;
    return h(Box, null,
      h(Text, null, `${QUESTION} `),
      h(Button, { key: 'aisle-auto-yes', label: YES_LABEL, variant: 'primary', onPress: () => pressYes($) }),
      h(Button, { key: 'aisle-auto-no', label: NO_LABEL, onPress: () => pressNo($) }),
      h(Button, { key: 'aisle-auto-later', label: LATER_LABEL, role: 'dismiss', onPress: () => pressLater($) }));
  });
};
