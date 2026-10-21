#!/usr/bin/env bash
# AIsle plugin for Claude Code (D26 M7, D28). Claude Code runs this one script for four hooks, and it
# tells them apart by the event name in the hook's input:
#
#   PreToolUse, listen_here    fills in this folder's listener fingerprint, so Claude never handles it;
#                              "stop" instead turns listening off here, without reaching the room
#   PostToolUse, listen_here   makes this chat the one that listens for this folder
#   SessionStart and Stop      the listener, in that one chat only: wait for a message from someone
#                              else in the room, then exit 2, which wakes the idle session. It never
#                              learns what anyone wrote: /watch answers with numbers only.
#   PreToolUse, an edit        live marks (D45): says which file is about to change, and tells Claude
#                              who else in the room is editing it right now; and (D46) whether another
#                              session has an unmerged change on it, or on a file that usually changes
#                              together with it
#
# It also runs by itself, in the background, as the presence worker of a clone (D46): one per clone,
# it tells the room which files every worktree of the clone has unmerged changes on, never what is in
# them, keeps what the room says of everyone else's, and works out from the clone's own history which
# files usually change together.
#
# One chat per folder listens, and the person never types to keep it that way (D38). Ofir, 2026-09-24:
# "the listener need to be automatic - i dont want people to write listen here every 15 minutes - or at
# all". So: the FIRST time AIsle is used in a folder the assistant asks one yes-or-no question, and
# after that every new chat in that folder picks listening up by itself when it starts. The chat that
# had it lets go without a word. Folders that were never answered yes stay silent, and so does every
# other folder on the computer.
#
# Each folder has its own credential, made here and kept in the plugin's data folder. Claude only ever
# carries its fingerprint (the token's id and the SHA-256 of its secret), which cannot watch anything.
#
# Loud exactly once. Each problem is said once per session and then it stays quiet, because Stop runs
# after every reply and a listener that repeats itself wakes the session in a loop (seen 2026-09-19).
#
# Cheap. In Git Bash every program started costs 50 to 200 ms (measured 2026-10-07), and the edit hook
# runs before every edit, so the hooks read their input and their notes with bash's own commands, and
# the worker starts one git status per worktree when nothing has moved.
#
# Deliberately no backslashes anywhere in this file: on Windows it runs in Git Bash, and shells there
# have eaten them before. It needs bash, curl, git, grep, cut, tr, sed, head, awk, base64 and a SHA-256
# tool, which Git Bash, macOS and Linux all have.

U="${AISLE_WATCH_URL:-https://aisle.abstractobjective.dev/watch}"
DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.aisle-plugin}"
LOG="$DATA/listener.log"
SELF="${BASH_SOURCE[0]:-$0}"
# A tab and a newline without writing a backslash: bash starts with IFS set to exactly space, tab,
# newline, whatever the environment says.
TAB="${IFS:1:1}"
NL="${IFS:2:1}"
q='"'

umask 077
# The presence worker is this script again, started with the clone it serves and nothing on stdin.
WORKER=''
if [ "$1" = "--worker" ]; then
  WORKER="$2"
  input=''
else
  # The hook's input is JSON on stdin. Read it without ever blocking on a stdin that stays open.
  # A copy handed the hook by an older one (D84) runs in its process, with the input it read.
  [ -n "$AISLE_HANDED" ] || IFS= read -r -t 3 -d '' input
fi

# The folders that said yes to a room, in "$DATA/yes" as |key|key|, where a key is the folder's name in
# letters and digits only, compared in any case, so bash can make it without starting a program. The
# worktrees of a clone that said yes are in it too (D46).
yes_key() { key="${1//[!A-Za-z0-9]/}"; }

# A whole file into SL, without the newlines it ends with. Git Bash's read takes one byte per system call,
# about 4.7 us a byte (measured 2026-10-20): the worker read its worktrees' git status and notes that way,
# 1 MB a pass on Ofir's PC, and held about 10% of a core all day, 87% of it in the kernel. $(<file) reads
# in blocks, and bash 5.2 and newer start no process for it (0.2 to 0.3 ms, measured on 5.2.37, Git for
# Windows before 2.54, and on 5.3.9); an older bash (macOS's 3.2, the 5.0 and 5.1 of older Linux) forks
# once for it (15 ms a fork here), which beats a byte a time from about 3 KB on. The test first read 5.3
# and sent a hook on 5.2 to the byte read for nothing, 1 to 26 ms a note (the 0.3.26 review's shells:2).
# So the worker, in the background, reads in blocks on every bash: as first written it read as before on
# an older bash, and kept 0.3.24's cost there (the combo review's shells:0). A hook on an older bash reads
# its small notes a byte at a time, where a fork would add to each edit's wait; slurp_big, for a note that
# grows with the clone (where its worktrees are, the folders' spellings), reads in blocks on every bash.
slurp_big() { SL=''; [ -f "$1" ] && SL=$(<"$1"); return 0; }
if [ -n "$WORKER" ] || [ "${BASH_VERSINFO[0]:-0}" -gt 5 ] || { [ "${BASH_VERSINFO[0]:-0}" -eq 5 ] && [ "${BASH_VERSINFO[1]:-0}" -ge 2 ]; }; then
  slurp() { SL=''; [ -f "$1" ] && SL=$(<"$1"); return 0; }
else
  slurp() {
    SL=''
    [ -f "$1" ] && IFS= read -r -d '' SL < "$1"
    while [ "${SL%"$NL"}" != "$SL" ]; do SL="${SL%"$NL"}"; done
    return 0
  }
fi
# The lines of SL into the array named $1, empty ones left out, by bash alone.
lines_of() { local IFS="$NL"; set -f; eval "$1"'=($SL)'; set +f; }

# One string field of the hook's input, into FV, by bash alone. The first one, as grep found it before.
field() { FV=''; local re="$q$1$q *: *$q([^$q]*)$q"; [[ $input =~ $re ]] && FV="${BASH_REMATCH[1]}"; }

# A worker never makes the data folder: one deleted under it (an uninstall that wipes the plugin's data,
# say) stays deleted, and the worker ends at its next look (the review's R2). For the same reason the
# worker makes every folder below it without -p.
if [ -n "$WORKER" ]; then [ -d "$DATA" ] || exit 0; else [ -d "$DATA" ] || mkdir -p "$DATA" || exit 0; fi

field session_id; sid="${FV//[!A-Za-z0-9-]/}"
field hook_event_name; event="${FV//[!A-Za-z]/}"
[ -z "$sid" ] && sid=unknown
[ -n "$WORKER" ] && sid=worker

log() {
  if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 200000 ]; then tail -n 300 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $sid $*" >> "$LOG"
}

# An open chat runs the newest installed copy of this script, not the copy it started with (D84). Claude
# Code keeps each version of the plugin in a folder of its own, named by the version, and a chat runs
# the copy that was newest when it opened for as long as it stays open, which for some chats is days. So
# a fix to listening reached only the chats opened after it: 6 minutes after 0.3.22 went live, an older
# chat's compaction, on an older copy, took listening from the chat Ofir had picked (2026-10-17 04:46
# UTC, listener log). So a copy hands the hook to the newest copy in the folder beside its own that has
# this script and is not set aside (.orphaned_at), or, when its own copy is the one set aside (a
# rollback), to the copy installed now, even a lower one.
# The newer copy runs in this same process, with the input already read: Claude Code ends a hook by
# killing its process alone, and a second process (exec is one in Git Bash) outlived both the hook's
# timeout and its chat (measured with Claude Code 2.1.299, 2026-10-17). Sharing the process is a contract
# every later version keeps: it runs under an older chat's hooks.json (its events, timeouts, no
# arguments), and with AISLE_HANDED set it reads no input and hands over to nobody.
# Each copy is checked once per version on this computer before it is handed anything: it parses, and it
# knows AISLE_HANDED, since a copy that does not would wait 3 seconds on an input already read. One that
# fails is passed over for the next one down, and checked again only when its script changes, so a broken
# release costs nothing per hook and a half-written copy is not kept out for good. After that bash alone
# looks, one folder listing and a test or two, so an edit pays no program for it.
# The "no" note has the time from before the check, so a copy Claude Code finished while it ran is newer
# than the note and checked again at the next hook (it was made after the check, and kept such a copy out:
# the combo review's shells:2). On Windows Claude Code's copy keeps its source's time (seen on Ofir's PC,
# 0.3.24), which no note can be newer than, so a "no" also lasts only 10 minutes: the first start or reply
# after that clears it (below, with the week-old notes), and a broken copy costs a check every 10 minutes.
# It runs before the edit hook's fast path below, so all a chat's own copy keeps for good is the input
# read and the hand-over itself: ready() and handover() always run from the chat's own copy, and the copy
# handed to skips its own, so how a copy is checked and which one is picked (the .orphaned_at rule, the
# "no" note, the version from the folder's name) stay the chat's copy's for the chat's whole life (the
# 0.3.26 review's xver:3). In 0.3.25 the fast path came first, and an edit in a folder that never said yes
# kept the rules of the copy the chat opened with (the combo review's merge:3). So it starts no program
# either: its own version is its folder's name, as Claude Code names them (plugin.json is read after it),
# and at an edit it writes no log line, which starts two; the session's next start or reply writes it.
# Not the presence worker: a newer copy's worker takes the lock over and the old one ends at its next look
# (take_over), and a rolled-back copy's ends at its next look too (plugin_gone), so the next hook, run by
# the copy installed now, starts that copy's.
HANDTO=''
HANDFROM=''
ready() {
  local f="$1/scripts/listen.sh" v="${1##*/}" t
  [ -s "$f" ] || return 1
  [ -f "$DATA/handover-ok-$v" ] && return 0
  [ -f "$DATA/handover-no-$v" ] && [ ! "$f" -nt "$DATA/handover-no-$v" ] && return 1
  t="$DATA/handover-chk-$v-$$"
  : > "$t"
  if bash -n "$f" 2>/dev/null && grep -q AISLE_HANDED "$f"; then : > "$DATA/handover-ok-$v"; rm -f "$t"; return 0; fi
  mv -f "$t" "$DATA/handover-no-$v" 2>/dev/null || : > "$DATA/handover-no-$v"
  [ -f "$DATA/handover-$sid-$v" ] || { : > "$DATA/handover-$sid-$v"; log "passes over the copy of $v: it does not parse, or takes no hand-over (D84)"; }
  return 1
}
handover() {
  [ -z "$WORKER" ] && [ -z "$AISLE_HANDED" ] && [ -n "$CLAUDE_PLUGIN_ROOT" ] || return 0
  local re='^([0-9]+)[.]([0-9]+)[.]([0-9]+)$' r="${CLAUDE_PLUGIN_ROOT%/}" name parent b='' v n top=0 best=''
  name="${r##*[!0-9.]}"
  [[ $name =~ $re ]] || return 0
  HANDFROM="$name"
  [ -e "$r/.orphaned_at" ] || top=$((10#${BASH_REMATCH[1]} * 1000000 + 10#${BASH_REMATCH[2]} * 1000 + 10#${BASH_REMATCH[3]}))
  parent="${r%"$name"}"
  # Claude Code spells the folder with forward slashes on Windows too (2.1.299); another spelling has
  # backslashes, which bash's own pattern matching cannot walk, so they become slashes first.
  case "$parent" in
    */) ;;
    *)
      [ -s "$DATA/backslash" ] || awk 'BEGIN { printf "%c", 92 }' > "$DATA/backslash"
      IFS= read -r -d '' b < "$DATA/backslash"
      parent="${parent//"$b"//}"
      ;;
  esac
  for v in "$parent"*; do
    [[ ${v##*/} =~ $re ]] || continue
    n=$((10#${BASH_REMATCH[1]} * 1000000 + 10#${BASH_REMATCH[2]} * 1000 + 10#${BASH_REMATCH[3]}))
    [ "$n" -gt "$top" ] && [ "$v" != "$parent$name" ] && [ ! -e "$v/.orphaned_at" ] && ready "$v" || continue
    top=$n
    best="$v"
  done
  [ -n "$best" ] || return 0
  v="${best##*/}"
  [ "$event" = PreToolUse ] || [ -f "$DATA/handover-$sid-$v" ] || { : > "$DATA/handover-$sid-$v"; log "runs the listener of $v, the copy installed now, in place of its own $name (D84)"; }
  HANDTO="$best"
}
handover
if [ -n "$HANDTO" ]; then
  AISLE_HANDED="$HANDFROM"
  CLAUDE_PLUGIN_ROOT="$HANDTO"
  source "$HANDTO/scripts/listen.sh" "$@"
  exit $?
fi

# The edit hook runs before every Edit and Write in every project on this computer, because the plugin
# is installed for the person and not per project. So in a folder that never said yes it must cost no
# more than bash starting, and it uses only bash's own commands until it knows. 0.3.4 did all the work
# below first and took about a second per edit (measured 2026-10-02); bash alone starts in 0.1 s. The
# hand-over above runs first and starts none, but for a copy new to this computer, checked once (D84).
re='"hook_event_name" *: *"([A-Za-z]*)"'
if [[ $input =~ $re ]] && [ "${BASH_REMATCH[1]}" = PreToolUse ]; then
  re='"tool_name" *: *"([^"]*)"'
  t=''
  [[ $input =~ $re ]] && t="${BASH_REMATCH[1]}"
  case "$t" in
    Edit|Write|MultiEdit|NotebookEdit)
      d="$CLAUDE_PROJECT_DIR"
      re='"cwd" *: *"([^"]*)"'
      wd=''
      [[ $input =~ $re ]] && wd="${BASH_REMATCH[1]}"
      [ -z "$d" ] && d="$wd"
      # No list yet (the first edit after an update): the long way below makes it.
      if [ -f "$DATA/yes" ]; then
        slurp "$DATA/yes"
        list="$SL"
        yes_key "$d"
        [ -n "$key" ] || exit 0
        shopt -s nocasematch
        case "$list" in
          *"|$key|"*) ;;
          *)
            # Or the worktree the chat is in, which the desktop app does not name in CLAUDE_PROJECT_DIR
            # (see in_worktree): one of a clone that said yes, whose main folder did not (0.3.25).
            yes_key "$wd"
            [ -n "$key" ] || exit 0
            case "$list" in *"|$key|"*) ;; *) exit 0 ;; esac
            ;;
        esac
        shopt -u nocasematch
      fi
      ;;
  esac
fi

# This plugin's own version, told to the room with every poll so an old copy gets noticed (D43).
ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}"
VER=''
slurp "$ROOT/.claude-plugin/plugin.json"
manifest="$SL"
re='"version" *: *"([^"]*)"'
[[ $manifest =~ $re ]] && VER="${BASH_REMATCH[1]}"

# Say something to Claude, but only the first time this session.
say_once() {
  local marker="$DATA/said-$1-$sid"
  if [ -f "$marker" ]; then log "quiet: $1 already said this session"; exit 0; fi
  touch "$marker"
  echo "$2" >&2
  exit 2
}

sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi | cut -d' ' -f1; }
# The SHA-256 of each file named, one line each in the order given, the hash first: one program for many.
sha_files() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
b64url() { base64 | tr '+/' '-_' | tr -d '=' | tr -d '[:space:]'; }
# A file written whole or not at all, so a reader never sees half of one. A half-written header once
# sent no credential, and the refusal that came back deleted the folder's yes.
put() { printf '%s' "$2" > "$1.$$" && mv -f "$1.$$" "$1"; }
# A note only the worker reads, written in place: in Git Bash each mv is a program, and costs as much
# as a git command.
keep() { printf '%s' "$2" > "$1"; }
# A note kept only when it changed, so a pass that changes nothing writes nothing.
note() { local v=''; [ -f "$1" ] && IFS= read -r v < "$1"; [ "$v" = "$2" ] || put "$1" "$2"; }
# Do two files hold the same, but for the newlines they end with? By bash alone.
same_file() {
  local a
  { [ -f "$1" ] && [ -f "$2" ]; } || return 1
  slurp "$1"
  a="$SL"
  slurp "$2"
  [ "$a" = "$SL" ]
}

# One spelling of a folder however it was written (C: or /c/, either slash, any case), and the place
# its notes live, under a hash of that spelling, into FO; $2 is the spelling when it is known already.
# Worked out once for each way a folder is written, and kept in "$DATA/spellings", so a hook before an
# edit starts no program for it. Kept only for a folder that has notes here, or a worktree of a clone
# that said yes ($2, from its worker): where a folder that never had anything to do with AIsle is, is
# never written down (0.3.7 before the second fix check wrote every folder a chat started in).
spell() { printf '%s' "$1" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9._-' '_' | tr -s '_' | sed 's/^_*//;s/_*$//'; }
folder_of() {
  local l n lines
  FO=''
  slurp_big "$DATA/spellings"
  case "$NL$SL" in
    *"$NL$1$TAB"*)
      lines_of lines
      for l in "${lines[@]}"; do [ "${l%%"$TAB"*}" = "$1" ] && { FO="$DATA/folders/${l#*"$TAB"}"; return 0; }; done
      ;;
  esac
  if [ -n "$2" ]; then n=$(printf '%s' "$2" | sha | cut -c1-16); else n=$(spell "$1" | sha | cut -c1-16); fi
  FO="$DATA/folders/$n"
  { [ -n "$2" ] || [ -d "$FO" ]; } || return 0
  case "$1" in *"$TAB"*|*"$NL"*) return 0 ;; esac
  printf '%s%s%s%s' "$1" "$TAB" "$n" "$NL" >> "$DATA/spellings"
}

