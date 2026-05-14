/**
 * 命名管道桥接服务
 *
 * 持久化监听 Windows 命名管道，接收通知并转发到 HTTP 通知服务
 *
 * Windows 命名管道路径: \\.\pipe\cctm-notify
 * 输入格式: <type> [terminalId]
 * 示例: "auth_required" 或 "auth_required abc-123-def-456"
 */

import * as net from 'net';
import * as http from 'http';
import { EventEmitter } from 'events';

export class NamedPipeBridgeService extends EventEmitter {
  private pipeServer: net.Server | null = null;
  private readonly PIPE_NAME = 'cctm-notify';
  private readonly PIPE_PATH = '\\\\.\\pipe\\cctm-notify';
  private readonly HTTP_PORT = 13452;
  private readonly HTTP_HOST = '127.0.0.1';
  private isRunning = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_DELAY = 3000; // 3 秒

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
   * 启动命名管道服务器
   */
  start(): void {
    if (this.isRunning) {
      console.log(`${this.getTimestamp()} [CCTM Pipe Bridge] 已在运行中`);
      return;
    }

    try {
      // 清理可能存在的旧管道
      this.cleanupExistingPipe();

      // 创建命名管道服务器
      this.pipeServer = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      // Windows 命名管道使用 IPC 路径
      this.pipeServer.listen(this.PIPE_PATH, () => {
        this.isRunning = true;
        this.reconnectAttempts = 0;
        console.log(`${this.getTimestamp()} [CCTM Pipe Bridge] 命名管道服务已启动: ${this.PIPE_PATH}`);
      });

      this.pipeServer.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`${this.getTimestamp()} [CCTM Pipe Bridge] 管道已存在，尝试清理后重启...`);
          this.cleanupAndRestart();
        } else {
          console.error(`${this.getTimestamp()} [CCTM Pipe Bridge] 服务器错误:`, err);
          this.scheduleReconnect();
        }
      });

    } catch (error) {
      console.error(`${this.getTimestamp()} [CCTM Pipe Bridge] 启动失败:`, error);
      this.scheduleReconnect();
    }
  }

  /**
   * 清理已存在的管道
   */
  private cleanupExistingPipe(): void {
    try {
      // 尝试连接并立即断开，以清理旧管道
      const testClient = net.createConnection(this.PIPE_PATH, () => {
        testClient.destroy();
      });
      testClient.on('error', () => {
        // 管道不存在或无法连接，这是正常情况
      });
      testClient.setTimeout(100);
      testClient.on('timeout', () => {
        testClient.destroy();
      });
    } catch (error) {
      // 忽略清理错误
    }
  }

  /**
   * 清理并重启服务
   */
  private cleanupAndRestart(): void {
    if (this.pipeServer) {
      this.pipeServer.close(() => {
        this.isRunning = false;
        setTimeout(() => this.start(), 500);
      });
    }
  }

  /**
   * 处理客户端连接
   */
  private handleConnection(socket: net.Socket): void {
    const clientAddress = socket.remoteAddress || 'unknown';
    console.log(`${this.getTimestamp()} [CCTM Pipe Bridge] 客户端连接: ${clientAddress}`);

    let buffer = '';

    socket.on('data', (data: Buffer) => {
      buffer += data.toString('utf8');

      // 按行处理输入
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || ''; // 保留不完整的行

      for (const line of lines) {
        if (line.trim()) {
          this.processMessage(line.trim(), clientAddress);
        }
      }
    });

    socket.on('end', () => {
      // 处理缓冲区中剩余的数据
      if (buffer.trim()) {
        this.processMessage(buffer.trim(), clientAddress);
      }
    });

    socket.on('error', (err) => {
      console.error(`${this.getTimestamp()} [CCTM Pipe Bridge] 客户端错误:`, err.message);
    });
  }

  /**
   * 处理接收到的消息
   * @param message 消息内容，格式: "<type> [terminalId]"
   * @param clientAddress 客户端地址
   */
  private processMessage(message: string, clientAddress: string): void {
    console.log(`${this.getTimestamp()} [CCTM Pipe Bridge] 收到消息: "${message}" (来自: ${clientAddress})`);

    // 解析消息格式: <type> [terminalId]
    const parts = message.split(/\s+/);
    const type = parts[0];
    const terminalId = parts[1] || null;

    // 验证通知类型
    const validTypes = ['auth_required', 'session_ended', 'error'];
    if (!validTypes.includes(type)) {
      console.warn(`${this.getTimestamp()} [CCTM Pipe Bridge] 无效的通知类型: ${type}`);
      return;
    }

    // 转发到 HTTP 通知服务
    this.forwardToHttpService(terminalId, type);
  }

  /**
   * 转发通知到 HTTP 通知服务
   * @param terminalId 终端 ID（可选）
   * @param type 通知类型
   */
  private forwardToHttpService(terminalId: string | null, type: string): void {
    const postData = JSON.stringify({
      terminalId: terminalId,
      type: type,
      timestamp: Date.now(),
      source: 'named-pipe-bridge' // 标识来源
    });

    const options = {
      hostname: this.HTTP_HOST,
      port: this.HTTP_PORT,
      path: '/notify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 2000,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log(`${this.getTimestamp()} [CCTM Pipe Bridge] 转发成功: ${type} (终端: ${terminalId || '活动终端'})`);
        } else {
          console.error(`${this.getTimestamp()} [CCTM Pipe Bridge] HTTP ${res.statusCode}: ${data}`);
        }
      });
    });

    req.on('error', (error) => {
      if (error.code === 'ECONNREFUSED') {
        console.warn(`${this.getTimestamp()} [CCTM Pipe Bridge] HTTP 通知服务未运行`);
      } else {
        console.error(`${this.getTimestamp()} [CCTM Pipe Bridge] 转发失败:`, error.message);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      console.error(`${this.getTimestamp()} [CCTM Pipe Bridge] 转发超时`);
    });

    req.write(postData);
    req.end();
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error(`${this.getTimestamp()} [CCTM Pipe Bridge] 达到最大重连次数，停止重试`);
      return;
    }

    if (this.reconnectTimer) {
      return; // 已经有重连定时器在运行
    }

    this.reconnectAttempts++;
    const delay = this.RECONNECT_DELAY * this.reconnectAttempts;

    console.log(`${this.getTimestamp()} [CCTM Pipe Bridge] ${delay / 1000}秒后重试启动 (${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, delay);
  }

  /**
   * 停止命名管道服务器
   */
  stop(): void {
    this.isRunning = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.pipeServer) {
      this.pipeServer.close(() => {
        console.log(`${this.getTimestamp()} [CCTM Pipe Bridge] 命名管道服务已停止`);
      });
      this.pipeServer = null;
    }
  }

  /**
   * 获取服务状态
   */
  getStatus(): { isRunning: boolean; pipePath: string } {
    return {
      isRunning: this.isRunning,
      pipePath: this.PIPE_PATH
    };
  }
}

// 单例导出
export const namedPipeBridgeService = new NamedPipeBridgeService();
