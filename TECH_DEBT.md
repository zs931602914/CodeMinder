# 技术债记录

## 2025-06 → 持续追踪: 窗口恢复后输入不显示 / IME 失效

**症状**
- A. 窗口还原后输入的文字不显示，拖动窗口/切换后一次性涌出（出帧停滞）
- B. 输入法卡英文，切不了中文（08-17 后未再出现）

**修复史（症状 A 四轮未愈，症状 B 已愈）**
- 08-14 `1433cdd`: 禁用 `CalculateNativeWinOcclusion` + restore 时 `webContents.focus()`
  → 治好 B；A 仍复发（workaround 生效中仍复发，遮挡检测不是完整根因）
- 08-17 `fb0619f`: restore 时 xterm 全量 `refresh(0)` + 重挂焦点
  → A 仍复发（refresh 只标记脏区，实际绘制仍依赖 rAF，rAF 不跑则白调）
- 08-18 `2838c9b`: `backgroundThrottling=false` + diag.log 落盘 + rAF 心跳告警
  → 08-20 复现时 rAF 告警静默、无 restore 事件 → 一个现场都没抓到
- 08-20 `fa50cea`: 告警去 hasFocus 门限 + 焦点失步检测 + show 自动抓取（纯埋点）

**08-20 复现现场（用户口述，无日志佐证）**
- 早上 09:01 系统从睡眠唤醒，09:40 应用冷启动（win:show，非 restore）
- 症状：打字不显示，点击窗口后涌出；spinner ⠸ 点一下动一帧（合成器停帧铁证）
- 问题后来自行恢复；全程无 rAF 告警、无 restore、无自动抓取
- 机器装向日葵虚拟显卡驱动（OrayIddDriver），系统每天 12:00/18:32 定时睡眠

**当前主假设（08-20，取代旧假设）**
Chromium 焦点/可见性状态失步（窗口实际可见且接受键盘输入，但渲染进程认为
hasFocus()=false 或 hidden）→ 合成器停帧（点击/交互事件踢一帧）；同一失步使旧
告警条件 `hasFocus() && stall>2s` 静默，现场全丢。触发器疑似睡眠唤醒/显示器拓扑
变化（向日葵虚拟显卡驱动嫌疑）。

**当前措施（08-20 `fa50cea`，纯诊断埋点）**
- rAF 停滞无条件告警 + 自动 diagDump（主进程窗口/GPU 现场随告警落盘）
- 渲染进程每 5s 上报焦点状态，主进程与 `isFocused()` 对比，失步 >10s 告警
- `win:show` 后 500ms 自动抓取（覆盖睡眠唤醒/冷启动场景）

**验证标准（下次复现时）**
- 复现时先按 F9 手动抓现场（新埋点需重启 dev 实例生效）
- 若 diag.log 出现「焦点状态失步」或「rAF 停滞」告警 → 假说定案，进入修复阶段
- 若两个告警都未出现而症状仍在 → 帧在产生但 DWM 未呈现，转 OS/驱动层排查（向日葵虚拟显卡）

## 2025-08-20 第五轮: Win+D 还原不激活窗口实锤（IME/输入失效根因）

**新证据（18:06 复现现场，diag.log）**
- 17:50 focused=true 状态下 Win+D 最小化；18:06 Win+D 还原 → `win:restore focused=false`
  紧跟 `win:blur`——窗口可见但【未被激活】僵尸态，持续到用户手动点击（1.8s）
- 用户两次手动 F9 全部未落盘（全日志 24 次抓取均为自动触发）→ 未激活窗口
  收不到键盘输入，F9/打字全部落空，IME 切不了中文（TSF 需真正激活）
- 回溯统计：08-19/08-20 约一半还原事件处于僵尸态（09:43/10:28/02:14/06:07/10:06）
- 结论：旧修复 `webContents.focus()` 只同步渲染进程内部焦点，做不了 OS 级激活

**修复（本轮）**
- restore 时先 `win.focus()`（SetForegroundWindow）；200ms 后验证，
  被前台锁拒绝则置顶切换强制激活（`setAlwaysOnTop(true)→focus()→false`）
- 激活成功后 XTermWrapper 已有的 recover() 自动重挂 IME

**验证标准（重启 dev 实例后）**
- Win+D ×2 → 不点击窗口，直接切中文打字 → 应立即可用
- diag.log 应出现 restore 后 200ms 内 `win:focus focused=true`
  （或「置顶切换强制激活」后紧跟）
- 若激活成功但 IME 仍失效 → 转向 TSF 绑定层（textarea blur+refocus）

**遗留疑点（症状 A 出帧停滞）**
- 本轮 18:06-18:11 停帧期间 rAF 告警与焦点失步告警均静默 → 按既定标准
  指向「帧在产生但 DWM 未呈现」分支（向日葵虚拟显卡嫌疑）；
  若本轮激活修复后停帧不再复现，则僵尸态窗口出帧降级即根因，待观察

## 2025-08-27 第六轮: 首次完整复现「keydown正常+rAF无告警但整屏定格」→ 三段心跳部署

**新证据（14:15-14:19 复现现场，diag.log）**
- 用户确认症状 A 完整复现：整屏定格、spinner 不动、点一下窗口走一帧
- 但与前四轮不同：该时段 keydown 全部实时到达且 activeElement 正常
 （间隔自然非批量爆发），rAF 心跳零告警——JS 主线程活、帧调度自认正常
- 时间关联：症状出现在新建第二个终端后不久（06:19:14 新建）
- 同日 13:05 出现「rAF 停滞 65.5min 后 4s 自愈」，反推停滞起点 12:00:21 =
 定时睡眠时刻 → 属睡眠合法冻结，非 bug，不作为证据

**含义：现有埋点存在盲区**
键盘链路通 + 页面级 rAF 在跑，无法区分三个断点：
- A) pty 回显数据未到达渲染进程（shell/IPC 断供）
- B) xterm.write 收到但未触发重绘（DOM 渲染器调度卡住）
- C) 重绘了但合成器/DWM 未上屏（向日葵虚拟显卡嫌疑）

**修复（本轮，纯诊断埋点）**
- XTermWrapper：write 处记 `__diagLastData`；terminal.onRender 记 `__diagLastRender`
- index.tsx：新增三段心跳判定 interval —— data>render 且滞后 >3s 告警「pty 数据已到 Nms 未 render」→ B 分支实锤；告警不出现而症状仍在（data/render 都新鲜）→ C 分支（DWM/GPU 层）；若压根无新 data 日志 → A 分支（pty/IPC 断供）

**验证标准（下次复现时看 diag.log）**
- 出现「pty 数据已到 Nms 未 render」→ B 分支：查 xterm DOM 渲染器 dirty-row 调度/display:none 切换交互，考虑换 canvas renderer
- 无此告警 + keydown/render 时间戳均新鲜 + 用户看到冻结 → C 分支：转 GPU/驱动层（禁用硬件加速对照实验、卸载向日葵验证）
- data 停更 → A 分支：查 pty 流控/主进程阻塞

**遗留**
- `named-pipe-bridge.ts:210` 既有 TS 报错（`Error.code` 类型），待修
- 问题定位后移除全部 [diag] 埋点与 diag.log 落盘逻辑
