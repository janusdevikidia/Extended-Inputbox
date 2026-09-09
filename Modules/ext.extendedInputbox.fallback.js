// <nowiki>
( function ( $, mw ) {
	'use strict';

	// Portée réelle de ce module en v2 (voir ExtendedInputboxHooks::onBeforePageDisplay
	// et ::onOutputPageBeforeHTML) :
	//  - Au chargement initial d'une page déjà traitée côté serveur
	//    (extendedInputboxServerProcessed=true), ce hook ne fait RIEN pour le
	//    contenu initial : skipInitialServerProcessedContent saute le premier
	//    déclenchement. Aucun appel query+expandtemplates n'a lieu pour le cas normal.
	//  - Les formulaires déjà marqués data-eib-index (traités côté PHP) sont
	//    explicitement exclus de la détection ci-dessous.
	//  - Le fallback complet (query + expandtemplates + parseConfig) ne s'exécute
	//    donc que pour du contenu réellement injecté APRÈS le rendu initial
	//    (contenu dynamique/AJAX, prévisualisation, gadgets, etc.), qui n'a pas pu
	//    passer par ExtendedInputboxHooks::onOutputPageBeforeHTML. Ce n'est pas du
	//    code mort : c'est le seul moyen de couvrir ce cas, MediaWiki ne fournissant
	//    pas de config pré-calculée pour du contenu ajouté après coup.
	var api = null;
	var configCache = null;
	var skipInitialServerProcessedContent = mw.config.get( 'extendedInputboxServerProcessed' ) === true;

	function isValidCssColor( val ) {
		// La liste des noms et la grammaire CSS sont maintenues par le navigateur,
		// ce qui évite de dupliquer CSS_COLOR_KEYWORDS avec le validateur PHP.
		// CSS.supports est disponible sur les navigateurs pris en charge par MW 1.39.
		return typeof CSS !== 'undefined' && CSS.supports( 'color', ( val || '' ).trim() );
	}

	// Retire du wikitexte tout ce qui n'est PAS réellement interprété comme
	// un tag <inputbox> par le parseur : contenu de <nowiki>...</nowiki> et
	// <pre>...</pre> (rendus tels quels, en texte), et commentaires HTML
	// <!-- ... --> (jamais rendus). Miroir exact de
	// ExtendedInputboxConfig::stripNonRenderedRegions() côté PHP.
	//
	// Sans ceci, un <inputbox> cité en exemple dans une page de documentation
	// (entre balises <nowiki>) ou commenté serait quand même compté ici alors
	// qu'il ne produit aucun formulaire réel dans la page — décalant
	// l'appariement positionnel entre "configs" et "$forms" ci-dessous pour
	// CET inputbox et tous ceux qui suivent.
	function stripNonRenderedRegions( wikitext ) {
		wikitext = wikitext.replace( /<!--[\s\S]*?-->/g, '' );
		wikitext = wikitext.replace( /<nowiki\s*\/?>[\s\S]*?(?:<\/nowiki>|$)/gi, '' );
		wikitext = wikitext.replace( /<pre\b[^>]*>[\s\S]*?(?:<\/pre>|$)/gi, '' );
		return wikitext;
	}

	function getConfigsForCurrentPage() {
		var cacheKey = mw.config.get( 'wgPageName' ) + ':' + mw.config.get( 'wgCurRevisionId' );
		if ( configCache && configCache.key === cacheKey ) {
			return configCache.promise;
		}

		var promise = mw.loader.using( 'mediawiki.api' ).then( function () {
			api = api || new mw.Api();
			return api.get( {
				action: 'query',
				prop: 'revisions',
				rvprop: 'content',
				rvslots: 'main',
				titles: mw.config.get( 'wgPageName' ),
				formatversion: 2
			} );
		} ).then( function ( data ) {
			var page = data && data.query && data.query.pages && data.query.pages[0];
			if ( !page || !page.revisions || !page.revisions[0] ) {
				return $.Deferred().reject( 'no-revisions' ).promise();
			}
			var rawWikitext = page.revisions[0].slots.main.content;

			return api.post( {
				action: 'expandtemplates',
				title: mw.config.get( 'wgPageName' ),
				text: rawWikitext,
				prop: 'wikitext',
				formatversion: 2
			} );
		} ).then( function ( expData ) {
			if ( !expData || !expData.expandtemplates || !expData.expandtemplates.wikitext ) {
				return $.Deferred().reject( 'no-wikitext' ).promise();
			}

			var wikitext = expData.expandtemplates.wikitext;
			wikitext = stripNonRenderedRegions( wikitext );
			var inputboxRegex = /<inputbox>([\s\S]*?)<\/inputbox>/gi;
			var configs = [];
			var match;

			while ( ( match = inputboxRegex.exec( wikitext ) ) !== null ) {
				configs.push( parseConfig( match[1] ) );
			}

			return { configs: configs };
		} );

		configCache = { key: cacheKey, promise: promise };
		promise.fail( function () {
			if ( configCache && configCache.key === cacheKey ) {
				configCache = null;
			}
		} );

		return promise;
	}

	mw.hook( 'wikipage.content' ).add( function ( $content ) {
		if ( !$content.is( '#mw-content-text' ) && !$content.closest( '#mw-content-text' ).length ) {
			return;
		}
		if ( skipInitialServerProcessedContent ) {
			skipInitialServerProcessedContent = false;
			return;
		}

		var $forms = [];
		$content.find( '.mw-inputbox-centered, .mw-inputbox-container, form.createbox' ).each( function () {
			var $f = $( this ).is( 'form' ) ? $( this ) : $( this ).find( 'form' );
			if ( $f.length && $f.attr( 'data-eib-index' ) !== undefined ) {
				return;
			}
			if ( $f.length && $forms.indexOf( $f[0] ) === -1 ) {
				$forms.push( $f[0] );
			}
		} );

		if ( !$forms.length ) { return; }

		getConfigsForCurrentPage().done( function ( result ) {
			var configs = result.configs;

			$.each( $forms, function ( index, formEl ) {
				var $form = $( formEl );
				var config = findMatchingConfig( $form, configs, index );
				if ( !config ) { return; }

				var $container = $form.closest( '.mw-inputbox-centered, .mw-inputbox-container' );
				var $target = $container.length ? $container : $form;
				var $btn = $form.find( 'input[type="submit"], button[type="submit"], .mw-ui-button' );

				if ( config.errors && config.errors.length ) {
					$target.find( '.extended-inputbox-error' ).remove();
					var $errContainer = $( '<div>' )
						.addClass( 'extended-inputbox-error' )
						.text( config.errors.join( ' ' ) );
					$target.append( $errContainer );
				}

				applyButtonStyle( $btn, config, index );

				if ( !config.title && !config.fields.length ) { return; }

				$form.off( 'submit.extendedInputbox' ).on( 'submit.extendedInputbox', function ( e ) {
					e.preventDefault();
					mw.loader.using( [ 'oojs-ui-core', 'oojs-ui-widgets', 'oojs-ui-windows', 'mediawiki.util' ], function () {
						mw.loader.using( 'ext.extendedInputbox.popup' ).then( function () {
							mw.hook( 'extendedInputbox.openDialog' ).fire( config, $form, api );
						} );
					} );
				} );
			} );
		} ).fail( function ( reason ) {
			mw.log.error( 'ExtendedInputBox: échec de la récupération de la configuration (fallback).', reason );
		} );
	} );

	function applyButtonStyle( $btn, config, index ) {
		if ( !config.buttonBgColor && !config.buttonBorderColor ) {
			return;
		}

		var bg = config.buttonBgColor || '';
		var textColor = bg ? '#ffffff' : '';
		var borderColor = config.buttonBorderColor || 'transparent';

		var btnClass = 'extended-inputbox-btn-fallback-' + index;
		var styleId = 'extended-inputbox-style-fallback-' + index;

		var rules = [];
		if ( bg ) {
			rules.push( 'background: ' + bg + ' !important' );
		}
		if ( textColor ) {
			rules.push( 'color: ' + textColor + ' !important' );
		}
		rules.push( 'border: 2px solid ' + borderColor + ' !important' );
		rules.push( 'border-radius: 2px' );
		rules.push( 'font-weight: 600' );
		rules.push( 'box-shadow: none' );
		rules.push( 'text-shadow: none' );

		var css = '.' + btnClass + ' { ' + rules.join( '; ' ) + '; }';
		if ( textColor ) {
			css += ' .' + btnClass + ' * { color: ' + textColor + ' !important; }';
		}

		var $existingStyle = $( '#' + styleId );
		if ( $existingStyle.length ) {
			$existingStyle.text( css );
		} else {
			$( '<style>' ).attr( 'id', styleId ).text( css ).appendTo( 'head' );
		}

		$btn.addClass( btnClass );
	}

	function findMatchingConfig( $form, configs, fallbackIndex ) {
		if ( !configs || !configs.length ) { return null; }

		var btnText = $form.find( 'input[type="submit"], button[type="submit"]' ).val() || '';
		var formPreload = $form.find( 'input[name="preload"]' ).val() || '';

		// Si plusieurs <inputbox> de la page partagent le même buttonlabel (cas
		// fréquent quand une page réutilise un modèle), un match par libellé
		// n'est fiable QUE s'il est unique : sinon on associerait arbitrairement
		// ce $form à la première config correspondante, potentiellement la
		// mauvaise. On ne retient donc un match par libellé/preload que s'il n'y
		// en a exactement qu'un ; en cas d'ambiguïté (0 ou plusieurs), on retombe
		// sur la correspondance positionnelle (fallbackIndex), plus prévisible.
		var byLabel = btnText.trim() ? configs.filter( function ( c ) {
			return c.rawParams.buttonlabel && c.rawParams.buttonlabel.trim() === btnText.trim();
		} ) : [];
		if ( byLabel.length === 1 ) {
			return byLabel[0];
		}

		var byPreload = formPreload ? configs.filter( function ( c ) {
			return c.preload === formPreload || c.rawParams.preload === formPreload;
		} ) : [];
		if ( byPreload.length === 1 ) {
			return byPreload[0];
		}

		return configs[ fallbackIndex ] || null;
	}

	function parseConfig( rawText ) {
		var config = { fields: [], rawParams: {}, errors: [], requiredMarker: null };
		var lines = rawText.split( '\n' );

		lines.forEach( function ( line ) {
			line = line.trim();
			if ( !line || line.indexOf( '<!--' ) === 0 ) { return; }

			var eqIdx = line.indexOf( '=' );
			// Bug corrigé : "!eqIdx" était vrai aussi pour eqIdx === 0 (ligne
			// commençant par "="), ce qui ignorait silencieusement cette ligne
			// alors que ExtendedInputboxConfig::parseSingleConfig() (PHP) ne
			// teste que "$eqIdx === false". Les deux miroirs divergeaient.
			if ( eqIdx === -1 ) { return; }

			var key = line.substring( 0, eqIdx ).trim().toLowerCase();
			var val = line.substring( eqIdx + 1 ).trim();

			if ( key === 'popup-preload-params' || key === 'preload-params' || key === 'preloadparams' ) {
				config.preloadParams = val.split( ',' ).map( function ( s ) { return s.trim(); } );
			} else if ( key === 'preload' ) {
				config.preload = val;
			} else if ( key === 'popup-preload' ) {
				config.errors.push( mw.msg( 'extendedinputbox-error-popup-preload-deprecated' ) );
			} else if ( key === 'popup-title' ) {
				config.title = val;
			} else if ( key === 'popup-text' ) {
				config.text = val;
			} else if ( key === 'popup-required-marker' || key === 'required-marker' ) {
				// null signifie « utiliser le message i18n » ; une chaîne vide masque
				// volontairement le marqueur visuel.
				config.requiredMarker = val;
			} else if ( key === 'popup-skip-edit' || key === 'skip-edit' ) {
				config.skipEdit = ( val.toLowerCase() === 'yes' );
			} else if ( key === 'button-bgcolor' || key === 'button-bg' ) {
				if ( isValidCssColor( val ) ) {
					config.buttonBgColor = val;
				} else {
					config.errors.push( mw.msg( 'extendedinputbox-error-invalid-bgcolor' ) );
				}
			} else if ( key === 'button-border-color' || key === 'button-border' ) {
				if ( isValidCssColor( val ) ) {
					config.buttonBorderColor = val;
				} else {
					config.errors.push( mw.msg( 'extendedinputbox-error-invalid-bordercolor' ) );
				}
			} else if ( key === 'popup-field' ) {
				// Miroir exact de ExtendedInputboxConfig::parseSingleConfig() côté PHP :
				// name|type|label|options|show-if|default|separator|required|placeholder|maxlength|minlength|help
				// (tout ce qui suit "label" est optionnel).
				var parts = val.split( '|' ).map( function ( s ) { return s.trim(); } );
				if ( parts.length >= 3 ) {
					var maxlengthRaw = parts[9] || '';
					var minlengthRaw = parts[10] || '';
					// Miroir exact de la détection PHP (ExtendedInputboxConfig::parseSingleConfig) :
					// un nom de champ dupliqué écrase silencieusement le widget précédent.
					var isDuplicateName = config.fields.some( function ( f ) { return f.name === parts[0]; } );
					if ( isDuplicateName ) {
						config.errors.push( mw.msg( 'extendedinputbox-error-duplicate-field', parts[0] ) );
					}
					config.fields.push( {
						name: parts[0],
						type: parts[1],
						label: parts[2],
						options: parts[3] || '',
						showIf: parts[4] || '',
						default: parts[5] || '',
						separator: parts[6] || ', ',
						required: ( parts[7] || '' ).toLowerCase() === 'yes',
						placeholder: parts[8] || '',
						maxlength: ( /^\d+$/.test( maxlengthRaw ) ) ? parseInt( maxlengthRaw, 10 ) : null,
						minlength: ( /^\d+$/.test( minlengthRaw ) ) ? parseInt( minlengthRaw, 10 ) : null,
						help: parts[11] || ''
					} );
				}
			} else {
				config.rawParams[ key ] = val;
			}
		} );

		if ( config.rawParams['skip-edit'] && config.rawParams['skip-edit'].toLowerCase() === 'yes' ) {
			config.skipEdit = true;
		}

		return config;
	}

} )( jQuery, mediaWiki );
// </nowiki>
