import { v4 as uuidv4 } from 'uuid';
import { NotificationType } from '../../renderer/types/terminal';

/**
 * 终端会话信息
 */
export interface TerminalSession {
  id: string;
  title: string;
  createdAt: Date;
  pinned: boolean;
}

/**
 * 会话管理器 - 管理终端会话的生命周期
 */
export class SessionManager {
  private sessions: Map<string, TerminalSession> = new Map();
  private activeSessionId: string | null = null;
  private notifications: Map<string, NotificationType> = new Map();
  private notificationTimestamps: Map<string, number> = new Map();

  /**
   * 创建新会话
   * @param title 会话标题
   * @returns 新会话信息
   */
  create(title?: string): TerminalSession {
    const id = uuidv4();
    const session: TerminalSession = {
      id,
      title: title || `Terminal ${this.sessions.size + 1}`,
      createdAt: new Date(),
      pinned: false,
    };

    this.sessions.set(id, session);

    // 如果是第一个会话，自动设为活动会话
    if (this.sessions.size === 1) {
      this.activeSessionId = id;
    }

    return session;
  }

  /**
   * 删除会话
   * @param id 会话 ID
   */
  delete(id: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }

    this.sessions.delete(id);
    // 同时清除该会话的通知状态和时间戳
    this.notifications.delete(id);
    this.notificationTimestamps.delete(id);

    // 如果删除的是活动会话，切换到其他会话
    if (this.activeSessionId === id) {
      const remainingIds = Array.from(this.sessions.keys());
      this.activeSessionId = remainingIds.length > 0 ? remainingIds[0] : null;
    }
  }

  /**
   * 获取指定会话
   * @param id 会话 ID
   */
  get(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * 获取所有会话（置顶优先排序）
   */
  getAll(): TerminalSession[] {
    return Array.from(this.sessions.values()).sort((a, b) => {
      // 置顶的排在前面
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      // 都置顶或都不置顶时，按创建时间排序
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  /**
   * 切换置顶状态
   * @param id 会话 ID
   * @returns 返回新的置顶状态
   */
  togglePinned(id: string): boolean {
    const session = this.sessions.get(id);
    if (session) {
      session.pinned = !session.pinned;
      return session.pinned;
    }
    return false;
  }

  /**
   * 更新会话标题
   * @param id 会话 ID
   * @param title 新标题
   */
  updateTitle(id: string, title: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.title = title;
    }
  }

  /**
   * 设置活动会话
   * @param id 会话 ID
   */
  setActive(id: string): void {
    if (this.sessions.has(id)) {
      this.activeSessionId = id;
    }
  }

  /**
   * 获取活动会话
   */
  getActive(): TerminalSession | undefined {
    return this.activeSessionId
      ? this.sessions.get(this.activeSessionId)
      : undefined;
  }

  /**
   * 获取活动会话 ID
   */
  getActiveId(): string | null {
    return this.activeSessionId;
  }

  /**
   * 设置终端通知状态
   * @param id 会话 ID
   * @param type 通知类型
   * @returns 如果通知状态发生变化返回 true，否则返回 false
   */
  setNotification(id: string, type: NotificationType): boolean {
    const current = this.notifications.get(id);
    if (current === type) {
      return false; // 通知类型未变化，不需要更新
    }
    this.notifications.set(id, type);
    // 记录通知创建时间
    this.notificationTimestamps.set(id, Date.now());
    return true; // 通知类型已变化
  }

  /**
   * 清除终端通知状态
   * @param id 会话 ID
   */
  clearNotification(id: string): void {
    this.notifications.delete(id);
    this.notificationTimestamps.delete(id);
  }

  /**
   * 获取所有通知状态
   */
  getAllNotifications(): Array<{ id: string; type: NotificationType }> {
    return Array.from(this.notifications.entries()).map(([id, type]) => ({ id, type }));
  }

  /**
   * 获取指定会话的通知类型
   * @param id 会话 ID
   */
  getNotification(id: string): NotificationType | undefined {
    return this.notifications.get(id);
  }

  /**
   * 获取指定时间之后的通知数量
   * @param afterTime 时间戳（毫秒）
   * @returns 该时间之后创建的通知数量
   */
  getNewNotificationCount(afterTime: number): number {
    let count = 0;
    for (const timestamp of this.notificationTimestamps.values()) {
      if (timestamp > afterTime) {
        count++;
      }
    }
    return count;
  }

  /**
   * 清除所有通知的时间戳
   * 当窗口获得焦点时调用，将现有通知标记为"已查看"
   */
  markAllNotificationsAsViewed(): void {
    this.notificationTimestamps.clear();
  }

  /**
   * 清空所有会话
   */
  clear(): void {
    this.sessions.clear();
    this.activeSessionId = null;
    this.notifications.clear();
    this.notificationTimestamps.clear();
  }
}

// 单例导出
export const sessionManager = new SessionManager();
