import { OfflineCatalogueClient } from '../../previs/offline/OfflineCatalogueClient.js';
import { getLocalPresetRepository } from './LocalPresetRepository.js';
import { CloudStudentPresetRepository } from './CloudStudentPresetRepository.js';

export const isCloudPresetStorage = ( env = import.meta.env ) => ! env.DEV || env.VITE_PRESET_STORAGE === 'cloud';
let studentRepository;

export function getStudentPresetRepository() {

	studentRepository ||= isCloudPresetStorage() ? new CloudStudentPresetRepository( { client: new OfflineCatalogueClient() } ) : getLocalPresetRepository();
	return studentRepository;

}
