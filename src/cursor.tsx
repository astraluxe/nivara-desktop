// Entry point for the overlay overlay window. The view itself lives in components/overlay so it can
// be rendered and screenshotted outside a Tauri window too.
import { createRoot } from 'react-dom/client';
import './index.css';
import './overlay.css';
import Overlay from './components/overlay/AgentCursorView';

// Click-through at the DOM level as well as the window level.
document.body.classList.add('nv-overlay-passthrough');

createRoot(document.getElementById('root')!).render(<Overlay />);
