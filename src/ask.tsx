// Entry point for the ask overlay window. The view itself lives in components/overlay so it can
// be rendered and screenshotted outside a Tauri window too.
import { createRoot } from 'react-dom/client';
import './index.css';
import './overlay.css';
import Ask from './components/overlay/AgentAskView';

createRoot(document.getElementById('root')!).render(<Ask />);
