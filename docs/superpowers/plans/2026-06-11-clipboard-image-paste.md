# Ctrl+V 智能图片粘贴 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 CodeMinder 终端中按 Ctrl+V 时，自动检测剪贴板内容——有图片则保存为临时 PNG 并将路径输入终端，有文本则正常粘贴。

**Architecture:** 新增 `clipboard-service.ts` 服务（主进程），通过 IPC 暴露给渲染进程。修改 `XTermWrapper.tsx` 的 Ctrl+V handler 为异步 IPC 调用。利用 Electron 原生 `clipboard.readImage()` API，无外部依赖。

**Tech Stack:** Electron 30 (clipboard API, NativeImage), Node.js fs/path, TypeScript

---

### Task 1: 新增 clipboard-service.ts

**Files:**
- Create: `src/main/services/clipboard-service.ts`

- [ ] **Step 1: 创建 clipboard-service.ts**

```typescript
import { clipboard, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

type PasteResult =
  | { type: 'image'; path: string }
  | { type: 'text'; text: string }
  | null;

class ClipboardService {
  /**
   * 读取剪贴板内容，优先检测图片。
   * 有图片 → 保存为临时 PNG，返回文件路径。
   * 无图片 → 读取文本。
   * 都为空 → 返回 null。
   */
  readForPaste(): PasteResult {
    const image = clipboard.readImage();

    if (!image.isEmpty()) {
      const tempDir = app.getPath('temp');
      const filename = `codeminder-clipboard-${Date.now()}.png`;
      const filePath = path.join(tempDir, filename);

      try {
        fs.writeFileSync(filePath, image.toPNG());
        return { type: 'image', path: filePath };
      } catch (err) {
        console.error('[ClipboardService] Failed to save image:', err);
        // 图片保存失败，回退到文本
      }
    }

    const text = clipboard.readText();
    if (text) {
      return { type: 'text', text };
    }

    return null;
  }
}

export const clipboardService = new ClipboardService();
```

- [ ] **Step 2: 验证文件编译无错**

Run: `cd D:/myProject/codeminder && npx tsc --noEmit src/main/services/clipboard-service.ts 2>&1 | head -20`
Expected: 无错误输出

- [ ] **Step 3: 提交**

```bash
git add src/main/services/clipboard-service.ts
git commit -m "feat: 新增 clipboard-service，支持图片检测与临时文件保存"
```

---

### Task 2: 注册 IPC handler

**Files:**
- Modify: `src/main/ipc/terminals.ts:72` (在 `registerTerminalIpcHandlers` 函数末尾添加)

- [ ] **Step 1: 在 terminals.ts 中注册 clipboard:read-for-paste handler**

在 `registerTerminalIpcHandlers()` 函数内，`terminal:triggerNotification` handler 之后（约 187 行），`ptyService.on('data', ...)` 之前，添加：

```typescript
  // 剪贴板智能粘贴：优先检测图片，回退到文本
  ipcMain.handle('clipboard:read-for-paste', () => {
    return clipboardService.readForPaste();
  });
```

同时在文件顶部的 import 区域添加：

```typescript
import { clipboardService } from '../services/clipboard-service';
```

完整 import 区域变为：

```typescript
import { ipcMain, BrowserWindow } from 'electron';
import { ptyService, PtyDataEvent, PtyExitEvent } from '../services/pty-service';
import { sessionManager } from '../services/session-manager';
import { windowFlashManager } from '../services/window-flash-manager';
import { NotificationType } from '../../renderer/types/terminal';
import { clipboardService } from '../services/clipboard-service';
```

- [ ] **Step 2: 验证编译**

Run: `cd D:/myProject/codeminder && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误输出（preload 可能暂时报错，因为还没加类型，但 main 进程应无错）

- [ ] **Step 3: 提交**

```bash
git add src/main/ipc/terminals.ts
git commit -m "feat: 注册 clipboard:read-for-paste IPC handler"
```

---

### Task 3: 扩展 preload IPC 桥接

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: 在 ElectronAPI 接口中添加新方法**

在 `ElectronAPI` 接口（第 16-41 行）的「通知操作」区块前，添加：

```typescript
  // 剪贴板操作
  clipboardReadForPaste: () => Promise<{ type: 'image'; path: string } | { type: 'text'; text: string } | null>;
```

- [ ] **Step 2: 在 electronAPI 对象中添加实现**

在 `electronAPI` 对象的「Hook 配置」区块（第 66 行 `getHookConfig`）之前，添加：

```typescript
  // 剪贴板操作
  clipboardReadForPaste: () => ipcRenderer.invoke('clipboard:read-for-paste'),
