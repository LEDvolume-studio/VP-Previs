import { create } from 'zustand';

export const useProjectStore = create( set => ( {
	projects: [],
	activeProject: null,
	defaultProjectId: null,
	status: 'loading',
	error: '',
	missingMedia: [],
	warnings: [],
	managerOpen: false,
	setProjects: projects => set( { projects } ),
	setActiveProject: activeProject => set( { activeProject } ),
	setDefaultProjectId: defaultProjectId => set( { defaultProjectId } ),
	setStatus: ( status, error = '' ) => set( { status, error } ),
	setMissingMedia: missingMedia => set( { missingMedia } ),
	setWarnings: warnings => set( { warnings } ),
	setManagerOpen: managerOpen => set( { managerOpen } ),
} ) );
