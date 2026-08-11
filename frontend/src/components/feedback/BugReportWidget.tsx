'use client';

/**
 * Bug-report widget: fixed red pill (bottom-right) → native <dialog> with two
 * report types → POST /api/feedback (persist-first + Resend notification).
 * The viewport screenshot fires at pill-click time — before the modal covers
 * the data being reported — and its failure never blocks the report.
 * Spec: docs/feedback/BUG_REPORT_DESIGN.md.
 */

import { useCallback, useRef, useState } from 'react';
import { ArrowLeft, Bug, Camera, CameraOff, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { captureScreenshot, collectMetadata, WIDGET_EXCLUDE_ATTR } from '@/lib/feedback/capture';

type Step = 'choose' | 'dato_incorrecto' | 'falta_algo' | 'done';
type ScreenshotState = 'pending' | 'ok' | 'none';

const textareaClassName =
  'flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ' +
  'ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export function BugReportWidget() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const screenshotRef = useRef<Promise<string | null> | null>(null);

  const [step, setStep] = useState<Step>('choose');
  const [screenshotState, setScreenshotState] = useState<ScreenshotState>('pending');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [donde, setDonde] = useState('');
  const [appDice, setAppDice] = useState('');
  const [appDeberiaDecir, setAppDeberiaDecir] = useState('');
  const [queFalta, setQueFalta] = useState('');

  const openReport = useCallback(() => {
    setScreenshotState('pending');
    const capture = captureScreenshot();
    screenshotRef.current = capture;
    capture.then((shot) => setScreenshotState(shot ? 'ok' : 'none'));
    dialogRef.current?.showModal();
  }, []);

  const closeDialog = useCallback(() => dialogRef.current?.close(), []);

  const resetState = useCallback(() => {
    setStep('choose');
    setSending(false);
    setError(null);
    setDonde('');
    setAppDice('');
    setAppDeberiaDecir('');
    setQueFalta('');
    screenshotRef.current = null;
  }, []);

  const canSend =
    step === 'dato_incorrecto'
      ? Boolean(donde.trim() && appDice.trim() && appDeberiaDecir.trim())
      : step === 'falta_algo'
        ? Boolean(queFalta.trim())
        : false;

  const submit = useCallback(async () => {
    if (!canSend || sending) return;
    setSending(true);
    setError(null);
    try {
      const screenshot = (await screenshotRef.current) ?? null;
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: step,
          donde: step === 'dato_incorrecto' ? donde : undefined,
          appDice: step === 'dato_incorrecto' ? appDice : undefined,
          appDeberiaDecir: step === 'dato_incorrecto' ? appDeberiaDecir : undefined,
          queFalta: step === 'falta_algo' ? queFalta : undefined,
          url: window.location.href,
          meta: collectMetadata(),
          screenshot,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'No se pudo enviar el reporte. Intenta de nuevo.');
      }
      setStep('done');
      setTimeout(() => dialogRef.current?.close(), 2000);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'No se pudo enviar el reporte. Intenta de nuevo.',
      );
    } finally {
      setSending(false);
    }
  }, [canSend, sending, step, donde, appDice, appDeberiaDecir, queFalta]);

  return (
    <>
      <button
        type="button"
        onClick={openReport}
        aria-label="Reportar un problema"
        {...{ [WIDGET_EXCLUDE_ATTR]: 'true' }}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-red-600 px-4 py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
      >
        <Bug className="h-4 w-4" aria-hidden="true" />
        Reportar
      </button>

      <dialog
        ref={dialogRef}
        onClose={resetState}
        onClick={(event) => {
          if (event.target === dialogRef.current && !sending) closeDialog();
        }}
        aria-labelledby="bug-report-title"
        {...{ [WIDGET_EXCLUDE_ATTR]: 'true' }}
        className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-0 shadow-xl backdrop:bg-black/50"
      >
        <div className="p-6" onClick={(event) => event.stopPropagation()}>
          <div className="mb-4 flex items-start justify-between">
            <h2 id="bug-report-title" className="text-lg font-semibold text-gray-900">
              {step === 'choose' && 'Reportar un problema'}
              {step === 'dato_incorrecto' && 'Aquí hay un dato incorrecto'}
              {step === 'falta_algo' && 'Aquí hace falta algo'}
              {step === 'done' && 'Reporte enviado'}
            </h2>
            <button
              type="button"
              onClick={closeDialog}
              aria-label="Cerrar"
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {step === 'choose' && (
            <div className="flex flex-col gap-3">
              <Button variant="outline" className="h-auto justify-start py-3" autoFocus onClick={() => setStep('dato_incorrecto')}>
                Aquí hay un dato incorrecto
              </Button>
              <Button variant="outline" className="h-auto justify-start py-3" onClick={() => setStep('falta_algo')}>
                Aquí hace falta algo
              </Button>
            </div>
          )}

          {step === 'dato_incorrecto' && (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bug-donde">¿Dónde? Fila y columna:</Label>
                <Input id="bug-donde" value={donde} maxLength={200} autoFocus onChange={(event) => setDonde(event.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bug-dice">La app dice:</Label>
                <Input id="bug-dice" value={appDice} maxLength={200} onChange={(event) => setAppDice(event.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bug-deberia">La app debería decir:</Label>
                <Input id="bug-deberia" value={appDeberiaDecir} maxLength={200} onChange={(event) => setAppDeberiaDecir(event.target.value)} />
              </div>
            </form>
          )}

          {step === 'falta_algo' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bug-falta">¿Qué es lo que hace falta?</Label>
              <textarea
                id="bug-falta"
                value={queFalta}
                maxLength={5000}
                autoFocus
                onChange={(event) => setQueFalta(event.target.value)}
                className={textareaClassName}
              />
            </div>
          )}

          {step === 'done' && (
            <p className="py-4 text-sm text-gray-700">✓ Reporte enviado. ¡Gracias!</p>
          )}

          {(step === 'dato_incorrecto' || step === 'falta_algo') && (
            <div className="mt-5 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                {screenshotState === 'pending' && (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Capturando pantalla…
                  </>
                )}
                {screenshotState === 'ok' && (
                  <>
                    <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                    Captura de pantalla incluida
                  </>
                )}
                {screenshotState === 'none' && (
                  <>
                    <CameraOff className="h-3.5 w-3.5" aria-hidden="true" />
                    Captura no disponible — el reporte se envía igual
                  </>
                )}
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex items-center justify-between">
                <Button type="button" variant="ghost" size="sm" disabled={sending} onClick={() => { setError(null); setStep('choose'); }}>
                  <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                  Volver
                </Button>
                <Button
                  type="button"
                  disabled={!canSend || sending}
                  onClick={() => void submit()}
                  className={cn('bg-red-600 hover:bg-red-700', sending && 'cursor-wait')}
                >
                  {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  ENVIAR
                </Button>
              </div>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
