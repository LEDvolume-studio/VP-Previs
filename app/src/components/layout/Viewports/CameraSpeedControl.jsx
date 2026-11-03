import { useCallback, useEffect, useState } from 'react';
import { Camera } from 'lucide-react';
import { useActiveApp } from '@/hooks/useActiveApp';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export default function CameraSpeedControl() {

	const app = useActiveApp();
	const [ level, setLevel ] = useState( 1 );

	useEffect( () => {

		const manager = app?.cameraManager;
		if ( ! manager ) return;
		setLevel( manager.cameraSpeedLevel );

		const handleSpeedChange = event => setLevel( event.level );
		manager.addEventListener( 'CameraSpeedChanged', handleSpeedChange );
		return () => manager.removeEventListener( 'CameraSpeedChanged', handleSpeedChange );

	}, [ app ] );

	const cycleSpeed = useCallback( () => {

		const manager = app?.cameraManager;
		if ( ! manager ) return;
		manager.setCameraSpeedLevel( level === 8 ? 1 : level + 1 );

	}, [ app, level ] );

	return (
		<div className="absolute top-2 right-2 z-20">
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="secondary"
							size="sm"
							onClick={cycleSpeed}
							className="h-7 min-w-12 gap-1 rounded-full px-2 shadow-sm backdrop-blur"
							aria-label={`Camera speed ${level}`}
						>
							<Camera size={14} />
							<span className="tabular-nums">{level}</span>
						</Button>
					</TooltipTrigger>
					<TooltipContent side="left">
						<p>Camera speed {level}. Click or scroll to adjust; hold Shift for 2× boost.</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		</div>
	);

}
