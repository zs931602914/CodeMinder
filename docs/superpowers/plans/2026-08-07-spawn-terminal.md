# Spawn-Terminal（自然语言派生终端）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 CodeMinder 终端里的 CC 能通过自然语言（或领域 skill 编排）派生一个新 CC 终端，并预置文件/skill/任务上下文。

**Architecture:** CC 用 Bash 调 `tools/codeminder-spawn.js` → HTTP `POST /spawn`（复用 13452）→ 主进程 `spawn-service` 建会话+pty，把"读文件+激活 skill+执行任务"编码成初始 prompt，以 base64 注入 `claude` 启动命令。机制（CodeMinder）与策略（领域 skill 自然语言编排）分离。

**Tech Stack:** Electron 30 + TypeScript（主进程）/ React（渲染）、node-pty、PowerShell（ConPTY）、`vitest`（新增，纯逻辑单测）、Node HTTP。

**关联 spec：** `docs/superpowers/specs/2026-08-07-spawn-terminal-design.md`

---

## File Structure

**新建：**
| 文件 | 责任 | 可测性 |
|---|---|---|
| `src/main/services/spawn-prompt.ts` | 纯逻辑：`buildInitialPrompt` / `validateSpawnBody` / `deriveTitle` / `buildClaudeSpawnCommand`。无 electron 依赖 | TDD（vitest） |
| `src/main/services/spawn-prompt.test.ts` | 上述纯逻辑的单测 | — |
| `src/main/services/spawn-service.ts` | 编排：`handleSpawn(body)` → 校验→建会话→构造 prompt→注入命令→建 pty→focus→广播 | 集成（手动） |
| `tools/codeminder-spawn.js` | CLI 入口（CJS）。`parseArgs`/`buildPayload` 纯函数 + `main`（HTTP POST） | 纯函数 TDD；main 集成 |
| `tools/codeminder-spawn.test.js` | parseArgs/buildPayload 单测（vitest） | — |
| `~/.claude/skills/spawn-terminal/SKILL.md` | 能力声明 skill（全局，内容创作） | 手动 |

**修改：**
| 文件 | 改动 |
|---|---|
| `package.json` | 加 `vitest` devDep + `"test": "vitest run"` 脚本 |
| `src/main/services/pty-service.ts` | `create(terminalId, options?)` 支持 `cwd` / `initialCommand`；注入 `CCTM_SPAWN_SCRIPT` 环境变量 |
| `src/main/services/http-notification-service.ts` | 新增 `POST /spawn` 路由分支，转交 `handleSpawn` |

**约定：** commit message 用中文，不带 `Co-Authored-By`。每个集成任务验证需 `npm start`（electron-forge 会编译主进程 + 启动）。

---

## Task 1: 引入 vitest 测试基建

**Files:**
- Modify: `package.json`
- Create: `src/main/services/sanity.test.ts`

- [ ] **Step 1: 安装 vitest**

Run:
```bash
npm install -D vitest
```
Expected: `added vitest`，`package.json` 的 `devDependencies` 出现 `"vitest"`。

- [ ] **Step 2: 加 test 脚本**

修改 `package.json` 的 `scripts`，在 `"make"` 后加一行：
```json
    "test": "vitest run",
```
（注意保持前导空格与逗号与现有脚本一致。）

- [ ] **Step 3: 写 sanity 测试**

Create `src/main/services/sanity.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';

describe('sanity', () => {
  it('vitest 正常运行', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: 运行测试验证**

Run: `npm test`
Expected: `1 passed`，退出码 0。

- [ ] **Step 5: 提交**

```bash
git add package.json package-lock.json src/main/services/sanity.test.ts
git commit -m "chore: 引入 vitest 测试基建"
```

---

## Task 2: buildInitialPrompt（TDD）

构造新 CC 的初始 prompt，让新 CC 真实执行 Read + Skill。

**Files:**
- Create: `src/main/services/spawn-prompt.ts`
- Test: `src/main/services/spawn-prompt.test.ts`

- [ ] **Step 1: 写失败测试（先建测试文件，仅 buildInitialPrompt 用例）**

Create `src/main/services/spawn-prompt.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import { buildInitialPrompt } from './spawn-prompt';

