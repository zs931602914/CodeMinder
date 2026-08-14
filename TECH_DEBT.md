# 技术债记录

## 2025-06: 窗口恢复后输入框不刷新 + IME 失效

**问题**
- 输入文字不显示，拖动窗口缩放后才显示
- 输入法卡英文，切不了中文，点击界面后才恢复

**根因**
Chromium Windows 原生窗口遮挡检测（CalculateNativeWinOcclusion）在窗口最小化/恢复时误判窗口不可见，导致合成器停帧 + 焦点状态与 OS 失步（IME 上下文挂不上）。

**修复**（`src/main/index.ts`）
- `app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')`（app ready 前）
- `mainWindow.on('restore', () => mainWindow?.webContents.focus())`

**遗留**
- 关闭遮挡检测有轻微性能代价（被遮挡时不再跳过渲染），桌面应用可接受
- 若后续升级 Electron 33+，可尝试移除 workaround 验证上游是否已修复
- `named-pipe-bridge.ts:210` 存在与此无关的既有 TS 报错（`Error.code` 类型），待修
