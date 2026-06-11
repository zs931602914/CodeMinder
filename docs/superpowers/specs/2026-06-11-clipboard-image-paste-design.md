# Ctrl+V 智能图片粘贴功能设计

**日期：** 2026-06-11
**状态：** 已批准

## 背景

CodeMinder 是基于 Electron 的 Claude Code 会话管理器，使用 xterm.js + node-pty 运行 Claude Code。Claude Code 内置 `chat:imagePaste` 机制（Windows 上 Alt+V），但在 PTY 环境中无法触发——快捷键被 xterm.js 拦截或无法被 Claude Code 识别。

Claude Code 支持三种图片输入方式，其中「直接输入文件路径」无需特殊语法，输入 PNG 绝对路径即可自动识别并附加图片。

## 方案

**CodeMinder 全权处理剪贴板 → 保存图片 → 路径输入到终端。** 利用 Electron 原生 `clipboard.readImage()` API，无外部依赖。

## 架构

```
┌─────────────────────────────────────────────────┐
│  XTermWrapper.tsx (渲染进程)                      │
│  Ctrl+V keydown handler (capture phase)          │
│    ↓ IPC: clipboard:read-for-paste               │
├─────────────────────────────────────────────────┤
│  preload/index.ts (IPC 桥接)                     │
│    ↓ ipcRenderer.invoke                          │
├─────────────────────────────────────────────────┤
│  clipboard-service.ts (主进程) ← 新增             │
│  electron.clipboard.readImage()                  │
│    → 有图片: save PNG → return path              │
│    → 无图片: readText() → return text            │
│    ↓                                             │
│  ptyService.write(path 或 text)                  │
└─────────────────────────────────────────────────┘
```

## 数据流

```
用户按 Ctrl+V
  → XTermWrapper keydown handler（capture 阶段拦截）
  → e.preventDefault()
  → IPC invoke: clipboard:read-for-paste
  → 主进程 clipboard-service:
      clipboard.readImage().isEmpty()?
        YES → readText() → { type: 'text', text }
        NO  → save PNG to temp → { type: 'image', path }
  → 返回结果到渲染进程
  → XTermWrapper: onData(path 或 text)
  → PTY 接收 → Claude Code 处理
```

## 代码变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/services/clipboard-service.ts` | 新增 | 剪贴板读取 + 图片保存服务，约 30 行 |
| `src/renderer/components/XTermWrapper.tsx` | 修改 | Ctrl+V handler 改为异步 IPC 调用，约 15 行变更 |
| `src/preload/index.ts` | 修改 | 新增 `clipboardReadForPaste` IPC 方法，约 5 行 |
| `src/main/ipc/terminals.ts` | 修改 | 注册 `clipboard:read-for-paste` handler，约 10 行 |

## 各组件详细设计

### clipboard-service.ts（新增）

```typescript
// 核心方法
readForPaste(): { type: 'image'; path: string } | { type: 'text'; text: string } | null
  1. clipboard.readImage() → NativeImage
  2. isEmpty() → YES: readText() → return { type, text } or null
  3. isEmpty() → NO:
     a. nativeImage.toPNG()
     b. fs.writeFileSync(path, buffer) 到 %TEMP%\codeminder-clipboard-{timestamp}.png
     c. return { type: 'image', path }
```

### XTermWrapper.tsx（修改 Ctrl+V handler）

当前行为（直接读文本粘贴）改为：
1. 调用 `window.electronAPI.clipboardReadForPaste()`
2. 结果为 image → `onData(path)`
3. 结果为 text → `onData(text)`
4. 结果为 null → 无操作

### preload/index.ts（新增 IPC 方法）

- `clipboardReadForPaste(): Promise<{type, path/text} | null>`
- 使用 `ipcRenderer.invoke('clipboard:read-for-paste')` 同步等待主进程结果

### terminals.ts（注册 IPC handler）

- `ipcMain.handle('clipboard:read-for-paste', handler)`
- 调用 clipboard-service，返回结果

## 临时文件管理

- 路径：`%TEMP%\codeminder-clipboard-{Date.now()}.png`
- 使用 `app.getPath('temp')` 获取跨平台临时目录
- 不主动清理，依赖 OS 临时文件管理
- 每次粘贴创建新文件，不覆盖旧文件

## 错误处理

- 剪贴板读取失败 → 回退到文本粘贴
- 图片保存失败 → 回退到文本粘贴，控制台输出错误日志
- 不弹窗打扰用户

## 成功标准

- 剪贴板有图片时 Ctrl+V → 保存临时 PNG → 路径出现在终端 → Claude Code 识别为图片
- 剪贴板有文本时 Ctrl+V → 正常粘贴文本（行为不变）
- 剪贴板为空时 Ctrl+V → 无操作（当前行为）
- 截图工具（Win+Shift+S）截图后 Ctrl+V 能正常工作
- 复制文件管理器中的图片文件后 Ctrl+V 能正常工作

## 不做的事（YAGNI）

- 不添加图片预览/缩略图
- 不添加快捷键自定义
- 不支持 Alt+V（仅 Ctrl+V 智能切换）
- 不主动清理临时文件
- 不添加进度提示或 toast
