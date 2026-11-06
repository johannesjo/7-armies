#!/usr/bin/env bash
# Publishes a build into (or removes a directory from) the gh-pages branch.
#
#   publish-pages.sh deploy <dir> <src> <message>   # dir "" = site root (keeps branches/)
#   publish-pages.sh remove <dir> ""    <message>
#
# Several branches may deploy concurrently. Each run touches only its own
# directory, so on a rejected push we simply re-fetch and re-apply.
set -euo pipefail

mode=$1
dir=$2
src=${3:-}
message=$4
pages_branch=${PAGES_BRANCH:-gh-pages}

if [ -n "$src" ]; then src=$(realpath "$src"); fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git config --global user.name "github-actions[bot]"
git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"

remote=$(git remote get-url origin)
auth_header=$(git config --get-all http.https://github.com/.extraheader || true)

apply_changes() (
  cd "$work/site"
  if [ "$mode" = deploy ]; then
    if [ -z "$dir" ]; then
      # Site root: replace everything except branch previews and git metadata.
      find . -mindepth 1 -maxdepth 1 ! -name .git ! -name branches -exec rm -rf {} +
      cp -a "$src/." .
    else
      rm -rf "$dir"
      mkdir -p "$dir"
      cp -a "$src/." "$dir/"
    fi
  else
    [ -n "$dir" ] || { echo "refusing to remove site root" >&2; exit 1; }
    rm -rf "$dir"
  fi
  touch .nojekyll
  git add -A
)

for attempt in 1 2 3 4 5; do
  rm -rf "$work/site"
  status=0
  git -c http.extraheader="$auth_header" ls-remote --exit-code --heads "$remote" "$pages_branch" >/dev/null || status=$?
  if [ "$status" -eq 0 ]; then
    git -c http.extraheader="$auth_header" clone --quiet --depth 1 --branch "$pages_branch" "$remote" "$work/site"
  elif [ "$status" -ne 2 ]; then
    echo "Could not query $pages_branch on origin (exit $status)." >&2
    exit 1
  else
    git init --quiet "$work/site"
    git -C "$work/site" checkout --quiet --orphan "$pages_branch"
    git -C "$work/site" remote add origin "$remote"
  fi

  apply_changes

  if git -C "$work/site" diff --cached --quiet; then
    echo "Nothing to publish."
    exit 0
  fi

  git -C "$work/site" commit --quiet -m "$message"
  if git -C "$work/site" -c http.extraheader="$auth_header" push --quiet origin "HEAD:$pages_branch"; then
    echo "Published to $pages_branch${dir:+/$dir}."
    exit 0
  fi

  echo "Push rejected (attempt $attempt), retrying..." >&2
  sleep $((attempt * 3))
done

echo "Failed to publish after retries." >&2
exit 1
