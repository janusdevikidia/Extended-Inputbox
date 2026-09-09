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

	// Liste des 147 noms de couleurs CSS (Color Module Level 3/4) + rebeccapurple.
	// Miroir exact de ExtendedInputboxConfig::CSS_COLOR_KEYWORDS côté PHP :
	// toute évolution ici doit être répercutée là-bas (et inversement).
	var CSS_COLOR_KEYWORDS = [
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
		'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen'
	];

	var RE_NUMBER = /^\d{1,3}(?:\.\d+)?$/;
	var RE_PERCENT = /^\d{1,3}(?:\.\d+)?%$/;

	function isValidAlpha( val ) {
		return ( RE_NUMBER.test( val ) && parseFloat( val ) <= 1 ) ||
			( RE_PERCENT.test( val ) && parseFloat( val ) <= 100 );
	}

	// rgb()/rgba() : les 3 composantes doivent être toutes en nombres (0-255)
	// OU toutes en pourcentages (0-100%), sans mélange (comme en CSS legacy) ;
	// l'alpha optionnelle est un nombre 0-1 ou un pourcentage 0-100%.
	function isValidRgbArgs( argsStr ) {
		var parts = argsStr.split( ',' ).map( function ( s ) { return s.trim(); } );
		if ( parts.length !== 3 && parts.length !== 4 ) { return false; }

		var rgb = parts.slice( 0, 3 );
		var allNumber = rgb.every( function ( p ) { return RE_NUMBER.test( p ) && parseFloat( p ) <= 255; } );
		var allPercent = rgb.every( function ( p ) { return RE_PERCENT.test( p ) && parseFloat( p ) <= 100; } );

		if ( !allNumber && !allPercent ) { return false; }
		if ( parts.length === 4 && !isValidAlpha( parts[3] ) ) { return false; }

		return true;
	}

	// hsl()/hsla() : teinte en nombre (degrés implicites), saturation et
	// luminosité obligatoirement en pourcentages 0-100% ; alpha optionnelle
	// comme pour rgb().
	function isValidHslArgs( argsStr ) {
		var parts = argsStr.split( ',' ).map( function ( s ) { return s.trim(); } );
		if ( parts.length !== 3 && parts.length !== 4 ) { return false; }

		if ( !/^-?\d{1,3}(?:\.\d+)?(?:deg)?$/.test( parts[0] ) ) { return false; }
		if ( !RE_PERCENT.test( parts[1] ) || parseFloat( parts[1] ) > 100 ) { return false; }
		if ( !RE_PERCENT.test( parts[2] ) || parseFloat( parts[2] ) > 100 ) { return false; }
		if ( parts.length === 4 && !isValidAlpha( parts[3] ) ) { return false; }

		return true;
	}

	function isValidCssColor( val ) {
		if ( !val ) { return false; }
		val = val.trim();

		// Hex : seules les longueurs 3, 4, 6 et 8 sont des couleurs CSS
		// valides (5 et 7 ne le sont pas), contrairement à l'ancienne regex
		// {3,8} qui les acceptait toutes.
		if ( /^#[0-9a-fA-F]+$/.test( val ) ) {
			var hexLen = val.length - 1;
			return hexLen === 3 || hexLen === 4 || hexLen === 6 || hexLen === 8;
		}

		var rgbMatch = val.match( /^rgba?\(([^)]*)\)$/i );
		if ( rgbMatch ) {
			return isValidRgbArgs( rgbMatch[1] );
		}

		var hslMatch = val.match( /^hsla?\(([^)]*)\)$/i );
		if ( hslMatch ) {
			return isValidHslArgs( hslMatch[1] );
		}

		var lower = val.toLowerCase();
		if ( lower === 'transparent' || lower === 'currentcolor' ) {
			return true;
		}

		// Nom de couleur : contrairement à l'ancienne regex /^[a-zA-Z]{3,20}$/
		// qui acceptait n'importe quel mot ("foobar" compris), on vérifie
		// désormais l'appartenance à la liste réelle des noms CSS valides.
		return CSS_COLOR_KEYWORDS.indexOf( lower ) !== -1;
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
						.css( { 'color': '#d33', 'font-weight': 'bold', 'margin-top': '8px', 'font-size': '0.9em' } )
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

		for ( var i = 0; i < configs.length; i++ ) {
			var c = configs[i];
			if ( c.rawParams.buttonlabel && c.rawParams.buttonlabel.trim() === btnText.trim() ) {
				return c;
			}
			if ( formPreload && ( c.preload === formPreload || c.rawParams.preload === formPreload ) ) {
				return c;
			}
		}

		return configs[ fallbackIndex ] || null;
	}

	function parseConfig( rawText ) {
		var config = { fields: [], rawParams: {}, errors: [] };
		var lines = rawText.split( '\n' );

		lines.forEach( function ( line ) {
			line = line.trim();
			if ( !line || line.indexOf( '<!--' ) === 0 ) { return; }

			var eqIdx = line.indexOf( '=' );
			if ( !eqIdx || eqIdx === -1 ) { return; }

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