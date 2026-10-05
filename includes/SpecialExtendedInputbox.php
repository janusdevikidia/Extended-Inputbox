<?php

namespace MediaWiki\Extension\ExtendedInputbox;

use MediaWiki\Html\Html;
use MediaWiki\Message\Message;
use MediaWiki\SpecialPage\SpecialPage;

/**
 * Special:Extended-Inputbox — interface visuelle permettant de construire un bloc
 * <inputbox> (natif + paramètres étendus par cette extension), puis de
 * l'insérer dans le wikitexte d'une page cible chargée depuis l'API, avec
 * prévisualisation et publication directe.
 *
 * Toute la logique (construction du formulaire, chargement/insertion/
 * prévisualisation/publication) vit côté client dans
 * Modules/ext.extendedInputbox.special.js ; cette classe se contente de
 * préparer la page (titre, modules, éventuelle pré-sélection de la page
 * cible) et de vérifier que l'utilisateur a le droit d'éditer.
 */
class SpecialExtendedInputbox extends SpecialPage {

	public function __construct() {
		// Droit 'edit' : cette page ne sert qu'à préparer une modification de
		// page wiki, donc un utilisateur qui ne peut pas éditer n'a rien à y
		// faire. Les vérifications spécifiques à LA page cible choisie (protection,
		// blocage, etc.) restent de toute façon refaites par l'API MediaWiki
		// elle-même au moment de action=edit, et gérées côté JS.
		parent::__construct( 'Extended-Inputbox', 'edit' );
	}

	/**
	 * Cette page elle-même n'écrit jamais rien en base : toute écriture passe
	 * par un appel client à l'API (action=edit), pas par l'exécution PHP de
	 * la SpecialPage.
	 *
	 * @return bool
	 */
	public function doesWrites() {
		return false;
	}

	/**
	 * @param string|null $subPage
	 */
	public function execute( $subPage ) {
		$this->setHeaders();
		$this->outputHeader();
		// Vérifie le droit 'edit' déclaré dans le constructeur de la classe, ainsi que les
		// conditions génériques (lecture, blocage global, etc.).
		$this->checkPermissions();

		$out = $this->getOutput();
		$out->setPageTitleMsg( $this->msg( 'extendedinputbox-special-title' ) );
		$out->setRobotPolicy( 'noindex,nofollow' );

		$out->addModuleStyles( [ 'ext.extendedInputbox.special.styles' ] );
		$out->addModules( [ 'ext.extendedInputbox.special' ] );

		// Permet de préremplir le champ "page cible" via Special:Extended-Inputbox/Ma_page
		// ou Special:Extended-Inputbox?target=Ma_page, pratique pour un lien direct
		// depuis une autre page du wiki.
		$requestedTarget = ( $subPage !== null && $subPage !== '' )
			? $subPage
			: $this->getRequest()->getText( 'target', '' );

		$out->addJsConfigVars( [
			'extendedInputboxSpecialTarget' => $requestedTarget,
		] );

		$out->addHTML( Html::element( 'div', [ 'id' => 'eib-special-root' ] ) );
	}

	/**
	 * Description affichée sur Special:SpecialPages.
	 * Depuis MediaWiki 1.41, cette méthode doit renvoyer un objet Message
	 * (et non une chaîne, ce qui est déprécié).
	 *
	 * @return Message
	 */
	public function getDescription() {
		return $this->msg( 'extendedinputbox-special' );
	}

	protected function getGroupName() {
		return 'wiki';
	}
}

