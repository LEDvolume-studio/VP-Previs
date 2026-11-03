import { getPlateLibraryService } from './PlateLibraryService.js';
import { LEDVideoManager } from '../LEDVideoManager.js';
import { LocalPlateLibrary } from './LocalPlateLibrary.js';
import { PlateSetSource } from './PlateSetSource.js';
import { PLATE_VIEWS } from './PlateSet.js';

/** Project-wide set selection; presets choose a view without pinning another set. */
export class AdminPlatePlayback {

	constructor( { session, app, manager = LEDVideoManager, library = new LocalPlateLibrary(), plateService = getPlateLibraryService(), openSource = ( ...args ) => PlateSetSource.open( ...args ) } ) {

		Object.assign( this, { session, app, manager, library, plateService, openSource } );
		this.state = { sets: [], walls: [], wallId: '', setId: '', view: 'front', busy: false, playing: false, error: '' };
		this.listeners = new Set(); this.manifests = new Map();
		this.unsubscribe = manager.subscribe?.( () => this.sync() );

	}
	getSnapshot = () => this.state;
	subscribe = callback => {

		this.listeners.add( callback ); return () => this.listeners.delete( callback );

	};
	set( patch ) {

		this.state = { ...this.state, ...patch }; for ( const listener of this.listeners ) listener();

	}
	sync() {

		const preference = this.session.current?.extensions?.drivingPlate;
		const records = [ ...this.manager.records.values() ];
		const walls = records.map( record => ( { id: record.root.uuid, instanceId: record.root.userData?.__rayzeeProjectInstanceId, name: record.root.userData?.__rayzeeName || record.root.name || 'LED wall' } ) );
		const wall = walls.find( item => item.id === this.state.wallId ) || walls.find( item => item.instanceId === preference?.wallInstanceId ) || walls.find( item => this.manager.records.get( item.id )?.video?.plateSource ) || walls[ 0 ];
		const record = wall && this.manager.records.get( wall.id );
		const video = record?.video;
		const patch = { walls, wallId: wall?.id || '', playing: !! video && ! video.paused };
		if ( video ) {

			patch.setId = video.plateSource?.manifest.id || ''; patch.view = video.plateView || this.state.view;

		} else if ( preference ) {

			patch.setId = preference.setId || ''; patch.view = preference.view || 'front';

		}

		if ( Object.entries( patch ).some( ( [ key, value ] ) => JSON.stringify( this.state[ key ] ) !== JSON.stringify( value ) ) ) this.set( patch );

	}
	async refresh() {

		this.manager.attachApp?.( this.app() ); this.manager.syncScene?.();
		const records = await this.library.list();
		let online = [];
		try {

			online = await this.plateService.list();

		} catch { /* Downloaded sets remain available offline. */ }

		this.manifests = new Map( [ ...records.filter( item => item.ready ).map( item => [ item.manifest.id, item.manifest ] ), ...online.map( manifest => [ manifest.id, manifest ] ) ] );
		this.set( { sets: Array.from( this.manifests.values() ).map( item => ( { id: item.id, name: item.name } ) ) } ); this.sync();

	}
	persist() {

		if ( ! this.session.current || this.session.hydrating ) return;
		const wall = this.state.walls.find( item => item.id === this.state.wallId );
		this.session.current.extensions = { ...this.session.current.extensions, drivingPlate: { setId: this.state.setId, view: this.state.view, wallInstanceId: wall?.instanceId || '' } };
		this.session.markDirty();

	}
	async run( task ) {

		if ( this.state.busy ) throw new Error( 'Wait for the plate to finish loading.' );
		this.set( { busy: true, error: '' } );
		try {

			return await task();

		} catch ( error ) {

			this.set( { error: error.message } ); throw error;

		} finally {

			this.set( { busy: false } ); this.sync();

		}

	}
	async bind( id, wallId ) {

		if ( ! this.app() || this.session.hydrating ) throw new Error( 'Wait for the scene to finish loading.' );
		const manifest = this.manifests.get( id );
		if ( ! manifest ) throw new Error( 'Select an available driving plate set.' );
		const record = this.manager.records.get( wallId );
		if ( ! record ) throw new Error( 'Add an LED wall to the scene first.' );
		const projectId = this.session.current?.projectId, app = this.app();
		const { manifest: local, encoding } = await this.plateService.ensure( manifest );
		const source = await this.openSource( this.library, local, { encoding } );
		if ( this.session.current?.projectId !== projectId || this.app() !== app || this.manager.records.get( wallId ) !== record ) {

			await source.dispose(); throw new Error( 'The scene changed while loading the plate.' );

		}

		const snapshot = this.manager.getSnapshot( wallId );
		const oldWall = this.state.wallId;
		if ( ! await this.manager.choosePlate( wallId, source, { view: this.state.view, initialTime: snapshot?.currentTime || 0, autoplay: record.video?.plateSource ? ! record.video.paused : true } ) ) return;
		if ( oldWall && oldWall !== wallId && this.manager.records.get( oldWall )?.video?.plateSource ) this.manager.clearVideo( oldWall );
		this.set( { setId: id, wallId } ); this.persist();

	}
	selectSet( id ) {

		return this.run( () => this.bind( id, this.state.wallId ) );

	}
	selectWall( id ) {

		return this.run( async () => {

			if ( this.state.setId ) await this.bind( this.state.setId, id ); else this.set( { wallId: id } );

		} );

	}
	setView( view ) {

		if ( ! PLATE_VIEWS.includes( view ) ) return Promise.reject( new Error( 'Choose Front, Left, Right or Rear.' ) );
		this.sync();
		return this.run( async () => {

			const record = this.manager.records.get( this.state.wallId );
			if ( record?.video?.plateSource ) await this.manager.setPlateView( this.state.wallId, view );
			this.set( { view } );
			if ( this.state.setId || view !== 'front' || this.session.current?.extensions?.drivingPlate ) this.persist();

		} );

	}
	togglePlayback() {

		return this.run( async () => {

			const record = this.manager.records.get( this.state.wallId );
			if ( ! record?.video?.plateSource ) {

				if ( this.state.setId ) await this.bind( this.state.setId, this.state.wallId ); return;

			}

			if ( record.video.paused ) await this.manager.play( this.state.wallId ); else this.manager.pause( this.state.wallId );

		} );

	}

}
