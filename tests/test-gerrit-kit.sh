#!/usr/bin/env bash
# Test local des scripts avec de faux dépôts (GitHub = bare "origin", Gerrit = bare "gerrit"). Aucun réseau.
set -euo pipefail
K="$(cd "$(dirname "$0")/../.github/gerrit" && pwd)"
T="$(mktemp -d)"; cd "$T"
export GIT_AUTHOR_NAME=Alice GIT_AUTHOR_EMAIL=alice@ex.org GIT_COMMITTER_NAME=Alice GIT_COMMITTER_EMAIL=alice@ex.org
git init -q --bare origin.git; git init -q --bare gerrit.git
git init -q -b REL1_43 w; cd w; git remote add origin ../origin.git
ok(){ echo "  OK  $*"; }; ko(){ echo "  FAIL $*"; exit 1; }
c(){ echo "$2" > "$1"; git add -A; git commit -q -m "$3"; }
c a.txt 1 c1; c a.txt 2 c2
git branch main; git branch dev
git checkout -q main; c b.txt 3 c3; mkdir -p .github/workflows; echo w > .github/workflows/x.yml; git add -A; git commit -q -m "ci: workflows"
git checkout -q dev; c d.txt 1 d1; git checkout -q REL1_43; c a.txt 3 "c3-rel"; git checkout -q dev; git merge -q --no-edit REL1_43; c d.txt 2 d2
git checkout -q REL1_43; git push -q origin --all
# Gerrit : master = main sans .github ; REL1_43 identique
git checkout -q main; git rm -rq .github; git commit -q -m "tmp"; git push -q ../gerrit.git main:master; git reset -q --hard HEAD~1
git push -q ../gerrit.git REL1_43:REL1_43
export GERRIT_SSH_URL="$T/gerrit.git"

echo "[1] sync main -> refs/for/master"
git checkout -q main; echo 4 > b.txt; echo y >> .github/workflows/x.yml; git add -A; git commit -q -m "feat: c4"; git push -q origin main
BRANCH=main bash "$K/gerrit-sync.sh" >/dev/null
git --git-dir="$T/gerrit.git" ls-tree -r --name-only refs/for/master | grep -q '^\.github' && ko ".github envoyé" || ok ".github exclu"
git --git-dir="$T/gerrit.git" log -1 --format=%B refs/for/master | grep -Eq '^Change-Id: I[0-9a-f]{40}$' && ok "Change-Id présent" || ko "Change-Id"
CID1="$(git --git-dir="$T/gerrit.git" log -1 --format=%B refs/for/master | grep Change-Id)"
echo "[2] re-run idempotent"
GIT_PUSH_EXTRA=--force BRANCH=main bash "$K/gerrit-sync.sh" | tee /tmp/o2 >/dev/null
CID2="$(git --git-dir="$T/gerrit.git" log -1 --format=%B refs/for/master | grep Change-Id)"; [ "$CID1" = "$CID2" ] && ok "même Change-Id" || ko "Change-Id changé"
echo "[3] +2/Submit simulé (SHA différent) puis sync = rien"
git --git-dir="$T/gerrit.git" update-ref refs/heads/master refs/for/master
GIT_COMMITTER_DATE="2030-01-01T00:00:00" git --git-dir="$T/gerrit.git" commit-tree -p refs/heads/master~1 -m "$(git --git-dir=$T/gerrit.git log -1 --format=%B refs/for/master)" $(git --git-dir="$T/gerrit.git" rev-parse 'refs/for/master^{tree}') > /tmp/newsha
git --git-dir="$T/gerrit.git" update-ref refs/heads/master "$(cat /tmp/newsha)"; git --git-dir="$T/gerrit.git" update-ref -d refs/for/master
BRANCH=main bash "$K/gerrit-sync.sh" | grep -q "Rien à envoyer" && ok "rien à envoyer" || ko "doublon"
echo "[4] miroir retour"
BRANCHES="main" bash "$K/gerrit-mirror-back.sh" | tail -3
git fetch -q origin; [ "$(git rev-parse origin/main^)" = "$(git --git-dir=$T/gerrit.git rev-parse master)" ] && ok "GitHub main = Gerrit master + overlay" || ko "mirror"
git show origin/main:.github/workflows/x.yml >/dev/null && ok ".github conservé"
BRANCHES="main" bash "$K/gerrit-mirror-back.sh" | grep -q "déjà aligné" && ok "idempotent" || ko "pas idempotent"
echo "[5] realign dev sur REL1_43"
git checkout -q main; git reset -q --hard origin/main
bash "$K/realign-branches.sh" dev | tail -3
bash "$K/realign-branches.sh" --apply --accept-tree-diff dev | tail -4
[ "$(git rev-list --merges realigned/dev | wc -l)" = 0 ] && ok "plus de merge" || ko "merge restant"
git merge-base --is-ancestor origin/REL1_43 realigned/dev && ok "dev repose sur REL1_43" || ko "base"
git rev-parse -q --verify archive/dev-$(date +%Y%m%d) >/dev/null && ok "ancien dev archivé (tag)" || ko "archive"
git diff --quiet origin/dev realigned/dev && ok "contenu identique" || echo "  note: contenu différent (attendu si fusion avec changements)"
echo "TOUS LES TESTS PASSENT"
