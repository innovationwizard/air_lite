import {
  titular, brechaConfirmacion, esperandoQue, ordenarPlan, prontitud, enAlcance,
  type StatusItem, type PlanRow,
} from '../metricas';

/** Fila mínima; cada prueba sobreescribe sólo lo que le importa. */
function item(over: Partial<StatusItem> & { id: string }): StatusItem {
  return {
    cat: 'A1', orden_natural: 0, item: 'x', tipo: 'feature', flag: null,
    src: '01-ene L1-2', notes: null, estado: 'no_construido', estado_sugerido: true,
    evidencia: null, origen: 'contrato', bloqueo: 'jorge', espera_que: null,
    area: 'compras_local',
    temporada: 'na', esfuerzo: 'dias', rodeo: null, confirmable_con: null,
    criterio_aceptacion: null, orden_sugerido: null, ...over,
  };
}

describe('titular — regla 0/100', () => {
  const base = [
    item({ id: '1', estado: 'funcionando' }),
    item({ id: '2', estado: 'construido', confirmable_con: 'Wilmer', criterio_aceptacion: 'ok' }),
    item({ id: '3', estado: 'parcial' }),
    item({ id: '4', estado: 'no_construido' }),
  ];

  it('cuenta como terminado SOLO lo confirmado; lo construido no suma', () => {
    const t = titular(base, 'todo');
    expect(t.denominador).toBe(4);
    expect(t.pctTerminado).toBeCloseTo(0.25);
  });

  it('proyecta aparte qué pasaria si se confirma lo construido', () => {
    expect(titular(base, 'todo').pctSiSeConfirma).toBeCloseTo(0.5);
  });

  it('excluye del denominador lo que nunca fue entregable', () => {
    // Sin esto, contexto y exclusiones inventarian una brecha que no existe.
    const conRuido = [
      ...base,
      item({ id: '5', estado: 'no_software' }),
      item({ id: '6', estado: 'fuera_alcance' }),
    ];
    expect(titular(conRuido, 'todo').denominador).toBe(4);
  });

  it('el toggle de alcance cambia el denominador', () => {
    const conCreep = [...base, item({ id: '7', estado: 'no_construido', origen: 'anadido' })];
    expect(titular(conCreep, 'todo').denominador).toBe(5);
    expect(titular(conCreep, 'contratado').denominador).toBe(4);
  });

  it('el alcance contratado incluye las inclusiones verbales y excluye prerrequisitos', () => {
    expect(enAlcance(item({ id: 'a', origen: 'contrato' }), 'contratado')).toBe(true);
    expect(enAlcance(item({ id: 'b', origen: 'verbal' }), 'contratado')).toBe(true);
    expect(enAlcance(item({ id: 'c', origen: 'prerrequisito' }), 'contratado')).toBe(false);
    expect(enAlcance(item({ id: 'd', origen: 'anadido' }), 'contratado')).toBe(false);
  });

  it('no divide por cero cuando no hay filas', () => {
    const t = titular([], 'todo');
    expect(t.pctTerminado).toBe(0);
    expect(t.pctSiSeConfirma).toBe(0);
  });
});

describe('brechaConfirmacion', () => {
  const items = [
    item({ id: '1', estado: 'funcionando' }),
    item({ id: '2', estado: 'construido', confirmable_con: 'Wilmer', criterio_aceptacion: 'a' }),
    item({ id: '3', estado: 'construido', confirmable_con: 'Wilmer', criterio_aceptacion: 'b' }),
    item({ id: '4', estado: 'construido', confirmable_con: 'Alexis', criterio_aceptacion: 'c' }),
  ];

  it('agrupa por a quien hay que convocar, mayor grupo primero', () => {
    const g = brechaConfirmacion(items, 'todo');
    expect(g.map((x) => [x.persona, x.items.length])).toEqual([['Wilmer', 2], ['Alexis', 1]]);
  });

  it('proyecta el titular de confirmar SOLO ese grupo', () => {
    const g = brechaConfirmacion(items, 'todo');
    // 4 entregables, 1 funcionando. Confirmar los 2 de Wilmer => 3/4.
    expect(g[0].pctSiSeConfirmaEste).toBeCloseTo(0.75);
    expect(g[1].pctSiSeConfirmaEste).toBeCloseTo(0.5);
  });

  it('no pierde lo construido sin dueno asignado', () => {
    const g = brechaConfirmacion([item({ id: '9', estado: 'construido' })], 'todo');
    expect(g[0].persona).toBe('Sin asignar');
  });
});

