/**
 * CCTM 通知工具 - 命令行触发通知
 *
 * 用法: node cctm-notify.js <type> [terminalId]
 *
 * 示例:
 *   node cctm-notify.js auth_required              # 发送到活动终端
 *   node cctm-notify.js error                      # 发送到活动终端
 *   node cctm-notify.js session_ended <terminal-id>  # 发送到指定终端
 *
 * 如果不指定 terminalId，工具会自动从 CCTM 获取当前活动终端 ID。
 */

const http = require('http');

// 配置
const PORT = 13452;
const HOST = '127.0.0.1';

// 端点配置
const ENDPOINTS = {
  NOTIFY: '/notify'
};

// 获取命令行参数
const [, , type, terminalId] = process.argv;

// 尝试从环境变量获取终端 ID（优先级低于命令行参数）
const envTerminalId = process.env.CCTM_TERMINAL_ID;

// 验证通知类型
const validTypes = ['auth_required', 'session_ended', 'error'];
if (!type || !validTypes.includes(type)) {
  console.error('用法: node cctm-notify.js <type> [terminalId]');
  console.error('');
  console.error('通知类型:');
  console.error('  auth_required   - 需要用户授权/操作');
  console.error('  session_ended   - 会话结束');
  console.error('  error           - 发生错误');
  console.error('');
  console.error('可选参数:');
  console.error('  terminalId      - 指定终端 ID（默认从环境变量读取当前终端）');
  process.exit(1);
}

/**
 * 发送通知请求
 * @param {string} terminalId - 终端 ID
 * @param {string} type - 通知类型
 * @returns {Promise<void>}
 */
function sendNotification(terminalId, type) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      terminalId: terminalId,
      type: type,
      timestamp: Date.now(),
    });

    const options = {
      hostname: HOST,
      port: PORT,
      path: ENDPOINTS.NOTIFY,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 2000,
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const response = JSON.parse(data);
            if (response.success) {
              resolve();
            } else {
              reject(new Error(response.message || '未知错误'));
            }
          } catch {
            resolve();
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      if (error.code === 'ECONNREFUSED') {
        reject(new Error(`无法连接到 CCTM 服务 (端口 ${PORT})`));
      } else {
        reject(new Error(`发送通知失败: ${error.message}`));
      }
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * 主执行逻辑
 */
async function main() {
  try {
    let targetTerminalId = terminalId;
    let idSource = '命令行参数';

    // 优先级：命令行参数 > 环境变量
    if (!targetTerminalId) {
      if (envTerminalId) {
        targetTerminalId = envTerminalId;
        idSource = '环境变量 (当前终端)';
        console.log(`从环境变量获取终端 ID: ${targetTerminalId}`);
      } else {
        // 无法获取 CCTM_TERMINAL_ID，静默退出，不做通知
        process.exit(0);
        return;
      }
    }

    // 发送通知
    await sendNotification(targetTerminalId, type);
    console.log(`通知已发送: ${type} (终端: ${targetTerminalId}, 来源: ${idSource})`);
    process.exit(0);

  } catch (error) {
    console.error(`错误: ${error.message}`);

    // 提供友好的错误提示
    if (error.message.includes('无法连接')) {
      console.error('');
      console.error('提示: 请确保 CCTM 应用正在运行');
    }

    process.exit(1);
  }
}

// 执行主函数
main();
