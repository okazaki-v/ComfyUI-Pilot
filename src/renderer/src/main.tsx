import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import FloatApp from './FloatApp'
import './styles.css'

const isFloat = window.location.hash.includes('float')
if (isFloat) document.body.classList.add('float-mode')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isFloat ? <FloatApp /> : <App />}</React.StrictMode>
)
