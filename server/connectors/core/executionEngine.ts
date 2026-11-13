import { classifyConnectorError, ConnectorError, redactSecrets } from './errors.js';
import { normalizeConnectorResults, NormalizationBatchSummary } from './normalizer.js';
import {
  ClassifiedConnectorError,
  ConnectionValidationResult,
  ConnectorConfigRecord,
  ConnectorErrorCategory,
  ConnectorExecutionContext,
  ConnectorLookupRequest,
  ConnectorLookupResponse,
  ConnectorRunRecord,
  ConnectorSearchRequest,
  ConnectorSearchResponse,
  IConnector,
} from './types.js';
import { CredentialManager, credentialManager as defaultCredentialManager } from './credentialManager.js';

export type RunRecorderFn = (run: ConnectorRunRecord) => Promise<void>;

export interface ExecuteSearchOptions {
  config?: ConnectorConfigRecord;
  userAgent?: string;
  signal?: AbortSignal;
  requestId?: string;
  onRecordRun?: RunRecorderFn;
}

export interface ExecutedSearchOutcome {
  response: ConnectorSearchResponse;
  normalization: NormalizationBatchSummary;
  runRecord: ConnectorRunRecord;
}

interface RateBucketState {
  timestamps: number[];
  resetAt?: number;
}

export class ConnectorExecutionEngine {
  private inflightConcurrency = new Map<string, number>();
  private rateBuckets = new Map<string, RateBucketState>();
  private inflightDedupes = new Map<string, Promise<unknown>>();
  private activeControllers = new Map<string, AbortController>();
  private defaultRunRecorder?: RunRecorderFn;
  private credManager: CredentialManager;

  constructor(credManager: CredentialManager = defaultCredentialManager) {
    this.credManager = credManager;
  }

  public setDefaultRunRecorder(recorder: RunRecorderFn): void {
    this.defaultRunRecorder = recorder;
  }

  public getActiveRequestIds(): string[] {
    return Array.from(this.activeControllers.keys());
  }

  public cancelExecution(requestId: string): boolean {
    const controller = this.activeControllers.get(requestId);
    if (!controller) return false;
    controller.abort(new Error(`Execution ${requestId} cancelled by operator`));
    this.activeControllers.delete(requestId);
    return true;
  }

  public getRateLimitSnapshot(connector: IConnector, config?: ConnectorConfigRecord): {
    limit: number;
    remaining: number;
    windowMs: number;
    resetAt?: string;
  } {
    const policy = connector.getMetadata().executionPolicy.rateLimit;
    const limit = config?.rateLimitMax ?? policy.maxRequests;
    const windowMs = config?.rateLimitWindowMs ?? policy.windowMs;
    const now = Date.now();
    const bucket = this.rateBuckets.get(connector.id);
    if (!bucket) {
      return { limit, remaining: limit, windowMs };
    }
    const recent = bucket.timestamps.filter((t) => now - t < windowMs);
    bucket.timestamps = recent;
    const remaining = Math.max(0, limit - recent.length);
    const oldest = recent[0];
    const resetAt = oldest ? new Date(oldest + windowMs).toISOString() : undefined;
    return { limit, remaining, windowMs, resetAt };
  }

