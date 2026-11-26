import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { registerIpcHandlers } from './ipc';
import { httpNotificationService } from './services/http-notification-service';
import { namedPipeBridgeService } from './services/named-pipe-bridge';
import { windowFlashManager } from './services/window-flash-manager';

// TypeScript 类型声明 - Electron Forge 魔法全局变量
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let mainWindow: BrowserWindow | null = null;

// [diag] 诊断日志落盘：console + userData/diag.log（超 5MB 轮转为 diag.log.1）。
// 排查「窗口还原后输入不显示」问题，问题定位后随其余 [diag] 埋点一并移除。
const DIAG_LOG_MAX_BYTES = 5 * 1024 * 1024;
let diagLogPath: string | null = null;
const diagFileWrite = (line: string): void => {
  try {
    if (!diagLogPath) diagLogPath = join(app.getPath('userData'), 'diag.log');
    if (existsSync(diagLogPath) && statSync(diagLogPath).size > DIAG_LOG_MAX_BYTES) {
      try {
        unlinkSync(`${diagLogPath}.1`);
      } catch {
        // .1 不存在属正常情况
      }
      renameSync(diagLogPath, `${diagLogPath}.1`);
    }
    appendFileSync(diagLogPath, `${line}\n`, 'utf8');
  } catch (err) {
    console.error('[diag] 日志落盘失败:', err);
  }
};
const diagLog = (msg: string): void => {
  const line = `[diag] ${new Date().toISOString()} ${msg}`;
  console.log(line);
  diagFileWrite(line);
};

// 修复：禁用 Windows 原生窗口遮挡检测（CalculateNativeWinOcclusion）
// Chromium 会把被遮挡/恢复中的窗口判定为不可见并停止合成器出帧，
// 导致「输入文字不显示、拖动窗口缩放才显示」的问题。
// 必须在 app ready 之前设置。
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

