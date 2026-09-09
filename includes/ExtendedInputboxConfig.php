<?php

/**
 * Portage PHP du parsing de configuration <inputbox> (auparavant fait en JS,
 * côté client, après coup). Le faire ici permet de calculer couleurs et
 * popups AVANT l'envoi du HTML au navigateur (voir ExtendedInputboxHooks).
 *
 * Toute évolution du format de config (nouveaux paramètres popup-xxx,
 * button-xxx, etc.) doit être répercutée à la fois ici ET dans la logique
 * cliente restante (Modules/ext.extendedInputbox.popup.js et .fallback.js),
 * qui doivent rester capables de comprendre exactement les mêmes clés.
 */
class ExtendedInputboxConfig {

	/**
	 * Liste de référence des noms de couleurs CSS acceptés lors du rendu serveur.
	 * Le fallback navigateur délègue cette même vérification à CSS.supports(),
	 * afin de ne pas embarquer et maintenir une seconde copie de cette liste.
	 */
	private static $CSS_COLOR_KEYWORDS = [
		'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
		'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
		'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
		'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
		'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
		'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
		'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
		'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'grey', 'green',
		'greenyellow', 'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
		'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan',
		'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
		'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue',
		'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine',
		'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue',
		'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream',
		'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
		'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred',
		'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple',
		'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen',
		'seashell', 'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow',
		'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet',
		'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen',
	];

	private const RE_NUMBER = '/^\d{1,3}(?:\.\d+)?$/';
	private const RE_PERCENT = '/^\d{1,3}(?:\.\d+)?%$/';

	private static function isValidAlpha( $val ) {
		return ( preg_match( self::RE_NUMBER, $val ) && (float)$val <= 1 ) ||
			( preg_match( self::RE_PERCENT, $val ) && (float)$val <= 100 );
	}

	/**
	 * rgb()/rgba() : les 3 composantes doivent être toutes en nombres (0-255)
	 * OU toutes en pourcentages (0-100%), sans mélange (comme en CSS legacy) ;
	 * l'alpha optionnelle est un nombre 0-1 ou un pourcentage 0-100%.
	 */
	private static function isValidRgbArgs( $argsStr ) {
		$parts = array_map( 'trim', explode( ',', $argsStr ) );
		if ( count( $parts ) !== 3 && count( $parts ) !== 4 ) {
			return false;
		}

		$rgb = array_slice( $parts, 0, 3 );
		$allNumber = true;
		$allPercent = true;
		foreach ( $rgb as $p ) {
			if ( !( preg_match( self::RE_NUMBER, $p ) && (float)$p <= 255 ) ) {
				$allNumber = false;
			}
			if ( !( preg_match( self::RE_PERCENT, $p ) && (float)$p <= 100 ) ) {
				$allPercent = false;
			}
		}

		if ( !$allNumber && !$allPercent ) {
			return false;
		}
		if ( count( $parts ) === 4 && !self::isValidAlpha( $parts[3] ) ) {
			return false;
		}

		return true;
	}

	/**
	 * hsl()/hsla() : teinte en nombre (degrés implicites), saturation et
	 * luminosité obligatoirement en pourcentages 0-100% ; alpha optionnelle
	 * comme pour rgb().
	 */
	private static function isValidHslArgs( $argsStr ) {
		$parts = array_map( 'trim', explode( ',', $argsStr ) );
		if ( count( $parts ) !== 3 && count( $parts ) !== 4 ) {
			return false;
		}

		if ( !preg_match( '/^-?\d{1,3}(?:\.\d+)?(?:deg)?$/', $parts[0] ) ) {
			return false;
		}
		if ( !preg_match( self::RE_PERCENT, $parts[1] ) || (float)$parts[1] > 100 ) {
			return false;
		}
		if ( !preg_match( self::RE_PERCENT, $parts[2] ) || (float)$parts[2] > 100 ) {
			return false;
		}
		if ( count( $parts ) === 4 && !self::isValidAlpha( $parts[3] ) ) {
			return false;
		}

		return true;
	}

	/**
	 * Valide une valeur de couleur CSS pour le rendu serveur (hex, rgb(a),
	 * hsl(a) ou nom de couleur). Le fallback dynamique utilise CSS.supports()
	 * pour s'aligner sur le moteur CSS du navigateur sans dupliquer cette liste.
	 *
	 * @param string|null $val
	 * @return bool
	 */
	public static function isValidCssColor( $val ) {
		if ( $val === null || $val === '' ) {
			return false;
		}
		$val = trim( $val );

		// Hex : seules les longueurs 3, 4, 6 et 8 sont des couleurs CSS
		// valides (5 et 7 ne le sont pas), contrairement à l'ancienne regex
		// {3,8} qui les acceptait toutes.
		if ( preg_match( '/^#[0-9a-fA-F]+$/', $val ) ) {
			$hexLen = strlen( $val ) - 1;
			return $hexLen === 3 || $hexLen === 4 || $hexLen === 6 || $hexLen === 8;
		}

		if ( preg_match( '/^rgba?\(([^)]*)\)$/i', $val, $m ) ) {
			return self::isValidRgbArgs( $m[1] );
		}

		if ( preg_match( '/^hsla?\(([^)]*)\)$/i', $val, $m ) ) {
			return self::isValidHslArgs( $m[1] );
		}

		$lower = strtolower( $val );
		if ( $lower === 'transparent' || $lower === 'currentcolor' ) {
			return true;
		}

		// Nom de couleur : contrairement à l'ancienne regex /^[a-zA-Z]{3,20}$/
		// qui acceptait n'importe quel mot ("foobar" compris), on vérifie
		// désormais l'appartenance à la liste réelle des noms CSS valides.
		return in_array( $lower, self::$CSS_COLOR_KEYWORDS, true );
	}

