import * as http from 'http';
import { sessionManager } from './session-manager';
import { windowFlashManager } from './window-flash-manager';
import { NotificationType } from '../../renderer/types/terminal';
import { BrowserWindow } from 'electron';

/**
 * HTTP 通知服务 - 监听本地端口接收通知
 */
export class HttpNotificationService {
  private server: http.Server | null = null;
  private readonly PORT = 13452; // 本地端口

  /**
   * 生成带时戳的日志前缀
   */
  private getTimestamp(): string {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `[${hours}:${minutes}:${seconds}.${ms}]`;
  }

  /**
   * 启动 HTTP 服务器
   */
  start(): void {
    if (this.server) {
      return;
    }

    this.server = http.createServer((req, res) => {
      // 设置 CORS 头
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      // 处理 OPTIONS 预检请求
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // 只处理 POST 请求到 /notify
      if (req.method === 'POST' && req.url === '/notify') {
        let body = '';

        req.on('data', (chunk) => {
          body += chunk.toString();
        });

        req.on('end', () => {
          try {
            const notification = JSON.parse(body);
            this.handleNotification(notification);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, message: '通知已发送' }));
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '无效的 JSON 格式' }));
          }
        });
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('未找到');
      }
    });

    this.server.listen(this.PORT, '127.0.0.1', () => {
      console.log(`[CCTM] HTTP 通知服务已启动: http://127.0.0.1:${this.PORT}`);
    });

    this.server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[CCTM] 端口 ${this.PORT} 已被占用，请检查是否有其他实例运行`);
      } else {
        console.error('[CCTM] HTTP 通知服务错误:', err);
      }
    });
  }

  /**
   * 处理通知
   */
  private handleNotification(notification: any): void {
    const { terminalId, type } = notification;

    console.log(`${this.getTimestamp()} [CCTM HTTP] 收到通知请求:`, notification);

    if (!type) {
      console.error(`${this.getTimestamp()} [CCTM HTTP] 无效的通知数据:`, notification);
      return;
    }

    // 验证通知类型
    let notificationType: NotificationType;
    switch (type) {
      case 'auth_required':
        notificationType = NotificationType.AUTH_REQUIRED;
        break;
      case 'session_ended':
        notificationType = NotificationType.SESSION_ENDED;
        break;
      case 'error':
        notificationType = NotificationType.ERROR;
        break;
      default:
        console.error(`${this.getTimestamp()} [CCTM HTTP] 未知的通知类型:`, type);
        return;
    }

    // 验证 terminalId 有效性
    // 必须有有效 terminalId 才处理，否则直接忽略
    if (!terminalId) {
      console.log(`${this.getTimestamp()} [CCTM HTTP] 未指定 terminalId，忽略通知`);
      return;
    }

    if (!this.isValidTerminalId(terminalId)) {
      console.log(`${this.getTimestamp()} [CCTM HTTP] 忽略无效的 terminalId (非 CCTM 终端): "${terminalId}"`);
      return;
    }

    const targetTerminalId = terminalId;

    console.log(`${this.getTimestamp()} [CCTM HTTP] 目标终端:`, targetTerminalId, '类型:', notificationType);

    // 设置通知状态（只有状态变化时才发送更新）
    const changed = sessionManager.setNotification(targetTerminalId, notificationType);

    console.log(`${this.getTimestamp()} [CCTM HTTP] 状态是否变化:`, changed);

    if (changed) {
      // 发送更新到渲染进程
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow && !mainWindow.isDestroyed()) {
        const notifications = sessionManager.getAllNotifications();
        console.log(`${this.getTimestamp()} [CCTM HTTP] 发送通知到渲染进程:`, notifications);
        mainWindow.webContents.send('terminal:notificationUpdate', notifications);
      } else {
        console.error(`${this.getTimestamp()} [CCTM HTTP] 主窗口不可用`);
      }
      // 更新任务栏闪烁状态
      windowFlashManager.updateFlashState();
    }
  }

  /**
   * 验证 terminalId 是否有效
   *
   * 有效格式：UUID v4 格式
   * 无效示例：%CCTM_TERMINAL_ID% (未展开的环境变量)
   */
  private isValidTerminalId(terminalId: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(terminalId);
  }

  /**
   * 停止 HTTP 服务器
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      console.log('[CCTM] HTTP 通知服务已停止');
    }
  }

  /**
   * 获取服务端口
   */
  getPort(): number {
    return this.PORT;
  }
}

// 单例导出
export const httpNotificationService = new HttpNotificationService();
