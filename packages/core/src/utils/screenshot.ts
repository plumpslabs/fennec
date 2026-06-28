import type { Page, ElementHandle } from "playwright";

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
  page: Page,
  options: ScreenshotOptions = {},
): Promise<ScreenshotResult> {
  const format = options.format ?? "png";
  const fullPage = options.fullPage ?? false;

  let clip: { x: number; y: number; width: number; height: number } | undefined;

  if (options.selector) {
    const element = await page.$(options.selector);
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

  const buffer = await page.screenshot({
    fullPage,
    clip,
    type: format,
  });

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

  return {
    base64: buffer.toString("base64"),
    width: clip?.width ?? viewport.width,
    height: clip?.height ?? viewport.height,
    timestamp: new Date().toISOString(),
  };
}
