# CodeMinder 自然语言派生终端（spawn-terminal）设计

> **日期**：2026-08-07
> **状态**：已确认，待编写实现计划
> **作者**：zs（通过 brainstorming 流程）
> **关联**：基于现有 CodeMinder 多终端架构（`pty-service` / `http-notification-service` / `session-manager`）

---

## 1. 背景与目标

CodeMinder 是一个 Electron 多终端 Claude Code 会话管理器：每个 tab 是一个独立的 pty（PowerShell + 注入唯一 `CCTM_TERMINAL_ID`），用户手动开 tab、手动启动 `claude`、手动读文件与激活 skill。

**本功能的痛点**：在多终端工作流中，"开一个新 CC 终端并预置好上下文（读哪些文件、激活哪些 skill、做什么任务）"是一套重复的手动操作。

**目标**：让用户能在**当前 CC 终端**里用一句自然语言（或由 CC 在工作流中自主判断）**派生一个新 CC 终端**，并自动把指定的文件、skill、任务预置进新终端的上下文，使新终端启动即"就绪"。

**核心原则**：机制与策略分离。CodeMinder 只提供"派生终端"的**机制**（一次实现）；"何时、为何、派生什么"的**策略**以自然语言写在用户的领域 skill 中，由 CC 自主执行。CodeMinder **不内置编排引擎**。

---

## 2. 使用场景（用户故事）

1. **用户显式触发（手动）**
   > "新开一个终端，读 `notes/a.md`，用 `thought-chain` skill，整理本周笔记，别跳过去。"
   - CC 解析 → `files=[notes/a.md] skills=[thought-chain] task="整理本周笔记" focus=false` → 调脚本 → 后台新 tab 启动 claude，自动读文件、激活 skill、开始整理。

2. **领域 skill 自主分叉（编排）**
   - 一个 `coding` skill 在其正文里写明："完成编码实现后，调用 `spawn-terminal` 派生一个新终端：加载 `code-review` skill，读取本次改动的文件，对代码做 review。"
   - CC 完成 coding 阶段后，按该 skill 的编排描述自主调用 spawn，派生 review 终端。

3. **信息不全的主动触发**
   > "新开一个终端去做测试。"
   - CC 判断信息充分性：task=测试（有）；files 可从上下文推断（本次改动的文件）；skills 无法可靠推断 → 用 `AskUserQuestion` 反问"用哪个测试 skill？"。用户可完整答、部分答、或"别问了直接开"——CC 用现有信息执行，不阻塞。

---

## 3. 架构概览（数据流）

```
┌─ 当前 CC 实例（Tab A）──────────────────────────────────────────┐
│ 用户自然语言 / 领域 skill 编排指示                                  │
│   ↓ CC 解析（spawn-terminal skill 提供能力声明与用法；必要时先 AskUserQuestion）│
│   files=[...] skills=[...] task="..." focus=true cwd=...           │
│   ↓ Bash                                                          │
│ node tools/codeminder-spawn.js --files ... --skills ... --task "..." [--no-focus] [--cwd ...]
└───────────────────────────┬──────────────────────────────────────┘
                            │ POST http://127.0.0.1:13452/spawn  (JSON)
                            ▼
┌─ CodeMinder 主进程 ────────────────────────────────────────────┐
│ spawnService.handleSpawn(body):                                  │
│   1. 校验 JSON 结构（类型/长度，所有字段可选）                      │
│   2. session = sessionManager.create(title)   // title 推导       │
│   3. prompt  = 构造初始 prompt（见 §5.4）                          │
│   4. ptyService.create(session.id, { cwd, initialCommand })       │
│      → 新 PowerShell + 新 CCTM_TERMINAL_ID + 注入 claude 启动命令   │
│   5. if (focus) sessionManager.setActive(session.id)              │
│   6. sendSessionsUpdate()   → 前端按 focus 切/不切 tab             │
│   返回 { id, title }                                              │
└───────────────────────────┬──────────────────────────────────────┘
                            ▼
┌─ 新 Tab：claude 启动 → 真实执行 Read + Skill → 干 task 或待命 ──────┐
```

---

## 4. 组件清单（新建 / 修改）

### 新建

