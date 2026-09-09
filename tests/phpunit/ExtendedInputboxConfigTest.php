<?php

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../includes/ExtendedInputboxConfig.php';

/**
 * Tests sans dépendance MediaWiki : ils couvrent les règles de parsing qui
 * doivent rester identiques entre le rendu initial côté serveur et le fallback.
 */
class ExtendedInputboxConfigTest extends TestCase {

	/**
	 * @dataProvider provideCssColors
	 */
	public function testCssColorValidation( $value, $expected ) {
		$this->assertSame( $expected, ExtendedInputboxConfig::isValidCssColor( $value ) );
	}

	public function provideCssColors() {
		return [
			'keyword' => [ 'rebeccapurple', true ],
			'case-insensitive keyword' => [ 'LightSlateGrey', true ],
			'special keyword' => [ 'currentColor', true ],
			'hex RGB' => [ '#36c', true ],
			'hex RGBA' => [ '#3366cc80', true ],
			'valid RGB' => [ 'rgb(51, 102, 204)', true ],
			'valid HSL' => [ 'hsla(220, 60%, 50%, 50%)', true ],
			'unknown keyword' => [ 'not-a-css-colour', false ],
			'invalid hex length' => [ '#12345', false ],
			'out-of-range RGB' => [ 'rgb(256, 0, 0)', false ],
			'mixed RGB units' => [ 'rgb(10%, 0, 0)', false ],
			'out-of-range alpha' => [ 'rgba(0, 0, 0, 1.1)', false ],
		];
	}

	public function testExtractConfigsParsesFieldsAndIgnoresNonRenderedInputboxes() {
		$configs = ExtendedInputboxConfig::extractConfigs( <<<'WIKITEXT'
<!-- <inputbox>button-bgcolor=red</inputbox> -->
<nowiki><inputbox>button-bgcolor=blue</inputbox></nowiki>
<inputbox>
popup-title=Créer une fiche
required-marker=(requis)
popup-field=titre|text|Titre|||||yes|Exemple|80|3|Aide
popup-field=type|select|Type|Article,Brouillon
button-bgcolor=rebeccapurple
</inputbox>
WIKITEXT
);

		$this->assertCount( 1, $configs );
		$config = $configs[0];
		$this->assertSame( 'Créer une fiche', $config['title'] );
		$this->assertSame( '(requis)', $config['requiredMarker'] );
		$this->assertSame( 'rebeccapurple', $config['buttonBgColor'] );
		$this->assertCount( 2, $config['fields'] );
		$this->assertTrue( $config['fields'][0]['required'] );
		$this->assertSame( 'Exemple', $config['fields'][0]['placeholder'] );
		$this->assertSame( 80, $config['fields'][0]['maxlength'] );
		$this->assertSame( 3, $config['fields'][0]['minlength'] );
	}

	public function testRequiredMarkerDefaultsToLocalizedMessage() {
		$config = ExtendedInputboxConfig::extractConfigs( "<inputbox>\npopup-field=nom|text|Nom\n</inputbox>" )[0];
		$this->assertNull( $config['requiredMarker'] );
	}
}
