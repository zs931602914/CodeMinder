import { contextBridge, ipcRenderer } from 'electron';
import { NotificationType, Notification } from '../renderer/types/terminal';

/**
 * 终端会话信息
 */
export interface TerminalSession {
  id: string;
  title: string;
  pinned?: boolean;
}

/**
 * 终端 API 暴露给渲染进程
 */
export interface ElectronAPI {
  // 终端操作
  createTerminal: () => Promise<{ id: string; title: string; pid: number }>;
  destroyTerminal: (id: string) => Promise<void>;
  terminalWrite: (id: string, data: string) => void;
  terminalResize: (id: string, cols: number, rows: number) => void;
  getSessions: () => Promise<TerminalSession[]>;
  setActiveTerminal: (id: string) => void;
  updateTerminalTitle: (id: string, title: string) => Promise<void>;
  toggleTerminalPinned: (id: string) => Promise<void>;

  // 剪贴板操作
  clipboardReadForPaste: () => Promise<{ type: 'image'; path: string } | { type: 'text'; text: string } | null>;

  // Hook 配置
  getHookConfig: () => Promise<{ config: string; hookPath: string; exists: boolean }>;
  copyHookConfig: () => Promise<{ success: boolean }>;

  // 通知操作
  setNotification: (terminalId: string, type: NotificationType) => void;
  clearNotification: (terminalId: string) => void;
  triggerNotification: (terminalId: string, type: NotificationType) => void;

  // 事件监听
  onTerminalData: (callback: (terminalId: string, data: string) => void) => () => void;
  onTerminalExit: (callback: (terminalId: string, exitCode: number) => void) => () => void;
  onSessionsUpdate: (callback: (sessions: TerminalSession[], activeId: string | null) => void) => () => void;
  onNotificationUpdate: (callback: (notifications: Notification[]) => void) => () => void;
}

// 暴露安全的 API 到渲染进程
const electronAPI: ElectronAPI = {
  // 终端操作
  createTerminal: () => ipcRenderer.invoke('terminal:create'),
  destroyTerminal: (id: string) => ipcRenderer.invoke('terminal:destroy', id),
  terminalWrite: (id: string, data: string) => {
    ipcRenderer.send('terminal:write', { id, data });
  },
  terminalResize: (id: string, cols: number, rows: number) => {
    ipcRenderer.send('terminal:resize', { id, cols, rows });
  },
  getSessions: () => ipcRenderer.invoke('terminal:getSessions'),
  setActiveTerminal: (id: string) => {
    ipcRenderer.send('terminal:setActive', id);
  },
  updateTerminalTitle: (id: string, title: string) => {
    return ipcRenderer.invoke('terminal:updateTitle', id, title);
  },
  toggleTerminalPinned: (id: string) => {
    return ipcRenderer.invoke('terminal:togglePinned', id);
  },

  // 剪贴板操作
  clipboardReadForPaste: () => ipcRenderer.invoke('clipboard:read-for-paste'),

  // Hook 配置
  getHookConfig: () => ipcRenderer.invoke('hook-config:get'),
  copyHookConfig: () => ipcRenderer.invoke('hook-config:copy'),

  // 通知操作
  setNotification: (terminalId: string, type: NotificationType) => {
    ipcRenderer.send('terminal:setNotification', { terminalId, type });
  },

  clearNotification: (terminalId: string) => {
    ipcRenderer.send('terminal:clearNotification', terminalId);
  },

  triggerNotification: (terminalId: string, type: NotificationType) => {
    ipcRenderer.send('terminal:triggerNotification', { terminalId, type });
  },

  // 事件监听 - 返回取消监听的函数
  onTerminalData: (callback: (terminalId: string, data: string) => void) => {
    const handler = (_: unknown, { terminalId, data }: { terminalId: string; data: string }) => {
      callback(terminalId, data);
    };
    ipcRenderer.on('terminal:data', handler);
    return () => ipcRenderer.removeListener('terminal:data', handler);
  },

  onTerminalExit: (callback: (terminalId: string, exitCode: number) => void) => {
    const handler = (_: unknown, { terminalId, exitCode }: { terminalId: string; exitCode: number }) => {
      callback(terminalId, exitCode);
    };
    ipcRenderer.on('terminal:exit', handler);
    return () => ipcRenderer.removeListener('terminal:exit', handler);
  },

  onSessionsUpdate: (callback: (sessions: TerminalSession[], activeId: string | null) => void) => {
    const handler = (_: unknown, { sessions, activeId }: { sessions: TerminalSession[]; activeId: string | null }) => {
      callback(sessions, activeId);
    };
    ipcRenderer.on('terminal:sessions', handler);
    return () => ipcRenderer.removeListener('terminal:sessions', handler);
  },

  onNotificationUpdate: (callback: (notifications: Notification[]) => void) => {
    const handler = (_: unknown, notifications: Notification[]) => callback(notifications);
    ipcRenderer.on('terminal:notificationUpdate', handler);
    return () => ipcRenderer.removeListener('terminal:notificationUpdate', handler);
  },
};

// 使用 contextBridge 安全地暴露 API
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// TypeScript 类型声明扩展
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
