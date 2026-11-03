import { describe, expect, it, vi } from 'vitest';
import { AdminPlatePlayback } from '../../../app/src/services/plates/AdminPlatePlayback.js';

function fixture() {

	const root = { uuid: 'wall', name: 'Volume', userData: { __rayzeeProjectInstanceId: 'wall-instance' } }, record = { root, video: null };
	const manager = { records: new Map( [[ 'wall', record ]] ), getSnapshot: () => ( { currentTime: record.video?.time || 0 } ),
		choosePlate: vi.fn( async ( id, source, options ) => {

			record.video = { plateSource: source, plateView: options.view, paused: ! options.autoplay, time: options.initialTime }; return true;

		} ),
		setPlateView: vi.fn( async ( id, view ) => {

			record.video.plateView = view;

		} ), clearVideo: vi.fn() };
	const library = { list: async () => [ { ready: true, manifest: { id: 'a', name: 'First' } }, { ready: true, manifest: { id: 'b', name: 'Second' } } ] };
	const session = { current: { projectId: 'project', extensions: {} }, markDirty: vi.fn() }, app = {};
	const openSource = vi.fn( async ( library, manifest ) => ( { manifest, dispose: vi.fn() } ) );
	const controller = new AdminPlatePlayback( { session, app: () => app, manager, library, openSource, plateService: { list: async () => [], ensure: async manifest => ( { manifest, encoding: 'hevc' } ) } } );
	return { controller, session, manager, record, openSource };

}

describe( 'admin preset plate selection', () => {

	it( 'uses any selected set without reopening files when changing direction', async () => {

		const { controller, session, record, openSource, manager } = fixture();
		await controller.refresh(); await controller.selectSet( 'a' ); record.video.time = 42.32;
		await controller.setView( 'left' ); expect( openSource ).toHaveBeenCalledOnce();
		expect( manager.setPlateView ).toHaveBeenCalledWith( 'wall', 'left' ); expect( record.video.time ).toBe( 42.32 );
		await controller.selectSet( 'b' );
		expect( record.video ).toMatchObject( { plateView: 'left', time: 42.32, paused: false, plateSource: { manifest: { id: 'b' } } } );
		expect( session.current.extensions.drivingPlate ).toEqual( { setId: 'b', view: 'left', wallInstanceId: 'wall-instance' } );

	} );

	it( 'allows authoring an angle before a set has been downloaded', async () => {

		const { controller, session, manager } = fixture(); await controller.refresh();
		await controller.setView( 'rear' );
		expect( session.current.extensions.drivingPlate.view ).toBe( 'rear' ); expect( manager.choosePlate ).not.toHaveBeenCalled();
		await controller.selectSet( 'a' ); expect( controller.getSnapshot().view ).toBe( 'rear' );

	} );

	it( 'rejects unavailable sets and invalid views before replacing a playing video', async () => {

		const { controller, manager } = fixture(); await controller.refresh(); await controller.selectSet( 'a' );
		await expect( controller.selectSet( 'missing' ) ).rejects.toThrow( /available/ );
		await expect( controller.setView( 'diagonal' ) ).rejects.toThrow( /Choose/ );
		expect( manager.choosePlate ).toHaveBeenCalledOnce(); expect( controller.getSnapshot().setId ).toBe( 'a' );

	} );

} );
