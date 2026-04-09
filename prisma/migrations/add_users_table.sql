-- ============================================================
-- Migration: add_users_table
-- Agregar a schema.prisma y luego: pnpm prisma migrate dev
-- ============================================================

-- Extensión para UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enum de roles
CREATE TYPE "UserRole" AS ENUM (
  'ADMIN',
  'VENDEDOR',
  'COMPRAS',
  'CONTABLE',
  'READONLY'
);

-- Enum de estado de usuario
CREATE TYPE "UserStatus" AS ENUM (
  'PENDING_ACTIVATION',
  'ACTIVE',
  'SUSPENDED'
);

-- Tabla de usuarios
CREATE TABLE "users" (
  "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "email"                  TEXT NOT NULL,
  "password_hash"          TEXT,
  "first_name"             TEXT NOT NULL,
  "last_name"              TEXT NOT NULL,
  "role"                   "UserRole" NOT NULL DEFAULT 'READONLY',
  "status"                 "UserStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
  "invite_token"           TEXT UNIQUE,
  "invite_token_expires_at" TIMESTAMPTZ,
  "last_login_at"          TIMESTAMPTZ,
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "users_email_unique" UNIQUE ("email")
);

-- Índices
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");
CREATE INDEX "users_email_idx" ON "users"("email");
CREATE INDEX "users_invite_token_idx" ON "users"("invite_token") WHERE "invite_token" IS NOT NULL;

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_updated_at"
  BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Bloque Prisma schema (agregar a schema.prisma)
-- ============================================================
/*
enum UserRole {
  ADMIN
  VENDEDOR
  COMPRAS
  CONTABLE
  READONLY
}

enum UserStatus {
  PENDING_ACTIVATION
  ACTIVE
  SUSPENDED
}

model User {
  id                    String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId              String      @db.Uuid
  email                 String      @unique
  passwordHash          String?     @map("password_hash")
  firstName             String      @map("first_name")
  lastName              String      @map("last_name")
  role                  UserRole    @default(READONLY)
  status                UserStatus  @default(PENDING_ACTIVATION)
  inviteToken           String?     @unique @map("invite_token")
  inviteTokenExpiresAt  DateTime?   @map("invite_token_expires_at") @db.Timestamptz
  lastLoginAt           DateTime?   @map("last_login_at") @db.Timestamptz
  createdAt             DateTime    @default(now()) @map("created_at") @db.Timestamptz
  updatedAt             DateTime    @updatedAt @map("updated_at") @db.Timestamptz

  tenant    Tenant      @relation(fields: [tenantId], references: [id])
  auditLogs AuditLog[]

  @@map("users")
}
*/
