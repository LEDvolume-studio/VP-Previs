import { expect, it } from 'vitest';
import { studentOfflinePlugin } from '../../../app/build/studentOfflinePlugin.js';

it( 'precaches exact lazy editor dependencies without authorizing admin or diagnostic code', () => {

	const graph = {
		'student/index.html': { type: 'asset', source: 'student' },
		'assets/student.js': { type: 'chunk', isEntry: true, name: 'student', fileName: 'assets/student.js', code: 'student', imports: [], dynamicImports: [ 'assets/viewport.js' ] },
		'assets/viewport.js': { type: 'chunk', code: 'viewport', imports: [ 'assets/three.js' ], dynamicImports: [ 'assets/decoder.js' ] },
		'assets/three.js': { type: 'chunk', code: 'three', imports: [] },
		'assets/decoder.js': { type: 'chunk', code: 'decoder', imports: [] },
		'assets/admin.js': { type: 'chunk', isEntry: true, name: 'index', code: 'private', imports: [] },
		'assets/diagnostic.js': { type: 'chunk', isEntry: true, name: 'studentDiagnostic', code: 'private diagnostic', imports: [] },
	};
	const emitted = [];
	studentOfflinePlugin().generateBundle.handler.call( { emitFile: file => emitted.push( file ) }, {}, graph );
	const publicFiles = JSON.parse( emitted.find( file => file.fileName.endsWith( 'edge-public-assets.json' ) ).source ).files;
	expect( publicFiles.map( file => file.path ) ).toEqual( expect.arrayContaining( [ '/assets/viewport.js', '/assets/three.js', '/assets/decoder.js' ] ) );
	expect( publicFiles.some( file => /admin|diagnostic/.test( file.path ) ) ).toBe( false );
	const worker = emitted.find( file => file.fileName === 'student/sw.js' ).source;
	expect( worker ).toContain( '/assets/viewport.js' );
	expect( worker ).toContain( '/assets/three.js' );
	expect( worker ).toContain( '/assets/decoder.js' );
	expect( worker ).not.toContain( '/assets/admin.js' );
	expect( worker ).not.toContain( '/assets/diagnostic.js' );
	expect( publicFiles.find( file => file.path === '/assets/viewport.js' ).byteLength ).toBe( 8 );

} );

it( 'keeps the separate workbench and its GPU runtime out of the public editor shell', () => {

	const graph = {
		'student/index.html': { type: 'asset', source: 'student' },
		'assets/student.js': { type: 'chunk', isEntry: true, name: 'student', fileName: 'assets/student.js', code: 'bootstrap', imports: [], dynamicImports: [ 'assets/editor.js' ] },
		'assets/editor.js': { type: 'chunk', code: 'editor', imports: [ 'assets/domain.js' ], dynamicImports: [] },
		'assets/workbench.js': { type: 'chunk', isEntry: true, name: 'studentWorkbench', fileName: 'assets/workbench.js', facadeModuleId: '/app/src/student/workbench.js', code: 'workbench', imports: [], dynamicImports: [ 'assets/gpu.js' ], viteMetadata: { importedCss: new Set( [ 'assets/workbench.css' ] ) } },
		'assets/domain.js': { type: 'chunk', code: 'domain', imports: [] },
		'assets/workbench.css': { type: 'asset', source: 'styles' },
		'assets/gpu.js': { type: 'chunk', code: 'gpu', imports: [] },
	};
	const emitted = [];
	studentOfflinePlugin().generateBundle.handler.call( { emitFile: file => emitted.push( file ) }, {}, graph );
	const worker = emitted.find( file => file.fileName === 'student/sw.js' ).source;
	expect( worker ).not.toContain( '/assets/workbench.js' );
	expect( worker ).toContain( '/assets/domain.js' );
	expect( worker ).not.toContain( '/assets/workbench.css' );
	expect( worker ).not.toContain( '/assets/gpu.js' );

} );
