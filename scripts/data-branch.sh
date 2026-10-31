#!/usr/bin/env bash
# The scrape's output lives on the `data` branch, not `main`, so a schedule refresh never
# lands on the branch Vercel deploys (each push to main counts against Vercel's daily
# deployment limit, skipped builds included). `main` keeps only code plus a seed copy.
#
#   scripts/data-branch.sh pull          overlay the latest data from origin/data onto the working tree
#   scripts/data-branch.sh push "<msg>"  commit the working tree's data files to origin/data
set -euo pipefail
# Every file the scrape writes under public/data (combined feed, per-sport calendars, index.json and
# one folder per region) except courts.json, which the deploy builds fresh; plus the run state.
# Listed after fetching, so files that only exist on the data branch are included.
data_files() {
  # (|| true: before the first push there's no data branch, and under pipefail that would end the list)
  { find public/data -type f 2>/dev/null || true; git ls-tree -r --name-only origin/data -- public/data 2>/dev/null || true; } \
    | { grep -v '/courts\.json$' || true; } | sort -u
  echo data/watch.json
  echo data/health.json
}
# Vercel reads vercel.json from the commit it is about to build, so the data branch carries
# main's copy: its git.deploymentEnabled turns the data branch off. Pushed, never pulled.
CONFIG=(vercel.json)
cmd=${1:-}

case "$cmd" in
  pull)
    if git fetch -q origin data 2>/dev/null; then
      FILES=(); while IFS= read -r f; do FILES+=("$f"); done < <(data_files) # (no mapfile: macOS ships bash 3.2)
      for f in "${FILES[@]}"; do
        if git cat-file -e "origin/data:$f" 2>/dev/null; then
          mkdir -p "$(dirname "$f")"
          git show "origin/data:$f" > "$f"
        fi
      done
      # The home runner's results (lib/offsite.js): read here, never pushed by this script, so a
      # refresh can't overwrite a newer result the home runner committed meanwhile.
      while IFS= read -r f; do mkdir -p "$(dirname "$f")"; git show "origin/data:$f" > "$f"; done \
        < <(git ls-tree -r --name-only origin/data -- data/offsite 2>/dev/null || true)
      echo "Overlaid data from origin/data ($(git rev-parse --short origin/data))."
    else
      echo "No data branch yet; using the seed copy on this checkout."
    fi
    ;;
  push)
    msg=${2:?commit message required}
    git fetch -q origin data 2>/dev/null || true
    FILES=(); while IFS= read -r f; do FILES+=("$f"); done < <(data_files) # (no mapfile: macOS ships bash 3.2)
    tmp=$(mktemp -d)
    for f in "${FILES[@]}" "${CONFIG[@]}"; do [ -f "$f" ] && { mkdir -p "$tmp/$(dirname "$f")"; cp "$f" "$tmp/$f"; }; done
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
    present=(); for f in "${FILES[@]}" "${CONFIG[@]}"; do [ -f "$f" ] && present+=("$f"); done
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
