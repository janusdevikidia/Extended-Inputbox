<?php
use MediaWiki\Extension\InputBox\InputBox;

class ExtendedInputboxHooks {

    public static function onBeforePageDisplay( OutputPage $out, $skin ) {
        $out->addModules( 'ext.extendedInputbox' );
    }

    public static function onParserFirstCallInit( Parser $parser ) {
        $parser->setHook( 'inputbox', [ self::class, 'renderExtendedInputbox' ] );
    }

    public static function renderExtendedInputbox( $input, array $args, Parser $parser, PPFrame $frame ) {
        $config = [ 'fields' => [], 'rawParams' => [] ];
        $lines = explode( "\n", $input );
        $cleanInputLines = [];

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
                $config['rawParams'][$key] = $val;
                $cleanInputLines[] = $line;
            }
        }

        if ( isset( $config['rawParams']['skip-edit'] ) && strtolower( $config['rawParams']['skip-edit'] ) === 'yes' ) {
            $config['skipEdit'] = true;
        }

        $cleanInput = implode( "\n", $cleanInputLines );

        if ( class_exists( 'MediaWiki\Extension\InputBox\InputBox' ) ) {
            $inputBox = new InputBox( $parser );
            $html = $inputBox->render( $cleanInput, $args, $parser, $frame );
        } elseif ( class_exists( 'InputBox' ) ) {
            $inputBox = new InputBox( $parser );
            $html = $inputBox->render( $cleanInput );
        } else {
            return "Erreur : Extension InputBox introuvable.";
        }

        $jsonConfig = htmlspecialchars( json_encode( $config ), ENT_QUOTES, 'UTF-8' );
        $wrapper = "<!-- EXTENDED INPUTBOX OK --><div class=\"extended-inputbox-wrapper\" data-extended-config=\"{$jsonConfig}\">{$html}</div>";

        return [ $wrapper, 'noparse' => true, 'isHTML' => true ];
    }
}
