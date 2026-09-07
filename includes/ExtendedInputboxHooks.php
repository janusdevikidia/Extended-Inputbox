<?php

use MediaWiki\MediaWikiServices;

class ExtendedInputboxHooks {

	/**
	 * Bloque immédiatement les clics sur TOUS les boutons submit InputBox dès
	 * le HTML initial (avant tout JS). C'est une sécurité "au cas où" : le
	 * hook onOutputPageBeforeHTML() lève ce blocage sélectivement pour les
	 * formulaires qui n'ont finalement pas de popup (voir plus bas), donc ce
	 * blocage global ne dure que le temps du calcul PHP (quasi instantané, il
	 * n'y a plus d'aller-retour réseau côté client).
	 */
	public static function onBeforePageDisplay( OutputPage $out, $skin ) {
		// Module léger (pas d'OOUI) : ne fait rien sur une page sans InputBox,
		// et ne sert de filet de sécurité que pour du contenu injecté
		// dynamiquement (voir ext.extendedInputbox.fallback.js).
		$out->addModules( 'ext.extendedInputbox.fallback' );

		$out->addInlineStyle(
			'.mw-inputbox-container input[type="submit"], .mw-inputbox-centered input[type="submit"], ' .
			'form.createbox input[type="submit"], form.createbox button[type="submit"] { pointer-events: none; opacity: 0.6; }'
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
			return;
		}

		$title = $out->getTitle();
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
			return null;
		}

		$rawWikitext = $content->getText();
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
		$nodes = $xpath->query(
			"//*[contains(concat(' ', normalize-space(@class), ' '), ' mw-inputbox-centered ')" .
			" or contains(concat(' ', normalize-space(@class), ' '), ' mw-inputbox-container ')" .
			" or (local-name()='form' and contains(concat(' ', normalize-space(@class), ' '), ' createbox '))]"
		);

		$cssRules = [];
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
				$btnClass = 'extended-inputbox-btn-' . $currentIndex;
				$cssRules[] = self::buildButtonCss( $btnClass, $config );
				foreach ( $btnNodes as $btn ) {
					self::addClass( $btn, $btnClass );
				}
			}

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
					self::addInlineStyleAttr( $btn, 'pointer-events:auto;opacity:1;' );
				}
			}

			if ( $hasErrors ) {
				self::appendErrorNode( $dom, $container, $config['errors'] );
			}
		}

		if ( $cssRules ) {
			$out->addInlineStyle( implode( ' ', $cssRules ) );
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
		$nodes = $xpath->query(
			".//input[@type='submit'] | .//button[@type='submit'] | " .
			".//*[contains(concat(' ', normalize-space(@class), ' '), ' mw-ui-button ')]",
			$form
		);
		return iterator_to_array( $nodes );
	}

	private static function addClass( DOMElement $el, $class ) {
		$existing = $el->getAttribute( 'class' );
		$el->setAttribute( 'class', trim( $existing . ' ' . $class ) );
	}

	private static function addInlineStyleAttr( DOMElement $el, $style ) {
		$existing = $el->getAttribute( 'style' );
		$el->setAttribute( 'style', rtrim( $existing, ';' ) . ( $existing ? ';' : '' ) . $style );
	}

	/**
	 * Miroir exact de applyButtonStyle() côté JS (docstring conservée pour
	 * mémoire du comportement voulu) :
	 * - button-bgcolor / button-bg          -> couleur de FOND
	 * - button-border-color / button-border -> couleur de la BORDURE
	 * - la couleur du texte n'est pas configurable : blanche dès qu'un fond est défini.
	 */
	private static function buildButtonCss( $btnClass, array $config ) {
		$bg = $config['buttonBgColor'] ?? '';
		$textColor = $bg ? '#ffffff' : '';
		$borderColor = $config['buttonBorderColor'] ?? 'transparent';

		$rules = [];
		if ( $bg ) {
			$rules[] = 'background: ' . $bg . ' !important';
		}
		if ( $textColor ) {
			$rules[] = 'color: ' . $textColor . ' !important';
		}
		$rules[] = 'border: 2px solid ' . $borderColor . ' !important';
		$rules[] = 'border-radius: 2px';
		$rules[] = 'font-weight: 600';
		$rules[] = 'box-shadow: none';
		$rules[] = 'text-shadow: none';

		$css = '.' . $btnClass . ' { ' . implode( '; ', $rules ) . '; }';
		if ( $textColor ) {
			$css .= ' .' . $btnClass . ' * { color: ' . $textColor . ' !important; }';
		}
		return $css;
	}

	private static function appendErrorNode( DOMDocument $dom, DOMElement $container, array $errors ) {
		$div = $dom->createElement( 'div', htmlspecialchars( implode( ' ', $errors ), ENT_QUOTES, 'UTF-8' ) );
		$div->setAttribute( 'class', 'extended-inputbox-error' );
		$div->setAttribute( 'style', 'color:#d33;font-weight:bold;margin-top:8px;font-size:0.9em;' );
		$container->parentNode->insertBefore( $div, $container->nextSibling );
	}
}