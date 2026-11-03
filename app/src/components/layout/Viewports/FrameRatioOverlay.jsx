import { useCameraStore } from '@/store';
import { getFrameOverlayBars } from '@/utils/cameraSensor';

const FrameRatioOverlay = () => {

	const ratio = useCameraStore( state => state.frameOverlayRatio );
	const bars = getFrameOverlayBars( ratio );
	if ( ! bars ) return null;

	const vertical = bars.orientation === 'vertical';
	const firstStyle = vertical
		? { left: 0, top: 0, bottom: 0, width: `${bars.size}%` }
		: { left: 0, right: 0, top: 0, height: `${bars.size}%` };
	const secondStyle = vertical
		? { right: 0, top: 0, bottom: 0, width: `${bars.size}%` }
		: { left: 0, right: 0, bottom: 0, height: `${bars.size}%` };

	return (
		<div className="absolute inset-0 z-10 pointer-events-none" aria-hidden="true">
			<div className="absolute bg-black/50" style={firstStyle} />
			<div className="absolute bg-black/50" style={secondStyle} />
		</div>
	);

};

export default FrameRatioOverlay;
