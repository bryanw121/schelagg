#!/usr/bin/env bash
# The scrape's output lives on the `data` branch, not `main`, so a schedule refresh never
# lands on the branch Vercel deploys (each push to main counts against Vercel's daily
# deployment limit, skipped builds included). `main` keeps only code plus a seed copy.
#
#   scripts/data-branch.sh pull          overlay the latest data from origin/data onto the working tree
#   scripts/data-branch.sh push "<msg>"  commit the working tree's data files to origin/data
set -euo pipefail
FILES=(public/data/schedule.json public/data/occurrences.json data/watch.json data/health.json)
cmd=${1:-}

case "$cmd" in
  pull)
    if git fetch -q origin data 2>/dev/null; then
      for f in "${FILES[@]}"; do
        if git cat-file -e "origin/data:$f" 2>/dev/null; then
          mkdir -p "$(dirname "$f")"
          git show "origin/data:$f" > "$f"
        fi
      done
      echo "Overlaid data from origin/data ($(git rev-parse --short origin/data))."
    else
      echo "No data branch yet; using the seed copy on this checkout."
    fi
    ;;
  push)
    msg=${2:?commit message required}
    tmp=$(mktemp -d)
    for f in "${FILES[@]}"; do [ -f "$f" ] && { mkdir -p "$tmp/$(dirname "$f")"; cp "$f" "$tmp/$f"; }; done
    repo=$(pwd)
    wt=$(mktemp -d)/data
    trap 'cd "$repo"; git worktree remove --force "$wt" >/dev/null 2>&1 || true' EXIT
    if git fetch -q origin data 2>/dev/null; then
      git worktree add -q -B data "$wt" origin/data
    else
      git worktree add -q --orphan -b data "$wt"
    fi
    cp -R "$tmp/." "$wt/"
    cd "$wt"
    present=(); for f in "${FILES[@]}"; do [ -f "$f" ] && present+=("$f"); done
    [ ${#present[@]} -gt 0 ] || { echo "No data files to push." >&2; exit 1; }
    git add -- "${present[@]}"
    if git diff --cached --quiet; then echo "Data unchanged."; exit 0; fi
    git commit -q -m "$msg"
    for attempt in 1 2 3; do
      if git push -q origin data; then echo "Pushed data: $(git rev-parse --short HEAD)"; exit 0; fi
      git fetch -q origin data && git rebase -q origin/data || { git rebase --abort; git reset -q --soft origin/data; git commit -q -m "$msg"; }
    done
    echo "Could not push the data branch" >&2; exit 1
    ;;
  *)
    echo "usage: $0 pull | push <message>" >&2; exit 2
    ;;
esac
