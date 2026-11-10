#!/usr/bin/env bash
# Réaligne des branches sur une branche de base (par défaut REL1_43) en linéarisant l'historique :
#  - les commits de fusion sont ARCHIVÉS (tag archive/<branche>-<date> sur l'ancien sommet + bundle), jamais supprimés ;
#  - les commits propres à chaque branche sont rejoués (rebase) au-dessus de la base, sans merge ;
#  - les commits déjà présents dans la base (même patch) disparaissent naturellement.
#
# Usage : realign-branches.sh [--apply] [--push] [--accept-tree-diff] [--base REL1_43] [--remote origin] [branches…]
#   (sans --apply : simulation seule, rien n'est modifié)
#   branches par défaut : dev main REL1_47
# Résultat local : branches realigned/<branche> ; --push les envoie en force-with-lease sur <remote>/<branche>.
set -euo pipefail
APPLY=0; PUSH=0; ACCEPT=0; BASE=REL1_43; REMOTE=origin; BR=()
while [ $# -gt 0 ]; do case "$1" in
  --apply) APPLY=1;; --push) PUSH=1; APPLY=1;; --accept-tree-diff) ACCEPT=1;;
  --base) BASE="$2"; shift;; --remote) REMOTE="$2"; shift;;
  -h|--help) sed -n 2,12p "$0"; exit 0;; *) BR+=("$1");; esac; shift; done
[ ${#BR[@]} -eq 0 ] && BR=(dev main REL1_47)
DATE="$(date +%Y%m%d)"

[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Working tree non propre : commit/stash d'abord."; exit 1; }
git fetch -q "$REMOTE" "+refs/heads/*:refs/remotes/$REMOTE/*"
BASE_REF="refs/remotes/$REMOTE/$BASE"
git rev-parse -q --verify "$BASE_REF" >/dev/null || { echo "Base $REMOTE/$BASE introuvable."; exit 1; }

if [ $APPLY -eq 1 ]; then
  BUNDLE="../archive-$(basename "$PWD")-$DATE.bundle"
  git bundle create "$BUNDLE" --all >/dev/null 2>&1 && echo "Sauvegarde complète : $BUNDLE"
fi

SUMMARY=()
for B in "${BR[@]}"; do
  [ "$B" = "$BASE" ] && continue
  REF="refs/remotes/$REMOTE/$B"
  git rev-parse -q --verify "$REF" >/dev/null || { echo "== $B : absente, ignorée"; continue; }
  OLD="$(git rev-parse "$REF")"
  MERGES="$(git rev-list --merges "$BASE_REF..$REF" | wc -l)"
  UNIQ="$(git rev-list --no-merges --cherry-pick --right-only "$BASE_REF...$REF" | wc -l)"
  echo "== $B : $UNIQ commit(s) propre(s) à rejouer, $MERGES fusion(s) à archiver"
  if [ $APPLY -eq 0 ]; then SUMMARY+=("$B: simulation ($UNIQ commits, $MERGES fusions)"); continue; fi

  TAG="archive/$B-$DATE"
  git tag -f "$TAG" "$OLD" >/dev/null; echo "   archivé : tag $TAG -> ${OLD:0:9}"

  WT="../.realign-wt-$$"; git worktree add -q --detach "$WT" "$REF"
    if ! ( cd "$WT" && git -c core.editor=true rebase -q --onto "$BASE_REF" "$BASE_REF" ) >/tmp/rebase.log 2>&1; then
    echo "   CONFLIT pendant le rebase de $B :"; tail -5 /tmp/rebase.log
    ( cd "$WT" && git rebase --abort ) 2>/dev/null || true
    git worktree remove --force "$WT"
    SUMMARY+=("$B: CONFLIT -> à faire à la main (voir A-FAIRE.md §2)"); continue
  fi
  NEW="$(cd "$WT" && git rev-parse HEAD)"; git worktree remove --force "$WT"
  git branch -f "realigned/$B" "$NEW" >/dev/null
  if git diff --quiet "$OLD" "$NEW"; then echo "   contenu identique à l'ancien sommet : OK"
  else
    echo "   ATTENTION : le contenu diffère de l'ancien sommet (fusions avec résolution de conflit, etc.) :"
    git diff --stat "$OLD" "$NEW" | tail -8
    [ $ACCEPT -eq 1 ] || { SUMMARY+=("$B: realigned/$B créée, contenu différent -> relis puis relance avec --accept-tree-diff --push"); continue; }
  fi
  if [ $PUSH -eq 1 ]; then
    git push "$REMOTE" --force-with-lease="refs/heads/$B:$OLD" "realigned/$B:refs/heads/$B" && git push -q "$REMOTE" "$TAG"
    SUMMARY+=("$B: réaligné et poussé (archive: $TAG)")
  else SUMMARY+=("$B: realigned/$B prête (archive: $TAG), pas poussée"); fi
done
echo; echo "Résumé :"; printf '  - %s\n' "${SUMMARY[@]}"
