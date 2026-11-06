// What the one yes decides (job su3, su2's path B), kept apart from Claude Code so node can test it. The module beside
// it, auto-update.mjs, runs inside Claude Code: it asks once per computer, "Keep AIsle up to date by itself?", and on
// yes writes Claude Code's own two switches into the person's Claude Code user settings. Claude Code then updates AIsle
// by itself in every chat, the desktop app's included, with no AIsle code in the loop (su2: the desktop app starts every
// chat with DISABLE_AUTOUPDATER=1, which FORCE_AUTOUPDATE_PLUGINS=1 overrides; measured 7 min 48 s after a chat's first
// message, 2.1.286). The plugin's own hourly self-update (D48, update.mjs) stays, for everyone who never says yes.
import { pluginIdFromRoot, dataFolderFromRoot, onWindows } from './update-rules.mjs';

export { pluginIdFromRoot, dataFolderFromRoot, onWindows };

/** The env switch that lets plugins update although the desktop app sets DISABLE_AUTOUPDATER=1 (env-vars docs). */
export const FORCE_KEY = 'FORCE_AUTOUPDATE_PLUGINS';
/** Where a marketplace's `autoUpdate` lives in settings, and the alias Claude Code 2.1.232+ also reads. */
export const MARKETPLACES_KEY = 'extraKnownMarketplaces';
export const MARKETPLACES_ALIAS = 'additionalMarketplaces';

/** The file in the plugin's data folder that holds the answer for this computer, one JSON line. */
export const ANSWER_FILE = 'auto-update';
/** The same answer in the plugin's store, so a data folder that cannot be written still keeps a No. */
export const ANSWER_KEY = 'autoUpdateAnswer';

/** How long after a chat opens it looks: after the self-update's check (3 s) and the way back's look. */
export const ASK_AFTER_MS = 8000;
/** While the question is up, how often it looks whether it was drawn, and whether another chat answered it. */
export const RECHECK_MS = 5000;
/** A question skipped (drawn, never answered) is shown once more, no sooner than a week later, and then never. */
export const ASK_AGAIN_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const ASKS_MOST = 2;
/** The surfaces that draw it: never the phone, which may be far from the computer whose settings change. */
export const DRAWS_ON = Object.freeze(['desktop', 'terminal', 'vscode']);
/** How long a rename may take before the write falls back to one in place. */
export const RENAME_TIMEOUT_MS = 30 * 1000;

/** The slash command that undoes the yes, registered only on a computer whose yes changed its settings. */
export const UNDO_COMMAND = 'aisle-auto-update-off';

// The words. The question says the side effect: every other marketplace set to auto-update updates too.
export const QUESTION = 'Keep AIsle up to date by itself? Yes adds two Claude Code settings on this computer, so Claude Code'
  + ' updates AIsle (and any other plugin set to auto-update) about 10 minutes after a chat starts. You can undo it any time.';
