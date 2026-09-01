#!/usr/bin/env python3
"""
Sincroniza el gap analysis de `/status` desde los TSV versionados hacia Supabase.

QUÉ RESUELVE. El juicio de estado del proyecto tiene que poder editarse desde
una conversación con el asistente y quedar registrado en git — revisable en un
diff, atribuible a un commit, reversible. Si el juicio viviera sólo en la base,
el repositorio y la realidad divergirían en un día. Entonces:

    docs/gap-analysis-corpus-aug31/
      items.tsv       INMUTABLE. Los 185 hechos con su fuente. No se toca nunca:
                      el corpus se prohibió a sí mismo renumerar, fusionar,
                      reescribir citas y agregar filas sin fuente.
      juicio.tsv      El juicio. UNA fila por ítem cargable. Este es el archivo
                      que se edita cuando cambia un estado.

    scripts/sync_status.py   lee los dos, valida, y hace upsert en `status_items`.

`status_plan` NO SE TOCA. Es de la interfaz (rol project_manager: fechas y orden
de prioridad) y no tiene copia en el repositorio. Si el plan fueran columnas de
`status_items`, esta corrida las borraría en silencio. Ver la cabecera de
`supabase/migrations/20260901000001_status_gap_analysis.sql`.

DOS EXCLUSIONES, ENUMERADAS Y NO SILENCIOSAS. Una exclusión silenciosa es
indistinguible de un error de carga, así que las dos salen en el log:
  * E1-E7 — términos comerciales. No son ítems a construir y nunca lo fueron.
  * `visible_ui = false` — filas cuyo contenido es una valoración de desempeño
    de personas. Se cargan (informan el juicio) y no se renderizan.

Uso:
    python scripts/sync_status.py              # dry-run: valida e imprime el diff
    python scripts/sync_status.py --commit     # escribe

Sin `--commit` no escribe nada, igual que el resto de los scripts del repo.
Requiere SUPABASE_URL y SUPABASE_SECRET_KEY (se aceptan SUPABASE_SERVICE_ROLE_KEY
y SUPABASE_SERVICE_KEY como alias).
"""

import argparse
import csv
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CORPUS = REPO / 'docs' / 'gap-analysis-corpus-aug31'
ITEMS_TSV = CORPUS / 'items.tsv'
JUICIO_TSV = CORPUS / 'juicio.tsv'

# Filas del corpus que NO se cargan, con su motivo. Enumeradas a propósito:
# el QUALITY GATE compara contra esta lista, así que una fila que desaparezca
# por accidente falla la corrida en vez de pasar desapercibida.
EXCLUIDAS = {
    'E1': 'terminos comerciales', 'E2': 'terminos comerciales',
    'E3': 'terminos comerciales', 'E4': 'terminos comerciales',
    'E5': 'terminos comerciales', 'E6': 'terminos comerciales',
    'E7': 'terminos comerciales',
}

ESTADOS = {'funcionando', 'construido', 'parcial', 'no_construido',
           'fuera_alcance', 'algun_dia', 'no_software', 'sin_determinar'}
ORIGENES = {'contrato', 'verbal', 'prerrequisito', 'anadido', 'contexto'}
BLOQUEOS = {'jorge', 'cliente', 'tercero', 'nadie', 'na'}
TEMPORADAS = {'critico', 'mejora', 'puede_esperar', 'na'}
ESFUERZOS = {'horas', 'dias', 'semanas', 'no_estimable', 'na'}
AREAS = {'compras_local', 'compras_intl', 'gerencia', 'gerencia_proyecto', 'na'}

# Estados que cuentan como entregables: el denominador del porcentaje.
# `no_software`, `fuera_alcance` y `algun_dia` quedan fuera — nunca fueron cosas
# a construir, o se decidió que no se están haciendo, y meterlos al denominador
# inventaría una brecha que no existe. `algun_dia` no es un descarte: es fuera
# del alcance actual, con la condición que lo reviviría escrita en `evidencia`.
ENTREGABLES = {'funcionando', 'construido', 'parcial', 'no_construido', 'sin_determinar'}

# ── Prioridad ───────────────────────────────────────────────────────────────
# El orden POR DEFECTO del plan. Se calcula acá y no en la interfaz para que
# sea el mismo número en la página, en el xlsx y en cualquier consulta.
# La fórmula se muestra en un tooltip: un orden que no se puede auditar es un
# orden que nadie respeta.
PESO_TEMPORADA = {'critico': 100, 'mejora': 40, 'puede_esperar': 5, 'na': 0}
PESO_BLOQUEO = {'nadie': 30, 'jorge': 25, 'cliente': 10, 'tercero': 0, 'na': 0}
PESO_ESFUERZO = {'horas': 20, 'dias': 12, 'semanas': 3, 'no_estimable': 0, 'na': 0}
PESO_ESTADO = {'parcial': 15}  # terminar lo empezado antes que abrir frente nuevo


