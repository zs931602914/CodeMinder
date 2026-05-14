import { app, BrowserWindow, Menu } from 'electron';
import { registerIpcHandlers } from './ipc';
import { httpNotificationService } from './services/http-notification-service';
import { namedPipeBridgeService } from './services/named-pipe-bridge';
import { windowFlashManager } from './services/window-flash-manager';

// TypeScript 类型声明 - Electron Forge 魔法全局变量
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let mainWindow: BrowserWindow | null = null;

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
