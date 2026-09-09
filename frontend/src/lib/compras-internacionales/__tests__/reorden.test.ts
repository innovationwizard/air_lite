import {
  calcularModelo, SEMANAS_POR_MES, UMBRAL_CRITICO_SEM, UMBRAL_REORDENAR_SEM,
  type FilaReorden, type ParamsReorden,
} from '../reorden';

/**
 * El motor contra el libro real.
 *
 * Las cifras esperadas NO son inventadas ni recalculadas por mí: son los
 * valores EN CACHÉ del archivo del 2026-08-20, leídos con `data_only=True`.
 * Es la misma disciplina que le dio al modelo Reyma su paridad de 2,752
 * celdas — un motor que "parece correcto" y no reproduce el libro del que
 * salió no sirve, porque el comprador compara contra el suyo.
 */

/** Parámetros de Darnel, tal como los declara `PARAMETROS` del libro. */
const DARNEL: ParamsReorden = {
  semanasSeguridad: 3,
  semanasLeadTime: 7,
  semanasReorden: 9,
  semanasInvMaximoBase: 10,
  capacidadContenedorM3: 70,
};

function fila(over: Partial<FilaReorden> & { codigo: string }): FilaReorden {
  return {
    descripcion: null, undFardo: 200, cubMillar: 0.24055,
    sj: 0, z11: 0, zacapa: 0, peten: 0, patiosSj: 0,
    pendSurtirSj: 0, pendSurtirPeten: 0, pendSurtirZacapa: 0,
    transitoConfirmado: 0, transitoPendiente: 0,
    ventaProyMensual: null, precioMl: null, estadoProducto: 'ACTIVO',
    ...over,
  };
}

describe('conversión fardos → millares', () => {
  it('reproduce la fila 4 del libro: 13 fardos × 200 / 1000 = 2.6 ML', () => {
    const r = calcularModelo([fila({ codigo: '77206204', sj: 13, undFardo: 200 })], DARNEL);
    expect(r.filas[0].invNetoFardos).toBe(13);
    expect(r.filas[0].invNetoMl).toBeCloseTo(2.6, 4);
  });

  it('sin unidades por fardo NO calcula y lo dice', () => {
    // Suponer 1 arrastraría el error hasta el pedido sin que nadie lo note.
    const r = calcularModelo([fila({ codigo: 'X', sj: 100, undFardo: null })], DARNEL);
    expect(r.filas[0].estado).toBe('SIN CONVERSION');
    expect(r.filas[0].invNetoMl).toBeNull();
    expect(r.filas[0].pedirMl).toBe(0);
    expect(r.totales.sinConversion).toBe(1);
  });
});

describe('inventario neto — bodegas + patios − pendientes por surtir', () => {
  it('suma las cinco ubicaciones y resta los tres pendientes', () => {
    const r = calcularModelo([fila({
      codigo: 'X', sj: 100, z11: 50, zacapa: 30, peten: 20, patiosSj: 10,
      pendSurtirSj: 15, pendSurtirPeten: 5, pendSurtirZacapa: 10,
    })], DARNEL);
    expect(r.filas[0].invNetoFardos).toBe(180); // 210 − 30
  });

  it('los pendientes por surtir pueden dejar el neto en negativo', () => {
    // Está comprometido más de lo que hay. Es un hecho, no un error.
    const r = calcularModelo([fila({ codigo: 'X', sj: 10, pendSurtirSj: 25 })], DARNEL);
    expect(r.filas[0].invNetoFardos).toBe(-15);
  });
});

describe('inventario total y cobertura — fila 6 del libro', () => {
  // 1806.026 fardos × 480/1000 = 866.892 ML · +384 tránsito = 1250.892
  // venta 960 ML/mes ÷ 4.2857 = 224.001 ML/sem · cobertura 5.584 sem
  const r = calcularModelo([fila({
    codigo: '77206035', undFardo: 480, cubMillar: 0.025,
    sj: 1806.026, transitoConfirmado: 384, ventaProyMensual: 960,
  })], DARNEL);

  it('inventario neto en millares', () => {
    expect(r.filas[0].invNetoMl).toBeCloseTo(866.892, 2);
  });

  it('inventario total suma el tránsito confirmado', () => {
    expect(r.filas[0].invTotalMl).toBeCloseTo(1250.892, 2);
  });

  it('venta semanal = mensual ÷ 4.2857', () => {
    expect(r.filas[0].ventaSemanal).toBeCloseTo(224.001, 2);
  });

  it('cobertura total = inventario total ÷ venta semanal', () => {
    expect(r.filas[0].coberturaTotal).toBeCloseTo(5.584, 2);
  });

  it('la cobertura NETA ignora el tránsito — es la que está en bodega', () => {
    expect(r.filas[0].coberturaNeta).toBeCloseTo(866.892 / 224.001, 2);
  });
});

