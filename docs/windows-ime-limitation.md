# Windows 中文 IME 底层限制

## 问题

Windows 中文输入法处于中文模式时，在终端输入拼音字母后按 Shift 切换到英文模式，已输入的字母不会出现在终端中。

## 调查结论

### 根因

Windows IME 在中文组合模式下，字母按键在 OS 层面被 IME 拦截，Chromium（Electron）的主进程和渲染进程都无法收到这些按键事件。拼音文本仅存在于 IME 内部缓冲区，JavaScript 无法访问。

这是所有基于 Chromium 的终端（包括 VS Code 内置终端）的共同限制。

### 诊断证据

在 Electron 主进程 `webContents.on('before-input-event')` 和渲染进程 `textarea.addEventListener('keydown', ..., { capture: true })` 同时添加日志，对比结果：

| 输入模式 | keyDown 事件 |
|---------|-------------|
| 英文输入法 | 所有按键可见 |
| 中文 IME 英文子模式 | 所有按键可见 |
| **中文 IME 中文组合模式** | **仅 Shift 等修饰键可见，字母不可见** |

### xterm.js 5.3.0 内部输入路径分析

IME 组合模式下所有输入路径被堵死：

- `_keyDown` → `evaluateKeyboardEvent` 对字母键返回 `undefined`，依赖 `_keyPress`
- `_keyPress` → 被 IME 吞掉，不触发
- `_inputEvent` → 条件 `(!ev.composed || !this._keyDownSeen)` 导致 IME 文本被忽略
- `CompositionHelper` → composition 事件不触发

### 尝试过的修复（均失败）

1. **composition 事件监听** → 事件不触发
2. **input 事件捕获 IME 文本** → 导致标点重复、Enter 选词失效
3. **attachCustomKeyEventHandler 拦截修饰键** → composition 不触发，拦截无效
4. **keydown 追踪字母 + Shift 发送** → 中文模式下字母 keydown 不触发
5. **input 事件 + CJK 文本过滤** → 标点三重复、Enter 输出字母

## 用户操作建议

- 输入拼音后先按 **空格/回车** 选词提交，再按 **Shift** 切换英文
- 或先按 **Shift** 切换到英文模式，再输入英文字母
