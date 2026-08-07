/**
 * CodeMinder 派生终端 CLI。
 * 用法： node "$CCTM_SPAWN_SCRIPT" [--files a,b] [--skills x,y] [--task "..."] [--cwd path] [--title "..."] [--no-focus]
 *
 * 本文件为 CommonJS，便于被 node 直接执行与被测试 require。
 */

function parseArgs(argv) {
  const opts = {
    files: [],
    skills: [],
    task: undefined,
    cwd: process.cwd(),
    title: undefined,
    focus: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--files':
        opts.files = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
        break;
      case '--skills':
        opts.skills = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
        break;
      case '--task':
        opts.task = argv[++i];
        break;
      case '--cwd':
        opts.cwd = argv[++i] || opts.cwd;
        break;
      case '--title':
        opts.title = argv[++i];
        break;
      case '--no-focus':
        opts.focus = false;
        break;
      default:
        break;
    }
  }
  return opts;
}

function buildPayload(opts) {
  const payload = { cwd: opts.cwd, focus: opts.focus };
  if (opts.files && opts.files.length) payload.files = opts.files;
  if (opts.skills && opts.skills.length) payload.skills = opts.skills;
  if (opts.task) payload.task = opts.task;
  if (opts.title) payload.title = opts.title;
  return payload;
}

const http = require('http');

const HOST = '127.0.0.1';
const PORT = 13452;

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const payload = buildPayload(opts);
  const body = JSON.stringify(payload);

  const req = http.request(
    {
      hostname: HOST,
      port: PORT,
      path: '/spawn',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          process.stdout.write(data + '\n');
          process.exit(0);
        } else {
          process.stderr.write(`派生失败 (${res.statusCode}): ${data}\n`);
          process.exit(1);
        }
      });
    }
  );

  req.on('error', (e) => {
    if (e.code === 'ECONNREFUSED') {
      process.stderr.write(`CodeMinder 未运行（无法连接 ${HOST}:${PORT}）。请先启动 CodeMinder。\n`);
    } else {
      process.stderr.write(`派生请求失败: ${e.message}\n`);
    }
    process.exit(1);
  });

  req.write(body);
  req.end();
}

module.exports = { parseArgs, buildPayload };

// 仅当直接执行时运行 main（被 require 时不触发）
if (require.main === module) {
  main();
}
