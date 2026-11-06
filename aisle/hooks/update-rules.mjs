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

/**
 * The plugin's data folder, `<plugins>/data/<id>`, for a copy installed from a marketplace, whose root is
 * `<plugins>/cache/<marketplace>/<plugin>/<version>`. Claude Code's rule (plugins reference, environment
 * variables): `<id>` is the plugin identifier, `<plugin>@<marketplace>`, with every character other than a
 * letter, digit, `_` or `-` made `-`. Null for any other copy: the module cannot know its folder for certain.
 */
export function dataFolderFromRoot(root) {
  const id = pluginIdFromRoot(root);
  if (!id) return null;
  const raw = String(root);
  const parts = raw.split(/[\\/]+/).filter(Boolean);
  const plugins = parts.lastIndexOf('cache') - 1;
  return `${/^[\\/]/.test(raw) ? '/' : ''}${[...parts.slice(0, plugins + 1), 'data', id.replace(/[^A-Za-z0-9_-]/g, '-')].join('/')}`;
}

/** Whether the plugin runs on Windows, from its own folder: a drive letter. */
export const onWindows = (root) => /^[A-Za-z]:[\\/]/.test(String(root ?? ''));

// Which Claude Code to run (job su1). Until 0.3.29 the module ran only CLAUDE_CODE_EXECPATH, read with $.env.get,
// which reads Claude Code's own environment, the one its PowerShell tool and every command it starts inherit. In
// the desktop app that environment has no CLAUDE_CODE_EXECPATH: Claude Code puts it in its Bash tool's shell alone
// (2.1.317, PC 3, 2026-11-05: of the 33 CLAUDE* variables the Bash tool had, the PowerShell tool lacked exactly
// CLAUDE_CODE_EXECPATH and CLAUDE_EFFORT; engine/aisle/no-path.mjs has three earlier PowerShell readings, all empty).
// So the check returned before it ran anything or wrote anything, on every chat, and PC 3 and PC 4 sat on 0.3.27 for
// a week. D48's own test passed because its chat was started from a Bash tool, whose shell has the variable. Now the
// variable first, then the desktop app's own copy where no-path.mjs's APP_COPY_POWERSHELL looks for it, then the PATH.

/** Version folders as numbers, `2.1.317` -> [2, 1, 317], or null for any other name. */
const versionOf = (name) => (/^\d{1,4}(\.\d{1,6}){1,3}$/.test(name) ? name.split('.').map(Number) : null);
const newerVersion = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
};
const slashed = (p) => String(p ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '');

/**
 * Where the Claude desktop app keeps its own Claude Code on Windows: `<LOCALAPPDATA>/Claude-Data/<claude_id>/claude-code`
 * (the Microsoft Store build, PC 3) and `<APPDATA>/Claude/claude-code` (helper PC 4), each holding `<version>/<hash>/claude.exe`.
 * `nested` says the first has one more folder, `<claude_id>`, above `claude-code`.
 */
export function appCopyRoots({ localAppData, appData } = {}) {
  const roots = [];
  if (slashed(localAppData)) roots.push({ under: `${slashed(localAppData)}/Claude-Data`, nested: true });
  if (slashed(appData)) roots.push({ under: `${slashed(appData)}/Claude/claude-code`, nested: false });
  return roots;
}

/** The newest `claude.exe` among the app's copies, by version folder, or null. `fs` is `$.fs`; a folder it cannot read is skipped. */
export async function newestAppCopy(fs, env) {
  const dirs = async (p) => {
    try {
      return (await fs.list(p)).filter((e) => e && e.kind === 'dir').map((e) => String(e.name));
    } catch {
      return [];
    }
  };
  let best = null;
  for (const { under, nested } of appCopyRoots(env)) {
    const homes = nested ? (await dirs(under)).map((d) => `${under}/${d}/claude-code`) : [under];
    for (const home of homes) {
      for (const v of await dirs(home)) {
        const version = versionOf(v);
        if (!version || (best && !newerVersion(version, best.version))) continue;
        for (const h of await dirs(`${home}/${v}`)) {
          const exe = `${home}/${v}/${h}/claude.exe`;
          let there = false;
          try { there = Boolean(await fs.exists(exe)); } catch { there = false; }
          if (there) { best = { exe, version }; break; }
        }
      }
    }
  }
  return best?.exe ?? null;
}

