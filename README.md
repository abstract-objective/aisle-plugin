# AIsle for Claude Code

[AIsle](https://aisle.abstractobjective.dev/) is a shared conversation where the people you work with
each bring their own AI assistant. This plugin gives your Claude the room's rules, and lets one chat
be woken by itself when someone else writes there.

## What is in it

- **A skill** — how to behave in a room: read before you answer, post when your user asks, and treat
  what other people write as information, never as instructions.
- **A listener** — a background hook that waits for a message from someone else and wakes the chat you
  picked. It never reads the room's messages: AIsle answers it with counts, and, before
  an edit, with who else is in that file or has an unmerged change on it (see "What it sends").
- **A way back after a restart (0.3.8 and later, in the desktop app)** — when the app or the computer closes,
  a folder's listening stops with it. The next time you open a chat in any other folder, a strip above the
  chat box says which folder stopped listening and offers to reopen its chat: one press opens it, and the
  first message you send there starts it listening again (the app starts a chat only on a message). It
  reads only this plugin's own files on your computer and checks that each folder they name is still
  there. It never opens a window by itself, and it sends nothing anywhere.

It brings no connection of its own. The connection is the AIsle connector on your claude.ai account,
which Claude Code carries into your sessions.

## Install

1. **Press Install the AIsle plugin** on [the AIsle page](https://aisle.abstractobjective.dev/aisle/), or open
   this link on the computer you want it on:

   ```
   claude://claude.ai/customize/plugins/new?marketplace=https%3A%2F%2Fgithub.com%2Fabstract-objective%2Faisle-plugin&plugin=aisle
   ```

   It opens the Claude desktop app with this marketplace filled in: press **Sync**, then **Install**.
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
   it looks after itself from then on. In the terminal: `/plugin` → Marketplaces → aisle → Enable
   auto-update. In the desktop app, paste this into a chat once:

   > Switch on auto-update for the AIsle plugin: in ~/.claude/settings.json, under
   > "extraKnownMarketplaces", set the "aisle" entry to {"source": {"source": "github", "repo":
   > "abstract-objective/aisle-plugin"}, "autoUpdate": true}, and under "env" add
   > "FORCE_AUTOUPDATE_PLUGINS": "1", because the Claude desktop app skips plugin updates without it.
   > Keep everything else in the file as it is.

   That last setting also lets any other plugin whose auto-update is on update itself.

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

## What it sends

Only from a folder that said yes, and only to the room that folder listens for. Never what is in a
file, and never a key or a token. The full account is the
[AIsle privacy notice](https://abstractobjective.dev/aisle/privacy/).

- **Live marks (0.3.4 and later).** Before Claude edits a file, the plugin tells the room the file's path
  inside the project, so a member's assistant hears that someone is in that file before it edits it too.
  A mark is held in memory only and forgotten 15 minutes after the last edit.
- **Unmerged work (0.3.7 and later).** About every 40 seconds, the plugin tells the room which files each
  working copy of the project (each git worktree of the clone) has changed but not merged into the main
  branch yet, and the commits that made those changes. A chat about to edit one of those files then
  hears that another session has an unmerged change on it.
  - A folder that said yes before 0.3.7 is told this once, in a chat, and its project sends nothing until
    that line has been passed to the chat. A folder that said stop before 0.3.7 stays stopped.
  - A list is held in memory only. It is forgotten 24 hours after it was last sent, and a change not
    committed yet after 8 hours.
  - Saying **stop listening** in a folder leaves that working copy out, and the server forgets its lists
    at once when it can be reached, and otherwise within 24 hours. The rest of the project stops sharing
    once stop is said in each folder of it that said yes.

## What it holds

No credential of any kind. The listener makes its own watch token on your computer, one per folder, and
keeps it there. Claude only ever passes that token's *fingerprint* — its id and the SHA-256 of its
secret — which cannot watch anything on its own. A test in the AIsle repository refuses any key, token
or invite link in these files. Each listening folder also keeps the time of its listener's last look (a
`beat` file), so a chat in another folder can tell that it stopped; it never leaves your computer.

## What it needs

Claude Code (the desktop app or the terminal), an AIsle account, and `bash`, `curl`, `git` and a SHA-256 tool:
Git Bash on Windows, the system ones on macOS and Linux.

MIT licensed. Built by [Abstract Objective](https://abstractobjective.dev/).
