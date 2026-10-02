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
#                              who else in the room is editing it right now
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
# Deliberately no backslashes anywhere in this file: on Windows it runs in Git Bash, and shells there
# have eaten them before. It needs bash, curl, grep, cut, tr, sed, head, awk, base64 and a SHA-256
# tool, which Git Bash, macOS and Linux all have.

U="${AISLE_WATCH_URL:-https://aisle.abstractobjective.dev/watch}"
DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.aisle-plugin}"
LOG="$DATA/listener.log"

umask 077
# The hook's input is JSON on stdin. Read it without ever blocking on a stdin that stays open.
IFS= read -r -t 3 -d '' input

# The folders that said yes to a room, in "$DATA/yes" as |key|key|, where a key is the folder's name in
# letters and digits only, compared in any case, so bash can make it without starting a program.
yes_key() { key="${1//[!A-Za-z0-9]/}"; }

# The edit hook runs before every Edit and Write in every project on this computer, because the plugin
# is installed for the person and not per project. So in a folder that never said yes it must cost no
# more than bash starting, and it uses only bash's own commands until it knows. 0.3.4 did all the work
# below first and took about a second per edit (measured 2026-10-02); bash alone starts in 0.1 s.
re='"hook_event_name" *: *"([A-Za-z]*)"'
if [[ $input =~ $re ]] && [ "${BASH_REMATCH[1]}" = PreToolUse ]; then
  re='"tool_name" *: *"([^"]*)"'
  t=''
  [[ $input =~ $re ]] && t="${BASH_REMATCH[1]}"
  case "$t" in
    Edit|Write|MultiEdit|NotebookEdit)
      d="$CLAUDE_PROJECT_DIR"
      re='"cwd" *: *"([^"]*)"'
      [ -z "$d" ] && [[ $input =~ $re ]] && d="${BASH_REMATCH[1]}"
      # No list yet (the first edit after an update): the long way below makes it.
      if [ -f "$DATA/yes" ]; then
        IFS= read -r -d '' list < "$DATA/yes"
        yes_key "$d"
        [ -n "$key" ] || exit 0
        shopt -s nocasematch
        case "$list" in *"|$key|"*) ;; *) exit 0 ;; esac
        shopt -u nocasematch
      fi
      ;;
  esac
fi

# This plugin's own version, told to the room with every poll so an old copy gets noticed (D43).
ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}"
VER=$(grep -oE '"version" *: *"[^"]*"' "$ROOT/.claude-plugin/plugin.json" 2>/dev/null | head -1 | cut -d'"' -f4)

mkdir -p "$DATA" || exit 0

field(){ printf '%s' "$input" | grep -oE '"'"$1"'" *: *"[^"]*"' | head -1 | cut -d'"' -f4; }
sid=$(field session_id | tr -cd 'A-Za-z0-9-')
event=$(field hook_event_name | tr -cd 'A-Za-z')
[ -z "$sid" ] && sid=unknown

log() {
  if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 200000 ]; then tail -n 300 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $sid $*" >> "$LOG"
}

# Say something to Claude, but only the first time this session.
say_once() {
  local marker="$DATA/said-$1-$sid"
  if [ -f "$marker" ]; then log "quiet: $1 already said this session"; exit 0; fi
  touch "$marker"
  echo "$2" >&2
  exit 2
}

sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi | cut -d' ' -f1; }
b64url() { base64 | tr '+/' '-_' | tr -d '=' | tr -d '[:space:]'; }

