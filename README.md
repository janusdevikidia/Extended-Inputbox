<<<<<<< HEAD
# Extended Inputbox (Extension MediaWiki)

**Extended Inputbox** est une extension pour MediaWiki qui améliore l'extension `InputBox`. Elle permet de créer des boîtes de dialogue (OOUI) et collecter des informations supplémentaires avant la création ou la modification d'une page.

---

##  Prérequis

* MediaWiki 1.39 ou supérieur
* Extension [InputBox](https://www.mediawiki.org/wiki/Extension:InputBox) installée et activée

---

## Installation

1. Téléchargez ou clonez ce dépôt dans le dossier `extensions/` de votre installation MediaWiki :
   ```bash
   cd extensions/
   git clone https://github.com/Janusdevikidia/Extended-Inputbox.git

>  [!NOTE]
> La documentation est disponible : [Aide:Extended-Inputbox](https://fr.vikidia.org/wiki/Aide:Extended-Inputbox) sur Vikidia
=======
# Extended Inputbox

Extension MediaWiki qui ajoute des formulaires en fenêtre modale aux balises
`<inputbox>` de l’extension [InputBox]. Elle permet notamment de recueillir
plusieurs valeurs avant de créer ou modifier une page, de précharger un modèle
et de personnaliser le bouton.

Compatible avec MediaWiki **1.39+** et avec l’extension **InputBox**.

## Installation

1. Installez et activez l’extension `InputBox`.
2. Placez ce dépôt dans `extensions/Extended-Inputbox`.
3. Ajoutez la ligne suivante dans `LocalSettings.php` :

```php
wfLoadExtension( 'Extended-Inputbox' );
```

4. Lancez la maintenance de MediaWiki si votre installation le demande, puis
purgez une page de test (`?action=purge`).

## Exemple minimal

Cet exemple ouvre un formulaire, demande le titre de la nouvelle page et crée
la page sous le préfixe `Brouillon:`. Le premier champ correspond à `$1` ;
`page=$1` est donc remplacé par sa valeur.

```wikitext
<inputbox>
type=create
prefix=Brouillon:
page=$1
buttonlabel=Créer un brouillon
popup-title=Créer un brouillon
popup-field=titre|text|Titre du brouillon|||||yes|Ex. : Histoire du quartier|80|3|Choisissez un titre court et explicite.
</inputbox>
```

La valeur des champs n’est pas interpolée par MediaWiki dans `page=` : utilisez
`$1`, `$2`, etc. ou définissez l’ordre avec `preload-params`.

## Exemple avec liste, condition et préchargement

Le modèle `Modèle:Préchargement fiche` peut employer `$1` et `$2`. Ici, ils
reçoivent respectivement `titre` et `categorie`, car cet ordre est déclaré
explicitement.

```wikitext
<inputbox>
type=create
page=$1
preload=Modèle:Préchargement fiche
preload-params=titre,categorie
buttonlabel=Créer la fiche
popup-title=Nouvelle fiche
popup-text=Renseignez les informations ci-dessous.
popup-field=titre|text|Titre|||||yes|Ex. : Le pont de pierre|120|3
popup-field=categorie|select|Catégorie|Histoire,Géographie,Sciences||||yes
popup-field=periode|text|Période| |show-if:categorie=Histoire|||non|Ex. : XIXe siècle
</inputbox>
```

Dans le dernier champ, `show-if:categorie=Histoire` le rend visible seulement
lorsque « Histoire » est sélectionné. `popup-text` est un texte d’introduction
et doit être associé à `popup-title` ou à au moins un `popup-field`.

## Exemple avec cases à cocher, contraintes et aide

```wikitext
<inputbox>
type=create
page=$1
buttonlabel=Signaler un problème
popup-title=Signaler un problème
popup-field=titre|text|Titre du signalement|||||yes|Ex. : Lien mort|100|5|Soyez concis.
popup-field=categories|checkbox|Catégories concernées|Contenu,Mise en forme,Source, |||;||non
popup-field=details|textarea|Détails|||||non||1000
</inputbox>
```

Ici, `categories` est une case à cocher multiple : les valeurs sélectionnées
sont jointes avec le séparateur `;` (7ᵉ segment de `popup-field`) au lieu du
`, ` par défaut. `titre` est obligatoire (`required=yes`), limité entre 5 et
100 caractères, et affiche un texte d’indication (`placeholder`) ainsi qu’une
bulle d’aide (`help`, dernier segment).

## Publication directe (sans écran d’édition)

Ajoutez `popup-skip-edit=yes` pour publier à la validation de la fenêtre. Il
est recommandé de fournir un `preload` : son contenu est récupéré, puis les
variables `$1`, `$2`, etc. y sont remplacées avant l’enregistrement.

```wikitext
<inputbox>
type=create
page=$1
preload=Modèle:Préchargement annonce
preload-params=titre,texte
popup-skip-edit=yes
buttonlabel=Publier l’annonce
popup-title=Nouvelle annonce
popup-field=titre|text|Titre|||||yes||100|5
popup-field=texte|textarea|Texte|||||yes||2000|20
</inputbox>
```

Sans `popup-skip-edit=yes`, l’utilisateur est redirigé vers l’éditeur
MediaWiki ; le préchargement et les paramètres restent alors disponibles via
le mécanisme standard d’InputBox.

## Paramètres ajoutés

Les paramètres standards d’InputBox (`type`, `page`, `prefix`, `preload`,
`buttonlabel`, `default`, `summary`, etc.) restent disponibles.

| Paramètre | Description |
| --- | --- |
| `popup-title` | Titre de la fenêtre modale. |
| `popup-text` | Texte affiché au début de la fenêtre. |
| `popup-field` | Ajoute un champ ; son format est détaillé ci-dessous. |
| `popup-skip-edit=yes` | Publie directement la page après validation de la fenêtre. Nécessite une popup. |
| `required-marker=(obligatoire)` | Remplace le marqueur visuel des champs requis pour cette popup. Laissez la valeur vide pour ne pas l’afficher ; le défaut est défini par la traduction du wiki. Alias : `popup-required-marker`. |
| `preload-params=a,b,c` | Associe `$1`, `$2`, `$3` aux champs nommés `a`, `b`, `c`. Alias : `popup-preload-params`, `preloadparams`. |
| `button-bgcolor` ou `button-bg` | Couleur CSS de fond du bouton. |
| `button-border-color` ou `button-border` | Couleur CSS de bordure du bouton. |

`popup-preload` est obsolète : utilisez le paramètre standard `preload`.

### Format de `popup-field`

```text
popup-field=nom|type|libellé|options|show-if|default|separator|required|placeholder|maxlength|minlength|help
```

Seuls `nom`, `type` et `libellé` sont obligatoires. Conservez les séparateurs
vides (`||`) pour atteindre un paramètre situé plus loin dans la liste.

| Position | Nom | Description |
| ---: | --- | --- |
| 1 | `nom` | Identifiant du champ ; sert dans `show-if` et `preload-params`. Évitez les doublons. |
| 2 | `type` | `text`, `textarea`, `select`, `radio`, `checkbox` ou `checkboxes`. |
| 3 | `libellé` | Libellé affiché dans le formulaire. |
| 4 | `options` | Liste séparée par des virgules pour `select`, `radio` et `checkbox`; valeur initiale pour `text` et `textarea`. |
| 5 | `show-if` | Condition de visibilité, sous la forme `show-if:champ=valeur`. `&` signifie ET, `,` signifie OU. |
| 6 | `default` | Valeur initiale ; prioritaire sur `options`. Pour une case multiple, séparez les valeurs par des virgules. |
| 7 | `separator` | Séparateur des choix cochés envoyés dans une variable ; `, ` par défaut. |
| 8 | `required` | `yes` rend le champ obligatoire. Toute autre valeur le laisse facultatif. |
| 9 | `placeholder` | Indication dans un champ `text` ou `textarea` vide. |
| 10 | `maxlength` | Longueur maximale pour `text` et `textarea`. |
| 11 | `minlength` | Longueur minimale pour `text` et `textarea`. |
| 12 | `help` | Aide affichée avec le champ. |

Les virgules séparent les options et les barres verticales séparent les
segments : une option ne peut donc pas contenir ces caractères tels quels.

## Couleurs de bouton

```wikitext
<inputbox>
type=create
buttonlabel=Créer une page
button-bgcolor=#3366cc
button-border-color=#1a3d7c
</inputbox>
```

Les formats usuels de couleur CSS sont acceptés (`#3366cc`, `rgb(...)`,
`hsl(...)` et les noms CSS). Une couleur invalide laisse le formulaire
utilisable et affiche une erreur sous celui-ci.

