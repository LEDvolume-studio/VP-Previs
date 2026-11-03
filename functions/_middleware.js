// Applies before every Pages route, including static files. Never exclude asset
// paths from Functions: the Australia gate also applies to public student files.
export { onRequest } from '../backend/src/security/PagesSecurity.js';
