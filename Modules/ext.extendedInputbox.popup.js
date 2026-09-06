// <nowiki>
( function ( $, mw ) {
	'use strict';

	// Ce module n'est chargé par PHP (ExtendedInputboxHooks::onOutputPageBeforeHTML)
	// que si la page contient au moins une popup. Les configs sont déjà
	// parsées côté serveur et transmises ici, donc plus AUCUN appel API
	// (query + expandtemplates) n'est nécessaire pour le cas normal.
	var api = new mw.Api();
	var configs = mw.config.get( 'extendedInputboxConfigs' ) || {};

	// Permet au module fallback (contenu dynamique, sans data-eib-index) de
	// déclencher l'ouverture du dialogue après avoir chargé ce module à la demande.
	mw.hook( 'extendedInputbox.openDialog' ).add( function ( config, $form, apiInstance ) {
		openExtendedDialog( config, $form, apiInstance || api );
	} );

	mw.hook( 'wikipage.content' ).add( function ( $content ) {
		if ( !$content.is( '#mw-content-text' ) && !$content.closest( '#mw-content-text' ).length ) {
			return;
		}

		$content.find( 'form[data-eib-index]' ).each( function () {
			var $form = $( this );
			var idx = $form.attr( 'data-eib-index' );
			var config = configs[ idx ];
			if ( !config ) { return; }

			var $btn = $form.find( 'input[type="submit"], button[type="submit"], .mw-ui-button' );
			// Lève le blocage de clic global posé côté serveur (onBeforePageDisplay)
			// maintenant que le binding du dialogue est prêt.
			$btn.css( { 'pointer-events': 'auto', 'opacity': '1' } );

			$form.off( 'submit.extendedInputbox' ).on( 'submit.extendedInputbox', function ( e ) {
				e.preventDefault();
				openExtendedDialog( config, $form, api );
			} );
		} );
	} );

	function getISOWeek( d ) {
		var date = new Date( Date.UTC( d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() ) );
		var dayNum = date.getUTCDay() || 7;
		date.setUTCDate( date.getUTCDate() + 4 - dayNum );
		var yearStart = new Date( Date.UTC( date.getUTCFullYear(), 0, 1 ) );
		return Math.ceil( ( ( ( date - yearStart ) / 86400000 ) + 1 ) / 7 );
	}

	function processMagicWords( text ) {
		if ( !text ) { return ''; }

		var d = new Date();
		var pad = function ( n ) { return n < 10 ? '0' + n : '' + n; };

		var year = d.getUTCFullYear().toString();
		var month = pad( d.getUTCMonth() + 1 );
		var day = pad( d.getUTCDate() );
		var hours = pad( d.getUTCHours() );
		var minutes = pad( d.getUTCMinutes() );
		var seconds = pad( d.getUTCSeconds() );
		var week = getISOWeek( d ).toString();

		var timestamp = year + month + day + hours + minutes + seconds;
		var timeStr = hours + ':' + minutes;
		var userName = mw.config.get( 'wgUserName' ) || 'Anonyme';
		var pageName = mw.config.get( 'wgPageName' ) || '';

		var magicMap = {
			'LOCALTIMESTAMP': timestamp,
			'CURRENTTIMESTAMP': timestamp,
			'LOCALYEAR': year,
			'CURRENTYEAR': year,
			'LOCALMONTH': month,
			'CURRENTMONTH': month,
			'LOCALDAY': day,
			'CURRENTDAY': day,
			'LOCALTIME': timeStr,
			'CURRENTTIME': timeStr,
			'LOCALWEEK': week,
			'CURRENTWEEK': week,
			'USER': userName,
			'REVISIONUSER': userName,
			'PAGENAME': pageName,
			'FULLPAGENAME': pageName
		};

		var result = text;
		Object.keys( magicMap ).forEach( function ( key ) {
			var regex = new RegExp( '\\{\\{\\s*' + key + '\\s*\\}\\}', 'gi' );
			result = result.replace( regex, magicMap[ key ] );
		} );

		return result;
	}

	function getParamValue( paramKey, paramIndex, formData, fields ) {
		if ( formData[ paramKey ] !== undefined ) {
			return formData[ paramKey ];
		}

		var cleanKey = paramKey.replace( /^\$/, '' );
		var numIdx = parseInt( cleanKey, 10 );
		if ( !isNaN( numIdx ) && numIdx > 0 && numIdx <= fields.length ) {
			var fieldNameByNum = fields[ numIdx - 1 ].name;
			if ( formData[ fieldNameByNum ] !== undefined ) {
				return formData[ fieldNameByNum ];
			}
		}

		if ( paramIndex < fields.length ) {
			var fieldNameByIdx = fields[ paramIndex ].name;
			if ( formData[ fieldNameByIdx ] !== undefined ) {
				return formData[ fieldNameByIdx ];
			}
		}

		return '';
	}

	function replaceVariables( text, paramOrder, formData, fields ) {
		if ( !text ) { return ''; }
		var result = text;

		var totalVars = Math.max( paramOrder.length, fields.length, 9 );
		var items = [];

		for ( var i = 0; i < totalVars; i++ ) {
			var paramKey = paramOrder[ i ] || ( i < fields.length ? fields[ i ].name : ( i + 1 ).toString() );
			var val = getParamValue( paramKey, i, formData, fields );
			items.push( { num: i + 1, value: val } );
		}

		items.sort( function ( a, b ) { return b.num - a.num; } );

		items.forEach( function ( item ) {
			var regex = new RegExp( '\\$' + item.num + '(?!\\d)', 'g' );
			result = result.replace( regex, function () { return item.value; } );
		} );

		return result;
	}

	function openExtendedDialog( config, $form, api ) {
		function ExtendedDialog( config ) {
			ExtendedDialog.super.call( this, config );
		}
		OO.inheritClass( ExtendedDialog, OO.ui.ProcessDialog );

		ExtendedDialog.static.name = 'extendedInputboxDialog';
		ExtendedDialog.static.title = config.title || 'Formulaire';
		ExtendedDialog.static.actions = [
			{ action: 'save', label: 'Valider', flags: [ 'primary', 'progressive' ] },
			{ label: 'Annuler', flags: 'safe' }
		];

		ExtendedDialog.prototype.initialize = function () {
			ExtendedDialog.super.prototype.initialize.apply( this, arguments );
			var dialog = this;
			this.content = new OO.ui.PanelLayout( { padded: true, expanded: false } );
			this.widgets = {};
			this.fieldLayouts = {};

			if ( config.text ) {
				this.content.$element.append( $( '<p>' ).text( config.text ) );
			}

			config.fields.forEach( function ( field ) {
				var widget;
				if ( field.type === 'select' ) {
					var opts = field.options.split( ',' ).map( function ( o ) {
						var v = o.trim(); return { data: v, label: v };
					} );
					widget = new OO.ui.DropdownInputWidget( { options: opts } );
				} else if ( field.type === 'radio' ) {
					var opts = field.options.split( ',' ).map( function ( o ) {
						var v = o.trim(); return { data: v, label: v };
					} );
					widget = new OO.ui.RadioSelectInputWidget( { options: opts } );
				} else if ( field.type === 'checkbox' || field.type === 'checkboxes' ) {
					var opts = field.options ? field.options.split( ',' ).map( function ( o ) {
						var v = o.trim(); return { data: v, label: v };
					} ) : [];
					widget = new OO.ui.CheckboxMultiselectInputWidget( { options: opts } );
				} else if ( field.type === 'textarea' ) {
					widget = new OO.ui.MultilineTextInputWidget( { value: field.options } );
				} else {
					widget = new OO.ui.TextInputWidget( { value: field.options } );
				}

				var layout = new OO.ui.FieldLayout( widget, {
					label: field.label,
					align: 'top'
				} );

				dialog.widgets[ field.name ] = widget;
				dialog.fieldLayouts[ field.name ] = layout;
				dialog.content.$element.append( layout.$element );
			} );

			function checkSingleCondition( condStr ) {
				var eqIdx = condStr.indexOf( '=' );
				if ( eqIdx === -1 ) { return false; }

				var parentName = condStr.substring( 0, eqIdx ).trim();
				var targetVal = condStr.substring( eqIdx + 1 ).trim();

				var parentLayout = dialog.fieldLayouts[ parentName ];
				var parentWidget = dialog.widgets[ parentName ];

				var isParentVisible = parentLayout ? parentLayout.isVisible() : true;
				if ( !isParentVisible || !parentWidget ) { return false; }

				var parentVal = parentWidget.getValue();

				if ( Array.isArray( parentVal ) ) {
					return parentVal.indexOf( targetVal ) !== -1;
				}

				return parentVal === targetVal;
			}

			function evaluateShowIf( rawCond ) {
				var orBranches = rawCond.split( ',' );
				return orBranches.some( function ( branch ) {
					var andConds = branch.split( '&' );
					return andConds.every( function ( cond ) {
						return checkSingleCondition( cond.trim() );
					} );
				} );
			}

			function updateAllVisibilities() {
				var changed = true;
				var maxPasses = 10;
				while ( changed && maxPasses > 0 ) {
					changed = false;
					maxPasses--;

					config.fields.forEach( function ( field ) {
						if ( !field.showIf ) { return; }

						var showIfStr = field.showIf.trim();
						if ( showIfStr.indexOf( 'show-if:' ) !== 0 ) { return; }

						var rawCond = showIfStr.substring( 8 ).trim();
						var shouldShow = evaluateShowIf( rawCond );
						var currentLayout = dialog.fieldLayouts[ field.name ];

						if ( currentLayout && currentLayout.isVisible() !== shouldShow ) {
							currentLayout.toggle( shouldShow );
							changed = true;
						}
					} );
				}
			}

			Object.keys( dialog.widgets ).forEach( function ( name ) {
				dialog.widgets[ name ].on( 'change', updateAllVisibilities );
			} );

			updateAllVisibilities();

			this.$body.append( this.content.$element );
		};

		ExtendedDialog.prototype.getActionProcess = function ( action ) {
			var dialog = this;
			if ( action === 'save' ) {
				return new OO.ui.Process( function () {
					var formData = {};
					config.fields.forEach( function ( field ) {
						if ( dialog.fieldLayouts[ field.name ].isVisible() ) {
							var rawVal = dialog.widgets[ field.name ].getValue();
							formData[ field.name ] = Array.isArray( rawVal ) ? rawVal.join( ', ' ) : ( rawVal || '' );
						} else {
							formData[ field.name ] = '';
						}
					} );

					var urlParams = {};
					$form.find( 'input, select, textarea' ).each( function () {
						var name = $( this ).attr( 'name' );
						var val = $( this ).val();
						if ( name && val !== undefined && val !== '' && name !== 'fulltext' ) {
							urlParams[ name ] = val;
						}
					} );

					var paramOrder = config.preloadParams || config.fields.map( function ( f ) { return f.name; } );

					var prefix = config.rawParams.prefix || urlParams.prefix || '';
					var rawTargetPage = config.rawParams.page || urlParams.page || urlParams.title || getParamValue( paramOrder[0], 0, formData, config.fields ) || 'Nouvelle page';
					var targetPage = processMagicWords( rawTargetPage );
					targetPage = replaceVariables( targetPage, paramOrder, formData, config.fields );

					if ( prefix && targetPage.indexOf( prefix ) !== 0 ) {
						targetPage = prefix + targetPage;
					}

					if ( /\{\{|\}\}/.test( targetPage ) ) {
						return $.Deferred().reject( new OO.ui.Error(
							'Le titre de page généré contient des accolades non résolues : ' + targetPage +
							'. Vérifiez le paramètre "page=" de la configuration <inputbox>.'
						) );
					}

					var defaultTitleRaw = config.rawParams.default || '';
					var sectionTitle = processMagicWords( defaultTitleRaw );
					sectionTitle = replaceVariables( sectionTitle, paramOrder, formData, config.fields );
					sectionTitle = sectionTitle.replace( /[\r\n]+/g, ' ' ).trim();
					if ( sectionTitle.length > 80 ) {
						sectionTitle = sectionTitle.substring( 0, 77 ) + '...';
					}

					var editSummary = processMagicWords( config.rawParams.summary );
					editSummary = replaceVariables( editSummary, paramOrder, formData, config.fields );

					var preloadTemplate = config.preload || config.rawParams.preload || '';

					if ( config.skipEdit ) {
						var fetchPreload = $.Deferred();

						if ( preloadTemplate ) {
							api.get( {
								action: 'query',
								prop: 'revisions',
								rvprop: 'content',
								rvslots: 'main',
								titles: preloadTemplate,
								redirects: 1,
								formatversion: 2
							} ).done( function ( res ) {
								var p = res && res.query && res.query.pages && res.query.pages[0];
								fetchPreload.resolve( ( p && p.revisions && p.revisions[0] ) ? p.revisions[0].slots.main.content : '' );
							} ).fail( function () { fetchPreload.resolve( '' ); } );
						} else {
							fetchPreload.resolve( '' );
						}

						return fetchPreload.then( function ( wikitext ) {
							wikitext = wikitext.replace( /<noinclude>[\s\S]*?<\/noinclude>/gi, '' );
							wikitext = wikitext.replace( /<\/?includeonly>/gi, '' );
							wikitext = wikitext.replace( /<!--\s*subst:\s*-->/gi, '' );
							wikitext = wikitext.replace( /\{\{\s*subst:/gi, '{{' );

							wikitext = processMagicWords( wikitext );
							wikitext = replaceVariables( wikitext, paramOrder, formData, config.fields );

							var editData = {
								action: 'edit',
								title: targetPage,
								text: wikitext
							};

							if ( config.rawParams.type === 'commenttitle' || config.rawParams.type === 'comment' ) {
								editData.section = 'new';
								if ( sectionTitle ) {
									editData.sectiontitle = sectionTitle;
								}
							}

							if ( editSummary ) {
								editData.summary = editSummary;
							}

							return api.postWithToken( 'csrf', editData ).then( function () {
								dialog.close();
								window.location.href = mw.util.getUrl( targetPage );
							}, function ( code, data ) {
								var errorMsg = ( data && data.error && data.error.info ) ? data.error.info : code;
								return $.Deferred().reject( new OO.ui.Error( 'Erreur lors de la publication : ' + errorMsg ) );
							} );
						} );
					}

					delete urlParams.title;
					delete urlParams.page;
					delete urlParams.prefix;

					var totalVars = Math.max( paramOrder.length, config.fields.length );
					var preloadParamsList = [];
					for ( var i = 0; i < totalVars; i++ ) {
						var paramKey = paramOrder[ i ] || ( i < config.fields.length ? config.fields[ i ].name : ( i + 1 ).toString() );
						preloadParamsList.push( getParamValue( paramKey, i, formData, config.fields ) );
					}

					var queryParams = $.extend( {}, urlParams, {
						action: 'edit',
						preload: preloadTemplate || undefined,
						'preloadparams[]': preloadParamsList
					} );

					if ( config.rawParams.type === 'commenttitle' || config.rawParams.type === 'comment' ) {
						queryParams.section = 'new';
						if ( sectionTitle ) {
							queryParams.sectiontitle = sectionTitle;
						}
					}

					if ( editSummary ) {
						queryParams.summary = editSummary;
					}

					window.location.href = mw.util.getUrl( targetPage, queryParams );
					dialog.close();
				} );
			}
			return ExtendedDialog.super.prototype.getActionProcess.call( this, action );
		};

		var windowManager = new OO.ui.WindowManager();
		$( 'body' ).append( windowManager.$element );
		var dialog = new ExtendedDialog( { size: 'medium' } );
		windowManager.addWindows( [ dialog ] );
		var openedWindow = windowManager.openWindow( dialog );

		openedWindow.closed.then( function () {
			windowManager.destroy();
		} );
	}

} )( jQuery, mediaWiki );
// </nowiki>