# The time in seconds and the day, from bash itself where it can (5.0 and newer), so that writing the
# record below starts no program.
stamp() {
  if [ -n "$EPOCHSECONDS" ]; then NOW=$EPOCHSECONDS; printf -v DAY '%(%Y-%m-%d)T' -1
  else NOW=$(date +%s); DAY=$(date +%Y-%m-%d); fi
}
# The record a test of the warning is read from (D46): on this computer only, in the plugin's own folder,
# a file per writer and per day, appended to and never cut, and deleted 60 days after its day. Each line
# is the time in seconds, what happened, and its fields, tab-separated, any path last.
# Once a day, by the worker or by any chat's listener, so it happens with no worker running too: a day's
# file goes once it was last written to 60 days ago (find counts whole days, so +59). So does the copy of
# what a clone's worker last heard, without names (heard.k). It is kept across workers, so that a new one
# records only what changed (the review's P7), but it holds other people's paths and commit ids, so it
# too goes 60 days after it was written (the review's R1). And a clone nothing has used for 60 days loses
# what its worker worked out of this computer's own worktrees: where they are (known, and current, which
# 0.3.25 kept at first), what each has unmerged, how many were told (counts), which an edit was about to
# move (edited), and the co-change table; and the scratch folder a worker killed hard left (tmp: its last
# report, the worktrees it looked at), which as first written stayed for good (the 0.3.26 review's
# promise:2). No worker runs for such a clone: one ends 12 hours after the clone was last used. Its yes, and
# that its person was told, stay: a later chat is neither asked nor told again.
forget_old_records() {
  local cut='' old f
  { [ -d "$DATA/logs" ] || [ -d "$DATA/clones" ]; } || return 0
  stamp
  [ -f "$DATA/logs/.cut" ] && read -r cut < "$DATA/logs/.cut"
  [ "$cut" = "$DAY" ] && return 0
  [ -d "$DATA/logs" ] || mkdir "$DATA/logs" 2>/dev/null || return 0
  printf '%s' "$DAY" > "$DATA/logs/.cut"
  find "$DATA/logs" -type f -name '*.tsv' -mtime +59 -delete 2>/dev/null
  [ -d "$DATA/clones" ] || return 0
  # One program for both: an old heard.k is deleted, and an old beat names a clone nobody used.
  old=$(find "$DATA/clones" -mindepth 2 -maxdepth 2 -type f -name heard.k -mtime +59 -delete -o -type f -name beat -mtime +59 -print 2>/dev/null)
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    f="${f%/beat}"
    rm -rf "$f/w" "$f/warn" "$f/table" "$f/table.head" "$f/table.at" "$f/known" "$f/covered" "$f/base-ref" "$f/current" "$f/counts" "$f/edited" "$f/sentwith" "$f/tmp"
  done <<< "$old"
  return 0
}
record() {
  local w="$1" IFS="$TAB"
  shift
  stamp
  logto "$w" "$1" || return 0
  printf '%s%s%s%s' "$NOW" "$TAB" "$*" "$NL" >> "$LOGF"
}
# The file of the record a writer's line goes to today, into LOGF. A new one starts with the plugin's
# version, so the record says which copy of the plugin wrote it (C2); $2 is the line's kind.
logto() {
  LOGF="$DATA/logs/$DAY-$1.tsv"
  [ -f "$LOGF" ] && return 0
  [ -d "$DATA/logs" ] || mkdir "$DATA/logs" 2>/dev/null || return 1
  [ "$2" = version ] || printf '%s%sversion%s%s%s' "$NOW" "$TAB" "$TAB" "${VER:-0.0.0}" "$NL" >> "$LOGF"
}

# This chat's folder: where the session started, the same for all four hooks.
if [ -z "$WORKER" ]; then
  dir="$CLAUDE_PROJECT_DIR"
  [ -z "$dir" ] && { field cwd; dir="$FV"; }
  [ -z "$dir" ] && dir="$PWD"
  folder_of "$dir"
  FOLDER="$FO"
fi

# This folder's credential: made once on this computer, shown to nobody.
folder_token() {
  mkdir -p "$FOLDER" || exit 0
  if [ ! -s "$FOLDER/token" ]; then
    printf 'watch_%s.%s' "$(head -c 16 /dev/urandom | b64url)" "$(head -c 32 /dev/urandom | b64url)" > "$FOLDER/token"
    printf '%s' "$dir" > "$FOLDER/path"
    log "made a listener token for $dir"
  fi
  cat "$FOLDER/token"
}
fingerprint() { printf '%s.%s' "${1%%.*}" "$(printf '%s' "${1#*.}" | sha)"; }
# The header curl reads the credential from, so it is never on a command line anyone can list.
header_of() { [ -s "$1/header" ] || put "$1/header" "Authorization: Bearer $(cat "$1/token")"; }

# The list the edit hook reads first (see yes_key): every folder here that said yes and did not say
# stop since, and every worktree of a clone that said yes (D46). Kept up to date by each folder's own
# listener and by each clone's worker. A folder missing from it only goes unheard until its next chat
# starts or replies.
yes_index() {
  local list='|' f p lines
  for f in "$DATA"/folders/*/answered; do
    [ -f "$f" ] || continue
    [ -f "${f%/answered}/stopped" ] && continue
    p=''
    [ -f "${f%/answered}/path" ] && IFS= read -r p < "${f%/answered}/path"
    [ -n "$p" ] || continue
    yes_key "$p"
    [ -n "$key" ] && list="$list$key|"
  done
  for f in "$DATA"/clones/*/covered; do
    { [ -f "$f" ] && [ -f "${f%/covered}/yes" ]; } || continue
    slurp "$f"
    lines_of lines
    for p in "${lines[@]}"; do
      yes_key "$p"
      [ -n "$key" ] && list="$list$key|"
    done
  done
  put "$DATA/yes" "$list"
}
yes_add() {
  [ -f "$DATA/yes" ] || yes_index
  yes_key "$1"
  [ -n "$key" ] || return 0
  local list
  slurp "$DATA/yes"
  list="$SL"
  [ -n "$list" ] || list='|'
  case "$list" in *"|$key|"*) return 0 ;; esac
  put "$DATA/yes" "$list$key|"
}

# ---------------------------------------------------------------- the clone and its worker (D46)
#
# A conflict comes from work waiting to be merged, hours after its edits (the step 1 review: a mark that
# lasts 15 minutes after an edit is there for 37% of the collisions, an unmerged change for 95%). So
# the room hears, for every worktree of a clone that said yes, which files it has unmerged changes on,
# whether a chat is open in it or not, and never what is in them. A yes covers the clone it was said
# in, every worktree of it, and no other clone: a fork or a copy never joins by accident. A worktree
# whose own folder said stop is left out.
#
# A folder that said yes before 0.3.7 had agreed to less than that (the review's V2), so its clone sends
# nothing before its person has been told, once a clone, in this line ($CLONE/told says it was). The
# chat that listens there says it when it starts or replies, or Claude hears it before an edit, and the
# clone's yes is given only at a later chat start or reply, so after the reply that passed it on. Its
# way out is said once too, so it says exactly what a stop does: it leaves out the worktree it is said
# in, and the clone's yes moves to another folder of the clone that said yes (clone_unyes).
NEWS_LINE='AIsle plugin, new in 0.3.7: since this folder said yes to the room, every worktree of this clone also tells the room, starting when this reply ends, which files it has unmerged changes on and the commits that made them, never what is in them, so parallel sessions can be warned. Tell your user this in one line. If they do not want it, call listen_here with the fingerprint stop: that turns listening off here and leaves this worktree out, and the rest of the clone stops only once that is done in a chat in each folder of it that said yes.'

# The clone a folder belongs to: its git common dir, the same for every worktree of it. Sets COMMON,
# TOP (the root of the folder's worktree), CID and CLONE, or fails outside git.
clone_of() {
  local out gd rel=''
  CID='' CLONE='' COMMON='' TOP=''
  out=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir --show-toplevel 2>/dev/null) || return 1
  COMMON="${out%%"$NL"*}"
  TOP="${out#*"$NL"}"
  TOP="${TOP%%"$NL"*}"
  case "$COMMON" in
    /*|[A-Za-z]:/*) ;;
    *)
      # Git before 2.31 does not know --path-format and prints it back as a line of its own, so every
      # clone once got the same name (the review's P5). Then the clone comes from the worktree's own
      # git dir, and the "commondir" file a linked worktree's git dir has.
      out=$(git -C "$1" rev-parse --absolute-git-dir --show-toplevel 2>/dev/null) || return 1
      gd="${out%%"$NL"*}"
      TOP="${out#*"$NL"}"
      TOP="${TOP%%"$NL"*}"
      [ -f "$gd/commondir" ] && IFS= read -r rel < "$gd/commondir"
      case "$rel" in
        '') COMMON="$gd" ;;
        /*|[A-Za-z]:/*) COMMON="$rel" ;;
        *) normal "$gd/$rel"; COMMON="$NORMAL" ;;
      esac
      ;;
  esac
  case "$COMMON" in /*|[A-Za-z]:/*) ;; *) return 1 ;; esac
  case "$TOP" in /*|[A-Za-z]:/*) ;; *) return 1 ;; esac
  CID=$(spell "$COMMON" | sha | cut -c1-16)
  CLONE="$DATA/clones/$CID"
}
# A path with its "." and ".." parts worked out, by bash alone, into NORMAL.
normal() {
  local p="$1" lead='' part parts out=()
  case "$p" in [A-Za-z]:/*) lead="${p:0:2}"; p="${p:2}" ;; esac
  IFS=/ read -r -a parts <<< "$p"
  for part in "${parts[@]}"; do
    case "$part" in
      ''|.) ;;
      ..) [ "${#out[@]}" -gt 0 ] && unset "out[${#out[@]}-1]" ;;
      *) out+=("$part") ;;
    esac
  done
  NORMAL="$lead"
  for part in "${out[@]}"; do NORMAL="$NORMAL/$part"; done
  [ -n "$NORMAL" ] || NORMAL=/
}
# Did this clone's worker find it gone (a drive not there, a folder moved) less than a day ago? Then
# no hook gives its yes back, and no worker is started for it on every edit, until a day has passed.
recently_gone() {
  local at=''
  [ -f "$CLONE/gone" ] || return 1
  read -r at < "$CLONE/gone"
  [[ $at =~ ^[0-9]+$ ]] || return 1
  stamp
  [ $(( NOW - at )) -lt 86400 ]
}
# Did this clone's worker find, less than a day ago, that it has nothing to tell the room (a shallow
# clone, or no base branch)? Then no hook starts its worker again until a day has passed, or a new yes.
resting() {
  local at=''
  [ -f "$CLONE/rest" ] || return 1
  read -r at < "$CLONE/rest"
  [[ $at =~ ^[0-9]+$ ]] || return 1
  stamp
  [ $(( NOW - at )) -lt 86400 ]
}
# This folder's clone, from the folder's notes when they have it.
here_clone() {
  CID='' CLONE=''
  [ -f "$FOLDER/clone" ] && read -r CID < "$FOLDER/clone"
  if [ -n "$CID" ] && [ -s "$DATA/clones/$CID/common" ]; then CLONE="$DATA/clones/$CID"; return 0; fi
  clone_of "$dir" || return 1
  [ -d "$FOLDER" ] && printf '%s' "$CID" > "$FOLDER/clone"
  return 0
}
# Is this folder in a clone that said yes, without having said stop itself? Costs nothing on a
# computer where no clone ever said yes.
covered_here() {
  local f
  [ -f "$FOLDER/stopped" ] && return 1
  for f in "$DATA"/clones/*/yes; do
    [ -f "$f" ] || return 1
    here_clone || return 1
    [ -f "$CLONE/yes" ]
    return
  done
  return 1
}
# A clone's yes rests on one folder of it that said yes, whose token its worker reports with. When that
# folder says stop, or the room forgets its token, it moves to another folder of the clone that said
# yes, or the clone stops reporting.
clone_unyes() {
  local y='' c f
  { [ -n "$CLONE" ] && [ -f "$CLONE/yes" ]; } || return 0
  read -r y < "$CLONE/yes"
  [ "$y" = "${FOLDER##*/}" ] || return 0
  # The room first forgets what this folder's token told it, at once rather than in 24 hours; then it holds
  # nothing under it, so no later stop gives it up again (stop_unheard).
  give_up "$y" "$CLONE"
  f=''
  [ -f "$CLONE/sentwith" ] && read -r f < "$CLONE/sentwith"
  [ "$f" = "$y" ] && rm -f "$CLONE/sentwith"
  # The next folder's yes takes the place of this one's in one rename: a worker that found the clone's
  # yes missing for a moment, between the two, ended (worker_main) or removed the new one (pass).
  for f in "$DATA"/folders/*/answered; do
    f="${f%/answered}"
    { [ -s "$f/token" ] && [ -f "$f/clone" ] && [ "$f" != "$FOLDER" ] && [ ! -f "$f/stopped" ] && [ ! -f "$f/refused" ]; } || continue
    c=''
    read -r c < "$f/clone"
    [ "$c" = "$CID" ] && { put "$CLONE/yes" "${f##*/}"; return 0; }
  done
  # Nobody says yes for it now: its record of what it heard starts afresh if one does later.
  rm -f "$CLONE/yes" "$CLONE/heard.k"
  log "presence: the clone at ${COMMON:-$CID} no longer says yes"
}

# A chat in one of a folder's Claude Code worktrees (0.3.20). The desktop app starts
# such a session with CLAUDE_PROJECT_DIR set to the main folder, so without this a worker another session
# started in a worktree took listening from the chat its person was in, and the room woke a busy worker
# (2026-10-17, Test room #74). Its real folder is the hook's cwd; both are compared spelled as letters,
# digits and dots, by bash alone (3.2 on a Mac: no case folding by expansion, so nocasematch). Defined
# here, before stop_here, which a stop runs before the hook reaches the chat start below.
in_worktree() {
  field cwd
  local c="$FV" d="$dir" r=1
  c="${c//[^A-Za-z0-9.]/_}"; d="${d//[^A-Za-z0-9.]/_}"
  while [[ $c == *__* ]]; do c="${c//__/_}"; done
  while [[ $d == *__* ]]; do d="${d//__/_}"; done
  shopt -s nocasematch
  [[ $c == "${d%_}"_.claude_worktrees_* ]] && r=0
  shopt -u nocasematch
  return $r
}
# The worktree a chat the desktop app started in one of its worktrees is in (see in_worktree), by the
# hook's cwd, into FO: its folder's notes. Fails in any other chat. Its backslashes come doubled, as JSON
# writes them (see the edit hook).
chat_folder() {
  local b='' cwd
  in_worktree || return 1
  [ -s "$DATA/backslash" ] || awk 'BEGIN { printf "%c", 92 }' > "$DATA/backslash"
  IFS= read -r -d '' b < "$DATA/backslash"
  field cwd
  cwd="${FV//"$b$b"/"/"}"
  clone_of "$cwd" || return 1
  folder_of "$TOP"
}

