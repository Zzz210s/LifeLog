import { createRoot } from 'react-dom/client';
import 'highlight.js/styles/github.css';
import './main.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
