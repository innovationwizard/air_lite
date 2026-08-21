/**
 * The Carvajal weekly priorities sheet — the file Wilmer builds by hand today.
 *
 * Wilmer, 2026-08-20: *"yo tengo la visual, pero yo necesito eso llevarlo a
 * algo que se comunique al proveedor"* · *"¿cuánto quiero para la otra semana
 * para San José? ¿y en qué orden de prioridad? ¿y cuánto quiero para Zacapa? ¿y
 * cuánto quiero para Petén? De cada código."*
 *
 * Reproduced from the real file he sends (`Carvajal_Prioridades Semana 4 Agosto
 * 2026.xlsx`, screenshots 2026-08-21). Two things are copied EXACTLY rather
 * than tidied, because the receiving end is a robot Carvajal is still building
 * and it is their format, not ours:
 *
 *   1. `Prioridad` sits BETWEEN `San Jose` and `Petén`. It reads as a mistake
 *      and is not one to fix — column order is part of the contract.
 *   2. A bodega that gets nothing is left BLANK, never 0. A zero says "ordered
 *      none of this"; blank says "not on this shipment". Carvajal's robot may
 *      well treat them differently, and we do not get to guess which.
 *
 * ⚠️ EXPECT THIS TO CHANGE. Jorge, 2026-08-21: the bot is in development, so
 * the template will move. Everything shape-related lives in this one file.
 */
import { type SheetSpec } from '@/lib/xlsx/writer';

/**
 * Purchasing bodegas, in the sheet's own column order.
 * Split out of the fused 'Zacapa-Petén' on 2026-08-21 (W11, migration
 * 20260821000002) — this file is precisely why the split had to happen first.
 */
export const CARVAJAL_BODEGAS = ['San Jose VN', 'Petén', 'Zacapa'] as const;
export type CarvajalBodega = (typeof CARVAJAL_BODEGAS)[number];

/** Header label per bodega — the sheet says "San Jose", our data says "San Jose VN". */
export const BODEGA_HEADER: Record<CarvajalBodega, string> = {
  'San Jose VN': 'San Jose',
  'Petén': 'Petén',
  'Zacapa': 'Zacapa',
};

export interface ExportLine {
  cod: string;
  desc: string;
  /** Per bodega. null = leave the cell EMPTY. */
  cantidades: Record<string, number | null>;
}

export const SPANISH_MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** 1-based week of the month, the way the filename counts it (days 1-7 = 1). */
export function weekOfMonth(d: Date): number {
  return Math.ceil(d.getDate() / 7);
}

/**
 * `Carvajal_Prioridades Semana 4 Agosto 2026.xlsx` — his exact naming.
 * The week is a parameter, not derived: he sends the sheet for the week AHEAD,
 * and how far ahead depends on when he gets to it. Guessing it would put the
 * wrong week in a filename Carvajal reads.
 */
export function carvajalFilename(semana: number, date: Date, proveedor = 'Carvajal'): string {
  const mes = SPANISH_MONTHS[date.getMonth()];
  const safe = proveedor.replace(/[^\p{L}\p{N} ._-]/gu, '').trim() || 'Proveedor';
  return `${safe}_Prioridades Semana ${semana} ${mes} ${date.getFullYear()}.xlsx`;
}

/** Sum across bodegas; blanks count as nothing, and an all-blank row totals blank. */
export function lineTotal(line: ExportLine): number | null {
  const vals = CARVAJAL_BODEGAS.map((b) => line.cantidades[b]).filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

/**
 * Build the sheet. `Prioridad` is the row's position, 1..N — the export takes
 * the list in the order the page is showing it, which defaults to DOH ascending:
 * literally Wilmer's *"de acuerdo a los días de inventario que tengo"*.
 */
export function buildCarvajalSheet(lines: ExportLine[]): SheetSpec {
  return {
    name: 'Hoja1',
    columns: [
      { header: 'Código', width: 12, type: 'text' },
      { header: 'Descripción', width: 44, type: 'text' },
      { header: BODEGA_HEADER['San Jose VN'], width: 11, type: 'number' },
      { header: 'Prioridad', width: 11, type: 'number' },
      { header: BODEGA_HEADER['Petén'], width: 11, type: 'number' },
      { header: BODEGA_HEADER['Zacapa'], width: 11, type: 'number' },
      { header: 'Total', width: 11, type: 'number' },
    ],
    rows: lines.map((l, i) => [
      l.cod,
      l.desc,
      l.cantidades['San Jose VN'] ?? null,
      i + 1,
      l.cantidades['Petén'] ?? null,
      l.cantidades['Zacapa'] ?? null,
      lineTotal(l),
    ]),
  };
}
