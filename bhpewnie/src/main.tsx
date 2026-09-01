import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('aplikacja')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
