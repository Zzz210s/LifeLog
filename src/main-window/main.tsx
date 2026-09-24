import { createRoot } from 'react-dom/client';
import 'highlight.js/styles/github.css';
import './main.css';
import { App } from './App';
import { installFileDropGuard } from './shell/file-drop-guard';
import { installCloseGuard } from './shell/close-guard';

installFileDropGuard();
installCloseGuard();

createRoot(document.getElementById('root')!).render(<App />);