describe('niveles y pedido óptimo', () => {
  it('stock de seguridad = 3 semanas de venta', () => {
    const r = calcularModelo([fila({ codigo: 'X', ventaProyMensual: 1.904 })], DARNEL);
    expect(r.filas[0].stockSeguridadMl).toBeCloseTo(1.3328, 3); // fila 4 del libro
  });

  it('punto de reorden = 9 semanas, el valor que el libro USA', () => {
    // El libro lo rotula «SS + LT» = 3 + 7 = 10, y pone 9. Se respeta el 9.
    const r = calcularModelo([fila({ codigo: 'X', ventaProyMensual: 1.904 })], DARNEL);
    expect(r.filas[0].puntoReordenMl).toBeCloseTo(3.9984, 3); // fila 4 del libro
  });

  it('pedir óptimo = inventario máximo − inventario total', () => {
    // Fila 20: máximo 372.983, total 245.956 → pedir 127.027
    const r = calcularModelo([fila({
      codigo: '77206064', undFardo: 200, cubMillar: 0.294,
      sj: 1229.78, ventaProyMensual: 150,
    })], DARNEL);
    const f = r.filas[0];
    expect(f.invTotalMl).toBeCloseTo(245.956, 2);
    expect(f.pedirMl).toBeCloseTo(f.invMaximoMl! - f.invTotalMl!, 3);
  });

  it('si ya hay más que el máximo, no se pide: cero, nunca negativo', () => {
    const r = calcularModelo([fila({
      codigo: 'X', sj: 100000, ventaProyMensual: 10,
    })], DARNEL);
    expect(r.filas[0].pedirMl).toBe(0);
  });

  it('convierte el pedido de vuelta a fardos', () => {
    const r = calcularModelo([fila({
      codigo: 'X', undFardo: 500, sj: 0, ventaProyMensual: 100,
    })], DARNEL);
    const f = r.filas[0];
    expect(f.pedirFardos).toBe(Math.round((f.pedirMl * 1000) / 500));
  });

  it('valoriza el pedido sólo cuando hay precio', () => {
    const conPrecio = calcularModelo(
      [fila({ codigo: 'X', ventaProyMensual: 100, precioMl: 10 })], DARNEL);
    expect(conPrecio.filas[0].valorPedidoUsd).toBeCloseTo(
      conPrecio.filas[0].pedirMl * 10, 2);
    // Sin precio NO se valoriza en 0: cero diría «no vale nada».
    const sinPrecio = calcularModelo(
      [fila({ codigo: 'X', ventaProyMensual: 100 })], DARNEL);
    expect(sinPrecio.filas[0].valorPedidoUsd).toBeNull();
  });
});

describe('semanas por contenedor — es GLOBAL, no por producto', () => {
  it('depende del mix completo, por eso el cálculo va en dos pasadas', () => {
    const uno = calcularModelo([fila({
      codigo: 'A', cubMillar: 0.25, ventaProyMensual: 100 })], DARNEL);
    const dos = calcularModelo([
      fila({ codigo: 'A', cubMillar: 0.25, ventaProyMensual: 100 }),
      fila({ codigo: 'B', cubMillar: 0.25, ventaProyMensual: 100 }),
    ], DARNEL);
    // Al doblar el mix salen el doble de m³ por semana: el contenedor dura la mitad.
    expect(dos.semanasPorContenedorGlobal!).toBeCloseTo(
      uno.semanasPorContenedorGlobal! / 2, 4);
  });

  it('el inventario máximo suma la base y el término del contenedor', () => {
    const r = calcularModelo([fila({
      codigo: 'A', cubMillar: 0.25, ventaProyMensual: 100 })], DARNEL);
    expect(r.semanasInvMaximo).toBeCloseTo(10 + r.semanasPorContenedorGlobal!, 6);
  });

  it('sin venta en ningún producto no hay término de contenedor, y no se inventa', () => {
    const r = calcularModelo([fila({ codigo: 'A', ventaProyMensual: 0 })], DARNEL);
    expect(r.semanasPorContenedorGlobal).toBeNull();
    expect(r.semanasInvMaximo).toBe(10);
  });
});

