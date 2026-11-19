// Phase 15: Controlled Server-Side Communication Provider Architecture
// Supports authorized HTTPS email APIs (Resend, SendGrid, Postmark, Mailgun) via server-side credentials
// stored in environment variables or AES-256-GCM encrypted CredentialManager vault.
// Enforces:
// - Zero simulated delivery when unconfigured
// - LinkedIn manual-only policy (never automates LinkedIn sending)
// - Fixed allowlisted HTTPS endpoints (zero arbitrary SSRF)
// - Per-provider rate limiting, idempotency keys, bounded retries on 429/5xx, and secret redaction

import {
  OUTREACH_PROVIDER_CATALOG,
  OUTREACH_PROVIDER_MAP,
  type OutreachProviderCatalogEntry,
} from '../../shared/outreachSpecs.js';
import type {
  OutreachChannelV2,
  OutreachProviderStatus,
  OutreachWorkspaceState,
} from '../types.js';
import type { CredentialManager } from '../connectors/core/credentialManager.js';
import type { CredentialRequirement } from '../connectors/core/types.js';
import { redactAiSecrets } from '../ai/aiProvider.js';

export function buildProviderCredentialRequirement(
  entryOrId: OutreachProviderCatalogEntry | string
): CredentialRequirement | null {
  const entry =
    typeof entryOrId === 'string' ? OUTREACH_PROVIDER_MAP.get(entryOrId) : entryOrId;
  if (!entry || !entry.automatedSendingSupported) return null;
  return {
    authType: 'api_key',
    required: true,
    envFallbackKeys: entry.envKeyNames,
    setupInstructions: `Configure ${entry.name} credentials via ${entry.envKeyNames.join(', ')} or encrypted LEED vault.`,
    fields: entry.requiredCredentialFields.map((f) => ({
      key: f.key,
      label: f.label,
      required: true,
      secret: f.secret,
      placeholder: f.placeholder,
    })),
  };
}

export interface ProviderSendPayload {
  providerId: string;
  fromEmail: string;
  fromName?: string;
  replyToEmail?: string;
  toEmail: string;
  toName?: string;
  subject: string;
  textBody: string;
  idempotencyKey: string;
}

export interface ProviderSendResponse {
  ok: boolean;
  httpStatus: number;
  providerMessageId?: string;
  deliveryStatus: 'sent' | 'queued' | 'bounced' | 'failed';
  retryable: boolean;
  summary: string;
  error?: string;
}

export type OutreachProviderTransport = (req: {
  providerId: string;
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}) => Promise<{ status: number; bodyText: string; headers?: Record<string, string> }>;

let testTransportOverride: OutreachProviderTransport | null = null;
let testCredentialEnvOverride: Record<string, string | undefined> | null = null;
let testRetryDelayMsOverride: number | null = null;

export function setOutreachProviderTransportForTests(fn: OutreachProviderTransport | null): void {
  testTransportOverride = fn;
}

export function setOutreachEnvOverrideForTests(env: Record<string, string | undefined> | null): void {
  testCredentialEnvOverride = env;
}

export function setOutreachRetryDelayForTests(ms: number | null): void {
  testRetryDelayMsOverride = ms;
}

function readEnvVar(name: string): string {
  if (testCredentialEnvOverride && name in testCredentialEnvOverride) {
    return (testCredentialEnvOverride[name] || '').trim();
  }
  return (process.env[name] || '').trim();
}

export function redactProviderSecrets(message: string, extraSecrets: string[] = []): string {
  let cleaned = redactAiSecrets(message || 'Provider error');
  for (const sec of extraSecrets) {
    if (sec && sec.length >= 6) {
      cleaned = cleaned.split(sec).join('[REDACTED_SECRET]');
    }
  }
  cleaned = cleaned
    .replace(/re_[A-Za-z0-9_-]{10,}/g, '[REDACTED_RESEND_KEY]')
    .replace(/SG\.[A-Za-z0-9._-]{12,}/g, '[REDACTED_SENDGRID_KEY]')
    .replace(/Basic\s+[A-Za-z0-9+/=]{10,}/gi, 'Basic [REDACTED]');
  return cleaned.slice(0, 400);
}

export interface ResolvedOutreachProviderCreds {
  configured: boolean;
  source: 'environment' | 'database_encrypted' | 'none';
  credentials: Record<string, string>;
  maskedHint?: string;
  knownSecrets: string[];
}

