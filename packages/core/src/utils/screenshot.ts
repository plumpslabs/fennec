import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BrowserSession } from '../browser/types.js';

export interface ScreenshotOptions {
  fullPage?: boolean;
  selector?: string;
  format?: 'png' | 'jpeg';
  /** JPEG quality (0-100), only used when format is "jpeg". Defaults to 50. */
  quality?: number;
  /** Return raw base64 (default) or write to a file and return the path. */
  output?: 'base64' | 'file_path';
  /** Directory to write the file when output is "file_path". Defaults to a temp dir. */
  outputDir?: string;
}

export interface ScreenshotResult {
  base64: string;
  width: number;
  height: number;
  timestamp: string;
  contentType: string;
  /** Absolute path to the written file, present only when output is "file_path". */
  filePath?: string;
}

export async function takeScreenshot(
  session: BrowserSession,
  options: ScreenshotOptions = {},
): Promise<ScreenshotResult> {
  const format = options.format ?? 'jpeg';
  const quality = format === 'jpeg' ? (options.quality ?? 50) : undefined;
  const fullPage = options.fullPage ?? false;
  const contentType = format === 'jpeg' ? 'image/jpeg' : 'image/png';

  let clip: { x: number; y: number; width: number; height: number } | undefined;

  if (options.selector) {
    const element = await session.$(options.selector);
    if (element) {
      const box = await element.boundingBox();
      if (box) {
        clip = {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        };
      }
    }
  }

  const buffer = await session.screenshot({
    fullPage,
    clip,
    type: format,
    quality,
  });

  const viewport = session.viewportSize() ?? { width: 1280, height: 720 };

  const result: ScreenshotResult = {
    base64: buffer.toString('base64'),
    width: clip?.width ?? viewport.width,
    height: clip?.height ?? viewport.height,
    timestamp: new Date().toISOString(),
    contentType,
  };

  if (options.output === 'file_path') {
    const dir = options.outputDir ?? path.join(os.tmpdir(), 'fennec-screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `screenshot-${Date.now()}.${format}`);
    fs.writeFileSync(file, buffer);
    result.filePath = file;
  }

  return result;
}
