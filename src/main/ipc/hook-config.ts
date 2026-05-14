import { ipcMain, app, clipboard } from 'electron';
import path from 'path';
import fs from 'fs';

/**
 * 获取 hook-notify.cmd 的实际路径
 */
function getHookNotifyPath(): string {
  // 开发环境：从应用根目录找 tools
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), 'tools', 'hook-notify.cmd');
  }

  // 打包后：在 resources/tools 目录下
  const exePath = process.execPath;
  const resourcesPath = path.join(path.dirname(exePath), 'resources');
  return path.join(resourcesPath, 'tools', 'hook-notify.cmd');
}

/**
 * 生成 Hook 配置 JSON
 */
function generateHookConfig(): string {
  const hookPath = getHookNotifyPath().replace(/\\/g, '\\\\');

  const config = {
    permissions: {
      allow: [
        'Bash(dir /B "' + hookPath + '")',
      ]
    },
    hooks: {
      PermissionRequest: [
        {
          matcher: '*',
          hooks: [{
            type: 'command',
            command: 'cmd //c "' + hookPath + '" auth_required'
          }]
        }
      ],
      Stop: [
        {
          hooks: [{
            type: 'command',
            command: 'cmd //c "' + hookPath + '" session_ended'
          }]
        }
      ]
    }
  };

  return JSON.stringify(config, null, 2);
}

/**
 * 注册 Hook 配置相关 IPC 处理器
 */
export function registerHookConfigHandlers(): void {
  // 获取 Hook 配置
  ipcMain.handle('hook-config:get', () => {
    return {
      config: generateHookConfig(),
      hookPath: getHookNotifyPath(),
      exists: fs.existsSync(getHookNotifyPath())
    };
  });

  // 复制 Hook 配置到剪贴板
  ipcMain.handle('hook-config:copy', () => {
    const config = generateHookConfig();
    clipboard.writeText(config);
    return { success: true };
  });
}