```

- [ ] **Step 3: 验证编译**

Run: `cd D:/myProject/codeminder && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误输出

- [ ] **Step 4: 提交**

```bash
git add src/preload/index.ts
git commit -m "feat: preload 桥接添加 clipboardReadForPaste"
```

---

### Task 4: 修改 Ctrl+V handler 为智能粘贴

**Files:**
- Modify: `src/renderer/components/XTermWrapper.tsx:183-196`

- [ ] **Step 1: 替换 Ctrl+V handler**

将 `XTermWrapper.tsx` 第 183-196 行的 Ctrl+V 处理块：

```typescript
      // Ctrl+V: 粘贴
      if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.readText().then(text => {
          if (text) {
            // 发送数据到 PTY
            onDataRef.current?.(text);
          }
        }).catch(() => {
          // 粘贴失败时静默处理
        });
        return;
      }
```

替换为：

```typescript
      // Ctrl+V: 智能粘贴（图片优先，回退文本）
      if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        e.stopPropagation();
        window.electronAPI.clipboardReadForPaste().then(result => {
          if (!result) return;
          if (result.type === 'image') {
            onDataRef.current?.(result.path);
          } else {
            onDataRef.current?.(result.text);
          }
        }).catch(() => {
          // 粘贴失败时静默处理
        });
        return;
      }
```

- [ ] **Step 2: 同步修改右键菜单的粘贴功能**

将 `XTermWrapper.tsx` 中 `handlePaste` 回调（约第 428-450 行）：

```typescript
  const handlePaste = useCallback(async () => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    // 先关闭菜单
    setContextMenuPosition(null);

    // 确保终端有焦点
    terminal.focus();

    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;

      // terminal.paste() 不会触发 onData 事件，需要手动处理
      // 1. 发送数据到 PTY
      onDataRef.current?.(text);
      // 2. 同时写入终端显示（PTY 会 echo 回来，但为了即时反馈）
      // 注意：这里不需要手动 write，因为 PTY 的响应会通过 onTerminalData 写入
    } catch {
      // 粘贴失败时静默处理
    }
  }, []);
```

替换为：

```typescript
  const handlePaste = useCallback(async () => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    // 先关闭菜单
    setContextMenuPosition(null);

    // 确保终端有焦点
    terminal.focus();

    try {
      const result = await window.electronAPI.clipboardReadForPaste();
      if (!result) return;
      if (result.type === 'image') {
        onDataRef.current?.(result.path);
      } else {
        onDataRef.current?.(result.text);
      }
    } catch {
      // 粘贴失败时静默处理
    }
  }, []);
```

- [ ] **Step 3: 验证编译**

Run: `cd D:/myProject/codeminder && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误输出

- [ ] **Step 4: 提交**

```bash
git add src/renderer/components/XTermWrapper.tsx
git commit -m "feat: Ctrl+V 和右键粘贴改为智能图片/文本粘贴"
```

---

### Task 5: 集成测试与验证

**Files:** 无新增，仅验证

- [ ] **Step 1: 启动应用**

Run: `cd D:/myProject/codeminder && npm start`

- [ ] **Step 2: 测试文本粘贴**

操作：在任意文本编辑器中复制一段文字，在 CodeMinder 终端中按 Ctrl+V
Expected: 文本正常粘贴到终端（行为与之前一致）

- [ ] **Step 3: 测试图片粘贴（截图）**

操作：用 Win+Shift+S 截取屏幕区域，切换到 CodeMinder 终端按 Ctrl+V
Expected: 终端中出现一个临时 PNG 文件路径（如 `C:\Users\...\AppData\Local\Temp\codeminder-clipboard-xxxxx.png`）

- [ ] **Step 4: 测试图片粘贴（文件复制）**

操作：在文件管理器中复制一张 PNG 图片，在 CodeMinder 终端中按 Ctrl+V
Expected: 终端中出现该图片文件的路径

- [ ] **Step 5: 测试空剪贴板**

操作：清空剪贴板后按 Ctrl+V
Expected: 无任何输出

- [ ] **Step 6: 测试图片路径被 Claude Code 识别**

操作：在 Claude Code 会话中截图后 Ctrl+V，确认 Claude Code 将路径识别为图片
Expected: Claude Code 显示 `[Image #1]` 或类似图片附加标识

- [ ] **Step 7: 验证临时文件存在**

Run: `ls $TEMP/codeminder-clipboard-*.png`
Expected: 能看到之前粘贴时生成的临时 PNG 文件