/**
 * 创建主窗口
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'CodeMinder',
    backgroundColor: '#1e1e1e',
    show: false,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
      // 缓解：窗口还原后渲染进程若误判 hidden，rAF 会被节流至停 → xterm 停画。
      // 关闭后台节流，保证终端始终出帧（代价：最小化时仍渲染，桌面应用可接受）。
      backgroundThrottling: false,
    },
  });

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    // 初始化窗口闪烁管理器
    windowFlashManager.initialize(mainWindow!);
  });

  // 修复：Win+D 还原只取消最小化、不激活窗口（08-20 日志实证：restore→blur、
  // focused=false 持续到用户手动点击）。未激活的窗口收不到键盘输入，IME 也
  // 切不了中文（TSF 要求窗口真正激活）。webContents.focus() 只作用于渲染进程
  // 内部焦点，无法完成 OS 级激活，必须先 win.focus()（SetForegroundWindow）。
  // 窗口激活成功后，渲染进程 XTermWrapper 的 recover() 会自动重挂 IME。
  mainWindow.on('restore', () => {
    mainWindow?.focus();
    mainWindow?.webContents.focus();
    // [diag] SetForegroundWindow 可能被前台锁拒绝；200ms 后验证，失败则置顶切换强制激活
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
        diagLog('restore后窗口未激活，置顶切换强制激活');
        mainWindow.setAlwaysOnTop(true);
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(false);
      }
    }, 200);
    // [diag] 还原 500ms 后自动抓取渲染进程状态（排查偶发不出帧/IME失效）
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        diagLog('--- 还原后自动抓取 ---');
        mainWindow.webContents.send('diag:auto-capture');
      }
    }, 500);
  });

  // [diag] 窗口从隐藏到显示（冷启动 ready-to-show、睡眠唤醒后系统拉起等）
  // 也自动抓取——08-20 复现走的是 win:show 而非 restore，旧埋点没抓到现场
  mainWindow.on('show', () => {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        diagLog('--- show 后自动抓取 ---');
        mainWindow.webContents.send('diag:auto-capture');
      }
    }, 500);
  });

  // [diag] 窗口状态事件追踪（问题定位后移除）
  for (const evt of ['focus', 'blur', 'minimize', 'restore', 'show', 'hide', 'maximize', 'unmaximize']) {
    (mainWindow as any).on(evt, () => diagLog(`win:${evt} focused=${mainWindow?.isFocused()}`));
  }

  // 加载 renderer 页面 - 使用魔法全局变量
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  mainWindow.on('closed', () => {
    console.log('Main window closed');
    mainWindow = null;
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Page loaded successfully');
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Render process gone:', details);
  });

  // 监听渲染进程中的未捕获异常
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] ${message}`);
    // [diag] 渲染进程的诊断日志同步落盘（渲染进程 console.log 经此转发到主进程）
    if (message.includes('[diag]')) diagFileWrite(message);
  });
}

// 应用程序准备就绪
app.whenReady().then(() => {
  // [diag] GPU 状态（合成器停帧问题排查：GPU 进程崩溃/禁用会导致界面不刷新）
  diagLog(`GPU status: ${JSON.stringify(app.getGPUFeatureStatus())}`);
  app.on('child-process-gone', (_e, details) => {
    diagLog(`child-process-gone: type=${details.type} reason=${details.reason}`);
  });

  // [diag] F9 现场抓取：打印窗口与 GPU 状态
  ipcMain.on('diag:dump', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      diagLog(`F9主进程现场: focused=${mainWindow.isFocused()} visible=${mainWindow.isVisible()} minimized=${mainWindow.isMinimized()} maximized=${mainWindow.isMaximized()} fullscreen=${mainWindow.isFullScreen()} url=${mainWindow.webContents.getURL().slice(0, 50)}`);
    }
    diagLog(`GPU status: ${JSON.stringify(app.getGPUFeatureStatus())}`);
  });

  // [diag] 焦点失步检测：渲染进程每 5s 上报 hasFocus，与主进程 isFocused() 对比。
  // 08-20 复现推断：Chromium 误判焦点/可见性 → 合成器停帧（点击才出一帧），
  // 同时 hasFocus()=false 使旧 rAF 告警静默。失步 >10s 即抓现场。
  let focusMismatchSince = 0;
  let focusMismatchAlerted = false;
  ipcMain.on('diag:renderer-focus', (_e, payload: { hasFocus: boolean; visibility: string }) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const mainFocused = mainWindow.isFocused();
    const mismatch = mainFocused !== payload.hasFocus;
    if (mismatch) {
      if (!focusMismatchSince) focusMismatchSince = Date.now();
      if (!focusMismatchAlerted && Date.now() - focusMismatchSince > 10000) {
        focusMismatchAlerted = true;
        diagLog(`WARNING: 焦点状态失步 >10s: 主进程 focused=${mainFocused} 渲染 hasFocus=${payload.hasFocus} visibility=${payload.visibility} → 疑似合成器停帧诱因`);
        diagLog(`GPU status: ${JSON.stringify(app.getGPUFeatureStatus())}`);
      }
    } else if (focusMismatchSince) {
      if (focusMismatchAlerted) {
        diagLog(`焦点状态已重新同步: 主进程 focused=${mainFocused} 渲染 hasFocus=${payload.hasFocus}`);
      }
      focusMismatchSince = 0;
      focusMismatchAlerted = false;
    }
  });

  // 移除顶部菜单栏
  Menu.setApplicationMenu(null);

  registerIpcHandlers();
  createWindow();
  httpNotificationService.start(); // 启动 HTTP 通知服务
  namedPipeBridgeService.start();  // 启动命名管道桥接服务

  // macOS 特有：点击 Dock 图标时重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 所有窗口关闭时退出应用 (macOS 除外)
app.on('window-all-closed', () => {
  console.log('window-all-closed event fired');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 应用退出前清理
app.on('before-quit', () => {
  // 清理窗口闪烁管理器
  windowFlashManager.dispose();
  // 停止 HTTP 通知服务
  httpNotificationService.stop();
  // 停止命名管道桥接服务
  namedPipeBridgeService.stop();
  // 清理所有 PTY 会话
  const { ptyService } = require('./services/pty-service');
  ptyService.destroyAll();
});
