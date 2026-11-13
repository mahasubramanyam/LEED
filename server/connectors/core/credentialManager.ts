import crypto from 'crypto';
import pg from 'pg';
import { dbManager } from '../../db/pool.js';
import { ConnectorError, redactSecrets } from './errors.js';
import { ConnectorCredentialStatus, CredentialRequirement } from './types.js';

export interface EncryptionStatus {
  configured: boolean;
  source: 'CONNECTOR_ENCRYPTION_KEY' | 'APP_ENCRYPTION_KEY' | 'missing' | 'invalid';
  requirementMessage?: string;
}

export interface StoredCredentialMetadata {
  connectorId: string;
  authType: string;
  status: string;
  keyVersion: number;
  maskedHint?: string;
  rotatedAt?: string;
  validatedAt?: string;
  validationStatus?: string;
  updatedAt?: string;
}

export interface ResolvedCredentials {
  credentials: Record<string, string>;
  source: 'environment' | 'database_encrypted' | 'none';
  knownSecrets: string[];
  maskedHint?: string;
}

export class CredentialManager {
  private memoryStore = new Map<
    string,
    {
      connectorId: string;
      authType: string;
      encryptedPayload: string;
      status: string;
      keyVersion: number;
      maskedHint?: string;
      rotatedAt?: string;
      validatedAt?: string;
      validationStatus?: string;
      updatedAt: string;
    }
  >();

  /**
   * Inspects whether a dedicated application encryption key is configured.
   * Never invents or falls back to a hardcoded secret.
   */
  public getEncryptionStatus(): EncryptionStatus {
    const connKey = process.env.CONNECTOR_ENCRYPTION_KEY?.trim();
    const appKey = process.env.APP_ENCRYPTION_KEY?.trim();
    const raw = connKey || appKey;
    const source = connKey ? 'CONNECTOR_ENCRYPTION_KEY' : appKey ? 'APP_ENCRYPTION_KEY' : 'missing';

    if (!raw) {
      return {
        configured: false,
        source: 'missing',
        requirementMessage:
          'Missing CONNECTOR_ENCRYPTION_KEY environment variable. Configure a dedicated 32-byte key (64 hex chars or >=32 char secret) to store or decrypt connector credentials at rest.',
      };
    }

    if (this.parseEncryptionKey(raw) === null) {
      return {
        configured: false,
        source: 'invalid',
        requirementMessage:
          'CONNECTOR_ENCRYPTION_KEY is too weak or malformed. Provide 64 hexadecimal characters, a 32-byte base64 string, or a passphrase of at least 32 characters.',
      };
    }

    return {
      configured: true,
      source,
    };
  }

