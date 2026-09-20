import { createRoot } from 'react-dom/client';
import 'highlight.js/styles/github.css';
import './main.css';
import { App } from './App';
import { installFileDropGuard } from './shell/file-drop-guard';

installFileDropGuard();

createRoot(document.getElementById('root')!).render(<App />);