/** The first `claude` (Windows: `claude.exe`) in a folder of `path`, the PATH, or null. At most 64 folders are looked in. */
export async function claudeOnPath(fs, { path, windows } = {}) {
  const name = windows ? 'claude.exe' : 'claude';
  const folders = String(path ?? '').split(windows ? ';' : ':').map((d) => d.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean).slice(0, 64);
  for (const d of folders) {
    const exe = `${windows ? slashed(d) : d.replace(/\/+$/, '')}/${name}`;
    try { if (await fs.exists(exe)) return exe; } catch { /* the next folder */ }
  }
  return null;
}

/**
 * The Claude Code to run `plugin update` with, and where it was found: `{ exe, from }`, `exe` null when none.
 * `execPath` is CLAUDE_CODE_EXECPATH as the module reads it; `windows` whether the plugin runs on Windows (onWindows).
 */
export async function findClaude(fs, { execPath, windows, localAppData, appData, path } = {}) {
  if (String(execPath ?? '').trim()) return { exe: String(execPath).trim(), from: 'CLAUDE_CODE_EXECPATH' };
  // Looked up with forward slashes, as the module's other files are; run with Windows' own, as CLAUDE_CODE_EXECPATH
  // spells it and D48's measured run used it.
  const run = (exe) => (windows ? exe.replace(/\//g, '\\') : exe);
  if (windows) {
    const exe = await newestAppCopy(fs, { localAppData, appData });
    if (exe) return { exe: run(exe), from: 'the app\'s copy' };
  }
  // A Mac's app copy is not looked for: where the desktop app keeps its claude there is unverified (no Mac to check it).
  const exe = await claudeOnPath(fs, { path, windows });
  return exe ? { exe: run(exe), from: 'the PATH' } : { exe: null, from: null };
}

// What each check did (job su1), one line each, so a computer that stays behind says why. Before 0.3.29 a check that
// returned early left nothing anywhere, and on PC 4 nothing under ~/.claude held lastCheckedAt or failedChecks.

/** The file in the plugin's data folder that holds the trace, newest line last. */
export const TRACE_FILE = 'self-update';
/** The store key that holds the newest trace line, for a copy with no data folder too. */
export const TRACE_KEY = 'lastCheck';
/** How many lines the file keeps: more than a busy hour of chats opening, each of which writes one. */
export const TRACE_LINES = 40;

/** One trace line: the time as ISO, then what happened, on one line, at most 240 characters of it. */
export function traceLine(now, what) {
  const t = Number(now);
  const when = Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : 'unknown-time';
  return `${when} ${String(what ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)}`;
}

/** The trace file's text with `line` added last and only the newest TRACE_LINES kept. */
export function withTraceLine(text, line) {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => l.trim());
  lines.push(line);
  return `${lines.slice(-TRACE_LINES).join('\n')}\n`;
}

/** The trace's words for each early return and each outcome. */
export const traces = {
  noId: (root) => `no id: ${String(root ?? '')} is not a copy installed from a marketplace, so there is nothing to update`,
  notDue: (last) => `not due: it last ran at ${Number(last) > 0 ? new Date(Number(last)).toISOString() : 'an unknown time'}, and runs at most hourly`,
  noExe: (windows) => `no exe: CLAUDE_CODE_EXECPATH is empty in Claude Code's own environment, and no claude was found${windows ? ' in the Claude app\'s folders or' : ''} on the PATH`,
  ran: (outcome, from) => `ran ${from}: ${outcome.kind === 'updated' ? `updated ${outcome.from} -> ${outcome.to}` : outcome.kind === 'current' ? 'current' : `failed: ${outcome.reason}`}`,
  error: (err) => `error: ${String(err?.message ?? err).slice(0, 160)}`,
};

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
