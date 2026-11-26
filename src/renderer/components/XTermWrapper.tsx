import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { themes, TerminalTheme } from '../types/terminal';
import '../styles/app.css';

// ===== 滚动修复（功能代码，不随 [diag] 埋点移除）=====
// 用户最近一次「可能是在滚动终端」的输入：种类 + 目标元素 + 时刻。由 correctScrollDesync 判断某个 scroll 事件
// 是不是用户发起的：滚轮和导航键要求落在本终端内，鼠标要求落在滚动条上（见函数内 isFromUser）。
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
const lastScrollInput = { at: 0, kind: '', target: null as EventTarget | null };
const markScrollInput = (kind: string, target: EventTarget | null): void => {
  lastScrollInput.at = performance.now();
  lastScrollInput.kind = kind;
  lastScrollInput.target = target;
};
window.addEventListener('wheel', (e) => markScrollInput('滚轮', e.target), { capture: true, passive: true });
window.addEventListener('mousedown', (e) => markScrollInput('鼠标', e.target), { capture: true });
window.addEventListener('mousemove', (e) => { if (e.buttons) markScrollInput('鼠标', e.target); }, { capture: true });
window.addEventListener('keydown', (e) => { if (SCROLL_KEYS.has(e.key)) markScrollInput('按键', e.target); }, { capture: true });


const resumeFollowAfterClearScrollback = (terminal: Terminal) =>
  terminal.parser.registerCsiHandler({ final: 'J' }, (params) => {
    try {
      // 仅在确有回滚区可清时才复位：ESC[3J 对空回滚区是空操作，不应改变用户的翻阅状态
      if (params[0] === 3 && terminal.buffer.active.length > terminal.rows) {
        terminal.scrollToBottom();
      }
    } catch {
      // 处理器内抛异常会让 xterm 的 WriteBuffer 无限重试同一段数据、冻住终端，必须兜底
    }
    return false; // 不拦截，交给 xterm 正常处理
  });

// [fix] 在 xterm 处理完每个 scroll 事件后做两项纠正。根因：xterm 5.3.0 的 Viewport 靠单个布尔标志
// _ignoreNextScrollEvent 区分「自己同步滚动条」和「用户滚动」，输出密集时这个标志频繁错位。
//
// ① 跟随输出时（视图在底部），不许「不是用户发起的」scroll 事件把视图带离底部。
//    TUI 清回滚区后整段重绘时，滚动条先被钳到 0、下一帧又被同步到中间位置，两次变化并成一个事件，
//    标志错位，xterm 把自己的同步当成了用户滚动：视图被带离底部并进入「用户翻阅」状态，
//    重绘剩余的行再把视图一路顶到回滚区顶端（线上 14:59:55 现场，用户当时并没有滚动）→ 立即回到底部。
// ② 用户滚动被标志吞掉时补上。标志处于「待忽略」时到达的用户滚动事件会被 xterm 直接丢弃：
//    滚动条已经到了用户拨到的位置，视图却不动，随后滚动条被同步回视图位置——看起来就是滚动条往回弹
//    （线上 45 分钟出现 21 次；视图在顶部时想往下滚却总被弹回顶部，也是它）→ 按滚动条所在的行把视图补过去。
//
// 代价：触控、触控笔等未跟踪的输入方式，在跟随状态下滚动会被 ① 拉回底部（鼠标、触控板、键盘不受影响）。
const correctScrollDesync = (terminal: Terminal): (() => void) => {
  const viewport = terminal.element?.querySelector('.xterm-viewport') as HTMLElement | null;
  if (!viewport) return () => {};
  // 行高取自 DOM 渲染器的第一行（与 xterm 内部的 _currentRowHeight 同源）；量不到就不做纠正 ②
  const rowHeight = (): number => {
    const row = terminal.element?.querySelector('.xterm-rows > div') as HTMLElement | null;
    return row ? row.getBoundingClientRect().height : 0;
  };
  let wasFollowing = false; // capture 阶段记录：事件到来时视图是否正在跟随输出
  let byUser = false;       // capture 阶段记录：事件是否紧随本终端的用户滚动输入
  let row = -1;             // capture 阶段记录：滚动条所在的行
  const before = (): void => {
    try {
      const buf = terminal.buffer.active;
      wasFollowing = buf.viewportY === buf.baseY;
      const input = lastScrollInput;
      const target = input.target instanceof Node ? input.target : null;
      const insideTerminal = !!target && !!terminal.element?.contains(target);
      // 鼠标输入必须落在滚动条上：点击终端正文、侧边栏等不算滚动输入
      const hitsInput = input.kind === '鼠标' ? !!target && viewport.contains(target) : insideTerminal;
      byUser = performance.now() - input.at < 400 && hitsInput;
      const h = rowHeight();
      row = h > 0 ? Math.round(viewport.scrollTop / h) : -1;
    } catch {
      wasFollowing = false; // 探测不到就什么都不做
      byUser = false;
    }
  };
  // bubble 监听注册在 xterm 的 _handleScroll 之后，此时 xterm 已按该事件处理完
  const after = (): void => {
    try {
      const buf = terminal.buffer.active;
      if (wasFollowing && !byUser && buf.viewportY < buf.baseY) {
        terminal.scrollToBottom(); // ①
      } else if (byUser && row >= 0 && row !== buf.viewportY) {
        terminal.scrollToLine(row); // ②
      }
    } catch {
      // 修复失败不得影响滚动
    }
  };
  viewport.addEventListener('scroll', before, { capture: true });
  viewport.addEventListener('scroll', after);
  return () => {
    viewport.removeEventListener('scroll', before, { capture: true });
    viewport.removeEventListener('scroll', after);
  };
};
// ===== 滚动修复结束 =====