# Off for good in this folder, until listen_here is said here again: no chat here listens, and its
# worktree is left out of what its clone tells the room, whichever folder said yes for the clone. A chat
# the desktop app started in a worktree has the main folder for its folder (see in_worktree), so the
# worktree it is in stops too: as first written, 0.3.25 kept hearing that chat's edits after its stop
# whenever another folder held the clone's yes, and kept telling the room what the worktree had (the
# review's correctness claim 1). First, as clone_of below sets the clone clone_unyes works on.
stop_here() {
  mkdir -p "$FOLDER" || return 1
  rm -f "$FOLDER/helper" "$FOLDER/answered" "$FOLDER/role"
  : > "$FOLDER/stopped"
  chat_folder && mkdir -p "$FO" && : > "$FO/stopped"
  if clone_of "$dir"; then
    folder_of "$TOP"
    mkdir -p "$FO" && : > "$FO/stopped"
    clone_unyes
    stop_unheard
  fi
  yes_index
}
# A stop reaches the room through the clone's worker, which names the worktree at its next pass (report).
# With none running (it ended after 12 hours unused, or for a newer copy), a stop said in a folder that does
# not hold the clone's yes reached it only once another folder's hook started one, as a stopped folder's
# hooks start none (covered_here): the server kept that worktree's list until 24 hours after the last report,
# though the privacy page says at once (the promise check's gap 3, d40). Then the token the clone reports with
# gives up all it said, now, in the background, and the next worker sends every list again in full, without
# this worktree. So does the token the room last heard the clone's lists from (sentwith), when the clone's yes
# moved since and no worker has reported with the new one (the 0.3.26 review's promise:1).
stop_unheard() {
  local y='' s='' pid=''
  [ -n "$CLONE" ] || return 0
  [ -f "$CLONE/yes" ] && read -r y < "$CLONE/yes"
  [ -f "$CLONE/sentwith" ] && read -r s < "$CLONE/sentwith"
  [ -n "$y$s" ] || return 0
  [ -f "$CLONE/lock/pid" ] && read -r pid < "$CLONE/lock/pid"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && return 0
  [ -n "$y" ] && give_up "$y" "$CLONE"
  [ -n "$s" ] && [ "$s" != "$y" ] && give_up "$s" "$CLONE"
  rm -f "$CLONE"/w/*.sent "$CLONE/sentwith"
}

# Tell the room that folder token $1 holds nothing of clone $2 any more: a report with no worktree in
# it, which the room takes as the token giving up what it said (the review's V1). In the background,
# so no hook waits on it; nothing to do if the clone never reported.
give_up() {
  local k="$1" d="$2" repo=''
  { [ -n "$k" ] && [ -s "$DATA/folders/$k/header" ] && [ -s "$d/repo" ]; } || return 0
  read -r repo < "$d/repo"
  [ -n "$repo" ] || return 0
  ( nohup curl -sS -m 10 -A "aisle-plugin/${VER:-0.0.0}" -o /dev/null -H "@$DATA/folders/$k/header" -H 'Content-Type: text/tab-separated-values' --data-binary "aisle-presence${TAB}1${NL}repo${TAB}${repo}${NL}" "${U%/watch}/presence" </dev/null >/dev/null 2>&1 & )
}

# Is version $1 older than $2? Dotted numbers, part by part, by bash alone; a missing part is 0.
older() {
  local a="$1" b="$2" x y
  while [ -n "$a$b" ]; do
    x="${a%%.*}"; y="${b%%.*}"
    [[ $x =~ ^[0-9]+$ ]] || x=0
    [[ $y =~ ^[0-9]+$ ]] || y=0
    [ "$x" -lt "$y" ] && return 0
    [ "$x" -gt "$y" ] && return 1
    case "$a" in *.*) a="${a#*.}" ;; *) a='' ;; esac
    case "$b" in *.*) b="${b#*.}" ;; *) b='' ;; esac
  done
  return 1
}

# Is this copy set aside (.orphaned_at) with no newer copy installed in its place: a release rolled back
# (D84)? Claude Code sets the copy before aside at every ordinary update too: on Ofir's PC every copy from
# 0.3.6 to 0.3.24 has one, written the second the next copy was made. As first written, 0.3.26 took any
# set-aside copy for a rollback and ended its worker, so at each update the lock was free for a moment, an
# old chat's next hook started an old worker again, and it ran until a newer chat's hook took it over; and
# when the newest copy failed its check, the chats that fell back to their own copy had no worker at all
# (the 0.3.26 review's xver:1 and xver:2). After an update the newer copy's worker takes the lock over
# (take_over), so the lock is never free. Bash alone, and a folder listing only for a copy set aside.
rolled_back() {
  local re='^([0-9]+)[.]([0-9]+)[.]([0-9]+)$' r="${ROOT%/}" name parent b='' v n me
  [ -e "$r/.orphaned_at" ] || return 1
  name="${r##*[!0-9.]}"
  [[ $name =~ $re ]] || return 0
  me=$((10#${BASH_REMATCH[1]} * 1000000 + 10#${BASH_REMATCH[2]} * 1000 + 10#${BASH_REMATCH[3]}))
  parent="${r%"$name"}"
  # Spelled with backslashes, as handover() may find it.
  case "$parent" in
    */) ;;
    *)
      [ -s "$DATA/backslash" ] || awk 'BEGIN { printf "%c", 92 }' > "$DATA/backslash"
      IFS= read -r -d '' b < "$DATA/backslash"
      parent="${parent//"$b"//}"
      ;;
  esac
  for v in "$parent"*; do
    [[ ${v##*/} =~ $re ]] || continue
    n=$((10#${BASH_REMATCH[1]} * 1000000 + 10#${BASH_REMATCH[2]} * 1000 + 10#${BASH_REMATCH[3]}))
    [ "$n" -gt "$me" ] && [ ! -e "$v/.orphaned_at" ] && return 1
  done
  return 0
}

# The clone's worker: started if it is not running, and told the clone is still in use. Any hook in a
# folder of the clone does this; the worker ends by itself 12 hours after the last one.
worker_up() {
  local pid='' v=''
  [ -n "$CLONE" ] || return 0
  recently_gone && return 0
  resting && return 0
  # A copy rolled back (D84) starts no worker: one would end at its first look (plugin_gone). A copy set
  # aside by an update does: a chat falls back to it only when the newer copy fails its check (ready).
  rolled_back && return 0
  # Never before its person was told what it shares (above NEWS_LINE).
  [ -f "$CLONE/told" ] || return 0
  [ -d "$CLONE" ] || mkdir -p "$CLONE" || return 0
  if [ ! -s "$CLONE/common" ]; then
    [ -n "$COMMON" ] || return 0
    put "$CLONE/common" "$COMMON"
  fi
  [ -s "$CLONE/salt" ] || put "$CLONE/salt" "$(head -c 16 /dev/urandom | b64url)"
  : 2>/dev/null > "$CLONE/beat"
  [ -f "$CLONE/lock/pid" ] && read -r pid < "$CLONE/lock/pid"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    # A worker from an older copy of the plugin ends at its next look, and this copy's worker, started
    # now, takes its lock over at once (worker_main), unless one does already. Never a newer one: chats
    # opened before an update run the old copy, and the two stopped each other's worker in turn (the
    # review's P7).
    [ -f "$CLONE/lock/ver" ] && read -r v < "$CLONE/lock/ver"
    older "$v" "${VER:-0.0.0}" || return 0
    : 2>/dev/null > "$CLONE/lock/stop"
    [ -d "$CLONE/lock/take" ] && return 0
  fi
  # Detached twice, so no pipe of this hook stays open (Claude Code would wait on it), and this hook
  # ending, or being stopped, does not end the worker.
  ( nohup bash "$SELF" --worker "$CLONE" </dev/null >/dev/null 2>&1 & )
}

# Where the notes on one worktree are: its name to the room (a hash with this clone's own salt, so the
# name says nothing of where it is), its folder's notes and its git dir, into WID, WFOLDER and WGD.
# Worked out the first time a path is seen and kept in the clone's notes. The worker reads those notes
# once and keeps them by the letters of each path (see yes_key), as bash variables: a line is never changed
# once written, and read again for every worktree at every pass they cost 2.1 s of a pass on Ofir's PC.
known() {
  local id sp v l hits
  WID='' WFOLDER='' WGD=''
  if [ -z "$KNOWN_READ" ]; then
    KNOWN_READ=1
    slurp "$c/known"
    lines_of hits
    for l in "${hits[@]}"; do known_keep "$l"; done
  fi
  yes_key "$1"
  v="AISLE_KNOWN_$key"
  SL="${!v}"
  if [ -n "$SL" ]; then
    lines_of hits
    for l in "${hits[@]}"; do
      [ "${l%%"$TAB"*}" = "$1" ] || continue
      l="${l#*"$TAB"}"; WID="${l%%"$TAB"*}"
      l="${l#*"$TAB"}"; WFOLDER="${l%%"$TAB"*}"
      WGD="${l#*"$TAB"}"
      return 0
    done
  fi
  case "$1" in *"$TAB"*|*"$NL"*) return 1 ;; esac
  WGD=$(git -C "$1" rev-parse --absolute-git-dir 2>/dev/null) || return 1
  sp=$(spell "$1")
  WID=$(printf 'aisle-worktree:%s:%s' "$salt" "$sp" | sha | cut -c1-16)
  folder_of "$1" "$sp"
  WFOLDER="$FO"
  l="$1$TAB$WID$TAB$WFOLDER$TAB$WGD"
  printf '%s%s' "$l" "$NL" >> "$c/known"
  known_keep "$l"
}
known_keep() {
  local v
  yes_key "${1%%"$TAB"*}"
  v="AISLE_KNOWN_$key"
  printf -v "$v" '%s%s%s' "${!v}" "$1" "$NL"
}

# The committed part of a worktree's unmerged paths against the base: one line each, newest first, of
# how many commits changed it, the newest 8 of them, and the path, tab-separated. A path counts when
# base..HEAD changed it and it still differs both from where the branch left the base and from the base
# itself, so a change that was reverted, or merged already as a squash, is not said.
committed() {
  local w="$1" head="$2" mb="$3" t="$TMP"
  git -C "$w" -c core.quotePath=off diff --no-color --no-ext-diff --name-only --no-renames "$mb" "$head" > "$t/1" 2>/dev/null || return 1
  git -C "$w" -c core.quotePath=off diff --no-color --no-ext-diff --name-only --no-renames "$base" "$head" > "$t/2" 2>/dev/null || return 1
  git -C "$w" -c core.quotePath=off log --no-color --no-show-signature --no-renames --abbrev=12 --format=%x09%h --name-only "$base..$head" > "$t/3" 2>/dev/null || return 1
  # Any awk: no arrays sorted, no lengths of arrays, every comparison a string one.
  LC_ALL=C awk '
    BEGIN { T = sprintf("%c", 9); k = 0 }
    part == 1 { if ($0 != "") a[$0] = 1; next }
    part == 2 { if ($0 != "") b[$0] = 1; next }
    substr($0, 1, 1) == T { id = substr($0, 2); next }
    $0 == "" || !($0 in a) || !($0 in b) || (($0, id) in had) { next }
    {
      had[$0, id] = 1
      if (!($0 in n)) { order[++k] = $0; n[$0] = 0 }
      if (++n[$0] <= 8) ids[$0] = ids[$0] "," id
    }
    END { for (i = 1; i <= k; i++) print n[order[i]] T substr(ids[order[i]], 2) T order[i] }
  ' part=1 "$t/1" part=2 "$t/2" part=3 "$t/3"
}

# A worktree's list as the room hears it, from its committed part and its git status, one line each:
# f, its commits ("wip" first for a change not committed yet), the path, tab-separated. Paths git has
# to quote (a tab, a quote or a newline in the name) and Unity's .meta files are left out, and so is
# everything past the first 512. Into the file $3, the same list with only what its commits changed, for
# a worktree that has not moved for STALE_DAYS days (chosen); into $4, the files of the list it has not
# committed that are there to be looked at (active): a deleted one has no time to read.
listed() {
  AISLE_Q="$3" AISLE_F="$4" LC_ALL=C awk '
    BEGIN { T = sprintf("%c", 9); Q = sprintf("%c", 34); FS = T; k = 0; out = 0; qf = ENVIRON["AISLE_Q"]; ff = ENVIRON["AISLE_F"]; printf "" > qf; printf "" > ff }
    part == 1 { order[++k] = $3; n[$3] = $1; ids[$3] = $2; next }
    {
      # git status --porcelain=v2: "1 XY sub mH mI mW hH hI path", "u XY sub m1 m2 m3 mW h1 h2 h3 path".
      t = substr($0, 1, 2)
      if (t == "1 ") skip = 8
      else if (t == "u ") skip = 10
      else next
      p = $0
      for (i = 0; i < skip; i++) p = substr(p, index(p, " ") + 1)
      if (p == "" || (p in wip)) next
      wip[p] = 1
      if (index(substr($0, 3, 2), "D") > 0) gone[p] = 1
      if (!(p in n)) { order[++k] = p; n[p] = 0; ids[p] = "" }
    }
    END {
      for (i = 1; i <= k && out < 512; i++) {
        p = order[i]
        if (substr(p, 1, 1) == Q || p ~ /[.]meta$/) continue
        fit = (p in wip) ? 7 : 8
        s = (p in wip) ? "wip" : ""
        m = split(ids[p], x, ",")
        for (j = 1; j <= m && j <= fit; j++) s = s (s == "" ? "" : ",") x[j]
        if (n[p] > fit) s = s ",+"
        print "f" T s T p
        out++
        if (p in wip) { if (!(p in gone)) print p > ff; s = substr(s, 5) }
        if (s != "") print "f" T s T p > qf
      }
    }' part=1 "$1" part=2 "$2"
}

# The hashes of a worktree's list and of its list of commits alone, 16 hex digits each, into hash and
# qhash ("-" for the second when its commits changed nothing), by one program. A line of sha256sum's
# starts with a backslash when the file's name has one. "$L.h" keeps the list's hash alone, as 0.3.24
# wrote it: a 0.3.24 worker on the same computer (an old chat's, open for days, D84) reads that whole
# line as the hash it sends, and the room read none of a report where it was two (the combo review's
# upgrade:0). qhash goes in "$L.qh", a note 0.3.24 never reads, after the list's hash it was made
# with, so a list 0.3.24 rewrote since is known by its hash (one_worktree). With $1 set, "$L.q" was not
# made from this list in this pass, and "$L.qh" is not written, so the next pass makes it again.
hashes() {
  local out
  out=$(sha_files "$L" "$L.q" 2>/dev/null)
  hash="${out%%"$NL"*}"; hash="${hash#[!0-9a-f]}"; hash="${hash:0:16}"
  qhash="${out#*"$NL"}"; qhash="${qhash#[!0-9a-f]}"; qhash="${qhash:0:16}"
  [[ $hash =~ ^[0-9a-f]{16}$ ]] || hash=$(sha < "$L" | cut -c1-16)
  [ -s "$L.q" ] && [[ $qhash =~ ^[0-9a-f]{16}$ ]] || qhash=-
  keep "$L.h" "$hash"
  [ -n "$1" ] || keep "$L.qh" "$hash $qhash"
  OWN=1
}

# A git status without its "# branch." lines, into BODY: a fetch changes "# branch.ab", which is not the
# worktree moving.
body() {
  BODY="$1"
  while [ "${BODY:0:2}" = "# " ]; do
    case "$BODY" in *"$NL"*) BODY="${BODY#*"$NL"}" ;; *) BODY='' ;; esac
  done
}

# What changed between two lists, into the record: a line for each that came (+) or went (-), from
# its field $5 on. $1 the list before (it may not exist), $2 the list now, $3 the writer, $4 what it
# is, $6 a field said before the rest.
changes() {
  local before=/dev/null
  [ -f "$1" ] && before="$1"
  stamp
  logto "$3" "$4" || return 0
  LC_ALL=C awk -v pre="$NOW$TAB$4${6:+$TAB$6}" -v from="$5" '
    BEGIN { T = sprintf("%c", 9) }
    function rest(l,   i) { for (i = 1; i < from; i++) l = substr(l, index(l, T) + 1); return l }
    part == 1 { old[$0] = 1; next }
    { if ($0 in old) delete old[$0]; else print pre T "+" T rest($0) }
    END { for (l in old) print pre T "-" T rest(l) }
  ' part=1 "$before" part=2 "$2" >> "$LOGF"
}

# When a worktree last moved (0.3.25), in seconds, into ACT. Kept in "$L.a" as "<when> <looked> <head>",
# the note's own time being when it was last looked at. It moved, at this pass, when its head is not the
# one kept (a commit, a checkout, a reset), when its git status moved (MOVED), or when a file it has not
# committed is newer than the note. Never by its reflog file's time: a git gc, a git maintenance run or a
# reflog expire rewrites every worktree's logs/HEAD, and 3 days of every worktree came back as moved (the
# review's F5). The reflog is read once, at a worktree's first look, and then for the time its last entry
# itself says. The files are looked at again once in each ACTIVE_LOOK seconds: in Git Bash one test of a
# file's time costs about 0.3 ms, and 1 ms for one that is not there (measured 2026-10-20), and Ofir's
# clone has 7,342 files not committed across 58 worktrees. Each worktree looks at its own moment of those
# 10 minutes, set by its id, so the looks spread over the passes rather than all falling in the same one
# (7 s of a pass on Ofir's PC). Bash's own tests, but a worktree's first look, which reads its newest
# file's time with one program.
ACTIVE_LOOK=600
active() {
  local w="$1" a="$L.a" at='' looked='' was='' p new='' f='' off=0 list r ep='' t
  [ -f "$a" ] && read -r at looked was < "$a"
  { [[ $at =~ ^[0-9]+$ ]] && [[ $looked =~ ^[0-9]+$ ]]; } || at=''
  if [ -n "$at" ]; then
    ACT=$at
    # A note from before the head was kept in it has none to compare: the files and MOVED say. EDITED
    # holds the worktrees Claude was about to edit a file in since the last pass (presence_note).
    if [ -n "$MOVED" ] || { [ -n "$was" ] && [ "$was" != "$head" ]; }; then new=1
    elif [[ $EDITED == *"$NL$WID$NL"* ]]; then new=1
    else
      [[ ${WID:0:3} =~ ^[0-9a-f]+$ ]] && off=$(( 16#${WID:0:3} % ACTIVE_LOOK ))
      [ "$PASS_AT" -ge "$looked" ] && [ $(( (PASS_AT + off) / ACTIVE_LOOK )) -eq $(( (looked + off) / ACTIVE_LOOK )) ] && [ "$was" = "$head" ] && return 0
      slurp "$L.f"
      lines_of list
      for p in "${list[@]}"; do [ "$w/$p" -nt "$a" ] && { new=1; break; }; done
    fi
    [ -n "$new" ] && ACT=$PASS_AT
  else
    # The reflog's last line, "<old> <new> <name> <email> <time> <zone>", a tab and what it did: its time,
    # which a gc keeps as it was. Its last 4 KB are enough for one line. With no reflog (it can be turned
    # off), the time of the HEAD file, which a gc does not write.
    slurp "$WGD/logs/HEAD"
    r="$SL"
    [ "${#r}" -gt 4096 ] && r="${r: -4096}"
    case "$r" in *"$NL"*) r="${r##*"$NL"}" ;; *) [ "${#SL}" -gt 4096 ] && r='' ;; esac
    r="${r%%"$TAB"*}"; r="${r% *}"; ep="${r##* }"
    [[ $ep =~ ^[0-9]+$ ]] || { ep=''; [ -f "$WGD/HEAD" ] && f="$WGD/HEAD"; }
    slurp "$L.f"
    lines_of list
    for p in "${list[@]}"; do
      if [ -n "$f" ]; then [ "$w/$p" -nt "$f" ] && f="$w/$p"; else [ -e "$w/$p" ] && f="$w/$p"; fi
    done
    ACT=$ep
    if [ -n "$f" ]; then
      # GNU's date, and BSD's since 2015, then BSD's stat. A time neither can read is now: a worktree is
      # never left out for want of one.
      t=$(date -r "$f" +%s 2>/dev/null) || t=''
      [[ $t =~ ^[0-9]+$ ]] || t=$(stat -f %m "$f" 2>/dev/null) || t=''
      [[ $t =~ ^[0-9]+$ ]] || t=$PASS_AT
      { [ -z "$ACT" ] || [ "$t" -gt "$ACT" ]; } && ACT=$t
    fi
    [ -n "$ACT" ] || ACT=$PASS_AT
  fi
  keep "$a" "$ACT $PASS_AT $head"
}

# One look at a worktree: its list kept in the clone's notes, and a line for the report to come. What a
# pass gathers goes into COVERED, INDEX, WTS, ACTS and CURRENT, each written once after the pass (pass),
# and the worktrees that said stop into STOPS, for the report.
one_worktree() {
  local w="$1" L line head='' mb key='' st='' seen='' was='' hash='' qhash='' more='' made='' OWN='' sn
  MOVED=''
  [ -d "$w" ] || return 0
  known "$w" || return 0
  CURRENT="$CURRENT$w$TAB$WID$TAB$WFOLDER$TAB$WGD$NL"
  # Left out when its own folder said stop, whoever said yes for the clone, and named to the room as one to
  # forget (report).
  [ -f "$WFOLDER/stopped" ] && { STOPS="$STOPS$WID$NL"; return 0; }
  COVERED="$COVERED$w$NL"
  yes_key "$w"
  INDEX="$INDEX$key$TAB$WID$NL"
  { [ -n "$base" ] && [ -z "$shallow" ]; } || return 0
  L="$c/w/$WID"
  # This copy's notes on the list ("$L.q", "$L.f", "$L.qh") stand only for the list they were made from.
  # A 0.3.24 pass rewrites the list and "$L.h", never them, so they are made again from the list when
  # "$L.qh" was made with another list than "$L.h" names, or there is none, or "$L.h" holds two hashes
  # (as 0.3.25 first wrote it): never trusted as they are (the combo review's merge:1).
  # No test first: in Git Bash a test of a file costs about as much as reading it, and a note that is not
  # there leaves the names empty, which is not this copy's own (the worker's errors go nowhere).
  read -r hash more < "$L.h"
  read -r made qhash < "$L.qh"
  [ -n "$hash" ] && [ -z "$more" ] && [ "$made" = "$hash" ] && [ -n "$qhash" ] && OWN=1
  if [ -f "$WGD/MERGE_HEAD" ] || [ -f "$WGD/CHERRY_PICK_HEAD" ] || [ -f "$WGD/REVERT_HEAD" ] || [ -d "$WGD/rebase-merge" ] || [ -d "$WGD/rebase-apply" ]; then
    # Halfway through a merge or a rebase the index holds the other side's changes too, so the room
    # keeps what this worktree had before it began.
    [ -f "$L" ] || return 0
    [ -f "$L.k" ] && read -r head mb < "$L.k"
  else
    # Straight from git: bash reads what a program prints in blocks, on every bash, and this starts no
    # process more than the git. Written out for listed() only when the list is made again.
    st=$(git --no-optional-locks -C "$w" -c core.quotePath=off status --porcelain=v2 --branch --no-renames -uno --ignore-submodules 2>/dev/null) || return 0
    line="${st%%"$NL"*}"
    head="${line#"# branch.oid "}"
    { [ "$head" != "$line" ] && [ "$head" != "(initial)" ]; } || return 0
    # This copy's own last look ("$L.sn"), which 0.3.24 never writes: a move only a 0.3.24 pass saw is
    # still a move here, and "$L.f" is made again. "$L.seen" when there is none yet (just upgraded). Read
    # once in a worker's life and then kept in memory with it, as "=" and the look, so a quiet pass reads
    # no note at all: on a bash older than 5.2 each read of one forks (slurp).
    sn="AISLE_SN_$WID"
    seen="${!sn}"
    if [ -n "$seen" ]; then seen="${seen#=}"
    else
      slurp "$L.sn"
      [ -n "$SL" ] || slurp "$L.seen"
      seen="$SL"
      printf -v "$sn" '=%s' "$seen"
    fi
    # The worktree itself moved, not just the base or its upstream: a file changed, was deleted, was
    # staged. Then when it last moved is this pass (active); a commit or a checkout moves its head.
    was="${seen#*"$NL"}"
    if [ "$st" != "$was" ]; then body "$was"; was="$BODY"; body "$st"; [ "$BODY" = "$was" ] || MOVED=1; fi
    # Nothing moved since the last look, neither this worktree nor the base: its list stands.
    if [ -z "$OWN" ] || [ "$base$NL$st" != "$seen" ] || [ ! -f "$L" ] || [ ! -f "$L.q" ]; then
      [ -f "$L.k" ] && IFS= read -r key < "$L.k"
      if [ "$key" != "$head $base" ] || [ ! -f "$L.c" ]; then
        # An orphan branch has nothing to be merged into the base, and so nothing to say.
        mb=$(git -C "$w" merge-base "$base" "$head" 2>/dev/null) || return 0
        committed "$w" "$head" "$mb" > "$TMP/c" || return 0
        mv -f "$TMP/c" "$L.c"
        keep "$L.k" "$head $base"
      fi
      printf '%s%s' "$st" "$NL" > "$TMP/st"
      listed "$L.c" "$TMP/st" "$TMP/q" "$TMP/f" > "$TMP/list" || return 0
      mv -f "$TMP/f" "$L.f"
      if same_file "$TMP/list" "$L" && [ -f "$L.q" ]; then
        rm -f "$TMP/list"
        # The list stands; this copy's notes on it are made again when they were not its own.
        if [ -n "$OWN" ]; then rm -f "$TMP/q"; else mv -f "$TMP/q" "$L.q"; hashes; fi
      else
        # Every change to what this worktree has unmerged goes into the record, with its commits.
        changes "$L" "$TMP/list" "clone-$CID" own 2 "$WID"
        mv -f "$TMP/list" "$L"
        mv -f "$TMP/q" "$L.q"
        hashes
        DIRTY=1
      fi
      # "$L.seen" exactly as 0.3.24 writes it (git's last newline kept), so a 0.3.24 pass reads it as
      # its own and does not list every worktree again.
      keep "$L.seen" "$base$NL$st$NL"
      keep "$L.sn" "$base$NL$st"
      printf -v "$sn" '=%s' "$base$NL$st"
    fi
  fi
  # Halfway through a merge the notes are kept as they are, and their hashes worked out for this pass.
  [ -n "$OWN" ] || hashes merging
  WTS="$WTS$WID$TAB$hash$TAB$head$TAB$WGD$NL"
  IDS="$IDS$WID "
  active "$w"
  ACTS="$ACTS$ACT$TAB$WID$TAB$qhash$NL"
}

# Which worktrees the room hears of (0.3.25), into "$TMP/send", one wts line each: the 32 it keeps of a
# clone (PRESENCE.WORKTREES), those that moved last first. One that has not moved for STALE_DAYS days is
# heard of by its commits alone: the files it has not committed are left out, so nobody is warned of work
# abandoned there, but a branch waiting to be merged still is (its line carries the hash of "$L.q" and
# ends in a tab and q). One with no commit to merge is left out, and counted; so are those past the 32.
# The counts go into "$c/counts" (all, sent, left out, past the 32, sent by their commits alone) for
# whoami's check, and into the record when they change. 0.3.24 sent the first 32 of git's list, the
# oldest: on Ofir's PC (2026-10-20) the 25 newest of 57 went unheard, the ones in use now among them,
# while old agent worktrees with 340 to 396 files not committed each filled the warnings (R27,
# live-git.md, Faults B and C). As first written, 0.3.25 left out a quiet branch's commits too (the
# review's correctness claim 2).
STALE_DAYS=3
chosen() {
  local all='' sent='' stale='' over='' quiet='' was=''
  # The counts' file by its name in the environment: a path given with -v loses its backslashes.
  AISLE_N="$TMP/n" LC_ALL=C awk -v now="$PASS_AT" -v old=$(( STALE_DAYS * 86400 )) -v cap=32 '
    BEGIN { T = sprintf("%c", 9); FS = T; k = 0; n = 0; st = 0; qs = 0 }
    part == 1 { at[$2] = $1 + 0; qh[$2] = $3; next }
    {
      n++
      a = ($1 in at) ? at[$1] : now + 0
      line = $0
      if (now - a >= old) {
        if (!(($1 in qh) && qh[$1] ~ /^[0-9a-f]+$/)) { st++; next }
        line = $1 T qh[$1] T $3 T $4 T "q"
      }
      # Newest first, by insertion: a clone has a few dozen worktrees. Equal times keep git order.
      for (i = ++k; i > 1 && t[i - 1] < a; i--) { t[i] = t[i - 1]; l[i] = l[i - 1] }
      t[i] = a; l[i] = line
    }
    END {
      for (i = 1; i <= k && i <= cap; i++) { print l[i]; if (substr(l[i], length(l[i]) - 1) == T "q") qs++ }
      printf "%d%s%d%s%d%s%d%s%d", n, T, (k < cap ? k : cap), T, st, T, (k > cap ? k - cap : 0), T, qs > ENVIRON["AISLE_N"]
    }' part=1 "$TMP/act" part=2 "$TMP/wts" > "$TMP/send" || cp "$TMP/wts" "$TMP/send"
  [ -f "$TMP/n" ] && IFS="$TAB" read -r all sent stale over quiet < "$TMP/n"
  [ -f "$c/counts" ] && IFS= read -r was < "$c/counts"
  [ "$all$TAB$sent$TAB$stale$TAB$over$TAB$quiet" = "$was" ] && return 0
  put "$c/counts" "$all$TAB$sent$TAB$stale$TAB$over$TAB$quiet"
  record "clone-$CID" sent "$all" "$sent" "$stale" "$over" "$quiet"
}

# One report to the room, for every worktree: in full when the room may not have its list, else its
# hash alone. Sets NEED to the worktrees the room asks for in full. The room's answer is kept as it
# came, but for when each was last reported, which changes at every pass.
report() {
  local wt hash head gd sent code etag='' line rest who other since ids role='' mode='' ver='' at='' n=0 answer send q stops
  NEED=''
  # A report the room refused as it was (too big, say) is not sent again for an hour: sent in full
  # every pass, it was refused every pass (the review's P6).
  if [ -f "$c/refused-at" ]; then
    read -r at < "$c/refused-at"
    case "$at" in ''|*[!0-9]*) at=0 ;; esac
    stamp
    [ $((NOW - at)) -lt 3600 ] && return 0
    rm -f "$c/refused-at"
  fi
  { printf 'aisle-presence%s1%s' "$TAB" "$NL"; printf 'repo%s%s%s' "$TAB" "$repo" "$NL"; } > "$TMP/report"
  # Every worktree of the clone whose own folder said stop, by its id alone, at every report: the room
  # forgets all it kept of it at once. Since d22 it keeps a worktree left out of a report until its list
  # would have run out (8 hours for what is not committed, 24 for commits), so leaving it out is not
  # enough for "saying stop makes the server forget that folder's lists at once". A room before d22 skips
  # the line. Never a w line for it.
  SL="$STOPS"
  lines_of stops
  for line in "${stops[@]}"; do printf 'x%s%s%s' "$TAB" "$line" "$NL"; done >> "$TMP/report"
  : > "$TMP/full"
  # The worktrees chosen for the room, 32 at most (chosen).
  slurp "$TMP/send"
  lines_of send
  for line in "${send[@]}"; do
    wt="${line%%"$TAB"*}"
    line="${line#*"$TAB"}"
    hash="${line%%"$TAB"*}"
    # One that has not moved for STALE_DAYS days: what its commits changed, alone (chosen).
    q=''
    case "$line" in *"${TAB}q") q=.q ;; esac
    n=$((n + 1))
    sent=''
    [ -f "$c/w/$wt.sent" ] && read -r sent < "$c/w/$wt.sent"
    if [ "$sent" = "$hash" ]; then
      printf 'w%s%s%s%s%ssame%s' "$TAB" "$wt" "$TAB" "$hash" "$TAB" "$NL" >> "$TMP/report"
    else
      printf 'w%s%s%s%s%sfull%s' "$TAB" "$wt" "$TAB" "$hash" "$TAB" "$NL" >> "$TMP/report"
      cat "$c/w/$wt$q" >> "$TMP/report"
      printf '%s%s%s%s' "$wt" "$TAB" "$hash" "$NL" >> "$TMP/full"
    fi
  done
  [ -f "$c/etag" ] && read -r etag < "$c/etag"
  code=$(curl -sS -m 20 -A "aisle-plugin/${VER:-0.0.0}" -o "$TMP/answer" -w '%{http_code}' -H "@$DATA/folders/$yes/header" -H 'Content-Type: text/tab-separated-values' -H "If-None-Match: ${etag:--}" --data-binary "@$TMP/report" "${U%/watch}/presence" 2>/dev/null)
  case "$code" in
    200|304)
      # The token the room now holds this clone's lists under, kept in the clone's notes too (sentwith).
      [ "$SENTWITH" = "$yes" ] || { SENTWITH="$yes"; put "$c/sentwith" "$yes"; }
      # The room has every list sent in full now.
      while IFS="$TAB" read -r wt hash; do keep "$c/w/$wt.sent" "$hash"; done < "$TMP/full"
      if [ "$code" = 200 ]; then
        : > "$TMP/heard"
        slurp "$TMP/answer"
        lines_of answer
        for line in "${answer[@]}"; do
          case "$line" in
            "e$TAB"*)
              # e <who> <worktree> <reported> <since> <commits> <path>, the path last.
              rest="${line#e"$TAB"}"
              who="${rest%%"$TAB"*}"; rest="${rest#*"$TAB"}"
              other="${rest%%"$TAB"*}"; rest="${rest#*"$TAB"}"
              rest="${rest#*"$TAB"}"
              since="${rest%%"$TAB"*}"; rest="${rest#*"$TAB"}"
              ids="${rest%%"$TAB"*}"; rest="${rest#*"$TAB"}"
              printf 'e%s%s%s%s%s%s%s%s%s%s%s' "$TAB" "$who" "$TAB" "$other" "$TAB" "$since" "$TAB" "$ids" "$TAB" "$rest" "$NL"
              # And without the name, for the record.
              printf '%s%s%s%s%s%s%s%s' "$other" "$TAB" "$since" "$TAB" "$ids" "$TAB" "$rest" "$NL" >&3
              ;;
            "role$TAB"*) role="${line#role"$TAB"}" ;;
            "mode$TAB"*) mode="${line#mode"$TAB"}" ;;
            "version$TAB"*) ver="${line#version"$TAB"}" ;;
            "need$TAB"*) NEED="$NEED ${line#need"$TAB"}" ;;
          esac
        done > "$TMP/heard" 3> "$TMP/heard.k"
        # The answer as it came carries names: it is not kept past this pass.
        : > "$TMP/answer"
        NEED="${NEED//[!0-9a-f ]/}"
        if ! same_file "$TMP/heard" "$c/answer"; then
          # Everything heard of the others goes into the record too, without their names: what changed
          # since the last answer. That one is kept without names when the worker ends, so a new worker
          # records only what changed, not the whole room again (the review's P7).
          if ! same_file "$TMP/heard.k" "$c/heard.k"; then
            changes "$c/heard.k" "$TMP/heard.k" "clone-$CID" heard 1
            mv -f "$TMP/heard.k" "$c/heard.k"
          fi
          mv -f "$TMP/heard" "$c/answer"
          DIRTY=1
        fi
        keep "$c/etag" "$ver"
        note "$c/role" "${role//[!a-z]/}"
        note "$c/mode" "$mode"
      fi
      ;;
    400|404|413)
      # 404: a room from before 0.3.7, with no /presence yet (the second fix check). Either way the same
      # report would meet the same answer at every pass.
      stamp
      keep "$c/refused-at" "$NOW"
      if [ "$code" = 404 ]; then log "presence: the room cannot take reports yet (HTTP 404); sent again in an hour"
      else log "presence: the room refused this clone's report (HTTP $code); sent again in an hour"; fi
      ;;
    401)
      # The room does not know that folder's token any more. The folder's own listener finds out and
      # says so; until it is said yes again there, the clone is not given back to it.
      log "presence: the room refused the token this clone reports with"
      : 2>/dev/null > "$DATA/folders/$yes/refused"
      rm -f "$c/yes"
      exit 0
      ;;
  esac
  local was=''
  [ -f "$c/code" ] && read -r was < "$c/code"
  if [ "$code" != "$was" ]; then
    log "presence: the room answered HTTP ${code:-none} for $n of $(grep -c '' "$TMP/wts") worktree(s)"
    keep "$c/code" "$code"
  fi
}

