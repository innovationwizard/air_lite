/**
 * Browser-side capture helpers for the bug-report widget: viewport screenshot
 * via SnapDOM and zero-friction metadata. Capture failure must never block a
 * report — every path here resolves (screenshot resolves to null on failure).
 */
import { snapdom } from '@zumer/snapdom';
import { SCREENSHOT_B64_MAX, type BugReportMeta } from './validate';

const CAPTURE_TIMEOUT_MS = 5000;
/** Selector excluded from the capture so the pill/modal never cover the evidence. */
export const WIDGET_EXCLUDE_ATTR = 'data-bug-report-widget';

export function collectMetadata(): BugReportMeta {
  return {
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${window.screen.width}x${window.screen.height}`,
    dpr: window.devicePixelRatio,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    capturedAt: new Date().toISOString(),
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Capture the visible viewport as a base64 JPEG (no data: prefix).
 * Returns null on any failure, timeout, or oversized result.
 */
export async function captureScreenshot(): Promise<string | null> {
  try {
    const blob = await Promise.race([
      snapdom.toBlob(document.body, {
        type: 'jpeg',
        quality: 0.8,
        backgroundColor: '#ffffff',
        clip: 'viewport',
        width: Math.min(window.innerWidth, 1600),
        fast: true,
        exclude: [`[${WIDGET_EXCLUDE_ATTR}]`],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('captura excedió el tiempo límite')), CAPTURE_TIMEOUT_MS),
      ),
    ]);
    const base64 = await blobToBase64(blob);
    if (base64.length > SCREENSHOT_B64_MAX) return null;
    return base64;
  } catch (error) {
    console.warn('Captura de pantalla no disponible:', error);
    return null;
  }
}
