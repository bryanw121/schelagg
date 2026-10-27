#!/usr/bin/env bash
# One small JSON state file kept on its own branch between workflow runs (never main, which
# Vercel deploys). The branch carries main's vercel.json, whose git.deploymentEnabled turns
# deployments off for it, the same way scripts/data-branch.sh does for the data branch.
#
#   scripts/state-branch.sh pull <branch> <file>           copy <file> from origin/<branch>, if it's there
#   scripts/state-branch.sh push <branch> <file> "<msg>"   commit <file> (and vercel.json) to origin/<branch>
set -euo pipefail
cmd=${1:-} branch=${2:?branch} file=${3:?file}

case "$cmd" in
  pull)
    if git fetch -q origin "$branch" 2>/dev/null && git cat-file -e "origin/$branch:$file" 2>/dev/null; then
      git show "origin/$branch:$file" > "$file"
      echo "Loaded $file from $branch ($(git rev-parse --short "origin/$branch"))."
    else
      echo "No $file on $branch yet; starting fresh."
    fi
    ;;
  push)
    msg=${4:?commit message required}
    [ -f "$file" ] || { echo "No $file to save."; exit 0; }
    tmp=$(mktemp -d); cp "$file" "$tmp/state"; [ -f vercel.json ] && cp vercel.json "$tmp/vercel.json"
    repo=$(pwd); wt=$(mktemp -d)/state
    trap 'cd "$repo"; git worktree remove --force "$wt" >/dev/null 2>&1 || true' EXIT
    if git fetch -q origin "$branch" 2>/dev/null; then
      git worktree add -q -B "$branch" "$wt" "origin/$branch"
    else
      git worktree add -q --orphan -b "$branch" "$wt"
    fi
    cp "$tmp/state" "$wt/$file"; [ -f "$tmp/vercel.json" ] && cp "$tmp/vercel.json" "$wt/vercel.json"
    cd "$wt"
    git add -- "$file" $( [ -f vercel.json ] && echo vercel.json )
    if git diff --cached --quiet; then echo "$file unchanged."; exit 0; fi
    git commit -q -m "$msg"
    git push -q origin "$branch"
    echo "Saved $file to $branch: $(git rev-parse --short HEAD)"
    ;;
  *)
    echo "usage: $0 pull|push <branch> <file> [message]" >&2; exit 2
    ;;
esac
