import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_INVENTARIOS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { FilaReorden, ParamsReorden } from '@/lib/inventarios/reorden';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inventarios/reorden?modelo=darnel — A4.27.
 *
 * Sirve los INSUMOS del modelo de punto de reorden. El cálculo NO ocurre acá:
 * corre en el cliente con `lib/inventarios/reorden.ts`, que es el mismo módulo
 * que las pruebas de paridad contrastan contra el libro. Un segundo cálculo del
 * lado del servidor sería una segunda implementación de la misma fórmula, y
 * este proyecto ya pagó una vez por eso (el bug de UoM del 20-ago publicó una
 * página que no coincidía consigo misma).
 *
 * El tránsito CONFIRMADO viene desglosado por embarque —una fila por fecha—
 * porque además de sumar hay que poder contestar «¿cuándo entra?». El motor
 * recibe el total; la pantalla puede abrir el detalle.
 */

interface ModeloDb {
  slug: string; nombre: string; provisional: boolean; notas: string | null;
  semanas_seguridad: number | null; semanas_lead_time: number | null;
  semanas_reorden: number | null; semanas_inv_maximo: number | null;
  meses_promedio: number | null; capacidad_contenedor_m3: number | null;
  moneda: string | null;
}

interface InvDb {
  codigo: string; cod_proveedor: string | null; descripcion: string | null;
  um: string | null; und_fardo: number | null; cub_millar: number | null;
  sj: number; z11: number; zacapa: number; peten: number; patios_sj: number;
  pend_surtir_sj: number; pend_surtir_peten: number; pend_surtir_zacapa: number;
  transito_pendiente: number; venta_proy_mensual: number | null;
  precio_ml: number | null; estado_producto: FilaReorden['estadoProducto'];
}

interface TransitoDb {
  codigo: string; fecha: string | null; cantidad_ml: number; referencia: string | null;
}

export async function GET(request: Request) {
  const auth = await requireAuth(CAN_VIEW_INVENTARIOS);
  if (auth instanceof Response) return auth;

  const modelo = (new URL(request.url).searchParams.get('modelo') ?? '').trim();
  if (!modelo) {
    return NextResponse.json({ error: 'Falta el parámetro `modelo`' }, { status: 400 });
  }

  const db = createServiceRoleClient();

  const { data: cfgRaw, error: errCfg } = await db
    .from('modelo_proveedor')
    .select('slug, nombre, provisional, notas, semanas_seguridad, semanas_lead_time, '
      + 'semanas_reorden, semanas_inv_maximo, meses_promedio, '
      + 'capacidad_contenedor_m3, moneda')
    .eq('slug', modelo).eq('motor', 'reorden').maybeSingle();
  if (errCfg) {
    return NextResponse.json(
      { error: 'No se pudo leer el modelo', detail: errCfg.message }, { status: 500 });
  }
  const cfg = cfgRaw as ModeloDb | null;
  if (!cfg) {
    return NextResponse.json(
      { error: `No existe un modelo de reorden llamado «${modelo}»` }, { status: 404 });
  }

  const [{ data: invRaw, error: errInv }, { data: trRaw }] = await Promise.all([
    db.from('reorden_inventario')
      .select('codigo, cod_proveedor, descripcion, um, und_fardo, cub_millar, '
        + 'sj, z11, zacapa, peten, patios_sj, pend_surtir_sj, pend_surtir_peten, '
        + 'pend_surtir_zacapa, transito_pendiente, venta_proy_mensual, precio_ml, '
        + 'estado_producto')
      .eq('modelo', modelo).order('codigo'),
    db.from('reorden_transito')
      .select('codigo, fecha, cantidad_ml, referencia')
      .eq('modelo', modelo).order('fecha', { ascending: true }),
  ]);
  if (errInv) {
    return NextResponse.json(
      { error: 'No se pudo leer el inventario', detail: errInv.message }, { status: 500 });
  }

  const inv = (invRaw ?? []) as unknown as InvDb[];
  const transito = (trRaw ?? []) as unknown as TransitoDb[];

  // El motor necesita el TOTAL de tránsito confirmado; la pantalla necesita el
  // desglose. Se manda lo uno y lo otro, y no se recalcula en dos lugares.
  const confirmadoPorCodigo = new Map<string, number>();
  const detallePorCodigo = new Map<string, TransitoDb[]>();
  for (const t of transito) {
    confirmadoPorCodigo.set(t.codigo, (confirmadoPorCodigo.get(t.codigo) ?? 0) + Number(t.cantidad_ml));
    const l = detallePorCodigo.get(t.codigo);
    if (l) l.push(t); else detallePorCodigo.set(t.codigo, [t]);
  }

  const filas: FilaReorden[] = inv.map((r) => ({
    codigo: r.codigo,
    descripcion: r.descripcion,
    undFardo: r.und_fardo === null ? null : Number(r.und_fardo),
    cubMillar: r.cub_millar === null ? null : Number(r.cub_millar),
    sj: Number(r.sj), z11: Number(r.z11), zacapa: Number(r.zacapa),
    peten: Number(r.peten), patiosSj: Number(r.patios_sj),
    pendSurtirSj: Number(r.pend_surtir_sj),
    pendSurtirPeten: Number(r.pend_surtir_peten),
    pendSurtirZacapa: Number(r.pend_surtir_zacapa),
    transitoConfirmado: confirmadoPorCodigo.get(r.codigo) ?? 0,
    transitoPendiente: Number(r.transito_pendiente),
    ventaProyMensual: r.venta_proy_mensual === null ? null : Number(r.venta_proy_mensual),
    precioMl: r.precio_ml === null ? null : Number(r.precio_ml),
    estadoProducto: r.estado_producto,
  }));

  const params: ParamsReorden = {
    semanasSeguridad: cfg.semanas_seguridad,
    semanasLeadTime: cfg.semanas_lead_time,
    semanasReorden: cfg.semanas_reorden,
    semanasInvMaximoBase: cfg.semanas_inv_maximo,
    capacidadContenedorM3: cfg.capacidad_contenedor_m3,
  };

  return NextResponse.json({
    modelo: {
      slug: cfg.slug, nombre: cfg.nombre, provisional: cfg.provisional,
      notas: cfg.notas, mesesPromedio: cfg.meses_promedio, moneda: cfg.moneda ?? 'USD',
    },
    params,
    filas,
    transitoDetalle: Object.fromEntries(
      [...detallePorCodigo].map(([cod, l]) => [cod, l.map((t) => ({
        fecha: t.fecha, cantidadMl: Number(t.cantidad_ml), referencia: t.referencia,
      }))]),
    ),
    extra: Object.fromEntries(inv.map((r) => [r.codigo, {
      codProveedor: r.cod_proveedor, um: r.um,
    }])),
  });
}
