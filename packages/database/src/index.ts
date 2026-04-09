import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Opciones de construcción del cliente Prisma.
 * El API y el Worker pueden personalizar el logging según necesidad.
 */
export interface PrismaClientOptions {
  databaseUrl?: string;
  logQueries?: boolean;
  logLevel?: 'error' | 'warn' | 'info' | 'query';
}

/**
 * Factory del PrismaClient. No exportamos un singleton directamente porque
 * el API y el Worker pueden querer configuraciones de logging distintas, y
 * en tests necesitamos poder crear instancias con DB distinta.
 *
 * En cada app (api/worker), envolver esto en un módulo de Nest que lo provea
 * como singleton de ese contexto.
 */
export function createPrismaClient(options: PrismaClientOptions = {}): PrismaClient {
  const logLevels: ('error' | 'warn' | 'info' | 'query')[] = ['error', 'warn'];
  if (options.logQueries) logLevels.push('query');
  if (options.logLevel && !logLevels.includes(options.logLevel)) {
    logLevels.push(options.logLevel);
  }

  const client = new PrismaClient({
    datasources: options.databaseUrl
      ? { db: { url: options.databaseUrl } }
      : undefined,
    log: logLevels.map((level) => ({ emit: 'event', level })),
    errorFormat: 'pretty',
  });

  return client;
}

/**
 * Type-safe helper para transacciones interactivas.
 * Uso: type Tx = PrismaTx; function foo(tx: Tx) {...}
 */
export type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
