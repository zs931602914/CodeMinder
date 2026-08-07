import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import { sessionManager } from './session-manager';
import { ptyService } from './pty-service';
import {
  buildInitialPrompt,
  validateSpawnBody,
  deriveTitle,
  buildClaudeSpawnCommand,
  SpawnBody,
} from './spawn-prompt';

export type SpawnResult = { id: string; title: string };
export type SpawnErrorResponse = { error: string };

/**
 * 处理 /spawn 请求：校验 → 建会话 → 构造 prompt → 注入 claude 命令 → 建 pty → focus → 广播。
 * 成功返回 { id, title }；失败返回 { error }（由路由层映射为 400）。
 */
export function handleSpawn(rawBody: unknown): SpawnResult | SpawnErrorResponse {
  const validation = validateSpawnBody(rawBody);
  if (!validation.ok) {
    return { error: validation.error ?? '参数校验失败' };
  }
  const body: SpawnBody = validation.normalized;

  if (body.cwd) {
    try {
      if (!fs.existsSync(body.cwd)) {
        return { error: `cwd 不存在: ${body.cwd}` };
      }
    } catch {
      return { error: `cwd 不可访问: ${body.cwd}` };
    }
  }

  const fallbackIndex = sessionManager.getAll().length + 1;
  const title = deriveTitle(body, fallbackIndex);
  const session = sessionManager.create(title);

  const prompt = buildInitialPrompt(body);
  const initialCommand = buildClaudeSpawnCommand(prompt);

  try {
    ptyService.create(session.id, { cwd: body.cwd, initialCommand });
  } catch (e) {
    // pty 创建失败（如 ConPTY 初始化失败）：回滚会话，避免孤儿会话
    sessionManager.delete(session.id);
    return { error: `派生终端失败: ${(e as Error).message}` };
  }

  if (body.focus !== false) {
    sessionManager.setActive(session.id);
  }

  broadcastSessionsUpdate();

  return { id: session.id, title: session.title };
}

/**
 * 广播会话列表到渲染进程（与 terminals.ts 的 sendSessionsUpdate 等价）。
 */
function broadcastSessionsUpdate(): void {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('terminal:sessions', {
      sessions: sessionManager.getAll(),
      activeId: sessionManager.getActiveId(),
    });
  }
}
