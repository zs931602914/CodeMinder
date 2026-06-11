import { clipboard, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

type PasteResult =
  | { type: 'image'; path: string }
  | { type: 'text'; text: string }
  | null;

class ClipboardService {
  /**
   * 读取剪贴板内容，优先检测图片。
   * 有图片 → 保存为临时 PNG，返回文件路径。
   * 无图片 → 读取文本。
   * 都为空 → 返回 null。
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
        // 图片保存失败，回退到文本
      }
    }

    const text = clipboard.readText();
    if (text) {
      return { type: 'text', text };
    }

    return null;
  }
}

export const clipboardService = new ClipboardService();
