import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import UiKit from './UiKit';

createRoot(document.getElementById('root')!).render(<StrictMode><UiKit /></StrictMode>);
