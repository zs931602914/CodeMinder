# 技术债记录

## 2025-06 → 持续追踪: 窗口恢复后输入不显示 / IME 失效

**症状**
- A. 窗口还原后输入的文字不显示，拖动窗口/切换后一次性涌出（出帧停滞）
- B. 输入法卡英文，切不了中文（08-17 后未再出现）

**修复史（症状 A 三轮未愈，症状 B 已愈）**
- 08-14 `1433cdd`: 禁用 `CalculateNativeWinOcclusion` + restore 时 `webContents.focus()`
  → 治好 B；A 仍复发（workaround 生效中仍复发，遮挡检测不是完整根因）
- 08-17 `fb0619f`: restore 时 xterm 全量 `refresh(0)` + 重挂焦点
  → A 仍复发（refresh 只标记脏区，实际绘制仍依赖 rAF，rAF 不跑则白调）

**当前主假设（08-18）**
窗口还原后渲染进程 `visibilityState` 卡在 hidden → rAF 被 Chromium 节流至停 → xterm 渲染循环停摆；拖动/切换触发 resize 强制同步重绘，内容一次性涌出。

**当前措施（08-18）**
- `webPreferences.backgroundThrottling: false`：即使误判 hidden，rAF 照常跑（缓解 + 验证主假设）
- 诊断日志落盘 `userData/diag.log`（超 5MB 轮转为 diag.log.1），终端关闭不再丢现场
- rAF 心跳告警条件由 `!document.hidden` 改为 `document.hasFocus()`（堵住 visibility 卡死时静默的盲区）

**验证标准**
- `backgroundThrottling: false` 后不再复发 → 主假设成立，保留该设置（代价：最小化时仍渲染，可接受）
- 仍复发 → `diag.log` 中「win:restore / 还原后自动抓取 / rAF 停滞 WARNING / GPU status」现场可定案

**遗留**
- `named-pipe-bridge.ts:210` 既有 TS 报错（`Error.code` 类型），待修
- 问题定位后移除全部 [diag] 埋点与 diag.log 落盘逻辑
