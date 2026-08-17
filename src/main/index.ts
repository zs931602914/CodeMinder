import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import { registerIpcHandlers } from './ipc';
import { httpNotificationService } from './services/http-notification-service';
import { namedPipeBridgeService } from './services/named-pipe-bridge';
import { windowFlashManager } from './services/window-flash-manager';

// TypeScript 类型声明 - Electron Forge 魔法全局变量
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let mainWindow: BrowserWindow | null = null;

// [diag] 供 diag:dump 使用的时閭戳函数
const diagDumpTs = () => new Date().toISOString();

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
    },
  });

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    // 初始化窗口闪烁管理器
    windowFlashManager.initialize(mainWindow!);
  });

  // 修复：从最小化恢复时，Chromium 内部焦点状态可能与 OS 实际窗口状态失步，
  // 导致 IME 输入法失效（切不了中文），点击一次界面才能恢复。
  // 恢复时显式把焦点交还给 webContents，强制同步焦点状态。
  mainWindow.on('restore', () => {
    mainWindow?.webContents.focus();
  });

  // [diag] 窗口状态事件追踪（问题定位后移除）
  for (const evt of ['focus', 'blur', 'minimize', 'restore', 'show', 'hide', 'maximize', 'unmaximize']) {
    (mainWindow as any).on(evt, () => console.log(`[diag] ${new Date().toISOString()} win:${evt} focused=${mainWindow?.isFocused()}`));
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
  });
}

// 应用程序准备就绪
app.whenReady().then(() => {
  // [diag] GPU 状态（合成器停帧问题排查：GPU 进程崩溃/禁用会导致界面不刷新）
  console.log(`[diag] ${new Date().toISOString()} GPU status:`, JSON.stringify(app.getGPUFeatureStatus()));
  app.on('child-process-gone', (_e, details) => {
    console.error(`[diag] ${new Date().toISOString()} child-process-gone: type=${details.type} reason=${details.reason}`);
  });

  // [diag] F9 现场抓取：打印窗口与 GPU 状态
  ipcMain.on('diag:dump', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log(`[diag] ${diagDumpTs()} F9主进程现场: focused=${mainWindow.isFocused()} visible=${mainWindow.isVisible()} minimized=${mainWindow.isMinimized()} maximized=${mainWindow.isMaximized()} fullscreen=${mainWindow.isFullScreen()} url=${mainWindow.webContents.getURL().slice(0, 50)}`);
    }
    console.log(`[diag] ${diagDumpTs()} GPU status:`, JSON.stringify(app.getGPUFeatureStatus()));
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