| 文件 | 职责 |
|---|---|
| `tools/codeminder-spawn.js` | 入口脚本（Node，与 `cctm-notify.js` 风格一致）。解析命令行参数 → 组装 JSON → `POST /spawn`。成功退出 0，失败非 0 + stderr（让调用方 CC 可见）。 |
| `src/main/services/spawn-service.ts` | `/spawn` 请求处理：校验、建会话、构造 prompt、建 pty 并注入、focus 控制、返回结果。 |
| `~/.claude/skills/spawn-terminal/SKILL.md` | 能力声明 skill。讲清"怎么派生终端、参数怎么传、双入口（用户显式 / 领域 skill 自主）、信息收集准则"。详见 §6。 |

### 修改

| 文件 | 改动 |
|---|---|
| `src/main/services/http-notification-service.ts` | 新增 `POST /spawn` 路由，请求体转交 `spawnService.handleSpawn`。 |
| `src/main/services/pty-service.ts` | `create(terminalId, options?)` 扩展：支持 `cwd`（现为硬编码 `process.env.HOME`）与 `initialCommand`（创建时注入的启动命令）。同时在终端环境变量中注入 `CCTM_SPAWN_SCRIPT`（指向 `tools/codeminder-spawn.js` 绝对路径），使任何 CodeMinder 终端内的 CC 都能跨项目定位脚本。 |
| `src/main/services/session-manager.ts` | 无需改动，`create(title?)` 已支持自定义标题，复用即可。 |

---

## 5. 详细设计

### 5.1 触发机制与数据通道

- **触发**：当前 CC 的 Claude 通过 Bash 执行 `codeminder-spawn.js`。
- **通道**：HTTP `POST /spawn`，复用现有 `http-notification-service`（127.0.0.1:13452）。
- **选型理由**：请求体是结构化 JSON（files 数组、skills 数组、task 字符串、cwd、focus 布尔、title），HTTP+JSON 最自然；现有 HTTP 服务已运行，加路由成本极低；`curl` 即可调试。
- **安全**：本地回环、与 `/notify` 同栈、无认证（风险一致、可接受）。可选增强：校验请求体里的 `sourceTerminalId` 为已注册会话。

### 5.2 codeminder-spawn.js 脚本（CLI 设计）

脚本位于 CodeMinder 仓库 `tools/codeminder-spawn.js`。CodeMinder 启动每个终端时注入环境变量 `CCTM_SPAWN_SCRIPT` 指向其绝对路径，故跨项目调用统一写作 `node "$CCTM_SPAWN_SCRIPT" ...`：

```
node "$CCTM_SPAWN_SCRIPT" [options]
  --files <a,b,c>      逗号分隔的文件路径（可选）
  --skills <x,y>       逗号分隔的 skill 名（可选）
  --task "<...>"       初始任务文本（可选）
  --cwd <path>         新终端工作目录（默认取当前 process.cwd()）
  --title "<...>"      自定义新 tab 标题（可选）
  --no-focus           不切换焦点（默认 focus=true，切到新终端）
```

行为：
- 把参数组装为 JSON，`POST` 到 `http://127.0.0.1:13452/spawn`。
- 默认 `cwd` = `process.cwd()`（即当前终端 cwd，使相对文件路径在新终端自然解析）。
- CodeMinder 未运行 → `ECONNREFUSED` → 退出码 1 + stderr 明确提示。
- 成功 → 退出码 0，stdout 可打印新终端 `{id, title}` 供 CC 引用。

### 5.3 /spawn 端点与 spawn-service

**请求体 JSON**（所有字段可选）：
```json
{
  "files": ["notes/a.md"],
  "skills": ["thought-chain"],
  "task": "整理本周笔记",
  "cwd": "D:/myProject/codeminder",
  "focus": true,
  "title": "整理本周笔记",
  "sourceTerminalId": "<可选，调用方终端 ID>"
}
```

**`spawnService.handleSpawn(body)` 流程**：
1. **校验**：字段类型与长度（如 `task` ≤ 4000 字符、数组元素 ≤ 50、`cwd` 必须存在且可访问）。**不强制任何字段非空**——允许"开空终端"。
2. **标题推导**：`title` 显式 → 否则 `task` 前 ~12 字 → 否则首文件名 → 否则 `Terminal N`。
3. **构造初始 prompt**（见 §5.4）。
4. **建会话与终端**：`sessionManager.create(title)` → `ptyService.create(session.id, { cwd, initialCommand })`，自动注入新 `CCTM_TERMINAL_ID`，通知系统自动覆盖新 tab。
5. **焦点**：`if (focus) sessionManager.setActive(session.id)`。
6. **通知前端**：`sendSessionsUpdate()`（复用现有机制），前端据 activeId 决定是否切 tab。
7. **返回** `{ id, title }`。

