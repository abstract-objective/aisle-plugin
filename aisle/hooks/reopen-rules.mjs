// What the AIsle plugin's way back after a restart decides (D56), kept apart from Claude Code so node can test
// it. The module beside it, reopen.mjs, runs inside Claude Code: it reads the plugin's own data folder, the
// one listen.sh keeps, checks that each folder named there is still on the computer, and shows the strip, on
// the desktop only. Nothing here or there reaches the network.
//
// The beat says that a loop stopped, never why: an app that closed and a chat closed or archived on purpose
// look the same. So the strip says only that the folder stopped listening, and in 0.3.8 it shows only in the
// desktop app (D56): in the terminal, where every chat ends by someone's own exit, it would follow each one.
//
// What listen.sh keeps, per folder, in <data>/folders/<id>/: `answered` once the folder said yes, `stopped`
// once it said stop, `refused` when the room no longer knows its token, `role` ("reporter" when the room
// listens through another folder), `helper` (the session id of the chat that listens), `path` (the folder),
// and `beat`, the time in seconds its listening loop last went round. In <data>/ itself, `after-<session>`
// is written just before a loop ends to wake its chat with a message.
import { pluginIdFromRoot } from './update-rules.mjs';

/** A beat older than this means the loop stopped: one turn of it takes 60 s at most (a 40 s poll, a 20 s wait). */
export const STALE_MS = 120 * 1000;

/**
 * A loop ends when it wakes its chat with a message, and the chat starts it again when that reply ends. A
 * reply up to this long is taken for one still being written, not for a chat that closed.
 */
export const ANSWERING_MS = 30 * 60 * 1000;

/**
 * Reopening a stopped folder's chat by itself, with no press (D56, question 2: Ofir decides). Off: a window
 * that opens unasked is the surprise D47 is against, and starting a session on someone's computer is theirs.
 */
export const AUTO_REOPEN = false;

/** How long after a chat opens the module looks, so the first prompt never waits on it (as the self-update does). */
export const LOOK_AFTER_MS = 3000;

/** How long Reopen may run: the system hands the link to the desktop app and ends. */
export const REOPEN_TIMEOUT_MS = 15 * 1000;

/**
 * The desktop app's own link to a chat: the one `claude --desktop --resume <id>` opens. That command cannot do
 * it from here: it refuses to run when its output is captured, as every command a hooks module runs is ("can't
 * run non-interactively (... or redirected output)", Claude Code 2.1.286, seen 2026-10-09, which is how 0.3.8's
 * Reopen failed). Opened on Ofir's PC on 2026-10-09, it switched the app to that folder's chat and made no
 * copy of it. Null for anything but a session id, so nothing else ever reaches the link.
 */
