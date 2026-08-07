---
name: spawn-terminal
description: 在 CodeMinder 中派生一个新的 Claude Code 终端并预置上下文（文件/skill/任务）。当用户要求"新开终端去做 X"、或当前领域 skill 的编排指示要分叉工作流时使用。
---

# spawn-terminal —— 派生新 CC 终端

通过 Bash 执行 CodeMinder 提供的脚本，派生一个新 Claude Code 终端并预置上下文。脚本路径由环境变量 `$CCTM_SPAWN_SCRIPT`（CodeMinder 注入到每个终端）给出，故跨项目统一写作 `node "$CCTM_SPAWN_SCRIPT" ...`。

> 仅在 CodeMinder 终端内有效（`$CCTM_SPAWN_SCRIPT` 由 CodeMinder 注入）。脚本不在则说明当前不在 CodeMinder 终端，告知用户需在 CodeMinder 中操作。

## 何时使用（双入口）

1. **用户显式触发**：用户说"新开一个终端去做 X""开个终端读 Y 用 Z skill""后台开个终端跑测试"等。
2. **领域 skill 自主分叉**：你正在执行某个领域 skill（如 coding），其编排描述要求在某个阶段（如"完成编码后"）派生新终端（如做 review/test）——此时自主调用本能力，无需用户再次确认。

## 如何调用

```bash
node "$CCTM_SPAWN_SCRIPT" [--files a,b] [--skills x,y] [--task "..."] [--cwd path] [--title "..."] [--no-focus]
```

参数（全部可选）：
- `--files`：逗号分隔的文件路径，新终端启动后会用 **Read** 真实读取。
- `--skills`：逗号分隔的 skill 名，新终端启动后会用 **Skill** 真实激活。
- `--task`：新终端的初始任务文本；缺省则新终端就绪待命。
- `--cwd`：新终端工作目录，默认取当前终端 cwd。
- `--title`：新 tab 标题；缺省据 task 前 ~12 字 / 首文件名 / `Terminal N` 自动推导。
- `--no-focus`：不切换到新终端（后台派生）；缺省 **focus=true**（切到新终端）。

成功：退出码 0，stdout 输出新终端 `{id, title}`。失败：退出码 1，stderr 提示原因（如 CodeMinder 未运行、cwd 不存在、参数校验失败）。

## 信息收集准则（保守 + 非阻塞）

调用前尽力让新终端的上下文完整，但**绝不因信息不全而拒绝**：

- **能从当前会话可靠推断的，自主补全**（如"本次刚改动的文件""当前工作目录"你已知），不必问用户。
- **无法可靠推断的关键信息**（如"用哪个测试 skill"），先用 `AskUserQuestion` 询问用户。
- **询问是非阻塞的**：用户可完整答、部分答、不答，或直接说"别问了就这样开"——一律用**现有信息**执行 spawn。
- **决定权在用户**：问是你的义务，答不答是用户的自由。极端情况下"开空终端"（不传任何参数）也允许。

## 示例

- **全信息直接派生**（用户显式）：
  `node "$CCTM_SPAWN_SCRIPT" --files notes/a.md --skills thought-chain --task "整理本周笔记" --no-focus`
- **信息不全先问再派生**：用户只说"新开一个终端去做测试"。你推断 task=测试、files=本次改动文件，但 skill 无法可靠推断 → 用 `AskUserQuestion` 问"用哪个测试 skill？"；无论用户答、部分答、还是"别问了直接开"，都用现有信息执行，例如 `node "$CCTM_SPAWN_SCRIPT" --task "运行测试套件" --skills <用户选的或省略>`。
- **仅任务**：`node "$CCTM_SPAWN_SCRIPT" --task "跑一遍测试套件"`
- **开空终端**：`node "$CCTM_SPAWN_SCRIPT"`

## 被其他 skill 引用（编排模式）

领域 skill 可在其正文写编排指示，例如：

> …完成编码实现后，调用 `spawn-terminal` 派生一个新终端：加载 `code-review` skill，读取本次改动的文件，对代码做 review（建议 `--no-focus`，原终端继续做提交准备）…

你识别到所在领域 skill 的这类指示后，按上述参数规则组装并执行 Bash。**何时/为何派生由领域 skill 决定，本 skill 只提供"如何派生"的机制。**
