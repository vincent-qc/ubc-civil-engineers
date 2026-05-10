// Popup React entry point

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Popup } from './Popup';
import './styles.css';

const root = document.getElementById('root');

if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Popup />
    </React.StrictMode>
  );
} else {
  console.error('Root element not found');
}
