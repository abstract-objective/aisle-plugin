# Which files usually change together (D46, D45 step 5): RIGGS's co-change lists, built on this
# computer from git alone, with nothing to install. The AIsle plugin's worker runs it for a clone, on
#
#   git ls-tree -r --name-only <base>                        the files, given first as part=1
#   git log --no-renames --name-only --format=<a tab> <base>  every commit the base reaches
#
# and it prints, for every file with history, its 10 best partners, best first, one line each:
#
#   <file> TAB <partner>
#
# They are RIGGS's learned.CoChange(...).partners(f, 10) on the candidates RIGGS's C1 used, the
# base's files with Unity's .meta files dropped:
#
#   jaccard(f, v) = together(f, v) / (changes(f) + changes(v) - together(f, v))
#
# over every commit the base reaches, with no threshold and no skipping of big commits. A merge lists
# no paths and counts for nothing, and ties go to the smaller path. Checked on VR_Sim on 2026-10-07:
# all 9,518 files with history, 0 lists different from RIGGS's, in 7.5 s on Windows.
#
# Any awk will do: no arrays sorted, no lengths of arrays, no deleting a whole array, and every
# comparison of two paths made a string one, since a path like 2024 would otherwise compare as a
# number. Run it with LC_ALL=C, so paths compare byte by byte, as RIGGS compares them. No backslashes,
# as in listen.sh. A path git had to quote (a quote, a tab or a newline in its name) is left out.

BEGIN { T = sprintf("%c", 9); Q = sprintf("%c", 34); TOP = 10; hn = 0; nc = 0 }

part == 1 {
  if ($0 != "" && substr($0, 1, 1) != Q && $0 !~ /[.]meta$/) cand[$0] = 1
  next
}

# The history: a line that is a tab alone begins a commit, and the paths it changed follow.
$0 == T { commit(); next }
$0 == "" { next }
($0 in cand) && !($0 in here) { here[$0] = 1; hk[++hn] = $0 }

END {
  commit()
  for (f in changes) {
    # How often each other file changed together with f, from the commits that changed f.
    m = 0
    nt = split(substr(touched[f], 2), ci, T)
    for (t = 1; t <= nt; t++) {
      k = split(files[ci[t]], fs, T)
      for (i = 1; i <= k; i++) {
        v = fs[i]
        if (v in n) n[v]++
        else if (v != f) { seen[++m] = v; n[v] = 1 }
      }
    }
    # The best 10 of them, kept in order as they come: a higher jaccard first, then the smaller path.
    kept = 0
    cf = changes[f]
    for (t = 1; t <= m; t++) {
      v = seen[t]
      c = n[v]
      delete n[v]
      j = c / (cf + changes[v] - c)
      if (kept == TOP && (j < bj[TOP] || (j == bj[TOP] && (v "") > (bv[TOP] "")))) continue
      if (kept < TOP) kept++
      for (i = kept; i > 1 && (j > bj[i - 1] || (j == bj[i - 1] && (v "") < (bv[i - 1] ""))); i--) {
        bv[i] = bv[i - 1]
        bj[i] = bj[i - 1]
      }
      bv[i] = v
      bj[i] = j
    }
    for (i = 1; i <= kept; i++) print f T bv[i]
  }
}

# One commit's files: each counts one change, and the commit is kept as one line of them, so the
# partners of a file are counted from its own commits only.
function commit(   i, s) {
  if (!hn) return
  nc++
  s = ""
  for (i = 1; i <= hn; i++) {
    s = s T hk[i]
    changes[hk[i]]++
    touched[hk[i]] = touched[hk[i]] T nc
    delete here[hk[i]]
  }
  files[nc] = substr(s, 2)
  hn = 0
}