## Performances et fonctionnement

Les configurations sont analysées côté serveur pendant le rendu : les couleurs
et les attributs nécessaires à la popup sont donc déjà présents dans le HTML.
Le module OOUI, plus lourd, n’est chargé que lorsqu’au moins une popup est
réellement configurée. Aucun appel API client n’est fait pour une InputBox
présente dans le rendu initial.

Un petit module de secours reste chargé sur les pages contenant une InputBox :
il couvre les formulaires ajoutés dynamiquement (prévisualisation, gadget,
VisualEditor). Dans ce cas rare, il lit la configuration de la page via l’API.

## Tests

Les règles de parsing et de validation des couleurs sont couvertes par des
tests PHPUnit indépendants de MediaWiki. Depuis une installation disposant de
PHPUnit :

```sh
phpunit -c phpunit.xml.dist
```

Les tests de rendu HTML et d’intégration doivent être exécutés dans
l’environnement de test MediaWiki, car ils dépendent du parseur et de
`OutputPage`.

## Mots magiques dans `preload` et `default`

Les mots magiques `{{CURRENTYEAR}}`, `{{CURRENTTIME}}`, etc. sont toujours
exprimés en UTC, comme dans MediaWiki natif. Les variantes `{{LOCALYEAR}}`,
`{{LOCALTIME}}`, etc. reflètent le fuseau horaire configuré par
`$wgLocaltimezone` sur le wiki — pas le fuseau du navigateur de la personne
qui remplit le formulaire. Si `$wgLocaltimezone` n’est pas défini (valeur par
défaut UTC), `LOCAL*` et `CURRENT*` sont identiques.

## Mise à jour depuis la v1

La syntaxe existante est conservée. Après une mise à jour, purgez les pages qui
utilisent l’extension. Testez en particulier les InputBox générées par des
modèles, ainsi que les pages comportant plusieurs InputBox : la correspondance
est faite dans leur ordre d’apparition.

[InputBox]: https://www.mediawiki.org/wiki/Extension:InputBox
>>>>>>> dev
