import {
  ConnectorCapability,
  ConnectorHealthReport,
  ConnectorHealthState,
  ConnectorMetadata,
  ConnectorRuntimeState,
  CredentialRequirement,
  IConnector,
  SourceCategory,
} from './types.js';

export interface ConnectorFilterCriteria {
  country?: string;
  capability?: ConnectorCapability;
  category?: SourceCategory;
}

export class ConnectorRegistry {
  private connectors = new Map<string, IConnector>();
  private enabledOverrides = new Map<string, boolean>();

  public register(connector: IConnector): void {
    const meta = connector.getMetadata();
    if (!connector.id || connector.id !== meta.id) {
      throw new Error(`Connector ID mismatch during registration: ${connector.id} vs ${meta.id}`);
    }
    this.connectors.set(connector.id, connector);
  }

  public unregister(connectorId: string): boolean {
    this.enabledOverrides.delete(connectorId);
    return this.connectors.delete(connectorId);
  }

  public getById(connectorId: string): IConnector | undefined {
    return this.connectors.get(connectorId);
  }

  public listAll(): IConnector[] {
    return Array.from(this.connectors.values());
  }

  public listMetadata(): ConnectorMetadata[] {
    return this.listAll().map((c) => c.getMetadata());
  }

  public filterByCountry(countryCode: string): IConnector[] {
    const code = countryCode.trim().toUpperCase();
    if (!code || code === 'ALL') return this.listAll();
    if (code === 'GLOBAL') {
      return this.listAll().filter((c) => c.getMetadata().supportsAllCountries);
    }
    return this.listAll().filter((c) => {
      const meta = c.getMetadata();
      return meta.supportsAllCountries || meta.supportedCountries.includes(code);
    });
  }

  public filterByCapability(capability: ConnectorCapability): IConnector[] {
    return this.listAll().filter((c) => c.getMetadata().capabilities.includes(capability));
  }

  public filter(criteria: ConnectorFilterCriteria): IConnector[] {
    return this.listAll().filter((connector) => {
      const meta = connector.getMetadata();
      if (criteria.country && criteria.country !== 'ALL') {
        const code = criteria.country.trim().toUpperCase();
        if (code === 'GLOBAL') {
          if (!meta.supportsAllCountries) return false;
        } else if (!meta.supportsAllCountries && !meta.supportedCountries.includes(code)) {
          return false;
        }
      }
      if (criteria.capability && !meta.capabilities.includes(criteria.capability)) {
        return false;
      }
      if (criteria.category && meta.sourceCategory !== criteria.category) {
        return false;
      }
      return true;
    });
  }

  public getCredentialRequirements(connectorId: string): CredentialRequirement | undefined {
    return this.connectors.get(connectorId)?.getMetadata().credentialRequirements;
  }

  public isEnabled(connectorId: string, configEnabled?: boolean): boolean {
    if (configEnabled !== undefined) return configEnabled;
    if (this.enabledOverrides.has(connectorId)) {
      return this.enabledOverrides.get(connectorId)!;
    }
    return true;
  }

  public setEnabledOverride(connectorId: string, enabled: boolean): void {
    this.enabledOverrides.set(connectorId, enabled);
  }