# This chat's folder: where the session started, the same for all four hooks. One spelling however it
# was written (C: or /c/, either slash, any case), and its notes live under a hash of that spelling.
dir="${CLAUDE_PROJECT_DIR:-$(field cwd)}"
[ -z "$dir" ] && dir="$PWD"
spelling=$(printf '%s' "$dir" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9._-' '_' | tr -s '_' | sed 's/^_*//;s/_*$//')
FOLDER="$DATA/folders/$(printf '%s' "$spelling" | sha | cut -c1-16)"

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

# The list the edit hook reads first (see yes_key): made from every folder here that said yes, and kept
# up to date by each folder's own listener. A folder missing from it only loses its marks until its
# next chat starts or replies.
yes_index() {
  local list='|' f p
  for f in "$DATA"/folders/*/answered; do
    [ -f "$f" ] || continue
    p=$(cat "${f%/answered}/path" 2>/dev/null)
    [ -n "$p" ] || continue
    yes_key "$p"
    [ -n "$key" ] && list="$list$key|"
  done
  printf '%s' "$list" > "$DATA/yes"
}
yes_add() {
  [ -f "$DATA/yes" ] || yes_index
  yes_key "$1"
  [ -n "$key" ] || return 0
  local list
  list=$(cat "$DATA/yes" 2>/dev/null)
  [ -n "$list" ] || list='|'
  case "$list" in *"|$key|"*) return 0 ;; esac
  printf '%s%s|' "$list" "$key" > "$DATA/yes"
}

# Live marks (D45): before Claude edits a file, tell the room which file, and hear who else is in it
# right now. Only in a folder that said yes to the room, and only the path inside the project, never
# what is in the file. It never stands in the edit's way: a slow or absent room means it says nothing.
tool=$(field tool_name)
case "$tool" in
  Edit|Write|MultiEdit|NotebookEdit)
    [ "$event" = "PreToolUse" ] || exit 0
    [ -f "$DATA/yes" ] || yes_index
    { [ -f "$FOLDER/answered" ] && [ -s "$FOLDER/token" ]; } || exit 0
    file=$(field file_path)
    [ -z "$file" ] && file=$(field notebook_path)
    [ -z "$file" ] && exit 0
    # The project: its root here, and a name every clone of it shares, a hash of its first commit.
    root=$(cat "$FOLDER/root" 2>/dev/null)
    repo=$(cat "$FOLDER/repo" 2>/dev/null)
    if [ -z "$root" ] || [ -z "$repo" ]; then
      root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)
      first=$(git -C "$dir" rev-list --max-parents=0 HEAD 2>/dev/null | tail -n 1)
      { [ -n "$root" ] && [ -n "$first" ]; } || exit 0
      repo=$(printf 'aisle-repo:%s' "$first" | sha | cut -c1-32)
      printf '%s' "$root" > "$FOLDER/root"
      printf '%s' "$repo" > "$FOLDER/repo"
    fi
    # Only the path inside the project leaves this computer, never the folders above it, which carry the
    # person's name (0.3.4 sent them, and the room kept only the inside part). Claude Code writes each
    # backslash of a Windows path doubled, as JSON does; the awk call makes one without this file holding
    # any. Whatever else is escaped stays escaped, so the body is still valid JSON.
    bs=$(awk 'BEGIN { printf "%c", 92 }')
    f="${file//"$bs$bs"/"/"}"
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
    HEADER_FILE="$FOLDER/header"
    printf 'Authorization: Bearer %s' "$(folder_token)" > "$HEADER_FILE"
    body=$(printf '{"repo":"%s","path":"%s","session":"%s"}' "$repo" "$rel" "$sid")
    reply=$(curl -sS -m 2 -A "aisle-plugin/${VER:-0.0.0}" -H "@$HEADER_FILE" -H 'Content-Type: application/json' --data-binary "$body" "${U%/watch}/marks" 2>/dev/null)
    say=$(printf '%s' "$reply" | grep -oE '"say":"[^"]*"' | head -1 | cut -d'"' -f4)
    [ -z "$say" ] && exit 0
    log "live mark: someone else is in a file this chat is about to edit"
    if printf '%s' "$reply" | grep -qE '"ask":true'; then
      # A file that cannot be merged: the person decides, and Claude knows why it is being asked.
      printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s","additionalContext":"%s"}}' "$say" "$say"
    else
      # No decision at all, so the person's own permission settings apply exactly as before.
      printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"%s"}}' "$say"
    fi
    exit 0
    ;;
esac

if [ "$event" = "PreToolUse" ]; then
  if printf '%s' "$input" | grep -qE '"fingerprint" *: *"stop"'; then
    rm -f "$FOLDER/helper"
    log "listening turned off for $dir"
    reason="Done, and not an error: the AIsle plugin turned listening off for this folder on this computer, so no chat here will be woken. The room did not need to be contacted. Tell your user in one line."
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}' "$reason"
    exit 0
  fi
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"%s","updatedInput":{"fingerprint":"%s"}}}' "AIsle plugin: filled in this folder's listener fingerprint, which is not a secret" "$(fingerprint "$(folder_token)")"
  exit 0
fi

if [ "$event" = "PostToolUse" ]; then
  # Any AIsle tool at all runs this. A folder that has never answered gets one question (D38), asked
  # by the assistant in its own words, once and never again — not a rule sheet, not a thing to type.
  tool=$(field tool_name)
  case "$tool" in
    *listen_here) : ;;
    *)
      asked="$FOLDER/asked"
      if [ -f "$FOLDER/answered" ] || [ -f "$asked" ]; then
        # whoami ends with the room's own check (D42); this is the half only this computer knows.
        case "$tool" in *whoami) ;; *) exit 0 ;; esac
        h=$(cat "$FOLDER/helper" 2>/dev/null)
        if [ -n "$h" ] && [ "$h" = "$sid" ]; then where="this chat is the one that listens in this folder ✓"
        elif [ -n "$h" ]; then where="another chat in this folder listens, not this one. A new chat opened here takes it over when it starts"
        elif [ -f "$FOLDER/answered" ]; then where="no chat in this folder listens ✗. Fix: say listen here in this chat"
        else where="this folder chose not to listen. To turn it on, say listen here in this chat"; fi
        printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}' "AIsle plugin check, from this computer: plugin ✓ (version ${VER:-unknown}) · $where."
        exit 0
      fi
      mkdir -p "$FOLDER" || exit 0
      date -u +%Y-%m-%dT%H:%M:%SZ > "$asked"
      log "asked once whether to listen for $dir"
      printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}' "AIsle plugin: nothing in this folder wakes up when somebody writes in the room, and it has never been asked. Ask your user now, in one short line and nothing else: shall this chat listen for the room, yes or no? If yes, call listen_here. If no, say nothing more about it: this is asked once per folder, ever."
      exit 0
      ;;
  esac
  # Only a call the room accepted picks this chat.
  printf '%s' "$input" | grep -q 'Listening is on' || exit 0
  mkdir -p "$FOLDER" || exit 0
  echo "$sid" > "$FOLDER/helper"
  # This folder has said yes once. Every later chat here starts listening without asking again.
  date -u +%Y-%m-%dT%H:%M:%SZ > "$FOLDER/answered"
  yes_add "$dir"
  # A fresh start: the first look reports what is unread, rather than counting from an old visit.
  rm -f "$DATA/after-$sid" "$DATA/said-lost-$sid"
  log "this chat now listens for $dir"
  printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}' "AIsle plugin: this chat is now the only one that listens to the room for this folder, and the other chats here stay quiet. Listening starts when this reply ends."
  exit 0
fi

# From here on, the listener: SessionStart or Stop.

# Notes from 0.1.0 are left alone: chats started before an update keep running the old copy until they
# restart, and removing its "already said" markers made them ask again (seen 2026-09-19).
# A week-old session's notes are of no use to anyone.
for pattern in 'after-*' 'said-*' 'pid-*'; do find "$DATA" -maxdepth 1 -type f -name "$pattern" -mtime +7 -delete 2>/dev/null; done

# A folder that has never said yes stays silent, whatever happens in it. A folder that was listening
# before this version said yes by being picked at all: it keeps listening, and is not asked again.
if [ ! -f "$FOLDER/answered" ]; then
  [ -s "$FOLDER/helper" ] || exit 0
  date -u +%Y-%m-%dT%H:%M:%SZ > "$FOLDER/answered"
  log "carried an older listening folder over to the automatic rule"
fi
yes_add "$dir"

# The newest chat in this folder is the one the person is in, so at its start it takes listening over
# (D38). No question, nothing to type. The chat that had it notices at its next turn through the loop
# and stops without a word. Stop, unlike SessionStart, never takes anything over: it runs after every
# reply in every chat, and a room would ping-pong between two open chats forever.
helper=$(cat "$FOLDER/helper" 2>/dev/null)
if [ "$helper" != "$sid" ]; then
  if [ "$event" = "SessionStart" ]; then
    echo "$sid" > "$FOLDER/helper"
    rm -f "$DATA/after-$sid" "$DATA/said-lost-$sid"
    log "took listening over for $dir (new chat)"
  else
    exit 0
  fi
fi
mine() { [ "$(cat "$FOLDER/helper" 2>/dev/null)" = "$sid" ]; }

# One watcher per chat: Stop runs after every reply.
lock="$DATA/pid-$sid"
if [ -f "$lock" ] && kill -0 "$(cat "$lock" 2>/dev/null)" 2>/dev/null; then exit 0; fi
echo $$ > "$lock"
F=$(mktemp)
trap 'rm -f "$lock" "$F"' EXIT

# In a file rather than on curl's command line, where anyone listing processes could read it.
HEADER_FILE="$FOLDER/header"
printf 'Authorization: Bearer %s' "$(folder_token)" > "$HEADER_FILE"

after_file="$DATA/after-$sid"
after=$(cat "$after_file" 2>/dev/null)
log "start ($event, pid $$) for $dir"
down=''
while true; do
  q=''
  [ -n "$after" ] && q="?after=$after"
  code=$(curl -sS -m 40 -A "aisle-plugin/${VER:-0.0.0}" -o "$F" -w '%{http_code}' -H "@$HEADER_FILE" "$U$q" 2>/dev/null)
  # The person may have picked another chat meanwhile. Then this one stops, and says nothing.
  if ! mine; then log "stop: another chat listens for $dir now"; exit 0; fi
  if [ "$code" = "401" ]; then
    rm -f "$FOLDER/helper" "$FOLDER/answered" "$FOLDER/asked"
    yes_index
    log "stop: the room refused this folder's listener"
    say_once lost "AIsle: this chat stopped listening to the room. Either the room now listens somewhere else (another folder or computer), or the connection ended (the assistant was removed, replaced, or signed out). Tell your user in one line. Call listen_here again only if they ask you to."
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
