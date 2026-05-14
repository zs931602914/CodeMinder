import { ipcMain, BrowserWindow } from 'electron';
import { ptyService, PtyDataEvent, PtyExitEvent } from '../services/pty-service';
import { sessionManager } from '../services/session-manager';
import { windowFlashManager } from '../services/window-flash-manager';
import { NotificationType } from '../../renderer/types/terminal';

/**
 * UUID v4 格式验证正则
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 验证 UUID 格式
 */
function isValidUUID(id: unknown): id is string {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

/**
 * 验证会话 ID 是否存在
 */
function sessionExists(id: string): boolean {
  return sessionManager.getAll().some(s => s.id === id);
}

/**
 * 验证并返回安全的会话 ID，如果无效则抛出错误
 */
function validateSessionId(id: unknown, mustExist: boolean = false): string {
  if (!isValidUUID(id)) {
    throw new Error(`Invalid session ID format: ${id}`);
  }
  if (mustExist && !sessionExists(id)) {
    throw new Error(`Session not found: ${id}`);
  }
  return id;
}

/**
 * 验证数值类型参数
 */
function validatePositiveInteger(value: unknown, paramName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${paramName} must be a positive integer, got: ${value}`);
  }
  return value;
}

/**
 * 验证字符串参数
 */
function validateNonEmptyString(value: unknown, paramName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${paramName} must be a non-empty string, got: ${value}`);
  }
  if (value.length > 1000) {
    throw new Error(`${paramName} is too long (max 1000 chars)`);
  }
  return value;
}

/**
 * 验证通知类型
 */
function isValidNotificationType(type: unknown): type is NotificationType {
  return typeof type === 'string' && Object.values(NotificationType).includes(type as NotificationType);
}

/**
 * 注册终端相关的 IPC 处理器
 */
export function registerTerminalIpcHandlers(): void {
  // 创建新终端
  ipcMain.handle('terminal:create', async () => {
    const session = sessionManager.create();
    const pty = ptyService.create(session.id);

    // 发送会话列表更新通知
    sendSessionsUpdate();

    return {
      id: session.id,
      title: session.title,
      pid: pty.pid,
    };
  });

  // 销毁终端
  ipcMain.handle('terminal:destroy', async (_, id: string) => {
    const validId = validateSessionId(id, true);
    ptyService.destroy(validId);
    sessionManager.delete(validId);
    sendSessionsUpdate();
  });

  // 向终端写入数据
  ipcMain.on('terminal:write', (_, { id, data }: { id: string; data: string }) => {
    const validId = validateSessionId(id, true);
    // 验证并限制数据长度，防止内存溢出攻击
    if (typeof data !== 'string') {
      console.warn('[IPC] Invalid data type for terminal:write');
      return;
    }
    if (data.length > 100_000) { // 100KB 限制
      console.warn('[IPC] Data too large for terminal:write');
      return;
    }
    ptyService.write(validId, data);
  });

  // 调整终端尺寸
  ipcMain.on('terminal:resize', (_, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    const validId = validateSessionId(id, true);
    const validCols = validatePositiveInteger(cols, 'cols');
    const validRows = validatePositiveInteger(rows, 'rows');
    // 限制合理的终端尺寸范围
    if (validCols > 1000 || validRows > 1000) {
      console.warn('[IPC] Terminal size too large:', validCols, 'x', validRows);
      return;
    }
    ptyService.resize(validId, validCols, validRows);
  });

  // 获取所有会话
  ipcMain.handle('terminal:getSessions', async () => {
    return sessionManager.getAll();
  });

  // 更新终端标题
  ipcMain.handle('terminal:updateTitle', async (_, id: string, title: string) => {
    const validId = validateSessionId(id, true);
    const validTitle = validateNonEmptyString(title, 'title');
    sessionManager.updateTitle(validId, validTitle);
    sendSessionsUpdate();
  });

  // 切换置顶状态
  ipcMain.handle('terminal:togglePinned', async (_, id: string) => {
    const validId = validateSessionId(id, true);
    const pinned = sessionManager.togglePinned(validId);
    sendSessionsUpdate();
    return { pinned };
  });

  // 设置活动会话
  ipcMain.on('terminal:setActive', (_, id: string) => {
    const validId = validateSessionId(id);
    // 允许设置为 null（取消活动状态）
    if (validId || id === null) {
      sessionManager.setActive(validId);
      sendSessionsUpdate();
    }
  });

  // 设置通知状态
  ipcMain.on('terminal:setNotification', (_, { terminalId, type }: { terminalId: string; type: NotificationType }) => {
    const validId = validateSessionId(terminalId, true);
    if (!isValidNotificationType(type)) {
      console.warn('[IPC] Invalid notification type:', type);
      return;
    }
    sessionManager.setNotification(validId, type);
    sendNotificationUpdate();
  });

  // 清除通知状态
  ipcMain.on('terminal:clearNotification', (_, terminalId: string) => {
    const validId = validateSessionId(terminalId, true);
    sessionManager.clearNotification(validId);
    // 更新闪烁状态
    windowFlashManager.updateFlashState();
    sendNotificationUpdate();
  });

  // 直接触发通知（不经过终端命令）
  ipcMain.on('terminal:triggerNotification', (_, { terminalId, type }: { terminalId: string; type: NotificationType }) => {
    const validId = validateSessionId(terminalId, true);
    if (!isValidNotificationType(type)) {
      console.warn('[IPC] Invalid notification type:', type);
      return;
    }
    const changed = sessionManager.setNotification(validId, type);
    if (changed) {
      sendNotificationUpdate();
    }
  });

  // 监听 PTY 数据输出，转发到渲染进程
  ptyService.on('data', (event: PtyDataEvent) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:data', {
        terminalId: event.terminalId,
        data: event.data,
      });
    }
  });

  // 监听 PTY 退出事件
  ptyService.on('exit', (event: PtyExitEvent) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:exit', {
        terminalId: event.terminalId,
        exitCode: event.exitCode,
      });
    }
  });
}

/**
 * 发送会话列表更新到渲染进程
 */
function sendSessionsUpdate(): void {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (mainWindow && !mainWindow.isDestroyed()) {
    const sessions = sessionManager.getAll();
    const activeId = sessionManager.getActiveId();
    mainWindow.webContents.send('terminal:sessions', { sessions, activeId });
  }
}

/**
 * 发送通知更新到渲染进程
 */
function sendNotificationUpdate(): void {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('terminal:notificationUpdate',
      sessionManager.getAllNotifications()
    );
  }
  // 更新闪烁状态
  windowFlashManager.updateFlashState();
}
