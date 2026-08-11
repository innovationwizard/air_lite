/**
 * Bug-report payload validation, shared by the API route (authoritative) and
 * unit tests. The client does its own lightweight non-empty checks to gate the
 * ENVIAR button; this module is the server-side source of truth.
 */

export type BugReportKind = 'dato_incorrecto' | 'falta_algo';

export const SHORT_FIELD_MAX = 200;
export const LONG_FIELD_MAX = 5000;
export const URL_MAX = 2000;
/** Base64 chars ≈ bytes × 4/3; 3M chars ≈ 2.2MB binary, safely under Vercel's 4.5MB body cap. */
export const SCREENSHOT_B64_MAX = 3_000_000;

export interface BugReportMeta {
  userAgent: string;
  viewport: string;
  screen: string;
  dpr: number;
  tz: string;
  capturedAt: string;
}

export interface BugReportPayload {
  kind: BugReportKind;
  donde: string | null;
  appDice: string | null;
  appDeberiaDecir: string | null;
  queFalta: string | null;
  url: string;
  meta: BugReportMeta;
  screenshot: string | null;
}

export type ValidationResult =
  | { ok: true; value: BugReportPayload }
  | { ok: false; error: string };

function cleanShort(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > SHORT_FIELD_MAX) return null;
  return trimmed;
}

function cleanLong(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > LONG_FIELD_MAX) return null;
  return trimmed;
}

export function validateBugReport(input: unknown): ValidationResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Cuerpo del reporte inválido' };
  }
  const body = input as Record<string, unknown>;

  const kind = body.kind;
  if (kind !== 'dato_incorrecto' && kind !== 'falta_algo') {
    return { ok: false, error: 'Tipo de reporte inválido' };
  }

  if (typeof body.url !== 'string' || !body.url.trim() || body.url.length > URL_MAX) {
    return { ok: false, error: 'URL inválida' };
  }

  const rawMeta = (typeof body.meta === 'object' && body.meta !== null)
    ? (body.meta as Record<string, unknown>)
    : {};
  const meta: BugReportMeta = {
    userAgent: typeof rawMeta.userAgent === 'string' ? rawMeta.userAgent.slice(0, 500) : '',
    viewport: typeof rawMeta.viewport === 'string' ? rawMeta.viewport.slice(0, 50) : '',
    screen: typeof rawMeta.screen === 'string' ? rawMeta.screen.slice(0, 50) : '',
    dpr: typeof rawMeta.dpr === 'number' && Number.isFinite(rawMeta.dpr) ? rawMeta.dpr : 1,
    tz: typeof rawMeta.tz === 'string' ? rawMeta.tz.slice(0, 100) : '',
    capturedAt: typeof rawMeta.capturedAt === 'string' ? rawMeta.capturedAt.slice(0, 40) : '',
  };

  let screenshot: string | null = null;
  if (typeof body.screenshot === 'string' && body.screenshot.length > 0) {
    if (body.screenshot.length > SCREENSHOT_B64_MAX) {
      return { ok: false, error: 'Captura de pantalla demasiado grande' };
    }
    screenshot = body.screenshot;
  }

  if (kind === 'dato_incorrecto') {
    const donde = cleanShort(body.donde);
    const appDice = cleanShort(body.appDice);
    const appDeberiaDecir = cleanShort(body.appDeberiaDecir);
    if (!donde || !appDice || !appDeberiaDecir) {
      return { ok: false, error: 'Los tres campos son requeridos (máx. 200 caracteres)' };
    }
    return {
      ok: true,
      value: {
        kind, donde, appDice, appDeberiaDecir, queFalta: null,
        url: body.url.trim(), meta, screenshot,
      },
    };
  }

  const queFalta = cleanLong(body.queFalta);
  if (!queFalta) {
    return { ok: false, error: 'Describe qué es lo que hace falta (máx. 5000 caracteres)' };
  }
  return {
    ok: true,
    value: {
      kind, donde: null, appDice: null, appDeberiaDecir: null, queFalta,
      url: body.url.trim(), meta, screenshot,
    },
  };
}
