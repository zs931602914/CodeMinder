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

// rAF 心跳：停滞 >2秒即告警并自动抓取现场。
// 注意：不再用 hasFocus() 做门限——08-20 复现时焦点状态疑似失步（hasFocus()=false），
// 旧条件恰好静默，现场全丢。停滞就是停滞，快照随告警一起落盘。
let diagLastFrame = performance.now();
let diagStallStart = 0;   // 停滞起始时刻（0=未停滞）
let diagStallLogged = 0;  // 停滞期间最后一次告警时刻（限频用）
const diagRafLoop = () => {
  if (diagStallStart) {
    const dur = Math.round(performance.now() - diagStallStart);
    if (dur > 2000) {
      // rAF 恢复：补记停滞总时长（若停滞期间 setInterval 被节流，这是唯一记录）
      diagLog(`rAF 停滞已恢复: 持续 ${dur}ms`);
    }
    diagStallStart = 0;
    diagStallLogged = 0;
  }
  diagLastFrame = performance.now();
  requestAnimationFrame(diagRafLoop);
};
requestAnimationFrame(diagRafLoop);
setInterval(() => {
  const stallMs = performance.now() - diagLastFrame;
  if (stallMs > 2000) {
    if (!diagStallStart) diagStallStart = diagLastFrame;
    if (performance.now() - diagStallLogged > 5000) {
      diagStallLogged = performance.now();
      diagLog(`WARNING: rAF 停滞 ${Math.round(stallMs)}ms hasFocus=${document.hasFocus()} visibility=${document.visibilityState} hidden=${document.hidden}`);
      window.electronAPI.diagDump(); // 自动抓主进程窗口/GPU 现场
    }
  }
}, 1000);

// 焦点状态每 5s 上报主进程，主进程与自己的 isFocused() 对比，
// 失步持续 >10s 即告警——「焦点失步 → 合成器停帧」假说的直接证据
setInterval(() => {
  window.electronAPI.diagReportFocus(document.hasFocus(), document.visibilityState);
}, 5000);