def score(row):
    return (PESO_TEMPORADA.get(row['temporada'], 0)
            + PESO_BLOQUEO.get(row['bloqueo'], 0)
            + PESO_ESFUERZO.get(row['esfuerzo'], 0)
            + PESO_ESTADO.get(row['estado'], 0))


def leer_tsv(path):
    with open(path, encoding='utf-8') as fh:
        return list(csv.DictReader(fh, delimiter='\t'))


def validar(items, juicio):
    """QUALITY GATE. Devuelve la lista de errores; vacía = pasa.

    Es el mismo control que el corpus se impuso a sí mismo, hecho ejecutable.
    Falla ruidosamente: si el juicio y los hechos se desalinean, es preferible
    no escribir nada a escribir una página que dice algo que nadie decidió.
    """
    errores = []
    ids_items = {r['id'] for r in items}
    ids_juicio = [r['id'] for r in juicio]
    set_juicio = set(ids_juicio)

    dupes = sorted({i for i in ids_juicio if ids_juicio.count(i) > 1})
    if dupes:
        errores.append(f'juicio.tsv tiene ids repetidos: {dupes}')

    faltan = sorted(ids_items - set_juicio - set(EXCLUIDAS))
    if faltan:
        errores.append(f'items sin juicio (y no excluidos): {faltan}')

    sobran = sorted(set_juicio - ids_items)
    if sobran:
        errores.append(f'juicio para ids que no existen en items.tsv: {sobran}')

    coladas = sorted(set_juicio & set(EXCLUIDAS))
    if coladas:
        errores.append(f'filas excluidas que aparecen en juicio.tsv: {coladas}')

    ausentes = sorted(set(EXCLUIDAS) - ids_items)
    if ausentes:
        errores.append(f'la lista de exclusiones nombra ids que no estan en items.tsv: {ausentes}')

    for r in juicio:
        i = r['id']
        for campo, validos in (('estado', ESTADOS), ('origen', ORIGENES),
                               ('bloqueo', BLOQUEOS), ('temporada', TEMPORADAS),
                               ('esfuerzo', ESFUERZOS), ('area', AREAS)):
            if r[campo] not in validos:
                errores.append(f'{i}: {campo}={r[campo]!r} no es un valor valido')
        if r['visible_ui'] not in ('true', 'false'):
            errores.append(f'{i}: visible_ui={r["visible_ui"]!r} debe ser true o false')

        # INVARIANTE DE HONESTIDAD. Un `construido` sin criterio de aceptación
        # redactable no está a una reunión de distancia: le falta trabajo, y su
        # estado sincero es `parcial`. Sin este control, el bloque «a una
        # reunión de confirmar» se infla solo y se vuelve un descargo.
        if r['estado'] == 'construido' and not r['criterio_aceptacion'].strip():
            errores.append(f'{i}: estado=construido sin criterio_aceptacion. '
                           'Si no se puede redactar, el estado sincero es "parcial".')
        if r['estado'] == 'construido' and not r['confirmable_con'].strip():
            errores.append(f'{i}: estado=construido sin confirmable_con (a quien hay que convocar).')

    for r in juicio:
        if (r['area'] == 'na' and r['temporada'] == 'critico'
                and r['estado'] in ('parcial', 'no_construido')):
            errores.append(f'{r["id"]}: critico y abierto pero sin area. '
                           'No apareceria en ningun semaforo de prontitud.')

    return errores


def resumen(filas):
    """El titular, calculado igual que en la página. Se imprime en cada corrida
    para que un cambio de juicio muestre su efecto en el número antes de commit.
    """
    def bloque(sub, etiqueta):
        d = [r for r in sub if r['estado'] in ENTREGABLES]
        if not d:
            return
        n = len(d)
        f = sum(1 for r in d if r['estado'] == 'funcionando')
        b = sum(1 for r in d if r['estado'] == 'construido')
        print(f'  {etiqueta:<46} n={n:<4} terminado {f/n:5.1%}   '
              f'+confirmando {b} => {(f + b)/n:5.1%}')

    print('\nTITULAR (regla 0/100: terminado = construido Y confirmado)')
    contratado = [r for r in filas if r['origen'] in ('contrato', 'verbal')]
    bloque(contratado, 'solo alcance contratado  [POR DEFECTO]')
    bloque(filas, 'todo lo pedido')
    bloque([r for r in filas if r['origen'] == 'anadido'], 'solo lo anadido despues')

    ocultas = [r for r in filas if r['visible_ui'] == 'false']
    print(f'\n  filas cargadas y NO renderizadas (visible_ui=false): {len(ocultas)} '
          f'-> {", ".join(r["id"] for r in ocultas)}')
    print(f'  filas del corpus NO cargadas: {len(EXCLUIDAS)} '
          f'-> {", ".join(sorted(EXCLUIDAS))} ({next(iter(EXCLUIDAS.values()))})')


