// =============================================================================
// apps/api/src/modules/fiscal/domain/repositories/fiscal.repositories.ts
// =============================================================================

import type { Invoice, InvoiceState } from '../entities/invoice';

export const INVOICE_REPOSITORY = Symbol('INVOICE_REPOSITORY');

export interface FindManyInvoicesFilter {
  tenantId: string;
  salesOrderId?: string;
  state?: InvoiceState;
  skip?: number;
  take?: number;
}

export interface IInvoiceRepository {
  create(invoice: Invoice): Promise<Invoice>;
  update(invoice: Invoice): Promise<Invoice>;
  findById(tenantId: string, id: string): Promise<Invoice | null>;
  findBySalesOrder(tenantId: string, salesOrderId: string): Promise<Invoice[]>;
  findMany(filter: FindManyInvoicesFilter): Promise<{ items: Invoice[]; total: number }>;
  /** Registra un log de llamada ARCA (nunca falla — degradación silenciosa) */
  appendArcaLog(log: {
    tenantId: string;
    invoiceId: string;
    attempt: number;
    method: string;
    requestXml: string;
    responseXml?: string;
    resultCode?: string;
    errorCode?: string;
    errorMsg?: string;
    durationMs?: number;
  }): Promise<void>;
}

// =============================================================================
// apps/api/src/modules/fiscal/infrastructure/arca/wsfe.service.ts
// =============================================================================
// Cliente SOAP para el WSFE (Web Service de Facturación Electrónica) de ARCA.
//
// ARCA expone dos endpoints SOAP:
//   Homologación: https://wswhomo.afip.gov.ar/wsfe/service.asmx
//   Producción:   https://servicios1.afip.gov.ar/wsfev1/service.asmx
//
// El flujo de autenticación:
//   1. Llamar WSAA (servicio de autenticación) con el certificado X.509
//      → devuelve un "ticket" {token, sign} válido por ~12hs
//   2. Usar ese ticket en cada llamada al WSFE
//
// Esta implementación usa el paquete `afip.js` (wrapper sobre `soap`)
// que maneja el WSAA internamente. Instalación:
//   pnpm --filter @erp/api add afip
// =============================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';

// ---- Tipos de respuesta ARCA ------------------------------------------------

export interface ArcaAuthTicket {
  token: string;
  sign: string;
  expiresAt: Date;
}

export interface FECAESolicitarInput {
  /** Tipo de comprobante (1=FAC_A, 6=FAC_B, etc.) */
  CbteTipo: number;
  /** Punto de venta */
  PtoVta: number;
  /** Concepto: 1=Productos, 2=Servicios, 3=Mixto */
  Concepto: 1 | 2 | 3;
  /** Tipo de documento del receptor (80=CUIT, 86=CUIL, 99=Consumidor Final) */
  DocTipo: number;
  /** Nro. de documento del receptor */
  DocNro: string;
  /** Número desde-hasta (mismo número para 1 comprobante) */
  CbteDesde: number;
  CbteHasta: number;
  /** Fecha del comprobante YYYYMMDD */
  CbteFch: string;
  /** Importe neto gravado */
  ImpNeto: number;
  /** Importe no gravado */
  ImpTotConc: number;
  /** Importe exento */
  ImpOpEx: number;
  /** Importe IVA total */
  ImpIVA: number;
  /** Importe tributos */
  ImpTrib: number;
  /** Total del comprobante */
  ImpTotal: number;
  /** Array de alícuotas IVA */
  Iva: Array<{ Id: number; BaseImp: number; Importe: number }>;
  /** Comprobantes asociados (para NC/ND) */
  CbtesAsoc?: Array<{
    Tipo: number;
    PtoVta: number;
    Nro: number;
    Cuit?: string;
    CbteFch?: string;
  }>;
}

export interface FECAESolicitarResult {
  CAE: string;           // 14 dígitos
  CAEFchVto: string;     // YYYYMMDD
  DocNro: number;        // Número asignado por ARCA
  Resultado: 'A' | 'R'; // Aprobado / Rechazado
  Observaciones?: Array<{ Code: number; Msg: string }>;
  Errores?: Array<{ Code: number; Msg: string }>;
  /** XML crudo de la respuesta (para ArcaLog) */
  rawResponseXml: string;
  /** XML crudo de la request (para ArcaLog) */
  rawRequestXml: string;
}

export interface FECompUltimoAutorizadoResult {
  CbteNro: number;  // Último número autorizado (para conocer el próximo)
}

// ---- Servicio ---------------------------------------------------------------

export const WSFE_SERVICE = Symbol('WSFE_SERVICE');

export interface IWsfeService {
  /**
   * Solicita CAE para un comprobante.
   * En modo PRODUCCIÓN: llama al webservice real.
   * En HOMOLOGACIÓN: llama al ambiente de pruebas de ARCA.
   */
  solicitarCAE(
    tenantCuit: string,
    input: FECAESolicitarInput,
  ): Promise<FECAESolicitarResult>;

  /**
   * Obtiene el último número de comprobante autorizado para un tipo+POS.
   * Necesario para saber qué número asignar al próximo.
   */
  ultimoComprobanteAutorizado(
    tenantCuit: string,
    cbteTipo: number,
    ptoVta: number,
  ): Promise<FECompUltimoAutorizadoResult>;

  /**
   * Verifica si el servicio ARCA está disponible.
   * Usado por HealthController y para decidir si usar modo contingencia.
   */
  ping(tenantCuit: string): Promise<boolean>;
}

// ---- Implementación real (usa afip.js) --------------------------------------