# Waits for the program $1 while the table's time lasts (TABLE_FROM, TABLE_SECONDS), and ends it then.
waited() {
  while kill -0 "$1" 2>/dev/null; do
    if [ $(( SECONDS - TABLE_FROM )) -ge "$TABLE_SECONDS" ]; then kill "$1" 2>/dev/null; wait "$1" 2>/dev/null; return 1; fi
    sleep 0.2 2>/dev/null || sleep 1
  done
  wait "$1"
}

# The clone's co-change lists, from its own history (D46): RIGGS's lists, by partners.awk beside this
# script, given TABLE_SECONDS at most. Built again when the base moves, but at most once a day
# (TABLE_MINUTES): the lists hardly change between fetches, and a history with one big commit can keep
# a core busy for minutes (the review's P4). At the lowest priority where nice exists. One that ran out
# of time or failed is tried again a day later too, so a project too big for it costs nothing more.
table() {
  local head='' at=0 ok='' nice=''
  [ -f "$c/table.head" ] && read -r head < "$c/table.head"
  [ "$head" = "$base" ] && return 0
  [ -f "$ROOT/scripts/partners.awk" ] || return 0
  stamp
  [ -f "$c/table.at" ] && read -r at < "$c/table.at"
  [[ $at =~ ^[0-9]+$ ]] || at=0
  [ $(( NOW - at )) -lt $(( TABLE_MINUTES * 60 )) ] && return 0
  keep "$c/table.at" "$NOW"
  command -v nice >/dev/null 2>&1 && nice='nice -n 19'
  TABLE_FROM=$SECONDS
  $nice git -C "$main" -c core.quotePath=off ls-tree -r --name-only "$base" > "$TMP/files" 2>/dev/null &
  if waited $!; then
    $nice git -C "$main" -c core.quotePath=off -c log.showRoot=true log --no-color --no-show-signature --no-renames --name-only --format=%x09 "$base" > "$TMP/history" 2>/dev/null &
    if waited $!; then
      LC_ALL=C $nice awk -f "$ROOT/scripts/partners.awk" part=1 "$TMP/files" part=2 "$TMP/history" > "$TMP/table" 2>/dev/null &
      waited $! && ok=1
    fi
  fi
  TABLE_TOOK=$(( SECONDS - TABLE_FROM ))
  rm -f "$TMP/history"
  if [ -z "$ok" ]; then
    rm -f "$TMP/table"
    log "presence: no co-change table for this clone after ${TABLE_TOOK} s; tried again in a day"
    return 0
  fi
  mv -f "$TMP/table" "$c/table"
  put "$c/table.head" "$base"
  record "clone-$CID" table "$base" "$TABLE_TOOK" "$(grep -c '' "$c/table")"
  DIRTY=1
}

