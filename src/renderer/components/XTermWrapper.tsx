import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { themes, TerminalTheme } from '../types/terminal';
import '../styles/app.css';

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

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    setIsReady(true);

    // 使用 onData 事件处理正常输入（支持 IME/中文输入）
    terminal.onData((data) => {
      onDataRef.current?.(data);
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

    // 清理
    return () => {
      terminal.textarea?.removeEventListener('focus', handleFocus);
      terminal.textarea?.removeEventListener('focus', handleTextareaFocusCapture);
      containerRef.current?.removeEventListener('click', handleContainerClick);
      terminal.element?.removeEventListener('contextmenu', handleContextMenu);
      terminal.textarea?.removeEventListener('keydown', handleKeydown);
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
