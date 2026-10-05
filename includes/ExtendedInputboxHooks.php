<?php

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
				'html.client-js form[data-eib-index] input[type="submit"], html.client-js form[data-eib-index] button[type="submit"] { pointer-events: none; }'
			);
		}
	}

	public static function onOutputPageBeforeHTML(OutputPage $out, &$text)
	{
		if (strpos($text, 'mw-inputbox') === false && strpos($text, 'createbox') === false) {
			return;
		}

		$title = $out->getTitle();
		if (!$title || !$title->exists() || $title->getContentModel() !== CONTENT_MODEL_WIKITEXT) {
			return;
		}

		// Le wikitexte sert à apparier les configs au DOM : il doit être celui de
		// la révision AFFICHÉE. Pas de traitement pour les aperçus, anciennes
		// révisions et diffs (le fallback JS s'en charge ou s'abstient).
		if (!$out->isArticle() || $out->getRequest()->getCheck('diff')) {
			return;
		}
		$shownRev = $out->getRevisionId();
		if ($shownRev && (int) $shownRev !== (int) $title->getLatestRevID()) {
			return;
		}

		$blocks = self::getInputboxBlocks($out, $title);
		if (!$blocks) {
			return;
		}

		$allConfigs = ExtendedInputboxConfig::parseBlocks($blocks);
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
	 * Retourne le contenu brut des <inputbox> effectivement rendus, modèles
	 * développés (donc aussi ceux produits par des modèles, même si la page
	 * contient déjà un <inputbox> littéral). Le résultat, léger, est mis en
	 * cache (WAN cache) par révision + page_touched : l'expansion complète
	 * n'est donc plus refaite à chaque vue, et le cache est invalidé quand un
	 * modèle transcludé change (page_touched).
	 *
	 * @return string[]
	 */
	private static function getInputboxBlocks(OutputPage $out, Title $title)
	{
		$services = MediaWikiServices::getInstance();
		$wikiPage = $services->getWikiPageFactory()->newFromTitle($title);
		$cache = $services->getMainWANObjectCache();
		$key = $cache->makeKey(
			'extendedinputbox-blocks',
			$title->getArticleID(),
			$wikiPage->getLatest(),
			$wikiPage->getTouched()
		);

		return $cache->getWithSetCallback($key, $cache::TTL_DAY, static function () use ($services, $wikiPage, $title) {
			$content = $wikiPage->getContent();
			if (!$content instanceof WikitextContent) {
				return [];
			}
			$raw = $content->getText();
			if (stripos($raw, '<inputbox') === false && strpos($raw, '{{') === false) {
				return [];
			}
			$parser = $services->getParserFactory()->create();
			$expanded = $parser->preprocess($raw, $title, ParserOptions::newFromAnon());
			return ExtendedInputboxConfig::extractRawBlocks($expanded);
		});
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
		// Un <inputbox> = exactement UN <form>. On apparie donc par formulaire :
		// l'ancien sélecteur (div.mw-inputbox-centered OU form.createbox) comptait
		// deux nœuds pour un type=create (div + form) et zéro pour search2, ce qui
		// décalait l'index et donnait la mauvaise config (ou aucune) aux inputbox
		// suivants de la page, par ex. un commenttitle placé après un create.
		$nodes = $xpath->query(
			"//form[" .
			"contains(concat(' ', normalize-space(@class), ' '), ' createbox ')" .
			" or contains(concat(' ', normalize-space(@class), ' '), ' commentbox ')" .
			" or contains(concat(' ', normalize-space(@class), ' '), ' mw-movebox ')" .
			" or contains(concat(' ', normalize-space(@class), ' '), ' searchbox ')" .
			" or contains(concat(' ', normalize-space(@class), ' '), ' bodySearch ')" .
			"]"
		);
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
						$containerModified = self::forceChildTextColor($btn, ExtendedInputboxConfig::getContrastTextColor($config['buttonBgColor']) ?: '#ffffff') || $containerModified;
					}
				}
			}

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
				$containerModified = self::appendErrorNode($dom, self::findOuterContainer($xpath, $container), $config['errors']) || $containerModified;
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

	/** Conteneur visuel (div centré) d'un formulaire InputBox, ou le formulaire lui-même. */
	private static function findOuterContainer(DOMXPath $xpath, DOMElement $form)
	{
		$c = $xpath->query("ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' mw-inputbox-centered ')][1]", $form);
		return $c instanceof DOMNodeList && $c->length ? $c->item(0) : $form;
	}

	private static function findDescendantForm(DOMXPath $xpath, DOMElement $container)
	{
		$forms = $xpath->query('.//form', $container);
		return $forms instanceof DOMNodeList && $forms->length ? $forms->item(0) : null;
	}

	private static function findSubmitButtons(DOMXPath $xpath, DOMElement $form)
	{
		$nodes = $xpath->query(
			".//input[@type='submit'] | .//button[@type='submit'] | " .
			".//*[contains(concat(' ', normalize-space(@class), ' '), ' mw-ui-button ')]",
			$form
		);
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
		$bg = $config['buttonBgColor'] ?? '';
		$textColor = $bg ? ( ExtendedInputboxConfig::getContrastTextColor($bg) ?: '' ) : '';
		$borderColor = $config['buttonBorderColor'] ?? 'transparent';

		$rules = [];
		if ($bg) {
			$rules[] = 'background:' . $bg . ' !important';
		}
		if ($textColor) {
			$rules[] = 'color:' . $textColor . ' !important';
		}
		$rules[] = 'border:2px solid ' . $borderColor . ' !important';
		$rules[] = 'border-radius:2px';
		$rules[] = 'font-weight:600';
		$rules[] = 'box-shadow:none';
		$rules[] = 'text-shadow:none';

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
		$div = $dom->createElement('div');
		$div->appendChild($dom->createTextNode(implode(' ', $errors)));
		$div->setAttribute('class', 'extended-inputbox-error');
		$container->parentNode->insertBefore($div, $container->nextSibling);
		return true;
	}
}
