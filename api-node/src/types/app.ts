import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

export type AppWithPrisma = FastifyInstance & { prisma: PrismaClient };

export interface TimeNavigationParams {
  fechaInicio?: string;
  fechaFin?: string;
  granularidad?: 'diario' | 'semanal' | 'mensual' | 'anual';
  modo?: 'individual' | 'comparar' | 'tendencia';
  fechaInicioComparacion?: string;
  fechaFinComparacion?: string;
}