### 5.4 初始上下文构造与注入

**初始 prompt 模板**（由 spawn-service 按"有哪些字段"动态拼接，让新 CC **真实**执行 Read + Skill，非空壳）：

| 提供情况 | 初始 prompt |
|---|---|
| files + skills + task 全有 | `请按顺序初始化上下文：1) 用 Read 读取：<files>；2) 用 Skill 激活：<skills>；3) 完成后开始执行任务：<task>` |
| 仅 task（无 files/skills） | `请开始执行任务：<task>（如需读取文件请自行确定）` |
| 仅 files/skills（无 task） | `请读取 <files>、激活 <skills>，完成后简述已就绪的上下文并等待我的指示` |
| 全空 | `上下文已就绪，等待你的指示。` |

**注入时机与转义**（实现期关键验证点，见 §9）：
- 新 pty 是 PowerShell，需启动 `claude "<prompt>"`。
- **推荐方案**：`pty.spawn('powershell.exe', ['-NoLogo', '-NoExit', '-Command', injectCmd], { env, cwd, ... })`，shell 就绪即执行，避免 create 后立即 write 丢字符。
- **转义**：prompt 含中文/引号/路径，主进程做 **UTF-8 base64**，写入：
  ```powershell
  $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('<base64>')); claude $p
  ```
  彻底规避转义问题。
- **备选方案**：创建普通 pty，监听输出检测到首个 `PS>` 提示符后再 `pty.write`。可靠性次之，作为兜底。

### 5.5 编排模式：机制 / 策略分离

| 层 | 职责 | 归属 | 形态 |
|---|---|---|---|
| **机制层** | "如何派生一个新终端、参数怎么传" | CodeMinder（本设计，一次实现） | 脚本 + `/spawn` + `spawn-terminal` skill |
| **策略层** | "何时、为何、派生什么" | 用户各领域 skill（自然语言） | skill 正文里的编排描述 |

**编排示例（写在 `coding` skill 正文里）**：
> ...完成编码实现后，调用 `spawn-terminal` 派生一个新终端：加载 `code-review` skill，读取本次改动的文件，对代码做 review（建议 `--no-focus`，原终端继续做提交准备）...

**执行者**：Tab A 的 CC 在推进任务时，按所在领域 skill 的编排描述，**自主**在"完成 coding"阶段调用 spawn。CodeMinder **不为编排写任何代码**——编排是内容，由 CC 的语义理解驱动。

**`spawn-terminal` skill 的可被引用性**：领域 skill 在正文里写"调用 spawn-terminal"，CC 识别后会查找并据其用法组装参数、执行 Bash。因此 `spawn-terminal` 描述需明确支持"被其他 skill 引用、支持 CC 自主分叉工作流"。

### 5.6 信息收集准则（保守 + 非阻塞）

`spawn-terminal` skill 强制如下准则，由 CC 执行：

1. **默认尽力收集**：信息不全时，先用 `AskUserQuestion` 询问 + 从当前会话上下文推断，目标是给新终端尽量完整的上下文。
2. **询问非阻塞**：用户可完整回答、部分回答、不回答、或直接说"别问了就这样开"——CC 一律用**现有信息**执行 spawn，绝不因"信息不全"而拒绝。
3. **决定权在用户**：问是 CC 的义务，答不答是用户的自由。
4. **端点层不设硬卡点**：`/spawn` 所有参数可选，不强制非空；极端"开空终端"也允许。

### 5.7 焦点行为、cwd、标题、安全

- **焦点**：`focus` 默认 `true`（切到新终端并聚焦）；Claude 据自然语言判断用户是否"不想跳转"（如"在后台开/别跳过去"），是则传 `--no-focus`。
- **cwd**：默认当前终端 cwd（脚本取 `process.cwd()`），`--cwd` 可覆盖；新终端继承新 `CCTM_TERMINAL_ID`，通知机制自动适配。
- **标题**：`--title` → `task` 前 ~12 字 → 首文件名 → `Terminal N`。
- **安全**：本地回环、无认证（与 `/notify` 一致）；可选校验 `sourceTerminalId`。

---

## 6. spawn-terminal skill 内容大纲

**位置**：`~/.claude/skills/spawn-terminal/SKILL.md`（全局，便于所有项目、所有领域 skill 引用）。

