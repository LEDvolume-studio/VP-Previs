import { createRoot } from 'react-dom/client';
import PlateLibraryPanel from '../../components/plates/PlateLibraryPanel.jsx';

createRoot( document.getElementById( 'plate-library-app' ) ).render( <PlateLibraryPanel admin/> );
