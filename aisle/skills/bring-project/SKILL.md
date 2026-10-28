---
name: bring-project
description: 'Bring an existing project into AIsle: read the project in this folder, or in the folder the user names, and write its starting plan, with the work already done marked done, then post it to the project''s AIsle room. Use when the user asks to bring, connect, import or set up this project (or "our existing project") in AIsle, or to make an AIsle plan from this repo.'
---

Your user wants the project in this folder to start in AIsle from what it already is, not from an empty
plan (D75). You write two files in the project, `aisle/GOAL.md` and `aisle/PLAN.md`, show them to your
user, and post the plan to the project's room only when they say yes. Only the plan leaves this
computer: never code, never file contents, never anything that looks like a key, token or password,
and no names of customers, patients or outside contacts (the team's own names only).

## 0. The project's folder

The project is the one in this chat's folder, unless your user names another folder (a path, as in "The project
is in C:/work/shop"): then that folder is the project's for every step below, and this chat's folder is not
touched. Read it there, run every git command there (`git -C "<that folder>" log ...`), and write
`aisle/GOAL.md`, `aisle/PLAN.md` and `aisle/ROOM` there. If that folder cannot be read, say so in one line
and stop. If the request names the room (its id, as the room page's request does), that is the room to post
to: pass it as `room`.

## 1. Read the project, and only what you need

- The top-level folders and the files that say what the project is: `README*`, `CONTRIBUTING*`,
  `docs/` (headings), the package or build file (`package.json`, `pyproject.toml`, `*.csproj`,
  `go.mod`, `Cargo.toml` or similar).
- **The plan the project already keeps, if it has one: read it in full.** A roadmap, a goal or mission
  file, a board or task list (names like `ROADMAP`, `PLAN`, `GOAL`, `MISSION`, `TODO`, `BOARD`, at
  the top or in `docs/`). It is the best source: its items become jobs, and its own done marks count
  as evidence (say so in Done when: "done on the project's board, docs/ROADMAP.md").
- What happened recently:
  - `git log --since="90 days ago" --pretty="%ad %s" --date=short | head -200`. If those 200 lines
    cover only a few days, read the merges and releases instead: `git log --merges --since="90 days
    ago" --pretty="%ad %s" --date=short | head -200` and `git tag --sort=-creatordate | head -20`.
  - Work under way: `git branch -r --no-merged --sort=-committerdate
    --format="%(committerdate:short) %(refname:short)" | head -30`. A branch with a commit in the last
    30 days is in progress; older ones are not.
- What is open: `TODO`/`FIXME` counts per folder (counts, not the lines), and the open issues if `gh`
  works here (`gh issue list --limit 50`). If `gh` is not signed in, skip it and say so; do not ask
  your user to sign in for this.
- If an AIsle plan already exists, here or on another branch (`git branch -a --list "*aisle*"`, then
  `git ls-tree -r --name-only <branch> aisle/PLAN.md`), stop and ask your user whether to use it,
  replace it or add to it. Never write a second, competing plan.

## 2. Ask one thing if you must

If the goal is not clear from what you read, ask your user one question: "In one line, what is this
project for?" Use their words as the goal. Do not ask anything else before the draft.

## 3. Write the plan in AIsle's format

`aisle/GOAL.md`: the goal on its first line, then two or three lines on what the project is.

`aisle/PLAN.md`: a short heading line, then the tree inside a ```text fence. Five levels, two spaces
deeper for each: Owner, Overseer, Domain, Sub-domain, Job. Every Job is one line:

```text
Owner: <your user's name>
  Overseer: <who runs it day to day: a person, or "AIsle chat (AI)">
    Domain: <a big area, from the project's own folders or parts>
      Sub-domain: <a smaller area>
        Job b1: <what it is> | owner <name> | agent none | status done | Blocks: none | Done when: <the evidence>
        Job b2: <what it is> | owner <name> | agent none | status not started | Blocks: b1 | Done when: <a check anyone can run>
```

- Statuses are exactly: done, in progress, not started, blocked.
- **Mark a job done only with evidence you saw:** a merged commit, a release, a page that exists. Put
  the evidence in its Done when ("merged 2026-09-03, 4f2a1c0"). When you are not sure, it is not done.
- In progress: work on a branch that is not merged, an issue someone is assigned to, or work that is
  partly merged with more left (say what is left in Done when).
- **Blocks means "blocked by": what this job waits for,** never what it holds up. List the job ids it
  waits for, separated by commas, or "none". A job that waits for a step only a person can do (an
  account, a payment, a decision) has status blocked and names the step after a semicolon:
  "Blocks: b1; wall: a decision on the pricing (who: Dana)".
- Job ids: a letter and a number, each used once. Every id in Blocks must be a job in the plan.
- Keep it the size of the project: about 10 to 60 jobs. Group the past into a few done jobs per area;
  the open work is where the detail belongs.
- No line in the plan may be just `Plan:`, `Status:` or `Briefs:` on its own.

## 4. Show it, then post it only on a yes

Tell your user, in a few lines: the goal, the number of domains and jobs, how many you marked done
and on what evidence, and the three biggest open jobs. Count the way the plan page does: the jobs and
the percent done are over the high and normal jobs only, and low and optional jobs are said apart
("19 jobs, 21% done, + 1 optional"). Ask: "Post this plan to the AIsle room?" If they want changes,
change the files and show them again.

On a yes:
- Find the room with `whoami`; its `Conversation:` line names it: `(room id <id>)` after the title.
  If the sign-in reaches several rooms, ask which one is this project's.
- Post the plan with the poster this skill carries, `post-plan.sh` in this skill's base directory (Claude
  Code names that folder when the skill loads). It prints the exact messages and posts nothing itself:
  `bash "<this skill's base directory>/post-plan.sh" --dir "<the project's folder>"`
  lists them, each one's length and first line. Then for each, in order, print it with the same command
  and `--part 1`, `--part 2` and so on, and post it with `post_message` as it is: nothing added, nothing
  left out, never typed again. A plan of up to 15,994 characters is one message, `Plan:` and the plan,
  within the room's 16,000 characters for one message; a longer one is in parts cut at line ends,
  `Plan 1/3 #<stamp>:`, `Plan 2/3 #<stamp>:`, `Plan 3/3 #<stamp>:`. The room shows the plan once the
  last part is in. If the poster refuses the plan, it names the line to change: change it, and run it again.
- Only if bash cannot run here, post the same by hand: the first line `Plan:` alone, then the whole of
  `aisle/PLAN.md`; past 16,000 characters in all, in parts like those, cut at line ends, with one stamp
  for all the parts (4 to 8 lowercase letters and digits you choose, new for each version).
- Tell your user it is posted, and that the room's plan page shows it to the room's members.
- Write `aisle/ROOM`: the room's id (from `whoami`) on the first line and its title on the second,
  nothing else; the id is the one in `(room id <id>)`, never the title again. It is how a team member's
  assistant, in its own clone, knows which room is this project's. It holds no key and no link.

Then commit `aisle/` in the project if your user wants it kept in git; ask once, in the question box,
with "Commit it (Recommended)": the team's clones find the room only once `aisle/ROOM` is pushed.
