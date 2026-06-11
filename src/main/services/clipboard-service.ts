import { clipboard, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

type PasteResult =
  | { type: 'image'; path: string }
  | { type: 'text'; text: string }
  | null;

class ClipboardService {
  /**
   * 读取剪贴板内容，优先检测图片。
   * 1. 有图片像素数据 → 保存为临时 PNG，返回路径
   * 2. 有文件引用（从文件管理器复制）→ 如果是图片文件，直接返回原路径
   * 3. 有文本 → 返回文本
   * 4. 都为空 → 返回 null
   */
  readForPaste(): PasteResult {
    const image = clipboard.readImage();

    if (!image.isEmpty()) {
      const tempDir = app.getPath('temp');
      const filename = `codeminder-clipboard-${Date.now()}.png`;
      const filePath = path.join(tempDir, filename);

      try {
        fs.writeFileSync(filePath, image.toPNG());
        return { type: 'image', path: filePath };
      } catch (err) {
        console.error('[ClipboardService] Failed to save image:', err);
      }
    }

    // 检测文件引用（从文件管理器复制文件时）
    const filePath = this.readFilePathFromClipboard();
    if (filePath) {
      if (this.isImageFile(filePath)) {
        return { type: 'image', path: filePath };
      }
      // 非图片文件，返回文件路径作为文本
      return { type: 'text', text: filePath };
    }

    const text = clipboard.readText();
    if (text) {
      return { type: 'text', text };
    }

    return null;
  }

  /**
   * 从剪贴板提取文件路径。
   * 优先用 Electron API（text/uri-list），失败时回退到 PowerShell。
   */
  private readFilePathFromClipboard(): string | null {
    // 方式 1: Electron readBuffer
    try {
      const buffer = clipboard.readBuffer('text/uri-list');
      if (buffer.length > 0) {
        const uriList = buffer.toString('utf-8').trim();
        const uris = uriList.split(/\r?\n/).filter(line => line && !line.startsWith('#'));
        if (uris.length > 0 && uris[0].startsWith('file:///')) {
          const filePath = decodeURIComponent(uris[0].substring(8));
          if (fs.existsSync(filePath)) {
            return filePath;
          }
        }
      }
    } catch { /* ignore */ }

    // 方式 2: Windows PowerShell 后备方案
    if (process.platform === 'win32') {
      try {
        const result = execSync(
          'powershell -NoProfile -Command "Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }"',
          { encoding: 'utf-8', timeout: 3000 }
        ).trim();
        if (result) {
          // 多文件时取第一行
          const firstFile = result.split(/\r?\n/)[0].trim();
          if (firstFile && fs.existsSync(firstFile)) {
            return firstFile;
          }
        }
      } catch (err) {
        console.error('[ClipboardService] PowerShell clipboard read failed:', err);
      }
    }

    return null;
  }

  /**
   * 判断文件是否为图片格式
   */
  private isImageFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext);
  }
}

export const clipboardService = new ClipboardService();
