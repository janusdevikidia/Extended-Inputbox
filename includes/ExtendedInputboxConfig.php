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
	 * Valide une valeur de couleur CSS (hex, rgb(a), hsl(a) ou nom de couleur).
	 * Identique à isValidCssColor() côté JS.
	 *
	 * @param string|null $val
	 * @return bool
	 */
	public static function isValidCssColor( $val ) {
		if ( $val === null || $val === '' ) {
			return false;
		}
		$val = trim( $val );
		return (
			preg_match( '/^#[0-9a-fA-F]{3,8}$/', $val ) ||
			preg_match( '/^rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(,\s*[\d.]+\s*)?\)$/', $val ) ||
			preg_match( '/^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(,\s*[\d.]+\s*)?\)$/', $val ) ||
			preg_match( '/^[a-zA-Z]{3,20}$/', $val )
		);
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
					$config['errors'][] = 'Erreur : le paramètre "popup-preload" n\'est plus supporté. Veuillez utiliser juste "preload".';
					break;
				case 'popup-title':
					$config['title'] = $val;
					break;
				case 'popup-text':
					$config['text'] = $val;
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
						$config['errors'][] = 'Erreur : la valeur de "button-bgcolor" n\'est pas une couleur CSS valide.';
					}
					break;
				case 'button-border-color':
				case 'button-border':
					if ( self::isValidCssColor( $val ) ) {
						$config['buttonBorderColor'] = $val;
					} else {
						$config['errors'][] = 'Erreur : la valeur de "button-border-color" n\'est pas une couleur CSS valide.';
					}
					break;
				case 'popup-field':
					$parts = array_map( 'trim', explode( '|', $val ) );
					if ( count( $parts ) >= 3 ) {
						$config['fields'][] = [
							'name' => $parts[0],
							'type' => $parts[1],
							'label' => $parts[2],
							'options' => $parts[3] ?? '',
							'showIf' => $parts[4] ?? '',
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