// [diag] 应用自己写 scrollTop 的时刻（问题定位后随其余 [diag] 埋点移除）
const diagAppWrite = { fit: 0, hack: 0 };

interface XTermWrapperProps {
  terminalId: string;
  onData?: (data: string) => void;
  theme?: keyof typeof themes;
  hasNotification?: boolean;
  isActive?: boolean;
  privacyMode?: boolean;
}

export const XTermWrapper: React.FC<XTermWrapperProps> = React.memo(({
  terminalId,
  onData,
  theme = 'dark',
  hasNotification = false,
  isActive = false,
  privacyMode = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const onDataRef = useRef(onData);
  const hasNotificationRef = useRef<boolean>(hasNotification);
  const isActiveRef = useRef<boolean>(isActive);
  const lastClearedRef = useRef<number>(0);
  const [isReady, setIsReady] = useState(false);
  const [containerReady, setContainerReady] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);

  // 保持 onDataRef 最新
  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  // 保持 hasNotificationRef 最新
  useEffect(() => {
    hasNotificationRef.current = hasNotification;
  }, [hasNotification]);

  // 保持 isActiveRef 最新
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // 等待容器有尺寸后再初始化
  useEffect(() => {
    if (!containerRef.current || containerReady) return;

    const checkContainer = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setContainerReady(true);
        } else {
          requestAnimationFrame(checkContainer);
        }
      }
    };

    checkContainer();
  }, [containerReady]);

  // 初始化 xterm.js - 只在容器准备好后执行
  useEffect(() => {
    if (!containerRef.current || !containerReady || terminalRef.current) return;

    // 创建终端实例 - 先设置默认尺寸
    const terminal = new Terminal({
      theme: themes[privacyMode ? 'privacy' : theme],
      fontFamily: 'Consolas, Monaco, "Courier New", monospace',
      fontSize: privacyMode ? 13 : 14,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 1000,
      allowProposedApi: true,
      cols: 80,
      rows: 24,
      scrollOnUserInput: false,      // 禁用自动滚动，允许手动控制滚动条
      // 复制粘贴相关配置
      rightClickSelectsWord: true,   // 右键选择单词
    });

    // 先打开终端，再加载 fitAddon
    terminal.open(containerRef.current);

    // 创建自适应插件
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // ESC[3J 清除回滚区后恢复跟随输出（见 resumeFollowAfterClearScrollback）
    const resumeFollow = resumeFollowAfterClearScrollback(terminal);

    // 纠正 xterm 滚动同步标志错位造成的两类问题：视图被非用户滚动带离底部、用户滚动被吞（见 correctScrollDesync）
    const undoScrollGuard = correctScrollDesync(terminal);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    setIsReady(true);

    // 使用 onData 事件处理正常输入（支持 IME/中文输入）
    terminal.onData((data) => {
      onDataRef.current?.(data);
    });

    // [diag] 三段心跳之一：xterm 真正执行了重绘（区分「收到数据没画」vs「画了没上屏」）
    terminal.onRender(() => {
      (window as any).__diagLastRender = performance.now();
    });

    // 选中文本时自动复制到剪贴板
    terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(() => {
          // 复制失败时静默处理
        });
      }
    });

    // 修复：防止 textarea 焦点导致滚动到顶部
    // 这是 xterm.js 的已知问题：textarea 获得焦点时会触发页面滚动
    // 参考：https://github.com/xtermjs/xterm.js/issues/358
    //      https://github.com/xtermjs/xterm.js/issues/1981
    const handleFocus = () => {
      const now = Date.now();
      if (now - lastClearedRef.current < 100) return; // 防抖 100ms

      if (hasNotificationRef.current) {
        lastClearedRef.current = now;
        window.electronAPI.clearNotification(terminalId);
      }
    };

    // 在 capture 阶段保存滚动位置，焦点事件后恢复
    const handleTextareaFocusCapture = () => {
      const viewport = terminalRef.current?.element?.querySelector('.xterm-viewport') as HTMLElement;
      if (!viewport) return;

      const savedScrollTop = viewport.scrollTop;

      requestAnimationFrame(() => {
        // 焦点处理后如果滚动位置变了，恢复原位
        if (viewport.scrollTop !== savedScrollTop) {
          diagAppWrite.hack = performance.now(); // [diag] 标记：这次 scrollTop 变化来自焦点补丁
          viewport.scrollTop = savedScrollTop;
        }
      });
    };

    // 点击终端容器时也清除通知（处理终端已有焦点的情况）
    const handleContainerClick = () => {
      const now = Date.now();
      if (now - lastClearedRef.current < 100) return; // 防抖 100ms

      if (hasNotificationRef.current) {
        lastClearedRef.current = now;
        window.electronAPI.clearNotification(terminalId);
      }
    };

    terminal.textarea?.addEventListener('focus', handleFocus);
    // 在 capture 阶段监听焦点事件，在滚动发生前保存位置
    terminal.textarea?.addEventListener('focus', handleTextareaFocusCapture, { capture: true, passive: true });
    containerRef.current?.addEventListener('click', handleContainerClick);

    // 右键菜单处理
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      setContextMenuPosition({ x: e.clientX, y: e.clientY });
    };

    terminal.element?.addEventListener('contextmenu', handleContextMenu);

    // 快捷键处理（Ctrl+C/V 复制粘贴）
    const handleKeydown = (e: KeyboardEvent) => {
      // Ctrl+Enter: 换行而不执行命令
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        // 发送换行符到 PTY
        onDataRef.current?.('\n');
        return;
      }
      // Ctrl+C: 复制（当有选中文本时）
      if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        const selection = terminal.getSelection();
        if (selection) {
          e.preventDefault();
          e.stopPropagation();
          navigator.clipboard.writeText(selection);
          return;
        }
        // 没有选中文本时，让 Ctrl+C 正常传递（用于中断命令）
      }
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
    };

    // 在 capture 阶段监听，确保在 xterm.js 处理之前拦截
    terminal.textarea?.addEventListener('keydown', handleKeydown, { capture: true });

    // [diag] 滚动诊断（问题定位后随其余 [diag] 埋点移除）。
    // 「viewport 跳顶」是 capture 监听，先于 xterm 的 _handleScroll 执行，打印的 ydisp 是「处理前」
    // 的值（线上日志 95% 的条目处理前已是 0：视图先到顶，滚动条事后才跟上）。
    // 补三类信息：①异常 scroll 事件的完整前后状态 + 用户输入时距；②ydisp 变化的来源归因；
    // ③不经 onScroll 的 ydisp 变化（resize/reflow/清屏）。
    // 纯观察不修正：探针排在 xterm 的监听之前，自身抛异常会让 xterm 收不到滚动事件，故全部 try/catch。
    const diagId = terminalId.slice(0, 8);
    const diagCore = (terminal as any)._core;
    const diagView = diagCore?.viewport; // xterm Viewport 内部对象
    const diagViewport = terminal.element?.querySelector('.xterm-viewport') as HTMLElement | null;
    let diagLastVpScroll = diagViewport?.scrollTop ?? 0;
    let diagLastYdisp = diagCore?.buffer?.ydisp ?? 0;
    let diagLastEmit: (() => void) | null = null; // capture 阶段生成，bubble 阶段（xterm 处理后）补全输出
    let diagLastUserLog = 0;                     // 用户滚动事件的限频
    let diagDriftHead = diagLastYdisp;           // 非滚动条来源的 ydisp 变化：聚合窗口的起点
    let diagDriftCount = 0;
    let diagDriftLoggedAt = 0;
    let diagDriftYbase = diagCore?.buffer?.ybase ?? 0;   // 与 diagDriftHead 同一时刻的 ybase/行数，用来识别非逐行漂移的跳变
    let diagDriftLines = diagCore?.buffer?.lines?.length ?? 0;
    let diagLastResizeAt = 0;                          // 最近一次 resize 时刻：TUI 常在窗口尺寸变化后清屏重绘，需和 ESC[3J 对时
    let diagLastRows = terminal.rows;
    let diagLastCols = terminal.cols;
    let diagLastLines = diagCore?.buffer?.lines?.length ?? 0;
    const diagMsAgo = (t: number): string => (t ? `${Math.round(performance.now() - t)}ms前` : '无');
    const diagState = (): string => {
      const buf = diagCore.buffer;
      return `ydisp=${buf.ydisp}/${buf.ybase} lines=${buf.lines.length}x${terminal.rows}` +
        `${diagCore.buffers.active === diagCore.buffers.alt ? ' 备用屏幕' : ''} 用户翻过=${diagCore._bufferService.isUserScrolling ? 1 : 0}`;
    };

    // capture：先于 xterm 记录「处理前」状态。只挑异常事件：与视图不对齐、或滚动区塌缩
    const diagScrollCapture = (): void => {
      try {
        if (!diagViewport || !diagCore || !diagView) return;
        const now = performance.now();
        const st = diagViewport.scrollTop;
        const buf = diagCore.buffer;
        const rowH = diagView._currentRowHeight || 1;
        if (st === 0 && diagLastVpScroll > 500) {
          console.log(`[diag] ${new Date().toISOString()} viewport 跳顶: from=${Math.round(diagLastVpScroll)}px→0 ydisp=${buf.ydisp} lines=${buf.lines.length} hidden=${document.hidden} hasFocus=${document.hasFocus()}`);
        }
        diagLastVpScroll = st;
        const synced = Math.abs(st - buf.ydisp * rowH) < rowH / 2;
        const collapsed = diagViewport.scrollHeight - diagViewport.clientHeight < 5 && buf.lines.length - terminal.rows > 1;
        if (synced && !collapsed) return; // xterm 自己同步滚动条，无需记录
        // 用户滚动（滚轮/拖滑块）每帧都有事件，限频；应用自己写 scrollTop 的则每条都记
        const byUser = lastScrollInput.kind !== '按键' && now - lastScrollInput.at < 200;
        const byApp = now - Math.max(diagAppWrite.fit, diagAppWrite.hack) < 100;
        if (byUser && !byApp && !collapsed && now - diagLastUserLog < 300) return;
        if (byUser) diagLastUserLog = now;
        const row = Math.round(st / rowH);
        const detail = `scrollTop=${Math.round(st)}(第${row}行) ${diagState()} 忽略标志=${diagView._ignoreNextScrollEvent ? 1 : 0}` +
          ` 滚动区=${diagViewport.scrollHeight}px/可视${diagViewport.clientHeight}px${collapsed ? '(塌缩!)' : ''}` +
          ` 可见=${diagViewport.offsetParent ? 1 : 0} 当前标签=${terminal.element?.closest('.terminal-wrapper')?.classList.contains('active') ? 1 : 0}` +
          ` 输入=${lastScrollInput.kind ? `${lastScrollInput.kind}@${diagMsAgo(lastScrollInput.at)}` : '无'}` +
          ` fit回底=${diagMsAgo(diagAppWrite.fit)} 焦点补丁=${diagMsAgo(diagAppWrite.hack)}` +
          ` 有焦点=${document.hasFocus() ? 1 : 0} 处理前ydisp=${buf.ydisp}`;
        diagLastEmit = () => {
          const post = diagCore.buffer.ydisp;
          console.log(`[diag] ${new Date().toISOString()} scroll事件 id=${diagId} ${detail} 处理后ydisp=${post} xterm${post === row ? '已对齐' : '未跟随'}`);
        };
      } catch {
        // 诊断失败不得影响滚动
      }
    };
    // bubble：注册在 xterm 之后，此时 _handleScroll 已执行
    const diagScrollBubble = (): void => {
      const emit = diagLastEmit;
      diagLastEmit = null;
      try {
        if (diagCore) diagLastYdisp = diagCore.buffer.ydisp; // 滚动条路径不触发公开 onScroll，在这里同步基线
        emit?.();
      } catch {
        // 诊断失败不得影响滚动
      }
    };
    diagViewport?.addEventListener('scroll', diagScrollCapture, { capture: true });
    diagViewport?.addEventListener('scroll', diagScrollBubble);

    // ydisp 变化归因（调用栈里的方法名在 xterm 压缩包里保留）；滚动条引起的已由 scroll事件 记录
    const diagScrollSub = terminal.onScroll(() => {
      try {
        if (!diagCore) return;
        const now = performance.now();
        const y = diagCore.buffer.ydisp;
        if (y === diagLastYdisp) return;
        const from = diagLastYdisp;
        diagLastYdisp = y;
        const stack = new Error().stack || '';
        if (stack.includes('_handleScroll')) return;
        const byKey = stack.includes('_keyDown');
        // 输出新行导致的漂移（每行 ±1）每行触发一次：2 秒聚合成一条。以下情况立即记录，不给限频吞掉：
        // 一次跳 ≥2 行、ybase 或行数减少（ESC[3J 清回滚区、trim）。注意跟随输出时 ybase 会逐行递增，不算
        const nowBuf = diagCore.buffer;
        const big = Math.abs(y - from) >= 2 || nowBuf.ybase < diagDriftYbase || nowBuf.lines.length < diagDriftLines;
        if (!byKey && !big && now - diagDriftLoggedAt < 2000) { diagDriftCount++; return; }
        // 类名在压缩包里被打乱，但方法名保留；去掉探针自身帧和 EventEmitter 的递归帧，匿名帧只留文件名
        const frames = stack.split('\n').slice(2)
          .map((s) => s.trim().replace(/^at /, ''))
          .filter((f) => !f.includes('EventEmitter'))
          .map((f) => (f.includes(' (') ? f.split(' (')[0] : f.split('/').pop() as string));
        const cause = byKey ? '按键翻页'
          : stack.includes('scrollLines') ? 'scrollLines'
          : stack.includes('reflow') || stack.includes('.resize (') ? 'resize/reflow'
          : stack.includes('eraseInDisplay') ? 'ESC[3J'
          : stack.includes('.clear (') ? '清屏'
          : `输出新行? 栈=${frames.slice(0, 6).join('<')}`;
        console.log(`[diag] ${new Date().toISOString()} ydisp变化 id=${diagId} ${diagDriftHead}→${y}（期间${diagDriftCount}次） 来源=${cause}` +
          ` 距上次resize=${Math.round(now - diagLastResizeAt)}ms ${diagState()}${big ? ` 栈=${frames.slice(0, 6).join('<')}` : ''}`);
        diagDriftHead = y;
        diagDriftYbase = nowBuf.ybase;
        diagDriftLines = nowBuf.lines.length;
        diagDriftCount = 0;
        diagDriftLoggedAt = now;
      } catch {
        // 诊断失败不得影响滚动
      }
    });

    // 每帧抽查：不经滚动条/输出引起的 ydisp 变化（切备用屏幕、resize/reflow、清屏），连同行列数变化一起记
    let diagFrame = 0;
    const diagSample = (): void => {
      diagFrame = requestAnimationFrame(diagSample); // 先续订，探针异常也不会停掉后续抽查
      try {
        if (!diagCore) return;
        const buf = diagCore.buffer;
        if (buf.ydisp !== diagLastYdisp) {
          console.log(`[diag] ${new Date().toISOString()} ydisp变化(非滚动条来源) id=${diagId} ${diagLastYdisp}→${buf.ydisp} ${diagState()}` +
            ` 尺寸=${diagLastCols}x${diagLastRows}→${terminal.cols}x${terminal.rows} 行数=${diagLastLines}→${buf.lines.length}`);
          diagLastYdisp = buf.ydisp;
        }
        diagLastRows = terminal.rows;
        diagLastCols = terminal.cols;
        diagLastLines = buf.lines.length;
      } catch {
        // 诊断失败不得影响渲染
      }
    };
    diagFrame = requestAnimationFrame(diagSample);

    // resize 打点：与 ESC[3J 对时（diagLastCols/Rows 由逐帧抽查维护，此处读到的就是变化前的值）
    const diagResizeSub = terminal.onResize(({ cols, rows }) => {
      try {
        if (!diagCore) return;
        console.log(`[diag] ${new Date().toISOString()} resize id=${diagId} ${diagLastCols}x${diagLastRows}→${cols}x${rows} ${diagState()}`);
        diagLastCols = cols;
        diagLastRows = rows;
        diagLastResizeAt = performance.now();
      } catch {
        // 诊断失败不得影响功能
      }
    });

    // 清理
    return () => {
      terminal.textarea?.removeEventListener('focus', handleFocus);
      terminal.textarea?.removeEventListener('focus', handleTextareaFocusCapture);
      containerRef.current?.removeEventListener('click', handleContainerClick);
      terminal.element?.removeEventListener('contextmenu', handleContextMenu);
      terminal.textarea?.removeEventListener('keydown', handleKeydown);
      diagViewport?.removeEventListener('scroll', diagScrollCapture, { capture: true });
      diagViewport?.removeEventListener('scroll', diagScrollBubble);
      diagScrollSub.dispose();
      diagResizeSub.dispose();
      cancelAnimationFrame(diagFrame);
      resumeFollow.dispose();
      undoScrollGuard();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [containerReady]);

  // 处理主题和防窥模式变化
  useEffect(() => {
    if (!terminalRef.current) return;
    const activeTheme = privacyMode ? 'privacy' : theme;
    terminalRef.current.options.theme = themes[activeTheme];
    terminalRef.current.options.fontSize = privacyMode ? 13 : 14;
  }, [theme, privacyMode]);

  // 防窥模式切换后重新 fit
  useEffect(() => {
    if (!isReady || !fitAddonRef.current || !terminalRef.current || !containerRef.current) return;
    const timer = setTimeout(() => {
      if (!fitAddonRef.current || !terminalRef.current || !containerRef.current) return;
      try {
        fitAddonRef.current.fit();
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims && dims.cols && dims.rows) {
          const adjustedCols = Math.max(1, dims.cols - 1);
          terminalRef.current.resize(adjustedCols, dims.rows);
          window.electronAPI.terminalResize(terminalId, adjustedCols, dims.rows);
        }
      } catch {
        // 忽略 fit 错误
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [privacyMode, isReady, terminalId]);

  // 当终端变为活动状态时，延迟触发 fit
  useEffect(() => {
    // [diag] 标签切换打点（现有日志里看不出切页，问题定位后移除）
    console.log(`[diag] ${new Date().toISOString()} 标签切换 id=${terminalId.slice(0, 8)} active=${isActive ? 1 : 0}`);
    if (isActive && isReady && fitAddonRef.current && terminalRef.current) {
      // 50ms 延迟确保 CSS display:flex 已生效
      const timer = setTimeout(() => {
        if (fitAddonRef.current && terminalRef.current && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            try {
              fitAddonRef.current.fit();
              const dims = fitAddonRef.current.proposeDimensions();
              if (dims && dims.cols && dims.rows) {
                // 减少 1 列，避免文字被右侧滚动条遮挡
                const adjustedCols = Math.max(1, dims.cols - 1);
                terminalRef.current.resize(adjustedCols, dims.rows);
                window.electronAPI.terminalResize(terminalId, adjustedCols, dims.rows);
              }
            } catch {
              // 忽略 fit 错误
            }
          }
        }
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [isActive, isReady, terminalId, privacyMode]);

  // 自适应终端尺寸 + 滚动管理
  useEffect(() => {
    if (!fitAddonRef.current || !terminalRef.current) return;

    let fitTimer: number | null = null;
    let lastWidth = 0;
    let lastHeight = 0;

    // 用户是否在底部（用于判断 fit 后是否需要滚到底部）
    const isUserAtBottom = (): boolean => {
      const viewport = terminalRef.current?.element?.querySelector('.xterm-viewport') as HTMLElement;
      if (!viewport) return true;
      return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 5;
    };

    // 执行 fit 并同步尺寸到 PTY
    const doFit = () => {
      if (!fitAddonRef.current || !terminalRef.current || !containerRef.current) return;

      // 只在容器可见时执行
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const wasAtBottom = isUserAtBottom();

      // [diag] fit 回底判定：滚动区塌缩/备用屏幕下 isUserAtBottom() 恒为 true，会把视图甩到底部
      const diagBuf = (terminalRef.current as any)?._core?.buffer;
      const diagVp = terminalRef.current?.element?.querySelector('.xterm-viewport') as HTMLElement | null;
      if (diagBuf && diagVp) {
        console.log(`[diag] ${new Date().toISOString()} fit回底 id=${terminalId.slice(0, 8)} 判定在底部=${wasAtBottom ? 1 : 0} ydisp=${diagBuf.ydisp}/${diagBuf.ybase}` +
          ` scrollTop=${Math.round(diagVp.scrollTop)} 滚动区=${diagVp.scrollHeight}px/可视${diagVp.clientHeight}px`);
      }

      try {
        fitAddonRef.current.fit();
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims && dims.cols && dims.rows) {
          // 减少 1 列，避免文字被右侧滚动条遮挡
          const adjustedCols = Math.max(1, dims.cols - 1);
          terminalRef.current.resize(adjustedCols, dims.rows);
          window.electronAPI.terminalResize(terminalId, adjustedCols, dims.rows);
        }

        // 只在用户原本在底部时才滚到底部
        if (wasAtBottom) {
          requestAnimationFrame(() => {
            const viewport = terminalRef.current?.element?.querySelector('.xterm-viewport') as HTMLElement;
            if (viewport) {
              diagAppWrite.fit = performance.now(); // [diag] 标记：这次 scrollTop 变化来自 fit 回底
              viewport.scrollTop = viewport.scrollHeight;
            }
          });
        }
      } catch {
        // 忽略 fit 错误
      }
    };

    // 统一的延迟 fit 调度
    const scheduleFit = (delay: number) => {
      if (fitTimer !== null) {
        clearTimeout(fitTimer);
      }
      fitTimer = window.setTimeout(() => {
        fitTimer = null;
        doFit();
      }, delay);
    };

    // 初始 fit
    doFit();

    // 记录初始尺寸
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      lastWidth = rect.width;
      lastHeight = rect.height;
    }

    // 监听容器尺寸变化
    const observer = new ResizeObserver(() => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const widthChanged = Math.abs(rect.width - lastWidth) > 5;
      const heightChanged = Math.abs(rect.height - lastHeight) > 5;

      if (widthChanged || heightChanged) {
        lastWidth = rect.width;
        lastHeight = rect.height;
        scheduleFit(200);
      }
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
      const terminalContent = containerRef.current.closest('.terminal-content');
      if (terminalContent) {
        observer.observe(terminalContent);
      }
    }

    return () => {
      if (fitTimer !== null) {
        clearTimeout(fitTimer);
      }
      observer.disconnect();
    };
  }, [isReady, terminalId]);

  // 写入数据到终端
  useEffect(() => {
    if (!isReady) return;

    const unsubscribe = window.electronAPI.onTerminalData((id, data) => {
      if (id === terminalId && terminalRef.current) {
        // [diag] 三段心跳之一：pty 回显数据到达渲染进程
        (window as any).__diagLastData = performance.now();
        terminalRef.current.write(data);
      }
    });

    return unsubscribe;
  }, [isReady, terminalId]);

  // 聚焦终端 - 只在终端可见时聚焦
  useEffect(() => {
    const checkAndFocus = () => {
      if (!containerRef.current) return false;
      // 检查容器是否可见（通过CSS类或实际尺寸）
      const rect = containerRef.current.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0 &&
                       containerRef.current.closest('.terminal-wrapper.active');

      if (isVisible && terminalRef.current) {
        terminalRef.current.focus();
        return true;
      }
      return false;
    };

    // 延迟检查，确保DOM已更新
    const timer = setTimeout(() => {
      checkAndFocus();
    }, 10);

    return () => clearTimeout(timer);
  }, []); // 只在组件挂载时执行一次

  // 点击其他地方关闭右键菜单
  useEffect(() => {
    const handleClickOutside = () => setContextMenuPosition(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // 修复：Win+D/最小化还原后偶发 窗口不出帧/IME 失效
  // 窗口重新可见/获得焦点时：强制重绘全部行 + 重挂终端焦点（重新关联 IME）
  useEffect(() => {
    if (!isReady) return;

    const recover = () => {
      if (!isActiveRef.current) return; // 只处理当前激活的终端
      // 延迟执行，等窗口状态事件落定
      setTimeout(() => {
        const terminal = terminalRef.current;
        if (!terminal) return;
        try {
          // 强制重绘所有行（xterm DOM 渲染器可能丢失隐藏期间的渲染请求）
          terminal.refresh(0, terminal.rows - 1);
          // 重挂焦点：仅当焦点在终端 textarea 或 body 上时（不偷取重命名输入框的焦点）
          // Chromium 在窗口激活尚未完成时会静默丢弃 focus() 请求（实测：切窗回来后
          // 一次性 50ms focus 会永久失败，焦点停在 body，键盘输入全丢），
          // 因此轮询确认直到焦点真正落到 textarea，最多重试 10 次。
          const tryFocus = (attempt: number): void => {
            const active = document.activeElement;
            if (active === terminal.textarea) {
              terminal.focus(); // 已有焦点也重挂一次（重新关联 IME）
              if (attempt > 0) console.log(`[diag] ${new Date().toISOString()} 焦点已恢复（第 ${attempt} 次重试）`);
              return;
            }
            if (attempt > 10) {
              console.log(`[diag] ${new Date().toISOString()} 焦点恢复失败：activeElement=${active ? active.tagName : 'null'}`);
              return;
            }
            if (active === document.body || active === null) {
              terminal.focus();
              setTimeout(() => tryFocus(attempt + 1), 100);
            }
          };
          tryFocus(0);
        } catch {
          // 忽略
        }
      }, 50);
    };

    const handleWinFocus = () => recover();
    const handleVisChange = () => {
      if (!document.hidden) recover();
    };

    window.addEventListener('focus', handleWinFocus);
    document.addEventListener('visibilitychange', handleVisChange);
    return () => {
      window.removeEventListener('focus', handleWinFocus);
      document.removeEventListener('visibilitychange', handleVisChange);
    };
  }, [isReady]);

  // 复制功能
  const handleCopy = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const selection = terminal.getSelection();
    if (selection) {
      navigator.clipboard.writeText(selection);
    }
    setContextMenuPosition(null);
  }, []);

  // 粘贴功能
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

  // 清屏功能
  const handleClear = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.clear();
    setContextMenuPosition(null);
  }, []);

  // 全选功能
  const handleSelectAll = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.selectAll();
    setContextMenuPosition(null);
  }, []);

  return (
    <>
      <div ref={containerRef} className="xterm-container" />
      {/* 右键菜单 */}
      {contextMenuPosition && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{
            position: 'fixed',
            left: contextMenuPosition.x,
            top: contextMenuPosition.y,
            zIndex: 1000,
          }}
        >
          <div className="context-menu-item" onClick={handleCopy}>
            <span className="context-menu-icon">📋</span>
            复制
            <span className="context-menu-shortcut">Ctrl+C</span>
          </div>
          <div className="context-menu-item" onClick={handlePaste}>
            <span className="context-menu-icon">📝</span>
            粘贴
            <span className="context-menu-shortcut">Ctrl+V</span>
          </div>
          <div className="context-menu-divider" />
          <div className="context-menu-item" onClick={handleSelectAll}>
            <span className="context-menu-icon">⬚</span>
            全选
            <span className="context-menu-shortcut">Ctrl+Shift+A</span>
          </div>
          <div className="context-menu-item" onClick={handleClear}>
            <span className="context-menu-icon">🗑️</span>
            清屏
            <span className="context-menu-shortcut">Ctrl+L</span>
          </div>
        </div>
      )}
    </>
  );
});
