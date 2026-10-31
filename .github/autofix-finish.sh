#!/usr/bin/env bash
# The auto-fix job's last step (.github/workflows/scrape.yml), after Claude has edited the
# working tree. Decides what happens to the change:
#
#   no change            -> Claude's summary goes on the issue
#   npm test fails       -> the failure goes on the issue; nothing is pushed
#   every gate passes    -> merged to main and a fresh scrape is started
#   otherwise            -> a pull request for review, with the gate results
#
# Gates for merging without review:
#   1. Only adapters, region config (config/regions/*/sources.json), the fixture sanitizer, parser tests and fixtures
#      changed. Anything else (shared code, the gates themselves, manual data) gets reviewed.
#   2. npm test (unit + integration) passes.
#   3. The site end-to-end test passes.
#   4. A live re-run of the scrape with the fix, against the health baseline from before the
#      source changed, shows the reported problems gone and nothing newly broken
#      (scripts/verify-fix.mjs).
#
# The workflow runs this file as committed on main, never the working-tree copy Claude could edit.
set -uo pipefail

issue=$(gh issue list --state open --search 'in:title "Schedule scrape: source changed"' --json number --jq '.[0].number')
comment() { if [ -n "$issue" ]; then gh issue comment "$issue" --body-file "$1" || true; fi; }
run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
summary=autofix-summary.md
[ -s "$summary" ] || echo "Claude didn't leave a summary; see the run log." > "$summary"

git add -A -- lib scripts config test README.md
if git diff --cached --quiet; then
  { cat "$summary"; echo; echo "---"; echo "No code change. Auto-fix run: $run_url"; } > note.md
  comment note.md
  exit 0
fi
changed=$(git diff --cached --name-only)

gates=()
mergeable=true
pass() { gates+=("- ✅ $1"); }
fail() { gates+=("- ❌ $1"); mergeable=false; }

# 1. Scope
outside=$(grep -Ev '^(scripts/adapters/|config/sources\.json$|scripts/sanitize-fixtures\.mjs$|test/parsers\.test\.mjs$|test/fixtures/|README\.md$)' <<< "$changed" || true)
if [ -n "$outside" ]; then
  fail "Changes outside adapters, config and parser tests need a review: $(tr '\n' ' ' <<< "$outside")"
else
  pass "Only adapters, config and parser tests changed"
fi

# 2. Unit + integration tests: a fix that fails them goes nowhere.
if npm test > test-output.txt 2>&1; then
  pass "Unit and integration tests (\`npm test\`)"
else
  { echo "Auto-fix changed code but \`npm test\` failed, so nothing was pushed."; echo; cat "$summary"; echo; echo '```'; tail -40 test-output.txt; echo '```'; echo; echo "Run: $run_url"; } > note.md
  comment note.md
  exit 1
fi

# 3. The site, end to end.
if npm run test:e2e > e2e-output.txt 2>&1; then pass "Site end-to-end test"; else fail "Site end-to-end test failed (see the run log)"; fi

# 4. Live re-run against the baseline from before the change (only worth hitting the sources
#    if nothing above already rules out merging).
if $mergeable; then
  mkdir -p baseline
  # The newest data-branch commit touching health.json is the run that reported the change;
  # the one before it is the baseline. (Scrape output lives on the data branch, not main.)
  git fetch -q --depth=50 origin data 2>/dev/null || true
  base=$(git log --format=%H -n 2 origin/data -- data/health.json 2>/dev/null | sed -n 2p)
  if [ -n "$base" ]; then
    git show "$base:data/health.json" > baseline/health.json
    git show "$base:public/data/schedule.json" > baseline/schedule.json
  fi
  node scripts/verify-fix.mjs baseline scrape-changes.json verify-result.json > verify-output.txt 2>&1
  if [ "$(jq -r .mergeable verify-result.json 2>/dev/null)" = true ]; then
    pass "Live re-run of the scrape: the reported problems are gone and nothing newly broke"
  else
    fail "Live re-run of the scrape: $(jq -r '.reasons | join("; ")' verify-result.json 2>/dev/null || tail -3 verify-output.txt)"
  fi
fi

title="Auto-fix: adapt to source changes${issue:+ (#$issue)}"
{
  echo "## Auto-merge gates"; printf '%s\n' "${gates[@]}"; echo
  cat "$summary"; echo; echo "---"; echo "Auto-fix run: $run_url"
  [ -n "$issue" ] && echo "Addresses #$issue."
} > pr-body.md

branch="autofix/$(date -u +%Y%m%d-%H%M%S)"
git config user.name "schelagg-autofix"
git config user.email "schelagg-autofix@users.noreply.github.com"
git checkout -q -b "$branch"
git commit -q -m "$title" -m "$(printf '%s\n' "${gates[@]}")"
git push -q origin "$branch"
pr=$(gh pr create --base main --head "$branch" --title "$title" --body-file pr-body.md --assignee "$GITHUB_REPOSITORY_OWNER" 2> pr-error.txt) || pr=""

merged=""
if $mergeable; then
  if [ -n "$pr" ]; then
    gh pr merge "$pr" --squash --delete-branch && merged="$pr"
  else
    # Actions may not be allowed to open pull requests here. Every gate passed, so land it directly.
    git fetch -q origin main && git rebase -q origin/main && git push -q origin "HEAD:main" \
      && git push -q origin --delete "$branch" && merged="$(git rev-parse --short HEAD) on main"
  fi
fi

if [ -n "$merged" ]; then
  gh workflow run scrape.yml --ref main || true
  { echo "Auto-fixed and merged ($merged). Every gate passed:"; printf '%s\n' "${gates[@]}"; echo; echo "A fresh scrape is running now. Close this issue once the site looks right."; echo; echo "Run: $run_url"; } > note.md
elif [ -n "$pr" ]; then
  { echo "Auto-fix opened $pr for review, because not every gate passed:"; printf '%s\n' "${gates[@]}"; } > note.md
else
  {
    echo "Auto-fix pushed \`$branch\` but couldn't open a pull request ($(head -1 pr-error.txt))."
    echo "Open it: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/compare/main...$branch?expand=1"; echo
    echo "To let the job open pull requests: Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests."; echo
    printf '%s\n' "${gates[@]}"
  } > note.md
fi
comment note.md
