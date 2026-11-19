// Phase 14: Controlled Server-Side AI Provider Abstraction (Google Gemini via @google/genai)
// Reuses existing server-side GEMINI_API_KEY configuration, never exposes secrets to clients,
// enforces model allowlists, redacts secrets on error, and provides honest fallback reporting.

import { GoogleGenAI } from '@google/genai';
import { ALLOWED_GEMINI_MODELS, DEFAULT_GEMINI_MODEL } from '../../shared/aiAgentSpecs.js';
import type { AiProviderStatus } from '../types.js';

export interface AiGenerationMeta {
  mode: 'ai_assisted' | 'deterministic_fallback';
  model: string;
  warning?: string;
}

export interface AiRawGenerateRequest {
  systemInstruction: string;
  prompt: string;
  jsonMode?: boolean;
  timeoutMs?: number;
}

export type AiTestGeneratorOverride = (
  req: AiRawGenerateRequest
) => Promise<string | null> | string | null;

let testGeneratorOverride: AiTestGeneratorOverride | null = null;
let testApiKeyOverride: string | null | undefined = undefined;

export function setAiGeneratorOverrideForTests(fn: AiTestGeneratorOverride | null): void {
  testGeneratorOverride = fn;
}

export function setAiApiKeyOverrideForTests(key: string | null | undefined): void {
  testApiKeyOverride = key;
}

export function resolveConfiguredApiKey(): string {
  if (testApiKeyOverride !== undefined) {
    return (testApiKeyOverride || '').trim();
  }
  return (process.env.GEMINI_API_KEY || '').trim();
}

export function resolveConfiguredModel(): string {
  const requested = (process.env.GEMINI_MODEL || '').trim();
  if (requested && (ALLOWED_GEMINI_MODELS as readonly string[]).includes(requested)) {
    return requested;
  }
  return DEFAULT_GEMINI_MODEL;
}

