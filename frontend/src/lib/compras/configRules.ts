/**
 * Read `config_rules` for the live reabastecimiento page.
 *
 * Phase 1 is a read path. The fallback is the constant the page used before
 * the table existed. A missing row, a failed query, or a value this code
 * cannot apply returns that constant, so the column does not move.
 *
 * The select is the whole table. The keys contain dots (`stock.patio`), and
 * a filtered URL would have to quote that dot for PostgREST. The table is a
 * handful of rows.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { BODEGAS_CON_PATIO } from './bodega';
import { COBERTURA_DEFAULTS, type CoberturaDefaults } from './cobertura';
import {
  DOH_BANDS, ENGINE_FACTORS, type DohBands, type EngineFactors,
} from './reabastecimientoEngine';
import { TREND_THRESHOLDS, type TrendThresholds } from './tendencia';

export interface PatioRule {
  location: string;
  bodegas: readonly string[];
}

/** The yard the sync already stored, and the bodegas that show it. */
export const PATIO_RULE_FALLBACK: PatioRule = {
  location: '1CET/Entrada',
  bodegas: BODEGAS_CON_PATIO,
};

export function acceptPatioRule(value: unknown): PatioRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as { location?: unknown; bodegas?: unknown };
  if (typeof rec.location !== 'string' || rec.location.length === 0 || rec.location !== rec.location.trim()) {
    return null;
  }
  if (!Array.isArray(rec.bodegas)) return null;
  if (!rec.bodegas.every((b) => typeof b === 'string' && b.length > 0 && b === b.trim())) return null;
  return { location: rec.location, bodegas: rec.bodegas };
}

export async function readConfigRule<T>(
  supabase: SupabaseClient,
  key: string,
  fallback: T,
  accept: (value: unknown) => T | null,
): Promise<T> {
  try {
    const { data, error } = await supabase.from('config_rules').select('key, value');
    if (error) {
      console.warn(`[config_rules] ${key}: ${error.message} — using the previous rule`);
      return fallback;
    }
    const row = (data ?? []).find((r: { key?: string }) => r.key === key);
    if (!row) return fallback;
    const accepted = accept((row as { value?: unknown }).value);
    if (accepted === null) {
      console.warn(`[config_rules] ${key}: unexpected shape — using the previous rule`);
      return fallback;
    }
    return accepted;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'read failed';
    console.warn(`[config_rules] ${key}: ${message} — using the previous rule`);
    return fallback;
  }
}

export function readPatioRule(supabase: SupabaseClient): Promise<PatioRule> {
  return readConfigRule(supabase, 'stock.patio', PATIO_RULE_FALLBACK, acceptPatioRule);
}

/** D below this ordered qty, then cumulative shares. Fallback for `abc.cutoffs`. */
export interface AbcCutoffs {
  min_qty_for_class: number;
  a_share: number;
  b_share: number;
}

export const ABC_CUTOFFS: AbcCutoffs = {
  min_qty_for_class: 10,
  a_share: 0.50,
  b_share: 0.80,
};

export interface CalcRules {
  doh: DohBands;
  engine: EngineFactors;
  abc: AbcCutoffs;
  trend: TrendThresholds;
  cobertura: CoberturaDefaults;
}

export const CALC_RULES_FALLBACK: CalcRules = {
  doh: DOH_BANDS,
  engine: ENGINE_FACTORS,
  abc: ABC_CUTOFFS,
  trend: TREND_THRESHOLDS,
  cobertura: COBERTURA_DEFAULTS,
};

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function acceptDohBands(value: unknown): DohBands | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as { critico?: unknown; bajo?: unknown; normal?: unknown };
  const critico = rec.critico;
  const bajo = rec.bajo;
  const normal = rec.normal;
  if (!finite(critico) || !finite(bajo) || !finite(normal)) return null;
  return { critico, bajo, normal };
}

function acceptEngineFactors(value: unknown): EngineFactors | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const keys = ['general_growth', 't_divisor', 'weekdays', 'win_general', 'win_other'] as const;
  const out = {} as EngineFactors;
  for (const key of keys) {
    if (!finite(rec[key])) return null;
    out[key] = rec[key] as number;
  }
  if (out.t_divisor === 0 || out.weekdays === 0 || out.win_general <= 0 || out.win_other <= 0) return null;
  return out;
}

function acceptAbcCutoffs(value: unknown): AbcCutoffs | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as { min_qty_for_class?: unknown; a_share?: unknown; b_share?: unknown };
  const floor = rec.min_qty_for_class;
  const a = rec.a_share;
  const b = rec.b_share;
  if (!finite(floor) || !finite(a) || !finite(b)) return null;
  if (a < 0 || b > 1 || a > b) return null;
  return { min_qty_for_class: floor, a_share: a, b_share: b };
}

function acceptTrend(value: unknown): TrendThresholds | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as {
    rises?: unknown; divergence?: unknown; mtd_color_high?: unknown; mtd_color_low?: unknown;
  };
  const rises = rec.rises;
  const divergence = rec.divergence;
  const high = rec.mtd_color_high;
  const low = rec.mtd_color_low;
  if (!finite(rises) || !Number.isInteger(rises) || rises < 1) return null;
  if (!finite(divergence) || !finite(high) || !finite(low) || low >= high) return null;
  return { rises, divergence, mtd_color_high: high, mtd_color_low: low };
}

function acceptCobertura(value: unknown): CoberturaDefaults | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as { default_dias?: unknown; min_dias?: unknown; max_dias?: unknown };
  const def = rec.default_dias;
  const min = rec.min_dias;
  const max = rec.max_dias;
  if (!finite(def) || !finite(min) || !finite(max)) return null;
  if (!Number.isInteger(def) || !Number.isInteger(min) || !Number.isInteger(max)) return null;
  if (min > def || def > max) return null;
  return { default_dias: def, min_dias: min, max_dias: max };
}

/**
 * Patio plus the calculation constants, from one read. A missing row or a
 * shape the sync cannot apply keeps that key's previous constant.
 */
export async function readLiveRules(supabase: SupabaseClient): Promise<{
  patio: PatioRule;
  calc: CalcRules;
}> {
  const fallen = { patio: PATIO_RULE_FALLBACK, calc: CALC_RULES_FALLBACK };
  try {
    const { data, error } = await supabase.from('config_rules').select('key, value');
    if (error) {
      console.warn(`[config_rules] ${error.message} — using the previous rules`);
      return fallen;
    }
    const byKey = new Map((data ?? []).map((r: { key?: string; value?: unknown }) => [r.key, r.value]));
    const pick = <T>(key: string, fallback: T, accept: (value: unknown) => T | null): T => {
      if (!byKey.has(key)) return fallback;
      const accepted = accept(byKey.get(key));
      if (accepted === null) {
        console.warn(`[config_rules] ${key}: unexpected shape — using the previous rule`);
        return fallback;
      }
      return accepted;
    };
    return {
      patio: pick('stock.patio', PATIO_RULE_FALLBACK, acceptPatioRule),
      calc: {
        doh: pick('doh.bands', DOH_BANDS, acceptDohBands),
        engine: pick('engine.factors', ENGINE_FACTORS, acceptEngineFactors),
        abc: pick('abc.cutoffs', ABC_CUTOFFS, acceptAbcCutoffs),
        trend: pick('trend.thresholds', TREND_THRESHOLDS, acceptTrend),
        cobertura: pick('cobertura.defaults', COBERTURA_DEFAULTS, acceptCobertura),
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'read failed';
    console.warn(`[config_rules] ${message} — using the previous rules`);
    return fallen;
  }
}
