#!/usr/bin/env bash
# The AIsle plugin's plan poster (job f21): prints the exact messages that carry a project's plan to its AIsle room, so
# no plan is cut or pasted by hand. It reads aisle/PLAN.md, aisle/SUMMARY.md, aisle/STATUS.md and aisle/missions/*.md
# and packs them as AIsle's own poster does (engine/aisle/plan.mjs planMessages, test/f21-bring-project.test.mjs holds
# the two to the same bytes): one message while "Plan:" and the plan fit in the room's 16,000 characters, else parts cut
# at line ends, "Plan 1/3 #<stamp>:" and so on. It never posts, opens no connection and holds no key: the assistant
# posts each message as printed, with its own post_message. Bash and awk only, as the rest of the plugin (no node).
#
#   bash post-plan.sh --dir <folder>          the messages: how many, each one's length and first line (a dry run)
#   bash post-plan.sh --dir <folder> --part 1 message 1 exactly, nothing else (post it as it is)
#   bash post-plan.sh --dir <folder> --only plan   the Plan: block alone (what a plan edit posts again)
#
# <folder> is the project's folder or its aisle folder; with no --dir, ./aisle.
LIMIT=16000   # the room's limit on one message (engine/aisle/chat.mjs MESSAGE_MAX), counted as the room counts

dir='' part='' only=''
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) [ $# -ge 2 ] || { echo '--dir takes a folder: the project, or its aisle folder.' >&2; exit 1; }; dir=$2; shift 2 ;;
    --part) [ $# -ge 2 ] || { echo '--part takes a number: 1 for the first message.' >&2; exit 1; }; part=$2; shift 2 ;;
    --only) [ "${2:-}" = plan ] || { echo '--only takes "plan": the Plan: block alone, no Summary:, Status: or Briefs:.' >&2; exit 1; }; only=plan; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "post-plan.sh does not know \"$1\". It takes --dir <folder>, --part <n> and --only plan." >&2; exit 1 ;;
  esac
done
case "$part" in ''|[1-9]|[1-9][0-9]|[1-9][0-9][0-9]) ;; *) echo '--part takes a number: 1 for the first message.' >&2; exit 1 ;; esac

