# CodeMinder

**Claude Code Session Manager — Smart Notifications, Effortless Control**

[![Electron](https://img.shields.io/badge/Electron-30.5.1-47848F)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.3.0-61DAFB)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3.0-3178C6)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

<!-- [中文文档](#codeminder---claude-code-会话管理器) -->

---

## What is CodeMinder?

CodeMinder is a terminal manager built specifically for **Claude Code** users. It lets you run multiple PowerShell sessions side by side and receive real-time notifications when Claude Code needs your attention — no more switching between windows to check if your AI assistant is waiting for input.

<!-- Screenshots placeholder -->
<!--
![CodeMinder Screenshot](docs/screenshots/main.png)
![Notification Demo](docs/screenshots/notification.gif)
-->

### Key Features

- **Multi-Terminal Management** — Run multiple PowerShell sessions in parallel with independent environments
- **Claude Code Integration** — Real-time tab notifications via Named Pipe + HTTP dual-channel bridge
- **Smart Notifications** — Red flash for auth requests, yellow for session completion
- **Native Terminal Experience** — xterm.js powered rendering with full ANSI color support
- **One-Click Hook Setup** — Built-in clipboard copy for Claude Code hooks configuration
- **Privacy Mode** — Quick toggle to hide terminal content

### Who is this for?

- Developers working with multiple Claude Code sessions simultaneously
- Anyone who wants real-time AI interaction feedback in their terminal
- Power users managing multiple PowerShell sessions

---

## Quick Start

### Prerequisites

- **OS**: Windows 11
- **Node.js**: >= 20.11.0
- **PowerShell**: >= 5.1 (PowerShell 7+ recommended)

### Install & Run

```bash
git clone https://github.com/zs931602914/CodeMinder.git
cd CodeMinder
npm install
npm start
```

### Build

```bash
# Package as executable
npm run package

# Create installer
npm run make
```

---

## Claude Code Integration

CodeMinder connects to Claude Code through a dual-channel notification system:

| Channel | Tool | Latency | Use Case |
|---------|------|---------|----------|
| **Named Pipe** (recommended) | `hook-notify.cmd` | ~0ms | Claude Code hooks (fast response needed) |
| **HTTP** | `cctm-notify.js` | ~2-3s | Manual testing, scripts |

### Setup (One-Click)

1. Launch CodeMinder
2. Click the **"Hook Config"** button in the bottom-left corner
3. Configuration is copied to clipboard automatically
4. Paste into your Claude Code settings file:
   - **Global**: `%USERPROFILE%\.claude\settings.json`
   - **Project**: `<project>/.claude/settings.json`
5. Restart Claude Code

For manual setup, see [Claude Code Hooks Guide](docs/CLAUDE_CODE_HOOKS.md).

### Notification Types

| Type | Description | Visual |
|------|-------------|--------|
| `auth_required` | Claude needs your authorization | Red flashing tab |
| `session_ended` | Task/session completed | Yellow highlight |
| `error` | Error occurred | Red marker |

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                 CodeMinder App                    │
│  ┌──────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │ Named Pipe   │ │ PTY Service │ │  Session  │ │
│  │ Bridge       │ │ (node-pty)  │ │  Manager  │ │
│  └──────┬───────┘ └─────────────┘ └─────┬─────┘ │
│         │                               │        │
│  ┌──────┴───────┐                       │        │
│  │ HTTP Service │                       │        │
│  │ (port 13452) │                       │        │
│  └──────────────┘                       │        │
└─────────────────────────────────────────┼────────┘
         ↑                    ↑           │ IPC
         │                    │           ↓
    Claude Code          PowerShell   React UI
    Hooks               Sessions    (xterm.js)
```

### Tech Stack

- **Electron** 30.5.1 — Desktop app framework
- **React** 18.3.0 — UI rendering
- **TypeScript** 5.3.0 — Type safety
- **node-pty** 1.1.0 — Pseudo-terminal
- **xterm.js** 5.3.0 — Terminal rendering
- **Electron Forge** 7.6.0 — Build toolchain

---

## Project Structure

```
CodeMinder/
├── src/
│   ├── main/           # Electron main process
│   │   ├── ipc/        # IPC handlers
│   │   └── services/   # Core services (PTY, notifications, session)
│   ├── renderer/       # React UI (components, styles, types)
│   └── preload/        # Preload scripts
├── tools/              # CLI tools (notification helpers, debug)
├── docs/               # Documentation
└── forge.config.ts     # Electron Forge config
```

---

## FAQ

**Q: Notifications not working?**
A: Make sure CodeMinder is running, paths in your Claude Code config are correct, and you've restarted Claude Code.

**Q: Connection refused?**
A: Verify CodeMinder is running and the HTTP service is listening on `127.0.0.1:13452`.

**Q: Supports other shells?**
A: Currently PowerShell only. CMD, WSL, and Git Bash support is planned.

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE) © 2025-2026 yts

---

<a id="codeminder---claude-code-会话管理器"></a>

# CodeMinder — Claude Code 会话管理器

**智能提醒，轻松掌控你的 Claude Code 会话**

---

## 简介

CodeMinder 是一款专为 **Claude Code** 用户打造的终端管理器。支持同时运行多个 PowerShell 会话，并在 Claude Code 需要你操作时实时通知你——不用再频繁切窗口确认 AI 是否在等你。

### 核心特性

- **多终端并行管理** — 同时运行多个独立 PowerShell 会话
- **Claude Code 深度集成** — 命名管道 + HTTP 双通道实时通知
- **智能提醒** — 红色闪烁表示需要授权，黄色表示任务完成
- **原生终端体验** — 基于 xterm.js，支持完整 ANSI 颜色和交互
- **一键配置 Hook** — 内置剪贴板复制，快速配置 Claude Code hooks
- **防窥模式** — 快速隐藏终端内容

### 快速开始

```bash
git clone https://github.com/zs931602914/CodeMinder.git
cd CodeMinder
npm install
npm start
```

**环境要求**：Windows 11 / Node.js >= 20.11.0 / PowerShell >= 5.1

### Claude Code 集成配置

1. 启动 CodeMinder
2. 点击左下角 **"📋 Hook 配置"** 按钮，配置自动复制到剪贴板
3. 粘贴到 Claude Code 配置文件（全局或项目级 `settings.json`）
4. 重启 Claude Code 即可

详细配置和故障排查请参考 [通知系统流程文档](docs/notification-flow.md)。

### 通知类型

| 类型 | 说明 | 视觉效果 |
|------|------|---------|
| `auth_required` | 需要授权/操作 | 红色闪烁 |
| `session_ended` | 会话结束 | 黄色高亮 |
| `error` | 发生错误 | 红色标记 |

### 技术栈

Electron + React + TypeScript + node-pty + xterm.js

### 贡献

欢迎贡献！请阅读 [贡献指南](CONTRIBUTING.md)。

### 许可证

[MIT](LICENSE) © 2025-2026 yts
