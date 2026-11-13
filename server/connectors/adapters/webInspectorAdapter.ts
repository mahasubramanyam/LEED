import { inspectWebsite, WebInspectionResult } from '../webInspector.js';
import { classifyConnectorError, ConnectorError } from '../core/errors.js';
import { connectorRegistry } from '../core/registry.js';
import {
  ClassifiedConnectorError,
  ConnectionValidationResult,
  ConnectorExecutionContext,
  ConnectorHealthReport,
  ConnectorLookupRequest,
  ConnectorLookupResponse,
  ConnectorMetadata,
  ConnectorRuntimeState,
  ConnectorSearchRequest,
  ConnectorSearchResponse,
  IConnector,
  StandardizedConnectorResult,
} from '../core/types.js';

const WEB_INSPECTOR_METADATA: ConnectorMetadata = {
  id: 'conn-web-inspector',
  name: 'Safe Website Inspector & SSRF Shield',
  shortName: 'Web Inspector',
  version: '4.0.0',
  sourceCategory: 'website_intelligence',
  accessMode: 'internal_crawler',
  description:
    'SSRF-protected direct HTTP inspection of candidate company websites. Blocks RFC 1918 / loopback / link-local IPs, enforces 300KB response limits, and extracts public contact points and social profiles.',
  supportedCountries: [],
  supportsAllCountries: true,
  supportsRegionFilter: false,
  supportsCityFilter: false,
  supportedIdentifierTypes: ['DOMAIN', 'EMAIL'],
  capabilities: ['website_inspection', 'contact_enrichment', 'connection_test'],
  credentialRequirements: {
    authType: 'none_open',
    required: false,
    fields: [],
    envFallbackKeys: [],
    setupInstructions: 'Built-in SSRF-hardened HTTP crawler. No external credentials required.',
  },
  executionPolicy: {
    timeoutMs: 7000,
    maxRetries: 1,
    baseBackoffMs: 300,
    maxBackoffMs: 2000,
    maxConcurrency: 4,
    rateLimit: {
      maxRequests: 30,
      windowMs: 60000,
      note: 'DNS pinning, private IP range blocking, 300KB response cap',
      waitOnLimit: false,
    },
    defaultPageSize: 1,
    maxPageSize: 1,
  },
  attribution: 'Direct HTTP Inspection via internal SSRF-protected crawler',
  license: 'Public Web Observation (Owner User-Agent Disclosed)',
};

export class WebInspectorConnector implements IConnector {
  public readonly id = 'conn-web-inspector';

  public getMetadata(): ConnectorMetadata {
    return WEB_INSPECTOR_METADATA;
  }

  public async validateConnection(_context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();

    // Verify SSRF guard actively blocks private loopback URLs without performing external network side effects
    const ssrfProbe = await inspectWebsite('http://127.0.0.1/health-probe');
    const latencyMs = Date.now() - start;

    if (ssrfProbe.securityCheck.passed) {
      return {
        ok: false,
        healthState: 'configuration_required',
        latencyMs,
        isLiveApi: false,
        errorCategory: 'configuration_error',
        message: 'SSRF protection self-check failed: loopback address was not blocked.',
        checkedAt,
      };
    }

    return {
      ok: true,
      healthState: 'operational',
      latencyMs,
      isLiveApi: true,
      message: 'SSRF-protected Web Inspector engine and private-IP shield verified.',
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
      message: 'Web Inspector requires a target URL via lookup/inspection rather than keyword company search.',
    });
  }

  public async lookupById(
    request: ConnectorLookupRequest,
    _context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const targetUrl = (request.url || request.externalId || '').trim();
    if (!targetUrl) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Target website URL is required for inspection.',
      });
    }

    const inspection = await inspectWebsite(targetUrl);
    const retrievedAt = new Date().toISOString();
    const normalized = this.normalizeResult(inspection, retrievedAt);

    if (!inspection.securityCheck.passed) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: inspection.securityCheck.reason || 'Website blocked by SSRF security check.',
      });
    }

    return {
      found: inspection.isOnline,
      result: normalized || undefined,
      attribution: WEB_INSPECTOR_METADATA.attribution,
      notes: inspection.securityCheck.reason ? [inspection.securityCheck.reason] : [],
      isLiveApi: true,
      providerMetadata: {
        inspection,
      },
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    const res = raw as WebInspectionResult;
    if (!res || !res.domain) return null;

    return {
      providerId: this.id,
      providerName: WEB_INSPECTOR_METADATA.name,
      sourceCategory: 'website_intelligence',
      accessMode: 'internal_crawler',
      countryCode: 'US',
      externalSourceId: res.domain,
      company: {
        companyName: res.title || res.domain,
        website: res.url,
        domain: res.domain,
        email: res.emailsFound?.[0],
        emailStatus: res.emailsFound?.[0] ? 'syntax_valid' : 'unavailable',
        phone: res.phonesFound?.[0],
        socialLinks: res.socialLinks,
        webMetadata: {
          title: res.title,
          description: res.description,
          httpStatus: res.httpStatus,
          isHttps: res.isHttps,
          serverLatencyMs: res.serverLatencyMs,
          inspectedAt: retrievedAt,
        },
        identifiers: [
          {
            type: 'DOMAIN',
            value: res.domain,
            source: this.id,
            status: res.isOnline ? 'syntax_validated' : 'discovered',
            verified: false,
          },
        ],
        rawSource: {
          sourceName: WEB_INSPECTOR_METADATA.name,
          providerId: res.domain,
          url: res.url,
          retrievedAt,
          attribution: WEB_INSPECTOR_METADATA.attribution,
        },
      },
      sourceUrl: res.url,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: retrievedAt,
        freshnessNote: 'Live HTTP website metadata inspection',
        isRealtime: true,
      },
      verificationStatus: res.isOnline ? 'web_observed' : 'unverified',
      confidence: {
        supported: false,
      },
      providerMetadata: {
        httpStatus: res.httpStatus,
        isHttps: res.isHttps,
        emailsFound: res.emailsFound,
        securityCheck: res.securityCheck,
      },
    };
  }

  public classifyError(error: unknown): ClassifiedConnectorError {
    return classifyConnectorError(error, this.id);
  }

  public getHealth(state: ConnectorRuntimeState): ConnectorHealthReport {
    return connectorRegistry.computeHealthReport(this, state);
  }
}
