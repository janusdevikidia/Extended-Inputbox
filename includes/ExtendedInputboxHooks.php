<?php

class ExtendedInputboxHooks {
    public static function onBeforePageDisplay( OutputPage $out, $skin ) {
        $out->addModules( 'ext.extendedInputbox' );
    }
}
