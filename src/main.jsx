import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import PartnerApp from './PartnerApp.jsx'
import './styles.css'

// Feature flag: VITE_SNAPTRADE_MODE=partner switches to the multi-user, keyless
// "sign in → connect Wealthsimple" experience. Anything else (default) keeps the
// current single-user personal-keys dashboard untouched.
const Root = import.meta.env.VITE_SNAPTRADE_MODE === 'partner' ? PartnerApp : App

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)

// Register the service worker so the browser offers "Install" (PWA) and the app
// works offline. Path is base-relative so it works at localhost, the 51703 desktop
// origin, and the GitHub Pages /investments-dashboard/ subpath alike.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}
