<?php
class ExtendedInputboxHooks {

    public static function onBeforePageDisplay( $out, $skin ) {
        $out->addModules( 'ext.extendedInputbox' );
    }

    public static function onParserFirstCallInit( Parser $parser ) {
        // On intercepte la balise <inputbox> pour l'analyser avant MediaWiki
        $parser->setHook( 'inputbox', [ self::class, 'renderExtendedInputbox' ] );
    }

    public static function renderExtendedInputbox( $input, array $args, Parser $parser, PPFrame $frame ) {
        $config = [ 'fields' => [], 'rawParams' => [] ];
        $lines = explode( "\n", $input );
        $cleanInputLines = []; // Contiendra les paramètres natifs d'InputBox

        // 1. Analyse du wikitext (équivalent PHP de ton parseConfig JS)
        foreach ( $lines as $line ) {
            $trimmed = trim( $line );
            if ( empty( $trimmed ) || strpos( $trimmed, '<!--' ) === 0 ) {
                $cleanInputLines[] = $line;
                continue;
            }

            $eqIdx = strpos( $trimmed, '=' );
            if ( $eqIdx === false ) {
                $cleanInputLines[] = $line;
                continue;
            }

            $key = strtolower( trim( substr( $trimmed, 0, $eqIdx ) ) );
            $val = trim( substr( $trimmed, $eqIdx + 1 ) );

            if ( in_array( $key, [ 'popup-preload-params', 'preload-params', 'preloadparams' ] ) ) {
                $config['preloadParams'] = array_map( 'trim', explode( ',', $val ) );
            } elseif ( in_array( $key, [ 'popup-preload', 'preload' ] ) ) {
                $config['preload'] = $val;
            } elseif ( $key === 'popup-title' ) {
                $config['title'] = $val;
            } elseif ( $key === 'popup-text' ) {
                $config['text'] = $val;
            } elseif ( in_array( $key, [ 'popup-skip-edit', 'skip-edit' ] ) ) {
                $config['skipEdit'] = ( strtolower( $val ) === 'yes' );
            } elseif ( $key === 'popup-field' ) {
                $parts = array_map( 'trim', explode( '|', $val ) );
                if ( count( $parts ) >= 3 ) {
                    $config['fields'][] = [
                        'name' => $parts[0],
                        'type' => $parts[1],
                        'label' => $parts[2],
                        'options' => $parts[3] ?? '',
                        'showIf' => $parts[4] ?? ''
                    ];
                }
            } else {
                // Paramètre classique d'InputBox : on le garde pour le formulaire natif
                $config['rawParams'][$key] = $val;
                $cleanInputLines[] = $line; 
            }
        }

        if ( isset( $config['rawParams']['skip-edit'] ) && strtolower( $config['rawParams']['skip-edit'] ) === 'yes' ) {
            $config['skipEdit'] = true;
        }

        $jsonConfig = htmlspecialchars( json_encode( $config ), ENT_QUOTES, 'UTF-8' );
        $cleanInput = implode( "\n", $cleanInputLines );

        // 2. Appel de l'extension InputBox d'origine pour générer le HTML
        if ( class_exists( '\MediaWiki\Extension\InputBox\InputBox' ) ) {
            $inputBox = new \MediaWiki\Extension\InputBox\InputBox( $parser );
            $html = $inputBox->render( $cleanInput, $args );
        } else {
            return "Erreur: Extension InputBox introuvable.";
        }

        // 3. Encapsulation dans une Div avec la configuration si besoin
        if ( !empty( $config['title'] ) || !empty( $config['fields'] ) ) {
            return "<div class='extended-inputbox-wrapper' data-extended-config='{$jsonConfig}'>{$html}</div>";
        }

        return $html;
    }
}
