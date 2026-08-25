// <nowiki>
( function ( $, mw ) {
    'use strict';

    // On relance la même logique qu'à l'origine (mw.loader.using + query + expandtemplates),
    // mais on la déclenche immédiatement au chargement du script au lieu d'attendre le hook
    // 'wikipage.content' (DOM prêt). Le résultat est stocké dans un Deferred partagé : quel que
    // soit le moment où le DOM devient prêt, on récupère ce même Deferred au lieu de relancer
    // les requêtes.
    var configsDeferred = $.Deferred();

    mw.loader.using( [ 'oojs-ui-core', 'oojs-ui-widgets', 'mediawiki.util', 'mediawiki.api' ], function () {
        var api = new mw.Api();

        // 1. Récupération du wikitext brut de la page actuelle
        api.get( {
            action: 'query',
            prop: 'revisions',
            rvprop: 'content',
            rvslots: 'main',
            titles: mw.config.get( 'wgPageName' ),
            formatversion: 2
        } ).then( function ( data ) {
            var page = data && data.query && data.query.pages && data.query.pages[0];
            if ( !page || !page.revisions || !page.revisions[0] ) {
                return $.Deferred().reject( 'no-revision' );
            }
            var rawWikitext = page.revisions[0].slots.main.content;

            // 2. Déploiement récursif de tous les modèles (y compris les modèles imbriqués)
            return api.post( {
                action: 'expandtemplates',
                title: mw.config.get( 'wgPageName' ),
                text: rawWikitext,
                prop: 'wikitext',
                formatversion: 2
            } );
        } ).done( function ( expData ) {
            if ( !expData || !expData.expandtemplates || !expData.expandtemplates.wikitext ) {
                mw.log.warn( '[Extended-Inputbox] Réponse expandtemplates vide ou invalide.' );
                configsDeferred.resolve( [], api );
                return;
            }

            var wikitext = expData.expandtemplates.wikitext;
            var inputboxRegex = /<inputbox>([\s\S]*?)<\/inputbox>/gi;
            var configs = [];
            var match;

            while ( ( match = inputboxRegex.exec( wikitext ) ) !== null ) {
                configs.push( parseConfig( match[1] ) );
            }

            configsDeferred.resolve( configs, api );
        } ).fail( function ( code, data ) {
            // En cas d'échec (page introuvable, erreur API...), on ne bloque rien : les
            // formulaires resteront de simples inputbox standards. On journalise pour diagnostic.
            mw.log.warn( '[Extended-Inputbox] Échec de récupération/expansion du wikitext :', code, data );
            configsDeferred.resolve( [], api );
        } );
    } );

    // Hook standard MediaWiki pour gérer le chargement initial et dynamique (AJAX/prévisualisation)
    mw.hook( 'wikipage.content' ).add( function ( $content ) {
        var $forms = [];
        $content.find( '.mw-inputbox-centered, .mw-inputbox-container, form.createbox' ).each( function () {
            var $f = $( this ).is( 'form' ) ? $( this ) : $( this ).find( 'form' );
            if ( $f.length && $forms.indexOf( $f[0] ) === -1 ) {
                $forms.push( $f[0] );
            }
        } );

        if ( !$forms.length ) { return; }

        // On attache tout de suite les gestionnaires de soumission, sans griser les boutons :
        // le clic est intercepté immédiatement (preventDefault) puis mis en attente le temps
        // que la configuration (déjà en cours de chargement) soit disponible. Dans l'immense
        // majorité des cas, elle l'est déjà au moment où l'utilisateur clique.
        $.each( $forms, function ( index, formEl ) {
            var $form = $( formEl );

            $form.off( 'submit.extendedInputbox' ).on( 'submit.extendedInputbox', function ( e ) {
                e.preventDefault();

                configsDeferred.done( function ( configs, api ) {
                    if ( configs.length !== $forms.length ) {
                        mw.log.warn( '[Extended-Inputbox] Nombre de formulaires DOM (' + $forms.length + ') et wikitext (' + configs.length + ') incohérent.' );
                    }

                    var config = configs[ index ];
                    if ( !config || ( !config.title && !config.fields.length ) ) {
                        // Pas de configuration exploitable pour ce formulaire : on le laisse
                        // partir normalement, comme un inputbox standard.
                        mw.log.warn( '[Extended-Inputbox] Aucune configuration exploitable pour le formulaire n°' + index + '.' );
                        $form.off( 'submit.extendedInputbox' );
                        formEl.submit();
                        return;
                    }

                    openExtendedDialog( config, $form, api );
                } );
            } );
        } );
    } );

    function parseConfig( rawText ) {
        var config = { fields: [], rawParams: {} };
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
            } else if ( key === 'popup-preload' || key === 'preload' ) {
                config.preload = val;
            } else if ( key === 'popup-title' ) {
                config.title = val;
            } else if ( key === 'popup-text' ) {
                config.text = val;
            } else if ( key === 'popup-skip-edit' || key === 'skip-edit' ) {
                config.skipEdit = ( val.toLowerCase() === 'yes' );
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

        var timestamp = year + month + day + hours + minutes + seconds;
        var timeStr = hours + ':' + minutes;
        var userName = mw.config.get( 'wgUserName' ) || 'Anonyme';
        var pageName = mw.config.get( 'wgPageName' ) || '';

        var magicMap = {
            'LOCALTIMESTAMP': timestamp,
            'CURRENTTIMESTAMP': timestamp,
            'LOCALYEAR': year,
            'CURRENTYEAR': year,
< truncated lines 176-338 >

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
                            if ( Array.isArray( rawVal ) ) {
                                formData[ field.name ] = rawVal.join( ', ' );
                            } else {
                                formData[ field.name ] = rawVal || '';
                            }
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

                    var rawTargetPage = config.rawParams.page || urlParams.page || urlParams.title || getParamValue( paramOrder[0], 0, formData, config.fields ) || 'Nouvelle page';
                    var targetPage = processMagicWords( rawTargetPage );
                    targetPage = replaceVariables( targetPage, paramOrder, formData, config.fields );

                    var sectionTitle = processMagicWords( config.rawParams.default );
                    sectionTitle = replaceVariables( sectionTitle, paramOrder, formData, config.fields );

                    var editSummary = processMagicWords( config.rawParams.summary );
                    editSummary = replaceVariables( editSummary, paramOrder, formData, config.fields );

                    var preloadTemplate = config.preload || config.rawParams.preload || '';

                    // CAS 1 : PUBLICATION DIRECTE (skip-edit=yes)
                    if ( config.skipEdit ) {
                        dialog.pushPending();

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
                                var p = res.query.pages[0];
                                if ( p && p.revisions && p.revisions[0] ) {
                                    fetchPreload.resolve( p.revisions[0].slots.main.content );
                                } else {
                                    fetchPreload.resolve( '' );
                                }
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
                                editData.sectiontitle = sectionTitle || '';
                            }

                            if ( editSummary ) {
                                editData.summary = editSummary;
                            }

                            return api.postWithToken( 'csrf', editData ).then( function () {
                                dialog.close();
                                window.location.href = mw.util.getUrl( targetPage );
                            }, function ( code, data ) {
                                dialog.popPending();
                                var errorMsg = api.getErrorMessage( data );
                                OO.ui.alert( errorMsg );
                            } );
                        } );
                    }

                    // CAS 2 : REDIRECTION EN PAGE D'ÉDITION (skip-edit=no)
                    delete urlParams.title;
                    delete urlParams.page;

                    var totalVars = Math.max( paramOrder.length, config.fields.length );
                    var preloadParamsList = [];
                    for ( var i = 0; i < totalVars; i++ ) {
                        var paramKey = paramOrder[ i ] || ( i < config.fields.length ? config.fields[ i ].name : ( i + 1 ).toString() );
                        var val = getParamValue( paramKey, i, formData, config.fields );
                        preloadParamsList.push( val );
                    }

                    var queryParams = $.extend( {}, urlParams, {
                        action: 'edit',
                        preload: preloadTemplate || undefined,
                        'preloadparams[]': preloadParamsList
                    } );

                    if ( config.rawParams.type === 'commenttitle' || config.rawParams.type === 'comment' ) {
                        queryParams.section = 'new';
                        queryParams.sectiontitle = sectionTitle || undefined;
                    }

                    if ( editSummary ) {
                        queryParams.summary = editSummary;
                    }

                    var targetUrl = mw.util.getUrl( targetPage, queryParams );
                    window.location.href = targetUrl;
                    dialog.close();
                } );
            }
            return ExtendedDialog.super.prototype.getActionProcess.call( this, action );
        };

        var windowManager = new OO.ui.WindowManager();
        $( 'body' ).append( windowManager.$element );
        var dialog = new ExtendedDialog( { size: 'medium' } );
        windowManager.addWindows( [ dialog ] );
        windowManager.openWindow( dialog );
    }

} )( jQuery, mediaWiki );
// </nowiki>
