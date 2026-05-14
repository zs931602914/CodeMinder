import { BrowserWindow } from 'electron';
import { sessionManager } from './session-manager';

/**
 * 窗口闪烁管理器
 * 负责管理任务栏图标闪烁功能
 */
export class WindowFlashManager {
  private mainWindow: BrowserWindow | null = null;
  private isFlashing: boolean = false;
  // 窗口最后失去焦点的时间
  private lastBlurTime: number = 0;

  /**
   * 初始化闪烁管理器
   * @param window 要管理的主窗口
   */
  initialize(window: BrowserWindow): void {
    this.mainWindow = window;
    this.setupWindowEventListeners();
  }

  /**
   * 设置窗口事件监听器
   */
  private setupWindowEventListeners(): void {
    if (!this.mainWindow) return;

    // 窗口获得焦点时停止闪烁并标记通知为已查看
    this.mainWindow.on('focus', () => {
      this.stopFlashing();
      // 将现有通知标记为已查看
      sessionManager.markAllNotificationsAsViewed();
    });

    // 窗口显示时停止闪烁
    this.mainWindow.on('show', () => {
      this.stopFlashing();
      // 将现有通知标记为已查看
      sessionManager.markAllNotificationsAsViewed();
    });

    // 窗口失去焦点时记录时间
    this.mainWindow.on('blur', () => {
      this.lastBlurTime = Date.now();
      this.updateFlashState();
    });

    // 窗口最小化时记录时间并检查闪烁
    this.mainWindow.on('minimize', () => {
      this.lastBlurTime = Date.now();
      this.updateFlashState();
    });
  }

  /**
   * 更新闪烁状态
   * 根据当前通知状态和窗口状态决定是否闪烁
   */
  updateFlashState(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    const shouldFlash = this.shouldFlash();

    if (shouldFlash && !this.isFlashing) {
      this.startFlashing();
    } else if (!shouldFlash && this.isFlashing) {
      this.stopFlashing();
    }
  }

  /**
   * 判断是否应该闪烁
   * 条件：有待处理通知 AND (窗口未聚焦 OR 窗口最小化)
   * 且通知是窗口失去焦点后产生的
   */
  private shouldFlash(): boolean {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return false;
    }

    // 只有在窗口失去焦点后创建的通知才算"新通知"
    const newNotificationCount = sessionManager.getNewNotificationCount(this.lastBlurTime);
    const hasNewNotifications = newNotificationCount > 0;
    const isWindowInBackground = !this.mainWindow.isFocused() || this.mainWindow.isMinimized();

    return hasNewNotifications && isWindowInBackground;
  }

  /**
   * 开始闪烁任务栏图标
   */
  private startFlashing(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed() || this.isFlashing) {
      return;
    }

    this.mainWindow.flashFrame(true);
    this.isFlashing = true;
    console.log('[WindowFlashManager] 开始闪烁任务栏图标');
  }

  /**
   * 停止闪烁任务栏图标
   */
  private stopFlashing(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.isFlashing) {
      return;
    }

    this.mainWindow.flashFrame(false);
    this.isFlashing = false;
    console.log('[WindowFlashManager] 停止闪烁任务栏图标');
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.stopFlashing();
    this.mainWindow = null;
  }
}

// 单例导出
export const windowFlashManager = new WindowFlashManager();