  private async acquireRateLimitSlot(
    connector: IConnector,
    config: ConnectorConfigRecord,
    signal: AbortSignal
  ): Promise<void> {
    const policy = connector.getMetadata().executionPolicy.rateLimit;
    const maxRequests = config.rateLimitMax ?? policy.maxRequests;
    const windowMs = config.rateLimitWindowMs ?? policy.windowMs;

    if (maxRequests <= 0 || windowMs <= 0) return;

    while (true) {
      if (signal.aborted) {
        throw new ConnectorError({
          category: 'timeout',
          providerId: connector.id,
          message: 'Request aborted while waiting for rate limit slot',
          retryable: false,
        });
      }

      const now = Date.now();
      let bucket = this.rateBuckets.get(connector.id);
      if (!bucket) {
        bucket = { timestamps: [] };
        this.rateBuckets.set(connector.id, bucket);
      }

      bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
      if (bucket.timestamps.length < maxRequests) {
        bucket.timestamps.push(now);
        return;
      }

      const oldest = bucket.timestamps[0];
      const waitMs = Math.max(50, oldest + windowMs - now);

      if (policy.waitOnLimit) {
        await this.sleepWithSignal(waitMs, signal);
        continue;
      }

      throw new ConnectorError({
        category: 'rate_limited',
        providerId: connector.id,
        httpStatus: 429,
        retryable: false,
        retryAfterMs: waitMs,
        message: `${connector.getMetadata().name} rate limit reached (${maxRequests} req / ${Math.round(windowMs / 1000)}s). Retry after ${Math.ceil(waitMs / 1000)}s.`,
        remediationHint: 'Wait for the rate-limit window to reset before dispatching additional queries.',
      });
    }
  }

  private async acquireConcurrencySlot(connector: IConnector, signal: AbortSignal): Promise<() => void> {
    const maxConcurrency = Math.max(1, connector.getMetadata().executionPolicy.maxConcurrency);
    let current = this.inflightConcurrency.get(connector.id) || 0;

    // Wait briefly if queue is full, up to 3 seconds, before rejecting cleanly
    const deadline = Date.now() + 3000;
    while (current >= maxConcurrency) {
      if (signal.aborted || Date.now() >= deadline) {
        throw new ConnectorError({
          category: 'rate_limited',
          providerId: connector.id,
          retryable: false,
          message: `${connector.getMetadata().name} concurrency limit (${maxConcurrency}) reached.`,
        });
      }
      await this.sleepWithSignal(50, signal);
      current = this.inflightConcurrency.get(connector.id) || 0;
    }

    this.inflightConcurrency.set(connector.id, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const nowCount = this.inflightConcurrency.get(connector.id) || 1;
      this.inflightConcurrency.set(connector.id, Math.max(0, nowCount - 1));
    };
  }