export function redactAiSecrets(message: string): string {
  if (!message) return 'AI provider error.';
  let cleaned = message;
  const activeKey = resolveConfiguredApiKey();
  if (activeKey && activeKey.length >= 6) {
    cleaned = cleaned.split(activeKey).join('[REDACTED_KEY]');
  }
  cleaned = cleaned
    .replace(/AIza[0-9A-Za-z_-]{16,}/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9]{16,}/g, '[REDACTED_KEY]')
    .replace(/(api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
  return cleaned.slice(0, 400);
}

export function getAiProviderStatus(): AiProviderStatus {
  const apiKey = resolveConfiguredApiKey();
  const configured = Boolean(apiKey || testGeneratorOverride);
  const model = resolveConfiguredModel();
  return {
    provider: 'gemini',
    configured,
    available: configured,
    model,
    mode: configured ? 'ai_assisted' : 'deterministic_fallback',
    warning: configured
      ? undefined
      : 'GEMINI_API_KEY is not configured in the server environment. Deterministic CRM intelligence (ICP matching, lead prioritization, daily briefing, structured reports, and action proposals) remains available.',
    capabilities: {
      conversationalAgent: true,
      companyIntelligence: true,
      icpMatching: true,
      leadPrioritization: true,
      dailyBriefingOnDemand: true,
      meetingPrep: true,
      messageDrafting: true,
      crmActionProposals: true,
      automatedBackgroundBriefingScheduler: false,
      automatedEmailOrMessageSending: false,
    },
    honestDisclosures: [
      'Daily Sales Briefing is generated on demand when requested; no background cron/email briefing scheduler is configured.',
      'Communication drafts are saved as draft_only for owner review; automated email, LinkedIn, or WhatsApp sending is disabled (Phase 15 scope).',
      'CRM modifications proposed by the AI Sales Agent require explicit owner approval before execution.',
      'Owner private notes are excluded from AI context unless explicitly authorized per request.',
    ],
  };
}

function getGenAiClient(): GoogleGenAI | null {
  const apiKey = resolveConfiguredApiKey();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`AI request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }
  return trimmed;
}

export async function generateStructuredJsonWithAi<T>(
  req: Omit<AiRawGenerateRequest, 'jsonMode'>
): Promise<{ data: T | null; meta: AiGenerationMeta }> {
  const model = resolveConfiguredModel();
  const timeoutMs = req.timeoutMs ?? 20000;

  if (testGeneratorOverride) {
    try {
      const raw = await withTimeout(
        Promise.resolve(testGeneratorOverride({ ...req, jsonMode: true })),
        timeoutMs
      );
      if (!raw) {
        return {
          data: null,
          meta: {
            mode: 'deterministic_fallback',
            model,
            warning: 'AI provider returned an empty response; deterministic CRM intelligence used.',
          },
        };
      }
      const parsed = JSON.parse(stripMarkdownFences(raw)) as T;
      return { data: parsed, meta: { mode: 'ai_assisted', model } };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        data: null,
        meta: {
          mode: 'deterministic_fallback',
          model,
          warning: `AI synthesis unavailable (${redactAiSecrets(msg)}); deterministic CRM analysis used.`,
        },
      };
    }
  }

  const client = getGenAiClient();
  if (!client) {
    return {
      data: null,
      meta: {
        mode: 'deterministic_fallback',
        model,
        warning:
          'GEMINI_API_KEY is not configured; returning deterministic CRM intelligence without AI prose synthesis.',
      },
    };
  }

  try {
    const response = await withTimeout(
      client.models.generateContent({
        model,
        contents: req.prompt,
        config: {
          systemInstruction: req.systemInstruction,
          responseMimeType: 'application/json',
        },
      }),
      timeoutMs
    );

    const text = response.text;
    if (!text || !text.trim()) {
      return {
        data: null,
        meta: {
          mode: 'deterministic_fallback',
          model,
          warning: 'Gemini returned an empty response; deterministic CRM intelligence used.',
        },
      };
    }

    const parsed = JSON.parse(stripMarkdownFences(text)) as T;
    return { data: parsed, meta: { mode: 'ai_assisted', model } };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      data: null,
      meta: {
        mode: 'deterministic_fallback',
        model,
        warning: `Gemini request failed (${redactAiSecrets(msg)}); deterministic CRM intelligence used.`,
      },
    };
  }
}

export async function generateAgentTextWithAi(
  req: Omit<AiRawGenerateRequest, 'jsonMode'>
): Promise<{ text: string | null; meta: AiGenerationMeta }> {
  const model = resolveConfiguredModel();
  const timeoutMs = req.timeoutMs ?? 20000;

  if (testGeneratorOverride) {
    try {
      const raw = await withTimeout(
        Promise.resolve(testGeneratorOverride({ ...req, jsonMode: false })),
        timeoutMs
      );
      if (!raw || !raw.trim()) {
        return {
          text: null,
          meta: {
            mode: 'deterministic_fallback',
            model,
            warning: 'AI provider returned empty text; deterministic CRM response used.',
          },
        };
      }
      return { text: raw.trim(), meta: { mode: 'ai_assisted', model } };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        text: null,
        meta: {
          mode: 'deterministic_fallback',
          model,
          warning: `AI synthesis unavailable (${redactAiSecrets(msg)}); deterministic CRM response used.`,
        },
      };
    }
  }

  const client = getGenAiClient();
  if (!client) {
    return {
      text: null,
      meta: {
        mode: 'deterministic_fallback',
        model,
        warning: 'GEMINI_API_KEY is not configured; returning deterministic evidence-grounded CRM response.',
      },
    };
  }

  try {
    const response = await withTimeout(
      client.models.generateContent({
        model,
        contents: req.prompt,
        config: {
          systemInstruction: req.systemInstruction,
        },
      }),
      timeoutMs
    );

    const text = response.text;
    if (!text || !text.trim()) {
      return {
        text: null,
        meta: {
          mode: 'deterministic_fallback',
          model,
          warning: 'Gemini returned an empty response; deterministic CRM response used.',
        },
      };
    }

    return { text: text.trim(), meta: { mode: 'ai_assisted', model } };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: null,
      meta: {
        mode: 'deterministic_fallback',
        model,
        warning: `Gemini request failed (${redactAiSecrets(msg)}); deterministic CRM response used.`,
      },
    };
  }
}
