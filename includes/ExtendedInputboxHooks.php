<?php
class ExtendedInputboxHooks {
	public static function onBeforePageDisplay( $out, $skin ) {
		// Charger uniquement si la page contient un inputbox (optionnel, sinon charge partout)
		$out->addModules( 'ext.extendedInputbox' );
	}
}