def construir(items, juicio):
    por_id = {r['id']: r for r in juicio}
    orden = {r['id']: n for n, r in enumerate(items)}
    filas = []
    for it in items:
        j = por_id.get(it['id'])
        if j is None:
            continue  # excluida; ya validado arriba
        filas.append({
            'id': it['id'],
            'cat': it['cat'],
            'orden_natural': orden[it['id']],
            'item': it['item'],
            'tipo': it['type'],
            'flag': it['flag'] or None,
            'src': it['src'],
            # `ref` (la cita verbatim) NO viaja a la base: se queda en items.tsv,
            # para desarrollo. La auditabilidad la sostiene `src`.
            'notes': it['notes'] or None,
            'estado': j['estado'],
            'estado_sugerido': True,
            'evidencia': j['evidencia'] or None,
            'origen': j['origen'],
            'bloqueo': j['bloqueo'],
            'espera_que': j['espera_que'] or None,
            'area': j['area'],
            'temporada': j['temporada'],
            'esfuerzo': j['esfuerzo'],
            'rodeo': j['rodeo'] or None,
            'confirmable_con': j['confirmable_con'] or None,
            'criterio_aceptacion': j['criterio_aceptacion'] or None,
            'visible_ui': j['visible_ui'] == 'true',
        })

    # La prioridad se asigna sobre lo no terminado, en orden de score
    # descendente, con el orden natural como desempate estable.
    abiertas = [f for f in filas if f['estado'] in ('parcial', 'no_construido')]
    abiertas.sort(key=lambda f: (-score(f), f['orden_natural']))
    rank = {f['id']: n + 1 for n, f in enumerate(abiertas)}
    for f in filas:
        f['orden_sugerido'] = rank.get(f['id'])
    return filas


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--commit', action='store_true',
                    help='escribe en Supabase (sin esto, dry-run)')
    args = ap.parse_args()

    items = leer_tsv(ITEMS_TSV)
    juicio = leer_tsv(JUICIO_TSV)
    print(f'items.tsv  : {len(items)} filas')
    print(f'juicio.tsv : {len(juicio)} filas')

    errores = validar(items, juicio)
    if errores:
        print(f'\nQUALITY GATE: {len(errores)} error(es). No se escribe nada.\n')
        for e in errores:
            print(f'  ✗ {e}')
        return 1
    print(f'QUALITY GATE: OK ({len(items)} - {len(EXCLUIDAS)} excluidas = {len(juicio)})')

    filas = construir(items, juicio)
    resumen(juicio)

    print('\nCOLA DE TRABAJO (10 primeras por prioridad calculada)')
    for f in sorted([x for x in filas if x['orden_sugerido']],
                    key=lambda x: x['orden_sugerido'])[:10]:
        print(f'  {f["orden_sugerido"]:>3}. {f["id"]:<8} [{f["temporada"]:<13} '
              f'{f["bloqueo"]:<8} {f["esfuerzo"]:<8}] {f["item"][:62]}')

    if not args.commit:
        print(f'\nDRY-RUN. {len(filas)} filas listas. Correr con --commit para escribir.')
        return 0

    url = os.environ.get('SUPABASE_URL')
    # El repo nombra esta llave `SUPABASE_SECRET_KEY` en .env; se aceptan los
    # otros dos nombres por si el entorno viene de otro lado.
    key = (os.environ.get('SUPABASE_SECRET_KEY')
           or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
           or os.environ.get('SUPABASE_SERVICE_KEY'))
    if not url or not key:
        print('\nFaltan SUPABASE_URL y SUPABASE_SECRET_KEY.')
        return 1

    from supabase import create_client
    sb = create_client(url, key)
    # Upsert y no delete+insert: `status_plan` referencia estas filas con
    # ON DELETE CASCADE, así que un borrado se llevaría el plan por delante.
    for i in range(0, len(filas), 100):
        lote = filas[i:i + 100]
        sb.table('status_items').upsert(lote, on_conflict='id').execute()
        print(f'  upsert {i + len(lote)}/{len(filas)}')
    print(f'\nListo. {len(filas)} filas en status_items. status_plan intacta.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
