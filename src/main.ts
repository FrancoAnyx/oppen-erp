// ============================================================
// apps/api/src/main.ts
// Bootstrap de la API con seguridad, Swagger y pipes globales
// ============================================================

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
    bufferLogs: true,
  });

  const config = app.get(ConfigService);
  const isProd = config.get('NODE_ENV') === 'production';

  // ── Seguridad ──────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: isProd,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());

  // ── CORS ──────────────────────────────────────────────────
  const allowedOrigins = config
    .get<string>('CORS_ORIGINS', 'http://localhost:3001')
    .split(',')
    .map((o) => o.trim());

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
    credentials: true,
  });

  // ── Prefix global + versioning ────────────────────────────
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // ── Validación global ─────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,           // strip propiedades no declaradas en DTO
      forbidNonWhitelisted: true,
      transform: true,           // auto-cast de tipos (string → number, etc.)
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: false,   // devuelve TODOS los errores de validación
    }),
  );

  // ── Swagger (solo en desarrollo) ─────────────────────────
  if (!isProd) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('ERP Reseller B2B — API')
      .setDescription('API REST del sistema ERP. Documentación interactiva.')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'JWT',
      )
      .addTag('auth', 'Autenticación y gestión de usuarios')
      .addTag('inventory', 'Productos, stock y movimientos')
      .addTag('sales', 'Presupuestos, órdenes de venta y remitos')
      .addTag('purchase', 'Órdenes de compra y recepciones')
      .addTag('fiscal', 'Facturación electrónica ARCA')
      .addTag('finance', 'Cuentas corrientes y cobros/pagos')
      .addTag('entities', 'Clientes y proveedores')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/v1/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    console.log('📖 Swagger disponible en http://localhost:3000/api/v1/docs');
  }

  // ── Graceful shutdown ─────────────────────────────────────
  app.enableShutdownHooks();

  const port = config.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 API corriendo en http://localhost:${port}/api/v1`);
  console.log(`🌍 Entorno: ${config.get('NODE_ENV', 'development')}`);
  console.log(`🏷️  ARCA: ${config.get('AFIP_PRODUCTION') === 'true' ? '🟢 PRODUCCIÓN' : '🟡 HOMOLOGACIÓN'}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error en bootstrap:', err);
  process.exit(1);
});
