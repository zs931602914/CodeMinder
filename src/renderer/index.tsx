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

// ========== [diag] 渲染停帧/IME 失效问题诊断埋点（问题定位后移除） ==========
const diagLog = (msg: string) => console.log(`[diag] ${new Date().toISOString()} ${msg}`);

document.addEventListener('visibilitychange', () => {
  diagLog(`visibilitychange hidden=${document.hidden} state=${document.visibilityState}`);
});
window.addEventListener('focus', () => diagLog('window focus'));
window.addEventListener('blur', () => diagLog('window blur'));

// F9：问题复现时现场抓取渲染进程 + 主进程状态，输出到主进程控制台
window.addEventListener('keydown', (e) => {
  if (e.key === 'F9') {
    const active = document.activeElement;
    const desc = active
      ? `${active.tagName.toLowerCase()}${active.className ? '.' + String(active.className).split(' ').join('.') : ''}`
      : 'null';
    diagLog(`F9现场: hasFocus=${document.hasFocus()} visibility=${document.visibilityState} hidden=${document.hidden} activeElement=${desc}`);
    window.electronAPI.diagDump();
  }
});
