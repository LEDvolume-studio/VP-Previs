import { getLocalPresetRepository } from './LocalPresetRepository.js';
import { CloudAdminPresetRepository } from './CloudAdminPresetRepository.js';
import { isCloudPresetStorage } from './StudentPresetRepository.js';
export { isCloudPresetStorage, getStudentPresetRepository } from './StudentPresetRepository.js';

let adminRepository;

export function getAdminPresetRepository() {

	adminRepository ||= isCloudPresetStorage() ? new CloudAdminPresetRepository( { baseURL: globalThis.location?.origin } ) : getLocalPresetRepository();
	return adminRepository;

}