@Injectable()
export class WsfeService implements IWsfeService, OnModuleInit {
  private readonly logger = new Logger(WsfeService.name);
  private afipClient: any; // instancia de Afip (afip.js)
  private readonly isProduction: boolean;

  constructor(private readonly config: ConfigService) {
    this.isProduction = config.get('AFIP_PRODUCTION') === 'true';
  }

  async onModuleInit(): Promise<void> {
    // Carga lazy — solo inicializar si existen los certificados
    const certPath = this.config.get<string>('AFIP_CERT_PATH');
    const keyPath = this.config.get<string>('AFIP_KEY_PATH');

    if (!certPath || !keyPath) {
      this.logger.warn(
        'AFIP_CERT_PATH o AFIP_KEY_PATH no configurados — WSFE en modo MOCK',
      );
      return;
    }

    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
      this.logger.warn(
        `Certificados ARCA no encontrados en ${certPath} / ${keyPath} — WSFE en modo MOCK`,
      );
      return;
    }

    try {
      // Importación dinámica para no fallar si el paquete no está instalado aún
      const { default: Afip } = await import('afip.js');
      this.afipClient = new Afip({
        CUIT: this.config.get<string>('AFIP_CUIT', ''),
        cert: certPath,
        key: keyPath,
        production: this.isProduction,
        res_expiration: 43200, // 12hs en segundos
      });
      this.logger.log(
        `WSFE inicializado — modo: ${this.isProduction ? '🔴 PRODUCCIÓN' : '🟡 HOMOLOGACIÓN'}`,
      );
    } catch (err) {
      this.logger.error('Error al inicializar afip.js', err);
    }
  }

  async solicitarCAE(
    tenantCuit: string,
    input: FECAESolicitarInput,
  ): Promise<FECAESolicitarResult> {
    if (!this.afipClient) {
      return this.mockCAE(input);
    }

    const t0 = Date.now();
    this.logger.log(
      `FECAESolicitar → PtoVta=${input.PtoVta} Tipo=${input.CbteTipo} Nro=${input.CbteDesde}`,
    );

    try {
      const wsfe = await this.afipClient.ElectronicBilling;

      // Obtener el próximo número si no viene seteado
      let nro = input.CbteDesde;
      if (!nro || nro === 0) {
        const ultimo = await wsfe.getLastVoucher(input.PtoVta, input.CbteTipo);
        nro = (ultimo ?? 0) + 1;
      }

      const data = {
        ...input,
        CbteDesde: nro,
        CbteHasta: nro,
      };

      const result = await wsfe.createVoucher(data);

      const durationMs = Date.now() - t0;
      this.logger.log(
        `FECAESolicitar ← CAE=${result.CAE} Resultado=${result.Resultado} [${durationMs}ms]`,
      );

      return {
        CAE: result.CAE,
        CAEFchVto: result.CAEFchVto,
        DocNro: nro,
        Resultado: result.Resultado,
        Observaciones: result.Obs,
        Errores: result.Errors,
        rawRequestXml: JSON.stringify(data),   // afip.js no expone el XML raw
        rawResponseXml: JSON.stringify(result), // guardamos el JSON como fallback
      };
    } catch (err: any) {
      this.logger.error(`FECAESolicitar error: ${err.message}`, err);
      throw new Error(`ARCA WSFE error: ${err.message}`);
    }
  }

  async ultimoComprobanteAutorizado(
    _tenantCuit: string,
    cbteTipo: number,
    ptoVta: number,
  ): Promise<FECompUltimoAutorizadoResult> {
    if (!this.afipClient) {
      return { CbteNro: 0 };
    }

    const wsfe = await this.afipClient.ElectronicBilling;
    const nro = await wsfe.getLastVoucher(ptoVta, cbteTipo);
    return { CbteNro: nro ?? 0 };
  }

  async ping(_tenantCuit: string): Promise<boolean> {
    if (!this.afipClient) return false;
    try {
      const wsfe = await this.afipClient.ElectronicBilling;
      await wsfe.getServerStatus();
      return true;
    } catch {
      return false;
    }
  }

  // ---- Mock para desarrollo / tests (sin certificado real) ----

  private async mockCAE(input: FECAESolicitarInput): Promise<FECAESolicitarResult> {
    this.logger.warn(
      `[MOCK] FECAESolicitar — devolviendo CAE falso para desarrollo`,
    );

    // Simular latencia ARCA (~800ms promedio)
    await new Promise((r) => setTimeout(r, 800));

    const fakeCAE = `${Date.now()}`.padStart(14, '0').slice(0, 14);
    const vto = new Date();
    vto.setDate(vto.getDate() + 10);
    const vtoStr = vto.toISOString().slice(0, 10).replace(/-/g, '');

    return {
      CAE: fakeCAE,
      CAEFchVto: vtoStr,
      DocNro: input.CbteDesde || 1,
      Resultado: 'A',
      rawRequestXml: JSON.stringify(input),
      rawResponseXml: JSON.stringify({ CAE: fakeCAE, Resultado: 'A' }),
    };
  }
}

// ---- Mock completo para tests unitarios -------------------------------------

export class WsfeServiceMock implements IWsfeService {
  async solicitarCAE(_: string, input: FECAESolicitarInput): Promise<FECAESolicitarResult> {
    const fakeCAE = '12345678901234';
    return {
      CAE: fakeCAE,
      CAEFchVto: '20251231',
      DocNro: input.CbteDesde || 1,
      Resultado: 'A',
      rawRequestXml: '<mock/>',
      rawResponseXml: '<mock/>',
    };
  }

  async ultimoComprobanteAutorizado(): Promise<FECompUltimoAutorizadoResult> {
    return { CbteNro: 0 };
  }

  async ping(): Promise<boolean> { return true; }
}