export async function resolveOutreachProviderCredentials(
  providerId: string,
  credentialManager?: CredentialManager
): Promise<ResolvedOutreachProviderCreds> {
  const entry = OUTREACH_PROVIDER_MAP.get(providerId);
  if (!entry || !entry.automatedSendingSupported) {
    return { configured: false, source: 'none', credentials: {}, knownSecrets: [] };
  }

  // 1. Check server-side environment variables
  if (providerId === 'comm-resend') {
    const apiKey = readEnvVar('RESEND_API_KEY');
    if (apiKey) {
      return {
        configured: true,
        source: 'environment',
        credentials: { apiKey },
        maskedHint: maskHint(apiKey),
        knownSecrets: [apiKey],
      };
    }
  } else if (providerId === 'comm-sendgrid') {
    const apiKey = readEnvVar('SENDGRID_API_KEY');
    if (apiKey) {
      return {
        configured: true,
        source: 'environment',
        credentials: { apiKey },
        maskedHint: maskHint(apiKey),
        knownSecrets: [apiKey],
      };
    }
  } else if (providerId === 'comm-postmark') {
    const serverToken = readEnvVar('POSTMARK_SERVER_TOKEN');
    if (serverToken) {
      return {
        configured: true,
        source: 'environment',
        credentials: { serverToken },
        maskedHint: maskHint(serverToken),
        knownSecrets: [serverToken],
      };
    }
  } else if (providerId === 'comm-mailgun') {
    const apiKey = readEnvVar('MAILGUN_API_KEY');
    const domain = readEnvVar('MAILGUN_DOMAIN');
    if (apiKey && domain) {
      return {
        configured: true,
        source: 'environment',
        credentials: { apiKey, domain },
        maskedHint: `${domain} (${maskHint(apiKey)})`,
        knownSecrets: [apiKey],
      };
    }
  }

  // 2. Check existing AES-256-GCM CredentialManager vault
  if (credentialManager) {
    const req = buildProviderCredentialRequirement(entry);
    if (req) {
      try {
        const resolved = await credentialManager.resolveCredentialForExecution(providerId, req);
        const hasAllRequired = entry.requiredCredentialFields.every((f) =>
          Boolean(resolved.credentials[f.key]?.trim())
        );
        if (hasAllRequired) {
          return {
            configured: true,
            source: resolved.source === 'environment' ? 'environment' : 'database_encrypted',
            credentials: resolved.credentials,
            maskedHint: resolved.maskedHint || maskHint(Object.values(resolved.credentials)[0]),
            knownSecrets: resolved.knownSecrets,
          };
        }
      } catch {
        // Encryption key missing or unreadable -> remain honestly unconfigured
      }
    }
  }

  return { configured: false, source: 'none', credentials: {}, knownSecrets: [] };
}

function maskHint(secret?: string): string | undefined {
  if (!secret) return undefined;
  const trimmed = secret.trim();
  if (trimmed.length <= 6) return '••••••';
  return `••••${trimmed.slice(-4)}`;
}

