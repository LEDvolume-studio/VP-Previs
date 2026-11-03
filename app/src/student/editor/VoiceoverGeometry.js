export function editVoiceoverClip( clip, asset, kind, deltaFrames, anchorFrame = 0 ) {

	const next = structuredClone( clip );
	const samples = Math.round( deltaFrames * asset.sampleRate / 25 );
	if ( kind === 'move' ) next.offsetFrames = Math.max( - anchorFrame, Math.min( 22500, clip.offsetFrames + Math.round( deltaFrames ) ) ) || 0;
	if ( kind === 'left' ) {

		const delta = Math.max( - clip.sourceStartSample, - Math.round( ( clip.offsetFrames + anchorFrame ) * asset.sampleRate / 25 ), Math.min( clip.lengthSamples - 1, samples ) );
		next.sourceStartSample += delta; next.lengthSamples -= delta; next.offsetFrames += Math.round( delta / asset.sampleRate * 25 );

	}

	if ( kind === 'right' ) next.lengthSamples = Math.max( 1, Math.min( asset.durationSamples - clip.sourceStartSample, clip.lengthSamples + samples ) );
	return next;

}

