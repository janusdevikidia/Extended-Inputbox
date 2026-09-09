<?php

use MediaWiki\MediaWikiServices;

class ExtendedInputboxHooks {
<<<<<<< HEAD
    public static function onBeforePageDisplay( OutputPage $out, $skin ) {
        $out->addModules( 'ext.extendedInputbox' );
        
        // Bloque les clics sur tous les formulaires InputBox dès le chargement HTML
        $out->addInlineStyle( '.mw-inputbox-container input[type="submit"], .mw-inputbox-centered input[type="submit"], form.createbox input[type="submit"], form.createbox button[type="submit"] { pointer-events: none; opacity: 0.6; }' );
    }
}
use MediaWiki\MediaWikiServices;

class ExtendedInputboxHooks
{

	/**
	 * Compromis assumé : si un <inputbox> n'apparaît que via du contenu injecté
	 * dynamiquement APRÈS le rendu initial de la page (gadget, prévisualisation,
	 * etc.) et absent du HTML initial, le module fallback ne sera pas chargé et
	 * ce formulaire ne sera pas traité. C'est le prix de l'optimisation demandée
	 * ("aucun inputbox → aucun JS") ; le cas normal (InputBox posé dans le
	 * wikitexte de la page) reste couvert à 100%.
	 */
	public static function onBeforePageDisplay(OutputPage $out, $skin)
	{
		// Ne rien charger du tout sur les pages sans InputBox : à ce stade,
		// OutputPageBeforeHTML a déjà transformé $out (mBodytext), donc getHTML()
		// reflète le HTML final. Évite d'envoyer le module fallback (et son coût
		// JS/CSS) sur l'immense majorité des pages qui n'ont aucun <inputbox>.
		$html = $out->getHTML();
		if (!is_string($html) || (strpos($html, 'mw-inputbox') === false && strpos($html, 'createbox') === false)) {
			return;
		}

		$out->addModules('ext.extendedInputbox.fallback');

		if (strpos($html, 'data-eib-index') !== false) {
			// Seuls les formulaires popup déjà préparés côté serveur doivent
			// attendre le binding JavaScript. Les InputBox natifs restent utilisables
			// sans réécriture DOM ni style inline supplémentaire.
			$out->addInlineStyle(
				'form[data-eib-index] input[type="submit"], form[data-eib-index] button[type="submit"] { pointer-events: none; }'
			);
		}
	}