# The aisle folder: <dir>/aisle, or <dir> itself when it is one. A Windows path is read as Git Bash reads it.
dir=${dir//\\//}
if [ -z "$dir" ]; then where=aisle
elif [ -f "$dir/aisle/PLAN.md" ]; then where=${dir%/}/aisle
elif d=${dir%/}; [ "${d##*/}" = aisle ]; then where=$d
else where=${dir%/}/aisle
fi
[ -f "$where/PLAN.md" ] || { echo "No plan at $where/PLAN.md." >&2; exit 1; }
cd -- "$where" || { echo "Cannot open $where." >&2; exit 1; }

# The files, in the order the room reads them: the plan, the summary, the status, then each brief by its name, in byte
# order, as the engine sorts them. Each is named from here with "./", so awk never takes one for a variable.
files=(./PLAN.md)
if [ -z "$only" ]; then
  [ -f ./SUMMARY.md ] && files+=(./SUMMARY.md)
  [ -f ./STATUS.md ] && files+=(./STATUS.md)
  if [ -d ./missions ]; then
    while IFS= read -r id; do files+=("./missions/$id.md"); done < <(
      for f in ./missions/*.md; do [ -f "$f" ] && { f=${f#./missions/}; printf '%s\n' "${f%.md}"; }; done | LC_ALL=C sort)
  fi
fi

IFS= read -r -d '' PROG <<'AWK'
# Read in the C locale, byte by byte: lengths are counted here in UTF-16 units, as the room counts a message
# (JavaScript's length), whatever awk this computer has.
BEGIN {
  WS = " \t\r" sprintf("%c%c", 11, 12)   # what JavaScript's \s takes, of the ASCII characters
  for (i = 1; i < 256; i++) ORD[sprintf("%c", i)] = i
  HI = "[" sprintf("%c", 128) "-" sprintf("%c", 255) "]"
  BOM = sprintf("%c%c%c", 239, 187, 191)
  B36 = "0123456789abcdefghijklmnopqrstuvwxyz"
  for (a = 0; a < 128; a++) for (b = 0; b < 128; b++) X7[a * 128 + b] = xorn(a, b, 7)
  nm = 0
  for (i = 1; i < ARGC; i++) {
    f = ARGV[i]
    if (f == "./PLAN.md" || f == "./SUMMARY.md" || f == "./STATUS.md") continue
    nm++; MF[nm] = f; MID[nm] = substr(f, 12, length(f) - 14)   # "./missions/" and ".md" off
  }
}
# Every line, its line end made \n as the room stores it (a lone \r ends a line too), and the plan's, summary's and
# status's mark of byte order left out.
{
  line = $0
  if (FNR == 1 && substr(FILENAME, 1, 11) != "./missions/" && substr(line, 1, 3) == BOM) line = substr(line, 4)
  sub(/\r$/, "", line)
  if (line == "") { L[FILENAME, ++N[FILENAME]] = ""; next }
  n = split(line, bits, "\r")
  for (k = 1; k <= n; k++) L[FILENAME, ++N[FILENAME]] = bits[k]
}
function xorn(a, b, bits,   r, p, k) {
  r = 0; p = 1
  for (k = 0; k < bits; k++) { if (a % 2 != b % 2) r += p; a = (a - a % 2) / 2; b = (b - b % 2) / 2; p *= 2 }
  return r
}
function units(s,   n, i, b, u) {
  if (s !~ HI) return length(s)
  n = length(s); u = 0
  for (i = 1; i <= n; i++) { b = ORD[substr(s, i, 1)]; if (b < 128 || b >= 192) u++; if (b >= 240) u++ }
  return u
}
function points(s,   n, i, b, u) {
  if (s !~ HI) return length(s)
  n = length(s); u = 0
  for (i = 1; i <= n; i++) { b = ORD[substr(s, i, 1)]; if (b < 128 || b >= 192) u++ }
  return u
}
function rtrim(s) { sub("[" WS "\n]+$", "", s); return s }
function ltrim(s) { sub("^[" WS "\n]+", "", s); return s }
function blank(s) { return s ~ ("^[" WS "]*$") }
function take(f, b,   i) { BC[b] = N[f] + 0; for (i = 1; i <= BC[b]; i++) BL[b, i] = L[f, i] }
function push(b, s) { BL[b, ++BC[b]] = s }
function trimend(b) {
  while (BC[b] > 0 && blank(BL[b, BC[b]])) BC[b]--
  if (BC[b] > 0) BL[b, BC[b]] = rtrim(BL[b, BC[b]])
}
function trimstart(b,   i, k) {
  for (k = 1; k <= BC[b] && blank(BL[b, k]); k++);
  if (k > 1) { for (i = k; i <= BC[b]; i++) BL[b, i - k + 1] = BL[b, i]; BC[b] -= k - 1 }
  if (BC[b] > 0) BL[b, 1] = ltrim(BL[b, 1])
}
# A line the room would read as the start of a block (plan.mjs markerShaped): a plan holding one cannot be posted.
function shaped(l,   t, w, nn) {
  t = rtrim(ltrim(l))
  if (t ~ /^(Plan|Summary|Status|Briefs):$/) return 1
  if (t !~ ("^(Plan|Summary|Status|Briefs)[" WS "]+[0-9]+/[0-9]+[" WS "]+#[a-z0-9]+:$")) return 0
  split(t, w, "[" WS "]+"); split(w[2], nn, "/")
  return length(nn[1]) <= 3 && length(nn[2]) <= 3 && length(w[3]) <= 14
}
# The stamp that ties the parts of one block together (plan.mjs stampOf): FNV-1a over the block's UTF-16 units, base 36.
function fnv(h, c,   lo) {
  if (c < 128) { lo = h % 128; h = h - lo + X7[lo * 128 + c] }
  else { lo = h % 65536; h = h - lo + xorn(lo, c, 16) }
  return ((h % 256) * 16777216 + h * 403) % 4294967296
}
function stampof(b,   h, i, j, s, n, by, cp, lo, d, out) {
  h = 2166136261
  for (i = 1; i <= BC[b]; i++) {
    if (i > 1) h = fnv(h, 10)
    s = BL[b, i]; n = length(s)
    for (j = 1; j <= n; j++) {
      by = ORD[substr(s, j, 1)]
      # An ASCII character, nearly all of a plan, is hashed here without a call.
      if (by < 128) { lo = h % 128; h = h - lo + X7[lo * 128 + by]; h = ((h % 256) * 16777216 + h * 403) % 4294967296 }
      else if (by >= 240 && by < 248) {
        cp = (by - 240) * 262144 + (ORD[substr(s, j + 1, 1)] - 128) * 4096 + (ORD[substr(s, j + 2, 1)] - 128) * 64 + ORD[substr(s, j + 3, 1)] - 128
        j += 3; cp -= 65536
        h = fnv(h, 55296 + (cp - cp % 1024) / 1024); h = fnv(h, 56320 + cp % 1024)
      } else {
        if (by >= 224) { cp = (by - 224) * 4096 + (ORD[substr(s, j + 1, 1)] - 128) * 64 + ORD[substr(s, j + 2, 1)] - 128; j += 2 }
        else if (by >= 192) { cp = (by - 192) * 64 + ORD[substr(s, j + 1, 1)] - 128; j += 1 }
        else cp = 65533
        h = fnv(h, cp)
      }
    }
  }
  out = ""
  do { d = h % 36; out = substr(B36, d + 1, 1) out; h = (h - d) / 36 } while (h > 0)
  return out
}
# Where a line longer than a whole part is cut: the byte before which `room` units end (never inside a character).
function cutat(s, room,   n, i, by, cl, cu, u) {
  if (s !~ HI) return room + 1
  n = length(s); u = 0; i = 1
  while (i <= n) {
    by = ORD[substr(s, i, 1)]
    cl = by >= 240 ? 4 : by >= 224 ? 3 : by >= 192 ? 2 : 1
    cu = by >= 240 ? 2 : 1
    if (u + cu > room) break
    u += cu; i += cl
  }
  return i
}
function commas(n,   s) { s = n ""; while (s ~ /[0-9][0-9][0-9][0-9]/) sub(/[0-9][0-9][0-9]($|,)/, ",&", s); return s }
function fail(msg) { print msg > "/dev/stderr"; failed = 1; exit 1 }
END {
  if (failed) exit 1
  # The plan.
  nb = 1; KN[1] = "Plan"; take("./PLAN.md", 1); trimend(1)
  if (BC[1] == 0) fail("No plan at " where "/PLAN.md.")
  # The summary for people (plan.mjs summaryText): "# heading" lines out, blank runs made one, at most 1,024 characters.
  if ("./SUMMARY.md" in N) {
    nb++; KN[nb] = "Summary"; BC[nb] = 0; e = 0
    for (i = 1; i <= N["./SUMMARY.md"]; i++) {
      l = L["./SUMMARY.md", i]
      if (rtrim(ltrim(l)) ~ ("^#[" WS "]")) continue
      if (l == "") { if (e++) continue } else e = 0
      push(nb, l)
    }
    trimstart(nb); trimend(nb)
    c = BC[nb] > 0 ? BC[nb] - 1 : 0
    for (i = 1; i <= BC[nb]; i++) c += points(BL[nb, i])
    if (c > 1024) fail("Cannot pack the plan: the summary is " c " characters; a summary is at most 1,024, so shorten SUMMARY.md")
    if (BC[nb] == 0) nb--
  }
  if ("./STATUS.md" in N) { nb++; KN[nb] = "Status"; take("./STATUS.md", nb); trimend(nb); if (BC[nb] == 0) nb-- }
  # The wall briefs, "Brief <id>:" and each one's text, a blank line between.
  if (nm > 0) {
    nb++; KN[nb] = "Briefs"; BC[nb] = 0
    for (m = 1; m <= nm; m++) {
      if (m > 1) push(nb, "")
      push(nb, "Brief " MID[m] ":")
      take(MF[m], 0); trimend(0)
      if (BC[0] == 0) push(nb, "")
      for (i = 1; i <= BC[0]; i++) push(nb, BL[0, i])
    }
    trimend(nb)
    if (BC[nb] == 0) nb--
  }
  for (b = 1; b <= nb; b++) for (i = 1; i <= BC[b]; i++) if (shaped(BL[b, i]))
    fail("Cannot pack the plan: " KN[b] " has a line \"" rtrim(ltrim(BL[b, i])) "\" that would read as a marker; change that line")

  # Each block whole when it fits one message, else in parts of at most max - 30 units, cut at line ends.
  room = max - 30; nc = 0
  for (b = 1; b <= nb; b++) {
    total = BC[b] - 1
    for (i = 1; i <= BC[b]; i++) { LU[i] = units(BL[b, i]); total += LU[i] }
    if (length(KN[b]) + 2 + total <= max) {
      s = BL[b, 1]; for (i = 2; i <= BC[b]; i++) s = s "\n" BL[b, i]
      C[++nc] = KN[b] ":\n" s; CU[nc] = length(KN[b]) + 2 + total; CW[nc] = 0
      continue
    }
    np = 0; has = 0
    for (i = 1; i <= BC[b]; i++) {
      line = BL[b, i]; lu = LU[i]
      while (lu > room) {
        if (has) { P[++np] = cur; PU[np] = curu }
        has = 0; k = cutat(line, room)
        P[++np] = substr(line, 1, k - 1); PU[np] = units(P[np])
        line = substr(line, k); lu = units(line)
      }
      nu = has ? curu + 1 + lu : lu
      if (nu > room) { P[++np] = cur; PU[np] = curu; cur = line; curu = lu }
      else { cur = has ? cur "\n" line : line; curu = nu }
      has = 1
    }
    if (has) { P[++np] = cur; PU[np] = curu }
    st = stampof(b)
    for (j = 1; j <= np; j++) {
      head = KN[b] " " j "/" np " #" st ":\n"
      C[++nc] = head P[j]; CU[nc] = length(head) + PU[j]
      CW[nc] = match(C[nc], "[" WS "\n]+$") ? RLENGTH : 0
    }
  }
  # Blocks share a message while the message, its blank end aside, stays within max.
  no = 0
  for (c = 1; c <= nc; c++) {
    if (no && OU[no] + 2 + CU[c] - CW[c] <= max) { O[no] = O[no] "\n\n" C[c]; OU[no] += 2 + CU[c]; continue }
    O[++no] = C[c]; OU[no] = CU[c]
  }
  for (c = 1; c <= no; c++) { t = rtrim(O[c]); OU[c] -= length(O[c]) - length(t); O[c] = t }

  if (part != "") {
    if (part + 0 < 1 || part + 0 > no) fail("--part takes 1 to " no ".")
    printf "%s", O[part + 0]
    exit 0
  }
  print no " message" (no == 1 ? "" : "s") " (limit " commas(max) " characters each), from " where ":"
  for (c = 1; c <= no; c++) {
    n = split(O[c], ml, "\n"); bl = ""
    for (i = 1; i <= n; i++) if (ml[i] ~ /^(Plan|Summary|Status|Briefs)( [0-9]+\/[0-9]+ #[a-z0-9]+)?:$/) bl = bl (bl == "" ? "" : ", ") ml[i]
    print "  " c ". " commas(OU[c]) " characters, first line: " ml[1] " (blocks: " bl ")"
  }
  print "Print each with --part <n> and post it as it is, in order, with post_message. Nothing is posted by this."
}
AWK

# awk once more if it died of a signal: Git Bash's GNU Awk 5.0.0 aborted once with "fatal error: internal error" on a PC
# running three test suites at once (2026-10-26), and passed on the same files every other time. Its words are said
# only when the last try fails, and a message is printed only whole.
err=$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/post-plan.$$")
trap 'rm -f -- "$err"' EXIT
for try in 1 2; do
  out=$(LC_ALL=C awk -v max="$LIMIT" -v part="$part" -v where="$where" "$PROG" "${files[@]}" 2>"$err"); code=$?
  [ "$code" -lt 128 ] && break
done
[ "$code" -eq 0 ] || { cat -- "$err" >&2; exit "$code"; }
if [ -n "$part" ]; then printf '%s' "$out"; else printf '%s\n' "$out"; fi
