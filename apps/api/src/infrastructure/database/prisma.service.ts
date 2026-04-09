import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@erp/database';
import type { AppConfig } from '../../config/app.config';

/**
 * PrismaService — singleton del PrismaClient con lifecycle de Nest.
 *
 * Por qué extender PrismaClient en lugar de envolverlo:
 *   - Autocomplete de todas las operaciones en los servicios.
 *   - Los repositorios pueden recibir PrismaService y usarlo tal cual.
 *   - Para transacciones interactivas: this.prisma.$transaction(async (tx) => ...)
 *
 * Connection pooling: Prisma usa un pool interno. En serverless hay que
 * ajustar connection_limit en la URL. En nuestro caso (servidor long-running)
 * el default (num_cpus * 2 + 1) está bien.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService<AppConfig, true>) {
    super({
      datasources: {
        db: { url: configService.get('DATABASE_URL', { infer: true }) },
      },
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
      errorFormat: 'pretty',
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }

  /**
   * Ejecuta un callback dentro de una transacción con nivel de aislamiento
   * SERIALIZABLE. Usar cuando se lee y escribe en el mismo conjunto de filas
   * y queremos prevenir phantom reads.
   *
   * Si hay conflicto, Postgres lanza error 40001 y el caller debe reintentar.
   */
  async serializable<T>(
    fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(fn, {
      isolationLevel: 'Serializable',
      maxWait: 5000,
      timeout: 15000,
    });
  }
}

