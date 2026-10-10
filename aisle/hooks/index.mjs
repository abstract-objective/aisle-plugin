// The AIsle plugin's one hooks module: Claude Code loads one per plugin (`claude plugin validate` refuses a
// second, measured 2026-10-08), so both features are registered here, each from its own file: the
// self-update (D48, update.mjs) and the way back after a restart (D56, reopen.mjs). Each draws its own strip
// above the chat box and passes to the next when it has nothing to show, the self-update's first.
import { register as registerUpdate } from './update.mjs';
import { register as registerReopen } from './reopen.mjs';

export const register = (on, options) => {
  registerUpdate(on, options);
  // The way back is the newer feature, and nothing it does as it registers may stop the self-update loading.
  try {
    registerReopen(on, options);
  } catch {
    // This chat has the self-update and no way back.
  }
};