export async function listOutreachProviderStatuses(
  ws: OutreachWorkspaceState,
  credentialManager?: CredentialManager
): Promise<OutreachProviderStatus[]> {
  const fromEmail = (ws.providerSettings.fromEmail || readEnvVar('OUTREACH_FROM_EMAIL') || '').trim();
  const fromEmailConfigured = Boolean(fromEmail && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(fromEmail));
  const nowMs = Date.now();

  const statuses: OutreachProviderStatus[] = [];

  for (const entry of OUTREACH_PROVIDER_CATALOG) {
    const telemetry = ws.providerTelemetry[entry.id];
    const windowValid = telemetry && nowMs - telemetry.windowStartMs < 3_600_000;
    const sentInCurrentHour = windowValid ? telemetry.sentInWindow : 0;
    const rateLimitPerHour =
      ws.providerSettings.rateLimitPerHourByProvider[entry.id] ?? entry.defaultRateLimitPerHour;

    if (!entry.automatedSendingSupported) {
      statuses.push({
        id: entry.id,
        name: entry.name,
        channel: entry.channel,
        automatedSendingSupported: false,
        inboundSyncSupported: false,
        configured: false,
        credentialSource: 'none',
        fromEmailConfigured: false,
        healthState: 'policy_manual_only',
        rateLimitPerHour: 0,
        sentInCurrentHour: 0,
        honestDisclosure: entry.description,
        docsUrl: entry.docsUrl || undefined,
        requiredCredentialFields: entry.requiredCredentialFields,
      });
      continue;
    }

    const creds = await resolveOutreachProviderCredentials(entry.id, credentialManager);
    const isRateLimited = rateLimitPerHour > 0 && sentInCurrentHour >= rateLimitPerHour;

    let healthState: OutreachProviderStatus['healthState'] = 'unconfigured';
    let honestDisclosure =
      'Credentials not configured. LEED remains in draft and approval-ready mode; no messages will be simulated as sent.';

    if (creds.configured) {
      if (!fromEmailConfigured) {
        healthState = 'degraded';
        honestDisclosure =
          'Provider API key is configured, but a verified sender From Email (OUTREACH_FROM_EMAIL or Provider Settings) is required before sending.';
      } else if (isRateLimited) {
        healthState = 'rate_limited';
        honestDisclosure = `Hourly rate limit reached (${sentInCurrentHour}/${rateLimitPerHour}). Sending will resume in the next hourly window.`;
      } else {
        healthState = 'operational';
        honestDisclosure = `Ready for explicit owner-approved email delivery via ${entry.endpointHost}. Inbound reply sync is not automated; record replies manually.`;
      }
    }

    statuses.push({
      id: entry.id,
      name: entry.name,
      channel: entry.channel,
      automatedSendingSupported: true,
      inboundSyncSupported: false,
      configured: creds.configured,
      credentialSource: creds.source,
      maskedHint: creds.maskedHint,
      fromEmailConfigured,
      fromEmail: fromEmailConfigured ? fromEmail : undefined,
      healthState,
      rateLimitPerHour,
      sentInCurrentHour,
      honestDisclosure,
      docsUrl: entry.docsUrl,
      requiredCredentialFields: entry.requiredCredentialFields,
      lastSuccessAt: telemetry?.lastSuccessAt,
      lastError: telemetry?.lastError,
    });
  }

  return statuses;
}

export async function selectConfiguredEmailProvider(
  ws: OutreachWorkspaceState,
  requestedProviderId?: string,
  credentialManager?: CredentialManager
): Promise<{
  provider?: OutreachProviderCatalogEntry;
  creds?: ResolvedOutreachProviderCreds;
  error?: string;
}> {
  const candidates: string[] = [];
  if (requestedProviderId && OUTREACH_PROVIDER_MAP.has(requestedProviderId)) {
    candidates.push(requestedProviderId);
  }
  if (
    ws.providerSettings.defaultEmailProviderId &&
    !candidates.includes(ws.providerSettings.defaultEmailProviderId)
  ) {
    candidates.push(ws.providerSettings.defaultEmailProviderId);
  }
  for (const entry of OUTREACH_PROVIDER_CATALOG) {
    if (entry.channel === 'email' && entry.automatedSendingSupported && !candidates.includes(entry.id)) {
      candidates.push(entry.id);
    }
  }

  for (const id of candidates) {
    const entry = OUTREACH_PROVIDER_MAP.get(id);
    if (!entry || entry.channel !== 'email' || !entry.automatedSendingSupported) continue;
    const creds = await resolveOutreachProviderCredentials(id, credentialManager);
    if (creds.configured) {
      return { provider: entry, creds };
    }
  }

  return {
    error:
      'No authorized email sending provider is configured. Configure Resend, SendGrid, Postmark, or Mailgun credentials in Providers & Health (or server environment) before automated dispatch, or record a manual external send.',
  };
}