describe('semáforo', () => {
  const conCobertura = (semanas: number) => calcularModelo([fila({
    codigo: 'X', undFardo: 1000, sj: semanas * 10, ventaProyMensual: 10 * SEMANAS_POR_MES,
  })], DARNEL).filas[0];

  it('crítico por debajo de 7 semanas', () => {
    expect(conCobertura(UMBRAL_CRITICO_SEM - 1).estado).toBe('CRITICO');
  });

  it('reordenar entre 7 y 10.7', () => {
    expect(conCobertura(UMBRAL_CRITICO_SEM + 0.5).estado).toBe('REORDENAR');
    expect(conCobertura(UMBRAL_REORDENAR_SEM - 0.1).estado).toBe('REORDENAR');
  });

  it('ok por encima del reorden y por debajo del exceso', () => {
    expect(conCobertura(UMBRAL_REORDENAR_SEM + 1).estado).toBe('OK');
  });

  it('exceso por encima del 150% del máximo', () => {
    expect(conCobertura(200).estado).toBe('EXCESO');
  });

  it('sin venta proyectada es SIN MOVIMIENTO, no crítico', () => {
    // Cobertura infinita, no cobertura cero. Confundirlos pondría en rojo
    // justamente lo que no hay que comprar.
    const r = calcularModelo([fila({ codigo: 'X', sj: 10, ventaProyMensual: 0 })], DARNEL);
    expect(r.filas[0].estado).toBe('SIN MOVIMIENTO');
    expect(r.filas[0].pedirMl).toBe(0);
  });

  it('LIQUIDACION gana sobre todo lo demás y nunca pide', () => {
    // En el libro esta regla esta ROTA por un #REF!: clasifica 0 productos
    // cuando 11 lo estan. Aca el dato viene de la hoja de precios.
    const r = calcularModelo([fila({
      codigo: 'X', sj: 0, ventaProyMensual: 500, estadoProducto: 'LIQUIDACION',
    })], DARNEL);
    expect(r.filas[0].estado).toBe('EN LIQUIDACION');
    expect(r.filas[0].pedirMl).toBe(0);   // aunque la cobertura sea cero
  });
});