  private parseEncryptionKey(raw: string): Buffer | null {
    const trimmed = raw.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }
    if (/^[A-Za-z0-9+/=]{43,44}$/.test(trimmed)) {
      try {
        const buf = Buffer.from(trimmed, 'base64');
        if (buf.length === 32) return buf;
      } catch {
        // fall through
      }
    }
    if (trimmed.length >= 32) {
      return crypto.createHash('sha256').update(trimmed, 'utf8').digest();
    }
    return null;
  }

  private requireEncryptionKey(providerId: string): Buffer {
    const status = this.getEncryptionStatus();
    const raw = (process.env.CONNECTOR_ENCRYPTION_KEY || process.env.APP_ENCRYPTION_KEY || '').trim();
    const key = raw ? this.parseEncryptionKey(raw) : null;
    if (!status.configured || !key) {
      throw new ConnectorError({
        category: 'configuration_error',
        providerId,
        message: status.requirementMessage || 'CONNECTOR_ENCRYPTION_KEY is required for encrypted credential operations.',
        remediationHint: 'Set CONNECTOR_ENCRYPTION_KEY in the server environment before saving or rotating credentials.',
      });
    }
    return key;
  }

  public maskSecret(secret?: string): string | undefined {
    if (!secret) return undefined;
    const trimmed = secret.trim();
    if (!trimmed) return undefined;
    if (trimmed.length <= 6) return '••••••';
    return `••••${trimmed.slice(-4)}`;
  }

  public encryptPayload(payload: Record<string, string>, providerId = 'system'): string {
    const key = this.requireEncryptionKey(providerId);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const json = JSON.stringify(payload);
    const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return JSON.stringify({
      v: 2,
      alg: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: encrypted.toString('base64'),
    });
  }

  public decryptPayload(raw: string, providerId = 'system'): Record<string, string> {
    const key = this.requireEncryptionKey(providerId);
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ConnectorError({
        category: 'configuration_error',
        providerId,
        message: 'Stored encrypted credential payload is corrupted or unreadable JSON.',
      });
    }

    if (!parsed || !parsed.iv || !parsed.tag || !parsed.data) {
      throw new ConnectorError({
        category: 'configuration_error',
        providerId,
        message: 'Stored encrypted credential payload is missing required AES-GCM envelope fields.',
      });
    }

    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(parsed.iv, 'base64')
      );
      decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(parsed.data, 'base64')),
        decipher.final(),
      ]);
      const obj = JSON.parse(decrypted.toString('utf8'));
      const result: Record<string, string> = {};
      if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string') result[k] = v;
        }
      }
      return result;
    } catch {
      throw new ConnectorError({
        category: 'configuration_error',
        providerId,
        message: 'Failed to decrypt stored credential with current CONNECTOR_ENCRYPTION_KEY.',
        remediationHint: 'Verify CONNECTOR_ENCRYPTION_KEY matches the key used to encrypt stored credentials, or rotate credentials.',
      });
    }
  }

  private getActivePool(customPool?: pg.Pool): pg.Pool | null {
    if (customPool) return customPool;
    return dbManager.isDbConnected() ? dbManager.getPool() : null;
  }

  public async getStoredMetadata(connectorId: string, customPool?: pg.Pool): Promise<StoredCredentialMetadata | null> {
    const pool = this.getActivePool(customPool);
    if (!pool) {
      const mem = this.memoryStore.get(connectorId);
      if (!mem) return null;
      return {
        connectorId: mem.connectorId,
        authType: mem.authType,
        status: mem.status,
        keyVersion: mem.keyVersion,
        maskedHint: mem.maskedHint,
        rotatedAt: mem.rotatedAt,
        validatedAt: mem.validatedAt,
        validationStatus: mem.validationStatus,
        updatedAt: mem.updatedAt,
      };
    }

    try {
      const res = await pool.query(
        `SELECT connector_id, auth_type, status,
                COALESCE(key_version, 1) as key_version,
                masked_hint, rotated_at, validated_at, validation_status, updated_at
         FROM connector_credentials
         WHERE connector_id = $1
         LIMIT 1`,
        [connectorId]
      );
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        connectorId: r.connector_id,
        authType: r.auth_type,
        status: r.status,
        keyVersion: Number(r.key_version || 1),
        maskedHint: r.masked_hint || undefined,
        rotatedAt: r.rotated_at ? new Date(r.rotated_at).toISOString() : undefined,
        validatedAt: r.validated_at ? new Date(r.validated_at).toISOString() : undefined,
        validationStatus: r.validation_status || undefined,
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
      };
    } catch {
      // Backward compatibility when Migration 004 columns have not yet been applied
      const res = await pool.query(
        `SELECT connector_id, auth_type, status, updated_at
         FROM connector_credentials
         WHERE connector_id = $1
         LIMIT 1`,
        [connectorId]
      );
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        connectorId: r.connector_id,
        authType: r.auth_type,
        status: r.status,
        keyVersion: 1,
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
      };
    }
  }

  public getEnvCredentials(requirement: CredentialRequirement): {
    found: boolean;
    credentials: Record<string, string>;
    maskedHint?: string;
  } {
    const credentials: Record<string, string> = {};
    let primaryValue: string | undefined;

    for (let i = 0; i < requirement.envFallbackKeys.length; i++) {
      const envName = requirement.envFallbackKeys[i];
      const val = process.env[envName]?.trim();
      if (val && val !== 'MY_GEMINI_API_KEY') {
        const targetField = requirement.fields[i]?.key || requirement.fields[0]?.key || 'apiKey';
        credentials[targetField] = val;
        if (!primaryValue) primaryValue = val;
      }
    }

    const requiredFields = requirement.fields.filter((f) => f.required);
    const hasRequired =
      requiredFields.length === 0
        ? Object.keys(credentials).length > 0
        : requiredFields.every((f) => Boolean(credentials[f.key]));

    return {
      found: hasRequired,
      credentials,
      maskedHint: this.maskSecret(primaryValue),
    };
  }

  public async getCredentialStatus(
    connectorId: string,
    requirement: CredentialRequirement,
    customPool?: pg.Pool
  ): Promise<ConnectorCredentialStatus> {
    const encStatus = this.getEncryptionStatus();

    if (requirement.authType === 'none_open' && !requirement.required) {
      return {
        connectorId,
        authType: requirement.authType,
        required: false,
        configured: true,
        source: 'none_required',
        encryptionKeyConfigured: encStatus.configured,
        encryptionRequirement: encStatus.requirementMessage,
      };
    }

    const stored = await this.getStoredMetadata(connectorId, customPool);
    if (stored && stored.status === 'configured') {
      return {
        connectorId,
        authType: requirement.authType,
        required: requirement.required,
        configured: encStatus.configured,
        source: 'database_encrypted',
        maskedHint: stored.maskedHint,
        encryptionKeyConfigured: encStatus.configured,
        encryptionRequirement: encStatus.requirementMessage,
        rotatedAt: stored.rotatedAt,
        validatedAt: stored.validatedAt,
        validationStatus: encStatus.configured
          ? stored.validationStatus
          : 'encryption_key_missing',
      };
    }

    const envRes = this.getEnvCredentials(requirement);
    if (envRes.found) {
      return {
        connectorId,
        authType: requirement.authType,
        required: requirement.required,
        configured: true,
        source: 'environment',
        maskedHint: envRes.maskedHint,
        encryptionKeyConfigured: encStatus.configured,
        encryptionRequirement: encStatus.requirementMessage,
        validatedAt: stored?.validatedAt,
        validationStatus: stored?.validationStatus,
      };
    }

    return {
      connectorId,
      authType: requirement.authType,
      required: requirement.required,
      configured: false,
      source: 'missing',
      encryptionKeyConfigured: encStatus.configured,
      encryptionRequirement: encStatus.requirementMessage,
      validatedAt: stored?.validatedAt,
      validationStatus: stored?.validationStatus,
    };
  }

  /**
   * Resolves credentials strictly for backend execution.
   * Prefers encrypted database credential if configured & decryptable, otherwise environment fallback.
   */
  public async resolveCredentialForExecution(
    connectorId: string,
    requirement: CredentialRequirement,
    customPool?: pg.Pool
  ): Promise<ResolvedCredentials> {
    if (requirement.authType === 'none_open' && !requirement.required) {
      return { credentials: {}, source: 'none', knownSecrets: [] };
    }

    const pool = this.getActivePool(customPool);
    let rawEncrypted: string | null = null;

    if (pool) {
      const res = await pool.query(
        `SELECT encrypted_payload, status FROM connector_credentials WHERE connector_id = $1 LIMIT 1`,
        [connectorId]
      );
      if (res.rows.length > 0 && res.rows[0].status === 'configured' && res.rows[0].encrypted_payload) {
        rawEncrypted = res.rows[0].encrypted_payload;
      }
    } else {
      const mem = this.memoryStore.get(connectorId);
      if (mem && mem.status === 'configured') {
        rawEncrypted = mem.encryptedPayload;
      }
    }

    if (rawEncrypted) {
      const decrypted = this.decryptPayload(rawEncrypted, connectorId);
      const knownSecrets = Object.values(decrypted).filter((v) => v && v.length >= 6);
      const primary = decrypted.apiKey || Object.values(decrypted)[0];
      return {
        credentials: decrypted,
        source: 'database_encrypted',
        knownSecrets,
        maskedHint: this.maskSecret(primary),
      };
    }

    const envRes = this.getEnvCredentials(requirement);
    if (envRes.found) {
      const knownSecrets = Object.values(envRes.credentials).filter((v) => v && v.length >= 6);
      return {
        credentials: envRes.credentials,
        source: 'environment',
        knownSecrets,
        maskedHint: envRes.maskedHint,
      };
    }

    return {
      credentials: {},
      source: 'none',
      knownSecrets: [],
    };
  }

  /**
   * Stores or rotates encrypted credentials for a connector.
   * Refuses empty/invalid payloads so existing working credentials are never overwritten accidentally.
   */
  public async setCredential(
    connectorId: string,
    payload: Record<string, string>,
    requirement: CredentialRequirement,
    options: { isRotation?: boolean; customPool?: pg.Pool } = {}
  ): Promise<ConnectorCredentialStatus> {
    if (requirement.authType === 'none_open' && !requirement.required) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: connectorId,
        message: 'This connector uses an open API and does not accept credentials.',
      });
    }

    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(payload || {})) {
      if (typeof v === 'string' && v.trim().length > 0) {
        cleaned[k] = v.trim();
      }
    }

    for (const field of requirement.fields) {
      if (field.required && !cleaned[field.key]) {
        throw new ConnectorError({
          category: 'invalid_request',
          providerId: connectorId,
          message: `Missing required credential field "${field.label}". Existing credentials were preserved unchanged.`,
        });
      }
    }

    const primaryVal = cleaned[requirement.fields[0]?.key || 'apiKey'] || Object.values(cleaned)[0];
    const maskedHint = this.maskSecret(primaryVal);
    const encrypted = this.encryptPayload(cleaned, connectorId);
    const now = new Date().toISOString();

    const pool = this.getActivePool(options.customPool);
    if (!pool) {
      const prev = this.memoryStore.get(connectorId);
      this.memoryStore.set(connectorId, {
        connectorId,
        authType: requirement.authType,
        encryptedPayload: encrypted,
        status: 'configured',
        keyVersion: (prev?.keyVersion || 0) + 1,
        maskedHint,
        rotatedAt: options.isRotation || prev ? now : undefined,
        validationStatus: 'pending_validation',
        updatedAt: now,
      });
      return this.getCredentialStatus(connectorId, requirement, options.customPool);
    }

    const credId = `cred-${connectorId.replace(/^conn-/, '')}`;
    try {
      await pool.query(
        `INSERT INTO connector_credentials (
          id, connector_id, auth_type, encrypted_payload, status,
          key_version, masked_hint, rotated_at, validation_status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'configured', 1, $5, $6, 'pending_validation', NOW(), NOW())
        ON CONFLICT (connector_id) DO UPDATE SET
          auth_type = EXCLUDED.auth_type,
          encrypted_payload = EXCLUDED.encrypted_payload,
          status = 'configured',
          key_version = COALESCE(connector_credentials.key_version, 1) + 1,
          masked_hint = EXCLUDED.masked_hint,
          rotated_at = NOW(),
          validation_status = 'pending_validation',
          updated_at = NOW()`,
        [credId, connectorId, requirement.authType, encrypted, maskedHint || null, options.isRotation ? now : null]
      );
    } catch {
      // Fallback if Migration 004 columns aren't present yet
      await pool.query(
        `INSERT INTO connector_credentials (id, connector_id, auth_type, encrypted_payload, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'configured', NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           encrypted_payload = EXCLUDED.encrypted_payload,
           status = 'configured',
           updated_at = NOW()`,
        [credId, connectorId, requirement.authType, encrypted]
      );
    }

    return this.getCredentialStatus(connectorId, requirement, options.customPool);
  }

  public async removeCredential(
    connectorId: string,
    requirement: CredentialRequirement,
    customPool?: pg.Pool
  ): Promise<ConnectorCredentialStatus> {
    const pool = this.getActivePool(customPool);
    if (!pool) {
      this.memoryStore.delete(connectorId);
    } else {
      await pool.query(`DELETE FROM connector_credentials WHERE connector_id = $1`, [connectorId]);
    }
    return this.getCredentialStatus(connectorId, requirement, customPool);
  }

  public async recordValidationOutcome(
    connectorId: string,
    valid: boolean,
    validationStatus: string,
    customPool?: pg.Pool
  ): Promise<void> {
    const pool = this.getActivePool(customPool);
    const now = new Date().toISOString();
    if (!pool) {
      const mem = this.memoryStore.get(connectorId);
      if (mem) {
        mem.validatedAt = now;
        mem.validationStatus = validationStatus;
      }
      return;
    }

    try {
      await pool.query(
        `UPDATE connector_credentials
         SET validated_at = NOW(),
             validation_status = $2,
             status = CASE WHEN $3 = TRUE THEN 'configured' ELSE status END,
             updated_at = NOW()
         WHERE connector_id = $1`,
        [connectorId, redactSecrets(validationStatus).slice(0, 120), valid]
      );
    } catch {
      // Ignore gracefully if pre-004 schema
    }
  }
}

export const credentialManager = new CredentialManager();
