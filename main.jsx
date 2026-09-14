import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

const el = document.getElementById('root');

try {
  createRoot(el).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (e) {
  el.innerHTML =
    '<pre style="padding:20px;color:#b4431b;white-space:pre-wrap">Не вдалось запустити інтерфейс: ' +
    (e && e.message ? e.message : String(e)) +
    '</pre>';
}
