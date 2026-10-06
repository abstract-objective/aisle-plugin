// What the AIsle plugin's self-update decides (D48), kept apart from Claude Code so node can test it. The
// module beside it, update.mjs, runs inside Claude Code and does the asking.

/** How often a chat asks Claude Code to update the plugin: the first chat to open after this long asks. */
export const CHECK_EVERY_MS = 60 * 60 * 1000;

/** Failed checks in a row before the strip asks the person: one failure is usually a network blip that heals itself. */
export const FAILURES_BEFORE_STRIP = 3;

/** Whether this chat should ask now. A clock that went backwards asks too, rather than waiting hours. */
export function dueForCheck(lastCheckedAt, now) {
  const last = Number(lastCheckedAt);
  return !(last > 0) || now < last || now - last >= CHECK_EVERY_MS;
}

/**
 * `<plugin>@<marketplace>` from an installed plugin's folder, `.../plugins/cache/<marketplace>/<plugin>/<version>`.
 * Null for a copy that was not installed from a marketplace (a --plugin-dir, a directory marketplace, a mods
 * folder): Claude Code has nothing to update there, and a person working on the plugin keeps their copy.
 */
export function pluginIdFromRoot(root) {
  const parts = String(root ?? '').split(/[\\/]+/).filter(Boolean);
  const i = parts.lastIndexOf('cache');
  if (i < 1 || parts[i - 1] !== 'plugins' || parts.length !== i + 4) return null;
  const [marketplace, plugin] = parts.slice(i + 1, i + 3);
  return /^[\w.-]+$/.test(marketplace) && /^[\w.-]+$/.test(plugin) ? `${plugin}@${marketplace}` : null;
}

/** What `claude plugin update` did, read from its exit code and its words. */
export function updateOutcome({ exitCode, stdout = '', stderr = '' } = {}) {
  const text = `${stdout}\n${stderr}`;
  const moved = /updated from (\d+\.\d+\.\d+) to (\d+\.\d+\.\d+)/.exec(text);
  if (exitCode === 0 && moved) return { kind: 'updated', from: moved[1], to: moved[2] };
  if (exitCode === 0) return { kind: 'current' };
  const last = text.split('\n').map((l) => l.trim()).filter(Boolean).pop();
  return { kind: 'failed', reason: (last || `exit code ${exitCode}`).slice(0, 160) };
}

/** The note after an update. It loads in the next chat: Claude Code keeps the running chat on the copy it started with. */
export const updatedNote = ({ to }) => `AIsle updated to ${to}. It is active from your next chat.`;

/** The strip's words when updating keeps failing. */
export const failedLine = (reason) => `AIsle could not update itself: ${reason}`;
