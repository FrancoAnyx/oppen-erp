// ============================================================
// apps/web/next.config.js
// Standalone output requerido para el Dockerfile de producción
// ============================================================

/** @type {import('next').NextConfig} */
const nextConfig = {
  // CRÍTICO: permite copiar solo los archivos necesarios en Docker
  output: 'standalone',

  // Deshabilitar telemetría en build
  env: {
    NEXT_TELEMETRY_DISABLED: '1',
  },

  // La API vive en otro contenedor/subdominio
  async rewrites() {
    const apiUrl = process.env.INTERNAL_API_URL ?? 'http://api:3000';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },

  // Headers de seguridad adicionales
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },

  // Optimizaciones
  poweredByHeader: false,
  reactStrictMode: true,
  swcMinify: true,

  // Logging de builds
  logging: {
    fetches: {
      fullUrl: process.env.NODE_ENV === 'development',
    },
  },

  // Ignorar errores de TS/ESLint en build (ya corremos checks por separado)
  typescript:  { ignoreBuildErrors: false },
  eslint:      { ignoreDuringBuilds: false },
};

module.exports = nextConfig;
