# Extended Inputbox — v2.0.0

## Ce qui a changé (v1.0.1 → v2.0.0)

L'ancienne version calculait tout **côté navigateur, après l'affichage de la page** :
1. La page s'affiche (boutons sans couleur, apparence par défaut).
2. Le JS fait 2 appels API (`query` + `expandtemplates`) pour relire le wikitexte.
3. Une fois la réponse reçue, les couleurs et les popups sont appliquées.

➡️ Résultat : un flash visuel (bouton qui change d'apparence après coup), et le module OOUI (lourd) était potentiellement chargé sur des pages qui n'en avaient pas besoin.

**La v2.0.0 fait ce calcul côté serveur, avant l'envoi de la page** :
1. Le serveur relit et parse le `<inputbox>` de la page pendant la génération du HTML.
2. Les couleurs, les identifiants de formulaire et les erreurs de config sont injectés **directement dans le HTML envoyé au navigateur**.
3. Le module OOUI n'est demandé au navigateur **que si la page contient réellement une popup** (`popup-title` ou `popup-field`).

| | v1.0.1 | v2.0.0 |
|---|---|---|
| Couleurs des boutons | calculées en JS, après coup (flash possible) | calculées en PHP, déjà dans le HTML initial |
| Détection des popups | en JS, via 2 appels API | en PHP, pendant le rendu de la page |
| Module OOUI | toujours chargé si un inputbox est présent | chargé uniquement si une popup est détectée |
| Fichiers | 1 seul module JS | 2 modules JS : un léger (toujours actif) + un OOUI (à la demande) |

Aucun paramètre wikitexte n'a changé : tout `<inputbox>...</inputbox>` existant continue de fonctionner à l'identique, sans rien à modifier sur le wiki.

---

## Nouveaux fichiers de l'extension

```
Extended-Inputbox/
├── extension.json
├── includes/
│   ├── ExtendedInputboxHooks.php      → logique serveur (calcul + injection HTML)
│   └── ExtendedInputboxConfig.php     → lecture des paramètres <inputbox>
├── Modules/
│   ├── ext.extendedInputbox.fallback.js   → toujours chargé, léger, sans OOUI
│   ├── ext.extendedInputbox.popup.js      → chargé uniquement si une popup existe
│   └── ext.extendedInputbox.css
└── i18n/
```

Le module `fallback.js` ne sert que de filet de sécurité pour du contenu généré dynamiquement après le chargement de la page (prévisualisation, VisualEditor) — sur un affichage normal, il ne fait rien puisque tout est déjà prêt côté serveur.

---

## Comment ça s'utilise sur le wiki

**Rien ne change dans la syntaxe.** Les paramètres `<inputbox>` restent exactement les mêmes qu'avant :

```
<inputbox>
type=create
preload=Modèle:Préchargement
popup-title=Créer une nouvelle page
popup-field=sujet|text|Sujet de la page
popup-field=categorie|select|Catégorie|Histoire,Géographie,Sciences
button-bgcolor=#3366cc
button-border-color=#1a3d7c
</inputbox>
```

| Paramètre | Rôle |
|---|---|
| `popup-title` | Ouvre une popup avec ce titre (sinon comportement InputBox normal) |
0| `popup-field=nom\|type\|label\|options\|show-if` | Ajoute un champ à la popup (`type` : `text`, `textarea`, `select`, `radio`, `checkbox`) |
| `popup-skip-edit=yes` | Publie directement la page sans passer par l'écran d'édition |
| `preload-params=a,b,c` | Ordre des variables `$1`, `$2`, `$3`... dans le modèle préchargé |
| `button-bgcolor=<couleur>` | Couleur de fond du bouton (hex, rgb, hsl ou nom CSS) |
| `button-border-color=<couleur>` | Couleur de bordure du bouton |

**À savoir avec la v2.0.0 :**
- Si tu ne mets **ni `popup-title` ni `popup-field`**, aucune popup ne s'ouvre et OOUI n'est jamais chargé sur cette page — le formulaire garde le comportement natif d'InputBox, juste avec la couleur appliquée si tu en as défini une.
- Si tu mets une couleur invalide (ex. `button-bgcolor=pasunecouleur`), un message d'erreur rouge s'affiche automatiquement sous le formulaire — la page reste utilisable normalement.
- Les couleurs et l'ouverture de popup sont désormais correctes **dès le premier affichage** de la page (plus de flash à recharger).

---

## Points à surveiller après mise à jour

- Teste d'abord sur une page de test avant de déployer sur tout le wiki (le nouveau code modifie directement le HTML généré, via `DOMDocument` — à vérifier avec vos modèles d'inputbox existants).
- Si une page utilise un `<inputbox>` **généré par un modèle imbriqué de façon inhabituelle**, vérifie que les couleurs/popups s'appliquent bien au bon formulaire (le matching se fait par ordre d'apparition dans la page).
- Purge le cache de la page (`?action=purge`) après la mise à jour si les changements ne sont pas visibles immédiatement.