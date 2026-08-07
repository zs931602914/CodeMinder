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

module.exports = { parseArgs, buildPayload };