  /**
   * Computes honest 8-state health for a connector.
   * Never claims 'operational' solely because a connector is registered.
   */
  public computeHealthReport(connector: IConnector, state: ConnectorRuntimeState): ConnectorHealthReport {
    const meta = connector.getMetadata();

    if (!state.enabled) {
      return {
        connectorId: connector.id,
        healthState: 'disabled',
        operational: false,
        summary: `${meta.shortName} is disabled by owner configuration.`,
        rateLimit: state.rateLimitState,
      };
    }

    // If database has encrypted credentials but CONNECTOR_ENCRYPTION_KEY is missing
    if (
      state.credentialStatus.source === 'database_encrypted' &&
      !state.credentialStatus.encryptionKeyConfigured
    ) {
      return {
        connectorId: connector.id,
        healthState: 'configuration_required',
        operational: false,
        summary:
          state.credentialStatus.encryptionRequirement ||
          'CONNECTOR_ENCRYPTION_KEY is missing; stored encrypted credentials cannot be decrypted.',
        lastError: state.lastError,
        lastErrorCategory: 'configuration_error',
        rateLimit: state.rateLimitState,
      };
    }

    if (meta.credentialRequirements.required && !state.credentialStatus.configured) {
      return {
        connectorId: connector.id,
        healthState: 'authentication_required',
        operational: false,
        summary:
          meta.accessMode === 'offline_reference'
            ? `Credentials required for live API (${meta.credentialRequirements.envFallbackKeys.join(' / ')}). Currently offline reference only.`
            : `Required credentials missing (${meta.credentialRequirements.envFallbackKeys.join(' or ') || 'Owner API Key'}).`,
        lastError: state.lastError,
        lastErrorCategory: state.lastErrorCategory || 'missing_credentials',
        rateLimit: state.rateLimitState,
      };
    }

    if (state.lastErrorCategory === 'configuration_error') {
      return {
        connectorId: connector.id,
        healthState: 'configuration_required',
        operational: false,
        summary: state.lastError || 'Connector configuration error requires owner intervention.',
        checkedAt: state.lastValidation?.checkedAt,
        lastSuccessAt: state.lastSuccessAt,
        lastError: state.lastError,
        lastErrorCategory: state.lastErrorCategory,
        rateLimit: state.rateLimitState,
      };
    }

    if (
      state.lastErrorCategory === 'authentication_failure' ||
      state.lastErrorCategory === 'authorization_failure'
    ) {
      return {
        connectorId: connector.id,
        healthState: 'authentication_required',
        operational: false,
        summary: state.lastError || 'Provider rejected authentication credentials.',
        checkedAt: state.lastValidation?.checkedAt,
        lastSuccessAt: state.lastSuccessAt,
        lastError: state.lastError,
        lastErrorCategory: state.lastErrorCategory,
        rateLimit: state.rateLimitState,
      };
    }

    if (state.lastErrorCategory === 'rate_limited' && state.consecutiveFailures > 0) {
      return {
        connectorId: connector.id,
        healthState: 'rate_limited',
        operational: false,
        summary: state.lastError || 'Upstream provider rate limit active.',
        checkedAt: state.lastValidation?.checkedAt,
        lastSuccessAt: state.lastSuccessAt,
        lastError: state.lastError,
        lastErrorCategory: state.lastErrorCategory,
        rateLimit: state.rateLimitState,
      };
    }

    if (
      state.consecutiveFailures >= 3 ||
      (state.consecutiveFailures > 0 &&
        (state.lastErrorCategory === 'provider_unavailable' ||
          state.lastErrorCategory === 'network_failure'))
    ) {
      return {
        connectorId: connector.id,
        healthState: 'temporarily_unavailable',
        operational: false,
        summary: state.lastError || 'Upstream provider temporarily unreachable.',
        checkedAt: state.lastValidation?.checkedAt,
        lastSuccessAt: state.lastSuccessAt,
        lastError: state.lastError,
        lastErrorCategory: state.lastErrorCategory,
        rateLimit: state.rateLimitState,
      };
    }

    if (state.consecutiveFailures > 0 || (state.lastValidation && !state.lastValidation.ok)) {
      return {
        connectorId: connector.id,
        healthState: 'degraded',
        operational: false,
        summary: state.lastError || state.lastValidation?.message || 'Recent execution encountered errors.',
        checkedAt: state.lastValidation?.checkedAt,
        lastSuccessAt: state.lastSuccessAt,
        lastError: state.lastError,
        lastErrorCategory: state.lastErrorCategory,
        rateLimit: state.rateLimitState,
      };
    }

    // Never report operational solely from registration: require a verified connection test or successful run
    if (!state.lastValidation && !state.lastSuccessAt && state.totalCalls === 0) {
      return {
        connectorId: connector.id,
        healthState: 'not_tested',
        operational: false,
        summary: `${meta.shortName} is registered and configured, awaiting connection test or first execution.`,
        rateLimit: state.rateLimitState,
      };
    }

    return {
      connectorId: connector.id,
      healthState: 'operational',
      operational: true,
      summary: state.lastValidation?.message || `${meta.shortName} verified operational.`,
      checkedAt: state.lastValidation?.checkedAt,
      lastSuccessAt: state.lastSuccessAt,
      rateLimit: state.rateLimitState,
    };
  }
}

export const connectorRegistry = new ConnectorRegistry();

export function mapHealthStateToLegacyStatus(
  healthState: ConnectorHealthState
): 'healthy' | 'configured' | 'unconfigured' | 'degraded' | 'rate_limited' {
  switch (healthState) {
    case 'operational':
      return 'healthy';
    case 'not_tested':
      return 'configured';
    case 'authentication_required':
    case 'configuration_required':
      return 'unconfigured';
    case 'rate_limited':
      return 'rate_limited';
    case 'degraded':
    case 'temporarily_unavailable':
    case 'disabled':
    default:
      return 'degraded';
  }
}
