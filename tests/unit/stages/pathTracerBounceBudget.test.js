import { describe, it, expect, vi } from 'vitest';
import { PathTracer } from '@/core/Stages/PathTracer.js';

function makeStage() {

	return {
		maxBounces: { value: 4 },
		transmissiveBounces: { value: 8 },
		maxSubsurfaceSteps: { value: 2 },
		_lastBounceCountsBudget: 4,
		_lastBounceCountsLoopBound: 14,
		_readbackEveryNFrames: 4,
		_readbackFrameCounter: 0,
		_readbackGeneration: 0,
		_queueManager: {
			MAX_BOUNCE_SNAPSHOTS: 2,
			getBounceCountsAttribute: () => ( {} ),
			getCountersAttribute: () => null,
		},
		renderer: { getArrayBufferAsync: vi.fn().mockResolvedValue( new Uint32Array( [ 20, 10, 5, 2 ] ).buffer ) },
		_bounceLoopBound: PathTracer.prototype._bounceLoopBound,
	};

}

describe( 'PathTracer bounce budgets', () => {

	it.each( [ 'transmissiveBounces', 'maxSubsurfaceSteps' ] )( 'remeasures immediately when %s grows without a camera-bounce change', async property => {

		const stage = makeStage();
		stage[ property ].value += 8;
		PathTracer.prototype._maybeReadbackCounters.call( stage );
		await Promise.resolve();

		expect( stage.renderer.getArrayBufferAsync ).toHaveBeenCalledOnce();
		expect( stage._lastBounceCountsBudget ).toBe( 4 );
		expect( stage._lastBounceCountsLoopBound ).toBe( 22 );
		expect( [ ...stage._lastBounceCounts ] ).toEqual( [ 20, 10 ] );

	} );

	it( 'retains the readback cadence when the budgets have not changed', () => {

		const stage = makeStage();
		PathTracer.prototype._maybeReadbackCounters.call( stage );
		expect( stage.renderer.getArrayBufferAsync ).not.toHaveBeenCalled();

	} );

	it( 'does not adopt counts from before an Unreal camera move', async () => {

		const stage = makeStage();
		stage.transmissiveBounces.value += 8;
		PathTracer.prototype._maybeReadbackCounters.call( stage );
		stage._readbackGeneration ++;
		await Promise.resolve();

		expect( stage._lastBounceCountsLoopBound ).toBe( 14 );
		expect( stage._lastBounceCounts ).toBeUndefined();

	} );

} );