# What each worktree is to be warned of (D46), from the room's answer: every other worktree's unmerged
# path whose commits this worktree's history does not have yet ("wip" never), as the file itself, and
# every file that usually changes together with it by this clone's table, unless this worktree changed
# it itself. Nothing in it is a path that cannot be printed. One line each, the edited file first:
#   <file> <other file> same|co <commits> <since, s> <other worktree> <who>
warnings() {
  local wt hash head gd mh key cov line all
  [ -d "$c/warn" ] || mkdir "$c/warn" 2>/dev/null || return 0
  slurp "$TMP/wts"
  lines_of all
  for line in "${all[@]}"; do
    wt="${line%%"$TAB"*}"; line="${line#*"$TAB"}"
    hash="${line%%"$TAB"*}"; line="${line#*"$TAB"}"
    head="${line%%"$TAB"*}"; gd="${line#*"$TAB"}"
    if [ ! -s "$c/answer" ]; then : > "$c/warn/$wt"; continue; fi
    # The commits this worktree has: its own, the base's, and the other side of a merge under way.
    mh=''
    [ -f "$gd/MERGE_HEAD" ] && read -r mh < "$gd/MERGE_HEAD"
    key=''
    [ -f "$c/w/$wt.rk" ] && IFS= read -r key < "$c/w/$wt.rk"
    if [ "$key" != "$head $base $mh" ]; then
      git -C "$main" rev-list $head $base $mh > "$c/w/$wt.r" 2>/dev/null || : > "$c/w/$wt.r"
      keep "$c/w/$wt.rk" "$head $base $mh"
    fi
    # The cover's file by its name in the environment: a path given with -v loses its backslashes.
    AISLE_COV="$TMP/cov" LC_ALL=C awk -v me="$wt" '
      BEGIN {
        T = sprintf("%c", 9); FS = T; ne = 0; nw = 0; nt = 0
        # What a printed path or name may never hold: a quote, a backslash, a dollar, a backquote.
        BAD[1] = sprintf("%c", 34); BAD[2] = sprintf("%c", 92); BAD[3] = sprintf("%c", 36); BAD[4] = sprintf("%c", 96)
      }
      function unsafe(s,   i) { if (s ~ /[[:cntrl:]]/) return 1; for (i = 1; i <= 4; i++) if (index(s, BAD[i])) return 1; return 0 }
      function clean(s,   i, at) { gsub(/[[:cntrl:]]/, "", s); for (i = 1; i <= 4; i++) while ((at = index(s, BAD[i])) > 0) s = substr(s, 1, at - 1) substr(s, at + 1); return s }
      part == 1 { have[substr($0, 1, 12)] = 1; next }
      part == 2 { if ($1 == "f") mine[$3] = 1; next }
      part == 3 {
        # e <who> <worktree> <since> <commits> <path>
        if ($1 != "e" || NF != 6 || $3 == me || unsafe($6)) next
        if ($3 !~ /^[0-9a-f]+$/ || $4 !~ /^[0-9]+$/ || $5 !~ /^[0-9a-z,+]+$/) next
        n = split($5, x, ",")
        live = 0
        for (i = 1; i <= n; i++) if (x[i] != "+" && (x[i] == "wip" || !(substr(x[i], 1, 12) in have))) live = 1
        if (!live || (($6, $5) in seen)) next
        seen[$6, $5] = 1
        ne++
        ec[ne] = $6
        who = clean($2)
        er[ne] = $5 T $4 T $3 T (who == "" ? "someone" : who)
        if (!($6 in mine)) want[$6] = 1
        next
      }
      {
        # The table: a file, and one of its 10 best partners. Coupled either way round.
        if (!($1 in files)) { files[$1] = 1; nt++ }
        if ($2 in want) g[$2] = g[$2] T $1
        if ($1 in want) g[$1] = g[$1] T $2
      }
      END {
        for (e = 1; e <= ne; e++) {
          c = ec[e]
          print c T c T "same" T er[e]
          if (!(c in g)) continue
          m = split(substr(g[c], 2), gs, T)
          for (i = 1; i <= m; i++) {
            if (gs[i] == c || ((gs[i], e) in done) || unsafe(gs[i])) continue
            done[gs[i], e] = 1
            if (!(gs[i] in warned)) { warned[gs[i]] = 1; nw++ }
            print gs[i] T c T "co" T er[e]
          }
        }
        printf "%d%s%d", nw, T, nt > ENVIRON["AISLE_COV"]
      }' part=1 "$c/w/$wt.r" part=2 "$c/w/$wt" part=3 "$c/answer" part=4 "$tablefile" > "$c/warn/$wt.$$" || continue
    mv -f "$c/warn/$wt.$$" "$c/warn/$wt"
    # How much of the tree it covers, to see a file everything changes with.
    cov=''
    [ -f "$TMP/cov" ] && IFS= read -r cov < "$TMP/cov"
    record "clone-$CID" cover "$wt" "${cov%%"$TAB"*}" "${cov#*"$TAB"}"
  done
}

# One pass of the worker: every worktree of the clone looked at, one report, and, when anything it
# depends on moved, the warnings worked out again.
pass() {
  local common salt yes='' main='' line w='' base='' r='' shallow='' repo='' first f id wts='' tablefile=/dev/null idx='' wl
  DIRTY=''
  # Its notes deleted under it: it ends, and makes none of them again.
  [ -s "$c/common" ] || exit 0
  read -r common < "$c/common"
  read -r salt < "$c/salt"
  read -r yes < "$c/yes"
  if [ ! -s "$DATA/folders/$yes/token" ]; then rm -f "$c/yes"; return 0; fi
  header_of "$DATA/folders/$yes"
  # The yes moved to another folder of the clone: the token reported with before gives its lists up,
  # or the room hears every worktree twice for a day, the stopped one too. Also when it moved while no
  # worker ran: the token comes from the clone's notes then (worker_main).
  if [ -n "$SENTWITH" ] && [ "$SENTWITH" != "$yes" ]; then give_up "$SENTWITH" "$c"; SENTWITH=''; rm -f "$c/sentwith"; fi
  if [ ! -d "$common" ] || ! git -C "$common" worktree list --porcelain > "$TMP/wl" 2>/dev/null; then
    log "presence: the clone at $common is gone; asked again in a day"
    stamp
    keep "$c/gone" "$NOW"
    rm -f "$c/yes"
    exit 0
  fi
  [ -f "$c/gone" ] && rm -f "$c/gone"
  slurp "$TMP/wl"
  lines_of wl
  for line in "${wl[@]}"; do
    case "$line" in "worktree "*) main="${line#worktree }"; break ;; esac
  done
  # The base: what the clone merges into. Its own setting first, then the remote's default branch. The
  # name is looked up once, and again when the clone's settings change; where it points, every pass.
  [ -f "$c/base-ref" ] && [ ! "$common/config" -nt "$c/base-ref" ] && read -r r < "$c/base-ref"
  [ -n "$r" ] && { base=$(git -C "$main" rev-parse -q --verify "$r^{commit}" 2>/dev/null) || base=''; }
  if [ -z "$base" ]; then
    for r in $(git -C "$main" config --get aisle.base 2>/dev/null) origin/HEAD origin/main origin/master; do
      base=$(git -C "$main" rev-parse -q --verify "$r^{commit}" 2>/dev/null) && break
      base=''
    done
    [ -n "$base" ] && keep "$c/base-ref" "$r"
  fi
  # A shallow clone has no history to tell a change from the base by.
  [ -f "$common/shallow" ] && shallow=1
  [ -s "$c/repo" ] && read -r repo < "$c/repo"
  if [ -z "$repo" ]; then
    # A clone with no commit yet has no name for the project: it rests, below, as one with no base.
    first=$(git -C "$main" rev-list --max-parents=0 HEAD 2>/dev/null | tail -n 1)
    if [ -n "$first" ]; then
      repo=$(printf 'aisle-repo:%s' "$first" | sha | cut -c1-32)
      keep "$c/repo" "$repo"
    fi
  fi
  [ -d "$c/w" ] || mkdir "$c/w" 2>/dev/null || exit 0
  # This pass's time, for when each worktree last moved (active, chosen).
  stamp
  PASS_AT=$NOW
  COVERED='' INDEX='' WTS='' ACTS='' IDS='' EDITED='' STOPS='' CURRENT=''
  # The worktrees an edit hook said Claude was about to edit a file in since the last pass (presence_note):
  # each moved now, though its git status may not show it (a file already not committed, a new one).
  if [ -s "$c/edited" ] && mv -f "$c/edited" "$TMP/edited" 2>/dev/null; then slurp "$TMP/edited"; EDITED="$NL$SL$NL"; fi
  # One record each, from its "worktree" line to the next one's: the empty lines between them are gone.
  w=''
  for line in "${wl[@]}"; do
    case "$line" in
      "worktree "*) [ -n "$w" ] && one_worktree "$w"; w="${line#worktree }" ;;
      bare|prunable*) w='' ;;
    esac
  done
  [ -n "$w" ] && one_worktree "$w"
  printf '%s' "$WTS" > "$TMP/wts"
  printf '%s' "$ACTS" > "$TMP/act"
  # The worktrees an edit is heard from: in the list the edit hook reads first.
  slurp "$c/covered"
  if [ ! -f "$c/covered" ] || [ "$SL" != "${COVERED%"$NL"}" ]; then
    put "$c/covered" "$COVERED"
    yes_index
  fi
  # The clone's worktrees now, those that said stop too, as known spells them: the ones an edit is matched
  # to (worktree_of). known keeps every worktree it ever had.
  slurp "$c/current"
  if [ ! -f "$c/current" ] || [ "$SL" != "${CURRENT%"$NL"}" ]; then put "$c/current" "$CURRENT"; fi
  # And how an edit hook finds its own worktree's warnings: by the letters of its root.
  [ -d "$c/warn" ] || mkdir "$c/warn" 2>/dev/null || exit 0
  slurp "$c/warn/index"
  if [ ! -f "$c/warn/index" ] || [ "$SL" != "${INDEX%"$NL"}" ]; then put "$c/warn/index" "$INDEX"; DIRTY=1; fi
  # A shallow clone, or one with no base branch, has nothing to tell the room: no change of it can be
  # told from a base, so no list is made and no warning can be worked out. Its worktrees are covered for
  # edits (above), and the worker ends rather than ask the room every pass for the others' lists, names
  # and all, for nothing. The next hook looks again in a day, or at once after a new yes. Lists it sent
  # before, when it had a base, are given up. So does a clone with no commit yet, which went round every
  # pass, a few git programs each time, for 12 hours after its last use (the second fix check).
  if [ -z "$base" ] || [ -n "$shallow" ] || [ -z "$repo" ]; then
    for f in "$c"/w/*.sent; do [ -f "$f" ] && { give_up "$yes" "$c"; rm -f "$c"/w/*.sent "$c/sentwith"; break; }; done
    stamp
    keep "$c/rest" "$NOW"
    if [ -n "$shallow" ]; then f='a shallow clone'; elif [ -z "$repo" ]; then f='no commit yet'; else f='no base branch'; fi
    log "presence: worker $$ ends: $f, so no unmerged change can be told; looked at again in a day"
    exit 0
  fi
  # A worktree that is gone is forgotten here too: looked for when the worktrees are not the last pass's,
  # as each file's test costs a system call, and the clone's notes hold some 500 files on Ofir's PC.
  wts="$WTS"
  if [ "$IDS" != "$FORGOT" ]; then
    for f in "$c"/w/* "$c"/warn/*; do
      case "$f" in */"*") continue ;; esac
      id="${f##*/}"
      id="${id%%.*}"
      [ "$id" = index ] && continue
      case "$NL$wts" in *"$NL$id$TAB"*) ;; *) rm -f "$f" ;; esac
    done
    FORGOT="$IDS"
  fi
  # Nothing is sent once the notes went in the middle of this pass.
  [ -s "$c/common" ] || exit 0
  chosen
  report
  if [ -n "$NEED" ]; then
    for id in $NEED; do rm -f "$c/w/$id.sent"; done
    report
  fi
  [ -n "$base" ] && [ -z "$shallow" ] && table
  # The newest table, though the base may have moved since (it is built at most once a day); the
  # record says which base it was built from.
  [ -s "$c/table" ] && [ -n "$base" ] && tablefile="$c/table"
  [ -f "$c/warn/.made" ] || DIRTY=1
  if [ -n "$DIRTY" ]; then
    warnings
    : > "$c/warn/.made"
  fi
}

# What the room said of the others, their names with it, is kept only while the worker runs: when it
# ends, for whatever reason, it goes, and the next worker asks the room afresh. So does what a pass heard
# and has not kept yet (tmp/heard, its names too, and tmp/heard.k): a worker killed hard leaves its scratch
# folder, and as first written they stayed past the next chat start (the 0.3.26 review's promise:2).
forget_heard() {
  local f gone=()
  for f in "$c"/warn/*; do [ -f "$f" ] && [ "${f##*/}" != index ] && gone+=("$f"); done
  rm -f "$c/answer" "$c/etag" "$c/warn/.made" "$c/tmp/answer" "$c/tmp/heard" "$c/tmp/heard.k" "${gone[@]}"
}
# And for a clone whose worker was killed hard and that may never be used again: it goes once no
# worker runs for it (a worker being started has its lock and no pid yet, and is left alone).
forget_stale() {
  local c pid
  for c in "$DATA"/clones/*; do
    { [ -f "$c/answer" ] || [ -s "$c/tmp/answer" ] || [ -f "$c/tmp/heard" ] || [ -f "$c/tmp/heard.k" ]; } || continue
    pid=''
    if [ -d "$c/lock" ]; then
      [ -f "$c/lock/pid" ] && read -r pid < "$c/lock/pid"
      { [ -z "$pid" ] || kill -0 "$pid" 2>/dev/null; } && continue
    fi
    forget_heard
  done
}

# Is this copy of the plugin gone, replaced or switched off since the worker started? No hook would
# ever run again to tell it to stop, and it would go on telling the room for up to 12 hours (the
# review's P3). Bash's own tests and reads only, once a pass. Sets GONE to why.
plugin_place() {
  local r b='' m p
  PKEY=''
  SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
  [ -s "$DATA/backslash" ] || awk 'BEGIN { printf "%c", 92 }' > "$DATA/backslash"
  IFS= read -r -d '' b < "$DATA/backslash"
  r="$ROOT"
  [ -n "$b" ] && r="${r//"$b"//}"
  r="${r%/}"
  # Installed, it lives in .../plugins/cache/<marketplace>/<plugin>/<version>, and is switched off as
  # "<plugin>@<marketplace>": false in the person's settings.
  r="${r%/*}"; p="${r##*/}"; r="${r%/*}"; m="${r##*/}"; r="${r%/*}"
  [ "${r##*/}" = cache ] || return 0
  case "$p$m" in *[!A-Za-z0-9._-]*|'') return 0 ;; esac
  PKEY="$p@$m"
}
plugin_gone() {
  local m='' v='' s='' re
  GONE=''
  [ -f "$SELF" ] || { GONE='the plugin was removed'; return 0; }
  # Rolled back (D84): every hook now runs the copy installed now, a lower one, and its worker_up starts
  # that copy's worker. As first written, a worker of a newer copy rolled back went on telling the room for
  # as long as the clone was in use (the combo review's merge:0). A copy set aside by an update keeps its
  # worker until the newer copy's takes the lock over (rolled_back).
  rolled_back && { GONE='this copy of the plugin was set aside, and no newer copy is installed (a rollback)'; return 0; }
  slurp "$ROOT/.claude-plugin/plugin.json"
  m="$SL"
  re='"version" *: *"([^"]*)"'
  [[ $m =~ $re ]] && v="${BASH_REMATCH[1]}"
  [ "$v" = "$VER" ] || { GONE="the plugin here is now ${v:-gone}, not $VER"; return 0; }
  { [ -n "$PKEY" ] && [ -f "$SETTINGS" ]; } || return 1
  slurp "$SETTINGS"
  s="$SL"
  re="$q${PKEY//./[.]}$q *: *false"
  [[ $s =~ $re ]] && { GONE='the plugin was switched off'; return 0; }
  return 1
}

