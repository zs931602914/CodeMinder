/**
 * CCTM 通知诊断工具
 * 用于检查环境变量和测试通知功能
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('=== CCTM 通知诊断工具 ===\n');

// 1. 检查环境变量
console.log('1. 检查环境变量:');
const terminalId = process.env.CCTM_TERMINAL_ID;
if (terminalId) {
  console.log('   ✓ CCTM_TERMINAL_ID =', terminalId);
} else {
  console.log('   ✗ CCTM_TERMINAL_ID 未设置');
  console.log('   说明: 此脚本需要在 CCTM 终端内运行');
}

// 2. 检查工具文件是否存在
console.log('\n2. 检查工具文件:');
const toolPath = path.join(__dirname, 'cctm-notify.js');
if (fs.existsSync(toolPath)) {
  console.log('   ✓ cctm-notify.js 存在');
} else {
  console.log('   ✗ cctm-notify.js 不存在');
}

// 3. 检查 CCTM 服务是否运行
console.log('\n3. 检查 CCTM 服务:');
try {
  const http = require('http');
  const options = {
    hostname: '127.0.0.1',
    port: 13452,
    path: '/notify',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    timeout: 1000,
  };

  const req = http.request(options, (res) => {
    if (res.statusCode === 200 || res.statusCode === 400) {
      console.log('   ✓ CCTM HTTP 服务正在运行');
    } else {
      console.log('   ? CCTM HTTP 服务响应异常:', res.statusCode);
    }
  });

  req.on('error', () => {
    console.log('   ✗ CCTM HTTP 服务未运行');
    console.log('   请确保 CCTM 应用已启动');
  });

  req.on('timeout', () => {
    req.destroy();
    console.log('   ✗ CCTM HTTP 服务响应超时');
  });

  req.write(JSON.stringify({ type: 'error' }));
  req.end();
} catch (error) {
  console.log('   ✗ 无法连接 CCTM 服务');
}

// 4. 检查 Claude Code hooks 配置
console.log('\n4. 检查 Claude Code hooks 配置:');
const configPaths = [
  path.join(process.env.USERPROFILE || '', '.claude', 'config.json'),
  path.join(process.env.HOME || '', '.claude', 'config.json'),
];

let configFound = false;
for (const configPath of configPaths) {
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.hooks) {
        console.log('   ✓ 找到 hooks 配置:', configPath);
        console.log('   配置内容:', JSON.stringify(config.hooks, null, 2).split('\n').map(line => '     ' + line).join('\n'));
        configFound = true;
        break;
      }
    } catch (error) {
      // 忽略解析错误
    }
  }
}

if (!configFound) {
  console.log('   ? 未找到 hooks 配置');
  console.log('   配置文件位置: %USERPROFILE%\\.claude\\config.json');
}

// 5. 测试通知
console.log('\n5. 测试发送通知:');
if (terminalId) {
  console.log('   正在发送测试通知...');
  try {
    const result = execSync('node cctm-notify.js auth_required', {
      cwd: __dirname,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5000,
    });
    console.log('   ✓ 通知发送成功');
    console.log('   输出:', result.trim());
  } catch (error) {
    console.log('   ✗ 通知发送失败');
    console.log('   错误:', error.message);
  }
} else {
  console.log('   跳过（没有终端 ID）');
}

console.log('\n=== 诊断完成 ===');
