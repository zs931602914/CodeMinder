# CodeMinder — Claude Code 会话管理器

**智能提醒，轻松掌控你的 Claude Code 会话**

[![Electron](https://img.shields.io/badge/Electron-30.5.1-47848F)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.3.0-61DAFB)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3.0-3178C6)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

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

### 适用人群

- 同时使用多个 Claude Code 会话的开发者
- 需要实时获取 AI 交互反馈的终端用户
- 管理多个 PowerShell 会话的重度用户

---

## 快速开始

### 环境要求

- **操作系统**：Windows 11
- **Node.js**：>= 20.11.0
- **PowerShell**：>= 5.1（推荐 PowerShell 7+）

### 安装与运行

```bash
git clone https://github.com/zs931602914/CodeMinder.git
cd CodeMinder
npm install
npm start
```

### 构建

```bash
# 打包为可执行文件
npm run package

# 创建安装程序
npm run make
```

---

## Claude Code 集成

CodeMinder 通过双通道通知系统连接 Claude Code：

| 通道 | 工具 | 延迟 | 使用场景 |
|------|------|------|---------|
| **命名管道**（推荐） | `hook-notify.cmd` | ~0ms | Claude Code hooks（需要快速响应） |
| **HTTP** | `cctm-notify.js` | ~2-3s | 手动测试、脚本调用 |

### 一键配置

1. 启动 CodeMinder
2. 点击左下角 **"Hook 配置"** 按钮
3. 配置自动复制到剪贴板
4. 粘贴到 Claude Code 配置文件：
   - **全局**：`%USERPROFILE%\.claude\settings.json`
   - **项目**：`<project>/.claude/settings.json`
5. 重启 Claude Code 即可

详细配置和故障排查请参考 [通知系统流程文档](docs/notification-flow.md)。

### 通知类型

| 类型 | 说明 | 视觉效果 |
|------|------|---------|
| `auth_required` | 需要授权/操作 | 红色闪烁标签 |
| `session_ended` | 任务/会话完成 | 黄色高亮 |
| `error` | 发生错误 | 红色标记 |

---

## 架构

```
┌──────────────────────────────────────────────────┐
│                CodeMinder 应用                     │
│  ┌──────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │ 命名管道     │ │ PTY 服务    │ │  会话     │ │
│  │ 桥接层       │ │ (node-pty)  │ │  管理器   │ │
│  └──────┬───────┘ └─────────────┘ └─────┬─────┘ │
│         │                               │        │
│  ┌──────┴───────┐                       │        │
│  │ HTTP 服务    │                       │        │
│  │ (端口 13452) │                       │        │
│  └──────────────┘                       │        │
└─────────────────────────────────────────┼────────┘
         ↑                    ↑           │ IPC
         │                    │           ↓
    Claude Code          PowerShell   React 界面
    Hooks               会话         (xterm.js)
```

### 技术栈

- **Electron** 30.5.1 — 桌面应用框架
- **React** 18.3.0 — 界面渲染
- **TypeScript** 5.3.0 — 类型安全
- **node-pty** 1.1.0 — 伪终端
- **xterm.js** 5.3.0 — 终端渲染
- **Electron Forge** 7.6.0 — 构建工具链

---

## 项目结构

```
CodeMinder/
├── src/
│   ├── main/           # Electron 主进程
│   │   ├── ipc/        # IPC 处理器
│   │   └── services/   # 核心服务（PTY、通知、会话）
│   ├── renderer/       # React 界面（组件、样式、类型）
│   └── preload/        # 预加载脚本
├── tools/              # 命令行工具（通知辅助、调试）
├── docs/               # 文档
└── forge.config.ts     # Electron Forge 配置
```

---

## 常见问题

**Q: 通知不生效？**
A: 请确认 CodeMinder 正在运行、Claude Code 配置中的路径正确，并且已重启 Claude Code。

**Q: 连接被拒绝？**
A: 请确认 CodeMinder 正在运行，且 HTTP 服务正在监听 `127.0.0.1:13452`。

**Q: 支持其他 Shell 吗？**
A: 目前仅支持 PowerShell。CMD、WSL 和 Git Bash 支持已在计划中。

---

## 贡献

欢迎贡献！请阅读 [贡献指南](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE) © 2025-2026 yts