# A worker from an older copy of the plugin holds the clone's lock, pid $1, told to stop by a hook of this
# copy (worker_up): this worker takes the lock over while the old one still runs, and starts once it has
# ended, at its next look. An old worker's exit removes the lock only when it is still its own, so the
# lock is never free in between, and a hook of a chat still on the older copy, which starts a worker of
# its own whenever the lock is free, finds this one in it and starts none. As first written, the lock was
# free for a moment when the old worker ended, the old chat's next hook started an old worker again, and
# a computer where an old chat was in use kept the old worker and its CPU cost (the combo review's
# upgrade:1). One worker takes over ("take"), and goes when the clone stops saying yes; fails, starting
# nothing, otherwise. It looks every second for as long as the old one's longest pass, its table and its
# sleep, counted in its own seconds of sleep, not by the clock. It first gave up by bash's SECONDS, which
# counts the time a computer sleeps: a takeover begun just before the lid closed was past its time on
# waking, took the stop away before the old worker had seen it, and both ran and reported until the clone
# was unused for 12 hours (the 0.3.26 review's shells:1). And past that time it does not give up while the
# old pid is still a worker of this clone (a pass longer still: 0.3.25 took 233 s a pass over a worktree with
# 3,000 files not committed, on bash 5.2), only after an hour more of looks, every 10 s: one that has not
# ended by then is stuck.
take_over() {
  local old="$1" v='' p='' turns looks=360
  [ -f "$c/lock/ver" ] && read -r v < "$c/lock/ver"
  { [ -n "$v" ] && older "$v" "${VER:-0.0.0}"; } || return 1
  mkdir "$c/lock/take" 2>/dev/null || return 1
  : 2>/dev/null > "$c/lock/stop"
  echo $$ > "$c/lock/pid"
  printf '%s' "${VER:-0.0.0}" > "$c/lock/ver"
  log "presence: worker $$ takes the lock over from worker $old of the plugin's $v, and starts once that one ends"
  turns=$(( 5 * every + TABLE_SECONDS + ${AISLE_LONGEST_PASS:-300} ))
  while kill -0 "$old" 2>/dev/null; do
    if [ ! -f "$c/yes" ] || [ ! -s "$c/common" ]; then
      [ -f "$c/lock/pid" ] && read -r p < "$c/lock/pid"
      [ "$p" = "$$" ] && rm -rf "$c/lock"
      exit 0
    fi
    if [ "$turns" -gt 0 ]; then turns=$(( turns - 1 )); sleep 1
    elif ! a_worker "$old"; then break
    elif [ "$looks" -gt 0 ]; then looks=$(( looks - 1 )); sleep 10
    else
      log "presence: worker $old of the plugin's $v has not ended an hour past its longest pass, so worker $$ starts anyway"
      break
    fi
  done
  rm -rf "$c/lock/stop" "$c/lock/take"
}
# Is pid $1 still a worker of this clone: its command line listen.sh's --worker with this clone's notes? A
# pid goes to another program once its own has ended. /proc in Git Bash and on Linux, read in one block:
# bash drops the NUL that ends each word (and its warning that it did), and the words run together, which
# the test below still finds. ps elsewhere (a Mac). A command line that cannot be read counts as a
# worker's: it is looked at again 10 s later, and the hour's limit stays.
a_worker() {
  local a=''
  if [ -r "/proc/$1/cmdline" ]; then { a=$(<"/proc/$1/cmdline"); } 2>/dev/null
  else a=$(ps -p "$1" -o args= 2>/dev/null); fi
  [ -n "$a" ] || return 0
  case "$a" in *--worker*"$CID"*) return 0 ;; esac
  return 1
}

worker_main() {
  local pid='' start took warm='' every="${AISLE_PASS_SECONDS:-40}" idle="${AISLE_IDLE_MINUTES:-720}"
  TABLE_SECONDS="${AISLE_TABLE_SECONDS:-300}"
  TABLE_MINUTES="${AISLE_TABLE_MINUTES:-1440}"
  # The clone's notes: global, so the functions below and the exit trap all see it.
  c="$1"
  CID="${c##*/}"
  cd / || exit 0
  [ -s "$c/common" ] || exit 0
  if ! mkdir "$c/lock" 2>/dev/null; then
    [ -f "$c/lock/pid" ] && read -r pid < "$c/lock/pid"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then take_over "$pid" || exit 0
    else
      # A lock with no worker behind it was left by one that was killed. One being taken right now has no
      # pid in it yet, for a moment, so a lock without one is left alone until it is a minute old.
      if [ -z "$pid" ] && [ -z "$(find "$c/lock" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then exit 0; fi
      rm -rf "$c/lock"
      mkdir "$c/lock" 2>/dev/null || exit 0
    fi
  fi
  echo $$ > "$c/lock/pid"
  printf '%s' "${VER:-0.0.0}" > "$c/lock/ver"
  # A worker killed hard (a shutdown, Task Manager) leaves what it heard behind, names and all, so the
  # next one clears it first. Its scratch files live in the clone's own notes, and are cleared with it:
  # nothing is left in the system's temp folder, where nobody would look again (the review's P2).
  forget_heard
  TMP="$c/tmp"
  # The token the room holds this clone's lists under, as the last worker left it: when the clone's yes
  # moved while no worker ran, the first pass gives that token's lists up. As first written, a new worker
  # started with none, and the first token's lists, a worktree stopped since with them, stayed in the room
  # until 24 hours after its last report (the 0.3.26 review's promise:1).
  SENTWITH=''
  [ -f "$c/sentwith" ] && read -r SENTWITH < "$c/sentwith"
  FORGOT=-
  rm -rf "$TMP"
  mkdir "$TMP" || exit 0
  # Only in the worker itself. A job of its own killed at once after its fork, before its program starts
  # (the table's time limit, waited), runs this trap too, where $$ is still the worker's pid: it took the
  # live worker's lock, its scratch folder and what it heard away, and another worker started beside it
  # (found by the 0.3.26 final check; 20 kills in 20 on Git Bash 5.3). BASHPID is the process's own pid,
  # in bash 4 and newer; macOS's 3.2 has none, and its fork is a real one, microseconds before the program.
  trap '[ "${BASHPID:-$$}" != "$$" ] || { rm -rf "$TMP"; forget_heard; [ "$(cat "$c/lock/pid" 2>/dev/null)" = "$$" ] && rm -rf "$c/lock"; }' EXIT
  log "presence: worker $$ started for $(cat "$c/common")"
  # Which copy of the plugin this worker is, in the record: a newer one may start on the same day.
  record "clone-$CID" version "${VER:-0.0.0}"
  plugin_place
  while :; do
    if [ ! -f "$c/yes" ]; then
      # The room forgets what this worker told it (the hook that took the yes away has most likely said
      # so already; once more costs nothing). A clone that says yes again later starts its record of
      # what it heard afresh.
      give_up "$SENTWITH" "$c"
      rm -f "$c/heard.k" "$c/sentwith"
      log "presence: worker $$ ends: the clone does not say yes"
      exit 0
    fi
    # Nothing is sent before the person has been told what it shares (above NEWS_LINE).
    if [ ! -f "$c/told" ]; then give_up "$SENTWITH" "$c"; rm -f "$c/sentwith"; log "presence: worker $$ ends: its person has not been told what it shares"; exit 0; fi
    if [ -f "$c/lock/stop" ]; then log "presence: worker $$ ends: a newer copy of the plugin takes over"; exit 0; fi
    if plugin_gone; then log "presence: worker $$ ends: $GONE"; exit 0; fi
    if [ ! -f "$c/beat" ] || [ -n "$(find "$c/beat" -mmin +"$idle" 2>/dev/null)" ]; then
      log "presence: worker $$ ends: nothing has used this clone for $idle minutes"
      exit 0
    fi
    # Once a day, the record's old days go.
    stamp
    forget_old_records
    start=$SECONDS
    TABLE_TOOK=0
    pass
    # The next pass waits at least three times as long as this one took, so a big project never keeps
    # more than a quarter of a core busy, and at most five times the usual wait. Building the table is
    # not counted: it happens once each time the base moves; nor is the first pass, which works out
    # everything once.
    took=$(( 3 * (SECONDS - start - TABLE_TOOK) ))
    [ -n "$warm" ] || { took=0; warm=1; }
    [ "$took" -gt $(( 5 * every )) ] && took=$(( 5 * every ))
    [ "$took" -gt "$every" ] || took=$every
    sleep "$took"
  done
}

if [ -n "$WORKER" ]; then
  worker_main "$WORKER"
  exit 0
fi

# A folder that said stop under 0.3.6 or before. That stop only let go of the chat that listened and kept
# the folder's yes ("answered"), so this copy would have taken it for a yes: listened there again, and
# had its clone tell the room (the second fix check). This copy never leaves a yes without the chat that
# listens ("helper"): a yes writes that first, a new chat replaces it, and a stop or a refusal removes
# both. So the first hook here, of whatever kind, finishes that stop as this copy's own does, and says
# nothing: listening stays off, and this worktree is left out of what its clone tells the room.
if [ -f "$FOLDER/answered" ] && [ ! -f "$FOLDER/helper" ]; then
  stop_here || exit 0
  log "a stop said here before 0.3.7 is kept: listening stays off, and this worktree is left out"
fi

# A worktree's id, as its clone's worker names it to the room, into W: found by the letters of its root
# ($1) in the index the worker keeps. Fails when the worker has not named it yet.
worktree_id() {
  local l rows
  W=''
  [ -f "$CLONE/warn/index" ] || return 1
  yes_key "$1"
  slurp "$CLONE/warn/index"
  lines_of rows
  shopt -s nocasematch
  for l in "${rows[@]}"; do [[ ${l%%"$TAB"*} == "$key" ]] && { W="${l#*"$TAB"}"; break; }; done
  shopt -u nocasematch
  [ -n "$W" ]
}

# The worktree a path ($1, spelled with slashes) is in (0.3.25): of the worktrees the clones that said yes
# have now, as their workers last saw them ("current"; before a worker's first pass, every one it knew),
# the one with the longest root that holds it, and still that worktree: the .git in its root names the
# git dir its worker found. Into WT (its root as git spells it), WID, WFOLDER, WGD, CID and CLONE, by bash
# alone; fails when none does. As first written it matched every worktree a worker had ever seen, so a
# folder of a worktree since removed, holding another repository now or none, had its files' paths sent
# under this project (the review's privacy claim F3). A worktree that said stop is found too, so its stop
# is kept. The desktop app starts a chat in one of its worktrees with
# CLAUDE_PROJECT_DIR set to the main folder (see in_worktree), and 0.3.24 took an edit's worktree from
# that: on Ofir's PC 381 of 384 edits (2026-10-17 to 10-20) went under the main folder's id, as paths
# that start .claude/worktrees/<name>/, so no warning and no live mark ever matched them; and a session
# that edits another worktree of the clone by its full path, as an agent does, went unheard (R27, Fault A).
worktree_of() {
  local f="$1" k l p id fo gd n hit len=0 rows g='' d oc="$CLONE" oi="$CID"
  WT='' WID='' WFOLDER='' WGD=''
  case "$f" in /[A-Za-z]/*) f="${f:1:1}:${f:2}" ;; esac
  for k in "$DATA"/clones/*/known; do
    { [ -f "$k" ] && [ -f "${k%/known}/yes" ]; } || continue
    d="${k%/known}"
    # "current" only when "known" is not newer: a worker of 0.3.24 adds a worktree it finds to "known" and
    # never writes "current", and an edit in a worktree made while one ran was matched to none (the combo
    # review's upgrade:2). This copy's pass adds a worktree to both, "current" last. A worktree since
    # removed is still kept out by the .git test below.
    [ -f "$d/current" ] && [ ! "$k" -nt "$d/current" ] && k="$d/current"
    slurp_big "$k"
    lines_of rows
    for l in "${rows[@]}"; do
      p="${l%%"$TAB"*}"
      n="$p"
      case "$n" in /[A-Za-z]/*) n="${n:1:1}:${n:2}" ;; esac
      [ "${#n}" -gt "$len" ] || continue
      hit=''
      # A drive letter means Windows, where a folder's name is the same in any case.
      case "$n" in [A-Za-z]:/*) shopt -s nocasematch ;; esac
      [[ $f == "$n"/* ]] && hit=1
      shopt -u nocasematch
      [ -n "$hit" ] || continue
      l="${l#*"$TAB"}"; id="${l%%"$TAB"*}"
      l="${l#*"$TAB"}"; fo="${l%%"$TAB"*}"; gd="${l#*"$TAB"}"
      len=${#n} WT="$p" WID="$id" WFOLDER="$fo" WGD="$gd" CLONE="$d"
    done
  done
  [ -n "$WT" ] || return 1
  CID="${CLONE##*/}"
  # A linked worktree's .git is a file, "gitdir: <its git dir>" (relative to the root when git was told
  # to); the main one's, the git dir itself.
  if [ -f "$WT/.git" ]; then
    slurp "$WT/.git"
    g="${SL%%"$NL"*}"
    case "$g" in "gitdir: "*) g="${g#gitdir: }" ;; *) g='' ;; esac
    case "$g" in ''|/*|[A-Za-z]:/*) ;; *) normal "$WT/$g"; g="$NORMAL" ;; esac
  elif [ -d "$WT/.git" ]; then g="$WT/.git"
  fi
  gd="$WGD"
  case "$g" in /[A-Za-z]/*) g="${g:1:1}:${g:2}" ;; esac
  case "$gd" in /[A-Za-z]/*) gd="${gd:1:1}:${gd:2}" ;; esac
  hit=''
  case "$gd" in [A-Za-z]:/*) shopt -s nocasematch ;; esac
  [ -n "$g" ] && [[ $g == "$gd" ]] && hit=1
  shopt -u nocasematch
  [ -n "$hit" ] && return 0
  WT='' WID='' WFOLDER='' WGD='' CID="$oi" CLONE="$oc"
  return 1
}

# D46: what another session has unmerged, on the file about to change or on one that usually changes
# together with it, from the warnings its clone's worker keeps for this worktree. Every edit and every
# warning goes into the record. The same file is always said; the co-change kind only while the room's
# test runs, for half of them by a frozen hash, and never in shadow. Each file is said once a chat for
# each kind, at most 3 in one line, and at most 10 co-change files a chat. Sets NOTE to what Claude is
# told, or nothing.
#
# One edit takes at most EDIT_CO co-change files new to the chat (the review's P1 left each one costing
# about 4 ms more, so 1,200 would reach the hook's 5 s). The rest wait for the chat's next edit of that
# file, in the same order. Which ones go first is set by the warnings' order alone, before any half is
# looked at, so the bound takes from both halves alike. 100 is above every edit of the project C1
# replayed (48 at most) and above any file there at its busiest moment (96), so on it the bound never
# changes what is recorded. The same file is never held back.
EDIT_CO=100
presence_note() {
  local w='' mode=shadow salt=- head=- said='' lines g c kind ids since other who
  local arm arms shown cos=0 nco=0 newco=0 what age same='' co='' cs='' ws='' one='' add='' recs=''
  NOTE=''
  [ -f "$CLONE/mode" ] && IFS="$TAB" read -r mode salt < "$CLONE/mode"
  [ -f "$CLONE/table.head" ] && read -r head < "$CLONE/table.head"
  # The worktree the edit is in, as worktree_of found it, else by its root. One its worker has not named
  # yet is recorded as -, so the record shows an edit that no warning could reach (0.3.25).
  W="$WID"
  if [ -z "$W" ] && ! worktree_id "$root"; then record "chat-$sid" edit - "${mode:-shadow}" "$rel"; return 0; fi
  w="$W"
  record "chat-$sid" edit "$w" "${mode:-shadow}" "$rel"
  # For its clone's worker: this worktree moved now (active), though no git status may show it yet.
  printf '%s%s' "$w" "$NL" 2>/dev/null >> "$CLONE/edited"
  [ -s "$CLONE/warn/$w" ] || return 0
  # A path that would need escaping is never in the warnings, so it is not looked for.
  case "$rel" in *"$bs"*|*"$q"*) return 0 ;; esac
  lines=$(grep -F -e "$rel$TAB" "$CLONE/warn/$w" 2>/dev/null) || return 0
  # What this chat was told already, a line each, and how many co-change files of them were shown.
  slurp "$DATA/said-warnings-$sid"
  said="${SL:+$SL$NL}"
  c="${TAB}co${TAB}1$NL"
  kind="${said//"$c"/}"
  cos=$(( (${#said} - ${#kind}) / ${#c} ))
  stamp
  # In the test, the half of every co-change file this worktree has not had yet, by one SHA-256 program
  # for all of them: one program for each once made such an edit wait 5 to 15 s (the review's P1). The
  # halves are kept for the worktree (they depend only on the salt, the worktree and the file), and each
  # is recorded below at once, so no file is hashed twice.
  arms="$NL"
  if [ "$mode" = test ]; then
    local n=0 k=0 took='' todo='' left out d cache='' kept="$CLONE/warn/$w.arms" files=()
    slurp "$kept"
    cache="${SL:+$SL$NL}"
    if [ "${cache%%"$NL"*}" = "$salt" ]; then arms="$NL${cache#*"$NL"}"; else cache=''; fi
    while IFS="$TAB" read -r g c kind ids since other who; do
      { [ "$g" = "$rel" ] && [ "$kind" = co ]; } || continue
      case "$NL$said" in *"$NL$c$TAB$kind$TAB"*) continue ;; esac
      # The files the loop below takes within this edit's bound, in its order.
      case "$NL$took" in *"$NL$c$NL"*) continue ;; esac
      [ "$k" -ge "$EDIT_CO" ] && break
      k=$(( k + 1 ))
      took="$took$c$NL"
      case "$arms" in *"$NL$c$TAB"*) continue ;; esac
      n=$(( n + 1 ))
      printf 'aisle-c2:%s:%s:%s' "$salt" "$w" "$c" > "$DATA/c2-$$-$n" || break
      files[n]="$DATA/c2-$$-$n"
      todo="$todo$c$NL"
    done <<< "$lines"
    if [ "$n" -gt 0 ]; then
      out=$(sha_files "${files[@]}" 2>/dev/null)
      # Deleting is the slow part on Windows (about 7 ms a file), so it happens after the hook is done.
      rm -f "${files[@]}" </dev/null >/dev/null 2>&1 &
      # One line a file, in the order given, the hash first; a line whose file name holds a backslash
      # (a Windows data folder) starts with one more character, which is dropped.
      left="$todo"
      todo=''
      while IFS= read -r d; do
        c="${left%%"$NL"*}"
        left="${left#*"$NL"}"
        d="${d#[!0-9a-f]}"
        d="${d:0:1}"
        case "$d" in [0-9a-f]) todo="$todo$c$TAB$d$NL" ;; esac
      done <<< "$out"
      arms="$arms$todo"
      if [ -n "$cache" ]; then printf '%s' "$todo" >> "$kept"; else printf '%s%s%s' "$salt" "$NL" "$todo" > "$kept"; fi
    fi
  fi
  while IFS="$TAB" read -r g c kind ids since other who; do
    [ "$g" = "$rel" ] || continue
    # Past this edit's bound, a co-change file new to the chat waits for its next edit of this file.
    [ "$kind" = co ] && [ "$newco" -ge "$EDIT_CO" ] && continue
    # Once a chat for each file of the others and each kind: the file itself is still said when the
    # chat comes to edit it, though a co-change warning named it before.
    case "$NL$said" in *"$NL$c$TAB$kind$TAB"*) continue ;; esac
    [ "$kind" = co ] && newco=$(( newco + 1 ))
    arm='-'
    shown=0
    if [ "$kind" = same ]; then shown=1
    elif [ "$mode" = test ]; then
      # The half, by the worktree and not the chat (C2): a collision belongs to a branch, so every chat
      # in one worktree gets the same half for the same file. $w is the worktree's id, as the worker
      # names it to the room.
      # The first hex digit of sha256("aisle-c2:<salt>:<worktree>:<file>"): 0-7 shown, 8-f not. A file
      # whose hash could not be made has no half ("-"), rather than one that would lean either way.
      case "$arms" in
        *"$NL$c$TAB"[0-7]"$NL"*) arm=shown ;;
        *"$NL$c$TAB"[89a-f]"$NL"*) arm=shadow ;;
        *) arm='-' ;;
      esac
      # Every one is recorded at its first edit, in either half, so the test loses none from one half
      # only (C2): past the 3 of a full line, or once the chat's 10 are used up, it is recorded as not
      # shown, and it is not said later in this chat.
      [ "$arm" = shown ] && [ "$nco" -lt 3 ] && [ "$cos" -lt 10 ] && shown=1
    fi
    # Into the record and the chat's notes together after the loop, each file opened once.
    recs="$recs$NOW${TAB}warn$TAB$w$TAB$kind$TAB$arm$TAB$mode$TAB$head$TAB$shown$TAB$other$TAB$ids$TAB$g$TAB$c$NL"
    said="$said$c$TAB$kind$TAB$shown$NL"
    add="$add$c$TAB$kind$TAB$shown$NL"
    [ "$shown" = 1 ] || continue
    case "$ids" in wip*) what='not committed yet' ;; *) what="commit ${ids%%,*}" ;; esac
    [[ $since =~ ^[0-9]+$ ]] || since=$NOW
    age=$(( NOW - since ))
    if [ "$age" -lt 3600 ]; then age="$(( age / 60 < 1 ? 1 : age / 60 )) min ago"
    elif [ "$age" -lt 172800 ]; then age="$(( age / 3600 )) h ago"
    else age="$(( age / 86400 )) days ago"; fi
    if [ "$kind" = same ]; then
      [ -n "$same" ] || same="AIsle: $who has an unmerged change on this file, $g ($what, $age). Look at that change first and keep yours small, or post in the room."
    else
      nco=$(( nco + 1 ))
      cos=$(( cos + 1 ))
      cs="$cs$NL$c"
      ws="$ws; $who on $c ($what, $age)"
      one="$who has an unmerged change on $c ($what, $age)"
    fi
  done <<< "$lines"
  if [ -n "$add" ]; then
    logto "chat-$sid" warn && printf '%s' "$recs" >> "$LOGF"
    printf '%s' "$add" >> "$DATA/said-warnings-$sid"
  fi
  if [ "$nco" = 1 ]; then
    c="${cs#"$NL"}"
    co="AIsle: $rel usually changes together with $c in this project's history, and $one. If your task needs $c too, look at that change first and keep yours small, or post in the room."
  elif [ "$nco" -gt 1 ]; then
    cs="${cs#"$NL"}"
    c="${cs%"$NL"*}"
    c="${c//"$NL"/, } and ${cs##*"$NL"}"
    co="AIsle: $rel usually changes together with $c in this project's history, and other sessions have unmerged changes on them: ${ws#; }. If your task needs them too, look at those changes first and keep yours small, or post in the room."
  fi
  NOTE="$same${same:+${co:+ }}$co"
}

# Live marks (D45): before Claude edits a file, tell the room which file, and hear who else is in it
# right now. Only in a folder that said yes to the room, or a worktree of a clone that did (D46), and
# only the path inside the project, never what is in the file. It never stands in the edit's way: a
# slow or absent room means it says nothing.
field tool_name; tool="$FV"
case "$tool" in
  Edit|Write|MultiEdit|NotebookEdit)
    [ "$event" = "PreToolUse" ] || exit 0
    [ -f "$DATA/yes" ] || yes_index
    field file_path; file="$FV"
    [ -z "$file" ] && { field notebook_path; file="$FV"; }
    [ -z "$file" ] && exit 0
    # Claude Code writes each backslash of a Windows path doubled, as JSON does; the awk call, made once
    # and kept, makes one without this file holding any.
    bs=''
    [ -s "$DATA/backslash" ] || awk 'BEGIN { printf "%c", 92 }' > "$DATA/backslash"
    IFS= read -r -d '' bs < "$DATA/backslash"
    f="${file//"$bs$bs"/"/"}"
    # The edit's folder is the worktree its file is in, whatever folder the chat started in (0.3.25).
    if worktree_of "$f"; then dir="$WT"; FOLDER="$WFOLDER"; fi
    [ -f "$FOLDER/stopped" ] && exit 0
    # Told with this folder's own token when it said yes, else with its clone's.
    TOK="$FOLDER"
    if [ ! -f "$FOLDER/answered" ] || [ ! -s "$FOLDER/token" ]; then
      # A worktree worktree_of found is one of a clone that said yes, and did not say stop itself.
      [ -n "$WT" ] || covered_here || exit 0
      read -r y < "$CLONE/yes"
      TOK="$DATA/folders/$y"
      [ -s "$TOK/token" ] || exit 0
    fi
    # The project: its root here, and a name every clone of it shares, a hash of its first commit.
    root="$WT"
    repo=''
    [ -n "$root" ] || { [ -f "$FOLDER/root" ] && IFS= read -r root < "$FOLDER/root"; }
    [ -f "$FOLDER/repo" ] && IFS= read -r repo < "$FOLDER/repo"
    if [ -z "$root" ] || [ -z "$repo" ]; then
      [ -n "$root" ] || root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)
      [ -n "$root" ] || exit 0
      # A worktree of a clone the worker reports for takes the project's name from the clone's notes:
      # walking the whole history again for each new worktree folder cost a third of a second on a big
      # project, and the desktop app makes a worktree per chat (the review's P10).
      repo=''
      [ -n "$CLONE" ] && [ -s "$CLONE/repo" ] && read -r repo < "$CLONE/repo"
      if [ -z "$repo" ]; then
        first=$(git -C "$dir" rev-list --max-parents=0 HEAD 2>/dev/null | tail -n 1)
        [ -n "$first" ] || exit 0
        repo=$(printf 'aisle-repo:%s' "$first" | sha | cut -c1-32)
      fi
      mkdir -p "$FOLDER" || exit 0
      printf '%s' "$root" > "$FOLDER/root"
      printf '%s' "$repo" > "$FOLDER/repo"
    fi
    # The clone's worker keeps going while its folders are in use.
    if [ -n "$CLONE" ] || here_clone; then
      [ -f "$CLONE/yes" ] && worker_up
    fi
    # A folder that said yes before 0.3.7, where no chat has started or replied since the update: Claude
    # hears what that yes now shares before this edit, once a clone, and the clone's yes waits for the end
    # of this reply (the listener gives it). An edit never gives it: Claude may not have passed the line
    # on yet. A yes said since 0.3.7 was told in the answer to it.
    NEWS=''
    [ "$TOK" = "$FOLDER" ] && [ -n "$CLONE" ] && [ ! -f "$CLONE/told" ] && [ ! -f "$FOLDER/refused" ] && NEWS="$NEWS_LINE"
    # Only the path inside the project leaves this computer, never the folders above it, which carry the
    # person's name (0.3.4 sent them, and the room kept only the inside part). The backslashes were made
    # slashes above; whatever else is escaped stays escaped, so the body is still JSON.
    r="$root"
    re='^/([A-Za-z])/(.*)$'
    [[ $f =~ $re ]] && f="${BASH_REMATCH[1]}:/${BASH_REMATCH[2]}"
    [[ $r =~ $re ]] && r="${BASH_REMATCH[1]}:/${BASH_REMATCH[2]}"
    # A drive letter means Windows, where a folder's name is the same in any case.
    re='^[A-Za-z]:/'
    [[ $r =~ $re ]] && shopt -s nocasematch
    [[ $f == "$r"/* ]] || exit 0
    shopt -u nocasematch
    rel="${f:${#r}+1}"
    # A file in a worktree or a repository inside this one that no worker has seen yet (a worktree made
    # a moment ago, a submodule) is not this worktree's file: it is said nowhere, rather than under this
    # worktree's name as 0.3.24 did, and its stop, if it said one, is kept (0.3.25). Bash's own tests.
    up="$rel"
    while [[ $up == */* ]]; do
      up="${up%/*}"
      [ -e "$r/$up/.git" ] && exit 0
    done
    # What other sessions have unmerged, worked out on this computer, before the room is asked.
    NOTE=''
    [ -n "$CLONE" ] && presence_note
    header_of "$TOK"
    HEADER_FILE="$TOK/header"
    body="{${q}repo${q}:${q}$repo${q},${q}path${q}:${q}$rel${q},${q}session${q}:${q}$sid${q}}"
    # A room that gave no answer at all is not asked again for a minute, or every edit would wait the full
    # 2 s on it while it is down. An answer of any kind, an error too, rests nothing. By bash alone.
    reply=''
    stamp
    rested=0 base=''
    [ -f "$DATA/marks-rest" ] && IFS="$TAB" read -r rested base < "$DATA/marks-rest"
    case "$rested" in ''|*[!0-9]*) rested=0 ;; esac
    if [ "$base" != "${U%/watch}" ] || [ $(( NOW - rested )) -ge 60 ] || [ "$NOW" -lt "$rested" ]; then
      if ! reply=$(curl -sS -m 2 -A "aisle-plugin/${VER:-0.0.0}" -H "@$HEADER_FILE" -H 'Content-Type: application/json' --data-binary "$body" "${U%/watch}/marks" 2>/dev/null); then
        keep "$DATA/marks-rest" "$NOW$TAB${U%/watch}"
        log "live marks: the room did not answer, so the next minute's edits do not ask it"
      fi
    fi
    say=''
    re='"say":"([^"]*)"'
    [[ $reply =~ $re ]] && say="${BASH_REMATCH[1]}"
    # Said only when its note is kept, or it would be said again at every edit.
    if [ -n "$NEWS" ]; then
      if mkdir -p "$CLONE" 2>/dev/null && : 2>/dev/null > "$CLONE/told"; then log "presence: told this chat what a yes said before 0.3.7 now shares"; else NEWS=''; fi
    fi
    [ -z "$say$NOTE$NEWS" ] && exit 0
    [ -n "$say" ] && log "live mark: someone else is in a file this chat is about to edit"
    [ -n "$NOTE" ] && log "presence: another session has unmerged work on or beside a file this chat is about to edit"
    told="$say${say:+${NOTE:+ }}$NOTE"
    told="$told${told:+${NEWS:+ }}$NEWS"
    if [ -n "$say" ] && [[ $reply == *'"ask":true'* ]]; then
      # A file that cannot be merged: the person decides, and Claude knows why it is being asked.
      printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s","additionalContext":"%s"}}' "$say" "$told"
    else
      # No decision at all, so the person's own permission settings apply exactly as before.
      printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"%s"}}' "$told"
    fi
    exit 0
    ;;
