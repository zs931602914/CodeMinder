/**
 * 通知类型
 */
export enum NotificationType {
  AUTH_REQUIRED = 'auth_required',  // 需要授权
  SESSION_ENDED = 'session_ended',  // 会话结束
  ERROR = 'error'                    // 错误
}

/**
 * 通知信息
 */
export interface Notification {
  id: string;  // 修改：使用 id 而不是 terminalId，与主进程保持一致
  type: NotificationType;
}

/**
 * 终端会话状态
 */
export interface TerminalSession {
  id: string;
  title: string;
  isActive: boolean;
  notification?: NotificationType;  // 新增：通知类型
}

/**
 * 终端主题配置
 */
export interface TerminalTheme {
  foreground: string;
  background: string;
  cursor: string;
  cursorAccent: string;
  selection: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/**
 * 预定义主题
 */
export const themes: Record<string, TerminalTheme> = {
  dark: {
    foreground: '#ffffff',
    background: '#1e1e1e',
    cursor: '#ffffff',
    cursorAccent: '#1e1e1e',
    selection: 'rgba(255, 255, 255, 0.3)',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#ffffff',
  },
  light: {
    foreground: '#000000',
    background: '#ffffff',
    cursor: '#000000',
    cursorAccent: '#ffffff',
    selection: 'rgba(0, 0, 0, 0.3)',
    black: '#000000',
    red: '#cd3131',
    green: '#00bc00',
    yellow: '#949800',
    blue: '#0451a5',
    magenta: '#bc05bc',
    cyan: '#0598bc',
    white: '#555555',
    brightBlack: '#666666',
    brightRed: '#cd3131',
    brightGreen: '#14ce14',
    brightYellow: '#b5ba00',
    brightBlue: '#0451a5',
    brightMagenta: '#bc05bc',
    brightCyan: '#0598bc',
    brightWhite: '#a5a5a5',
  },
  privacy: {
    foreground: '#8a8a8a',
    background: '#1a1a1a',
    cursor: '#8a8a8a',
    cursorAccent: '#1a1a1a',
    selection: 'rgba(138, 138, 138, 0.25)',
    black: '#1a1a1a',
    red: '#8b4444',
    green: '#4a7a5a',
    yellow: '#7a7a4a',
    blue: '#4a5a8b',
    magenta: '#7a4a7a',
    cyan: '#4a7a7a',
    white: '#7a7a7a',
    brightBlack: '#555555',
    brightRed: '#9a5555',
    brightGreen: '#5a8a6a',
    brightYellow: '#8a8a5a',
    brightBlue: '#5a6a9a',
    brightMagenta: '#8a5a8a',
    brightCyan: '#5a8a8a',
    brightWhite: '#8a8a8a',
  },
  solarized: {
    foreground: '#839496',
    background: '#002b36',
    cursor: '#839496',
    cursorAccent: '#002b36',
    selection: 'rgba(131, 148, 150, 0.3)',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#586e75',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
};
