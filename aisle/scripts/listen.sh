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
#
# One chat per folder listens: the one the person asked, in words, to listen (D28). A person works on
# many projects in many chats on one computer, and a room belongs to one of them, so every other chat,
# in this folder or any other, stays silent. Nothing happens in a folder until the person asks.
#
# Each folder has its own credential, made here and kept in the plugin's data folder. Claude only ever
# carries its fingerprint (the token's id and the SHA-256 of its secret), which cannot watch anything.
#
# Loud exactly once. Each problem is said once per session and then it stays quiet, because Stop runs
# after every reply and a listener that repeats itself wakes the session in a loop (seen 2026-09-19).
#
# Deliberately no backslashes anywhere in this file: on Windows it runs in Git Bash, and shells there
# have eaten them before. It needs bash, curl, grep, cut, tr, sed, head, base64 and a SHA-256 tool,
# which Git Bash, macOS and Linux all have.

U="${AISLE_WATCH_URL:-https://aisle.abstractobjective.dev/watch}"
DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.aisle-plugin}"
LOG="$DATA/listener.log"

umask 077
mkdir -p "$DATA" || exit 0

# The hook's input is JSON on stdin. Read it without ever blocking on a stdin that stays open.
IFS= read -r -t 3 -d '' input
field() { printf '%s' "$input" | grep -oE '"'"$1"'" *: *"[^"]*"' | head -1 | cut -d'"' -f4; }
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
  # Only a call the room accepted picks this chat.
  printf '%s' "$input" | grep -q 'Listening is on' || exit 0
  mkdir -p "$FOLDER" || exit 0
  echo "$sid" > "$FOLDER/helper"
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

# Only the chat picked for this folder listens. Everywhere else: silence.
helper=$(cat "$FOLDER/helper" 2>/dev/null)
[ -z "$helper" ] && exit 0
if [ "$helper" != "$sid" ]; then
  [ "$event" = "SessionStart" ] && log "quiet: another chat listens for $dir"
  exit 0
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
  code=$(curl -sS -m 40 -o "$F" -w '%{http_code}' -H "@$HEADER_FILE" "$U$q" 2>/dev/null)
  # The person may have picked another chat meanwhile. Then this one stops, and says nothing.
  if ! mine; then log "stop: another chat listens for $dir now"; exit 0; fi
  if [ "$code" = "401" ]; then
    rm -f "$FOLDER/helper"
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
