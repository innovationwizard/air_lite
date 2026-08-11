export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { autor } from '@/app/api/inventarios/reyma/lib';
import { validateBugReport } from '@/lib/feedback/validate';
import { sendBugReportEmail } from '@/lib/feedback/email';

/**
 * Bug-report intake (all authenticated roles; route_permissions rows in
 * migration 20260810000001). Persist-first: the report row is inserted before
 * the Resend call, so an email failure never loses the report — the delivery
 * outcome is recorded on the row instead.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const validation = validateBugReport(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const report = validation.value;

  const service = createServiceRoleClient();
  const { data: inserted, error: insertError } = await service
    .from('bug_reports')
    .insert({
      user_id: auth.id,
      autor: autor(auth),
      email: auth.email,
      role: auth.role,
      kind: report.kind,
      donde: report.donde,
      app_dice: report.appDice,
      app_deberia_decir: report.appDeberiaDecir,
      que_falta: report.queFalta,
      url: report.url,
      meta: report.meta,
      screenshot_b64: report.screenshot,
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    console.error('bug_reports insert falló:', insertError?.message);
    return NextResponse.json(
      { error: 'No se pudo guardar el reporte. Intenta de nuevo.' },
      { status: 500 },
    );
  }

  const outcome = await sendBugReportEmail(report, auth);
  if (outcome.status !== 'sent') {
    console.error(`Email de reporte ${inserted.id} no enviado (${outcome.status}): ${outcome.error}`);
  }
  const { error: updateError } = await service
    .from('bug_reports')
    .update({
      email_status: outcome.status,
      resend_id: outcome.status === 'sent' ? outcome.resendId : null,
      email_error: outcome.status === 'sent' ? null : outcome.error,
    })
    .eq('id', inserted.id);
  if (updateError) {
    console.error(`bug_reports ${inserted.id} email_status update falló:`, updateError.message);
  }

  // The report is durably stored either way; email is the notification channel.
  return NextResponse.json(
    { ok: true, id: inserted.id, emailed: outcome.status === 'sent' },
    { status: 201 },
  );
}
