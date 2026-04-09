import { z } from 'zod';

/**
 * Schema de variables de entorno.
 * Si alguna env var es inválida, el server FALLA EN ARRANQUE con un error claro.
 * Nunca arrancar el server con env vars opcionales sin defaults explícitos.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    .refine(
      (v) => !v.includes('change-me') || process.env.NODE_ENV !== 'production',
      'JWT_SECRET must be changed in production',
    ),
  JWT_EXPIRES_IN: z.string().default('8h'),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
});

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Parsea y valida process.env. Si falla, imprime todos los errores y sale.
 */
export function loadConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment variables:');
    for (const issue of result.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}