esac

if [ "$event" = "PreToolUse" ]; then
  re='"fingerprint" *: *"stop"'
  if [[ $input =~ $re ]]; then
    stop_here || exit 0
    log "listening turned off for $dir"
    # Not "the room did not need to be contacted", as it said from D28 on: since presence (0.3.7) a stop in a
    # clone that told the room what it has unmerged reaches the room, by the worker's next pass or at once in
    # the background (stop_unheard, clone_unyes), and the person was told nothing was sent (the 0.3.26
    # review's promise:3).
    reason="Done, and not an error: the AIsle plugin turned listening off for this folder on this computer, whatever room was named, so no chat here will be woken for any room, and this worktree no longer tells the room which files it has unmerged. If it had told the room, the plugin now tells the room to forget it, by itself, in the background; nothing else is needed. Tell your user in one line."
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}' "$reason"
    exit 0
  fi
  # updatedInput takes the place of everything Claude passed, so the room it named goes back in, or a
  # sign-in that covers several rooms is refused with "Say which one" whatever room was named (seen
  # 2026-10-08 on 0.3.6). It goes back as JSON wrote it, escapes and all, so it is still valid JSON:
  # a backslash and whatever it escapes, or anything but a quote. The awk call makes the backslash.
  bs=$(awk 'BEGIN { printf "%c", 92 }')
  re='"room" *: *"(([^"'"$bs"']|['"$bs"'].)*)"'
  room=''
  [[ $input =~ $re ]] && room=',"room":"'"${BASH_REMATCH[1]}"'"'
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"%s","updatedInput":{"fingerprint":"%s"%s}}}' "AIsle plugin: filled in this folder's listener fingerprint, which is not a secret" "$(fingerprint "$(folder_token)")" "$room"
  exit 0
fi

# The worktree this chat is in, by the hook's cwd (0.3.25), as worktree_of finds it; fails outside every
# one. Its backslashes come doubled, as JSON writes them (see the edit hook).
chat_worktree() {
  local b=''
  field cwd
  [ -n "$FV" ] || return 1
  [ -s "$DATA/backslash" ] || awk 'BEGIN { printf "%c", 92 }' > "$DATA/backslash"
  IFS= read -r -d '' b < "$DATA/backslash"
  worktree_of "${FV//"$b$b"/"/"}/"
}

# The record's last 7 days, for whoami's check (0.3.25): the edits in this clone's worktrees, how many were
# matched to the worktree they were made in, and the warnings worked out, shown to Claude or not. An edit
# no worktree was matched to (recorded as -) cannot say which clone it was in, so it counts in every
# clone's line; on a computer with one clone that said yes, the usual, the line is exact.
week() {
  [ -f "$CLONE/known" ] || return 0
  stamp
  find "$DATA/logs" -type f -name '*-chat-*.tsv' -mtime -7 -exec cat {} + 2>/dev/null | LC_ALL=C awk -v since=$(( NOW - 7 * 86400 )) '
    BEGIN { T = sprintf("%c", 9); FS = T; e = 0; m = 0; k = 0; s = 0 }
    part == 1 { mine[$2] = 1; next }
    $1 + 0 < since + 0 { next }
    $2 == "edit" { if ($3 in mine) { e++; m++ } else if ($3 == "-") e++; next }
    $2 == "warn" && ($3 in mine) { k++; if ($8 == "1") s++ }
    END { printf "last 7 days: %d edit(s), %d matched to a worktree, %d warning(s) worked out, %d shown", e, m, k, s }
  ' part=1 "$CLONE/known" part=2 -
}

