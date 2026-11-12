import { NextResponse } from 'next/server';
import { autor, badRequest, insertRow, withWriteAuth } from '../../reyma/lib';
import {
  capacidadContenedor,
  validarPayloadPlan,
} from '@/lib/compras-internacionales/reordenPlan';

export const dynamic = 'force-dynamic';

/**
 * POST /api/compras-internacionales/reorden/plan
 *
 * Guarda el plan de furgones que la pantalla de Darnel o Asia armó con
 * `packLines` a partir de las cantidades sugeridas. Append-only, un historial
 * por modelo. La fila vive en `reorden_plan_despacho`.
 *
 * No recalcula el pedido y no escribe en Odoo. El cuerpo trae el resultado
 * que el navegador ya mostró; acá se comprueba que el modelo sea de reorden
 * y que la capacidad coincida con `modelo_proveedor.capacidad_contenedor_m3`.
 */
export async function POST(request: Request) {
  const ctx = await withWriteAuth(request);
  if (ctx instanceof Response) return ctx;
  const { user, body, service, reads } = ctx;

  const modelo = body.modelo;
  if (typeof modelo !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(modelo)) {
    return badRequest('modelo inválido');
  }

  const payload = body.payload;
  if (JSON.stringify(payload ?? null).length > 200_000) {
    return badRequest('payload demasiado grande');
  }

  const { data: cfgRaw, error: errCfg } = await reads
    .from('modelo_proveedor')
    .select('slug, motor, capacidad_contenedor_m3')
    .eq('slug', modelo)
    .maybeSingle();
  if (errCfg) {
    return NextResponse.json(
      { error: 'No se pudo leer el modelo', detail: errCfg.message },
      { status: 500 },
    );
  }
  const cfg = cfgRaw as {
    slug: string;
    motor: string;
    capacidad_contenedor_m3: number | string | null;
  } | null;
  if (!cfg || cfg.motor !== 'reorden') {
    return badRequest('Este plan es sólo para un modelo de punto de reorden');
  }

  const cap = capacidadContenedor(cfg.capacidad_contenedor_m3);
  if (cap === null) {
    return badRequest('El modelo no tiene capacidad de contenedor');
  }
  const errorPayload = validarPayloadPlan(payload, cap);
  if (errorPayload) return badRequest(errorPayload);

  return insertRow(service, 'reorden_plan_despacho', {
    modelo,
    capacidad_m3: cap,
    payload,
    autor: autor(user),
  });
}
