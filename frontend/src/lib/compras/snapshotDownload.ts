/**
 * Shared client-side download trigger for a frozen proof-of-status snapshot —
 * used by both the "Capturar" button (SnapshotButton.tsx, a fresh snapshot)
 * and the history page (historial/HistorialClient.tsx, a re-download of a
 * past one). Renders the PDF from whatever SnapshotPayload it's given —
 * never refetches or recomputes — so the file always matches the record the
 * caller already has in hand.
 */
import type { SnapshotPayload } from '@/lib/pdf/reabastecimientoStatusPdf';

/** Renders and triggers a browser download of the snapshot's PDF. Returns the filename used. */
export async function descargarSnapshotPdf(snapshot: SnapshotPayload): Promise<string> {
  const { renderReabastecimientoStatusPdf, reabastecimientoStatusFilename } =
    await import('@/lib/pdf/reabastecimientoStatusPdf');
  const blob = await renderReabastecimientoStatusPdf(snapshot);
  const filename = reabastecimientoStatusFilename(snapshot);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return filename;
}

/** Fetches one snapshot's full payload and downloads it. Throws with a message from the API on failure. */
export async function redescargarSnapshot(id: string): Promise<string> {
  const res = await fetch(`/api/compras/reabastecimiento/snapshot/${id}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const snapshot: SnapshotPayload = await res.json();
  return descargarSnapshotPdf(snapshot);
}