	/**
	 * Retire du wikitexte tout ce qui n'est PAS réellement interprété comme
	 * un tag <inputbox> par le parseur : contenu de <nowiki>...</nowiki> et
	 * <pre>...</pre> (rendus tels quels, en texte, jamais comme un vrai
	 * <inputbox>), et commentaires HTML <!-- ... --> (jamais rendus du tout).
	 *
	 * Sans ceci, un <inputbox> cité en exemple dans une page de documentation
	 * (entre balises <nowiki>) ou temporairement commenté serait quand même
	 * compté par extractConfigs() alors qu'il ne produit aucun conteneur dans
	 * le HTML final — décalant l'appariement positionnel avec le DOM
	 * (ExtendedInputboxHooks::bakeIntoHtml) pour CET inputbox et tous ceux
	 * qui suivent sur la page.
	 *
	 * @param string $wikitext
	 * @return string
	 */
	private static function stripNonRenderedRegions( $wikitext ) {
		$wikitext = preg_replace( '/<!--[\s\S]*?-->/', '', $wikitext );
		$wikitext = preg_replace( '/<nowiki\s*\/?>[\s\S]*?(<\/nowiki>|$)/i', '', $wikitext );
		$wikitext = preg_replace( '/<pre\b[^>]*>[\s\S]*?(<\/pre>|$)/i', '', $wikitext );
		return $wikitext;
	}

	/**
	 * Extrait tous les blocs <inputbox>...</inputbox> d'un wikitexte déjà
	 * "expandtemplates" (modèles développés), et retourne la liste ordonnée
	 * des configs parsées (une par occurrence, dans l'ordre du wikitexte).
	 *
	 * @param string $wikitext Wikitexte avec modèles développés
	 * @return array[] Liste de configs
	 */
	public static function extractConfigs( $wikitext ) {
		$configs = [];
		$wikitext = self::stripNonRenderedRegions( $wikitext );
		if ( preg_match_all( '/<inputbox>([\s\S]*?)<\/inputbox>/i', $wikitext, $matches ) ) {
			foreach ( $matches[1] as $rawText ) {
				$configs[] = self::parseSingleConfig( $rawText );
			}
		}
		return $configs;
	}

	/**
	 * Une config est "étendue" si elle apporte quelque chose au-delà du
	 * comportement natif d'InputBox (titre de popup, champs, couleurs,
	 * erreurs...). Identique au filtre JS `extendedConfigs`.
	 *
	 * @param array $config
	 * @return bool
	 */
	public static function isExtended( array $config ) {
		return (
			!empty( $config['title'] ) ||
			!empty( $config['fields'] ) ||
			!empty( $config['preloadParams'] ) ||
			!empty( $config['skipEdit'] ) ||
			!empty( $config['buttonBgColor'] ) ||
			!empty( $config['buttonBorderColor'] ) ||
			!empty( $config['errors'] )
		);
	}

	/**
	 * @param array $config
	 * @return bool Vrai si cette config nécessite l'ouverture d'une popup OOUI
	 */
	public static function needsPopup( array $config ) {
		return !empty( $config['title'] ) || !empty( $config['fields'] );
	}

	/**
	 * @param array $config
	 * @return bool Vrai si cette config demande une couleur de bouton
	 */
	public static function needsColor( array $config ) {
		return !empty( $config['buttonBgColor'] ) || !empty( $config['buttonBorderColor'] );
	}

