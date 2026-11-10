#!/usr/bin/env bash
# GitHub -> Gerrit : envoie sur refs/for/<branche> les commits GitHub pas encore dans Gerrit.
#
# Variables :
#   GERRIT_SSH_URL      (obligatoire) ex. ssh://user@gerrit.wikimedia.org:29418/mediawiki/extensions/Xxx
#   BRANCH              (obligatoire) branche GitHub (main, dev, REL1_43…)
#   SOURCE_REF          défaut HEAD : sommet à envoyer
#   BRANCH_MAP          défaut "main:master" : correspondances GitHub:Gerrit (séparées par des espaces)
#   GITHUB_ONLY_PATHS   défaut ".github" : chemins qui ne vont JAMAIS dans Gerrit (espaces)
#   MAX_COMMITS         défaut 20 : garde-fou
#   GERRIT_COMMITTER_NAME / GERRIT_COMMITTER_EMAIL : committer imposé (ex. compte Gerrit). Sinon = auteur.
#   DRY_RUN=1           ne pousse pas
set -euo pipefail

: "${GERRIT_SSH_URL:?GERRIT_SSH_URL manquant}"
: "${BRANCH:?BRANCH manquant}"
SOURCE_REF="${SOURCE_REF:-HEAD}"
BRANCH_MAP="${BRANCH_MAP:-main:master}"
GITHUB_ONLY_PATHS="${GITHUB_ONLY_PATHS-.github}"
MAX_COMMITS="${MAX_COMMITS:-20}"
DRY_RUN="${DRY_RUN:-0}"

TARGET="$BRANCH"
for pair in $BRANCH_MAP; do
  [ "${pair%%:*}" = "$BRANCH" ] && TARGET="${pair#*:}"
done

EXCL=()
for p in $GITHUB_ONLY_PATHS; do EXCL+=(":(exclude)$p"); done
PATHSPEC=(-- .)
[ ${#EXCL[@]} -gt 0 ] && PATHSPEC=(-- . "${EXCL[@]}")

git remote remove gerrit 2>/dev/null || true
git remote add gerrit "$GERRIT_SSH_URL"
git fetch -q gerrit "+refs/heads/$TARGET:refs/remotes/gerrit/$TARGET"

SOURCE_SHA="$(git rev-parse "$SOURCE_REF")"

# Commits GitHub absents de Gerrit (comparaison par contenu, pas par SHA) ;
# les commits qui ne touchent que des fichiers GitHub-only sont ignorés.
COMMITS="$(git rev-list --reverse --no-merges --cherry-pick --right-only \
  "gerrit/$TARGET...$SOURCE_SHA" "${PATHSPEC[@]}")"

if [ -z "$COMMITS" ]; then
  echo "Rien à envoyer : Gerrit contient déjà tout le contenu de $BRANCH."
  exit 0
fi

COUNT="$(printf '%s\n' "$COMMITS" | wc -l)"
echo "$COUNT commit(s) candidat(s) vers refs/for/$TARGET :"
for c in $COMMITS; do git log -1 --format='  %h %s' "$c"; done

if [ "$COUNT" -gt "$MAX_COMMITS" ]; then
  echo "::error::$COUNT commits à envoyer (> $MAX_COMMITS). Vérifie la divergence GitHub/Gerrit (lance .github/gerrit/realign-branches.sh ?)."
  exit 1
fi

git checkout -q -B gerrit-sync "gerrit/$TARGET"
APPLIED=0

for c in $COMMITS; do
  if ! git rev-parse -q --verify "$c^" >/dev/null; then
    echo "Commit racine $c ignoré."; continue
  fi
  if [ -n "${GERRIT_COMMITTER_EMAIL:-}" ]; then
    export GIT_COMMITTER_NAME="${GERRIT_COMMITTER_NAME:-$(git log -1 --format='%an' "$c")}"
    export GIT_COMMITTER_EMAIL="$GERRIT_COMMITTER_EMAIL"
  else
    export GIT_COMMITTER_NAME="$(git log -1 --format='%an' "$c")"
    export GIT_COMMITTER_EMAIL="$(git log -1 --format='%ae' "$c")"
  fi

  # On applique le diff du commit SANS les fichiers GitHub-only
  # (évite aussi les conflits modify/delete sur .github absent côté Gerrit).
  if ! git diff --binary "$c^" "$c" "${PATHSPEC[@]}" | git apply --index --3way --whitespace=nowarn 2>/tmp/apply.err; then
    cat /tmp/apply.err || true
    echo "::error::Conflit en appliquant $c sur gerrit/$TARGET."
    git status --short; git reset -q --hard
    exit 1
  fi
  if git diff --cached --quiet; then
    echo "Commit $c vide sur Gerrit (déjà présent ou fichiers GitHub-only) : ignoré."
    continue
  fi
  git -c commit.gpgsign=false commit -q --no-verify -C "$c"

  # Change-Id déterministe (dérivé du SHA GitHub + branche) : un re-run met à jour
  # le même change au lieu d'en créer un doublon. Seul le DERNIER paragraphe compte.
  if ! git log -1 --format=%B | awk -v RS= 'END{print}' | grep -Eq '^Change-Id: I[0-9a-f]{40}$'; then
    CHANGE_ID="I$(printf 'github-%s-%s' "$c" "$TARGET" | sha1sum | cut -c1-40)"
    {
      git log -1 --format=%B | grep -v '^Change-Id: ' | sed -e :a -e '/^[[:space:]]*$/{$d;N;ba' -e '}'
      printf '\n\nChange-Id: %s\n' "$CHANGE_ID"

    } | git -c commit.gpgsign=false commit --amend -q --no-verify -F -
  fi
  APPLIED=$((APPLIED+1))
done

if [ "$APPLIED" -eq 0 ] || [ "$(git rev-parse HEAD)" = "$(git rev-parse "gerrit/$TARGET")" ]; then
  echo "Aucun nouveau commit utile, rien à pousser."; exit 0
fi

if [ "$DRY_RUN" = "1" ]; then echo "DRY_RUN : push non exécuté."; git log --oneline "gerrit/$TARGET..HEAD"; exit 0; fi

echo "Push vers Gerrit (refs/for/$TARGET)..."
set +e
OUTPUT="$(git push ${GIT_PUSH_EXTRA:-} gerrit "HEAD:refs/for/$TARGET" 2>&1)"; STATUS=$?
set -e
echo "$OUTPUT"
if [ $STATUS -ne 0 ]; then
  if echo "$OUTPUT" | grep -qi 'no new changes'; then echo "Gerrit a déjà ces changements : OK."; exit 0; fi
  exit $STATUS
fi
