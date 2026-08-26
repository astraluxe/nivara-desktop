// Entry point for the overlay overlay window. The view itself lives in components/overlay so it can
// be rendered and screenshotted outside a Tauri window too.
import { createRoot } from 'react-dom/client';
import './index.css';
import Overlay from './components/overlay/AgentCursorView';

createRoot(document.getElementById('root')!).render(<Overlay />);