describe('esperandoQue', () => {
  it('agrupa lo abierto por funcion, no por persona, y omite los grupos vacios', () => {
    const g = esperandoQue([
      item({ id: '1', estado: 'no_construido', bloqueo: 'jorge' }),
      item({ id: '2', estado: 'parcial', bloqueo: 'cliente' }),
      item({ id: '3', estado: 'funcionando', bloqueo: 'cliente' }),
    ], 'todo');
    expect(g.map((x) => [x.bloqueo, x.items.length])).toEqual([['jorge', 1], ['cliente', 1]]);
    expect(g[0].etiqueta).toBe('Nuestro');
  });

  it('solo considera lo no terminado', () => {
    const g = esperandoQue([item({ id: '1', estado: 'funcionando', bloqueo: 'jorge' })], 'todo');
    expect(g).toEqual([]);
  });
});

describe('ordenarPlan', () => {
  const items = [
    item({ id: 'a', estado: 'no_construido', orden_sugerido: 3 }),
    item({ id: 'b', estado: 'no_construido', orden_sugerido: 1 }),
    item({ id: 'c', estado: 'parcial', orden_sugerido: 2 }),
    item({ id: 'd', estado: 'funcionando', orden_sugerido: null }),
  ];
  const plan = (rows: PlanRow[]) => new Map(rows.map((r) => [r.item_id, r]));

  it('usa el orden calculado cuando el PM no ha tocado nada', () => {
    expect(ordenarPlan(items, plan([]), 'todo').map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('la prioridad manual del PM manda sobre la calculada', () => {
    const p = plan([{ item_id: 'a', prioridad: 1, fecha_objetivo: null, nota: null }]);
    expect(ordenarPlan(items, p, 'todo').map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('excluye lo ya terminado del plan', () => {
    expect(ordenarPlan(items, plan([]), 'todo').map((i) => i.id)).not.toContain('d');
  });
});

describe('prontitud', () => {
  it('sin criticos abiertos, verde', () => {
    const p = prontitud([item({ id: '1', cat: 'A4', estado: 'funcionando' })], 'compras_local');
    expect(p.luz).toBe('verde');
  });

  it('critico CON rodeo es ambar, y el rodeo queda nombrado', () => {
    const p = prontitud([
      item({ id: '1', cat: 'A4', estado: 'parcial', temporada: 'critico', rodeo: 'Se hace en Excel' }),
    ], 'compras_local');
    expect(p.luz).toBe('ambar');
    expect(p.rodeos).toEqual(['Se hace en Excel']);
  });

  it('critico SIN rodeo es rojo — un ambar sin rodeo escrito es un rojo disfrazado', () => {
    const p = prontitud([
      item({ id: '1', cat: 'A4', estado: 'no_construido', temporada: 'critico' }),
    ], 'compras_local');
    expect(p.luz).toBe('rojo');
  });

  it('un solo critico sin rodeo basta para rojo aunque los demas lo tengan', () => {
    const p = prontitud([
      item({ id: '1', cat: 'A4', estado: 'parcial', temporada: 'critico', rodeo: 'Excel' }),
      item({ id: '2', cat: 'A4', estado: 'no_construido', temporada: 'critico' }),
    ], 'compras_local');
    expect(p.luz).toBe('rojo');
  });

  it('agrupa por area de servicio, no por categoria del corpus', () => {
    // Los dos compradores comparten A1-A8, asi que la categoria no separa silos.
    const p = prontitud([
      item({ id: '1', cat: 'A4', area: 'gerencia', estado: 'no_construido', temporada: 'critico' }),
      item({ id: '2', cat: 'A4', area: 'compras_local', estado: 'no_construido', temporada: 'critico' }),
    ], 'gerencia');
    expect(p.criticosAbiertos).toHaveLength(1);
  });
});
