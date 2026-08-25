<?php

class ExtendedInputboxHooks {
    public static function onBeforePageDisplay( OutputPage $out, $skin ) {
        $out->addModules( 'ext.extendedInputbox' );
        
        // Bloque les clics sur tous les formulaires InputBox dès le chargement HTML
        $out->addInlineStyle( '.mw-inputbox-container input[type="submit"], .mw-inputbox-centered input[type="submit"], form.createbox input[type="submit"], form.createbox button[type="submit"] { pointer-events: none; opacity: 0.6; }' );
    }
}