export function resumeLink(session) {
  const id = String(session ?? '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? `claude://resume?session=${id}` : null;
}

/**
 * The command that hands a link to the app that registered it, as Claude Code does for `--desktop`: on Windows,
 * rundll32's FileProtocolHandler, by its full path (it opens no window of its own); elsewhere `open`.
 */
export function openLinkCommand(link, windows, systemRoot) {
  if (!windows) return ['open', link];
  const root = String(systemRoot || 'C:\\Windows').replace(/[\\/]+$/, '');
  return [`${root}\\System32\\rundll32.exe`, 'url.dll,FileProtocolHandler', link];
}

/** A failure's reason in one short line: its first line, at most 160 characters. */
export function shortReason(text) {
  const line = String(text ?? '').split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? '';
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

/** While a strip is up, how often it looks again, so it goes as soon as that folder listens again. */
export const RECHECK_MS = 20 * 1000;

/** The most folders the store remembers an answer for. */
const REMEMBERED = 200;

/** Whether a surface draws the strip: the desktop app only (D56, 0.3.8). */
export const drawsOn = (surface) => surface === 'desktop';

/**
 * Whether a chat looks at all, from the surfaces it is on: one on the desktop does, and one that names none
 * (Claude Code may not know yet) looks and leaves it to the drawing. The terminal, the editor and the phone
 * alone never do, so they read nothing and keep no timer.
 */
export const looksIn = (surfaces) => !Array.isArray(surfaces) || surfaces.length === 0 || surfaces.some(drawsOn);

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

/** A folder as this computer opens it: on Windows, Git Bash's `/c/...` is `C:/...`. */
export function hostPath(p, windows) {
  const s = String(p ?? '').trim();
  const git = windows ? /^\/([A-Za-z])(\/.*)?$/.exec(s) : null;
  return git ? `${git[1].toUpperCase()}:${git[2] ?? '/'}` : s;
}

/** One spelling of a folder, to tell whether two name the same one: either slash, no trailing one, and any case on Windows. */
export function samePlace(a, b) {
  const key = (p) => {
    let s = hostPath(String(p ?? '').replace(/\\/g, '/'), true).replace(/\/+/g, '/');
    if (!/^[A-Za-z]:\/$/.test(s) && s !== '/') s = s.replace(/\/$/, '');
    return /^[A-Za-z]:/.test(s) ? s.toLowerCase() : s;
  };
  const x = key(a);
  return x !== '' && x === key(b);
}

/** The folder's name in the strip: the last part of its path, without anything that cannot be printed. */
export function folderName(p) {
  const last = String(p ?? '').split(/[\\/]+/).filter(Boolean).at(-1) ?? '';
  return last.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 80);
}

/** The listening chat's session id, as listen.sh writes it: letters, digits and dashes. Null for anything else. */
export function sessionIdFrom(text) {
  const s = String(text ?? '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9-]{7,127}$/.test(s) ? s : null;
}

/** The beat's time in seconds, or null when the file says anything else. */
export function beatSeconds(text) {
  const s = String(text ?? '').trim();
  return /^[0-9]{1,12}$/.test(s) ? Number(s) : null;
}

/**
 * The offer for one folder, or null. `folder` is what the module read: its id, `files` (each file's name and
 * modification time, from one listing), the texts of `helper`, `path`, `beat` and `role`, and whether its
 * path is there now. `ctx` is this chat: `now`, its `cwd` and `sessionId`, `answering` (the time each
 * `after-<session>` was written) and `answered` (what the store keeps of the offers answered).
 */
export function offerFor(folder, ctx) {
  const f = folder ?? {};
  const files = f.files && typeof f.files === 'object' ? f.files : {};
  if (!/^[0-9a-f]{16}$/.test(String(f.id ?? ''))) return null;
  // A folder that said yes, and neither stop since nor was refused by the room.
  if (!('answered' in files) || 'stopped' in files || 'refused' in files) return null;
  // The room listens through another folder: this one only reports, and has no loop to bring back.
  if (String(f.role ?? '').trim() === 'reporter') return null;
  const helper = sessionIdFrom(f.helper);
  if (!helper || helper === ctx.sessionId) return null;
  const path = String(f.path ?? '').trim();
  // A whole path, there now, and (case A) not the folder of the chat that is opening, which starts listening
  // there by itself (listen.sh).
  if (!/^([A-Za-z]:[\\/]|\/)/.test(path) || f.pathExists !== true || samePlace(path, ctx.cwd)) return null;
  // No beat is not a stopped loop: a chat started before 0.3.8 runs a loop that writes none.
  const beat = beatSeconds(f.beat);
  if (beat === null) return null;
  const stoppedAt = beat * 1000;
  if (!(ctx.now - stoppedAt > STALE_MS)) return null;
  // A chat that took listening over a moment ago is starting its loop.
  if (!(ctx.now - Number(files.helper) >= STALE_MS)) return null;
  // The loop ended to wake its chat, which is still answering: its after-<session> came after its last beat.
  // Compared with the beat file's own time, in ms: the loop also writes after-<session> and then, in the same
  // second, the next turn's beat (a chat's first look, its own post), and the beat's text is whole seconds.
  const woke = Number(ctx.answering?.[helper]);
  const beatAt = Number(files.beat);
  if (woke > (Number.isFinite(beatAt) && beatAt > 0 ? beatAt : stoppedAt) && ctx.now - woke < ANSWERING_MS) return null;
  // Once per stop: an answer holds until the folder has listened again and stopped again.
  const key = String(beat);
  const answered = ctx.answered && typeof ctx.answered === 'object' ? ctx.answered : {};
  if (answered[f.id] === key) return null;
  const name = folderName(path);
  if (!name) return null;
  return { id: f.id, helper, path, name, key, stoppedAt };
}

/** Every folder to offer, newest stop first: the strip shows one at a time. */
export function offers(folders, ctx) {
  const list = [];
  for (const f of Array.isArray(folders) ? folders : []) {
    try {
      const o = offerFor(f, ctx);
      if (o) list.push(o);
    } catch {
      // A folder that cannot be read has nothing to offer.
    }
  }
  return list.sort((a, b) => b.stoppedAt - a.stoppedAt || (a.id < b.id ? -1 : 1));
}

/** What the store keeps once an offer is answered (Reopen or Not now): this stop, for this folder, in every chat. */
export function remember(answered, offer) {
  const was = answered && typeof answered === 'object' && !Array.isArray(answered) ? answered : {};
  const kept = Object.entries(was).filter(([id, key]) => id !== offer.id && /^[0-9a-f]{16}$/.test(id) && typeof key === 'string');
  return Object.fromEntries([...kept.slice(-(REMEMBERED - 1)), [offer.id, offer.key]]);
}

/**
 * Whether the folder listens again since the offer: a new beat, and a fresh one. After a Reopen it says the
 * person sent that chat a message and its loop runs; while the sidebar line is up, that they opened it some other way.
 */
export function listeningAgain(beatText, offer, now) {
  const beat = beatSeconds(beatText);
  return beat !== null && String(beat) !== offer.key && now - beat * 1000 <= STALE_MS;
}

// The desktop app starts a chat's Claude Code only when someone sends that chat a message: opening it, from the
// sidebar or by its link, shows it and starts nothing (seen 2026-10-09: Reopen switched the app to the right chat,
// and its listening began only once Ofir typed there). So every line says the one thing that starts it, and says
// it before the press, since the app shows the other chat the moment Reopen is pressed.

/** The strip. It says what the beat knows, that the folder stopped listening, and not why. */
export const askLine = (name) => `AIsle: ${name} stopped listening to the room. Reopen its chat? Any message there starts it again.`;

/** While Reopen runs. */
export const openingLine = (name) => `AIsle: opening the chat for ${name}…`;

/** Once Reopen went through: the note, and the strip until that folder listens again. */
export const openedNote = (name) => `AIsle: send any message in the chat for ${name}, and it starts listening again.`;

/** The one thing to do when Reopen failed. */
export const sidebarLine = (name) => `AIsle: open the chat for ${name} from the sidebar and send it any message; it starts listening then.`;

/** One dim line in the chat's transcript, never sent to Claude, saying why a Reopen did not open the chat. */
export const failedNote = (name, why) => `AIsle: Reopen did not open the chat for ${name}${why ? ` (${why})` : ''}.`;
