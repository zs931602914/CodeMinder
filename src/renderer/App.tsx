import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { XTermWrapper } from './components/XTermWrapper';
import { NotificationType, Notification } from './types/terminal';
import './styles/app.css';

interface TerminalSession {
  id: string;
  title: string;
  isActive: boolean;
  pinned?: boolean;
}

export const App: React.FC = () => {
  const [terminals, setTerminals] = useState<Map<string, TerminalSession>>(new Map());
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Map<string, NotificationType>>(new Map());
  const initializingRef = useRef(false);
  const activeTerminalIdRef = useRef<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);

  // 右键菜单状态
  const [contextMenuState, setContextMenuState] = useState<{
    visible: boolean;
    x: number;
    y: number;
    terminalId: string | null;
  }>({ visible: false, x: 0, y: 0, terminalId: null });

  // 内联编辑状态
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 记忆化数组计算，避免每次渲染都创建新数组
  const terminalList = useMemo(() => Array.from(terminals.values()), [terminals]);
  const terminalEntries = useMemo(() => Array.from(terminals.entries()), [terminals]);

  // 事件处理函数
  const handleCreateTerminal = useCallback(async () => {
    try {
      await window.electronAPI.createTerminal();
    } catch (error) {
      console.error('Failed to create terminal:', error);
    }
  }, []);

  const handleSwitchTerminal = useCallback((id: string) => {
    window.electronAPI.setActiveTerminal(id);
    window.electronAPI.clearNotification(id);
  }, []);

  const handleCloseTerminal = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await window.electronAPI.destroyTerminal(id);
    } catch (error) {
      console.error('Failed to destroy terminal:', error);
    }
  }, []);

  const handleTerminalData = useCallback((terminalId: string, data: string) => {
    window.electronAPI.terminalWrite(terminalId, data);
  }, []);

  // 为每个终端创建稳定的回调函数
  const terminalDataHandlers = useMemo(() => {
    const handlers = new Map<string, (data: string) => void>();
    for (const [id] of terminalEntries) {
      handlers.set(id, (data: string) => handleTerminalData(id, data));
    }
    return handlers;
  }, [terminalEntries, handleTerminalData]);

  // 右键菜单处理
  const handleContextMenu = useCallback((terminalId: string, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuState({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      terminalId,
    });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenuState(prev => ({ ...prev, visible: false, terminalId: null }));
  }, []);

  // 内联编辑处理
  const handleStartEdit = useCallback((terminalId: string, currentTitle: string) => {
    setEditingTerminalId(terminalId);
    setEditingTitle(currentTitle);
    setContextMenuState(prev => ({ ...prev, visible: false }));
  }, []);

  const handleEditSubmit = useCallback(async () => {
    if (!editingTerminalId || !editingTitle.trim()) return;
    try {
      await window.electronAPI.updateTerminalTitle(editingTerminalId, editingTitle.trim());
    } catch (error) {
      console.error('Failed to update title:', error);
    }
    setEditingTerminalId(null);
  }, [editingTerminalId, editingTitle]);

  const handleEditCancel = useCallback(() => {
    setEditingTerminalId(null);
  }, []);

  // 置顶处理
  const handleTogglePinned = useCallback(async (terminalId: string) => {
    try {
      await window.electronAPI.toggleTerminalPinned(terminalId);
    } catch (error) {
      console.error('Failed to toggle pinned:', error);
    }
    handleCloseContextMenu();
  }, [handleCloseContextMenu]);

  // 复制 Hook 配置
  const handleCopyHookConfig = useCallback(async () => {
    try {
      await window.electronAPI.copyHookConfig();
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      console.error('Failed to copy hook config:', error);
    }
  }, []);

  // useEffect
  // 初始化：创建第一个终端
  useEffect(() => {
    if (initializingRef.current) return;
    initializingRef.current = true;

    const initApp = async () => {
      try {
        const result = await window.electronAPI.createTerminal();
        setTerminals(new Map([[result.id, { id: result.id, title: result.title, isActive: true }]]));
        setActiveTerminalId(result.id);
        activeTerminalIdRef.current = result.id;
      } catch (error) {
        console.error('Failed to create initial terminal:', error);
      }
    };

    initApp();
  }, []);

  // 监听通知更新（只注册一次，避免切换终端时竞态丢失通知）
  useEffect(() => {
    const unsubscribe = window.electronAPI.onNotificationUpdate((notificationList) => {
      const currentActiveId = activeTerminalIdRef.current;
      // 窗口有焦点 + 终端是 active → 用户正在看，视为已消费
      const isViewing = currentActiveId && document.hasFocus();
      const activeNotification = notificationList.find(n => n.id === currentActiveId);
      if (activeNotification && isViewing) {
        window.electronAPI.clearNotification(currentActiveId);
      }

      // 过滤掉已消费的通知
      const newNotifications = new Map(
        notificationList
          .filter(n => !(n.id === currentActiveId && isViewing))
          .map(n => [n.id, n.type])
      );
      setNotifications(newNotifications);
    });
    return unsubscribe;
  }, []);

  // 监听会话更新
  useEffect(() => {
    const unsubscribe = window.electronAPI.onSessionsUpdate((sessions, activeId) => {
      const newTerminals = new Map(
        sessions.map(s => [s.id, {
          id: s.id,
          title: s.title,
          isActive: s.id === activeId,
          pinned: s.pinned,
        }])
      );
      setTerminals(newTerminals);
      setActiveTerminalId(activeId);
      activeTerminalIdRef.current = activeId;
    });

    return unsubscribe;
  }, []);

  // 点击外部关闭右键菜单
  useEffect(() => {
    const handleClickOutside = () => setContextMenuState(prev => ({ ...prev, visible: false, terminalId: null }));
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // 编辑时自动聚焦输入框
  useEffect(() => {
    if (editingTerminalId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTerminalId]);

  // 编辑时按Enter确认，按Escape取消
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!editingTerminalId) return;
      if (e.key === 'Enter') {
        handleEditSubmit();
      } else if (e.key === 'Escape') {
        handleEditCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editingTerminalId, handleEditSubmit, handleEditCancel]);

  return (
    <div className="app">
      {/* 左侧面板 - Tab 管理 */}
      <div className="sidebar">
        {/* 终端列表 */}
        <div className="terminal-list">
          {terminalList.map((terminal) => {
            const notification = notifications.get(terminal.id);
            const notificationClass = notification === NotificationType.AUTH_REQUIRED ? 'notification-auth' :
                                    notification === NotificationType.SESSION_ENDED ? 'notification-ended' :
                                    notification === NotificationType.ERROR ? 'notification-error' : '';
            const icon = notification === NotificationType.AUTH_REQUIRED ? '⚠' :
                       notification === NotificationType.SESSION_ENDED ? '◉' :
                       notification === NotificationType.ERROR ? '✕' : '❯';

            return (
              <div
                key={terminal.id}
                className={`terminal-item ${terminal.isActive ? 'active' : ''} ${notificationClass} ${terminal.pinned ? 'pinned' : ''}`}
                onClick={() => handleSwitchTerminal(terminal.id)}
                onContextMenu={(e) => handleContextMenu(terminal.id, e)}
              >
                <span className="terminal-item-icon">
                  {icon}
                </span>
                {/* 内联编辑或显示标题 */}
                {editingTerminalId === terminal.id ? (
                  <input
                    ref={inputRef}
                    type="text"
                    className="terminal-title-input"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={handleEditSubmit}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="terminal-item-title">{terminal.title}</span>
                )}
                <button
                  className="terminal-item-close"
                  onClick={(e) => handleCloseTerminal(terminal.id, e)}
                  title="关闭终端"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        {/* 新建终端按钮 */}
        <button
          className="new-terminal-btn"
          onClick={handleCreateTerminal}
        >
          + 新建终端
        </button>

        {/* 防窥模式切换 */}
        <button
          className={`privacy-toggle-btn ${privacyMode ? 'active' : ''}`}
          onClick={() => setPrivacyMode(!privacyMode)}
          title={privacyMode ? '关闭防窥模式' : '开启防窥模式'}
        >
          {privacyMode ? '🛡 防窥中' : '👁 防窥'}
        </button>

        {/* 复制 Hook 配置按钮 */}
        <button
          className={`hook-config-btn ${copySuccess ? 'success' : ''}`}
          onClick={handleCopyHookConfig}
          title="复制 Hook 配置到剪贴板"
        >
          {copySuccess ? '✓ 已复制' : '📋 Hook 配置'}
        </button>

      </div>

      {/* 右侧终端内容区域 */}
      <div className="terminal-content">
        {terminals.size === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">+</div>
            <div className="empty-state-text">点击左侧按钮创建新终端</div>
          </div>
        ) : (
          terminalEntries.map(([id, { isActive }]) => (
            <div
              key={id}
              className={`terminal-wrapper ${isActive ? 'active' : ''}`}
            >
              <XTermWrapper
                terminalId={id}
                onData={terminalDataHandlers.get(id)}
                hasNotification={notifications.has(id)}
                isActive={isActive}
                privacyMode={privacyMode}
              />
            </div>
          ))
        )}
      </div>

      {/* 右键菜单 */}
      {contextMenuState.visible && (
        <div
          className="context-menu"
          style={{
            position: 'fixed',
            left: contextMenuState.x,
            top: contextMenuState.y,
            zIndex: 1000,
          }}
        >
          <div
            className="context-menu-item"
            onClick={() => handleStartEdit(contextMenuState.terminalId!, terminals.get(contextMenuState.terminalId!)?.title || '')}
          >
            <span className="context-menu-icon">✏️</span>
            重命名
          </div>
          <div
            className="context-menu-item"
            onClick={() => handleTogglePinned(contextMenuState.terminalId!)}
          >
            <span className="context-menu-icon">📌</span>
            置顶
          </div>
          <div className="context-menu-divider" />
          <div
            className="context-menu-item"
            onClick={(e) => {
              handleCloseTerminal(contextMenuState.terminalId!, e as any);
              handleCloseContextMenu();
            }}
          >
            <span className="context-menu-icon">✕</span>
            关闭
          </div>
        </div>
      )}
    </div>
  );
};