**frontmatter**：
```yaml
---
name: spawn-terminal
description: 在 CodeMinder 中派生一个新的 Claude Code 终端并预置上下文。当用户要求"新开终端去做 X"、或领域 skill 编排要求分叉工作流时使用。
---
```

**正文要点**：
1. **能力声明**：通过 Bash 执行 `node "$CCTM_SPAWN_SCRIPT"` 派生新 CC 终端（环境变量由 CodeMinder 注入，跨项目可用）。
2. **参数说明**：`--files` / `--skills` / `--task` / `--cwd` / `--title` / `--no-focus`，含语义与示例。
3. **双入口**：① 用户显式触发；② 被（领域）skill 引用、由 CC 自主分叉工作流。
4. **信息收集准则**：保守收集 + 非阻塞 + 用户决定权（§5.6 全文）。
5. **编排引用说明**：供其他 skill 在正文中写"调用 spawn-terminal …"时参照。
6. **示例**：覆盖"全信息直接 spawn"、"信息不全先问"、"领域编排自主 spawn"三类。

> 注：该 skill 属于"内容创作"而非代码实现，在实现计划中作为一项独立交付物。

---

## 7. 错误处理

| 场景 | 处理 |
|---|---|
| CodeMinder 未运行 | 脚本 `ECONNREFUSED` → 退出码 1 + stderr 提示；CC 可见并转告用户 |
| JSON 结构校验失败 | `/spawn` 返回 400 + `{error}`；脚本透传 stderr |
| 文件 / skill 不存在 | 在**新 CC 侧**由 Read / Skill 工具自然报错（主进程不预检，保持简单） |
| spawn 成功但 claude 启动失败 | 现有 `pty exit` → `SESSION_ENDED` 通知机制自动覆盖 |
| task 含极端特殊字符 | base64 规避（§5.4） |
| cwd 不存在 / 不可访问 | `/spawn` 返回 400，提示具体路径 |

---

## 8. 测试策略

- **脚本单测**：直接 `node codeminder-spawn.js ...`，结合抓包/curl 验证 POST 体正确、退出码与 stderr。
- **端点单测**：`curl -X POST 127.0.0.1:13452/spawn -d '{...}'`，验证建 tab + claude 启动 + 上下文加载 + focus 行为。
- **端到端**：在 CC 内用自然语言触发，全流程验证（含信息收集反问）。
- **边界**：空 task、`--no-focus`、中文路径、多文件多 skill、task 含引号、全空（开空终端）、CodeMinder 未运行。

---

## 9. 实现期关键验证点

1. **注入时机**：`-Command` 直接启动 vs 创建普通 pty 后检测提示符再 write——优先验证 `-Command` 方案是否稳定加载 PowerShell profile 并正确启动 claude TUI。
2. **base64 注入**：在 ConPTY 下 `$p=[Text.Encoding]::UTF8.GetString(...); claude $p` 是否被 claude 正确接收为首条消息。
3. **claude 启动参数**：确认 `claude "<prompt>"` 在当前 claude CLI 版本下确为"交互式 + 首条消息"语义（而非 `--print` 一次性）。
4. **新终端 CCTM_TERMINAL_ID 注入与通知**：确认新 pty 继承新 UUID，PermissionRequest/Stop 通知正常指向新 tab。
5. **环境变量注入**：确认 `CCTM_SPAWN_SCRIPT` 在所有 CodeMinder 终端正确注入，CC 执行 `node "$CCTM_SPAWN_SCRIPT"` 可成功派生终端。

---

## 10. 非目标（YAGNI）

明确**不做**：
- 跨机器 / 远程派生
- 认证 token
- 并发队列 / spawn 限流
- spawn 历史与恢复
- 文件内容预读缓存（交给新 CC 自己 Read）
- CodeMinder 内置编排引擎 / "阶段"解析（属于领域 skill + CC 职责）
- hook 事件自动触发 spawn（编排由领域 skill 自然语言驱动，无需 hook 联动）

---

## 11. 未来可能的扩展

- `--resume <session-id>`：派生终端并恢复某个历史会话上下文。
- `sourceTerminalId` 强校验 + 轻量 token，提升 `/spawn` 安全性。
- 派生终端的"父子关系"可视化（在 UI 标注某 tab 由哪个 tab 派生）。
- 领域 skill 编排的多终端拓扑（如 coding → review + test 并行）。
