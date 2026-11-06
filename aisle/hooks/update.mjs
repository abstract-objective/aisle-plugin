// The AIsle plugin keeps itself up to date (D48). The Claude desktop app skips plugin updates, and Claude Code
// leaves them off for every marketplace Anthropic does not run, so a plugin left alone never updates (measured
// 2026-10-06). When a chat opens, at most once an hour across every chat on this computer, this asks Claude Code
// to update the plugin, says so in a note when it did, and shows a strip above the chat box only after the update
// has failed several times in a row, or when the person pressed Try again.
// A hooks module: Claude Code runs it in an environment of its own (no Node; `h` is the element factory and `$`
// reaches everything outside). Claude Code calls this API early access, so nothing here may throw or wait on the
// person: when it stops loading, the plugin's listening and marks (listen.sh) go on as before.
// Job su1: which Claude Code it runs is found by findClaude (update-rules.mjs), since CLAUDE_CODE_EXECPATH is not in
// the desktop app's own environment, and every check leaves one line of what it did (trace), in the store and in the
// plugin's data folder (`self-update`), the one file this module writes.
import {
  dueForCheck, pluginIdFromRoot, dataFolderFromRoot, onWindows, findClaude, updateOutcome, updatedNote, failedLine,
  FAILURES_BEFORE_STRIP, TRACE_FILE, TRACE_KEY, traceLine, withTraceLine, traces,
} from './update-rules.mjs';

const UPDATE_TIMEOUT_MS = 3 * 60 * 1000;

let failing = null; // why updating failed, while this chat shows the strip

/** An environment variable, or '' when it is unset or cannot be read. Never throws. */
const quiet = (p) => Promise.resolve(p).then((v) => v ?? '', () => '');

/** One line of what this check did, in the store and at the end of the data folder's trace file. Never throws. */
async function trace($, what) {
  let now = null;
  try { now = await $.clock.now(); } catch { now = null; }
  const line = traceLine(now, what);
  try {
    await $.store.set(TRACE_KEY, line);
  } catch {
    // The file below may still say it.
  }
  try {
    const data = dataFolderFromRoot($.plugin.root);
    if (!data) return;
    const file = `${data}/${TRACE_FILE}`;
    const had = (await $.fs.exists(file)) ? String(await $.fs.read(file)) : '';
    await $.fs.write(file, withTraceLine(had, line));
  } catch {
    // The store's line still says it.
  }
}

async function check($, { asked }) {
  try {
    const id = pluginIdFromRoot($.plugin.root);
    if (!id) return await trace($, traces.noId($.plugin.root));
    const now = await $.clock.now();
    const last = await $.store.get('lastCheckedAt');
    if (!asked && !dueForCheck(last, now)) return await trace($, traces.notDue(last));
    const windows = onWindows($.plugin.root);
    // `$.fs` itself may not be handed on: the engine refuses a module that uses a noun of `$` as a value, and with it
    // every feature here ("$.fs is used as a value", `claude plugin test`, 2.1.317). So two calls, spelled out.
    const fs = { list: (p) => $.fs.list(p), exists: (p) => $.fs.exists(p) };
    // Each name written out: the engine lists the variables a module reads, from the call sites.
    const { exe, from } = await findClaude(fs, {
      execPath: await quiet($.env.get('CLAUDE_CODE_EXECPATH')),
      windows,
      localAppData: windows ? await quiet($.env.get('LOCALAPPDATA')) : '',
      appData: windows ? await quiet($.env.get('APPDATA')) : '',
      path: await quiet($.env.get('PATH')),
    });
    if (!exe) return await trace($, traces.noExe(windows));
    await $.store.set('lastCheckedAt', now);
    let outcome;
    try {
      outcome = updateOutcome(await $.process.run([exe, 'plugin', 'update', id], { timeoutMs: UPDATE_TIMEOUT_MS }));
    } catch (err) {
      outcome = { kind: 'failed', reason: String(err?.message ?? err).slice(0, 160) };
    }
    await trace($, traces.ran(outcome, from));
    const failures = outcome.kind === 'failed' ? Number((await $.store.get('failedChecks')) ?? 0) + 1 : 0;
    await $.store.set('failedChecks', failures);
    if (outcome.kind === 'updated') $.ui.toast(updatedNote(outcome));
    failing = outcome.kind === 'failed' && (asked || failures >= FAILURES_BEFORE_STRIP) ? outcome.reason : null;
    $.ui.invalidate('ui.render');
  } catch (err) {
    // Never in the person's way: the next chat to open asks again, and the trace says what stopped this one.
    await trace($, traces.error(err));
  }
}

export const register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e);
    // After the chat is ready, so the first prompt never waits on it.
    $.clock.after(3000, () => check($, { asked: false }));
    return started;
  });

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (!failing || e.props.hasSurvey) return next(e);
    const { Box, Button, Text } = $.ui.resolve(e);
    return h(Box, null,
      h(Text, null, `${failedLine(failing)} `),
      h(Button, { key: 'retry', label: 'Try again', variant: 'primary', onPress: () => check($, { asked: true }) }),
      h(Button, { key: 'hide', label: 'Hide', role: 'dismiss', onPress: () => { failing = null; $.ui.invalidate('ui.render'); } }));
  });
};