	public static function onOutputPageBeforeHTML(OutputPage $out, &$text)
	{
		if (strpos($text, 'mw-inputbox') === false && strpos($text, 'createbox') === false) {
=======

	/**
	 * Bloque immédiatement les clics sur TOUS les boutons submit InputBox dès
	 * le HTML initial (avant tout JS). C'est une sécurité "au cas où" : le
	 * hook onOutputPageBeforeHTML() lève ce blocage sélectivement pour les
	 * formulaires qui n'ont finalement pas de popup (voir plus bas), donc ce
	 * blocage global ne dure que le temps du calcul PHP (quasi instantané, il
	 * n'y a plus d'aller-retour réseau côté client).
	 *
	 * Important : on ne bloque QUE les clics (pointer-events), jamais
	 * l'apparence (pas d'opacity). Les couleurs de bouton sont déjà correctes
	 * dans le HTML initial (voir bakeIntoHtml()) ; si on baissait l'opacité
	 * ici, le bouton apparaîtrait délavé/grisé le temps que le module popup
	 * se charge, puis "flasherait" vers sa vraie couleur une fois le blocage
	 * levé en JS — ce qui est exactement l'effet visuel à éviter.
	 */
	public static function onBeforePageDisplay( OutputPage $out, $skin ) {
		// Module léger (pas d'OOUI) : ne fait rien sur une page sans InputBox,
		// et ne sert de filet de sécurité que pour du contenu injecté
		// dynamiquement (voir ext.extendedInputbox.fallback.js).
		$out->addModules( 'ext.extendedInputbox.fallback' );

		$out->addInlineStyle(
			'.mw-inputbox-container input[type="submit"], .mw-inputbox-centered input[type="submit"], ' .
			'form.createbox input[type="submit"], form.createbox button[type="submit"] { pointer-events: none; }'
		);
	}

	/**
	 * Cœur du nouveau fonctionnement : calcule les configs <inputbox>
	 * (couleurs, popups, erreurs) côté SERVEUR, et modifie directement le
	 * HTML final de la page avant qu'il ne soit envoyé au navigateur.
	 *
	 * Conséquences :
	 *  - les couleurs de bouton sont correctes dès le tout premier rendu
	 *    (plus aucun flash, plus d'appel API côté client pour ça) ;
	 *  - le module ext.extendedInputbox.popup (qui dépend d'OOUI, donc lourd)
	 *    n'est chargé QUE si cette page contient réellement au moins une
	 *    popup à afficher.
	 *
	 * Limite connue : ce hook ne s'applique qu'au HTML de la page telle que
	 * rendue par le serveur. Un contenu injecté dynamiquement après coup
	 * (prévisualisation live, VisualEditor, etc.) n'est pas concerné et
	 * retombe sur ext.extendedInputbox.fallback.js (voir ce fichier).
	 */
	public static function onOutputPageBeforeHTML( OutputPage $out, &$text ) {
		// Sortie rapide et bon marché : si la page ne contient aucun HTML
		// d'InputBox, inutile d'aller chercher/parser le wikitexte.
		if ( strpos( $text, 'mw-inputbox' ) === false && strpos( $text, 'createbox' ) === false ) {
>>>>>>> origin/main
			return;
		}

		$title = $out->getTitle();
<<<<<<< HEAD
		if (!$title || !$title->exists() || $title->getContentModel() !== CONTENT_MODEL_WIKITEXT) {
			return;
		}

		$wikitext = self::getExpandedWikitext($out, $title);
		if (!$wikitext) {
			return;
		}

		$allConfigs = ExtendedInputboxConfig::extractConfigs($wikitext);
		if (!$allConfigs) {
			return;
		}

		if (!self::configsRequireDomProcessing($allConfigs) || self::bakeIntoHtml($out, $text, $allConfigs)) {
			// Le fallback conserve son rôle pour le contenu ajouté dynamiquement,
			// mais ne refait pas deux appels API pour le contenu déjà traité ici.
			$out->addJsConfigVars('extendedInputboxServerProcessed', true);
		}
	}

	/**
	 * $parser->preprocess() (expansion de TOUS les modèles de la page) est
	 * l'opération la plus coûteuse de ce hook, exécutée à chaque affichage de
	 * page (pas de cache dédié ici). Comme le cas le plus fréquent est un
	 * <inputbox> écrit directement dans le wikitexte de la page (sans modèle),
	 * on évite cette expansion quand elle n'apporte rien : si le wikitexte brut
	 * contient déjà littéralement un <inputbox>, il n'y a aucun besoin de
	 * développer les modèles pour le trouver. On ne paie le coût du
	 * preprocess() que pour le cas "imbriqué indirectement dans un modèle".
	 *
	 * @return string|null
	 */
	private static function getExpandedWikitext(OutputPage $out, Title $title)
	{
		$services = MediaWikiServices::getInstance();
		$wikiPage = $services->getWikiPageFactory()->newFromTitle($title);
		$content = $wikiPage->getContent();

		if (!$content instanceof WikitextContent) {
=======
		if ( !$title || !$title->exists() || $title->getContentModel() !== CONTENT_MODEL_WIKITEXT ) {
			return;
		}

		$wikitext = self::getExpandedWikitext( $out, $title );
		if ( $wikitext === null ) {
			return;
		}

		$allConfigs = ExtendedInputboxConfig::extractConfigs( $wikitext );
		if ( !$allConfigs ) {
			return;
		}

		$extendedConfigs = array_values( array_filter(
			$allConfigs,
			[ ExtendedInputboxConfig::class, 'isExtended' ]
		) );
		if ( !$extendedConfigs ) {
			return;
		}

		self::bakeIntoHtml( $out, $text, $allConfigs, $extendedConfigs );
	}

	/**
	 * Équivalent serveur de l'ancien appel API action=expandtemplates fait
	 * côté client : développe les modèles du wikitexte SANS exécuter les
	 * tag-hooks, donc <inputbox>...</inputbox> reste intact et exploitable.
	 *
	 * @return string|null
	 */
	private static function getExpandedWikitext( OutputPage $out, Title $title ) {
		$services = MediaWikiServices::getInstance();
		$wikiPage = $services->getWikiPageFactory()->newFromTitle( $title );
		$content = $wikiPage->getContent();

		if ( !$content instanceof WikitextContent ) {
>>>>>>> origin/main
			return null;
		}

		$rawWikitext = $content->getText();
<<<<<<< HEAD

		if (stripos($rawWikitext, '<inputbox>') !== false) {
			return $rawWikitext;
		}

		$parser = $services->getParserFactory()->create();
		$options = ParserOptions::newFromContext($out->getContext());

		return $parser->preprocess($rawWikitext, $title, $options);
	}

	private static function bakeIntoHtml(OutputPage $out, &$text, array $allConfigs)
	{
		$parsedHtml = self::parseHtmlForDomManipulation($text);
		if (
			!is_array($parsedHtml) ||
			!isset($parsedHtml['dom'], $parsedHtml['xpath'], $parsedHtml['wrapper']) ||
			!($parsedHtml['dom'] instanceof DOMDocument) ||
			!($parsedHtml['xpath'] instanceof DOMXPath) ||
			!($parsedHtml['wrapper'] instanceof DOMElement)
		) {
			return false;
		}

		$dom = $parsedHtml['dom'];
		$xpath = $parsedHtml['xpath'];
		$wrapper = $parsedHtml['wrapper'];
=======
		$parser = $services->getParserFactory()->create();
		$options = ParserOptions::newFromContext( $out->getContext() );

		return $parser->preprocess( $rawWikitext, $title, $options );
	}

	/**
	 * Modifie $text (HTML final de la page, par référence) pour y injecter :
	 *  - les classes CSS de couleur sur les boutons concernés ;
	 *  - un identifiant + attribut data-eib-index sur les formulaires à popup,
	 *    pour que le JS popup les retrouve sans refaire de calcul ;
	 *  - les messages d'erreur de config le cas échéant.
	 *
	 * Puis, si au moins une popup a été détectée, charge le module OOUI et
	 * transmet les configs correspondantes via mw.config.
	 */
	private static function bakeIntoHtml( OutputPage $out, &$text, array $allConfigs, array $extendedConfigs ) {
		$dom = new DOMDocument();
		libxml_use_internal_errors( true );
		$dom->loadHTML(
			'<?xml encoding="utf-8" ?><div id="ei-root">' . $text . '</div>',
			LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
		);
		libxml_clear_errors();

		$xpath = new DOMXPath( $dom );
>>>>>>> origin/main
		$nodes = $xpath->query(
			"//*[contains(concat(' ', normalize-space(@class), ' '), ' mw-inputbox-centered ')" .
			" or contains(concat(' ', normalize-space(@class), ' '), ' mw-inputbox-container ')" .
			" or (local-name()='form' and contains(concat(' ', normalize-space(@class), ' '), ' createbox '))]"
		);
<<<<<<< HEAD
		if (!($nodes instanceof DOMNodeList) || !$nodes->length) {
			return false;
		}

		$popupConfigsForJs = [];
		$hasPopups = false;
		$domModified = false;

		$index = 0;
		foreach ($nodes as $container) {
			// Ne propager ce marqueur qu'après une mutation effective. La présence
			// d'un conteneur, d'un formulaire ou de boutons n'implique pas à elle
			// seule une réécriture du HTML.
			$containerModified = false;

			// Correspondance exacte 1:1 entre le n-ième conteneur DOM et le n-ième <inputbox> du wikitexte
			$config = $allConfigs[$index] ?? null;
			$currentIndex = $index;
			$index++;

			if (!$config) {
				continue;
			}

			$isPopup = ExtendedInputboxConfig::needsPopup($config);
			$hasColor = ExtendedInputboxConfig::needsColor($config);
			$hasErrors = !empty($config['errors']);

			$form = $container->localName === 'form' ? $container : self::findDescendantForm($xpath, $container);
			$btnNodes = $form ? self::findSubmitButtons($xpath, $form) : [];

			if ($hasColor) {
				$inlineStyle = self::buildButtonInlineStyle($config);
				foreach ($btnNodes as $btn) {
					$containerModified = self::addInlineStyleAttr($btn, $inlineStyle) || $containerModified;
					if (!empty($config['buttonBgColor'])) {
						$containerModified = self::forceChildTextColor($btn, '#ffffff') || $containerModified;
=======

		$popupConfigsForJs = [];
		$hasPopups = false;
		$hasColors = false;

		$index = 0;
		foreach ( $nodes as $container ) {
			// Matching par position : le n-ième conteneur InputBox du HTML
			// correspond au n-ième <inputbox> du wikitexte. C'est la même
			// hypothèse de repli que l'ancien code JS (findMatchingConfig).
			$config = $extendedConfigs[ $index ] ?? $allConfigs[ $index ] ?? null;
			$currentIndex = $index;
			$index++;

			if ( !$config ) {
				continue;
			}

			$isPopup = ExtendedInputboxConfig::needsPopup( $config );
			$hasColor = ExtendedInputboxConfig::needsColor( $config );
			$hasErrors = !empty( $config['errors'] );

			if ( !$isPopup && !$hasColor && !$hasErrors ) {
				continue;
			}

			$form = $container->localName === 'form' ? $container : self::findDescendantForm( $xpath, $container );
			$btnNodes = $form ? self::findSubmitButtons( $xpath, $form ) : [];

			if ( $hasColor ) {
				$hasColors = true;
				// Style posé directement en attribut sur le bouton (et non via
				// une classe + un <style> séparé) : la couleur fait ainsi
				// partie du même HTML que le bouton, sans dépendre de l'ordre
				// de chargement d'une autre feuille de style dans le <head>.
				// C'est ce qui élimine le flash "gris avant la vraie couleur".
				$inlineStyle = self::buildButtonInlineStyle( $config );
				foreach ( $btnNodes as $btn ) {
					self::addInlineStyleAttr( $btn, $inlineStyle );
					if ( !empty( $config['buttonBgColor'] ) ) {
						self::forceChildTextColor( $btn, '#ffffff' );
>>>>>>> origin/main
					}
				}
			}

<<<<<<< HEAD
			if ($isPopup && $form) {
				$hasPopups = true;
				if (!$form->getAttribute('id')) {
					$form->setAttribute('id', 'ei-popup-' . $currentIndex);
					$containerModified = true;
				}
				if ($form->getAttribute('data-eib-index') !== (string) $currentIndex) {
					$form->setAttribute('data-eib-index', (string) $currentIndex);
					$containerModified = true;
				}
				$popupConfigsForJs[$currentIndex] = $config;
			} else {
				// Formulaire normal (pas de popup) : on réactive le clic sur les boutons
				foreach ($btnNodes as $btn) {
					$containerModified = self::addInlineStyleAttr($btn, 'pointer-events:auto;') || $containerModified;
				}
			}

			if ($hasErrors) {
				$containerModified = self::appendErrorNode($dom, $container, $config['errors']) || $containerModified;
			}

			$domModified = $containerModified || $domModified;
		}

		if ($hasPopups) {
			$out->addModules('ext.extendedInputbox.popup');
			$out->addJsConfigVars('extendedInputboxConfigs', $popupConfigsForJs);
			// Permet à popup.js de distinguer LOCAL* (heure du wiki) de
			// CURRENT* (toujours UTC) sans dépendre du fuseau du navigateur
			// du visiteur, qui n'a aucun rapport avec $wgLocaltimezone.
			$out->addJsConfigVars('extendedInputboxLocalTZOffset', self::getLocalTimezoneOffsetMinutes());
		}

		if (!$domModified) {
			return true;
		}

		$serializedHtml = self::serializeRootChildren($dom, $wrapper, $text);
		if ($serializedHtml === $text) {
			return false;
		}

		$text = $serializedHtml;
		return true;
	}

	/**
	 * Décalage en minutes entre le fuseau horaire configuré pour le wiki
	 * ($wgLocaltimezone) et UTC, à l'instant présent (donc DST déjà pris en
	 * compte). Transmis au JS pour que LOCAL* (heure du wiki) diffère
	 * réellement de CURRENT* (toujours UTC), au lieu d'être mappés sur la
	 * même valeur comme auparavant. Si $wgLocaltimezone est UTC (valeur par
	 * défaut de MediaWiki), le décalage vaut 0 et LOCAL* == CURRENT*, ce qui
	 * reproduit fidèlement le comportement natif de MediaWiki.
	 *
	 * @return int
	 */
	private static function getLocalTimezoneOffsetMinutes()
	{
		global $wgLocaltimezone;

		$tzName = $wgLocaltimezone ?: 'UTC';

		try {
			$tz = new DateTimeZone($tzName);
			$now = new DateTime('now', $tz);
			return (int) ($tz->getOffset($now) / 60);
		} catch (Exception $e) {
			// Nom de fuseau invalide/inattendu : on retombe sur UTC (offset 0)
			// plutôt que de casser l'affichage de la popup.
			return 0;
		}
	}

	/**
	 * Indique si une configuration nécessite réellement une mutation du HTML.
	 * Les InputBox natifs n'ont plus besoin d'être parcourus par DOMDocument.
	 */
	private static function configsRequireDomProcessing(array $allConfigs)
	{
		foreach ($allConfigs as $config) {
			if (
				ExtendedInputboxConfig::needsPopup($config) ||
				ExtendedInputboxConfig::needsColor($config) ||
				!empty($config['errors'])
			) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Prépare le DOM de travail sans jamais modifier le HTML fourni.
	 *
	 * @param mixed $originalHtml
	 * @return array{dom: DOMDocument, xpath: DOMXPath, wrapper: DOMElement}|mixed
	 */
	private static function parseHtmlForDomManipulation($originalHtml)
	{
		if (!is_string($originalHtml)) {
			return $originalHtml;
		}

		$dom = new DOMDocument();
		$previousUseErrors = libxml_use_internal_errors(true);
		libxml_clear_errors();

		try {
			$options = LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD;
			if (defined('LIBXML_NONET')) {
				$options |= LIBXML_NONET;
			}

			$loaded = $dom->loadHTML(
				'<?xml encoding="utf-8" ?><div id="ei-root">' . $originalHtml . '</div>',
				$options
			);
			if (!$loaded) {
				return $originalHtml;
			}

			$wrapper = $dom->getElementById('ei-root');
			if (!($wrapper instanceof DOMElement)) {
				return $originalHtml;
			}

			return [
				'dom' => $dom,
				'xpath' => new DOMXPath($dom),
				'wrapper' => $wrapper,
			];
		} catch (Throwable $e) {
			return $originalHtml;
		} finally {
			// Ne pas laisser les erreurs du parseur ni son état global fuiter.
			libxml_clear_errors();
			libxml_use_internal_errors($previousUseErrors);
		}
	}

	/**
	 * Sérialise les enfants de la racine de travail. En cas d'échec, retourne
	 * exactement le HTML d'origine afin que l'appelant puisse l'ignorer.
	 */
	private static function serializeRootChildren(DOMDocument $dom, DOMElement $wrapper, $originalHtml)
	{
		$html = '';
		foreach ($wrapper->childNodes as $child) {
			$serializedChild = $dom->saveHTML($child);
			if ($serializedChild === false) {
				return $originalHtml;
			}
			$html .= $serializedChild;
		}

		return $html;
	}

	private static function findDescendantForm(DOMXPath $xpath, DOMElement $container)
	{
		$forms = $xpath->query('.//form', $container);
		return $forms instanceof DOMNodeList && $forms->length ? $forms->item(0) : null;
	}

	private static function findSubmitButtons(DOMXPath $xpath, DOMElement $form)
	{
=======
			if ( $isPopup && $form ) {
				$hasPopups = true;
				if ( !$form->getAttribute( 'id' ) ) {
					$form->setAttribute( 'id', 'ei-popup-' . $currentIndex );
				}
				$form->setAttribute( 'data-eib-index', (string)$currentIndex );
				// Le blocage global posé par onBeforePageDisplay() reste actif
				// pour ce bouton jusqu'à ce que le module popup prenne le relais.
				$popupConfigsForJs[ $currentIndex ] = $config;
			} else {
				// Pas de popup pour ce formulaire : on lève explicitement le
				// blocage global de clic posé par onBeforePageDisplay(), pour
				// que le bouton fonctionne normalement sans dépendre du JS.
				foreach ( $btnNodes as $btn ) {
					self::addInlineStyleAttr( $btn, 'pointer-events:auto;' );
				}
			}

			if ( $hasErrors ) {
				self::appendErrorNode( $dom, $container, $config['errors'] );
			}
		}

		if ( $hasPopups ) {
			// OOUI n'est demandé QUE si cette page a effectivement une popup.
			$out->addModules( 'ext.extendedInputbox.popup' );
			$out->addJsConfigVars( 'extendedInputboxConfigs', $popupConfigsForJs );
		}

		if ( !$hasColors && !$hasPopups ) {
			return;
		}

		$wrapper = $dom->getElementById( 'ei-root' );
		$html = '';
		foreach ( $wrapper->childNodes as $child ) {
			$html .= $dom->saveHTML( $child );
		}
		$text = $html;
	}

	private static function findDescendantForm( DOMXPath $xpath, DOMElement $container ) {
		$forms = $xpath->query( './/form', $container );
		return $forms->length ? $forms->item( 0 ) : null;
	}

	private static function findSubmitButtons( DOMXPath $xpath, DOMElement $form ) {
>>>>>>> origin/main
		$nodes = $xpath->query(
			".//input[@type='submit'] | .//button[@type='submit'] | " .
			".//*[contains(concat(' ', normalize-space(@class), ' '), ' mw-ui-button ')]",
			$form
		);
<<<<<<< HEAD
		return $nodes instanceof DOMNodeList ? iterator_to_array($nodes) : [];
	}

	private static function addInlineStyleAttr(DOMElement $el, $style)
	{
		$existing = $el->getAttribute('style');
		$updated = rtrim($existing, ';') . ($existing ? ';' : '') . $style;
		if ($updated === $existing) {
			return false;
		}
		$el->setAttribute('style', $updated);
		return true;
	}

	private static function buildButtonInlineStyle(array $config)
	{
=======
		return iterator_to_array( $nodes );
	}

	private static function addInlineStyleAttr( DOMElement $el, $style ) {
		$existing = $el->getAttribute( 'style' );
		$el->setAttribute( 'style', rtrim( $existing, ';' ) . ( $existing ? ';' : '' ) . $style );
	}

	/**
	 * Même comportement voulu que l'ancien buildButtonCss()/applyButtonStyle()
	 * JS :
	 * - button-bgcolor / button-bg          -> couleur de FOND
	 * - button-border-color / button-border -> couleur de la BORDURE
	 * - la couleur du texte n'est pas configurable : blanche dès qu'un fond est défini.
	 *
	 * Différence : ceci renvoie un style CSS destiné à être posé directement
	 * en attribut `style` sur le bouton (voir addInlineStyleAttr), et non une
	 * règle de classe à ajouter dans un <style> séparé. Poser la couleur dans
	 * le même HTML que le bouton évite toute dépendance à l'ordre de
	 * chargement d'une autre feuille de style dans le <head>.
	 */
	private static function buildButtonInlineStyle( array $config ) {
>>>>>>> origin/main
		$bg = $config['buttonBgColor'] ?? '';
		$textColor = $bg ? '#ffffff' : '';
		$borderColor = $config['buttonBorderColor'] ?? 'transparent';

		$rules = [];
<<<<<<< HEAD
		if ($bg) {
			$rules[] = 'background:' . $bg . ' !important';
		}
		if ($textColor) {
=======
		if ( $bg ) {
			$rules[] = 'background:' . $bg . ' !important';
		}
		if ( $textColor ) {
>>>>>>> origin/main
			$rules[] = 'color:' . $textColor . ' !important';
		}
		$rules[] = 'border:2px solid ' . $borderColor . ' !important';
		$rules[] = 'border-radius:2px';
		$rules[] = 'font-weight:600';
		$rules[] = 'box-shadow:none';
		$rules[] = 'text-shadow:none';

<<<<<<< HEAD
		return implode(';', $rules) . ';';
	}

	private static function forceChildTextColor(DOMElement $btn, $color)
	{
		$modified = false;
		foreach ($btn->childNodes as $child) {
			if ($child instanceof DOMElement) {
				$modified = self::addInlineStyleAttr($child, 'color:' . $color . ' !important;') || $modified;
				$modified = self::forceChildTextColor($child, $color) || $modified;
			}
		}
		return $modified;
	}

	private static function appendErrorNode(DOMDocument $dom, DOMElement $container, array $errors)
	{
		if (!$container->parentNode) {
			return false;
		}
		$div = $dom->createElement('div', htmlspecialchars(implode(' ', $errors), ENT_QUOTES, 'UTF-8'));
		$div->setAttribute('class', 'extended-inputbox-error');
		$container->parentNode->insertBefore($div, $container->nextSibling);
		return true;
	}
}
=======
		return implode( ';', $rules ) . ';';
	}

	/**
	 * Force la couleur du texte sur les descendants du bouton (icônes, spans
	 * internes) qui pourraient avoir leur propre style et ne pas hériter de
	 * la couleur posée sur le bouton lui-même.
	 */
	private static function forceChildTextColor( DOMElement $btn, $color ) {
		foreach ( $btn->childNodes as $child ) {
			if ( $child instanceof DOMElement ) {
				self::addInlineStyleAttr( $child, 'color:' . $color . ' !important;' );
				self::forceChildTextColor( $child, $color );
			}
		}
	}

	private static function appendErrorNode( DOMDocument $dom, DOMElement $container, array $errors ) {
		$div = $dom->createElement( 'div', htmlspecialchars( implode( ' ', $errors ), ENT_QUOTES, 'UTF-8' ) );
		$div->setAttribute( 'class', 'extended-inputbox-error' );
		$div->setAttribute( 'style', 'color:#d33;font-weight:bold;margin-top:8px;font-size:0.9em;' );
		$container->parentNode->insertBefore( $div, $container->nextSibling );
	}
}
>>>>>>> origin/main