describe('buildInitialPrompt', () => {
  it('全信息：含 Read、Skill、执行任务', () => {
    const p = buildInitialPrompt({ files: ['a.md', 'b.md'], skills: ['thought-chain'], task: '整理笔记' });
    expect(p).toContain('用 Read 读取');
    expect(p).toContain('a.md');
    expect(p).toContain('b.md');
    expect(p).toContain('用 Skill 激活');
    expect(p).toContain('thought-chain');
    expect(p).toContain('整理笔记');
    expect(p).toMatch(/按顺序/);
  });

  it('files+skills 无 task：含等待指示', () => {
    const p = buildInitialPrompt({ files: ['a.md'], skills: ['x'] });
    expect(p).toContain('用 Read 读取');
    expect(p).toContain('等待我的指示');
    expect(p).not.toContain('执行任务');
  });

  it('仅 task：直接执行并提示自行确定文件', () => {
    const p = buildInitialPrompt({ task: '做测试' });
    expect(p).toContain('请开始执行任务：做测试');
    expect(p).toContain('自行确定');
  });

  it('全空：待命', () => {
    const p = buildInitialPrompt({});
    expect(p).toContain('上下文已就绪');
    expect(p).toContain('等待你的指示');
  });

  it('仅 files：含 Read 与等待指示', () => {
    const p = buildInitialPrompt({ files: ['only.md'] });
    expect(p).toContain('用 Read 读取');
    expect(p).toContain('only.md');
    expect(p).toContain('等待我的指示');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm test -- spawn-prompt`
Expected: FAIL（`Cannot find module './spawn-prompt'` 或 `buildInitialPrompt is not a function`）。

- [ ] **Step 3: 实现 spawn-prompt.ts（仅 buildInitialPrompt）**

Create `src/main/services/spawn-prompt.ts`：
```typescript
/**
 * 派生终端的纯逻辑：prompt 构造、参数校验、标题推导、注入命令构造。
 * 不依赖 electron，便于单测。
 */

export interface SpawnContext {
  files?: string[];
  skills?: string[];
  task?: string;
}

export function buildInitialPrompt(ctx: SpawnContext): string {
  const files = ctx.files?.filter(f => f && f.length > 0) ?? [];
  const skills = ctx.skills?.filter(s => s && s.length > 0) ?? [];
  const task = ctx.task?.trim();
  const hasFiles = files.length > 0;
  const hasSkills = skills.length > 0;
  const hasTask = task && task.length > 0;

  if (!hasFiles && !hasSkills && !hasTask) {
    return '上下文已就绪，等待你的指示。';
  }

  if (!hasFiles && !hasSkills) {
    return `请开始执行任务：${task}（如需读取文件请自行确定）`;
  }

  const steps: string[] = [];
  if (hasFiles) steps.push(`用 Read 读取：${files.join('、')}`);
  if (hasSkills) steps.push(`用 Skill 激活：${skills.join('、')}`);
  const indexed = steps.map((s, i) => `${i + 1}) ${s}`);

  if (hasTask) {
    indexed.push(`${indexed.length + 1}) 完成后开始执行任务：${task}`);
  } else {
    indexed.push(`${indexed.length + 1}) 完成后简述已就绪的上下文并等待我的指示`);
  }

  return `请按顺序初始化上下文：\n${indexed.join('；\n')}`;
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test -- spawn-prompt`
Expected: `5 passed`。

- [ ] **Step 5: 提交**

```bash
git add src/main/services/spawn-prompt.ts src/main/services/spawn-prompt.test.ts
git commit -m "feat(spawn): 新增初始 prompt 构造逻辑 buildInitialPrompt"
```

---

## Task 3: validateSpawnBody（TDD）

校验 `/spawn` 请求体。所有字段可选；只校验类型与长度，不校验 cwd 存在性（留到集成层）。

**Files:**
- Modify: `src/main/services/spawn-prompt.ts`
- Test: `src/main/services/spawn-prompt.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `spawn-prompt.test.ts` 顶部 import 增加 `validateSpawnBody`：
```typescript
import { buildInitialPrompt, validateSpawnBody } from './spawn-prompt';
```
在文件末尾追加：
```typescript
describe('validateSpawnBody', () => {
  it('空对象合法', () => {
    const r = validateSpawnBody({});
    expect(r.ok).toBe(true);
    expect(r.normalized).toEqual({});
  });

  it('合法体原样保留', () => {
    const r = validateSpawnBody({ files: ['a'], skills: ['b'], task: 't', cwd: 'C:/x', focus: false, title: 'T' });
    expect(r.ok).toBe(true);
    expect(r.normalized.files).toEqual(['a']);
    expect(r.normalized.focus).toBe(false);
  });

  it('files 非数组 → 失败', () => {
    expect(validateSpawnBody({ files: 'a' }).ok).toBe(false);
  });

  it('files 元素非字符串 → 失败', () => {
    expect(validateSpawnBody({ files: ['a', 1] }).ok).toBe(false);
  });

  it('task 超长 → 失败', () => {
    expect(validateSpawnBody({ task: 'x'.repeat(4001) }).ok).toBe(false);
  });

  it('focus 非布尔 → 失败', () => {
    expect(validateSpawnBody({ focus: 'yes' }).ok).toBe(false);
  });

  it('非对象根 → 失败', () => {
    expect(validateSpawnBody(null).ok).toBe(false);
    expect(validateSpawnBody('s').ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `npm test -- spawn-prompt`
Expected: 新增用例 FAIL（`validateSpawnBody is not a function`）。

- [ ] **Step 3: 实现 validateSpawnBody**

在 `spawn-prompt.ts` 追加：
```typescript
export interface SpawnBody extends SpawnContext {
  cwd?: string;
  focus?: boolean;
  title?: string;
  sourceTerminalId?: string;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  normalized: SpawnBody;
}

const MAX_TASK = 4000;
const MAX_ARRAY = 50;
const MAX_STR = 1000;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

export function validateSpawnBody(body: unknown): ValidationResult {
  const fail = (error: string): ValidationResult => ({ ok: false, error, normalized: {} });
  const normalized: SpawnBody = {};

  if (typeof body !== 'object' || body === null) return fail('请求体必须是对象');
  const b = body as Record<string, unknown>;

  if (b.files !== undefined) {
    if (!isStringArray(b.files)) return fail('files 必须是字符串数组');
    if (b.files.length > MAX_ARRAY) return fail(`files 最多 ${MAX_ARRAY} 项`);
    normalized.files = b.files;
  }
  if (b.skills !== undefined) {
    if (!isStringArray(b.skills)) return fail('skills 必须是字符串数组');
    if (b.skills.length > MAX_ARRAY) return fail(`skills 最多 ${MAX_ARRAY} 项`);
    normalized.skills = b.skills;
  }
  if (b.task !== undefined) {
    if (typeof b.task !== 'string') return fail('task 必须是字符串');
    if (b.task.length > MAX_TASK) return fail(`task 过长（≤${MAX_TASK}）`);
    normalized.task = b.task;
  }
  if (b.cwd !== undefined) {
    if (typeof b.cwd !== 'string' || b.cwd.length > MAX_STR) return fail('cwd 非法');
    normalized.cwd = b.cwd;
  }
  if (b.focus !== undefined) {
    if (typeof b.focus !== 'boolean') return fail('focus 必须是布尔值');
    normalized.focus = b.focus;
  }
  if (b.title !== undefined) {
    if (typeof b.title !== 'string' || b.title.length > MAX_STR) return fail('title 非法');
    normalized.title = b.title;
  }
  if (b.sourceTerminalId !== undefined) {
    if (typeof b.sourceTerminalId !== 'string') return fail('sourceTerminalId 非法');
    normalized.sourceTerminalId = b.sourceTerminalId;
  }

  return { ok: true, normalized };
}
```

- [ ] **Step 4: 运行验证通过**

Run: `npm test -- spawn-prompt`
Expected: 全部 `passed`（buildInitialPrompt 5 + validateSpawnBody 7）。

- [ ] **Step 5: 提交**

```bash
git add src/main/services/spawn-prompt.ts src/main/services/spawn-prompt.test.ts
git commit -m "feat(spawn): 新增请求体校验 validateSpawnBody"
```

---

## Task 4: deriveTitle（TDD）

新 tab 标题推导。

**Files:**
- Modify: `src/main/services/spawn-prompt.ts`
- Test: `src/main/services/spawn-prompt.test.ts`

- [ ] **Step 1: 追加失败测试**

import 增加 `deriveTitle`：
```typescript
import { buildInitialPrompt, validateSpawnBody, deriveTitle } from './spawn-prompt';
```
末尾追加：
```typescript
describe('deriveTitle', () => {
  it('显式 title 优先', () => {
    expect(deriveTitle({ title: '我的标题' }, 3)).toBe('我的标题');
  });
  it('无 title 用 task 前 12 字，超长截断加 …', () => {
    expect(deriveTitle({ task: '一二三四五六七八九十一二三四五' }, 1)).toBe('一二三四五六七八九十一二…');
    expect(deriveTitle({ task: '短任务' }, 1)).toBe('短任务');
  });
  it('无 title/task 用首文件名', () => {
    expect(deriveTitle({ files: ['C:/x/y/notes.md'] }, 1)).toBe('notes.md');
    expect(deriveTitle({ files: ['a\\b\\c.ts'] }, 1)).toBe('c.ts');
  });
  it('全空用 Terminal N', () => {
    expect(deriveTitle({}, 5)).toBe('Terminal 5');
  });
  it('空白 title 回退', () => {
    expect(deriveTitle({ title: '   ', task: '实际任务' }, 1)).toBe('实际任务');
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `npm test -- spawn-prompt`
Expected: 新用例 FAIL。

- [ ] **Step 3: 实现 deriveTitle**

在 `spawn-prompt.ts` 追加：
```typescript
export function deriveTitle(body: SpawnBody, fallbackIndex: number): string {
  const title = body.title?.trim();
  if (title) return title;

  const task = body.task?.trim();
  if (task) return task.length > 12 ? task.slice(0, 12) + '…' : task;

  if (body.files && body.files.length > 0) {
    const first = body.files[0];
    return first.split(/[\\/]/).pop() || first;
  }

  return `Terminal ${fallbackIndex}`;
}
```

- [ ] **Step 4: 运行验证通过**

Run: `npm test -- spawn-prompt`
Expected: 全部 `passed`。

- [ ] **Step 5: 提交**

```bash
git add src/main/services/spawn-prompt.ts src/main/services/spawn-prompt.test.ts
git commit -m "feat(spawn): 新增标题推导 deriveTitle"
```

---

## Task 5: buildClaudeSpawnCommand（TDD）

把初始 prompt 编码为 PowerShell 注入命令（base64 规避转义）。

**Files:**
- Modify: `src/main/services/spawn-prompt.ts`
- Test: `src/main/services/spawn-prompt.test.ts`

- [ ] **Step 1: 追加失败测试**

import 增加 `buildClaudeSpawnCommand`：
```typescript
import { buildInitialPrompt, validateSpawnBody, deriveTitle, buildClaudeSpawnCommand } from './spawn-prompt';
```
末尾追加：
```typescript
describe('buildClaudeSpawnCommand', () => {
  it('含 base64 解码与 claude 调用', () => {
    const cmd = buildClaudeSpawnCommand('你好，读 a.md');
    expect(cmd).toContain('FromBase64String');
    expect(cmd).toContain('claude $p');
    // 解码回原文
    const m = cmd.match(/FromBase64String\('([^']+)'\)/);
    expect(m).not.toBeNull();
    expect(Buffer.from(m![1], 'base64').toString('utf8')).toBe('你好，读 a.md');
  });

  it('引号与特殊字符不破坏命令结构', () => {
    const cmd = buildClaudeSpawnCommand('含"双引号"和$变量');
    expect(cmd.match(/FromBase64String\('[^']*'\)/)).not.toBeNull();
    expect(cmd.endsWith('claude $p')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `npm test -- spawn-prompt`
Expected: 新用例 FAIL。

- [ ] **Step 3: 实现 buildClaudeSpawnCommand**

在 `spawn-prompt.ts` 追加：
```typescript
/**
 * 把初始 prompt 编码为 PowerShell 命令：解码 base64 后调用 claude。
 * 用 base64 规避中文/引号/特殊字符的转义问题。
 */
export function buildClaudeSpawnCommand(prompt: string): string {
  const b64 = Buffer.from(prompt, 'utf8').toString('base64');
  return `$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')); claude $p`;
}
```

- [ ] **Step 4: 运行验证通过**

Run: `npm test -- spawn-prompt`
Expected: 全部 `passed`。

- [ ] **Step 5: 删除 sanity 测试（基建已验证）**

Delete: `src/main/services/sanity.test.ts`

Run: `npm test`
Expected: 仅 spawn-prompt 用例，全 `passed`，无 sanity。

- [ ] **Step 6: 提交**

```bash
git add src/main/services/spawn-prompt.ts src/main/services/spawn-prompt.test.ts src/main/services/sanity.test.ts
git commit -m "feat(spawn): 新增 base64 注入命令构造 buildClaudeSpawnCommand"
```

---

## Task 6: codeminder-spawn.js 纯函数 parseArgs / buildPayload（TDD）

**Files:**
- Create: `tools/codeminder-spawn.js`
- Test: `tools/codeminder-spawn.test.js`

- [ ] **Step 1: 写失败测试**

Create `tools/codeminder-spawn.test.js`：
```javascript
import { describe, it, expect } from 'vitest';
import { parseArgs, buildPayload } from './codeminder-spawn';

describe('parseArgs', () => {
  it('解析 files/skills/task，默认 focus=true', () => {
    const o = parseArgs(['--files', 'a.md,b.md', '--skills', 'x', '--task', '做测试']);
    expect(o.files).toEqual(['a.md', 'b.md']);
    expect(o.skills).toEqual(['x']);
    expect(o.task).toBe('做测试');
    expect(o.focus).toBe(true);
  });

  it('--no-focus 置 focus=false', () => {
    expect(parseArgs(['--no-focus']).focus).toBe(false);
  });

  it('--cwd 覆盖默认 cwd', () => {
    const o = parseArgs(['--cwd', 'D:/proj']);
    expect(o.cwd).toBe('D:/proj');
  });

  it('--title 解析', () => {
    expect(parseArgs(['--title', '标题']).title).toBe('标题');
  });

  it('空 argv 仍有默认 cwd/focus', () => {
    const o = parseArgs([]);
    expect(o.focus).toBe(true);
    expect(typeof o.cwd).toBe('string');
  });
});

describe('buildPayload', () => {
  it('省略空数组/空字段', () => {
    const p = buildPayload({ files: [], skills: [], cwd: 'C:/x', focus: true });
    expect(p).toEqual({ cwd: 'C:/x', focus: true });
    expect(p.files).toBeUndefined();
  });
  it('保留非空字段', () => {
    const p = buildPayload({ files: ['a'], skills: ['b'], task: 't', cwd: 'C:/x', focus: false, title: 'T' });
    expect(p).toEqual({ files: ['a'], skills: ['b'], task: 't', cwd: 'C:/x', focus: false, title: 'T' });
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run tools/codeminder-spawn.test.js`
Expected: FAIL（`Cannot find module './codeminder-spawn'`）。

- [ ] **Step 3: 实现 codeminder-spawn.js（仅纯函数 + 模块导出，main 留到 Task 10）**

Create `tools/codeminder-spawn.js`：
```javascript
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
```

- [ ] **Step 4: 运行验证通过**

Run: `npx vitest run tools/codeminder-spawn.test.js`
Expected: 全部 `passed`。

- [ ] **Step 5: 提交**

```bash
git add tools/codeminder-spawn.js tools/codeminder-spawn.test.js
git commit -m "feat(spawn): 新增 codeminder-spawn 参数解析纯函数"
```

---

## Task 7: pty-service.create 扩展（集成）

支持 `cwd` / `initialCommand`，并注入 `CCTM_SPAWN_SCRIPT`。

**Files:**
- Modify: `src/main/services/pty-service.ts`

- [ ] **Step 1: 修改 create 签名与实现**

把 `pty-service.ts` 顶部的 import 行：
```typescript
import { BrowserWindow } from 'electron';
```
改为：
```typescript
import { BrowserWindow, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
```

在 `export class PtyService extends EventEmitter {` 之后、`create` 方法之前，插入路径解析函数：
```typescript
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
```

把整个 `create` 方法替换为：
```typescript
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
      LANG: 'zh_CN.UTF-8',
      CHCP: '65001',
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
      useConpty: true,
      encoding: 'utf8',
    });

    ptyProcess.onData((data: string) => {
      this.emit('data', { terminalId, data } as PtyDataEvent);
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.emit('exit', { terminalId, exitCode } as PtyExitEvent);
      sessionManager.setNotification(terminalId, NotificationType.SESSION_ENDED);
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
```

> 说明：旧调用 `ptyService.create(session.id)` 与 `ptyService.create(session.id)`（IPC 初始终端）仍兼容——第二参数 options 默认 `{}`。

- [ ] **Step 2: 编译验证**

Run: `npm start`
Expected: 应用正常启动（控制台无 TS/编译错误，主窗口显示）。看到 `[CCTM] HTTP 通知服务已启动` 日志。确认无误后关闭应用。

- [ ] **Step 3: 手动验证 CCTM_SPAWN_SCRIPT 注入**

再次 `npm start`，应用起来后在自动创建的第一个终端里输入：
```
echo $env:CCTM_SPAWN_SCRIPT
```
Expected: 打印出指向 `tools/codeminder-spawn.js` 的绝对路径（如 `D:\myProject\codeminder\tools\codeminder-spawn.js`）。

- [ ] **Step 4: 提交**

```bash
git add src/main/services/pty-service.ts
git commit -m "feat(spawn): pty-service 支持 cwd/initialCommand 并注入 CCTM_SPAWN_SCRIPT"
```

---

## Task 8: spawn-service.handleSpawn（集成）

**Files:**
- Create: `src/main/services/spawn-service.ts`

- [ ] **Step 1: 实现 spawn-service.ts**

Create `src/main/services/spawn-service.ts`：
```typescript
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

  ptyService.create(session.id, { cwd: body.cwd, initialCommand });

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
```

- [ ] **Step 2: 编译验证**

Run: `npm start`
Expected: 应用正常启动、无编译错误。关闭应用。

- [ ] **Step 3: 提交**

```bash
git add src/main/services/spawn-service.ts
git commit -m "feat(spawn): 新增 spawn-service 编排 handleSpawn"
```

---

## Task 9: http-notification-service 加 /spawn 路由（集成）

**Files:**
- Modify: `src/main/services/http-notification-service.ts`

- [ ] **Step 1: 加 import**

在 `http-notification-service.ts` 顶部现有 import 块后追加：
```typescript
import { handleSpawn } from './spawn-service';
```

- [ ] **Step 2: 加 /spawn 路由分支**

定位现有的路由分发（约 48-69 行）：
```typescript
      // 只处理 POST 请求到 /notify
      if (req.method === 'POST' && req.url === '/notify') {
        // ... 现有 notify 处理 ...
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('未找到');
      }
```
把 `} else {` 之前插入一个 `else if` 分支，使其变为：
```typescript
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
      } else if (req.method === 'POST' && req.url === '/spawn') {
        let body = '';
        req.on('data', (chunk) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            const result = handleSpawn(parsed);
            const ok = !('error' in result);
            res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(result));
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '无效的 JSON 格式' }));
          }
        });
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('未找到');
      }
```
（即：完整保留现有 `/notify` 分支内容不变，仅在其后新增 `else if (/spawn)` 分支。）

- [ ] **Step 3: 启动应用并用 curl 验证**

Run（终端 A）: `npm start`，等应用启动。

Run（终端 B，用项目自带的 Git Bash 或 PowerShell curl）:
```bash
curl -s -X POST http://127.0.0.1:13452/spawn -H "Content-Type: application/json" -d '{"task":"测试任务","cwd":"D:/myProject/codeminder"}'
```
Expected: 返回 `{"id":"<uuid>","title":"测试任务"}`；CodeMinder 界面新增一个 tab，标题"测试任务"，并自动切到该 tab；新 tab 内 PowerShell 启动后自动执行 `claude` 并以"请开始执行任务：测试任务…"为开头工作。

- [ ] **Step 4: 验证错误分支**

Run（终端 B）:
```bash
curl -s -X POST http://127.0.0.1:13452/spawn -H "Content-Type: application/json" -d '{"cwd":"Z:/不存在"}'
```
Expected: HTTP 400，返回 `{"error":"cwd 不存在: Z:/不存在"}`，不产生新 tab。

- [ ] **Step 5: 关闭应用并提交**

关闭 CodeMinder 应用。
```bash
git add src/main/services/http-notification-service.ts
git commit -m "feat(spawn): http-notification-service 新增 /spawn 路由"
```

---

## Task 10: codeminder-spawn.js main（HTTP 集成）

**Files:**
- Modify: `tools/codeminder-spawn.js`

- [ ] **Step 1: 追加 main 函数与入口守卫**

在 `tools/codeminder-spawn.js` 的 `module.exports` 行**之前**插入：
```javascript
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
```

把 `module.exports = { parseArgs, buildPayload };` 改为：
```javascript
module.exports = { parseArgs, buildPayload };

// 仅当直接执行时运行 main（被 require 时不触发）
if (require.main === module) {
  main();
}
```

- [ ] **Step 2: 确认纯函数测试仍通过**

Run: `npx vitest run tools/codeminder-spawn.test.js`
Expected: 全部 `passed`（main 不被测试 require 触发，因 `require.main === module` 守卫）。

- [ ] **Step 3: 启动应用并端到端验证脚本**

Run（终端 A）: `npm start`，等应用启动。

Run（终端 B）:
```bash
node "D:/myProject/codeminder/tools/codeminder-spawn.js" --task "脚本端到端验证" --no-focus
```
Expected: 退出码 0，stdout 输出 `{"id":"...","title":"脚本端到端验证"}`；CodeMinder 新增 tab（标题"脚本端到端验证"）但**不**自动切换（停留在原 tab）。

- [ ] **Step 4: 验证 CodeMinder 未运行的错误路径**

关闭 CodeMinder 应用后，Run（终端 B）:
```bash
node "D:/myProject/codeminder/tools/codeminder-spawn.js" --task "x"
echo "退出码: $?"
```
Expected: stderr 输出"CodeMinder 未运行…"；退出码 1。

- [ ] **Step 5: 提交**

```bash
git add tools/codeminder-spawn.js
git commit -m "feat(spawn): codeminder-spawn 接入 HTTP /spawn 并完善错误退出"
```

---

## Task 11: 端到端验证 + 注入时机调优

对照 spec §9 的 5 个验证点，按矩阵手动验证；若 `-Command` 注入不稳定，按备选方案调整。

**Files:** （可能 Modify: `src/main/services/pty-service.ts` 或 `spawn-service.ts`，视验证结果）

- [ ] **Step 1: 启动应用并准备验证环境**

Run: `npm start`。在第一个终端确认 `$env:CCTM_SPAWN_SCRIPT` 有值（同 Task 7 Step 3）。

- [ ] **Step 2: 验证点 ① —— 全信息派生**

在第一个终端的 CC 里输入（或直接用脚本）：
```
node "$env:CCTM_SPAWN_SCRIPT" --files package.json --skills karpathy-guidelines --task "读取 package.json 并简述项目用途"
```
Expected: 新 tab 创建，claude 启动后**真实**执行 Read package.json + Skill karpathy-guidelines + 回答任务。

- [ ] **Step 3: 验证点 ② —— 中文/特殊字符注入**

```
node "$env:CCTM_SPAWN_SCRIPT" --task "输出一句：你好「世界」$VAR"
```
Expected: 新 tab 的 claude 正确收到含中文与特殊符号的任务文本（base64 解码无误）。

- [ ] **Step 4: 验证点 ③ —— claude 启动语义**

在新 tab 观察：`claude` 以**交互式**会话启动并以初始 prompt 作为首条消息处理（非 `--print` 一次性退出）。
- 若 claude 未启动或一次性退出：检查 `claude "<prompt>"` 在当前 claude CLI 版本的语义，必要时调整 `buildClaudeSpawnCommand`（如改用 `claude -p` 之外的正确交互启动方式）。

- [ ] **Step 5: 验证点 ④ —— 新终端通知归属**

在新 tab 的 CC 触发一次权限请求或等待其完成响应，观察该 tab 的高亮/任务栏闪烁是否正确指向**新** tab（非源 tab）。
- 异常处理：若通知指向错误 tab，检查新 pty 的 `CCTM_TERMINAL_ID` 是否为新 UUID（`echo $env:CCTM_TERMINAL_ID`）。

- [ ] **Step 6: 验证点 ⑤ —— 注入时机稳定性**

重复 Step 2 三次，观察初始 prompt 是否每次都完整送入 claude（不丢字符、不被 PowerShell 提示符吞掉）。
- **若不稳定**（丢字符/未执行）：按 spec §5.4 备选方案改造——`pty-service.create` 不用 `-Command`，改为创建普通 pty 后监听 `onData`，检测到首个 PowerShell 提示符（如匹配 `/>\s*$/`）后再 `ptyService.write(id, base64 注入命令 + '\r')`。改造后回到 Step 6 重新验证。

- [ ] **Step 7: 提交（若有调整）**

若 Step 4/6 改了代码：
```bash
git add -A
git commit -m "fix(spawn): 按端到端验证调整 claude 注入方式"
```
若无需调整，本任务无提交。

---

## Task 12: spawn-terminal skill 内容创作

**Files:**
- Create: `~/.claude/skills/spawn-terminal/SKILL.md`（用户全局目录，不在仓库内）

- [ ] **Step 1: 创建 skill 目录与文件**

在用户主目录下创建 `~/.claude/skills/spawn-terminal/SKILL.md`，内容如下：
```markdown
---
name: spawn-terminal
description: 在 CodeMinder 中派生一个新的 Claude Code 终端并预置上下文（文件/skill/任务）。当用户要求"新开终端去做 X"、或当前领域 skill 的编排指示要分叉工作流时使用。
---

# spawn-terminal —— 派生新 CC 终端

通过 Bash 执行 CodeMinder 提供的脚本，派生一个新 Claude Code 终端并预置上下文。脚本路径由环境变量 `$CCTM_SPAWN_SCRIPT`（CodeMinder 注入）给出。

## 何时使用（双入口）

1. **用户显式触发**：用户说"新开一个终端去做 X""开个终端读 Y 用 Z skill"等。
2. **领域 skill 自主分叉**：你正在执行某个领域 skill（如 coding），其编排描述要求在某个阶段（如"完成编码后"）派生新终端（如做 review/test）——此时自主调用本能力。

## 如何调用

```bash
node "$CCTM_SPAWN_SCRIPT" [--files a,b] [--skills x,y] [--task "..."] [--cwd path] [--title "..."] [--no-focus]
```

参数：
- `--files`：逗号分隔，新终端启动后会用 Read 读取。
- `--skills`：逗号分隔，新终端启动后会用 Skill 激活。
- `--task`：新终端的初始任务；缺省则新终端就绪待命。
- `--cwd`：新终端工作目录，默认当前目录。
- `--title`：新 tab 标题；缺省据 task/首文件名自动推导。
- `--no-focus`：不切换到新终端（后台）；缺省切换。

## 信息收集准则（保守 + 非阻塞）

调用前尽力让上下文完整：
- **能从当前会话可靠推断的，自主补全**（如"本次刚改动的文件"你已知），不必问用户。
- **无法可靠推断的关键信息**，先用 AskUserQuestion 询问用户（如"用哪个测试 skill？"）。
- **询问是非阻塞的**：用户可完整答、部分答、不答，或直接说"别问了就这样开"——一律用现有信息执行，绝不因信息不全而拒绝。最终决定权在用户。

## 示例

- 全信息：`node "$CCTM_SPAWN_SCRIPT" --files notes/a.md --skills thought-chain --task "整理本周笔记" --no-focus`
- 仅任务：`node "$CCTM_SPAWN_SCRIPT" --task "跑一遍测试套件"`
- 开空终端：`node "$CCTM_SPAWN_SCRIPT"`

## 被其他 skill 引用

领域 skill 可在其正文写："…完成 X 后，调用 spawn-terminal 派生一个新终端：加载 Y skill，读取 Z，做 W（建议 --no-focus）…"。你识别到该指示后，按上述方式组装参数并执行。
```

- [ ] **Step 2: 手动验证 skill 可被发现**

在一个 CodeMinder 终端的 CC 里输入：
```
我描述一下你想做什么：新开一个终端读 package.json，用 karpathy-guidelines skill，简述项目。请用 spawn-terminal 能力完成。
```
Expected: CC 调用 `node "$CCTM_SPAWN_SCRIPT" ...`，新终端被派生并预置上下文。

- [ ] **Step 3: 提交说明**

skill 文件在用户全局目录，不纳入本仓库，无需 git 提交。本任务结束。

---

## Self-Review 结果

- **Spec 覆盖**：spec 各节均有任务对应——触发/通道(Task 6/9/10)、prompt 构造与注入(Task 2/5/8)、`/spawn` 端点与编排(Task 8/9)、机制/策略分离(Task 12 skill 双入口+被引用)、信息收集准则(Task 12 skill 准则)、焦点/cwd/标题/安全(Task 3/4/7/8/9)、错误处理(Task 3 校验 + Task 9 cwd + Task 10 ECONNREFUSED + Task 11 通知归属)、测试(Task 1-6 自动 + Task 7/9/10/11 手动)、5 个验证点(Task 11)、非目标(未实现任何非目标项)。无遗漏。
- **占位符扫描**：无 TBD/TODO；每个代码步骤均给出完整代码与命令。
- **类型一致性**：`CreateOptions`（Task 7，字段 shell/cwd/initialCommand）与 `ptyService.create` 在 Task 8 的调用 `create(session.id, { cwd, initialCommand })` 一致；`SpawnBody`/`ValidationResult`/`SpawnResult`/`SpawnErrorResponse` 在 Task 2-8 间命名一致；`buildClaudeSpawnCommand` 在 Task 5 定义、Task 8 调用，签名一致。
- **已知实现期不确定项**：Task 11 Step 4/6 诚实标注了 claude 启动语义与注入时机需实测，并给出失败时的具体备选改造路径（非占位符，而是条件分支）。
