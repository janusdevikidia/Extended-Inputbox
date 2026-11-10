#!/usr/bin/env bash
# Gerrit -> GitHub : quand Gerrit a mergé (+2/Submit), réaligne la branche GitHub
# sur Gerrit (historique identique), en conservant les fichiers GitHub-only (.github).
#
# Sécurité : une branche n'est touchée QUE si GitHub n'a aucun commit utile absent de Gerrit
# (sinon on attend que ces commits soient mergés). Push en --force-with-lease.
#
# Variables : GERRIT_SSH_URL, BRANCHES ("main dev REL1_43 REL1_47"), BRANCH_MAP, GITHUB_ONLY_PATHS,
#             PUSH_REMOTE (défaut origin), DRY_RUN=1
set -euo pipefail
: "${GERRIT_SSH_URL:?GERRIT_SSH_URL manquant}"
BRANCHES="${BRANCHES:-main dev REL1_43 REL1_47}"
BRANCH_MAP="${BRANCH_MAP:-main:master}"
GITHUB_ONLY_PATHS="${GITHUB_ONLY_PATHS-.github}"
PUSH_REMOTE="${PUSH_REMOTE:-origin}"
DRY_RUN="${DRY_RUN:-0}"

EXCL=(); for p in $GITHUB_ONLY_PATHS; do EXCL+=(":(exclude)$p"); done
PATHSPEC=(-- .); [ ${#EXCL[@]} -gt 0 ] && PATHSPEC=(-- . "${EXCL[@]}")

git remote remove gerrit 2>/dev/null || true
git remote add gerrit "$GERRIT_SSH_URL"
git fetch -q "$PUSH_REMOTE" "+refs/heads/*:refs/remotes/$PUSH_REMOTE/*"
FAIL=0
for B in $BRANCHES; do
  T="$B"; for pair in $BRANCH_MAP; do [ "${pair%%:*}" = "$B" ] && T="${pair#*:}"; done
  echo "== $B (Gerrit: $T)"
  git rev-parse -q --verify "refs/remotes/$PUSH_REMOTE/$B" >/dev/null || { echo "  absente sur GitHub, ignorée"; continue; }
  git fetch -q gerrit "+refs/heads/$T:refs/remotes/gerrit/$T" || { echo "  absente sur Gerrit, ignorée"; continue; }
  GH="refs/remotes/$PUSH_REMOTE/$B"; GE="refs/remotes/gerrit/$T"
  OLD="$(git rev-parse "$GH")"

  PENDING="$(git rev-list --no-merges --cherry-pick --right-only "$GE...$GH" "${PATHSPEC[@]}")"
  if [ -n "$PENDING" ]; then
    echo "  $(echo "$PENDING" | wc -l) commit(s) GitHub pas encore dans Gerrit : branche laissée telle quelle."; continue
  fi
  if git diff --quiet "$GE" "$GH" "${PATHSPEC[@]}" && git merge-base --is-ancestor "$GE" "$GH"; then
    echo "  déjà aligné."; continue
  fi

  # Nouveau sommet = arbre Gerrit + dossiers GitHub-only repris du sommet GitHub actuel
  IDX="$(mktemp -u)"; export GIT_INDEX_FILE="$IDX"
  git read-tree "$GE"
  for p in $GITHUB_ONLY_PATHS; do
    git rm -rq --cached --ignore-unmatch -- "$p"
    if git cat-file -e "$GH:$p" 2>/dev/null; then
      if [ "$(git cat-file -t "$GH:$p")" = tree ]; then git read-tree --prefix="$p/" "$GH:$p"
      else git update-index --add --cacheinfo "$(git ls-tree "$GH" -- "$p" | awk '{print $1","$3","$4}')"; fi
    fi
  done
  TREE="$(git write-tree)"; unset GIT_INDEX_FILE; rm -f "$IDX"
  if [ "$TREE" = "$(git rev-parse "$GE^{tree}")" ]; then NEW="$(git rev-parse "$GE")"
  else
    NEW="$(GIT_AUTHOR_NAME="github-sync" GIT_AUTHOR_EMAIL="github-sync@users.noreply.github.com" \
           GIT_COMMITTER_NAME="github-sync" GIT_COMMITTER_EMAIL="github-sync@users.noreply.github.com" \
           git commit-tree "$TREE" -p "$GE" -m "chore(github): fichiers GitHub uniquement ($GITHUB_ONLY_PATHS)")"
  fi
  echo "  $OLD -> $NEW"
  if [ "$DRY_RUN" = "1" ]; then echo "  DRY_RUN : pas de push"; continue; fi
  git push "$PUSH_REMOTE" --force-with-lease="refs/heads/$B:$OLD" "$NEW:refs/heads/$B" || { echo "::warning::push refusé pour $B (protection de branche ? token sans droit 'workflows' ?)"; FAIL=1; }
done
exit $FAIL
