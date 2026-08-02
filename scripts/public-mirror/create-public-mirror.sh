#!/usr/bin/env bash
#
# Build a public mirror of Omni's `main` branch with the personal email address
# rewritten out of every commit, full history preserved, and a GitHub Pages
# preview workflow in place of the two private-mirror workflows.
#
# Usage:
#   ./scripts/public-mirror/create-public-mirror.sh            # prepare only
#   ./scripts/public-mirror/create-public-mirror.sh --push     # prepare and push
#
# Without --push the script stops just before publishing so you can inspect the
# result. Pushing is the irreversible step: it makes the history public.

set -euo pipefail

SOURCE_REPO="https://github.com/I-R0N/Omni.git"
TARGET_OWNER="I-R0N"
TARGET_REPO="omnispace"
WORKDIR="${WORKDIR:-$HOME/omnispace-mirror}"

# The address to remove, and the identity that replaces it. The GitHub noreply
# address still attributes the commits to your account.
OLD_EMAIL="rhenegha@gmail.com"
NEW_NAME="Ryan H"
NEW_EMAIL="148007558+I-R0N@users.noreply.github.com"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_SRC="$SCRIPT_DIR/preview.yml"

DO_PUSH=false
[ "${1:-}" = "--push" ] && DO_PUSH=true

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31mError: %s\033[0m\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- preflight --
say "Checking prerequisites"

command -v git >/dev/null || die "git is not installed."
command -v git-filter-repo >/dev/null 2>&1 || git filter-repo --version >/dev/null 2>&1 \
  || die "git-filter-repo is not installed. Run: brew install git-filter-repo"
[ -f "$WORKFLOW_SRC" ] || die "Cannot find $WORKFLOW_SRC"

if [ -e "$WORKDIR" ]; then
  die "$WORKDIR already exists. Remove it or set WORKDIR=/some/other/path."
fi
echo "OK — working directory will be $WORKDIR"

# -------------------------------------------------------------------- clone --
say "Cloning main (history preserved, no other branches)"
git clone --single-branch --branch main "$SOURCE_REPO" "$WORKDIR"
cd "$WORKDIR"

BEFORE_COUNT=$(git rev-list --count main)
echo "Cloned $BEFORE_COUNT commits."

# ------------------------------------------------------------ rewrite email --
say "Rewriting $OLD_EMAIL out of author and committer fields"

MAILMAP="$(mktemp)"
printf '%s <%s> <%s>\n' "$NEW_NAME" "$NEW_EMAIL" "$OLD_EMAIL" > "$MAILMAP"

git filter-repo --mailmap "$MAILMAP" --force
rm -f "$MAILMAP"

AFTER_COUNT=$(git rev-list --count main)
[ "$BEFORE_COUNT" = "$AFTER_COUNT" ] \
  || die "Commit count changed ($BEFORE_COUNT -> $AFTER_COUNT). History was not preserved; aborting."
echo "History intact: $AFTER_COUNT commits."

say "Verifying the address is gone"
LEAKS=$(git log --all --format='%ae%n%ce%n%B' | grep -c "$OLD_EMAIL" || true)
[ "$LEAKS" -eq 0 ] || die "$OLD_EMAIL still appears $LEAKS time(s) in history."
echo "Clean. Remaining identities:"
git log --all --format='  %an <%ae>' | sort -u

# ----------------------------------------------------------------- workflow --
say "Replacing the private-mirror workflows with the Pages preview workflow"

# These two push to the private i-r0n/omni-standalone repo using a secret that
# will not exist in the public repo, so they would fail on the first run.
for stale in pr-preview.yml publish-standalone.yml; do
  if [ -f ".github/workflows/$stale" ]; then
    git rm -q ".github/workflows/$stale"
    echo "Removed .github/workflows/$stale"
  fi
done

mkdir -p .github/workflows
cp "$WORKFLOW_SRC" .github/workflows/preview.yml
git add .github/workflows/preview.yml

git -c user.name="$NEW_NAME" -c user.email="$NEW_EMAIL" commit -q -m "$(cat <<'MSG'
Publish playable builds to GitHub Pages

Replace the two workflows that mirrored the standalone build into a separate
private repository with a single workflow that publishes to this repository's
own gh-pages branch and posts the link.

  main    -> https://i-r0n.github.io/omnispace/
  PR #123 -> https://i-r0n.github.io/omnispace/pr-123/

This needs no repository secrets; the built-in GITHUB_TOKEN is sufficient.
MSG
)"
echo "Committed the workflow change."

# --------------------------------------------------------------------- push --
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/${TARGET_OWNER}/${TARGET_REPO}.git"

if [ "$DO_PUSH" = false ]; then
  say "Prepared — not pushed"
  cat <<EOF
Everything is staged in: $WORKDIR

Inspect it, then publish with:

  cd "$WORKDIR"
  git push -u origin main

Create https://github.com/${TARGET_OWNER}/${TARGET_REPO} first (public, no
README, no .gitignore, no license) if it does not exist yet.
EOF
  exit 0
fi

say "Pushing to https://github.com/${TARGET_OWNER}/${TARGET_REPO}"
for attempt in 1 2 3 4; do
  if git push -u origin main; then
    say "Done"
    cat <<EOF
Pushed to https://github.com/${TARGET_OWNER}/${TARGET_REPO}

One-time setup, after the first workflow run finishes and creates gh-pages:
  Settings -> Pages -> Source: "Deploy from a branch" -> gh-pages -> / (root)

The game will then be live at:
  https://i-r0n.github.io/${TARGET_REPO}/
EOF
    exit 0
  fi
  wait=$((2 ** attempt))
  echo "Push failed; retrying in ${wait}s..."
  sleep "$wait"
done
die "Push failed after 4 attempts."
