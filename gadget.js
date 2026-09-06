// <nowiki>
( function ( $, mw ) {
    'use strict';

    // Instance partagée de l'API, réutilisée pour tous les appels (au lieu
    // d'en recréer une par exécution du hook / par ouverture de dialogue).
    var api = new mw.Api();

    // Cache la configuration extraite du wikitexte pour la page + révision
    // courantes, afin d'éviter de refaire les 2 appels API (query + expandtemplates)
    // à chaque déclenchement du hook 'wikipage.content' (aperçus, previews, etc.)
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
        // En cas d'échec, on invalide le cache pour permettre un nouvel essai plus tard.
        promise.fail( function () {
            if ( configCache && configCache.key === cacheKey ) {
                configCache = null;
            }
        } );

        return promise;
    }

    mw.hook( 'wikipage.content' ).add( function ( $content ) {
        // Le hook 'wikipage.content' se déclenche aussi pour du contenu qui n'est
        // pas la page affichée (aperçus, popups). On ignore ces cas pour éviter
        // d'appliquer la config d'une mauvaise page (mw.config reste celle de la
        // page courante, pas celle du contenu injecté).
        if ( !$content.is( '#mw-content-text' ) && !$content.closest( '#mw-content-text' ).length ) {
            return;
        }

        var $forms = [];
        $content.find( '.mw-inputbox-centered, .mw-inputbox-container, form.createbox' ).each( function () {
            var $f = $( this ).is( 'form' ) ? $( this ) : $( this ).find( 'form' );
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

                $form.off( 'submit.extendedInputbox' ).on( 'submit.extendedInputbox', function ( e ) {
                    e.preventDefault();
                    // Les modules OOUI ne sont chargés qu'au moment où on en a
                    // vraiment besoin (ouverture de la boîte de dialogue), pas
                    // sur chaque page contenant un simple inputbox.
                    mw.loader.using( [ 'oojs-ui-core', 'oojs-ui-widgets', 'oojs-ui-windows', 'mediawiki.util' ], function () {
                        openExtendedDialog( config, $form, api );
                    } );
                } );
            } );
        } ).fail( function ( reason ) {
            mw.log.error( 'ExtendedInputBox: échec de la récupération de la configuration.', reason );
        } );
    } );

    /**
     * Applique un style de bouton façon Codex/OOUI à partir de la config :
     * - button-bgcolor / button-bg          -> couleur de FOND
     * - button-border-color / button-border -> couleur de la BORDURE (2px, transparente par défaut)
     *
     * La couleur du TEXTE n'est volontairement PAS configurable : elle est
     * automatiquement blanche dès qu'un fond est défini, pour garantir un
     * contraste correct et éviter toute confusion fond/texte.
     *
     * Tout est injecté via une seule classe + une règle <style> scoped, plutôt que de
     * patcher le style inline de chaque élément (ce qui provoquait les mélanges de couleurs).
     * Les couleurs sont validées avant injection pour éviter toute injection CSS.
     */
    function applyButtonStyle( $btn, config, index ) {
        if ( !config.buttonBgColor && !config.buttonBorderColor ) {
            return;
        }

        var bg = config.buttonBgColor || '';
        // Le texte est toujours blanc dès qu'un fond est défini ; non configurable.
        var textColor = bg ? '#ffffff' : '';
        var borderColor = config.buttonBorderColor || 'transparent';

        var btnClass = 'extended-inputbox-btn-' + index;
        var styleId = 'extended-inputbox-style-' + index;

        var rules = [];
        if ( bg ) {
            // "background" (et pas seulement "background-color") pour bien écraser
            // le dégradé par défaut des boutons Codex/OOUI.
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
            // Les icônes/spans internes du bouton héritent aussi de la couleur de texte.
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
            // Remplace {{MOT}} indépendamment de ce qui suit (le "\n" obligatoire
            // en fin de motif empêchait le remplacement dans la plupart des cas réels).
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

        // Détruit le WindowManager (et retire son DOM) une fois la boîte de
        // dialogue fermée, quelle qu'en soit la raison, pour éviter d'en
        // accumuler un nouveau à chaque ouverture (annuler/rouvrir, etc.).
        openedWindow.closed.then( function () {
            windowManager.destroy();
        } );
    }

} )( jQuery, mediaWiki );
// </nowiki>