function buildProviderHttpRequest(
  providerId: string,
  creds: Record<string, string>,
  payload: ProviderSendPayload
): { url: string; headers: Record<string, string>; body: string } {
  const formattedFrom = payload.fromName
    ? `${payload.fromName} <${payload.fromEmail}>`
    : payload.fromEmail;

  if (providerId === 'comm-resend') {
    const bodyObj: Record<string, unknown> = {
      from: formattedFrom,
      to: [payload.toEmail],
      subject: payload.subject,
      text: payload.textBody,
    };
    if (payload.replyToEmail) bodyObj.reply_to = payload.replyToEmail;
    return {
      url: 'https://api.resend.com/emails',
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': payload.idempotencyKey,
        'User-Agent': 'LEED-Outreach/1.0',
      },
      body: JSON.stringify(bodyObj),
    };
  }

  if (providerId === 'comm-sendgrid') {
    const bodyObj: Record<string, unknown> = {
      personalizations: [
        {
          to: [{ email: payload.toEmail, ...(payload.toName ? { name: payload.toName } : {}) }],
          custom_args: { leed_idempotency_key: payload.idempotencyKey },
        },
      ],
      from: { email: payload.fromEmail, ...(payload.fromName ? { name: payload.fromName } : {}) },
      subject: payload.subject,
      content: [{ type: 'text/plain', value: payload.textBody }],
    };
    if (payload.replyToEmail) bodyObj.reply_to = { email: payload.replyToEmail };
    return {
      url: 'https://api.sendgrid.com/v3/mail/send',
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'LEED-Outreach/1.0',
      },
      body: JSON.stringify(bodyObj),
    };
  }

  if (providerId === 'comm-postmark') {
    const bodyObj: Record<string, unknown> = {
      From: formattedFrom,
      To: payload.toEmail,
      Subject: payload.subject,
      TextBody: payload.textBody,
      MessageStream: 'outbound',
      Metadata: { leed_idempotency_key: payload.idempotencyKey },
    };
    if (payload.replyToEmail) bodyObj.ReplyTo = payload.replyToEmail;
    return {
      url: 'https://api.postmarkapp.com/email',
      headers: {
        'X-Postmark-Server-Token': creds.serverToken,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'LEED-Outreach/1.0',
      },
      body: JSON.stringify(bodyObj),
    };
  }

  if (providerId === 'comm-mailgun') {
    const domain = (creds.domain || '').replace(/[^a-zA-Z0-9.-]/g, '');
    if (!domain) {
      throw new Error('Mailgun sending domain is missing or invalid.');
    }
    const form = new URLSearchParams();
    form.set('from', formattedFrom);
    form.set('to', payload.toEmail);
    form.set('subject', payload.subject);
    form.set('text', payload.textBody);
    form.set('v:leed_idempotency_key', payload.idempotencyKey);
    if (payload.replyToEmail) form.set('h:Reply-To', payload.replyToEmail);
    const basic = Buffer.from(`api:${creds.apiKey}`).toString('base64');
    return {
      url: `https://api.mailgun.net/v3/${domain}/messages`,
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'LEED-Outreach/1.0',
      },
      body: form.toString(),
    };
  }

  throw new Error(`Unsupported email sending provider: ${providerId}`);
}

