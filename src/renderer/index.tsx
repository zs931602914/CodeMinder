import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/app.css';

console.log('index.tsx: Loading...');

try {
  const rootElement = document.getElementById('root');
  console.log('index.tsx: Root element:', rootElement);

  if (!rootElement) {
    console.error('index.tsx: Root element not found!');
  } else {
    // 创建根元素并渲染应用
    const root = ReactDOM.createRoot(rootElement);
    console.log('index.tsx: Creating React root...');

    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );

    console.log('index.tsx: App rendered!');
  }
} catch (error) {
  console.error('index.tsx: Failed to render app:', error);
}

// 全局错误处理
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});
