/**
 * Extended-Inputbox pour Vikidia
 * - Analyse tolérante aux espaces (ex: key = value)
 * - Support des champs checkbox (multiselect) et formatage en liste dans le preload
 * - Support étendu de show-if avec listes/checkboxes et opérateurs conditionnels (& et ,)
 * - Mappage intelligent des variables ($1 à $9) par nom, index ou $N
 * - Construction robuste des URL via mw.util.getUrl (preloadparams[])
 * - Publication directe API (skip-edit=yes) avec substitution wikitext
 * - Alignement UTC et gestion dynamique du contenu via hooks MediaWiki
 */
( function ( $, mw ) {
    'use strict';


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

        mw.loader.using( [ 'oojs-ui-core', 'oojs-ui-widgets', 'mediawiki.util', 'mediawiki.api' ], function () {
            var api = new mw.Api();

            // Texte brut de la page. Nécessaire notamment pour capter la syntaxe
            // {{#tag:inputbox|...}}, qui est évaluée par MediaWiki dès le préprocessing
            // (contrairement à <inputbox>...</inputbox> écrit littéralement, qui reste
            // tel quel jusqu'à la génération finale du HTML). Passer par action=parse
            // aurait déjà "consommé" ce genre de construction avant qu'on puisse la lire.
            api.get( {
                action: 'query',
                prop: 'revisions',
                rvprop: 'content',
                rvslots: 'main',
                titles: mw.config.get( 'wgPageName' ),
                formatversion: 2
            } ).done( function ( data ) {
                var page = data.query.pages[0];
                if ( !page || !page.revisions || !page.revisions[0] ) { return; }

                var wikitext = page.revisions[0].slots.main.content;

                // Deux syntaxes possibles pour un inputbox :
                // 1) <inputbox> ... </inputbox>  (tag littéral)
                // 2) {{#tag:inputbox| ... }}      (fonction parseur, contenu unique,
                //    peut contenir des mots magiques comme {{CURRENTYEAR}} à l'intérieur)
                var inputboxRegex = /<inputbox>([\s\S]*?)<\/inputbox>/gi;
                var tagFuncRegex = /\{\{#tag:inputbox\s*\|((?:[^{}]|\{\{[^{}]*\}\})*)\}\}/gi;

                var rawMatches = [];
                var match;

                while ( ( match = inputboxRegex.exec( wikitext ) ) !== null ) {
                    rawMatches.push( { index: match.index, content: match[1] } );
                }
                while ( ( match = tagFuncRegex.exec( wikitext ) ) !== null ) {
                    rawMatches.push( { index: match.index, content: match[1] } );
                }

                // Tri par position d'apparition dans le wikitext, pour rester aligné
                // avec l'ordre des formulaires tel qu'ils apparaissent dans la page rendue.
                rawMatches.sort( function ( a, b ) { return a.index - b.index; } );


                var configs = rawMatches.map( function ( m ) {
                    return parseConfig( m.content );
                } );

                if ( configs.length !== $forms.length ) {
                    mw.log.warn( '[Extended-Inputbox] Nombre de formulaires DOM (' + $forms.length + ') et wikitext (' + configs.length + ') incohérent.' );
                }

                $.each( $forms, function ( index, formEl ) {
                    var config = configs[ index ];
                    if ( !config || ( !config.title && !config.fields.length ) ) { return; }

                    var $form = $( formEl );

                    $form.off( 'submit.extendedInputbox' ).on( 'submit.extendedInputbox', function ( e ) {
 
                        e.preventDefault();
                        openExtendedDialog( config, $form, api );
                    } );
                } );
            } ).fail( function ( code, err ) {
                mw.log.error( '[Extended-Inputbox] Erreur API : ' + code, err );
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
            'LOCALMONTH': month,
            'CURRENTMONTH': month,
            'LOCALDAY': day,
            'CURRENTDAY': day,
            'LOCALTIME': timeStr,
            'CURRENTTIME': timeStr,
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

            // Évaluation d'une condition unique type "champ=valeur"
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

                // Si le champ parent est un groupe de cases à cocher (renvoie un tableau)
                if ( Array.isArray( parentVal ) ) {
                    return parentVal.indexOf( targetVal ) !== -1;
                }

                return parentVal === targetVal;
            }

            // Évaluation des expressions complexes avec & (ET) et , (OU)
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
