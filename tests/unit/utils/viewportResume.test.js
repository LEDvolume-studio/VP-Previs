import { afterEach, describe, expect, it, vi } from 'vitest';
import { installViewportResumeRecovery } from '../../../app/src/utils/viewportResume.js';

afterEach( () => vi.useRealTimers() );

describe( 'viewport resume events', () => {

	it( 'refreshes on a visible tab return after layout and cancels pending work on cleanup', () => {

		vi.useFakeTimers();
		const win = new EventTarget();
		const doc = new EventTarget();
		doc.visibilityState = 'hidden';
		win.requestAnimationFrame = vi.fn( callback => setTimeout( callback, 16 ) );
		win.cancelAnimationFrame = clearTimeout;
		win.setTimeout = setTimeout;
		win.clearTimeout = clearTimeout;
		const app = { refreshViewport: vi.fn() };
		const cleanup = installViewportResumeRecovery( app, win, doc );
		win.dispatchEvent( new Event( 'focus' ) );
		expect( win.requestAnimationFrame ).not.toHaveBeenCalled();
		doc.visibilityState = 'visible';
		doc.dispatchEvent( new Event( 'visibilitychange' ) );
		win.dispatchEvent( new Event( 'focus' ) );
		vi.advanceTimersByTime( 16 );
		expect( app.refreshViewport ).toHaveBeenCalledTimes( 1 );
		vi.advanceTimersByTime( 250 );
		expect( app.refreshViewport ).toHaveBeenCalledTimes( 2 );
		win.dispatchEvent( new Event( 'pageshow' ) );
		cleanup();
		vi.runAllTimers();
		win.dispatchEvent( new Event( 'resize' ) );
		vi.runAllTimers();
		expect( app.refreshViewport ).toHaveBeenCalledTimes( 2 );

	} );

} );
