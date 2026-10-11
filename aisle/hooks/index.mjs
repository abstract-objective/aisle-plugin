// The AIsle plugin's one hooks module: Claude Code loads one per plugin (`claude plugin validate` refuses a
// second, measured 2026-10-08), so every feature is registered here, each from its own file: the self-update
// (D48, update.mjs), the way back after a restart (D56, reopen.mjs) and "no AIsle tools here" (D69, link.mjs).
// Each draws its own strip above the chat box and passes to the next when it has nothing to show, in that
// order, so a chat never shows more than one of them at a time.
import { register as registerUpdate } from './update.mjs';
import { register as registerReopen } from './reopen.mjs';
import { register as registerLink } from './link.mjs';

export const register = (on, options) => {
  registerUpdate(on, options);
  // The newer features: nothing either does as it registers may stop the self-update, or the other, loading.
  try {
    registerReopen(on, options);
  } catch {
    // This chat has no way back.
  }
  try {
    registerLink(on, options);
  } catch {
    // This chat has no "no AIsle tools" strip; the skill's own line still says it.
  }
};