# What this computer knows of the clone's reports, for whoami's check, for the worktree the chat is in.
# With the counts that would have shown 0.3.24's faults, unseen for 12 days (R27, live-git.md): how many
# worktrees the room hears of and why not the others (chosen), and the record's last 7 days (week).
presence_check() {
  local n=0 role='' mode=shadow salt f="$FOLDER" all='' sent='' stale='' over='' quiet='' left='' by='' x
  if chat_worktree; then f="$WFOLDER"
  elif ! here_clone || [ ! -f "$CLONE/yes" ]; then
    printf 'unmerged files: not told to the room (no folder of this clone said yes)'
    return
  fi
  if [ -f "$f/stopped" ]; then printf 'unmerged files: this worktree is left out (it said stop)'; return; fi
  [ -f "$CLONE/covered" ] && n=$(grep -c '' "$CLONE/covered")
  [ -f "$CLONE/role" ] && read -r role < "$CLONE/role"
  [ -f "$CLONE/mode" ] && IFS="$TAB" read -r mode salt < "$CLONE/mode"
  [ -f "$CLONE/counts" ] && IFS="$TAB" read -r all sent stale over quiet < "$CLONE/counts"
  [ -n "$quiet" ] || quiet=0
  [[ $all =~ ^[0-9]+$ && $sent =~ ^[0-9]+$ && $stale =~ ^[0-9]+$ && $over =~ ^[0-9]+$ && $quiet =~ ^[0-9]+$ ]] || all=''
  if [ -z "$role" ]; then printf 'unmerged files: not told yet; the room has not answered this clone'; return; fi
  if [ -n "$all" ]; then
    [ "$quiet" -gt 0 ] && by=", $quiet of them unchanged for $STALE_DAYS days or more and told by their commits alone"
    [ "$stale" -gt 0 ] && left="$stale unchanged for $STALE_DAYS days or more with no commit to merge"
    [ "$over" -gt 0 ] && left="${left:+$left, }$over past the 32 the room keeps"
    printf 'unmerged files: told to the room for %s of %s worktree(s) of this clone%s%s, paths and commit ids only ✓ · ' "$sent" "$all" "$by" "${left:+ (left out: $left)}"
  else
    printf 'unmerged files: told to the room for %s worktree(s) of this clone, paths and commit ids only ✓ · ' "$n"
  fi
  if [ "$mode" = test ]; then printf 'a file that usually changes with one another session has unmerged: the room is testing these warnings, so half are shown'
  else printf 'a file that usually changes with one another session has unmerged: not shown yet, only recorded on this computer for a test'; fi
  x=$(week)
  [ -n "$x" ] && printf ' · %s' "$x"
}

# A post in the room, into the record (C2: "or post in the room" is what the warning asks for): only
# that this chat posted, from which worktree, and when. Never what it said. Only in a worktree of a
# clone that tells the room, and only for a post the room took.
post_record() {
  local re='"(text|tool_response)" *: *"Posted as #' root="$dir"
  [[ $input =~ $re ]] || return 0
  # From the worktree the chat is in, which may not be the folder it started in (0.3.25): 24 of the 26
  # posts on Ofir's PC (2026-10-17 to 10-20) went under the main folder's id.
  if chat_worktree; then
    [ -f "$WFOLDER/stopped" ] || record "chat-$sid" post "$WID"
    return 0
  fi
  [ -f "$FOLDER/stopped" ] && return 0
  { here_clone && [ -f "$CLONE/yes" ]; } || return 0
  [ -f "$FOLDER/root" ] && IFS= read -r root < "$FOLDER/root"
  worktree_id "$root" || W=-
  record "chat-$sid" post "$W"
}

if [ "$event" = "PostToolUse" ]; then
  # Any AIsle tool at all runs this. A folder that has never answered gets one question (D38), asked
  # by the assistant in its own words, once and never again — not a rule sheet, not a thing to type.
  case "$tool" in
    *listen_here) : ;;
    *)
      asked="$FOLDER/asked"
      # A worktree of a clone that said yes is not asked again: the yes was said for all of it.
      covered=''
      [ -f "$FOLDER/answered" ] || [ -f "$asked" ] || [ -f "$FOLDER/stopped" ] || ! covered_here || covered=1
      if [ -f "$FOLDER/answered" ] || [ -f "$asked" ] || [ -f "$FOLDER/stopped" ] || [ -n "$covered" ]; then
        case "$tool" in *post_message) post_record ;; esac
        # whoami ends with the room's own check (D42); this is the half only this computer knows.
        case "$tool" in *whoami) ;; *) exit 0 ;; esac
        h=$(cat "$FOLDER/helper" 2>/dev/null)
        role=$(cat "$FOLDER/role" 2>/dev/null)
        if [ -n "$h" ] && [ "$role" = reporter ]; then where="the room listens through another folder of yours, so no chat here is woken"
        elif [ -n "$h" ] && [ "$h" = "$sid" ]; then where="this chat is the one that listens in this folder ✓"
        elif [ -n "$h" ]; then where="another chat in this folder listens, not this one. A new chat opened here takes that chat's listening over when it starts"
        elif [ -f "$FOLDER/answered" ]; then where="no chat in this folder listens ✗. Fix: say listen here in this chat"
        elif [ -n "$covered" ]; then where="no chat in this folder listens; its clone said yes in another folder. To be woken here too, say listen here in this chat"
        else where="this folder chose not to listen. To turn it on, say listen here in this chat"; fi
        printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}' "AIsle plugin check, from this computer: plugin ✓ (version ${VER:-unknown}) · $where · $(presence_check)."
        exit 0
      fi
      mkdir -p "$FOLDER" || exit 0
      date -u +%Y-%m-%dT%H:%M:%SZ > "$asked"
      log "asked once whether to listen for $dir"
      printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}' "AIsle plugin ✓ (version ${VER:-unknown}) on this computer. Nothing in this folder wakes up when somebody writes in the room, and it has never been asked. Ask your user now, one question and nothing else, in your app's question box (in Claude Code, AskUserQuestion; plain text only if there is none): shall this chat listen for the room, yes or no? Options: 'Yes, listen here (Recommended)', because a chat that listens is woken when someone writes, and 'No'. A yes also tells the room which files this clone's worktrees have unmerged changes on and the commits that made them, never what is in them, so parallel sessions can be warned. If yes, call listen_here. If no, call listen_here with the fingerprint stop, and say nothing more about it: this is asked once per folder, ever."
      exit 0
      ;;
  esac
  # Only a call the room accepted picks this chat.
  [[ $input == *'Listening is on'* ]] || exit 0
  mkdir -p "$FOLDER" || exit 0
  echo "$sid" > "$FOLDER/helper"
  # This folder has said yes once. Every later chat here starts listening without asking again.
  date -u +%Y-%m-%dT%H:%M:%SZ > "$FOLDER/answered"
  rm -f "$FOLDER/stopped" "$FOLDER/role" "$FOLDER/refused"
  # And the worktree a desktop app's chat is in, which its stop stopped too (stop_here).
  chat_folder && rm -f "$FO/stopped"
  told=''
  # And its clone says yes, so every worktree of it tells the room what it has unmerged (D46).
  if clone_of "$dir"; then
    printf '%s' "$CID" > "$FOLDER/clone"
    folder_of "$TOP"
    rm -f "$FO/stopped"
    # Told now, in the answer below, so the line for a yes said before 0.3.7 is never added; and first,
    # as a clone never says yes before its person was told.
    mkdir -p "$CLONE" && : 2>/dev/null > "$CLONE/told" && put "$CLONE/yes" "${FOLDER##*/}"
    # A yes looks at the clone again at once, though its worker found it gone, or rested it, today.
    rm -f "$CLONE/gone" "$CLONE/rest"
    worker_up
    told=' Every worktree of this clone now also tells the room which files it has unmerged changes on and the commits that made them, never what is in them.'
  fi
  yes_add "$dir"
  # A fresh start: the first look reports what is unread, rather than counting from an old visit.
  rm -f "$DATA/after-$sid" "$DATA/said-lost-$sid"
  log "this chat now listens for $dir"
  printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}' "AIsle plugin: this chat is now the only one that listens to the room for this folder, and the other chats here stay quiet. Listening starts when this reply ends.$told"
  exit 0
fi

# From here on, the listener: SessionStart or Stop.

# Notes from 0.1.0 are left alone: chats started before an update keep running the old copy until they
# restart, and removing its "already said" markers made them ask again (seen 2026-09-19).
# A week-old session's notes are of no use to anyone. A copy passed over 10 minutes ago is checked again
# (see ready). One find for all of it, as each program costs 50 to 200 ms in Git Bash.
find "$DATA" -maxdepth 1 -type f '(' '(' -name 'after-*' -o -name 'said-*' -o -name 'pid-*' -o -name 'handover-*' ')' -mtime +7 -o -name 'handover-no-*' -mmin +10 ')' -delete 2>/dev/null
forget_stale
forget_old_records

# A folder that has never said yes stays silent, whatever happens in it. A folder that was listening
# before this version said yes by being picked at all: it keeps listening, and is not asked again.
if [ ! -f "$FOLDER/answered" ]; then
  if [ ! -s "$FOLDER/helper" ] || [ -f "$FOLDER/stopped" ]; then
    # A worktree of a clone that said yes keeps the clone's worker going, and listens to nothing.
    # Anywhere else nothing at all happens, and nothing is written.
    covered_here && worker_up
    exit 0
  fi
  date -u +%Y-%m-%dT%H:%M:%SZ > "$FOLDER/answered"
  log "carried an older listening folder over to the automatic rule"
fi
yes_add "$dir"
# Its clone reports while this folder says yes, once its person has been told what that shares. A folder
# that said yes before 0.3.7 gives its clone the yes here, at a chat start or reply after the one in
# which Claude heard it (below, or before an edit), so never in the reply that passes it on.
if here_clone; then
  [ -f "$CLONE/yes" ] || [ ! -f "$CLONE/told" ] || [ -f "$FOLDER/refused" ] || recently_gone || put "$CLONE/yes" "${FOLDER##*/}"
  [ -f "$CLONE/yes" ] && worker_up
fi

# The newest chat in this folder is the one the person is in, so at its start it takes listening over
# (D38). No question, nothing to type. The chat that had it notices at its next turn through the loop
# and stops without a word. Stop, unlike SessionStart, never takes anything over: it runs after every
# reply in every chat, and a room would ping-pong between two open chats forever.
# A chat in one of this folder's Claude Code worktrees is not that chat (0.3.20): see in_worktree.
# Nor is a chat that only compacted (0.3.22): Claude Code starts it again with source "compact", the same
# chat, which the person did not just open. An older chat's compaction took listening from the chat Ofir
# had picked with listen_here (2026-10-17 04:12 UTC, listener log).
compacted() { field source; [ "$FV" = compact ]; }
# Nor is a scheduled task's run (0.3.23): the desktop app starts each run as a new session in the task's
# folder, its first message the task's prompt ("<scheduled-task name=..."), and nobody is in it. The daily
# check took listening from the chat Ofir had picked, every morning (2026-10-17 06:11 UTC, listener log).
# The prompt reaches the transcript within a second of this hook, which runs in the background, so it
# waits up to 5 seconds for it; a chat whose first message is a person's takes listening over as before.
# The transcript's path comes with each backslash doubled, as JSON writes it; see the edit hook's note.
scheduled() {
  field source; [ "$FV" = resume ] && return 1
  field transcript_path
  local tp="$FV" b='' i line n
  [ -n "$tp" ] || return 1
  [ -s "$DATA/backslash" ] || awk 'BEGIN { printf "%c", 92 }' > "$DATA/backslash"
  IFS= read -r -d '' b < "$DATA/backslash"
  tp="${tp//"$b$b"/"/"}"
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if [ -s "$tp" ]; then
      n=0
      while [ $n -lt 8 ] && IFS= read -r line; do
        n=$((n + 1))
        [[ $line == *'<scheduled-task '* ]] && return 0
        [[ $line == *"${q}type${q}:${q}user${q}"* ]] && return 1
      done < "$tp"
    fi
    sleep 0.5
  done
  return 1
}
helper=$(cat "$FOLDER/helper" 2>/dev/null)
if [ "$helper" != "$sid" ]; then
  if [ "$event" = "SessionStart" ] && in_worktree; then
    log "a chat in a worktree of $dir started; listening stays with the chat that has it"
    exit 0
  elif [ "$event" = "SessionStart" ] && compacted; then
    log "$sid compacted; listening stays with the chat that has it"
    exit 0
  elif [ "$event" = "SessionStart" ] && scheduled; then
    log "$sid is a scheduled task's run; listening stays with the chat that has it"
    exit 0
  elif [ "$event" = "SessionStart" ]; then
    echo "$sid" > "$FOLDER/helper"
    rm -f "$DATA/after-$sid" "$DATA/said-lost-$sid"
    log "took listening over for $dir (new chat)"
  else
    exit 0
  fi
fi
mine() { [ "$(cat "$FOLDER/helper" 2>/dev/null)" = "$sid" ]; }

# A folder that said yes before 0.3.7: the chat that listens here tells its person, once a clone, what
# that yes now shares, and the clone starts telling the room only at the next chat start or reply
# (above). Exit 2 is how this hook reaches Claude, and it wakes the chat: Claude Code does not read the
# context a background hook prints. Said only when its note is kept, or every reply would wake the chat.
if [ -n "$CLONE" ] && [ ! -f "$CLONE/told" ] && [ ! -f "$FOLDER/refused" ]; then
  if mkdir -p "$CLONE" 2>/dev/null && : 2>/dev/null > "$CLONE/told"; then
    log "presence: told this chat what a yes said before 0.3.7 now shares"
    echo "$NEWS_LINE" >&2
    exit 2
  fi
fi

# One watcher per chat: Stop runs after every reply.
lock="$DATA/pid-$sid"
if [ -f "$lock" ] && kill -0 "$(cat "$lock" 2>/dev/null)" 2>/dev/null; then exit 0; fi
echo $$ > "$lock"
F=$(mktemp)
trap 'rm -f "$lock" "$F"' EXIT

folder_token > /dev/null
header_of "$FOLDER"
HEADER_FILE="$FOLDER/header"

# Every folder that said yes listens (D47). A listener asks the room first whether it may, rather than
# learning it from a refusal: 0.3.5 took that refusal for a lost credential and forgot the folder's yes
# (D46). Says listener, reporter (the room listens through another folder, and this one only reports),
# refused (the room does not know this folder's token), old (a room from before 0.3.7), or nothing
# when the room is out of reach.
role_of() {
  local code
  code=$(curl -sS -m 10 -A "aisle-plugin/${VER:-0.0.0}" -o "$F" -w '%{http_code}' -H "@$HEADER_FILE" "${U%/watch}/presence" 2>/dev/null)
  case "$code" in
    200) grep "^role$TAB" "$F" | head -n 1 | cut -f2 | tr -cd 'a-z' ;;
    401) printf refused ;;
    404) printf old ;;
  esac
}
reporter() {
  [ "$(cat "$FOLDER/role" 2>/dev/null)" = reporter ] || put "$FOLDER/role" reporter
  log "quiet: the room listens through another folder; this one reports"
  exit 0
}
lost() {
  rm -f "$FOLDER/helper" "$FOLDER/answered" "$FOLDER/asked" "$FOLDER/role"
  here_clone && clone_unyes
  yes_index
  log "stop: the room refused this folder's listener"
  say_once lost "AIsle: this chat stopped listening to the room: the room no longer knows this folder (the assistant was removed, replaced, or signed out). Tell your user in one line. Call listen_here again only if they ask you to."
}

# The heartbeat (D56): the time, so a chat in another folder can tell this loop stopped (a turn takes 60 s at
# most, so a beat older than 120 s means it did). Bash 5 starts no program for it. Once before the room is
# asked this folder's role, which can take 10 s, so a chat that is starting never looks stopped; then each
# turn. A reporter or a refused folder that wrote one is left out by its role or its lost yes.
heartbeat() { echo "${EPOCHSECONDS:-$(date +%s)}" 2>/dev/null > "$FOLDER/beat"; }
heartbeat

case "$(role_of)" in
  reporter) reporter ;;
  refused) lost ;;
  listener) [ "$(cat "$FOLDER/role" 2>/dev/null)" = listener ] || put "$FOLDER/role" listener ;;
esac

after_file="$DATA/after-$sid"
after=$(cat "$after_file" 2>/dev/null)
log "start ($event, pid $$) for $dir"
down=''
while true; do
  heartbeat
  qs=''
  [ -n "$after" ] && qs="?after=$after"
  code=$(curl -sS -m 40 -A "aisle-plugin/${VER:-0.0.0}" -o "$F" -w '%{http_code}' -H "@$HEADER_FILE" "$U$qs" 2>/dev/null)
  # The person may have picked another chat meanwhile. Then this one stops, and says nothing.
  if ! mine; then log "stop: another chat listens for $dir now"; exit 0; fi
  if [ "$code" = "401" ]; then
    # The credential is gone, or the room listens through another folder now: the room tells which.
    case "$(role_of)" in
      reporter) reporter ;;
      refused|old) lost ;;
      listener) sleep 2; continue ;;
      *) sleep 20; continue ;;
    esac
  fi
  if [ "$code" != "200" ]; then
    [ -z "$down" ] && log "room unreachable (HTTP ${code:-none}); retrying quietly"
    down=1
    sleep 20
    continue
  fi
  [ -n "$down" ] && log "reachable again"
  down=''
  latest=$(grep -oE '"latest":[0-9]+' "$F" | cut -d: -f2)
  new=$(grep -oE '"new":[0-9]+' "$F" | cut -d: -f2)
  unread=$(grep -oE '"unread":[0-9]+' "$F" | cut -d: -f2)
  if [ -z "$after" ]; then
    # The first look in this chat: remember where the room is, and mention once what is waiting.
    after="${latest:-0}"
    echo "$after" > "$after_file"
    if [ "${unread:-0}" -gt 0 ]; then
      log "wake: $unread unread at the start"
      echo "AIsle: $unread message(s) in the room you have not read yet. Call read_chat when it is relevant to your user." >&2
      exit 2
    fi
    continue
  fi
  if [ "${new:-0}" -gt 0 ]; then
    echo "${latest:-$after}" > "$after_file"
    log "wake: $new new"
    echo "AIsle: $new new message(s) from someone else in the room. Call read_chat to read them, and tell your user if it matters to them." >&2
    exit 2
  fi
  if [ -n "$latest" ] && [ "$latest" != "$after" ]; then after="$latest"; echo "$after" > "$after_file"; fi
done
