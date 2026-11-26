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

// [diag] 第二层探针（区分「键盘事件未到达渲染进程」vs「到达但 textarea 焦点断」vs「IME 绑定断」）
// 08-20 18:06 实证：窗口已激活 focused=true 仍打字不显示、F9 落空——键盘链路层问题
// keydown 到达探针（限频 2s，避免打字刷屏）
let diagLastKeyLog = 0;
window.addEventListener('keydown', (e) => {
  const now = performance.now();
  if (now - diagLastKeyLog > 2000) {
    diagLastKeyLog = now;
    const active = document.activeElement;
    const desc = active ? `${active.tagName.toLowerCase()}${active.className ? '.' + String(active.className).split(' ')[0] : ''}` : 'null';
    diagLog(`keydown ${e.key} 到达 activeElement=${desc}`);
  }
}, { capture: true });
// 焦点元素变化追踪（textarea 焦点何时丢、何时回）
document.addEventListener('focusin', () => {
  const active = document.activeElement;
  const desc = active ? `${active.tagName.toLowerCase()}${active.className ? '.' + String(active.className).split(' ')[0] : ''}` : 'null';
  diagLog(`focusin → ${desc}`);
});
// IME 组合事件：切中文打字时若不触发 = IME 未绑定页面
window.addEventListener('compositionstart', () => diagLog('compositionstart（IME 组合开始）'));
window.addEventListener('compositionend', () => diagLog('compositionend（IME 组合结束）'));

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

// [diag] 三段心跳判定：pty数据 → xterm重绘 → (DWM上屏，JS侧不可见)。
// 08-27 14:15 复现时 keydown 正常、rAF 无告警但整屏定格，无法区分断点；
// 此探针负责指认：若 render 滞后 data >3s 告警 = 断在 xterm 重绘层（B 分支）。
// 若本告警不出现而症状仍在（data/render 都新鲜、rAF 在跑）= 断在合成器/DWM 上屏（C 分支）。
let diagLastRenderWarn = 0;
setInterval(() => {
  const d = (window as any).__diagLastData as number | undefined;
  const r = (window as any).__diagLastRender as number | undefined;
  if (!d || !r) return;
  const lagMs = Math.round(performance.now() - r);
  if (d > r && lagMs > 3000 && performance.now() - diagLastRenderWarn > 10000) {
    diagLastRenderWarn = performance.now();
    diagLog(`WARNING: pty 数据已到 ${lagMs}ms 未 render hasFocus=${document.hasFocus()} → xterm 重绘层停滞`);
  }
}, 1000);

// 焦点状态每 5s 上报主进程，主进程与自己的 isFocused() 对比，
// 失步持续 >10s 即告警——「焦点失步 → 合成器停帧」假说的直接证据
setInterval(() => {
  window.electronAPI.diagReportFocus(document.hasFocus(), document.visibilityState);
}, 5000);
