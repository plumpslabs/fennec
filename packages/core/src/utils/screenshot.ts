import type { BrowserSession } from "../browser/types.js";

export interface ScreenshotOptions {
  fullPage?: boolean;
  selector?: string;
  format?: "png" | "jpeg";
}

export interface ScreenshotResult {
  base64: string;
  width: number;
  height: number;
  timestamp: string;
}

export async function takeScreenshot(
  session: BrowserSession,
  options: ScreenshotOptions = {},
): Promise<ScreenshotResult> {
  const format = options.format ?? "png";
  const fullPage = options.fullPage ?? false;

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
  });

  const viewport = session.viewportSize() ?? { width: 1280, height: 720 };

  return {
    base64: buffer.toString("base64"),
    width: clip?.width ?? viewport.width,
    height: clip?.height ?? viewport.height,
    timestamp: new Date().toISOString(),
  };
}
