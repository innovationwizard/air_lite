import { QueryDebugInfo } from '../types';

type QueryExecutor = {
  $queryRawUnsafe: (query: string, ...params: unknown[]) => Promise<unknown>;
};

export class QueryBuilder {
  private static debugQueries = process.env.NODE_ENV === 'development' || process.env.DEBUG_QUERIES === 'true';

  static async executeWithDebug<T>(
    prisma: QueryExecutor,
    query: string,
    params: unknown[] = [],
    context: string = 'Unknown'
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      
      const result = await prisma.$queryRawUnsafe(query, ...params);
      const executionTime = Date.now() - startTime;
      const rowCount = Array.isArray(result) ? result.length : 1;
      
      
      if (this.debugQueries) {
        const debugInfo: QueryDebugInfo = {
          query,
          params,
          executionTime,
          rowCount,
        };
      }
      
      return result as T;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error(`[QUERY ERROR] ${context}:`);
      console.error(`[QUERY ERROR] SQL: ${query}`);
      console.error(`[QUERY ERROR] Params:`, params);
      console.error(`[QUERY ERROR] Execution time: ${executionTime}ms`);
      console.error(`[QUERY ERROR] Error:`, error);
      
      if (this.debugQueries) {
        const debugInfo: QueryDebugInfo = {
          query,
          params,
          executionTime,
          rowCount: 0,
          error: error instanceof Error ? error.message : String(error),
        };
        console.error(`[QUERY DEBUG INFO]`, JSON.stringify(debugInfo, null, 2));
      }
      
      throw error;
    }
  }

  static buildDateFilter(startDate: Date, endDate: Date, column: string = 'created_at'): string {
    return `${column} >= '${startDate.toISOString()}' AND ${column} <= '${endDate.toISOString()}'`;
  }

  static buildPagination(page: number, limit: number): string {
    const offset = (page - 1) * limit;
    return `LIMIT ${limit} OFFSET ${offset}`;
  }

  static buildOrderBy(sortBy: string, sortOrder: string): string {
    return `ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`;
  }

  static buildFilters(filters: Record<string, string>): string {
        const conditions = Object.entries(filters)
          .filter(([, value]) => value !== undefined && value !== null && value !== '')
          .map(([key, value]) => `${key} = '${value}'`);
    
    return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  }

  static sanitizeInput(input: string): string {
    // Basic SQL injection prevention
    return input.replace(/[';-]/g, '');
  }

  static buildInClause(values: unknown[]): string {
    return values.map(v => `'${String(v)}'`).join(', ');
  }

  static buildCaseStatement(conditions: Array<{ condition: string; value: string }>, defaultValue: string = 'NULL'): string {
    const cases = conditions.map(c => `WHEN ${c.condition} THEN ${c.value}`).join(' ');
    return `CASE ${cases} ELSE ${defaultValue} END`;
  }

  static buildAggregateFunction(column: string, func: string = 'SUM'): string {
    return `${func}(${column})`;
  }

  static buildCoalesce(column: string, defaultValue: string | number = 0): string {
    return `COALESCE(${column}, ${defaultValue})`;
  }

  static buildNullIf(column: string, value: string | number = 0): string {
    return `NULLIF(${column}, ${value})`;
  }

  static buildDateTrunc(column: string, interval: string = 'day'): string {
    return `DATE_TRUNC('${interval}', ${column})`;
  }

  static buildExtract(column: string, part: string): string {
    return `EXTRACT(${part} FROM ${column})`;
  }

  static buildInterval(amount: number, unit: string): string {
    return `INTERVAL '${amount} ${unit}'`;
  }

  static buildCurrentDate(): string {
    return 'CURRENT_DATE';
  }

  static buildNow(): string {
    return 'NOW()';
  }

  static buildGenerateSeries(start: string, end: string, interval: string = '1 day'): string {
    return `generate_series('${start}'::date, '${end}'::date, '${interval}'::interval)`;
  }
}
