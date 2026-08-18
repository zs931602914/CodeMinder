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

// 现场抓取：渲染进程状态 + 请求主进程窗口/GPU 状态
const diagCapture = () => {
  const active = document.activeElement;
  const desc = active
    ? `${active.tagName.toLowerCase()}${active.className ? '.' + String(active.className).split(' ').join('.') : ''}`
    : 'null';
  diagLog(`现场抓取: hasFocus=${document.hasFocus()} visibility=${document.visibilityState} hidden=${document.hidden} activeElement=${desc}`);
  window.electronAPI.diagDump();
};

document.addEventListener('visibilitychange', () => {
  diagLog(`visibilitychange hidden=${document.hidden} state=${document.visibilityState}`);
});
window.addEventListener('focus', () => diagLog('window focus'));
window.addEventListener('blur', () => diagLog('window blur'));

// 主进程在窗口还原后自动触发抓取（无需按键）
window.electronAPI.onDiagAutoCapture(diagCapture);

// F9：问题复现时手动抓取
window.addEventListener('keydown', (e) => {
  if (e.key === 'F9') {
    diagCapture();
  }
});

// rAF 心跳：窗口有焦点但 rAF 停滞 >2秒 → 出帧停滞的直接证据。
// 注意：用 hasFocus() 而非 !document.hidden 判断——若 visibilityState 卡死在 hidden
// （当前主假设），后者恰好静默；hasFocus() 反映 OS 级焦点，不受 visibility 误判影响。
let diagLastFrame = performance.now();
const diagRafLoop = () => {
  diagLastFrame = performance.now();
  requestAnimationFrame(diagRafLoop);
};
requestAnimationFrame(diagRafLoop);
setInterval(() => {
  const stallMs = performance.now() - diagLastFrame;
  if (document.hasFocus() && stallMs > 2000) {
    diagLog(`WARNING: 窗口有焦点但 rAF 已停滞 ${Math.round(stallMs)}ms → 出帧停滞! visibility=${document.visibilityState} hidden=${document.hidden}`);
  }
}, 1000);
