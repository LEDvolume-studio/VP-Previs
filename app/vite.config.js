import path from "path";
import { studentOfflinePlugin } from './build/studentOfflinePlugin.js';
import { localStudentBackend } from './build/localStudentBackend.js';
import { plateCataloguePlugin } from './build/plateCataloguePlugin.js';
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
// import basicSsl from '@vitejs/plugin-basic-ssl';

import process from 'process';
import { readFileSync } from 'fs';
const __dirname = path.resolve();
const enginePkg = JSON.parse( readFileSync( path.resolve( __dirname, '../rayzee/package.json' ), 'utf-8' ) );

const ReactCompilerConfig = {}; // Define ReactCompilerConfig

export default defineConfig( {
	envDir: path.resolve( __dirname, '..' ),
	base: './',
	server: {
		// Expose to LAN
		host: true,
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'credentialless',
		},
		fs: {
			// The regression bench harness lives outside this Vite root, in the repo's
			// `bench/` directory. Serving it needs the monorepo root allow-listed.
			// See bench/README.md.
			allow: [ path.resolve( __dirname, '..' ) ],
		},
		// port: 5174
	},
	build: {
		rollupOptions: { input: {
			index: path.resolve( __dirname, 'index.html' ),
			student: path.resolve( __dirname, 'student/index.html' ),
			studentWorkbench: path.resolve( __dirname, 'student/workbench/index.html' ),
			studentDiagnostic: path.resolve( __dirname, 'student/diagnostic/index.html' ),
			studentScene: path.resolve( __dirname, 'student/scene/index.html' ),
			studentPresetPublisher: path.resolve( __dirname, 'admin/student-presets/index.html' ),
			studentProjectReview: path.resolve( __dirname, 'admin/users/review/index.html' ),
			studentUsers: path.resolve( __dirname, 'admin/users/index.html' ),
			drivingPlateIntake: path.resolve( __dirname, 'admin/driving-plates/index.html' ),
		} },
	},
	assetsInclude: [ "**/*.hdr" ],
	plugins: [
		localStudentBackend( __dirname ),
		plateCataloguePlugin( path.resolve( __dirname, '../.local-runtime/plate-catalogue' ) ),
		studentOfflinePlugin(),
		// Strip onnxruntime WASM files from build output — loaded from CDN at runtime.
		// Prevents Cloudflare Pages 25MB file size limit violation.
		{
			name: 'exclude-ort-wasm',
			generateBundle( _, bundle ) {

				for ( const key of Object.keys( bundle ) ) {

					if ( key.includes( 'ort-wasm' ) && key.endsWith( '.wasm' ) ) {

						delete bundle[ key ];

					}

				}

			}
		},
		// HTTPS so WebGPU works on remote devices (requires secure context)
		// basicSsl(),
		react( {
			babel: {
			  plugins: [
					[ "babel-plugin-react-compiler", ReactCompilerConfig ],
			  ],
			},
		  } ),
		tailwindcss()
	],
	resolve: {
		alias: {
			"rayzee": path.resolve( __dirname, "../rayzee/src/index.js" ),
			"@/core": path.resolve( __dirname, "../rayzee/src" ),
			"@": path.resolve( __dirname, "./src" ),
		},
	},
	// Only define specific environment variables that are needed
	// Avoid exposing all of process.env for security reasons
	define: {
		'import.meta.env.PREVIS_FIXTURE_ASSETS': 'true',
		'process.env.NODE_ENV': JSON.stringify( process.env.NODE_ENV ),
		'__APP_VERSION__': JSON.stringify( process.env.VITE_APP_VERSION || enginePkg.version ),
	}
} );
