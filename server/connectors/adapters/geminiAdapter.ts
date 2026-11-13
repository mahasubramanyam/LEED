import { classifyConnectorError, ConnectorError } from '../core/errors.js';
import { connectorRegistry } from '../core/registry.js';
import {
  ClassifiedConnectorError,
  ConnectionValidationResult,
  ConnectorExecutionContext,
  ConnectorHealthReport,
  ConnectorMetadata,
  ConnectorRuntimeState,
  ConnectorSearchRequest,
  ConnectorSearchResponse,
  IConnector,
  StandardizedConnectorResult,
} from '../core/types.js';

const GEMINI_METADATA: ConnectorMetadata = {
  id: 'conn-gemini',
  name: 'Gemini AI Sales & Intelligence Engine',
  shortName: 'Gemini AI Engine',
  version: '4.0.0',
  sourceCategory: 'ai_engine',
  accessMode: 'ai_inference',
  description:
    'Server-side Google GenAI engine powering lead qualification analysis, sales pitch drafting, meeting briefs, and regional market reports with deterministic fallback when unconfigured.',
  supportedCountries: [],
  supportsAllCountries: true,
  supportsRegionFilter: false,
  supportsCityFilter: false,
  supportedIdentifierTypes: [],
  capabilities: ['ai_analysis', 'connection_test'],
  credentialRequirements: {
    authType: 'environment',
    required: true,
    fields: [
      {
        key: 'apiKey',
        label: 'Gemini API Key',
        required: true,
        secret: true,
        placeholder: 'AIza...',
        helpText: 'Server-side GEMINI_API_KEY (or owner-managed encrypted key)',
      },
    ],
    envFallbackKeys: ['GEMINI_API_KEY'],
    setupInstructions:
      'Provide GEMINI_API_KEY in the server environment or configure an encrypted key in the Connectors Hub.',
  },
  executionPolicy: {
    timeoutMs: 15000,
    maxRetries: 1,
    baseBackoffMs: 500,
    maxBackoffMs: 3000,
    maxConcurrency: 3,
    rateLimit: {
      maxRequests: 30,
      windowMs: 60000,
      note: 'gemini-3.8-flash server-side inference with deterministic factual fallback',
      waitOnLimit: false,
    },
    defaultPageSize: 1,
    maxPageSize: 1,
  },
  attribution: 'Google GenAI SDK',
  license: 'Proprietary Server-Side AI Inference',
};

export class GeminiConnector implements IConnector {
  public readonly id = 'conn-gemini';

  public getMetadata(): ConnectorMetadata {
    return GEMINI_METADATA;
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    const apiKey = context.credentials.apiKey?.trim();

    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return {
        ok: false,
        healthState: 'authentication_required',
        latencyMs: Date.now() - start,
        isLiveApi: false,
        errorCategory: 'missing_credentials',
        message:
          'GEMINI_API_KEY is not configured. AI endpoints automatically fall back to deterministic pipeline briefs until a valid key is provided.',
        checkedAt,
      };
    }

    if (apiKey.length < 20) {
      return {
        ok: false,
        healthState: 'authentication_required',
        latencyMs: Date.now() - start,
        isLiveApi: false,
        errorCategory: 'authentication_failure',
        message: 'Configured Gemini API key appears invalid (unexpected format/length).',
        checkedAt,
      };
    }

    return {
      ok: true,
      healthState: 'operational',
      latencyMs: Date.now() - start,
      isLiveApi: true,
      message: `Gemini AI credentials present (${context.credentialSource}) and ready for server-side inference.`,
      checkedAt,
    };
  }

  public async search(
    _request: ConnectorSearchRequest,
    _context: ConnectorExecutionContext
  ): Promise<ConnectorSearchResponse> {
    throw new ConnectorError({
      category: 'unsupported_capability',
      providerId: this.id,
      retryable: false,
      message: 'Gemini AI Engine provides AI analysis and sales copy synthesis, not external company registry search.',
    });
  }

  public normalizeResult(_raw: unknown, _retrievedAt: string): StandardizedConnectorResult | null {
    return null;
  }

  public classifyError(error: unknown): ClassifiedConnectorError {
    return classifyConnectorError(error, this.id);
  }

  public getHealth(state: ConnectorRuntimeState): ConnectorHealthReport {
    return connectorRegistry.computeHealthReport(this, state);
  }
}
