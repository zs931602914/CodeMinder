import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { sessionManager } from './session-manager';
import { NotificationType } from '../../renderer/types/terminal';
import { BrowserWindow, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 终端数据事件
 */
export interface PtyDataEvent {
  terminalId: string;
  data: string;
}

/**
 * 终端退出事件
 */
export interface PtyExitEvent {
  terminalId: string;
  exitCode: number;
}

/**
 * PTY 服务 - 管理所有伪终端实例
 */
export class PtyService extends EventEmitter {
  private ptys: Map<string, pty.IPty> = new Map();

  /**
   * 解析 codeminder-spawn.js 的绝对路径（适配开发与打包）。
   * 打包后位于 extraResource（process.resourcesPath/tools）；开发时位于项目根 tools/。
   */
  private resolveSpawnScriptPath(): string | null {
    const candidates = [
      path.join(process.resourcesPath, 'tools', 'codeminder-spawn.js'),
      path.join(app.getAppPath(), '..', 'tools', 'codeminder-spawn.js'),
      path.join(__dirname, '..', '..', 'tools', 'codeminder-spawn.js'),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        // 忽略不可访问路径
      }
    }
    return null;
  }

  /**
   * 创建新的伪终端
   * @param terminalId 终端唯一标识
   * @param options 可选：shell 路径、cwd、initialCommand（PowerShell 命令，创建时通过 -Command 注入）
   */
  create(
    terminalId: string,
    options: { shell?: string; cwd?: string; initialCommand?: string } = {}
  ): pty.IPty {
    if (this.ptys.has(terminalId)) {
      throw new Error(`Terminal ${terminalId} already exists`);
    }

    const shellPath = options.shell || 'powershell.exe';
    const spawnArgs = options.initialCommand
      ? ['-NoLogo', '-NoExit', '-Command', options.initialCommand]
      : [];

    const spawnScriptPath = this.resolveSpawnScriptPath();

    const terminalEnv: Record<string, string> = {
      ...process.env,
      CCTM_TERMINAL_ID: terminalId,
      // 确保使用 UTF-8 编码
      LANG: 'zh_CN.UTF-8',
      CHCP: '65001', // Windows 代码页 65001 表示 UTF-8
    };
    if (spawnScriptPath) {
      terminalEnv.CCTM_SPAWN_SCRIPT = spawnScriptPath;
    }

    const ptyProcess = pty.spawn(shellPath, spawnArgs, {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: options.cwd || process.env.HOME || process.env.USERPROFILE || '.',
      env: terminalEnv,
      useConpty: true, // Windows 下使用 ConPTY
      encoding: 'utf8', // 显式设置 UTF-8 编码
    });

    // 监听终端输出
    ptyProcess.onData((data: string) => {
      this.emit('data', { terminalId, data } as PtyDataEvent);
    });

    // 监听终端退出
    ptyProcess.onExit(({ exitCode }) => {
      this.emit('exit', {
        terminalId,
        exitCode,
      } as PtyExitEvent);

      // 触发会话结束通知
      sessionManager.setNotification(terminalId, NotificationType.SESSION_ENDED);

      // 发送通知更新到渲染进程
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:notificationUpdate',
          sessionManager.getAllNotifications()
        );
      }

      this.ptys.delete(terminalId);
    });

    this.ptys.set(terminalId, ptyProcess);
    return ptyProcess;
  }

  /**
   * 销毁指定的伪终端
   * @param terminalId 终端唯一标识
   */
  destroy(terminalId: string): void {
    const ptyProcess = this.ptys.get(terminalId);
    if (ptyProcess) {
      ptyProcess.kill();
      this.ptys.delete(terminalId);
    }
  }

  /**
   * 向指定终端写入数据
   * @param terminalId 终端唯一标识
   * @param data 要写入的数据
   */
  write(terminalId: string, data: string): void {
    const ptyProcess = this.ptys.get(terminalId);
    if (ptyProcess) {
      ptyProcess.write(data);
    }
  }

  /**
   * 调整终端尺寸
   * @param terminalId 终端唯一标识
   * @param cols 列数
   * @param rows 行数
   */
  resize(terminalId: string, cols: number, rows: number): void {
    const ptyProcess = this.ptys.get(terminalId);
    if (ptyProcess) {
      ptyProcess.resize(cols, rows);
    }
  }

  /**
   * 检查终端是否存在
   * @param terminalId 终端唯一标识
   */
  has(terminalId: string): boolean {
    return this.ptys.has(terminalId);
  }

  /**
   * 获取所有终端 ID
   */
  getTerminalIds(): string[] {
    return Array.from(this.ptys.keys());
  }

  /**
   * 销毁所有终端
   */
  destroyAll(): void {
    for (const [id, ptyProcess] of this.ptys) {
      ptyProcess.kill();
    }
    this.ptys.clear();
  }
}

// 单例导出
export const ptyService = new PtyService();
