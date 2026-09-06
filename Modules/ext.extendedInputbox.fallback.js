// <nowiki>
( function ( $, mw ) {
	'use strict';

	// Ce module est très léger et toujours chargé (pas de dépendance OOUI).
	// Sur un chargement de page normal, ExtendedInputboxHooks::onOutputPageBeforeHTML
	// a déjà tout réglé côté serveur : les formulaires concernés ont un
	// attribut data-eib-index et n'ont pas besoin d'être retraités ici.
	//
	// Ce module ne sert que de filet de sécurité pour du contenu injecté
	// DYNAMIQUEMENT après le rendu initial (prévisualisation live, aperçu
	// VisualEditor...), où le hook serveur n'a pas pu s'appliquer. Dans ce
	// cas seulement, on retombe sur l'ancienne méthode (appel API) et on
	// charge OOUI à la demande, uniquement si une popup est réellement trouvée.

	var api = new mw.Api();
	var configCache = null; // { key: string, promise: jQuery.Promise }

	function isValidCssColor( val ) {
		if ( !val ) { return false; }
		val = val.trim();
		return (
			/^#[0-9a-fA-F]{3,8}$/.test( val ) ||
			/^rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(,\s*[\d.]+\s*)?\)$/.test( val ) ||
			/^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(,\s*[\d.]+\s*)?\)$/.test( val ) ||
			/^[a-zA-Z]{3,20}$/.test( val )
		);
	}

	function getConfigsForCurrentPage() {
		var cacheKey = mw.config.get( 'wgPageName' ) + ':' + mw.config.get( 'wgCurRevisionId' );
		if ( configCache && configCache.key === cacheKey ) {
			return configCache.promise;
		}

		var promise = mw.loader.using( [ 'mediawiki.api' ] ).then( function () {
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
			var inputboxRegex = /<inputbox>([\s\S]*?)<\/inputbox>/gi;
			var configs = [];
			var match;

			while ( ( match = inputboxRegex.exec( wikitext ) ) !== null ) {
				configs.push( parseConfig( match[1] ) );
			}

			var extendedConfigs = configs.filter( function ( c ) {
				return c.title || c.fields.length > 0 || c.preloadParams || c.skipEdit || c.buttonBgColor || c.buttonBorderColor || c.errors.length > 0;
			} );

			return { configs: configs, extendedConfigs: extendedConfigs };
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

		var $forms = [];
		$content.find( '.mw-inputbox-centered, .mw-inputbox-container, form.createbox' ).each( function () {
			var $f = $( this ).is( 'form' ) ? $( this ) : $( this ).find( 'form' );
			// Déjà traité côté serveur (rendu normal, pas une prévisualisation) : on ignore.
			if ( $f.length && $f.attr( 'data-eib-index' ) !== undefined ) {
				return;
			}
			if ( $f.length && $forms.indexOf( $f[0] ) === -1 ) {
				$forms.push( $f[0] );
			}
		} );

		if ( !$forms.length ) { return; }

		getConfigsForCurrentPage().done( function ( result ) {
			var extendedConfigs = result.extendedConfigs;
			var configs = result.configs;

			$.each( $forms, function ( index, formEl ) {
				var $form = $( formEl );
				var config = findMatchingConfig( $form, extendedConfigs, configs, index );
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

				// OOUI n'est chargé ici QUE parce qu'on vient de détecter une
				// vraie popup sur ce contenu dynamique précis.
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

	function findMatchingConfig( $form, extendedConfigs, allConfigs, fallbackIndex ) {
		if ( !extendedConfigs.length ) { return null; }

		var btnText = $form.find( 'input[type="submit"], button[type="submit"]' ).val() || '';
		var formPreload = $form.find( 'input[name="preload"]' ).val() || '';

		for ( var i = 0; i < extendedConfigs.length; i++ ) {
			var c = extendedConfigs[i];
			if ( c.rawParams.buttonlabel && c.rawParams.buttonlabel.trim() === btnText.trim() ) {
				return c;
			}
			if ( formPreload && ( c.preload === formPreload || c.rawParams.preload === formPreload ) ) {
				return c;
			}
		}

		return extendedConfigs[ fallbackIndex ] || allConfigs[ fallbackIndex ] || null;
	}

	function parseConfig( rawText ) {
		var config = { fields: [], rawParams: {}, errors: [] };
		var lines = rawText.split( '\n' );

		lines.forEach( function ( line ) {
			line = line.trim();
			if ( !line || line.indexOf( '<!--' ) === 0 ) { return; }

			var eqIdx = line.indexOf( '=' );
			if ( eqIdx === -1 ) { return; }

			var key = line.substring( 0, eqIdx ).trim().toLowerCase();
			var val = line.substring( eqIdx + 1 ).trim();

			if ( key === 'popup-preload-params' || key === 'preload-params' || key === 'preloadparams' ) {
				config.preloadParams = val.split( ',' ).map( function ( s ) { return s.trim(); } );
			} else if ( key === 'preload' ) {
				config.preload = val;
			} else if ( key === 'popup-preload' ) {
				config.errors.push( 'Erreur : le paramètre "popup-preload" n\'est plus supporté. Veuillez utiliser juste "preload".' );
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
					config.errors.push( 'Erreur : la valeur de "button-bgcolor" n\'est pas une couleur CSS valide.' );
				}
			} else if ( key === 'button-border-color' || key === 'button-border' ) {
				if ( isValidCssColor( val ) ) {
					config.buttonBorderColor = val;
				} else {
					config.errors.push( 'Erreur : la valeur de "button-border-color" n\'est pas une couleur CSS valide.' );
				}
			} else if ( key === 'popup-field' ) {
				var parts = val.split( '|' ).map( function ( s ) { return s.trim(); } );
				if ( parts.length >= 3 ) {
					config.fields.push( {
						name: parts[0],
						type: parts[1],
						label: parts[2],
						options: parts[3] || '',
						showIf: parts[4] || ''
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
