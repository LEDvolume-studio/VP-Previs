/**
 * Generate memoized style objects for viewport components
 * @param {number} canvasWidth - Width of the canvas
 * @param {number} canvasHeight - Height of the canvas
 * @param {number} viewportScale - Current viewport scale
 * @returns {Object} Style objects for wrapper, container, and canvas
 */
export const generateViewportStyles = ( canvasWidth, canvasHeight, viewportScale ) => {

	const wrapperStyle = {
		width: `${canvasWidth * viewportScale / 100}px`,
		height: `${canvasHeight * viewportScale / 100}px`,
		flex: '0 0 auto',
		maxWidth: 'none',
		transition: "none"
	};

	const containerStyle = {
		position: "relative",
		width: '100%',
		height: '100%',
		overflow: "hidden",
		borderRadius: "5px",
		background: "repeating-conic-gradient(rgb(128 128 128 / 20%) 0%, rgb(128 128 128 / 20%) 25%, transparent 0%, transparent 50%) 50% center / 20px 20px"
	};

	const canvasStyle = {
		position: 'absolute',
		top: 0,
		left: 0,
		width: '100%',
		height: '100%',
		maxWidth: 'none',
		maxHeight: 'none'
	};

	return { wrapperStyle, containerStyle, canvasStyle };

};