  private sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Aborted'));
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private computeBackoffMs(attempt: number, baseMs: number, maxMs: number): number {
    const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt));
    const jitter = Math.floor(Math.random() * Math.max(25, Math.round(exp * 0.3)));
    return Math.min(maxMs, exp + jitter);
  }

  private linkSignals(outerSignal: AbortSignal | undefined, timeoutMs: number): {
    controller: AbortController;
    cleanup: () => void;
    didTimeout: () => boolean;
  } {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onOuterAbort = () => {
      controller.abort(outerSignal?.reason || new Error('Cancelled by caller'));
    };
    if (outerSignal) {
      if (outerSignal.aborted) {
        onOuterAbort();
      } else {
        outerSignal.addEventListener('abort', onOuterAbort, { once: true });
      }
    }

    return {
      controller,
      didTimeout: () => timedOut,
      cleanup: () => {
        clearTimeout(timer);
        if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);
      },
    };
  }

  private async runWithRetries<T>(
    connector: IConnector,
    config: ConnectorConfigRecord,
    userAgent: string,
    outerSignal: AbortSignal | undefined,
    requestId: string,
    knownSecretsOut: string[],
    fn: (ctx: ConnectorExecutionContext) => Promise<T>
  ): Promise<T> {
    const meta = connector.getMetadata();
    const policy = meta.executionPolicy;
    const timeoutMs = config.timeoutMs ?? policy.timeoutMs;
    const maxRetries = Math.max(0, config.maxRetries ?? policy.maxRetries);

    if (!config.enabled) {
      throw new ConnectorError({
        category: 'configuration_error',
        providerId: connector.id,
        retryable: false,
        message: `${meta.name} is currently disabled by owner configuration.`,
        remediationHint: 'Enable this connector in the Connectors Hub or Owner Control Centre.',
      });
    }

    const credResolved = await this.credManager.resolveCredentialForExecution(
      connector.id,
      meta.credentialRequirements
    );
    knownSecretsOut.push(...credResolved.knownSecrets);

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (outerSignal?.aborted) {
        throw new ConnectorError({
          category: 'timeout',
          providerId: connector.id,
          retryable: false,
          message: `${meta.name} request was cancelled.`,
        });
      }

      const releaseSlot = await this.acquireConcurrencySlot(connector, outerSignal || new AbortController().signal);
      const { controller, cleanup, didTimeout } = this.linkSignals(outerSignal, timeoutMs);
      this.activeControllers.set(requestId, controller);

      try {
        await this.acquireRateLimitSlot(connector, config, controller.signal);

        const context: ConnectorExecutionContext = {
          requestId,
          signal: controller.signal,
          credentials: credResolved.credentials,
          credentialSource: credResolved.source,
          config,
          userAgent,
          timeoutMs,
        };

        const result = await fn(context);
        return result;
      } catch (err: unknown) {
        lastError = err;
        let classified: ClassifiedConnectorError;
        if (didTimeout()) {
          classified = {
            category: 'timeout',
            retryable: true,
            safeMessage: `${meta.name} request timed out after ${timeoutMs}ms`,
            remediationHint: 'Increase connector timeout or verify upstream provider health.',
          };
        } else if (outerSignal?.aborted) {
          throw new ConnectorError({
            category: 'timeout',
            providerId: connector.id,
            retryable: false,
            message: `${meta.name} request cancelled.`,
          });
        } else {
          classified = connector.classifyError(err);
          classified = {
            ...classified,
            safeMessage: redactSecrets(classified.safeMessage, knownSecretsOut),
          };
        }

        const shouldRetry = classified.retryable && attempt < maxRetries && !outerSignal?.aborted;
        if (!shouldRetry) {
          if (err instanceof ConnectorError) throw err;
          throw new ConnectorError({
            category: classified.category,
            providerId: connector.id,
            httpStatus: classified.httpStatus,
            retryable: classified.retryable,
            message: classified.safeMessage,
            remediationHint: classified.remediationHint,
            knownSecrets: knownSecretsOut,
          });
        }

        const delayMs = this.computeBackoffMs(attempt, policy.baseBackoffMs, policy.maxBackoffMs);
        await this.sleepWithSignal(delayMs, outerSignal || new AbortController().signal);
      } finally {
        cleanup();
        this.activeControllers.delete(requestId);
        releaseSlot();
      }
    }

    throw lastError;
  }

  private async persistRun(run: ConnectorRunRecord, customRecorder?: RunRecorderFn): Promise<void> {
    const recorder = customRecorder || this.defaultRunRecorder;
    if (!recorder) return;
    try {
      await recorder(run);
    } catch (err) {
      console.warn('[ExecutionEngine] Failed to persist connector run:', err);
    }
  }

  public async executeSearch(
    connector: IConnector,
    request: ConnectorSearchRequest,
    options: ExecuteSearchOptions = {}
  ): Promise<ExecutedSearchOutcome> {
    const meta = connector.getMetadata();
    const config: ConnectorConfigRecord = options.config || {
      connectorId: connector.id,
      enabled: true,
    };
    const userAgent = options.userAgent || 'GlobalLeadPipeline/1.0 (contact@internal-pipeline.local)';
    const requestId = options.requestId || `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const knownSecrets: string[] = [];

    // Validate country compatibility if specified and connector does not support all countries
    const reqCountry = request.countryCode?.trim().toUpperCase();
    if (
      reqCountry &&
      reqCountry !== 'GLOBAL' &&
      !meta.supportsAllCountries &&
      !meta.supportedCountries.includes(reqCountry)
    ) {
      const err = new ConnectorError({
        category: 'unsupported_country',
        providerId: connector.id,
        retryable: false,
        message: `${meta.name} does not support country "${reqCountry}". Supported: ${meta.supportedCountries.join(', ')}.`,
      });
      await this.persistRun(
        {
          id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          connectorId: connector.id,
          operation: 'search',
          queryParams: { query: request.query, countryCode: reqCountry },
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs,
          status: 'error',
          recordsDiscovered: 0,
          recordsNormalized: 0,
          recordsRejected: 0,
          errorCategory: 'unsupported_country',
          diagnosticSummary: err.safeMessage,
          requestId,
        },
        options.onRecordRun
      );
      throw err;
    }

    const executeCore = async (): Promise<ExecutedSearchOutcome> => {
      try {
        const allResults: ConnectorSearchResponse['results'] = [];
        const seenExternalIds = new Set<string>();
        const notes: string[] = [];
        let attribution = meta.attribution;
        let isLiveApi = meta.accessMode === 'live_api';
        let rawCount = 0;
        let currentPage = Math.max(1, request.page || 1);
        const pageSize = Math.min(
          meta.executionPolicy.maxPageSize,
          Math.max(1, request.pageSize || meta.executionPolicy.defaultPageSize)
        );
        let nextCursor = request.cursor;
        const maxPages = request.fetchAllPages ? Math.max(1, Math.min(5, request.maxPages || 3)) : 1;
        let lastPagination: ConnectorSearchResponse['pagination'] = {
          page: currentPage,
          pageSize,
          hasMore: false,
        };
        let providerMetadata: Record<string, unknown> | undefined;

        for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
          const pageRequest: ConnectorSearchRequest = {
            ...request,
            page: currentPage,
            pageSize,
            cursor: nextCursor,
          };

          const pageRes = await this.runWithRetries(
            connector,
            config,
            userAgent,
            options.signal,
            requestId,
            knownSecrets,
            (ctx) => connector.search(pageRequest, ctx)
          );

          attribution = pageRes.attribution || attribution;
          isLiveApi = pageRes.isLiveApi;
          rawCount += pageRes.rawCount;
          providerMetadata = pageRes.providerMetadata;
          for (const n of pageRes.notes || []) {
            if (!notes.includes(n)) notes.push(n);
          }

          for (const item of pageRes.results) {
            if (!seenExternalIds.has(item.externalSourceId)) {
              seenExternalIds.add(item.externalSourceId);
              allResults.push(item);
            }
          }

          lastPagination = pageRes.pagination;
          if (!pageRes.pagination.hasMore || !request.fetchAllPages) {
            break;
          }
          if (pageRes.pagination.nextCursor) {
            nextCursor = pageRes.pagination.nextCursor;
          }
          currentPage += 1;
        }

        const normalization = normalizeConnectorResults(allResults);
        const rl = this.getRateLimitSnapshot(connector, config);
        const runRecord: ConnectorRunRecord = {
          id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          connectorId: connector.id,
          operation: 'search',
          queryParams: {
            query: request.query,
            countryCode: reqCountry,
            city: request.city,
            page: request.page || 1,
          },
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs,
          status: 'success',
          recordsDiscovered: normalization.discovered,
          recordsNormalized: normalization.normalized,
          recordsRejected: normalization.rejected,
          diagnosticSummary: `Discovered ${normalization.discovered}, normalized ${normalization.normalized}${
            normalization.rejected > 0 ? `, rejected ${normalization.rejected}` : ''
          }`,
          rateLimitRemaining: rl.remaining,
          rateLimitResetAt: rl.resetAt,
          requestId,
        };

        await this.persistRun(runRecord, options.onRecordRun);

        return {
          response: {
            results: allResults,
            pagination: lastPagination,
            rawCount,
            attribution,
            notes,
            isLiveApi,
            providerMetadata,
          },
          normalization,
          runRecord,
        };
      } catch (err: unknown) {
        const classified =
          err instanceof ConnectorError
            ? err.toClassified()
            : connector.classifyError(err);
        const safeMsg = redactSecrets(classified.safeMessage, knownSecrets);
        const rl = this.getRateLimitSnapshot(connector, config);
        const status: ConnectorRunRecord['status'] = options.signal?.aborted ? 'cancelled' : 'error';

        const runRecord: ConnectorRunRecord = {
          id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          connectorId: connector.id,
          operation: 'search',
          queryParams: {
            query: request.query,
            countryCode: reqCountry,
            city: request.city,
          },
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs,
          status,
          recordsDiscovered: 0,
          recordsNormalized: 0,
          recordsRejected: 0,
          errorCategory: classified.category,
          diagnosticSummary: safeMsg,
          rateLimitRemaining: rl.remaining,
          rateLimitResetAt: rl.resetAt,
          requestId,
        };

        await this.persistRun(runRecord, options.onRecordRun);
        throw err;
      }
    };

    // Duplicate in-flight request coalescing when no custom AbortSignal is attached
    const dedupeKey = !options.signal
      ? `search:${connector.id}:${JSON.stringify({
          q: request.query,
          c: reqCountry,
          r: request.region,
          city: request.city,
          p: request.page || 1,
          ps: request.pageSize || meta.executionPolicy.defaultPageSize,
          all: Boolean(request.fetchAllPages),
        })}`
      : null;

    if (dedupeKey && this.inflightDedupes.has(dedupeKey)) {
      return this.inflightDedupes.get(dedupeKey) as Promise<ExecutedSearchOutcome>;
    }

    const promise = executeCore().finally(() => {
      if (dedupeKey) this.inflightDedupes.delete(dedupeKey);
    });

    if (dedupeKey) {
      this.inflightDedupes.set(dedupeKey, promise);
    }

    return promise;
  }

  public async executeLookup(
    connector: IConnector,
    request: ConnectorLookupRequest,
    options: ExecuteSearchOptions = {}
  ): Promise<{
    response: ConnectorLookupResponse;
    normalization?: NormalizationBatchSummary;
    runRecord: ConnectorRunRecord;
  }> {
    if (!connector.lookupById) {
      throw new ConnectorError({
        category: 'unsupported_capability',
        providerId: connector.id,
        retryable: false,
        message: `${connector.getMetadata().name} does not support direct identifier lookup.`,
      });
    }

    const meta = connector.getMetadata();
    const config: ConnectorConfigRecord = options.config || { connectorId: connector.id, enabled: true };
    const userAgent = options.userAgent || 'GlobalLeadPipeline/1.0 (contact@internal-pipeline.local)';
    const requestId = options.requestId || `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const knownSecrets: string[] = [];

    try {
      const response = await this.runWithRetries(
        connector,
        config,
        userAgent,
        options.signal,
        requestId,
        knownSecrets,
        (ctx) => connector.lookupById!(request, ctx)
      );

      const normalization = response.result
        ? normalizeConnectorResults([response.result])
        : { leads: [], discovered: 0, normalized: 0, rejected: 0, rejectionReasons: [] };

      const rl = this.getRateLimitSnapshot(connector, config);
      const runRecord: ConnectorRunRecord = {
        id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        connectorId: connector.id,
        operation: 'lookup',
        queryParams: { externalId: request.externalId, countryCode: request.countryCode },
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        status: 'success',
        recordsDiscovered: normalization.discovered,
        recordsNormalized: normalization.normalized,
        recordsRejected: normalization.rejected,
        diagnosticSummary: response.found
          ? `Lookup matched ${request.externalId}`
          : `No record found for ${request.externalId}`,
        rateLimitRemaining: rl.remaining,
        rateLimitResetAt: rl.resetAt,
        requestId,
      };
      await this.persistRun(runRecord, options.onRecordRun);

      return { response, normalization, runRecord };
    } catch (err: unknown) {
      const classified =
        err instanceof ConnectorError ? err.toClassified() : connector.classifyError(err);
      const safeMsg = redactSecrets(classified.safeMessage, knownSecrets);
      const runRecord: ConnectorRunRecord = {
        id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        connectorId: connector.id,
        operation: 'lookup',
        queryParams: { externalId: request.externalId },
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        status: options.signal?.aborted ? 'cancelled' : 'error',
        recordsDiscovered: 0,
        recordsNormalized: 0,
        recordsRejected: 0,
        errorCategory: classified.category,
        diagnosticSummary: safeMsg,
        requestId,
      };
      await this.persistRun(runRecord, options.onRecordRun);
      throw err;
    }
  }

  public async executeConnectionTest(
    connector: IConnector,
    options: ExecuteSearchOptions = {}
  ): Promise<{ validation: ConnectionValidationResult; runRecord: ConnectorRunRecord }> {
    const meta = connector.getMetadata();
    const config: ConnectorConfigRecord = options.config || { connectorId: connector.id, enabled: true };
    const userAgent = options.userAgent || 'GlobalLeadPipeline/1.0 (contact@internal-pipeline.local)';
    const requestId = options.requestId || `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const knownSecrets: string[] = [];

    // Do not auto-fail disabled connectors during explicit test if owner intentionally tests credentials,
    // unless disabled check is required. Here we run validateConnection directly with resolved credentials.
    const credResolved = await this.credManager.resolveCredentialForExecution(
      connector.id,
      meta.credentialRequirements
    );
    knownSecrets.push(...credResolved.knownSecrets);

    const { controller, cleanup } = this.linkSignals(
      options.signal,
      config.timeoutMs ?? meta.executionPolicy.timeoutMs
    );
    this.activeControllers.set(requestId, controller);

    try {
      const validation = await connector.validateConnection({
        requestId,
        signal: controller.signal,
        credentials: credResolved.credentials,
        credentialSource: credResolved.source,
        config,
        userAgent,
        timeoutMs: config.timeoutMs ?? meta.executionPolicy.timeoutMs,
      });

      const safeValidation: ConnectionValidationResult = {
        ...validation,
        message: redactSecrets(validation.message, knownSecrets),
      };

      await this.credManager.recordValidationOutcome(
        connector.id,
        safeValidation.ok,
        safeValidation.ok ? 'validated_ok' : safeValidation.errorCategory || 'validation_failed'
      );

      const rl = this.getRateLimitSnapshot(connector, config);
      const runRecord: ConnectorRunRecord = {
        id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        connectorId: connector.id,
        operation: 'health_check',
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        status: safeValidation.ok ? 'success' : 'error',
        recordsDiscovered: 0,
        recordsNormalized: 0,
        recordsRejected: 0,
        errorCategory: safeValidation.errorCategory,
        diagnosticSummary: safeValidation.message,
        rateLimitRemaining: safeValidation.rateLimitRemaining ?? rl.remaining,
        rateLimitResetAt: safeValidation.rateLimitResetAt ?? rl.resetAt,
        requestId,
      };
      await this.persistRun(runRecord, options.onRecordRun);

      return { validation: safeValidation, runRecord };
    } catch (err: unknown) {
      const classified =
        err instanceof ConnectorError ? err.toClassified() : connector.classifyError(err);
      const safeMsg = redactSecrets(classified.safeMessage, knownSecrets);
      const runRecord: ConnectorRunRecord = {
        id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        connectorId: connector.id,
        operation: 'health_check',
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        status: 'error',
        recordsDiscovered: 0,
        recordsNormalized: 0,
        recordsRejected: 0,
        errorCategory: classified.category,
        diagnosticSummary: safeMsg,
        requestId,
      };
      await this.persistRun(runRecord, options.onRecordRun);
      return {
        validation: {
          ok: false,
          healthState: this.mapErrorToHealthState(classified.category),
          latencyMs: Date.now() - startMs,
          isLiveApi: meta.accessMode === 'live_api',
          errorCategory: classified.category,
          message: safeMsg,
          checkedAt: new Date().toISOString(),
        },
        runRecord,
      };
    } finally {
      cleanup();
      this.activeControllers.delete(requestId);
    }
  }

  private mapErrorToHealthState(category: ConnectorErrorCategory): ConnectionValidationResult['healthState'] {
    if (category === 'missing_credentials' || category === 'authentication_failure' || category === 'authorization_failure') {
      return 'authentication_required';
    }
    if (category === 'configuration_error') return 'configuration_required';
    if (category === 'rate_limited') return 'rate_limited';
    if (category === 'provider_unavailable' || category === 'network_failure' || category === 'timeout') {
      return 'temporarily_unavailable';
    }
    return 'degraded';
  }
}

export const connectorExecutionEngine = new ConnectorExecutionEngine();
