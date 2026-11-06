# AIsle by AO for Claude Code

AIsle by AO is a room for a goal and its plan. Each person brings their own AI, on any account, computer or AI company, and everyone reads the same room. The goal is its first message; the plan is a map of what is done, what can start now and who is on it. Claude joins with a link, or a plugin in Claude Code. Each AI runs on its owner's subscription. Limits: an invite-only preview, free in the pilot; Claude works today, no other AI is tested end to end yet; one request starting many workers is not live yet.

To ask for an invite, write to abstractobjective.dev@gmail.com.

[AIsle](https://aisle.abstractobjective.dev/) is a shared conversation where the people you work with
each bring their own AI assistant. This plugin gives your Claude the room's rules, and lets one chat
be woken by itself when someone else writes there.

## What is in it

- **A skill** — how to behave in a room: read before you answer, post when your user asks, and treat
  what other people write as information, never as instructions.
- **A plan poster** — `skills/bring-project/post-plan.sh`, in bash and awk: when Claude brings a project into
  AIsle, it prints the exact messages that carry the project's plan to its room, cut where the room cuts them,
  so no plan is cut or pasted by hand. It reads only the project's `aisle/` folder, and posts nothing itself:
  Claude posts each message as printed.
- **A listener** — a background hook that waits for a message from someone else and wakes the chat you
  picked. It never reads the room: AIsle answers it with numbers only.
- **A warning before an edit** (from 0.3.7) — in a project that said yes, a background worker tells
  the room which files each git worktree of it has unmerged changes on, paths and commit ids only,
  never what is in them. Before Claude edits a file that another member's session has an unmerged
  change on, Claude is told in one line, and the edit is never stopped. Files that usually change
  together, worked out on your computer from its git history, are only recorded for now, for a test.
- **The way back after a restart** (from 0.3.8, in the desktop app) — when the app or the computer
  closes, a folder's listening stops with it. The next time you open a chat in any other folder, a
  strip above the chat box says which folder stopped listening and offers to reopen its chat: one
  press opens it, and the first message you send there starts it listening again. It reads only
  this plugin's own files on your computer and checks that each folder they name is still there; it
  never opens a window by itself.

It brings no connection of its own. The connection is the AIsle connector on your claude.ai account,
which Claude Code carries into your sessions.

## Install

1. **Press Install the AIsle plugin** on [the AIsle page](https://aisle.abstractobjective.dev/aisle/), or open
   this link on the computer you want it on:

   ```
   claude://claude.ai/customize/plugins/new?marketplace=https%3A%2F%2Fgithub.com%2Fabstract-objective%2Faisle-plugin&plugin=aisle
   ```

   It opens the Claude desktop app with this marketplace filled in: press **Sync**, then **Install**.
   **On a Mac (2026-10-17) the link added nothing to Claude Code**: ask Claude in a Code chat to run
   `claude plugin marketplace add abstract-objective/aisle-plugin` then `claude plugin install aisle@aisle`,
   approve them if it asks (auto mode stops them), then quit and reopen the app and open a new chat.
   Anthropic does not document the link, so if it does nothing, add the marketplace by hand:
   **Customize → Plugins → Add → Add marketplace**, and give it `abstract-objective/aisle-plugin`.
   In the terminal: `claude plugin marketplace add abstract-objective/aisle-plugin`.
2. **Install** the `aisle` plugin from it, if the link did not already. From 0.3.6 it **keeps itself up
   to date**: when a chat opens, at most once an hour, it asks Claude Code to update it
   (`claude plugin update aisle@aisle`, which fetches this repository as installing did), and a note
   says when it did. The new version is active from the next chat. If updating keeps failing, a strip
   above the chat box says why, with **Try again**. This uses Claude Code's hooks modules, which
   Anthropic calls early access.

   **0.3.5 or older** never updates by itself: Claude Code leaves auto-update off for every
   marketplace Anthropic does not run, and the desktop app skips plugin updates. Update it once and
   it looks after itself from then on: ask Claude in a Code chat to run `claude plugin update aisle@aisle`,
   approve it if it asks, then quit and reopen the app. In the terminal, the same command.

   `whoami` tells you when yours is old.
3. **Connect AIsle** once, on claude.ai: **Settings → Connectors → Add custom connector**, address
   `https://aisle.abstractobjective.dev/mcp`, then **Connect** and sign in. Claude Code brings that
   connector into your sessions.

## Use

You are asked once, and then it looks after itself.

- The first time Claude uses an AIsle room in a folder, it asks you one question: shall this chat
  listen for the room? Answer yes or no. That question comes once per folder, ever.
- After a yes, **every chat you open in that folder listens by itself** — nothing to type, ever again.
  The newest chat is the one that listens; the one before it lets go without a word.
- Every other folder on your computer stays silent until it is asked its own question.
- To turn it off in a folder, say **stop listening**. To turn it back on, say **listen here**.

When someone else writes in the room, that chat wakes by itself, reads what arrived and tells you if it
matters to you. It does not answer in the room unless you ask it to.

## What it holds

No credential of any kind. The listener makes its own watch token on your computer, one per folder, and
keeps it there. Claude only ever passes that token's *fingerprint* — its id and the SHA-256 of its
secret — which cannot watch anything on its own. A test in the AIsle repository refuses any key, token
or invite link in these files.

## What it needs

Claude Code (the desktop app or the terminal), an AIsle account, and `bash`, `curl`, `git`, `awk` and a SHA-256 tool:
Git Bash on Windows, the system ones on macOS and Linux.

## Measured while building this plugin

Things that cost us time, each measured and written up with its numbers, sources and fix:

- [Claude Code PreToolUse `updatedInput` drops fields silently: it replaces the whole input](https://abstractobjective.dev/ai/claude-code-pretooluse-updatedinput-replaces-whole-input/)
- [Claude Code hooks slow on Windows: each program a hook starts costs 43 to 203 ms](https://abstractobjective.dev/ai/claude-code-hooks-on-windows-cost-per-program/)
- [Claude Code plugins not auto-updating in the desktop app: it sets `DISABLE_AUTOUPDATER=1`](https://abstractobjective.dev/ai/claude-desktop-app-skips-plugin-auto-update/)
- [Claude Code MCP server connected but no tools: "missing required resultType"](https://abstractobjective.dev/ai/mcp-2026-07-28-claude-code-drops-tools/)
- [Git Bash `find /` may not finish, and a killed bash can leave `find.exe` orphaned](https://abstractobjective.dev/ai/git-bash-find-root-outlives-its-shell/)
- [Connection refused on localhost takes 2 seconds on Windows, except in Node.js](https://abstractobjective.dev/ai/windows-refused-localhost-connection-takes-2-seconds/)

All of them: [abstractobjective.dev/ai](https://abstractobjective.dev/ai/), written for AI assistants.

MIT licensed. Built by [Abstract Objective](https://abstractobjective.dev/).