describe('parámetros sin declarar', () => {
  const ASIA: ParamsReorden = {
    semanasSeguridad: null, semanasLeadTime: null, semanasReorden: null,
    semanasInvMaximoBase: null, capacidadContenedorM3: null,
  };

  it('los enumera en vez de heredar los de otro proveedor', () => {
    const r = calcularModelo([fila({ codigo: 'X', ventaProyMensual: 100 })], ASIA);
    expect(r.parametrosFaltantes).toEqual([
      'semanas de seguridad', 'lead time', 'punto de reorden',
      'inventario máximo', 'capacidad del contenedor',
    ]);
  });

  it('sin máximo no propone pedido: null, no cero disfrazado', () => {
    const r = calcularModelo([fila({ codigo: 'X', ventaProyMensual: 100 })], ASIA);
    expect(r.filas[0].invMaximoMl).toBeNull();
    expect(r.filas[0].pedirMl).toBe(0);
  });

  it('pero sí calcula lo que no depende de parámetros', () => {
    const r = calcularModelo([fila({
      codigo: 'X', sj: 100, undFardo: 200, ventaProyMensual: 100 })], ASIA);
    expect(r.filas[0].invNetoMl).toBeCloseTo(20, 4);
    expect(r.filas[0].coberturaTotal).toBeCloseTo(20 / (100 / SEMANAS_POR_MES), 3);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * PARIDAD CONTRA EL LIBRO — las 141 filas reales
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * El fixture son los INSUMOS y los RESULTADOS EN CACHÉ del archivo del
 * 2026-08-20, extraídos con el mismo mapeo por encabezado que usa la carga. No
 * es una muestra elegida a mano: es el libro entero.
 *
 * Es el mismo estándar con el que el modelo Reyma probó 2,752 de 2,752 celdas.
 * Un motor que no reproduce el libro del que salió no sirve por más elegante
 * que sea, porque el comprador compara contra el suyo y gana él.
 */
import fixture from './fixtures/darnel-20260820.json';

describe('paridad contra el libro del 20-ago — 141 productos', () => {
  const filas = fixture.filas as unknown as FilaReorden[];
  const esperado = fixture.esperado as {
    codigo: string; invNetoMl: number | null; invTotalMl: number | null;
    ventaSemanal: number | null; coberturaTotal: number | null;
    invMaximoMl: number | null; pedirMl: number | null; estadoLibro: string;
  }[];
  const r = calcularModelo(filas, DARNEL);
  const porCodigo = new Map(r.filas.map((f) => [f.codigo, f]));

  it('el fixture es el libro entero, no una muestra', () => {
    expect(filas).toHaveLength(141);
  });

  it('inventario neto en millares — las 141', () => {
    for (const e of esperado) {
      if (e.invNetoMl === null) continue;
      expect(porCodigo.get(e.codigo)!.invNetoMl!).toBeCloseTo(e.invNetoMl, 2);
    }
  });

  it('inventario total — las 141', () => {
    for (const e of esperado) {
      if (e.invTotalMl === null) continue;
      expect(porCodigo.get(e.codigo)!.invTotalMl!).toBeCloseTo(e.invTotalMl, 2);
    }
  });

  it('venta semanal — las 141', () => {
    for (const e of esperado) {
      if (e.ventaSemanal === null) continue;
      expect(porCodigo.get(e.codigo)!.ventaSemanal!).toBeCloseTo(e.ventaSemanal, 3);
    }
  });

  it('cobertura total — las 141', () => {
    for (const e of esperado) {
      if (e.coberturaTotal === null || e.coberturaTotal >= 9999) continue;
      expect(porCodigo.get(e.codigo)!.coberturaTotal!).toBeCloseTo(e.coberturaTotal, 2);
    }
  });

  it('inventario máximo — depende del término global del contenedor', () => {
    for (const e of esperado) {
      if (e.invMaximoMl === null) continue;
      expect(porCodigo.get(e.codigo)!.invMaximoMl!).toBeCloseTo(e.invMaximoMl, 1);
    }
  });

  it('pedido óptimo — las 141, salvo las que el libro no supo excluir', () => {
    // Las de LIQUIDACION se comparan aparte: el libro las pide (regla rota).
    for (const e of esperado) {
      if (e.pedirMl === null) continue;
      const f = porCodigo.get(e.codigo)!;
      if (f.estado === 'EN LIQUIDACION') continue;
      expect(f.pedirMl).toBeCloseTo(e.pedirMl, 1);
    }
  });

  it('el término global de contenedor reproduce el del libro (≈0.6566)', () => {
    expect(r.semanasPorContenedorGlobal!).toBeCloseTo(0.6566, 2);
    expect(r.semanasInvMaximo!).toBeCloseTo(10.6566, 2);
  });

  it('el semáforo coincide, EXCEPTO en las que el libro clasifica mal', () => {
    // El libro clasifica CERO productos como EN LIQUIDACION por su `#REF!`,
    // cuando la hoja de precios marca 11. Esas 11 SON la diferencia esperada,
    // y es una corrección, no una discrepancia.
    const distintos = esperado.filter(
      (e) => porCodigo.get(e.codigo)!.estado !== e.estadoLibro);
    expect(distintos.every(
      (e) => porCodigo.get(e.codigo)!.estado === 'EN LIQUIDACION')).toBe(true);
    expect(distintos).toHaveLength(11);
  });

  it('ningún producto en liquidación propone pedido', () => {
    const enLiq = r.filas.filter((f) => f.estado === 'EN LIQUIDACION');
    expect(enLiq).toHaveLength(11);
    expect(enLiq.every((f) => f.pedirMl === 0)).toBe(true);
  });
});
