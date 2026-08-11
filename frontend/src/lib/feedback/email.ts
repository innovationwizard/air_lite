/**
 * Server-only: bug-report notification email via Resend.
 * Env: RESEND_API_KEY, BUG_REPORT_FROM (verified-domain sender),
 * BUG_REPORT_TO (comma-separated recipients).
 * Missing config is reported as 'not_configured' — the report is already
 * persisted in bug_reports by the time this runs, so nothing is lost.
 */
import { Resend } from 'resend';
import type { AuthUser } from '@/lib/auth/server';
import type { BugReportPayload } from './validate';

export type EmailOutcome =
  | { status: 'sent'; resendId: string }
  | { status: 'failed'; error: string }
  | { status: 'not_configured'; error: string };

const KIND_LABEL: Record<BugReportPayload['kind'], string> = {
  dato_incorrecto: 'Dato incorrecto',
  falta_algo: 'Hace falta algo',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:4px 0;">${escapeHtml(value)}</td></tr>`;
}

export function buildEmailHtml(report: BugReportPayload, user: AuthUser): string {
  const answers = report.kind === 'dato_incorrecto'
    ? row('¿Dónde? Fila y columna:', report.donde ?? '')
      + row('La app dice:', report.appDice ?? '')
      + row('La app debería decir:', report.appDeberiaDecir ?? '')
    : row('¿Qué es lo que hace falta?', report.queFalta ?? '');

  return `
<h2 style="font-family:sans-serif;">🐛 ${KIND_LABEL[report.kind]}</h2>
<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;">
  ${row('Usuario', `${user.displayName ?? ''} (${user.email}) — rol: ${user.role}`)}
  ${row('URL', report.url)}
  ${answers}
  ${row('Fecha (UTC)', report.meta.capturedAt)}
  ${row('Zona horaria', report.meta.tz)}
  ${row('Navegador', report.meta.userAgent)}
  ${row('Viewport / pantalla', `${report.meta.viewport} / ${report.meta.screen} @${report.meta.dpr}x`)}
  ${row('Captura', report.screenshot ? 'adjunta (captura.jpg)' : 'no disponible')}
</table>`;
}

export async function sendBugReportEmail(
  report: BugReportPayload,
  user: AuthUser,
): Promise<EmailOutcome> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.BUG_REPORT_FROM;
  const to = (process.env.BUG_REPORT_TO ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);

  if (!apiKey || !from || to.length === 0) {
    return {
      status: 'not_configured',
      error: 'Faltan RESEND_API_KEY / BUG_REPORT_FROM / BUG_REPORT_TO',
    };
  }

  const pathname = ((): string => {
    try {
      return new URL(report.url).pathname;
    } catch {
      return report.url.slice(0, 60);
    }
  })();

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: `[AIR3] ${KIND_LABEL[report.kind]} — ${pathname} — ${user.displayName ?? user.email}`,
      html: buildEmailHtml(report, user),
      attachments: report.screenshot
        ? [{ filename: 'captura.jpg', content: report.screenshot }]
        : undefined,
    });
    if (error) return { status: 'failed', error: error.message };
    if (!data?.id) return { status: 'failed', error: 'Resend no devolvió id' };
    return { status: 'sent', resendId: data.id };
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}
