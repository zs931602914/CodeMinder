import { registerTerminalIpcHandlers } from './terminals';
import { registerHookConfigHandlers } from './hook-config';

/**
 * 注册所有 IPC 处理器
 */
export function registerIpcHandlers(): void {
  registerTerminalIpcHandlers();
  registerHookConfigHandlers();
}
