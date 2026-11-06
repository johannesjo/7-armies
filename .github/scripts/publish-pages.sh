#!/usr/bin/env bash
# Manages the gh-pages branch that serves the default branch at the site root
# and every other branch under branches/<slug>/.
#
#   publish-pages.sh path   <branch>        # site-relative dir ("" for the default branch)
#   publish-pages.sh deploy <branch> <src>  # publish build output <src> for <branch>
#   publish-pages.sh remove <branch>        # delete the preview of <branch>
#
# Env: DEFAULT_BRANCH (default: main), PAGES_BRANCH (default: gh-pages).
#
# gh-pages is kept as a single orphan commit so the branch does not grow with
# every deploy. Concurrent runs are safe: each push uses --force-with-lease
# against the commit it started from and retries on rejection.
set -euo pipefail
export LC_ALL=C

default_branch=${DEFAULT_BRANCH:-main}
pages_branch=${PAGES_BRANCH:-gh-pages}
max_attempts=12

export GIT_AUTHOR_NAME="github-actions[bot]"
export GIT_AUTHOR_EMAIL="41898282+github-actions[bot]@users.noreply.github.com"
export GIT_COMMITTER_NAME=$GIT_AUTHOR_NAME
export GIT_COMMITTER_EMAIL=$GIT_AUTHOR_EMAIL

# Lowercase, non-alphanumerics collapsed to "-", max 60 chars. When that loses
# information (feature/x vs feature-x, Foo vs foo, non-ASCII names), a short hash
# of the raw name is appended so different branches never share a directory and
# the slug is never empty.
slug() {
  local raw=$1 clean
  clean=$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-60)
  clean=${clean%-}
  if [ "$clean" != "$raw" ]; then
    clean="${clean:+$clean-}$(printf '%s' "$raw" | sha1sum | cut -c1-7)"
  fi
  printf '%s\n' "$clean"
}

site_path() {
  if [ "$1" = "$default_branch" ]; then
    printf '\n'
  else
    printf 'branches/%s\n' "$(slug "$1")"
  fi
}

cmd=${1:?usage: publish-pages.sh path|deploy|remove <branch> [src]}
branch=${2:?missing branch name}

if [ "$cmd" = path ]; then
  site_path "$branch"
  exit 0
fi

case $cmd in
  deploy) src=$(realpath "${3:?missing build dir}") ;;
  remove) [ "$branch" != "$default_branch" ] || { echo "refusing to remove the default branch site" >&2; exit 1; } ;;
  *) echo "unknown command: $cmd" >&2; exit 1 ;;
esac

dir=$(site_path "$branch")
if [ -n "$dir" ] && ! [[ $dir =~ ^branches/[a-z0-9][a-z0-9-]*$ ]]; then
  echo "refusing unsafe target dir '$dir'" >&2
  exit 1
fi

remote=$(git remote get-url origin)
auth_header=$(git config --get-all http.https://github.com/.extraheader || true)
git_remote() { git -c http.extraheader="$auth_header" "$@"; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
site=$work/site

# Writes the desired tree into $site's index. Runs in a subshell. Every step
# checks its own status: `set -e` does not apply when called as `f || ...`.
apply_changes() (
  cd "$site" || exit 1
  if [ "$cmd" = remove ]; then
    rm -rf "$dir" || exit 1
  elif [ -z "$dir" ]; then
    # Site root: replace everything except previews and a custom-domain CNAME.
    find . -mindepth 1 -maxdepth 1 ! -name .git ! -name branches ! -name CNAME -exec rm -rf {} + || exit 1
    cp -a "$src/." . || exit 1
    # Prune previews whose branch no longer exists (e.g. deleted while no
    # cleanup ran). Branches are listed fresh on every attempt.
    if [ -d branches ]; then
      git_remote ls-remote --exit-code --heads origin > "$work/heads" || exit 1
      sed 's#.*refs/heads/##' "$work/heads" | while IFS= read -r b; do slug "$b"; done > "$work/live" || exit 1
      [ -s "$work/live" ] || exit 1
      for d in branches/*/; do
        [ -d "$d" ] || continue
        name=$(basename "$d")
        if ! grep -qxF "$name" "$work/live"; then
          echo "Pruning stale preview $d"
          rm -rf "$d" || exit 1
        fi
      done
    fi
  else
    rm -rf "$dir" && mkdir -p "$dir" && cp -a "$src/." "$dir/" || exit 1
  fi
  touch .nojekyll && git add -A || exit 1
)

# One publish attempt. Returns 0 on success, 1 on a (retryable) failure.
attempt() {
  local status=0 base="" tree commit
  rm -rf "$site"
  git_remote ls-remote --exit-code --heads "$remote" "$pages_branch" > "$work/head" || status=$?
  if [ "$status" -eq 0 ]; then
    base=$(cut -f1 "$work/head")
    git_remote clone --quiet --depth 1 --branch "$pages_branch" "$remote" "$site" || return 1
  elif [ "$status" -eq 2 ]; then
    if [ "$cmd" = remove ]; then echo "No $pages_branch branch, nothing to remove."; exit 0; fi
    git init --quiet "$site" && git -C "$site" remote add origin "$remote" || return 1
  else
    echo "Could not query $pages_branch (exit $status)." >&2
    return 1
  fi

  apply_changes || return 1

  tree=$(git -C "$site" write-tree) || return 1
  if [ -n "$base" ] && [ "$tree" = "$(git -C "$site" rev-parse "$base^{tree}")" ]; then
    echo "Nothing to publish."
    exit 0
  fi

  commit=$(git -C "$site" commit-tree "$tree" -m "$cmd $branch${dir:+ -> $dir}") || return 1
  git -C "$site" -c http.extraheader="$auth_header" push --quiet \
    --force-with-lease="refs/heads/$pages_branch:$base" origin "$commit:refs/heads/$pages_branch" || return 1
  echo "Published $pages_branch${dir:+/$dir} ($cmd)."
}

for ((i = 1; i <= max_attempts; i++)); do
  attempt && exit 0
  if ((i < max_attempts)); then
    delay=$((i + RANDOM % 8))
    echo "Attempt $i failed, retrying in ${delay}s..." >&2
    sleep "$delay"
  fi
done

echo "Failed to publish after $max_attempts attempts." >&2
exit 1
