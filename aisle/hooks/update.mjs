// The AIsle plugin keeps itself up to date (D48). The Claude desktop app skips plugin updates, and Claude Code
// leaves them off for every marketplace Anthropic does not run, so a plugin left alone never updates (measured
// 2026-10-06). When a chat opens, at most once an hour across every chat on this computer, this asks Claude Code
// to update the plugin, says so in a note when it did, and shows a strip above the chat box only after the update
// has failed several times in a row, or when the person pressed Try again.
// A hooks module: Claude Code runs it in an environment of its own (no Node; `h` is the element factory and `$`
// reaches everything outside). Claude Code calls this API early access, so nothing here may throw or wait on the
// person: when it stops loading, the plugin's listening and marks (listen.sh) go on as before.
import { dueForCheck, pluginIdFromRoot, updateOutcome, updatedNote, failedLine, FAILURES_BEFORE_STRIP } from './update-rules.mjs';

const UPDATE_TIMEOUT_MS = 3 * 60 * 1000;

let failing = null; // why updating failed, while this chat shows the strip

async function check($, { asked }) {
  try {
    const id = pluginIdFromRoot($.plugin.root);
    const exe = await $.env.get('CLAUDE_CODE_EXECPATH');
    if (!id || !exe) return;
    const now = await $.clock.now();
    if (!asked && !dueForCheck(await $.store.get('lastCheckedAt'), now)) return;
    await $.store.set('lastCheckedAt', now);
    let outcome;
    try {
      outcome = updateOutcome(await $.process.run([exe, 'plugin', 'update', id], { timeoutMs: UPDATE_TIMEOUT_MS }));
    } catch (err) {
      outcome = { kind: 'failed', reason: String(err?.message ?? err).slice(0, 160) };
    }
    const failures = outcome.kind === 'failed' ? Number((await $.store.get('failedChecks')) ?? 0) + 1 : 0;
    await $.store.set('failedChecks', failures);
    if (outcome.kind === 'updated') $.ui.toast(updatedNote(outcome));
    failing = outcome.kind === 'failed' && (asked || failures >= FAILURES_BEFORE_STRIP) ? outcome.reason : null;
    $.ui.invalidate('ui.render');
  } catch {
    // Never in the person's way: the next chat to open asks again.
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