export const YES_LABEL = 'Yes, keep it updated';
export const NO_LABEL = 'No';
export const LATER_LABEL = 'Not now';
export const WORKING_LINE = 'Changing your Claude Code settings…';
export const DONE_LINE = `Done: Claude Code keeps AIsle up to date on this computer from your next chat. To undo it later, type /${UNDO_COMMAND}.`;
export const NO_NOTE = 'AIsle will not ask again on this computer. It still checks for its own updates every hour.';
export const UNDONE_LINE = 'Undone: both Claude Code settings are back as they were, and AIsle will not ask again on this computer.';
export const NOTHING_TO_UNDO = 'Nothing to undo: AIsle changed no Claude Code setting on this computer.';
export const UNDO_DESCRIPTION = 'Undo AIsle\'s one yes: put back the two Claude Code settings it added on this computer.';
export const refusedLine = (why) => `Nothing was changed: ${why}`;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const slashed = (p) => String(p ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
/** An absolute folder as $.fs takes it: a drive letter on Windows (never a network share), a leading / elsewhere. */
const absolute = (p, windows) => (windows ? /^[A-Za-z]:\//.test(p) : /^\/(?!\/)/.test(p));
const short = (text) => String(text ?? '').split(/\r?\n/).map((s) => s.trim()).find(Boolean)?.slice(0, 160) ?? '';

/** The marketplace part of `<plugin>@<marketplace>`. */
export const marketplaceOf = (id) => String(id ?? '').split('@')[1] ?? '';

/**
 * Claude Code's user settings file: `settings.json` in CLAUDE_CONFIG_DIR when it is set (a leading ~ is the home
 * folder, as computer-rules.mjs configFilesOf reads it), else `<home>/.claude/settings.json`. The home folder is the
 * one Claude Code itself takes (os.homedir): USERPROFILE on Windows, HOME elsewhere. Null when no absolute folder is
 * found: then AIsle cannot know which file is the person's, and never asks.
 */
export function userSettingsPath({ configDir, home, userProfile, windows } = {}) {
  const homes = windows ? [userProfile, home] : [home];
  const homeDir = homes.map(slashed).find((d) => absolute(d, windows)) ?? null;
  const set = String(configDir ?? '').trim();
  if (set) {
    const dir = slashed(homeDir ? set.replace(/^~(?=$|[\\/])/, homeDir) : set);
    return absolute(dir, windows) ? `${dir}/settings.json` : null;
  }
  return homeDir ? `${homeDir}/.claude/settings.json` : null;
}

/** The Claude Code config folder the plugin was installed in: the folder above `plugins/cache/...`, or null. */
export function configDirFromRoot(root) {
  if (!pluginIdFromRoot(root)) return null;
  const raw = String(root);
  const parts = raw.split(/[\\/]+/).filter(Boolean);
  return `${/^[\\/]/.test(raw) ? '/' : ''}${parts.slice(0, parts.lastIndexOf('cache') - 1).join('/')}`;
}

const sameFolder = (a, b, windows) => (windows ? slashed(a).toLowerCase() === slashed(b).toLowerCase() : slashed(a) === slashed(b));

/**
 * The one file the yes may change, `{ path, known }` (`known` is Claude Code's list of marketplaces beside it), or
 * `{ why }`. Only the user settings of the Claude Code this plugin runs in: the file must sit in the folder the plugin
 * was installed under, so a CLAUDE_CONFIG_DIR that moved, or a home that is not Claude Code's, is refused rather than
 * guessed. Never managed or enterprise settings, never a project's settings, never settings.local.json.
 */
export function settingsTarget({ root, configDir, home, userProfile } = {}) {
  const windows = onWindows(root);
  const installed = configDirFromRoot(root);
  if (!installed) return { why: 'this copy of AIsle was not installed from a marketplace, so Claude Code cannot update it' };
  const path = userSettingsPath({ configDir, home, userProfile, windows });
  if (!path) return { why: 'no home folder or CLAUDE_CONFIG_DIR was found, so AIsle cannot tell which settings are yours' };
  if (!sameFolder(path.slice(0, -'/settings.json'.length), installed, windows)) {
    return { why: `AIsle is installed under ${installed}, not beside ${path}, so AIsle cannot tell which settings are yours` };
  }
  return { path, known: `${installed}/plugins/known_marketplaces.json` };
}

/**
 * A settings file's text read for a merge: `{ ok: true, settings, style }`, or `{ ok: false, why }` for one that is not
 * a JSON object, which is never written. A missing file (null) is `{}`, and so is an empty one. `style` keeps how the
 * file is written (byte-order mark, line ends, indent, last newline), so the merge changes the two keys and no more.
 */
export function readSettings(text) {
  const fresh = { bom: false, eol: '\n', indent: '  ', finalNewline: true };
  if (text === null || text === undefined) return { ok: true, settings: {}, style: fresh, missing: true };
  const raw = String(text);
  const bom = raw.startsWith('\uFEFF');
  const body = bom ? raw.slice(1) : raw;
  if (!body.trim()) return { ok: true, settings: {}, style: { ...fresh, bom } };
  let value;
  try {
    value = JSON.parse(body);
  } catch (err) {
    return { ok: false, why: `it is not valid JSON (${short(err?.message ?? err)}). Fix it, then try again.` };
  }
  if (!isObject(value)) return { ok: false, why: 'it does not hold a JSON object. Fix it, then try again.' };
  const indent = /^([ \t]+)"/m.exec(body)?.[1] ?? '  ';
  return { ok: true, settings: value, style: { bom, eol: /\r\n/.test(body) ? '\r\n' : '\n', indent: indent.slice(0, 10), finalNewline: /\n$/.test(body) } };
}

/** Settings written back in the file's own style. */
export function settingsText(settings, style) {
  const text = JSON.stringify(settings, null, style.indent);
  return `${style.bom ? '\uFEFF' : ''}${style.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text}${style.finalNewline ? style.eol : ''}`;
}

/** Where the marketplace's entry is: the key that holds it (the alias only when it alone has it), the group, the entry. */
function marketplaceEntry(settings, marketplace) {
  for (const key of [MARKETPLACES_KEY, MARKETPLACES_ALIAS]) {
    const group = settings?.[key];
    if (isObject(group) && Object.hasOwn(group, marketplace)) return { key, group, entry: group[marketplace] };
  }
  return { key: MARKETPLACES_KEY, group: settings?.[MARKETPLACES_KEY], entry: undefined };
}

/** Claude Code reads an env switch as on for 1, true, yes or on. */
const switchedOn = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());

/** Which of the two switches these settings already have on. */
export function autoUpdateOn(settings, marketplace) {
  const env = isObject(settings?.env) && switchedOn(settings.env[FORCE_KEY]);
  const { entry } = marketplaceEntry(settings, marketplace);
  const market = isObject(entry) && entry.autoUpdate === true;
  return { env, marketplace: market, both: env && market };
}

/** The marketplace's `source` in Claude Code's own list (known_marketplaces.json), for settings that lack the entry. */
export function knownSource(text, marketplace) {
  try {
    const list = JSON.parse(String(text ?? ''));
    return isObject(list?.[marketplace]?.source) ? list[marketplace].source : null;
  } catch {
    return null;
  }
}

const refused = (why) => ({ kind: 'refused', why });

/**
 * The yes, as a plan for the settings file's text: `{ kind: 'write', text, settings, before }`, `{ kind: 'already' }`
 * when both switches are on, or `{ kind: 'refused', why }`. Only `env.FORCE_AUTOUPDATE_PLUGINS` and the marketplace
 * entry's `autoUpdate` change; every other key stays, in its place. An entry the settings lack is added with the
 * `source` Claude Code's own list has for it, as an entry needs one (settings reference). `before` is what undo puts back.
 */
export function planYes(text, { marketplace, knownSource: source } = {}) {
  const read = readSettings(text);
  if (!read.ok) return refused(read.why);
  const s = read.settings;
  if (!marketplace) return refused('AIsle could not tell its own marketplace');
  if (s.env !== undefined && !isObject(s.env)) return refused('its "env" is not an object. Fix it, then try again.');
  const at = marketplaceEntry(s, marketplace);
  if (at.group !== undefined && !isObject(at.group)) return refused(`its "${at.key}" is not an object. Fix it, then try again.`);
  if (at.entry !== undefined && !isObject(at.entry)) return refused(`its "${at.key}" entry "${marketplace}" is not an object. Fix it, then try again.`);
  const on = autoUpdateOn(s, marketplace);
  if (on.both) return { kind: 'already' };
  if (!on.marketplace && at.entry === undefined && !isObject(source)) {
    return refused(`AIsle's marketplace "${marketplace}" is in neither these settings nor Claude Code's list of marketplaces`);
  }
  const before = {
    changed: { env: !on.env, marketplace: !on.marketplace },
    env: { object: isObject(s.env), has: isObject(s.env) && Object.hasOwn(s.env, FORCE_KEY), value: s.env?.[FORCE_KEY] ?? null },
    marketplace: {
      key: at.key, group: isObject(at.group), entry: at.entry !== undefined,
      has: isObject(at.entry) && Object.hasOwn(at.entry, 'autoUpdate'), value: at.entry?.autoUpdate ?? null,
    },
  };
  // A key set again keeps its place in the object; one that was not there goes last.
  const next = { ...s };
  if (!on.env) next.env = { ...(s.env ?? {}), [FORCE_KEY]: '1' };
  if (!on.marketplace) {
    next[at.key] = { ...(at.group ?? {}), [marketplace]: at.entry !== undefined ? { ...at.entry, autoUpdate: true } : { source, autoUpdate: true } };
  }
  return { kind: 'write', text: settingsText(next, read.style), settings: next, before };
}

/**
 * The undo, as a plan: each switch the yes changed goes back to what `before` says it was (removed where it was not
 * there, and an `env` or marketplace group the yes made goes once it is empty), but only while it still holds the
 * value the yes set: one the person changed since is theirs. `{ kind: 'write', text, settings }`, `{ kind: 'nothing' }`
 * or `{ kind: 'refused', why }`.
 */
export function planUndo(text, before, { marketplace } = {}) {
  if (!isObject(before?.changed) || !marketplace) return { kind: 'nothing' };
  const read = readSettings(text);
  if (!read.ok) return refused(read.why);
  const s = read.settings;
  const next = { ...s };
  let changed = false;
  if (before.changed.env && isObject(s.env) && s.env[FORCE_KEY] === '1') {
    const env = { ...s.env };
    if (before.env?.has) env[FORCE_KEY] = before.env.value;
    else delete env[FORCE_KEY];
    if (!before.env?.object && Object.keys(env).length === 0) delete next.env;
    else next.env = env;
    changed = true;
  }
  const key = before.marketplace?.key === MARKETPLACES_ALIAS ? MARKETPLACES_ALIAS : MARKETPLACES_KEY;
  const group = s[key];
  if (before.changed.marketplace && isObject(group) && isObject(group[marketplace]) && group[marketplace].autoUpdate === true) {
    const g = { ...group };
    if (before.marketplace.entry) {
      const entry = { ...group[marketplace] };
      if (before.marketplace.has) entry.autoUpdate = before.marketplace.value;
      else delete entry.autoUpdate;
      g[marketplace] = entry;
    } else {
      delete g[marketplace];
    }
    if (!before.marketplace.group && Object.keys(g).length === 0) delete next[key];
    else next[key] = g;
    changed = true;
  }
  return changed ? { kind: 'write', text: settingsText(next, read.style), settings: next } : { kind: 'nothing' };
}

/** The settings with both switches taken out, so two versions can be compared on everything else. */
function withoutSwitches(settings, marketplace) {
  const s = JSON.parse(JSON.stringify(settings ?? {}));
  if (isObject(s.env)) {
    delete s.env[FORCE_KEY];
    if (Object.keys(s.env).length === 0) delete s.env;
  }
  for (const key of [MARKETPLACES_KEY, MARKETPLACES_ALIAS]) {
    const entry = s[key]?.[marketplace];
    if (isObject(entry)) delete entry.autoUpdate;
  }
  return s;
}

/**
 * Whether `after` differs from `before` in nothing but the two switches (and the entry a yes adds for its marketplace),
 * every other key the same and in the same order. The module checks its plan with it before it writes anything.
 */
export function onlyTheSwitches(before, after, marketplace) {
  const a = withoutSwitches(before, marketplace);
  const b = withoutSwitches(after, marketplace);
  for (const key of [MARKETPLACES_KEY, MARKETPLACES_ALIAS]) {
    // An entry the yes added, or the undo took away, holds only its source once its switch is out.
    for (const [x, y] of [[a, b], [b, a]]) {
      if (isObject(x[key]) && Object.hasOwn(x[key], marketplace) && !(isObject(y[key]) && Object.hasOwn(y[key], marketplace))) {
        const extra = x[key][marketplace];
        if (!isObject(extra) || Object.keys(extra).some((k) => k !== 'source')) return false;
        delete x[key][marketplace];
        if (Object.keys(x[key]).length === 0 && !Object.hasOwn(y, key)) delete x[key];
      }
    }
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Whether a file's text, read back, is exactly the settings meant: the same keys, values and order. */
export function readsBackAs(text, settings) {
  const read = readSettings(text);
  return read.ok && JSON.stringify(read.settings) === JSON.stringify(settings);
}

/** Where the backup of `path` goes, first choice first: `settings.json.aisle-backup-<date>`, then `-2` to `-9`. */
export function backupPaths(path, now) {
  const t = Number(now);
  const day = Number.isFinite(t) && t > 0 ? new Date(t).toISOString().slice(0, 10) : 'unknown-date';
  return Array.from({ length: 9 }, (_, i) => `${path}.aisle-backup-${day}${i ? `-${i + 1}` : ''}`);
}

/** The new text is written here first, then renamed over the settings file. */
export const tempPath = (path) => `${path}.aisle-tmp`;

/**
 * The rename of the temp file over the settings file, as a command: `$.fs` writes but does not rename. On Windows,
 * Windows PowerShell's File.Replace (File.Move where there is no file yet), the paths in the environment so nothing is
 * quoted; elsewhere mv. `{ argv, env }`.
 */
export const RENAME_SCRIPT = "$ErrorActionPreference = 'Stop'; try { if (Test-Path -LiteralPath $env:AISLE_TO) {"
  + ' [System.IO.File]::Replace($env:AISLE_FROM, $env:AISLE_TO, [NullString]::Value) } else {'
  + ' [System.IO.File]::Move($env:AISLE_FROM, $env:AISLE_TO) }; exit 0 } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }';

export function renameCommand(from, to, { windows, systemRoot } = {}) {
  if (!windows) return { argv: ['/bin/mv', '-f', from, to], env: {} };
  const root = String(systemRoot || 'C:\\Windows').replace(/[\\/]+$/, '');
  const win = (p) => String(p).replace(/\//g, '\\');
  return {
    argv: [`${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, '-NoProfile', '-NonInteractive', '-Command', RENAME_SCRIPT],
    env: { AISLE_FROM: win(from), AISLE_TO: win(to) },
  };
}

// The answer, kept for the computer: `{ answer: 'asked' | 'yes' | 'no', ... }`. 'asked' is a question drawn and not
// answered, with how many times and when last; yes and no are final, and so is a record AIsle cannot read.

/** An answer file's or store value's record, `{ answer: 'unknown' }` for one that cannot be read, or null for none. */
export function readAnswer(value) {
  if (value === null || value === undefined || value === '') return null;
  let r = value;
  if (typeof value === 'string') {
    try {
      r = JSON.parse(value);
    } catch {
      return { answer: 'unknown' };
    }
  }
  return isObject(r) && ['asked', 'yes', 'no'].includes(r.answer) ? r : { answer: 'unknown' };
}

/** The answer that stands, from the data folder's file and the store's copy: a final one first, else the most asks. */
export function standingAnswer(file, stored) {
  const a = readAnswer(file);
  const b = readAnswer(stored);
  const final = [a, b].find((r) => r && r.answer !== 'asked');
  if (final) return final;
  if (a && b) return (Number(b.asks) || 0) > (Number(a.asks) || 0) ? b : a;
  return a ?? b;
}

/** Whether a chat may ask now: never asked, or skipped once and a week has gone by. Yes and No never ask again. */
export function shouldAsk(record, now) {
  if (!record) return true;
  if (record.answer !== 'asked') return false;
  const asks = Number(record.asks) || 0;
  const at = Number(record.shownAt) || 0;
  return asks < ASKS_MOST && at > 0 && now >= at + ASK_AGAIN_AFTER_MS;
}

/** The record once the question was drawn in a chat. */
export const shownRecord = (record, now) => ({ answer: 'asked', asks: (Number(record?.asks) || 0) + 1, shownAt: Number(now) });

/** A final answer's record: yes or no, with its date and what it did. */
export const answerRecord = (answer, now, more = {}) => ({ answer, date: new Date(Number(now) || 0).toISOString(), ...more });

/** The answer file's text: one JSON line. */
export const answerText = (record) => `${JSON.stringify(record)}\n`;