	/**
	 * Parse un seul bloc <inputbox>...</inputbox> (paramètres ligne par ligne
	 * "clé=valeur"). Miroir exact de parseConfig() côté JS.
	 *
	 * @param string $rawText
	 * @return array
	 */
	private static function parseSingleConfig( $rawText ) {
		$config = [
			'fields' => [],
			'rawParams' => [],
			'errors' => [],
			'title' => null,
			'text' => null,
			'skipEdit' => false,
			'preload' => null,
			'preloadParams' => null,
		'buttonBgColor' => null,
		'buttonBorderColor' => null,
		'requiredMarker' => null,
		];

		$lines = preg_split( '/\r\n|\r|\n/', $rawText );

		foreach ( $lines as $line ) {
			$line = trim( $line );
			if ( $line === '' || strpos( $line, '<!--' ) === 0 ) {
				continue;
			}

			$eqIdx = strpos( $line, '=' );
			if ( $eqIdx === false ) {
				continue;
			}

			$key = strtolower( trim( substr( $line, 0, $eqIdx ) ) );
			$val = trim( substr( $line, $eqIdx + 1 ) );

			switch ( $key ) {
				case 'popup-preload-params':
				case 'preload-params':
				case 'preloadparams':
					$config['preloadParams'] = array_map( 'trim', explode( ',', $val ) );
					break;
				case 'preload':
					$config['preload'] = $val;
					break;
				case 'popup-preload':
					$config['errors'][] = wfMessage( 'extendedinputbox-error-popup-preload-deprecated' )->text();
					break;
				case 'popup-title':
					$config['title'] = $val;
					break;
			case 'popup-text':
				$config['text'] = $val;
				break;
			case 'popup-required-marker':
			case 'required-marker':
				// null signifie « utiliser le libellé i18n » ; une chaîne vide
				// permet volontairement de masquer le marqueur visuel.
				$config['requiredMarker'] = $val;
				break;
				case 'popup-skip-edit':
				case 'skip-edit':
					$config['skipEdit'] = ( strtolower( $val ) === 'yes' );
					break;
				case 'button-bgcolor':
				case 'button-bg':
					if ( self::isValidCssColor( $val ) ) {
						$config['buttonBgColor'] = $val;
					} else {
						$config['errors'][] = wfMessage( 'extendedinputbox-error-invalid-bgcolor' )->text();
					}
					break;
				case 'button-border-color':
				case 'button-border':
					if ( self::isValidCssColor( $val ) ) {
						$config['buttonBorderColor'] = $val;
					} else {
						$config['errors'][] = wfMessage( 'extendedinputbox-error-invalid-bordercolor' )->text();
					}
					break;
				case 'popup-field':
					// Format : name|type|label|options|show-if|default|separator|required|placeholder|maxlength|minlength|help
					// - options     : liste "A,B,C" pour select/radio/checkbox, ou valeur
					//                 initiale pour text/textarea (conservé pour compat
					//                 ascendante ; "default" ci-dessous est prioritaire).
					// - show-if     : condition d'affichage (show-if:champ=valeur).
					// - default     : valeur préselectionnée/pré-remplie.
					// - separator   : séparateur utilisé pour joindre les valeurs d'un
					//                 champ checkbox multiple (défaut ", ").
					// - required    : "yes"/"no" (nouveau, défaut "no") ; le champ doit
					//                 avoir une valeur non vide (ou au moins une case
					//                 cochée pour checkbox) pour pouvoir publier.
					// - placeholder : texte indicatif affiché dans un champ vide
					//                 (nouveau, text/textarea uniquement).
					// - maxlength   : nombre maximal de caractères autorisés (nouveau,
					//                 text/textarea uniquement ; ignoré si non numérique).
					// - minlength   : nombre minimal de caractères requis (nouveau,
					//                 text/textarea uniquement ; ignoré si non numérique).
					// - help        : texte d'aide affiché via une bulle d'info à côté
					//                 du champ (nouveau).
					// Tous les segments au-delà du 3e sont optionnels, la config à
					// 3-11 segments continue de fonctionner à l'identique.
					$parts = array_map( 'trim', explode( '|', $val ) );
					if ( count( $parts ) >= 3 ) {
						$maxlength = $parts[9] ?? '';
						$minlength = $parts[10] ?? '';
						// Un nom de champ dupliqué écraserait silencieusement le
						// widget précédent (même clé dans dialog.widgets/fieldLayouts
						// côté JS) et casserait show-if/preload-params de façon très
						// difficile à diagnostiquer pour l'auteur de la page : on le
						// signale explicitement plutôt que de laisser faire.
						foreach ( $config['fields'] as $existingField ) {
							if ( $existingField['name'] === $parts[0] ) {
								$config['errors'][] = wfMessage( 'extendedinputbox-error-duplicate-field', $parts[0] )->text();
								break;
							}
						}
						$config['fields'][] = [
							'name' => $parts[0],
							'type' => $parts[1],
							'label' => $parts[2],
							'options' => $parts[3] ?? '',
							'showIf' => $parts[4] ?? '',
							'default' => $parts[5] ?? '',
							'separator' => isset( $parts[6] ) && $parts[6] !== '' ? $parts[6] : ', ',
							'required' => isset( $parts[7] ) && strtolower( $parts[7] ) === 'yes',
							'placeholder' => $parts[8] ?? '',
							'maxlength' => ( $maxlength !== '' && ctype_digit( $maxlength ) ) ? (int)$maxlength : null,
							'minlength' => ( $minlength !== '' && ctype_digit( $minlength ) ) ? (int)$minlength : null,
							'help' => $parts[11] ?? '',
						];
					}
					break;
				default:
					$config['rawParams'][ $key ] = $val;
			}
		}

		if ( isset( $config['rawParams']['skip-edit'] ) && strtolower( $config['rawParams']['skip-edit'] ) === 'yes' ) {
			$config['skipEdit'] = true;
		}

		return $config;
	}
}
