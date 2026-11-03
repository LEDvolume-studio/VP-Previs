import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { studentOfflinePlugin } from './build/studentOfflinePlugin.js';

const root = path.dirname( fileURLToPath( import.meta.url ) );

// Isolated proof build: usable even when unrelated OneDrive admin sources are unavailable.
export default defineConfig( {
	root,
	define: { 'import.meta.env.PREVIS_FIXTURE_ASSETS': 'false' },
	base: './',
	publicDir: false,
	plugins: [ react(), studentOfflinePlugin() ],
	server: {
		host: '127.0.0.1',
		headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' },
		fs: { allow: [ path.resolve( root, '..' ) ] },
	},
	preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } },
	build: { outDir: 'dist-previs-diagnostic', rollupOptions: { input: { student: path.resolve( root, 'student/index.html' ), studentWorkbench: path.resolve( root, 'student/workbench/index.html' ), studentDiagnostic: path.resolve( root, 'student/diagnostic/index.html' ) } } },
} );
