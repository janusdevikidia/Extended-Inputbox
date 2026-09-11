// <nowiki>
( function ( $, mw ) {
	'use strict';

	/**
	 * Special:FormBuilder
	 *
	 * Workflow :
	 *  1) Construction visuelle d'un bloc <inputbox> (paramètres généraux +
	 *     champs de popup-field), avec génération live du wikitexte.
	 *  2) Chargement du wikitexte d'une page cible via l'API (action=query).
	 *  3) Insertion du wikitexte généré à la position du curseur dans la
	 *     zone d'édition de la page cible.
	 *  4) Prévisualisation (action=parse) et publication (action=edit avec
	 *     jeton CSRF), puis redirection vers la page cible.
	 *
	 * Toute la génération de syntaxe reste un miroir texte du format compris
	 * par ExtendedInputboxConfig::parseSingleConfig (PHP) : toute évolution du
	 * format de <inputbox> côté serveur doit être répercutée ici aussi.
	 */

	var api = new mw.Api();

	// État du formulaire en cours de construction (étape 1).
	var state = {
		general: {
			type: '',
			page: '',
			prefix: '',
			defaultVal: '',
			buttonlabel: '',
			preload: '',
			preloadParams: '',
			summary: '',
			popupTitle: '',
			popupText: '',
			requiredMarker: null, // null = non défini ; chaîne (même vide) = surchargé
			skipEdit: false,
			bgColor: '',
			borderColor: ''
		},
		fields: []
	};

	// État de la page cible (étape 2-4).
	var target = {
		title: null,
		exists: false,
		baseTimestamp: null,
		canEdit: true
	};

	var fieldIdCounter = 0;

	function newFieldId() {
		fieldIdCounter += 1;
		return 'f' + fieldIdCounter;
	}

	/**
	 * Extrait un message d'erreur lisible d'un échec mw.Api, quel que soit
	 * le format (chaîne de code seule, ou objet d'erreur détaillé).
	 */
	function extractApiError( code, data ) {
		if ( data && data.error && data.error.info ) {
			return data.error.info;
		}
		if ( data && data.exception ) {
			return data.exception;
		}
		return code || 'unknown-error';
	}

	// ---------------------------------------------------------------------
	// Génération du wikitexte <inputbox> à partir de l'état courant
	// ---------------------------------------------------------------------

	function sanitizeLineValue( val ) {
		return ( val || '' ).replace( /[\r\n]+/g, ' ' ).trim();
	}

	function buildFieldLine( field ) {
		var parts = [
			sanitizeLineValue( field.name ),
			field.type,
			sanitizeLineValue( field.label ),
			sanitizeLineValue( field.options ),
			sanitizeLineValue( field.showIf ),
			field.required ? 'yes' : ''
		];
		// Retire les segments vides en fin de liste, comme dans les exemples
		// de la documentation (popup-field=nom|type|libellé), tout en
		// conservant les séparateurs vides nécessaires pour atteindre un
		// paramètre plus loin (ex : "|||yes").
		while ( parts.length > 3 && parts[ parts.length - 1 ] === '' ) {
			parts.pop();
		}
		return 'popup-field=' + parts.join( '|' );
	}

	function generateWikitext() {
		var g = state.general;
		var lines = [];

		function pushIf( key, value ) {
			if ( value !== undefined && value !== null && value !== '' ) {
				lines.push( key + '=' + sanitizeLineValue( value ) );
			}
		}

		lines.push( '<inputbox>' );
		pushIf( 'type', g.type );
		pushIf( 'page', g.page );
		pushIf( 'prefix', g.prefix );
		pushIf( 'default', g.defaultVal );
		pushIf( 'buttonlabel', g.buttonlabel );
		pushIf( 'preload', g.preload );
		pushIf( 'preload-params', g.preloadParams );
		pushIf( 'summary', g.summary );
		pushIf( 'popup-title', g.popupTitle );
		pushIf( 'popup-text', g.popupText );
		if ( g.requiredMarker !== null ) {
			lines.push( 'required-marker=' + sanitizeLineValue( g.requiredMarker ) );
		}
		if ( g.skipEdit ) {
			lines.push( 'skip-edit=yes' );
		}
		pushIf( 'button-bgcolor', g.bgColor );
		pushIf( 'button-border-color', g.borderColor );

		state.fields.forEach( function ( field ) {
			if ( !field.name || !field.label ) {
				return;
			}
			lines.push( buildFieldLine( field ) );
		} );

		lines.push( '</inputbox>' );
		return lines.join( '\n' );
	}

	// ---------------------------------------------------------------------
	// UI - Panneau "Construction du formulaire" (étape 1)
	// ---------------------------------------------------------------------

	var FIELD_TYPES = [ 'text', 'textarea', 'select', 'radio', 'checkbox' ];
	var $generatedTextarea;

	function refreshGeneratedWikitext() {
		if ( $generatedTextarea ) {
			$generatedTextarea.val( generateWikitext() );
		}
	}

	function buildGeneralPanel() {
		var g = state.general;

		var typeDropdown = new OO.ui.DropdownInputWidget( {
			options: [
				{ data: '', label: mw.msg( 'extendedinputbox-formbuilder-type-none' ) },
				{ data: 'search', label: mw.msg( 'extendedinputbox-formbuilder-type-search' ) },
				{ data: 'create', label: mw.msg( 'extendedinputbox-formbuilder-type-create' ) },
				{ data: 'comment', label: mw.msg( 'extendedinputbox-formbuilder-type-comment' ) },
				{ data: 'move', label: mw.msg( 'extendedinputbox-formbuilder-type-move' ) }
			],
			value: g.type
		} ).on( 'change', function ( val ) {
			g.type = val;
			refreshGeneratedWikitext();
		} );

		function textField( key, msgKey, multiline ) {
			var Ctor = multiline ? OO.ui.MultilineTextInputWidget : OO.ui.TextInputWidget;
			var widget = new Ctor( { value: g[ key ], autosize: !!multiline } );
			widget.on( 'change', function ( val ) {
				g[ key ] = val;
				refreshGeneratedWikitext();
			} );
			return new OO.ui.FieldLayout( widget, {
				label: mw.msg( msgKey ),
				align: 'top'
			} );
		}

		var skipEditCheckbox = new OO.ui.CheckboxInputWidget( { selected: g.skipEdit } )
			.on( 'change', function ( checked ) {
				g.skipEdit = checked;
				refreshGeneratedWikitext();
			} );

		var hideMarkerCheckbox = new OO.ui.CheckboxInputWidget( { selected: false } );
		var markerInput = new OO.ui.TextInputWidget( { value: '', placeholder: '(obligatoire)' } )
			.on( 'change', function ( val ) {
				g.requiredMarker = hideMarkerCheckbox.isSelected() ? '' : ( val || null );
				refreshGeneratedWikitext();
			} );
		hideMarkerCheckbox.on( 'change', function ( checked ) {
			markerInput.setDisabled( checked );
			g.requiredMarker = checked ? '' : ( markerInput.getValue() || null );
			refreshGeneratedWikitext();
		} );

		var $grid = $( '<div>' ).addClass( 'eib-fb-general-grid' );
		[
			new OO.ui.FieldLayout( typeDropdown, { label: mw.msg( 'extendedinputbox-formbuilder-field-type' ), align: 'top' } ),
			textField( 'page', 'extendedinputbox-formbuilder-field-page' ),
			textField( 'prefix', 'extendedinputbox-formbuilder-field-prefix' ),
			textField( 'defaultVal', 'extendedinputbox-formbuilder-field-default' ),
			textField( 'buttonlabel', 'extendedinputbox-formbuilder-field-buttonlabel' ),
			textField( 'preload', 'extendedinputbox-formbuilder-field-preload' ),
			textField( 'preloadParams', 'extendedinputbox-formbuilder-field-preloadparams' ),
			textField( 'summary', 'extendedinputbox-formbuilder-field-summary' ),
			textField( 'popupTitle', 'extendedinputbox-formbuilder-field-popuptitle' ),
			textField( 'popupText', 'extendedinputbox-formbuilder-field-popuptext', true ),
			textField( 'bgColor', 'extendedinputbox-formbuilder-field-bgcolor' ),
			textField( 'borderColor', 'extendedinputbox-formbuilder-field-bordercolor' )
		].forEach( function ( layout ) {
			$grid.append( layout.$element );
		} );

		$grid.append(
			new OO.ui.FieldLayout( skipEditCheckbox, {
				label: mw.msg( 'extendedinputbox-formbuilder-field-skipedit' ),
				align: 'inline'
			} ).$element
		);

		var $markerRow = $( '<div>' ).addClass( 'eib-fb-marker-row' ).append(
			new OO.ui.FieldLayout( markerInput, {
				label: mw.msg( 'extendedinputbox-formbuilder-field-requiredmarker' ),
				align: 'top'
			} ).$element,
			$( '<label>' ).append( hideMarkerCheckbox.$element, ' ' + mw.msg( 'extendedinputbox-formbuilder-field-hidemarker' ) )
		);
		$grid.append( $markerRow );

		return $( '<div>' ).append(
			$( '<h3>' ).text( mw.msg( 'extendedinputbox-formbuilder-section-general' ) ),
			$grid
		);
	}

	function buildFieldRow( field, $list ) {
		var $row = $( '<div>' )
			.addClass( 'eib-fb-field-row' )
			.attr( { draggable: true, 'data-field-id': field.id } );

		var $handle = $( '<span>' ).addClass( 'eib-fb-drag-handle' ).text( '⠿' )
			.attr( 'title', mw.msg( 'extendedinputbox-formbuilder-drag-hint' ) );

		var nameInput = new OO.ui.TextInputWidget( { value: field.name, placeholder: mw.msg( 'extendedinputbox-formbuilder-field-row-name' ) } )
			.on( 'change', function ( val ) { field.name = val; refreshGeneratedWikitext(); } );

		var typeDropdown = new OO.ui.DropdownInputWidget( {
			options: FIELD_TYPES.map( function ( t ) {
				return { data: t, label: mw.msg( 'extendedinputbox-formbuilder-field-type-' + t ) };
			} ),
			value: field.type
		} ).on( 'change', function ( val ) { field.type = val; refreshGeneratedWikitext(); } );

		var labelInput = new OO.ui.TextInputWidget( { value: field.label, placeholder: mw.msg( 'extendedinputbox-formbuilder-field-row-label' ) } )
			.on( 'change', function ( val ) { field.label = val; refreshGeneratedWikitext(); } );

		var optionsInput = new OO.ui.TextInputWidget( { value: field.options, placeholder: mw.msg( 'extendedinputbox-formbuilder-field-row-options' ) } )
			.on( 'change', function ( val ) { field.options = val; refreshGeneratedWikitext(); } );

		var showIfInput = new OO.ui.TextInputWidget( { value: field.showIf, placeholder: mw.msg( 'extendedinputbox-formbuilder-field-row-showif' ) } )
			.on( 'change', function ( val ) { field.showIf = val; refreshGeneratedWikitext(); } );

		var requiredCheckbox = new OO.ui.CheckboxInputWidget( { selected: field.required } )
			.on( 'change', function ( checked ) { field.required = checked; refreshGeneratedWikitext(); } );

		var removeBtn = new OO.ui.ButtonWidget( {
			label: mw.msg( 'extendedinputbox-formbuilder-btn-removefield' ),
			flags: [ 'destructive' ],
			framed: false
		} ).on( 'click', function () {
			state.fields = state.fields.filter( function ( f ) { return f.id !== field.id; } );
			renderFieldsList( $list );
		} );

		var upBtn = new OO.ui.ButtonWidget( { label: mw.msg( 'extendedinputbox-formbuilder-btn-moveup' ), framed: false } )
			.on( 'click', function () { moveField( field.id, -1, $list ); } );
		var downBtn = new OO.ui.ButtonWidget( { label: mw.msg( 'extendedinputbox-formbuilder-btn-movedown' ), framed: false } )
			.on( 'click', function () { moveField( field.id, 1, $list ); } );

		$row.append(
			$handle,
			$( '<div>' ).addClass( 'eib-fb-field-widget-small' ).append( nameInput.$element ),
			$( '<div>' ).addClass( 'eib-fb-field-widget-small' ).append( typeDropdown.$element ),
			$( '<div>' ).addClass( 'eib-fb-field-widget' ).append( labelInput.$element ),
			$( '<div>' ).addClass( 'eib-fb-field-widget' ).append( optionsInput.$element ),
			$( '<div>' ).addClass( 'eib-fb-field-widget' ).append( showIfInput.$element ),
			$( '<label>' ).append( requiredCheckbox.$element, ' ' + mw.msg( 'extendedinputbox-formbuilder-field-row-required' ) ),
			$( '<div>' ).addClass( 'eib-fb-field-actions' ).append( upBtn.$element, downBtn.$element, removeBtn.$element )
		);

		bindDragEvents( $row, $list );

		return $row;
	}

	// Glisser-déposer natif (HTML5 draggable) : évite une dépendance
	// supplémentaire à jquery.ui pour un besoin aussi simple que réordonner
	// une liste verticale de lignes. Les boutons "monter/descendre" restent
	// disponibles comme alternative accessible (clavier, lecteurs d'écran).
	function bindDragEvents( $row, $list ) {
		var dragSrcId = null;

		$row.on( 'dragstart', function ( e ) {
			dragSrcId = $row.attr( 'data-field-id' );
			e.originalEvent.dataTransfer.effectAllowed = 'move';
			e.originalEvent.dataTransfer.setData( 'text/plain', dragSrcId );
			$row.addClass( 'eib-fb-dragging' );
		} );
		$row.on( 'dragend', function () {
			$row.removeClass( 'eib-fb-dragging' );
			$list.find( '.eib-fb-field-row' ).removeClass( 'eib-fb-dragover' );
		} );
		$row.on( 'dragover', function ( e ) {
			e.preventDefault();
			e.originalEvent.dataTransfer.dropEffect = 'move';
			$row.addClass( 'eib-fb-dragover' );
		} );
		$row.on( 'dragleave', function () {
			$row.removeClass( 'eib-fb-dragover' );
		} );
		$row.on( 'drop', function ( e ) {
			e.preventDefault();
			var targetId = $row.attr( 'data-field-id' );
			var srcId = e.originalEvent.dataTransfer.getData( 'text/plain' );
			if ( srcId && srcId !== targetId ) {
				reorderFields( srcId, targetId );
				renderFieldsList( $list );
			}
		} );
	}

	function reorderFields( srcId, targetId ) {
		var srcIndex = state.fields.findIndex( function ( f ) { return f.id === srcId; } );
		var targetIndex = state.fields.findIndex( function ( f ) { return f.id === targetId; } );
		if ( srcIndex === -1 || targetIndex === -1 ) {
			return;
		}
		var moved = state.fields.splice( srcIndex, 1 )[ 0 ];
		state.fields.splice( targetIndex, 0, moved );
	}

	function moveField( id, delta, $list ) {
		var index = state.fields.findIndex( function ( f ) { return f.id === id; } );
		var newIndex = index + delta;
		if ( index === -1 || newIndex < 0 || newIndex >= state.fields.length ) {
			return;
		}
		var moved = state.fields.splice( index, 1 )[ 0 ];
		state.fields.splice( newIndex, 0, moved );
		renderFieldsList( $list );
	}

	function renderFieldsList( $list ) {
		$list.empty();
		if ( !state.fields.length ) {
			$list.append( $( '<div>' ).addClass( 'eib-fb-empty-fields' ).text( mw.msg( 'extendedinputbox-formbuilder-no-fields' ) ) );
		}
		state.fields.forEach( function ( field ) {
			$list.append( buildFieldRow( field, $list ) );
		} );
		refreshGeneratedWikitext();
	}

	function buildFieldsPanel() {
		var $list = $( '<div>' ).addClass( 'eib-fb-fields-list' );

		var addBtn = new OO.ui.ButtonWidget( {
			label: mw.msg( 'extendedinputbox-formbuilder-btn-addfield' ),
			icon: 'add',
			flags: [ 'progressive' ]
		} ).on( 'click', function () {
			state.fields.push( {
				id: newFieldId(),
				name: '',
				type: 'text',
				label: '',
				options: '',
				showIf: '',
				required: false
			} );
			renderFieldsList( $list );
		} );

		renderFieldsList( $list );

		return $( '<div>' ).append(
			$( '<h3>' ).text( mw.msg( 'extendedinputbox-formbuilder-section-fields' ) ),
			$list,
			addBtn.$element
		);
	}

	function buildPreviewPanel() {
		$generatedTextarea = $( '<textarea>' )
			.addClass( 'eib-fb-generated-wikitext' )
			.attr( 'readonly', true );
		refreshGeneratedWikitext();

		return $( '<div>' ).append(
			$( '<h3>' ).text( mw.msg( 'extendedinputbox-formbuilder-generated-label' ) ),
			$generatedTextarea
		);
	}

	// ---------------------------------------------------------------------
	// UI - Panneau "Page cible" (étapes 2 à 4)
	// ---------------------------------------------------------------------

	var $targetTextarea;
	var $noticeArea;
	var $previewBox;
	var $statusSpan;

	function showNotice( message, isError ) {
		if ( !$noticeArea ) {
			return;
		}
		$noticeArea.empty();
		var widget = new OO.ui.MessageWidget( {
			type: isError ? 'error' : 'success',
			label: message
		} );
		$noticeArea.append( widget.$element );
	}

	function clearNotice() {
		if ( $noticeArea ) {
			$noticeArea.empty();
		}
	}

	function setStatus( text, isError ) {
		if ( !$statusSpan ) {
			return;
		}
		$statusSpan.text( text || '' ).toggleClass( 'eib-fb-status-error', !!isError );
	}

	/**
	 * Point d'extension volontairement no-op : si l'extension CodeMirror
	 * (module "ext.CodeMirror.v6" ou équivalent) est installée et activée
	 * sur le wiki, on pourrait l'attacher ici à la textarea pour bénéficier
	 * de la coloration syntaxique wikitexte. On ne le fait pas par défaut
	 * pour ne pas dépendre d'une API interne non stabilisée entre versions
	 * de CodeMirror ; la textarea native reste pleinement fonctionnelle
	 * (position du curseur, sélection, insertion) dans tous les cas.
	 *
	 * @param {jQuery} $textarea
	 */
	function tryEnhanceWithCodeMirror( $textarea ) {
		if ( mw.loader.getState( 'ext.CodeMirror.v6.WikiEditor' ) === null &&
			mw.loader.getState( 'ext.CodeMirror.v6' ) === null
		) {
			return;
		}
		// Non implémenté volontairement (voir commentaire ci-dessus) : la
		// textarea brute reste la source de vérité utilisée par
		// insertHere()/previewHere()/publishPage().
	}

	function loadPage() {
		var title = $.trim( targetTitleWidget.getValue() );
		if ( !title ) {
			showNotice( mw.msg( 'extendedinputbox-formbuilder-error-notitle' ), true );
			return;
		}

		clearNotice();
		setStatus( '' );
		loadBtn.setDisabled( true );

		api.get( {
			action: 'query',
			prop: 'revisions|info',
			rvprop: 'content|timestamp',
			rvslots: 'main',
			intestactions: 'edit',
			titles: title,
			redirects: 1,
			formatversion: 2
		} ).done( function ( res ) {
			var page = res && res.query && res.query.pages && res.query.pages[ 0 ];
			if ( !page ) {
				showNotice( mw.msg( 'extendedinputbox-formbuilder-error-load', title ), true );
				return;
			}

			target.title = page.title;
			target.exists = !page.missing;
			target.baseTimestamp = ( !page.missing && page.revisions && page.revisions[ 0 ] ) ?
				page.revisions[ 0 ].timestamp : null;

			var actions = page.actions || {};
			target.canEdit = !actions.edit || actions.edit.length === 0;

			if ( page.missing ) {
				$targetTextarea.val( '' );
				showNotice( mw.msg( 'extendedinputbox-formbuilder-notice-newpage' ), false );
			} else {
				var content = page.revisions && page.revisions[ 0 ] && page.revisions[ 0 ].slots &&
					page.revisions[ 0 ].slots.main ? page.revisions[ 0 ].slots.main.content : '';
				$targetTextarea.val( content );
				if ( !target.canEdit ) {
					showNotice( mw.msg( 'extendedinputbox-formbuilder-error-noedit' ), true );
				} else {
					showNotice( mw.msg( 'extendedinputbox-formbuilder-notice-loaded' ), false );
				}
			}

			$previewBox.empty();
		} ).fail( function ( code, data ) {
			showNotice( mw.msg( 'extendedinputbox-formbuilder-error-load', extractApiError( code, data ) ), true );
		} ).always( function () {
			loadBtn.setDisabled( false );
		} );
	}

	function insertHere() {
		if ( target.title === null ) {
			showNotice( mw.msg( 'extendedinputbox-formbuilder-error-noinsert' ), true );
			return;
		}

		var ta = $targetTextarea[ 0 ];
		var insertion = generateWikitext();
		var start = typeof ta.selectionStart === 'number' ? ta.selectionStart : ta.value.length;
		var end = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : ta.value.length;
		var value = ta.value;

		// Encadre l'insertion d'un saut de ligne si elle n'est pas déjà en
		// début/fin de ligne, pour éviter de souder le bloc <inputbox> au
		// texte existant.
		var before = value.substring( 0, start );
		var after = value.substring( end );
		var prefix = ( before.length && !/\n$/.test( before ) ) ? '\n' : '';
		var suffix = ( after.length && !/^\n/.test( after ) ) ? '\n' : '';
		var toInsert = prefix + insertion + suffix;

		ta.value = before + toInsert + after;

		var newPos = ( before + toInsert ).length;
		ta.focus();
		ta.setSelectionRange( newPos, newPos );

		showNotice( mw.msg( 'extendedinputbox-formbuilder-notice-inserted' ), false );
	}

	function previewHere() {
		if ( target.title === null ) {
			showNotice( mw.msg( 'extendedinputbox-formbuilder-error-noinsert' ), true );
			return;
		}

		clearNotice();
		setStatus( '' );
		previewBtn.setDisabled( true );
		$previewBox.empty().append( $( '<em>' ).text( mw.msg( 'extendedinputbox-formbuilder-preview-loading' ) ) );

		api.post( {
			action: 'parse',
			title: target.title,
			text: $targetTextarea.val(),
			pst: 1,
			disablelimitreport: 1,
			prop: 'text',
			formatversion: 2
		} ).done( function ( res ) {
			var html = res && res.parse && res.parse.text;
			$previewBox.empty();
			if ( html ) {
				$previewBox.append( $.parseHTML( html ) );
			}
		} ).fail( function ( code, data ) {
			$previewBox.empty();
			showNotice( mw.msg( 'extendedinputbox-formbuilder-error-preview', extractApiError( code, data ) ), true );
		} ).always( function () {
			previewBtn.setDisabled( false );
		} );
	}

	function doPublish() {
		var editData = {
			action: 'edit',
			title: target.title,
			text: $targetTextarea.val(),
			summary: state.general.summary || mw.msg( 'extendedinputbox-formbuilder-summary-default' )
		};
		if ( target.baseTimestamp ) {
			editData.basetimestamp = target.baseTimestamp;
		}

		publishBtn.setDisabled( true );

		api.postWithToken( 'csrf', editData ).done( function ( res ) {
			if ( res && res.edit && res.edit.result === 'Success' ) {
				showNotice( mw.msg( 'extendedinputbox-formbuilder-notice-published' ), false );
				setTimeout( function () {
					window.location.href = mw.util.getUrl( target.title );
				}, 800 );
			} else {
				showNotice( mw.msg( 'extendedinputbox-formbuilder-error-publish', 'unknown' ), true );
				publishBtn.setDisabled( false );
			}
		} ).fail( function ( code, data ) {
			var msg;
			if ( code === 'permissiondenied' || code === 'protectedpage' || code === 'cantcreate' ||
				code === 'blocked' || code === 'readonly'
			) {
				msg = mw.msg( 'extendedinputbox-formbuilder-error-noedit' );
			} else if ( code === 'editconflict' ) {
				msg = mw.msg( 'extendedinputbox-formbuilder-error-publish', code );
			} else {
				msg = mw.msg( 'extendedinputbox-formbuilder-error-publish', extractApiError( code, data ) );
			}
			showNotice( msg, true );
			publishBtn.setDisabled( false );
		} );
	}

	function publishPage() {
		if ( target.title === null ) {
			showNotice( mw.msg( 'extendedinputbox-formbuilder-error-noinsert' ), true );
			return;
		}
		if ( target.canEdit === false ) {
			showNotice( mw.msg( 'extendedinputbox-formbuilder-error-noedit' ), true );
			return;
		}

		clearNotice();

		if ( target.exists ) {
			OO.ui.confirm( mw.msg( 'extendedinputbox-formbuilder-confirm-overwrite' ) ).done( function ( confirmed ) {
				if ( confirmed ) {
					doPublish();
				}
			} );
		} else {
			doPublish();
		}
	}

	var targetTitleWidget, loadBtn, previewBtn, publishBtn;

	function buildTargetPanel() {
		targetTitleWidget = new mw.widgets.TitleInputWidget( {
			placeholder: mw.msg( 'extendedinputbox-formbuilder-field-target-title' ),
			showMissing: true,
			value: mw.config.get( 'extendedInputboxFormBuilderTarget' ) || ''
		} );

		loadBtn = new OO.ui.ButtonWidget( {
			label: mw.msg( 'extendedinputbox-formbuilder-btn-load' ),
			flags: [ 'progressive' ]
		} ).on( 'click', loadPage );

		var $titleRow = $( '<div>' ).addClass( 'eib-fb-toolbar' ).append(
			targetTitleWidget.$element,
			loadBtn.$element
		);

		$targetTextarea = $( '<textarea>' ).addClass( 'eib-fb-target-textarea' )
			.attr( 'placeholder', mw.msg( 'extendedinputbox-formbuilder-wikitext-label' ) );
		tryEnhanceWithCodeMirror( $targetTextarea );

		var insertBtn = new OO.ui.ButtonWidget( {
			label: mw.msg( 'extendedinputbox-formbuilder-btn-insert' ),
			icon: 'insert',
			flags: [ 'progressive' ]
		} ).on( 'click', insertHere );

		previewBtn = new OO.ui.ButtonWidget( {
			label: mw.msg( 'extendedinputbox-formbuilder-btn-preview' )
		} ).on( 'click', previewHere );

		publishBtn = new OO.ui.ButtonWidget( {
			label: mw.msg( 'extendedinputbox-formbuilder-btn-publish' ),
			flags: [ 'primary', 'progressive' ]
		} ).on( 'click', publishPage );

		var $actionRow = $( '<div>' ).addClass( 'eib-fb-toolbar' ).append(
			insertBtn.$element, previewBtn.$element, publishBtn.$element
		);

		$noticeArea = $( '<div>' ).addClass( 'eib-fb-notice' );
		$previewBox = $( '<div>' ).addClass( 'eib-fb-preview-box' );

		return $( '<div>' ).append(
			$( '<h3>' ).text( mw.msg( 'extendedinputbox-formbuilder-section-target' ) ),
			$titleRow,
			$noticeArea,
			$targetTextarea,
			$actionRow,
			$( '<h4>' ).text( mw.msg( 'extendedinputbox-formbuilder-preview-label' ) ),
			$previewBox
		);
	}

	// ---------------------------------------------------------------------
	// Assemblage
	// ---------------------------------------------------------------------

	function init() {
		var $root = $( '#eib-formbuilder-root' );
		if ( !$root.length ) {
			return;
		}

		var $intro = $( '<p>' ).text( mw.msg( 'extendedinputbox-formbuilder-intro' ) );

		var $left = $( '<div>' ).addClass( 'eib-fb-column' ).append(
			$( '<div>' ).addClass( 'eib-fb-panel' ).append( buildGeneralPanel() ),
			$( '<div>' ).addClass( 'eib-fb-panel' ).append( buildFieldsPanel() ),
			$( '<div>' ).addClass( 'eib-fb-panel' ).append( buildPreviewPanel() )
		);

		var $right = $( '<div>' ).addClass( 'eib-fb-column' ).append(
			$( '<div>' ).addClass( 'eib-fb-panel' ).append( buildTargetPanel() )
		);

		$root.append(
			$intro,
			$( '<div>' ).addClass( 'eib-fb' ).append( $left, $right )
		);

		var initialTarget = mw.config.get( 'extendedInputboxFormBuilderTarget' );
		if ( initialTarget ) {
			loadPage();
		}
	}

	$( init );

}( jQuery, mediaWiki ) );
// </nowiki>
