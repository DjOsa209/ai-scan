import React from 'react';
import ReactDOM from 'react-dom/client';
import App, { SSOCallback } from './App';
import './styles.css';

const Root = window.location.pathname === '/sso/callback' ? SSOCallback : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);