async function executeHttpPost(req: {
  providerId: string;
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}): Promise<{ status: number; bodyText: string; headers?: Record<string, string> }> {
  if (testTransportOverride) {
    return testTransportOverride(req);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });
    const bodyText = await resp.text();
    const headersObj: Record<string, string> = {};
    resp.headers.forEach((v, k) => {
      headersObj[k.toLowerCase()] = v;
    });
    return { status: resp.status, bodyText, headers: headersObj };
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function dispatchViaAuthorizedEmailProvider(params: {
  ws: OutreachWorkspaceState;
  providerId?: string;
  payload: Omit<ProviderSendPayload, 'providerId' | 'fromEmail' | 'fromName' | 'replyToEmail'>;
  credentialManager?: CredentialManager;
}): Promise<{
  response: ProviderSendResponse;
  providerId?: string;
  providerName?: string;
  attempts: number;
}> {
  const { ws, credentialManager } = params;
  const fromEmail = (ws.providerSettings.fromEmail || readEnvVar('OUTREACH_FROM_EMAIL') || '').trim();
  const fromName = (ws.providerSettings.fromName || readEnvVar('OUTREACH_FROM_NAME') || '').trim();
  const replyToEmail = (ws.providerSettings.replyToEmail || '').trim() || undefined;

  const selected = await selectConfiguredEmailProvider(ws, params.providerId, credentialManager);
  if (!selected.provider || !selected.creds) {
    return {
      attempts: 0,
      response: {
        ok: false,
        httpStatus: 422,
        deliveryStatus: 'failed',
        retryable: false,
        summary: 'Provider not configured.',
        error: selected.error || 'No authorized email provider configured.',
      },
    };
  }

  if (!fromEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(fromEmail)) {
    return {
      attempts: 0,
      providerId: selected.provider.id,
      providerName: selected.provider.name,
      response: {
        ok: false,
        httpStatus: 422,
        deliveryStatus: 'failed',
        retryable: false,
        summary: 'Sender From Email not configured.',
        error:
          'Configure a verified sender From Email in Outreach Provider Settings or OUTREACH_FROM_EMAIL before dispatching.',
      },
    };
  }

  const providerId = selected.provider.id;
  const nowMs = Date.now();
  const existingTel = ws.providerTelemetry[providerId];
  const windowActive = existingTel && nowMs - existingTel.windowStartMs < 3_600_000;
  const currentSent = windowActive ? existingTel.sentInWindow : 0;
  const hourlyLimit =
    ws.providerSettings.rateLimitPerHourByProvider[providerId] ?? selected.provider.defaultRateLimitPerHour;

  if (hourlyLimit > 0 && currentSent >= hourlyLimit) {
    return {
      attempts: 0,
      providerId,
      providerName: selected.provider.name,
      response: {
        ok: false,
        httpStatus: 429,
        deliveryStatus: 'failed',
        retryable: true,
        summary: 'Hourly provider rate limit exceeded.',
        error: `Provider ${selected.provider.name} reached its hourly sending limit (${currentSent}/${hourlyLimit}).`,
      },
    };
  }

  const fullPayload: ProviderSendPayload = {
    ...params.payload,
    providerId,
    fromEmail,
    fromName: fromName || undefined,
    replyToEmail,
  };

  const httpReq = buildProviderHttpRequest(providerId, selected.creds.credentials, fullPayload);
  const maxRetries = Math.min(3, Math.max(0, ws.providerSettings.maxRetries ?? 2));
  let attempts = 0;
  let lastResp: ProviderSendResponse = {
    ok: false,
    httpStatus: 500,
    deliveryStatus: 'failed',
    retryable: false,
    summary: 'Unknown dispatch error.',
    error: 'Dispatch did not complete.',
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;
    try {
      const res = await executeHttpPost({
        providerId,
        url: httpReq.url,
        method: 'POST',
        headers: httpReq.headers,
        body: httpReq.body,
      });

      if (res.status >= 200 && res.status < 300) {
        let providerMsgId: string | undefined;
        try {
          const parsed = res.bodyText ? JSON.parse(res.bodyText) : {};
          providerMsgId =
            parsed.id || parsed.MessageID || parsed.message_id || res.headers?.['x-message-id'];
        } catch {
          providerMsgId = res.headers?.['x-message-id'];
        }

        ws.providerTelemetry[providerId] = {
          windowStartMs: windowActive ? existingTel.windowStartMs : nowMs,
          sentInWindow: currentSent + 1,
          lastSuccessAt: new Date().toISOString(),
          lastError: undefined,
        };

        return {
          attempts,
          providerId,
          providerName: selected.provider.name,
          response: {
            ok: true,
            httpStatus: res.status,
            providerMessageId: providerMsgId || `${providerId}-accepted-${Date.now()}`,
            deliveryStatus: 'sent',
            retryable: false,
            summary: `Accepted by ${selected.provider.name} (HTTP ${res.status}).`,
          },
        };
      }

      const retryable = res.status === 429 || res.status >= 500;
      const sanitizedErr = redactProviderSecrets(
        `Provider ${selected.provider.name} returned HTTP ${res.status}: ${res.bodyText.slice(0, 220)}`,
        selected.creds.knownSecrets
      );

      lastResp = {
        ok: false,
        httpStatus: res.status,
        deliveryStatus: res.status === 400 || res.status === 422 ? 'bounced' : 'failed',
        retryable,
        summary: `Rejected by ${selected.provider.name} (HTTP ${res.status}).`,
        error: sanitizedErr,
      };

      if (!retryable || attempt === maxRetries) {
        break;
      }

      const delay = testRetryDelayMsOverride !== null ? testRetryDelayMsOverride : 250 * Math.pow(2, attempt);
      if (delay > 0) await sleep(delay);
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const sanitizedErr = redactProviderSecrets(rawMsg, selected.creds.knownSecrets);
      lastResp = {
        ok: false,
        httpStatus: 503,
        deliveryStatus: 'failed',
        retryable: true,
        summary: `Network or transport error calling ${selected.provider.name}.`,
        error: sanitizedErr,
      };
      if (attempt === maxRetries) break;
      const delay = testRetryDelayMsOverride !== null ? testRetryDelayMsOverride : 250 * Math.pow(2, attempt);
      if (delay > 0) await sleep(delay);
    }
  }

  ws.providerTelemetry[providerId] = {
    windowStartMs: windowActive ? existingTel.windowStartMs : nowMs,
    sentInWindow: currentSent,
    lastSuccessAt: existingTel?.lastSuccessAt,
    lastError: lastResp.error,
  };

  return {
    attempts,
    providerId,
    providerName: selected.provider.name,
    response: lastResp,
  };
}

export function isChannelAutomatedSendingAllowed(channel: OutreachChannelV2): boolean {
  return channel === 'email';
}
