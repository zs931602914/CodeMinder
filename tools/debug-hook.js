/**
 * CCTM Hook 调试工具
 * 用于在 Claude Code hooks 中调试环境变量和通知
 */

const fs = require('fs');
const path = require('path');

// 调试日志文件路径
const debugLogPath = path.join(__dirname, 'hook-debug.log');

/**
 * 写入调试日志
 */
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(message);
  fs.appendFileSync(debugLogPath, logMessage);
}

/**
 * 主调试函数
 */
function debug() {
  log('=== CCTM Hook 调试开始 ===');

  // 1. 检查环境变量
  log('--- 环境变量检查 ---');
  const terminalId = process.env.CCTM_TERMINAL_ID;
  if (terminalId) {
    log(`✓ CCTM_TERMINAL_ID = ${terminalId}`);
  } else {
    log('✗ CCTM_TERMINAL_ID 未设置');
    log('所有环境变量:');
    Object.keys(process.env).forEach(key => {
      if (key.includes('CCTM') || key.includes('claude')) {
        log(`  ${key} = ${process.env[key]}`);
      }
    });
  }

  // 2. 检查进程信息
  log('--- 进程信息 ---');
  log(`PID: ${process.pid}`);
  log(`PPID: ${process.ppid}`);
  log(`CWD: ${process.cwd()}`);
  log(`执行命令: ${process.argv.join(' ')}`);

  // 3. 检查父进程（可能是 Claude Code）
  log('--- 父进程信息 ---');
  try {
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      const parentPid = process.ppid;
      try {
        const parentInfo = execSync(
          `wmic process where ProcessId=${parentPid} get Name,CommandLine /format:list`,
          { encoding: 'utf-8' }
        );
        log(`父进程 (PID: ${parentPid}):\n${parentInfo}`);
      } catch (e) {
        log(`无法获取父进程信息: ${e.message}`);
      }
    }
  } catch (error) {
    log(`获取父进程信息失败: ${error.message}`);
  }

  // 4. 尝试发送通知
  log('--- 尝试发送通知 ---');
  if (terminalId) {
    try {
      const http = require('http');
      const postData = JSON.stringify({
        terminalId: terminalId,
        type: 'auth_required',
        timestamp: Date.now(),
      });

      const options = {
        hostname: '127.0.0.1',
        port: 13452,
        path: '/notify',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 2000,
      };

      log(`发送 HTTP 请求到 http://127.0.0.1:13452/notify`);
      log(`请求数据: ${postData}`);

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          log(`HTTP 响应状态: ${res.statusCode}`);
          log(`HTTP 响应数据: ${data}`);
          if (res.statusCode === 200) {
            log('✓ 通知发送成功！');
          } else {
            log(`✗ 通知发送失败，状态码: ${res.statusCode}`);
          }
          log('=== 调试完成 ===\n');
        });
      });

      req.on('error', (error) => {
        log(`✗ HTTP 请求失败: ${error.message}`);
        log('错误详情:');
        log(`  错误代码: ${error.code}`);
        log(`  系统消息: ${error.syscall}`);
        log('=== 调试完成 ===\n');
      });

      req.on('timeout', () => {
        req.destroy();
        log('✗ HTTP 请求超时');
        log('=== 调试完成 ===\n');
      });

      req.write(postData);
      req.end();

    } catch (error) {
      log(`✗ 发送通知异常: ${error.message}`);
      log('=== 调试完成 ===\n');
    }
  } else {
    log('跳过发送通知（没有终端 ID）');
    log('=== 调试完成 ===\n');
  }
}

// 执行调试
debug();
