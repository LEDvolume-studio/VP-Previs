import { expect, it } from 'vitest';
import { isCloudPresetStorage } from '../../../app/src/services/presets/PresetRepository.js';

it( 'uses cloud storage in every production build, including when a local override is requested', () => {

	expect( isCloudPresetStorage( { DEV: false } ) ).toBe( true );
	expect( isCloudPresetStorage( { DEV: false, VITE_PRESET_STORAGE: 'local' } ) ).toBe( true );

} );

it( 'uses local presets for development unless cloud storage is explicitly selected', () => {

	expect( isCloudPresetStorage( { DEV: true } ) ).toBe( false );
	expect( isCloudPresetStorage( { DEV: true, VITE_PRESET_STORAGE: 'cloud' } ) ).toBe( true );

} );
