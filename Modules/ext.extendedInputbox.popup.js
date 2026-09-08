// <nowiki>
( function ( $, mw ) {
	'use strict';

	// Ce module n'est chargé par PHP (ExtendedInputboxHooks::onOutputPageBeforeHTML)
	// que si la page contient au moins une popup. Les configs sont déjà
	// parsées côté serveur et transmises ici, donc plus AUCUN appel API
	// (query + expandtemplates) n'est nécessaire pour le cas normal.
	//
	// L'instance mw.Api() n'est créée qu'à la première utilisation réelle
	// (ouverture d'un dialogue en skip-edit) : une page avec une popup que
	// l'utilisateur n'ouvre jamais ne doit pas instancier l'API pour rien.
	var api = null;
	function getApi() {
		return api || ( api = new mw.Api() );
	}
	var configs = mw.config.get( 'extendedInputboxConfigs' ) || {};

	// Permet au module fallback (contenu dynamique, sans data-eib-index) de
	// déclencher l'ouverture du dialogue après avoir chargé ce module à la demande.
	// Un seul WindowManager est partagé par toutes les ouvertures (voir plus bas),
	// qu'elles proviennent de ce hook ou du binding natif sur wikipage.content.
	mw.hook( 'extendedInputbox.openDialog' ).add( function ( config, $form, apiInstance ) {
		openExtendedDialog( config, $form, apiInstance || getApi() );
	} );

	// $content est l'élément réellement mis à jour par ce déclenchement du hook
	// (pas forcément toute la page) : .find() ci-dessous reste donc scopé à ce
	// sous-arbre et ne reparcourt jamais tout #mw-content-text inutilement.
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
			// maintenant que le binding du dialogue est prêt. Pas d'opacity à
			// restaurer : le blocage ne touche plus qu'aux clics (voir
			// ExtendedInputboxHooks::onBeforePageDisplay).
			$btn.css( { 'pointer-events': 'auto' } );

			$form.off( 'submit.extendedInputbox' ).on( 'submit.extendedInputbox', function ( e ) {
				e.preventDefault();
				openExtendedDialog( config, $form, getApi() );
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
		var userName = mw.config.get( 'wgUserName' ) || mw.msg( 'extendedinputbox-default-username' );
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

	// Options OOUI natives communes aux champs texte libre (text/textarea) :
	// placeholder et maxlength sont supportés directement par TextInputWidget
	// (et donc par MultilineTextInputWidget, qui en hérite). minlength n'a pas
	// d'équivalent natif OOUI : il est vérifié manuellement à la soumission
	// (voir validateFields ci-dessous), tout comme un filet de sécurité pour
	// maxlength/required au cas où l'utilisateur contournerait la saisie
	// (collage, autofill...).
	function textInputExtras( field ) {
		var extras = {};
		if ( field.placeholder ) {
			extras.placeholder = field.placeholder;
		}
		if ( field.maxlength ) {
			extras.maxLength = field.maxlength;
		}
		if ( field.required ) {
			extras.required = true;
		}
		return extras;
	}

	// Valide required/minlength/maxlength pour les champs actuellement visibles
	// (un champ masqué par show-if n'est pas requis, cf. formData[name] = ''
	// pour les champs masqués dans getActionProcess). Retourne le message
	// d'erreur (mw.msg) de la première violation trouvée, ou null si tout est
	// valide.
	function validateFields( config, dialog ) {
		var fields = config.fields;
		for ( var i = 0; i < fields.length; i++ ) {
			var field = fields[ i ];
			var layout = dialog.fieldLayouts[ field.name ];
			if ( !layout || !layout.isVisible() ) { continue; }

			var rawVal = dialog.widgets[ field.name ].getValue();
			var isEmpty = Array.isArray( rawVal ) ? rawVal.length === 0 : !rawVal;
			var strVal = Array.isArray( rawVal ) ? rawVal.join( '' ) : ( rawVal || '' );

			if ( field.required && isEmpty ) {
				return mw.msg( 'extendedinputbox-error-field-required', field.label );
			}
			if ( !isEmpty && field.minlength && strVal.length < field.minlength ) {
				return mw.msg( 'extendedinputbox-error-field-minlength', field.label, field.minlength );
			}
			if ( !isEmpty && field.maxlength && strVal.length > field.maxlength ) {
				return mw.msg( 'extendedinputbox-error-field-maxlength', field.label, field.maxlength );
			}
		}
		return null;
	}

	function openExtendedDialog( config, $form, api ) {
		function ExtendedDialog( config ) {
			ExtendedDialog.super.call( this, config );
		}
		OO.inheritClass( ExtendedDialog, OO.ui.ProcessDialog );

		ExtendedDialog.static.name = 'extendedInputboxDialog';
		ExtendedDialog.static.title = config.title || mw.msg( 'extendedinputbox-default-title' );
		ExtendedDialog.static.actions = [
			{ action: 'save', label: mw.msg( 'extendedinputbox-btn-save' ), flags: [ 'primary', 'progressive' ] },
			{ label: mw.msg( 'extendedinputbox-btn-cancel' ), flags: 'safe' }
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
				// "default" (nouveau) a priorité sur "options" comme valeur initiale ;
				// "options" reste utilisé tel quel pour les listes select/radio/checkbox,
				// et continue de servir de valeur initiale pour text/textarea si aucun
				// "default" explicite n'est fourni (compatibilité ascendante).
				var widget;
				if ( field.type === 'select' ) {
					var opts = field.options.split( ',' ).map( function ( o ) {
						var v = o.trim(); return { data: v, label: v };
					} );
					widget = new OO.ui.DropdownInputWidget( { options: opts, value: field.default || undefined } );
				} else if ( field.type === 'radio' ) {
					var opts = field.options.split( ',' ).map( function ( o ) {
						var v = o.trim(); return { data: v, label: v };
					} );
					widget = new OO.ui.RadioSelectInputWidget( { options: opts, value: field.default || undefined } );
				} else if ( field.type === 'checkbox' || field.type === 'checkboxes' ) {
					var opts = field.options ? field.options.split( ',' ).map( function ( o ) {
						var v = o.trim(); return { data: v, label: v };
					} ) : [];
					var defaultVals = field.default ? field.default.split( ',' ).map( function ( v ) { return v.trim(); } ) : [];
					widget = new OO.ui.CheckboxMultiselectInputWidget( { options: opts, value: defaultVals } );
				} else if ( field.type === 'textarea' ) {
					widget = new OO.ui.MultilineTextInputWidget( $.extend( {
						value: field.default || field.options
					}, textInputExtras( field ) ) );
				} else {
					widget = new OO.ui.TextInputWidget( $.extend( {
						value: field.default || field.options
					}, textInputExtras( field ) ) );
				}

				// "required" est aussi posé sur les autres types de widgets (select,
				// radio, checkbox) quand le champ le supporte nativement (OOUI gère
				// l'attribut requis/aria-required en conséquence pour ces widgets-là
				// aussi), sans effet sur maxlength/minlength/placeholder qui ne
				// concernent que du texte libre.
				if ( field.required && typeof widget.setRequired === 'function' ) {
					widget.setRequired( true );
				}

				var layoutConfig = {
					label: field.required ? field.label + ' ' + mw.msg( 'extendedinputbox-required-marker' ) : field.label,
					align: 'top'
				};
				if ( field.help ) {
					layoutConfig.help = field.help;
					layoutConfig.helpInline = true;
				}
				var layout = new OO.ui.FieldLayout( widget, layoutConfig );

				dialog.widgets[ field.name ] = widget;
				dialog.fieldLayouts[ field.name ] = layout;
				dialog.content.$element.append( layout.$element );
			} );

			// Syntaxe formelle de show-if : "show-if:condition"
			//   condition  := orBranch (',' orBranch)*      -- OR, priorité la plus basse
			//   orBranch   := andCond (('&') andCond)*       -- AND, priorité plus haute
			//   andCond    := champ '=' valeur
			// Exemples :
			//   show-if:type=article                        -- un seul champ
			//   show-if:type=article&niveau=avancé           -- ET (les deux vrais)
			//   show-if:type=article,type=brouillon          -- OU (au moins un vrai)
			// Pour un champ checkbox (valeur = tableau), la condition est vraie si
			// "valeur" fait partie des cases cochées. Un champ masqué (parent avec
			// show-if non satisfait) est toujours considéré comme "faux" dans les
			// conditions qui en dépendent (voir isParentVisible ci-dessous), ce qui
			// permet de chaîner des conditions sur plusieurs niveaux. Les dépendances
			// circulaires entre champs ne sont pas détectées explicitement : la
			// stabilisation à 10 passes (updateAllVisibilities) sert de filet de
			// sécurité, mais un cycle véritable peut ne pas converger vers un état
			// stable en 10 passes ; à éviter dans la configuration <inputbox>.
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

		// NB : OO.ui.ProcessDialog gère nativement l'état de chargement et le
		// verrouillage anti-double-soumission pendant l'exécution d'un
		// OO.ui.Process : Dialog#executeAction appelle pushPending() (qui
		// désactive les actions et affiche un indicateur de progression) avant
		// d'exécuter le process retourné ci-dessous, et popPending() une fois
		// résolu/rejeté. Un second clic sur "Valider" pendant l'appel API
		// (skip-edit) est donc déjà sans effet ; inutile de dupliquer ce
		// verrouillage manuellement ici.
		ExtendedDialog.prototype.getActionProcess = function ( action ) {
			var dialog = this;
			if ( action === 'save' ) {
				return new OO.ui.Process( function () {
					// Validation required/minlength/maxlength AVANT tout traitement
					// (préchargement, magic words, appel API...) : une violation
					// bloque immédiatement la publication et affiche l'erreur dans
					// la popup, sans effet de bord (pas de requête envoyée).
					var validationError = validateFields( config, dialog );
					if ( validationError ) {
						return $.Deferred().reject( new OO.ui.Error( validationError ) );
					}

					var formData = {};
					config.fields.forEach( function ( field ) {
						if ( dialog.fieldLayouts[ field.name ].isVisible() ) {
							var rawVal = dialog.widgets[ field.name ].getValue();
							var separator = field.separator || ', ';
							formData[ field.name ] = Array.isArray( rawVal ) ? rawVal.join( separator ) : ( rawVal || '' );
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
					var rawTargetPage = config.rawParams.page || urlParams.page || urlParams.title || getParamValue( paramOrder[0], 0, formData, config.fields ) || mw.msg( 'extendedinputbox-default-pagename' );
					var targetPage = processMagicWords( rawTargetPage );
					targetPage = replaceVariables( targetPage, paramOrder, formData, config.fields );

					if ( prefix && targetPage.indexOf( prefix ) !== 0 ) {
						targetPage = prefix + targetPage;
					}

					if ( /\{\{|\}\}/.test( targetPage ) ) {
						return $.Deferred().reject( new OO.ui.Error(
							mw.msg( 'extendedinputbox-error-unresolved-title', targetPage )
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
							// Si un preload est configuré, son absence ou l'échec de l'API
							// NE DOIT PAS aboutir à une publication avec un contenu vide :
							// on rejette explicitement pour bloquer la publication et
							// informer l'utilisateur, plutôt que de continuer silencieusement.
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
								var content = ( p && !p.missing && p.revisions && p.revisions[0] ) ?
									p.revisions[0].slots.main.content : null;
								if ( content === null ) {
									fetchPreload.reject();
								} else {
									fetchPreload.resolve( content );
								}
							} ).fail( function () { fetchPreload.reject(); } );
						} else {
							// Pas de preload configuré : un contenu vide est le comportement attendu.
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
								return $.Deferred().reject( new OO.ui.Error( mw.msg( 'extendedinputbox-error-publish', errorMsg ) ) );
							} );
						}, function () {
							// Échec de récupération du preload : on bloque la publication
							// et on affiche l'erreur dans la popup, plutôt que de publier
							// une page vide (voir commentaire plus haut).
							return $.Deferred().reject( new OO.ui.Error( mw.msg( 'extendedinputbox-error-preload-fetch', preloadTemplate ) ) );
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