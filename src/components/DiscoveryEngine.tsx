import React, { useState, useEffect } from 'react';
import { sanitizeExternalUrl } from '../utils/safeUrl.ts';
import {
  Search,
  Globe2,
  Building2,
  MapPin,
  AlertCircle,
  Plus,
  ExternalLink,
  ShieldAlert,
  Sparkles,
  Info,
  Check,
  ChevronRight,
  ChevronLeft,
  Layers,
  SlidersHorizontal,
  Download,
  History,
  X,
  Table2,
  LayoutGrid,
  StopCircle,
  CheckSquare,
  Square,
  RefreshCw,
  Database,
  Play,
  FileJson,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  AttributeProvenanceType,
  CanonicalLead,
  CountryReference,
  AdministrativeDivision,
  CityReference,
  ConnectorStatus,
  DecisionMakerCandidate,
  DecisionMakerDiscoveryResponse,
  DiscoveryConnectorSummary,
  DiscoveryDuplicateInfo,
  DiscoveryHistoryItem,
  DiscoveryPagination,
  DiscoverySearchResponse,
  SearchDirectoryProviderDoc,
  SourceCategory,
} from '../types.js';
import { apiFetch } from '../utils/apiFetch.ts';
import { LeadEnrichmentPanel } from './LeadEnrichmentPanel.tsx';
import {
  EXPANDED_RELATIONSHIP_TYPES,
  ROLE_TAXONOMY_SPECS,
} from '../../shared/decisionMakerRoles.ts';

interface DiscoveryEngineProps {
  onAddLeadToCrm: (lead: CanonicalLead) => void;
  onBatchAddLeads: (leads: CanonicalLead[]) => void;
  onInspectLead: (lead: CanonicalLead) => void;
  onRefreshLeads?: () => void;
  initialCountry?: string;
}

const FEATURED_COUNTRIES = [
  { code: 'NO', name: 'Norway', flag: '🇳🇴' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'GLOBAL', name: 'Global', flag: '🌐' },
];

const PRESET_CATEGORIES = [
  'Software & Technology',
  'Healthcare & Dental',
  'Engineering & Consultancy',
  'Renewable Energy',
  'Accounting & Finance',
  'Manufacturing & Logistics',
  'Legal & Law Practice',
];

export const DiscoveryEngine: React.FC<DiscoveryEngineProps> = ({
  onAddLeadToCrm,
  onBatchAddLeads,
  onInspectLead,
  onRefreshLeads,
  initialCountry,
}) => {
  const [countries, setCountries] = useState<CountryReference[]>([]);
  const [searchMode, setSearchMode] = useState<'single' | 'multi_country' | 'bulk'>('single');
  const [selectedCountry, setSelectedCountry] = useState(initialCountry || 'NO');
  const [multiCountries, setMultiCountries] = useState<string[]>(['NO', 'GB']);
  const [divisions, setDivisions] = useState<AdministrativeDivision[]>([]);
  const [selectedDivision, setSelectedDivision] = useState('');
  const [city, setCity] = useState(initialCountry && initialCountry !== 'NO' ? '' : 'Trondheim');
  const [postalCode, setPostalCode] = useState('');
  const [citySuggestions, setCitySuggestions] = useState<CityReference[]>([]);

  const [query, setQuery] = useState('Semiconductor');
  const [bulkQueriesText, setBulkQueriesText] = useState('Semiconductor\nEnergy\nMarine Robotics');
  const [industry, setIndustry] = useState('');
  const [productsServices, setProductsServices] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [languageFilter, setLanguageFilter] = useState('');
  const [resultLimit, setResultLimit] = useState<number>(50);
  const [verificationFilter, setVerificationFilter] = useState<'all' | 'officially_verified' | 'official_website' | 'directory_listed' | 'search_engine'>('all');
  const [selectedSourceCategories, setSelectedSourceCategories] = useState<SourceCategory[]>([]);
  const [websiteDomain, setWebsiteDomain] = useState('');
  const [radiusKm, setRadiusKm] = useState('');
  const [coordInput, setCoordInput] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const [showProvidersMatrix, setShowProvidersMatrix] = useState(false);
  const [providerDocs, setProviderDocs] = useState<SearchDirectoryProviderDoc[]>([]);
  const [isLoadingProviders, setIsLoadingProviders] = useState(false);

  const [aiQueryPlan, setAiQueryPlan] = useState<{
    suggestedQueries: string[];
    industryKeywords: string[];
    recommendedFollowUp: string[];
    rationale: string;
    provenanceType: 'inferred';
    engine: string;
  } | null>(null);
  const [isGeneratingQueries, setIsGeneratingQueries] = useState(false);

  const [showUrlInspector, setShowUrlInspector] = useState(false);
  const [directInspectUrl, setDirectInspectUrl] = useState('');
  const [isDirectInspecting, setIsDirectInspecting] = useState(false);
  const [directInspectResult, setDirectInspectResult] = useState<{
    inspection: any;
    aiIntel?: any;
  } | null>(null);

  const [duplicateAssessments, setDuplicateAssessments] = useState<
    Record<
      string,
      {
        assessment: string;
        explanation: string;
        provenanceType: string;
        engine: string;
      }
    >
  >({});
  const [isAssessingDupId, setIsAssessingDupId] = useState<string | null>(null);

  const [selectionMode, setSelectionMode] = useState<'auto' | 'manual'>('auto');
  const [selectedConnectorIds, setSelectedConnectorIds] = useState<string[]>(['conn-brreg']);
  const [availableConnectors, setAvailableConnectors] = useState<ConnectorStatus[]>([]);
  const [fetchAllPages, setFetchAllPages] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [results, setResults] = useState<CanonicalLead[]>([]);
  const [duplicateInfoByLeadId, setDuplicateInfoByLeadId] = useState<Record<string, DiscoveryDuplicateInfo>>({});
  const [connectorSummaries, setConnectorSummaries] = useState<DiscoveryConnectorSummary[]>([]);
  const [attribution, setAttribution] = useState('');
  const [providerNote, setProviderNote] = useState('');
  const [abnLookupInfo, setAbnLookupInfo] = useState<{
    isLiveApi: boolean;
    lookupMode: string;
    isChecksumValid?: boolean;
  } | null>(null);
  const [appliedFilters, setAppliedFilters] = useState<DiscoverySearchResponse['appliedFilters'] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [summaryStats, setSummaryStats] = useState<{
    totalDiscovered: number;
    totalUnique: number;
    existingCrmMatches: number;
    ambiguousMatches: number;
    crossSourceCorroborations: number;
    durationMs: number;
  } | null>(null);
  const [pagination, setPagination] = useState<DiscoveryPagination | null>(null);

  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [duplicateFilter, setDuplicateFilter] = useState<'all' | 'unique' | 'existing_crm' | 'ambiguous'>('all');
  const [sortBy, setSortBy] = useState<'confidence_desc' | 'name_asc'>('confidence_desc');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [duplicatePolicy, setDuplicatePolicy] = useState<'merge_preserve_crm' | 'skip'>('merge_preserve_crm');
  const [saveBanner, setSaveBanner] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
    details?: string[];
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [inspectedCandidate, setInspectedCandidate] = useState<CanonicalLead | null>(null);
  const [isEnrichingId, setIsEnrichingId] = useState<string | null>(null);

  // Phase 11: Candidate Drawer Decision-Maker Investigation
  const [drawerDmRoleFilter, setDrawerDmRoleFilter] = useState('');
  const [isDrawerDmLoading, setIsDrawerDmLoading] = useState(false);
  const [drawerDmResult, setDrawerDmResult] = useState<DecisionMakerDiscoveryResponse | null>(null);
  const [drawerDmError, setDrawerDmError] = useState<string | null>(null);
  const [drawerSelectedDmIds, setDrawerSelectedDmIds] = useState<Set<string>>(new Set());
  const [isSavingDrawerDm, setIsSavingDrawerDm] = useState(false);
  const [drawerDmSuccess, setDrawerDmSuccess] = useState<string | null>(null);

  const [showHistory, setShowHistory] = useState(false);
  const [historyItems, setHistoryItems] = useState<DiscoveryHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  useEffect(() => {
    setDrawerDmResult(null);
    setDrawerDmError(null);
    setDrawerSelectedDmIds(new Set());
    setDrawerDmSuccess(null);
  }, [inspectedCandidate?.id]);

  const handleInvestigateDrawerDecisionMakers = async (company: CanonicalLead) => {
    setIsDrawerDmLoading(true);
    setDrawerDmError(null);
    setDrawerDmSuccess(null);
    try {
      const matchedLeadId = duplicateInfoByLeadId[company.id]?.matchedLeadId;
      const res = await apiFetch('/api/decision-makers/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: matchedLeadId,
          companyName: company.companyName,
          domain: company.domain,
          website: company.website,
          countryCode: company.address?.countryCode,
          registrationNumber: company.registrationNumber,
          registrationType: company.registrationType,
          industry: company.industry,
          targetRelationshipType: drawerDmRoleFilter || undefined,
          includeHistorical: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Decision-maker investigation failed');
      setDrawerDmResult(data);
      setDrawerSelectedDmIds(new Set());
    } catch (err: unknown) {
      setDrawerDmError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDrawerDmLoading(false);
    }
  };

  const handleSaveCompanyWithApprovedContacts = async (company: CanonicalLead) => {
    if (!drawerDmResult || drawerSelectedDmIds.size === 0) return;
    const approved: DecisionMakerCandidate[] = drawerDmResult.candidates.filter((c) =>
      drawerSelectedDmIds.has(c.candidateId)
    );
    if (approved.length === 0) return;
    setIsSavingDrawerDm(true);
    setDrawerDmError(null);
    try {
      const matchedLeadId = duplicateInfoByLeadId[company.id]?.matchedLeadId;
      const res = await apiFetch('/api/decision-makers/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: matchedLeadId,
          company: matchedLeadId ? undefined : company,
          candidates: approved,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save company and contacts to CRM');
      setAddedIds((prev) => new Set([...prev, company.id]));
      setDrawerSelectedDmIds(new Set());
      setDrawerDmSuccess(
        `Saved ${company.companyName} and ${approved.length} approved decision-maker(s) to CRM.`
      );
      if (onRefreshLeads) onRefreshLeads();
    } catch (err: unknown) {
      setDrawerDmError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingDrawerDm(false);
    }
  };

  useEffect(() => {
    if (initialCountry) {
      handleCountryChange(initialCountry);
    }
  }, [initialCountry]);

  useEffect(() => {
    apiFetch('/api/geo/countries')
      .then((res) => res.json())
      .then((data: CountryReference[]) => {
        if (Array.isArray(data)) setCountries(data);
      })
      .catch((err) => console.error('Failed to load countries:', err));

    apiFetch('/api/connectors?capability=company_search')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.connectors)) {
          setAvailableConnectors(data.connectors);
        }
      })
      .catch((err) => console.error('Failed to load discovery connectors:', err));
  }, []);

  useEffect(() => {
    if (selectedCountry === 'GLOBAL') {
      setDivisions([]);
      setSelectedDivision('');
      if (selectionMode === 'auto') setSelectedConnectorIds(['conn-osm']);
      return;
    }

    if (selectionMode === 'auto') {
      if (selectedCountry === 'NO') setSelectedConnectorIds(['conn-brreg']);
      else if (selectedCountry === 'GB') setSelectedConnectorIds(['conn-companies-house']);
      else if (selectedCountry === 'AU') setSelectedConnectorIds(['conn-abn']);
      else setSelectedConnectorIds(['conn-osm']);
    }

    apiFetch(`/api/geo/divisions?country=${selectedCountry}`)
      .then((res) => res.json())
      .then((data) => {
        setDivisions(data.divisions || []);
        setSelectedDivision('');
      })
      .catch(() => setDivisions([]));

    apiFetch(`/api/geo/cities?country=${selectedCountry}&limit=8`)
      .then((res) => res.json())
      .then((data) => setCitySuggestions(data.cities || []))
      .catch(() => setCitySuggestions([]));
  }, [selectedCountry, selectionMode]);

  useEffect(() => {
    if (selectedCountry !== 'GLOBAL') {
      const params = new URLSearchParams();
      params.set('country', selectedCountry);
      if (selectedDivision) params.set('division', selectedDivision);
      if (city.trim()) params.set('query', city.trim());
      params.set('limit', '8');
      apiFetch(`/api/geo/cities?${params.toString()}`)
        .then((res) => res.json())
        .then((data) => setCitySuggestions(data.cities || []))
        .catch(() => setCitySuggestions([]));
    }
  }, [selectedDivision, selectedCountry, city]);

  const currentCountryObj = countries.find((c) => c.code === selectedCountry);

  const handleCountryChange = (code: string) => {
    setSelectedCountry(code);
    if (code === 'NO') {
      setQuery('Semiconductor');
      setCity('Trondheim');
    } else if (code === 'GB') {
      setQuery('Artificial Intelligence');
      setCity('London');
    } else if (code === 'AU') {
      setQuery('Technology');
      setCity('Sydney');
    } else if (code === 'US') {
      setQuery('Biotech');
      setCity('Boston');
    } else if (code === 'DE') {
      setQuery('Engineering');
      setCity('Munich');
    } else {
      setQuery('Commercial');
      setCity('');
    }
  };

  const toggleMultiCountry = (code: string) => {
    setMultiCountries((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code].slice(0, 10)
    );
  };

  const toggleManualConnector = (id: string) => {
    setSelectionMode('manual');
    setSelectedConnectorIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const parseCoordinates = (): { lat: number; lon: number } | undefined => {
    if (!coordInput.trim()) return undefined;
    const parts = coordInput.split(',').map((p) => parseFloat(p.trim()));
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      return { lat: parts[0], lon: parts[1] };
    }
    return undefined;
  };

  const toggleSourceCategory = (cat: SourceCategory) => {
    setSelectedSourceCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const loadProvidersMatrix = async () => {
    const next = !showProvidersMatrix;
    setShowProvidersMatrix(next);
    if (next && providerDocs.length === 0) {
      setIsLoadingProviders(true);
      try {
        const res = await apiFetch('/api/discovery/providers');
        if (res.ok) {
          const data = await res.json();
          setProviderDocs(data.providers || []);
        }
      } catch (err) {
        console.error('Failed to load discovery providers matrix:', err);
      } finally {
        setIsLoadingProviders(false);
      }
    }
  };

  const handleGenerateAiQueries = async () => {
    setIsGeneratingQueries(true);
    setErrors([]);
    try {
      const selectedDivisionObj = divisions.find((d) => d.code === selectedDivision);
      const res = await apiFetch('/api/discovery/ai-queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim() || undefined,
          industry: industry.trim() || undefined,
          productsServices: productsServices.trim() || undefined,
          businessType: businessType.trim() || undefined,
          countryCode: selectedCountry === 'GLOBAL' ? undefined : selectedCountry,
          region: selectedDivisionObj?.name || selectedDivision || undefined,
          city: city.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate query suggestions');
      setAiQueryPlan(data);
    } catch (err: unknown) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setIsGeneratingQueries(false);
    }
  };

  const handleDirectInspectWebsite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directInspectUrl.trim()) return;
    setIsDirectInspecting(true);
    setDirectInspectResult(null);
    setErrors([]);
    try {
      const res = await apiFetch('/api/discovery/inspect-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: directInspectUrl.trim(),
          runAiExtraction: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Website inspection failed');
      setDirectInspectResult(data);
    } catch (err: unknown) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setIsDirectInspecting(false);
    }
  };

  const handleAssessDuplicateWithAi = async (candidate: CanonicalLead, dup: DiscoveryDuplicateInfo) => {
    if (!dup.matchedLeadId) return;
    setIsAssessingDupId(candidate.id);
    try {
      const res = await apiFetch('/api/discovery/duplicate-assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate,
          matchedLeadId: dup.matchedLeadId,
          matchReason: dup.note || dup.matchType || 'Ambiguous entity overlap',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to assess duplicate pair');
      setDuplicateAssessments((prev) => ({ ...prev, [candidate.id]: data }));
    } catch (err: unknown) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setIsAssessingDupId(null);
    }
  };

  const executeDiscoverySearch = async (overrideParams?: {
    queryText?: string;
    countryCode?: string;
    cityName?: string;
    regionName?: string;
    industryName?: string;
    domainFilter?: string;
    connectorId?: string;
  }) => {
    const activeQuery = overrideParams?.queryText ?? query;
    const activeCountry = overrideParams?.countryCode ?? selectedCountry;
    const activeCity = overrideParams?.cityName ?? city;
    const activeIndustry = overrideParams?.industryName ?? industry;
    const activeDomain = overrideParams?.domainFilter ?? websiteDomain;

    const parsedQueries =
      searchMode === 'bulk' && !overrideParams?.queryText
        ? bulkQueriesText
            .split(/[\r\n;]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : activeQuery.trim()
        ? [activeQuery.trim()]
        : [];

    if (
      parsedQueries.length === 0 &&
      !activeIndustry.trim() &&
      !productsServices.trim() &&
      !activeDomain.trim()
    ) {
      setErrors(['Enter a business name, keyword, products/services, industry category, or website domain to search.']);
      return;
    }

    const reqId = `disc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setActiveRequestId(reqId);
    setIsLoading(true);
    setErrors([]);
    setSaveBanner(null);
    setResults([]);
    setSelectedIds(new Set());
    setConnectorSummaries([]);
    setSummaryStats(null);
    setPagination(null);
    setDuplicateFilter('all');

    const selectedDivisionObj = divisions.find((d) => d.code === selectedDivision);
    const regionValue =
      overrideParams?.regionName ?? (selectedDivisionObj?.name || selectedDivision || undefined);
    const coords = parseCoordinates();
    const radiusNum = radiusKm.trim() ? parseFloat(radiusKm.trim()) : undefined;

    try {
      const payload = {
        query: parsedQueries[0] || undefined,
        queries: parsedQueries.length > 1 ? parsedQueries : undefined,
        countryCode:
          searchMode === 'multi_country' && !overrideParams?.countryCode
            ? undefined
            : activeCountry === 'GLOBAL'
            ? undefined
            : activeCountry,
        countryCodes:
          searchMode === 'multi_country' && !overrideParams?.countryCode && multiCountries.length > 0
            ? multiCountries
            : undefined,
        region: regionValue,
        city: activeCity.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        industry: activeIndustry.trim() || undefined,
        productsServices: productsServices.trim() || undefined,
        businessType: businessType.trim() || undefined,
        companySize: companySize.trim() || undefined,
        language: languageFilter.trim() || undefined,
        website: activeDomain.trim() || undefined,
        domain: activeDomain.trim() || undefined,
        radiusKm: radiusNum && Number.isFinite(radiusNum) ? radiusNum : undefined,
        coordinates: coords,
        selectionMode: overrideParams?.connectorId ? 'manual' : selectionMode,
        connectorIds: overrideParams?.connectorId
          ? [overrideParams.connectorId]
          : selectionMode === 'manual'
          ? selectedConnectorIds
          : undefined,
        sourceCategories:
          selectedSourceCategories.length > 0 ? selectedSourceCategories : undefined,
        verificationFilter: verificationFilter !== 'all' ? verificationFilter : undefined,
        limit: resultLimit > 0 ? resultLimit : undefined,
        page: 1,
        pageSize: 25,
        fetchAllPages,
        requestId: reqId,
      };

      const res = await apiFetch('/api/discovery/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Discovery endpoint returned non-JSON response (HTTP ${res.status}).`);
      }

      const data: DiscoverySearchResponse & { error?: string } = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to execute discovery search (HTTP ${res.status})`);
      }

      setSearchId(data.searchId);
      setResults(data.leads || []);
      setDuplicateInfoByLeadId(data.duplicateInfoByLeadId || {});
      setConnectorSummaries(data.connectorSummaries || []);
      setAttribution(data.attribution || '');
      setProviderNote(data.providerNote || '');
      setAbnLookupInfo(data.abnLookupInfo || null);
      setAppliedFilters(data.appliedFilters || null);
      setPagination(data.pagination || null);
      setSummaryStats({
        totalDiscovered: data.totalDiscovered,
        totalUnique: data.totalUnique,
        existingCrmMatches: data.existingCrmMatches,
        ambiguousMatches: data.ambiguousMatches,
        crossSourceCorroborations: data.crossSourceCorroborations,
        durationMs: data.durationMs,
      });
      if (data.errors && data.errors.length > 0) {
        setErrors(data.errors);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrors([msg]);
    } finally {
      setIsLoading(false);
      setActiveRequestId(null);
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await executeDiscoverySearch();
  };

  const handleRerunHistory = async (h: DiscoveryHistoryItem) => {
    const qp = h.queryParams || {};
    const qText = typeof qp.query === 'string' ? qp.query : '';
    const cCode = typeof qp.countryCode === 'string' && qp.countryCode ? qp.countryCode.toUpperCase() : 'GLOBAL';
    const cityVal = typeof qp.city === 'string' ? qp.city : '';
    const indVal = typeof qp.industry === 'string' ? qp.industry : '';
    const domVal = typeof qp.domain === 'string' ? qp.domain : typeof qp.website === 'string' ? qp.website : '';

    setSearchMode('single');
    setSelectedCountry(cCode);
    if (qText) setQuery(qText);
    setCity(cityVal);
    setIndustry(indVal);
    setWebsiteDomain(domVal);
    setShowHistory(false);

    await executeDiscoverySearch({
      queryText: qText,
      countryCode: cCode,
      cityName: cityVal,
      industryName: indVal,
      domainFilter: domVal,
      connectorId: h.connectorId && h.connectorId !== 'conn-gemini' ? h.connectorId : undefined,
    });
  };

  const handleCancelSearch = async () => {
    if (!activeRequestId) return;
    try {
      await apiFetch(`/api/discovery/cancel/${encodeURIComponent(activeRequestId)}`, {
        method: 'POST',
      });
      setErrors(['Discovery search cancellation requested.']);
    } catch (err) {
      console.error('Cancel failed:', err);
    }
  };

  const fetchServerPage = async (
    targetPage: number,
    nextDupFilter = duplicateFilter,
    nextSort = sortBy
  ) => {
    if (!searchId) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(Math.max(1, targetPage)),
        pageSize: String(pagination?.pageSize || 25),
        duplicateFilter: nextDupFilter,
        sortBy: nextSort,
      });
      const res = await apiFetch(`/api/discovery/results/${encodeURIComponent(searchId)}?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load discovery page');

      setResults(data.leads || []);
      setDuplicateInfoByLeadId(data.duplicateInfoByLeadId || {});
      setPagination(data.pagination || null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrors([msg]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadHistory = async () => {
    setShowHistory((v) => !v);
    if (!showHistory) {
      setIsLoadingHistory(true);
      try {
        const res = await apiFetch('/api/discovery/history?limit=15');
        if (res.ok) {
          const data = await res.json();
          setHistoryItems(data.history || []);
        }
      } catch (err) {
        console.error('Failed to load discovery history:', err);
      } finally {
        setIsLoadingHistory(false);
      }
    }
  };

  const handleSaveLeads = async (leadsToSave: CanonicalLead[]) => {
    if (leadsToSave.length === 0) return;
    setIsSaving(true);
    setSaveBanner(null);

    try {
      const res = await apiFetch('/api/discovery/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searchId: searchId || undefined,
          leadIds: searchId ? leadsToSave.map((l) => l.id) : undefined,
          leads: searchId ? undefined : leadsToSave,
          duplicatePolicy,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save discovered leads');
      }

      const savedCount = (data.added || 0) + (data.updated || 0) + (data.skipped || 0);
      if (savedCount > 0 && (!data.failed || data.failed === 0)) {
        const newAdded = new Set(addedIds);
        leadsToSave.forEach((l) => newAdded.add(l.id));
        setAddedIds(newAdded);
      }

      const details: string[] = [];
      if (data.ambiguousMatches?.length) {
        details.push(
          `${data.ambiguousMatches.length} record(s) flagged for ambiguous duplicate review (not auto-merged).`
        );
      }
      if (data.errors?.length) {
        data.errors.slice(0, 3).forEach((er: any) => details.push(`Row ${er.row}: ${er.error}`));
      }

      setSaveBanner({
        type: data.failed > 0 || data.ambiguousMatches?.length ? 'warning' : 'success',
        message: `CRM Sync Complete — Added: ${data.added}, Updated: ${data.updated}, Skipped: ${data.skipped}, Failed: ${data.failed || 0}`,
        details: details.length > 0 ? details : undefined,
      });

      if (onRefreshLeads) onRefreshLeads();
      else if (leadsToSave.length === 1) onAddLeadToCrm(leadsToSave[0]);
      else onBatchAddLeads(leadsToSave);
    } catch (err: unknown) {
      setSaveBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'CRM save failed',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEnrichCandidate = async (
    lead: CanonicalLead,
    opts: { runWebInspector: boolean; runAi: boolean }
  ) => {
    setIsEnrichingId(lead.id);
    try {
      const res = await apiFetch('/api/discovery/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searchId: searchId || undefined,
          leadId: lead.id,
          lead,
          runWebInspector: opts.runWebInspector,
          runAi: opts.runAi,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Enrichment failed');

      if (data.lead) {
        setResults((prev) => prev.map((r) => (r.id === lead.id ? data.lead : r)));
        if (inspectedCandidate?.id === lead.id) {
          setInspectedCandidate(data.lead);
        }
      }
      if (data.notes?.length) {
        setProviderNote((prev) => [prev, ...data.notes].filter(Boolean).join(' · '));
      }
    } catch (err: unknown) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setIsEnrichingId(null);
    }
  };

  const handleExportDiscovery = async (format: 'csv' | 'json') => {
    if (!searchId) return;
    try {
      const params = new URLSearchParams();
      params.set('format', format);
      if (selectedIds.size > 0) {
        params.set('ids', Array.from(selectedIds).join(','));
      }
      const res = await apiFetch(`/api/discovery/export/${encodeURIComponent(searchId)}?${params.toString()}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `${format.toUpperCase()} export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `leed_discovery_${searchId}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    }
  };

  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectPage = () => {
    const pageIds = results.map((r) => r.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const accessModeLabel = (mode?: ConnectorStatus['accessMode']): string => {
    switch (mode) {
      case 'live_api':
        return 'Live API';
      case 'offline_reference':
        return 'Offline Reference';
      case 'public_directory':
        return 'Public Directory';
      case 'manual_portal':
        return 'Manual Portal';
      default:
        return 'Standard';
    }
  };

  const provenanceLabel = (t?: AttributeProvenanceType): string => {
    switch (t) {
      case 'official_registry':
        return 'Official Registry';
      case 'official_website':
        return 'Official Website';
      case 'business_directory':
        return 'Business Directory';
      case 'search_provider':
        return 'Search Provider';
      case 'ai_extracted':
        return 'AI Extracted';
      case 'inferred':
        return 'Inferred';
      default:
        return 'Not Verified';
    }
  };

  const verificationLabel = (lead: CanonicalLead): { text: string; tone: string } => {
    const v = lead.customFields?.lastVerificationStatus;
    const connId = lead.customFields?.lastConnectorId;
    if (v === 'officially_verified') {
      return { text: 'Officially Verified', tone: 'text-emerald-700 dark:text-emerald-400' };
    }
    if (v === 'offline_reference') {
      return { text: 'Offline Reference', tone: 'text-amber-700 dark:text-amber-400' };
    }
    if (v === 'directory_listed') {
      return { text: 'Directory Listed', tone: 'text-sky-700 dark:text-sky-400' };
    }
    if (v === 'web_observed') {
      return { text: 'Web Observed', tone: 'text-indigo-700 dark:text-indigo-400' };
    }
    if (connId === 'conn-brave-search' || connId === 'conn-google-cse') {
      return { text: 'Search Result (Unverified)', tone: 'text-slate-600 dark:text-slate-400' };
    }
    return { text: 'Unverified', tone: 'text-slate-500 dark:text-slate-400' };
  };

  const duplicateStatusIndicator = (dup?: DiscoveryDuplicateInfo) => {
    if (!dup || dup.status === 'unique') return null;
    if (dup.status === 'existing_crm') {
      return (
        <span className="text-[11px] font-medium text-blue-700 dark:text-blue-400">
          In CRM ({dup.matchType?.replace('_', ' ')})
        </span>
      );
    }
    if (dup.requiresReview) {
      return (
        <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
          Review Possible Match
        </span>
      );
    }
    if (dup.status === 'cross_source_match') {
      return (
        <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
          Cross-Source Verified
        </span>
      );
    }
    return null;
  };

  return (
    <div className="space-y-5">
      {/* Control Workspace Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 mb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Globe2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <span>Global Business Discovery Engine</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Single-country, multi-country, and bulk commercial discovery via unified Phase 4 connectors with deduplication &amp; CRM preservation.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Search Mode Switcher */}
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-0.5">
              {([
                { id: 'single', label: 'Single Country' },
                { id: 'multi_country', label: 'Multi-Country' },
                { id: 'bulk', label: 'Bulk Queries' },
              ] as const).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSearchMode(m.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition whitespace-nowrap shrink-0 ${
                    searchMode === m.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={loadProvidersMatrix}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition whitespace-nowrap shrink-0"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Search &amp; Directory Matrix</span>
            </button>

            <button
              type="button"
              onClick={() => setShowUrlInspector((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition whitespace-nowrap shrink-0"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Inspect Website URL</span>
            </button>

            <button
              type="button"
              onClick={loadHistory}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition whitespace-nowrap shrink-0"
            >
              <History className="w-3.5 h-3.5" />
              <span>Execution History</span>
            </button>
          </div>
        </div>

        {/* Jurisdiction Quick Picks */}
        {searchMode !== 'multi_country' ? (
          <div className="space-y-3 mb-4">
            <div className="flex items-center gap-1.5 flex-wrap">
              {FEATURED_COUNTRIES.map((c) => {
                const isSelected = selectedCountry === c.code;
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => handleCountryChange(c.code)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md font-medium transition border ${
                      isSelected
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span>{c.flag}</span>
                    <span>{c.name}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <span className="text-xl">{currentCountryObj?.flag || '🌐'}</span>
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {currentCountryObj?.name || 'Global Jurisdiction'}
                  </span>
                  {currentCountryObj?.nativeName && (
                    <span className="text-slate-500 dark:text-slate-400 ml-1.5">
                      ({currentCountryObj.nativeName})
                    </span>
                  )}
                  <span className="mx-2 text-slate-300 dark:text-slate-700">·</span>
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    ISO {currentCountryObj?.code || 'GLOBAL'} · {currentCountryObj?.callingCode || 'E.164'} · {currentCountryObj?.currency || 'USD'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <label className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  All 195 States:
                </label>
                <select
                  value={selectedCountry}
                  onChange={(e) => handleCountryChange(e.target.value)}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-md px-2.5 py-1.5 focus:outline-none focus:border-blue-500 max-w-[220px]"
                >
                  <option value="GLOBAL">🌐 Global / All Jurisdictions</option>
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.flag} {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Target Countries ({multiCountries.length} selected · max 10)
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                Selected: {multiCountries.join(', ') || 'None'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {FEATURED_COUNTRIES.filter((c) => c.code !== 'GLOBAL').map((c) => {
                const active = multiCountries.includes(c.code);
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => toggleMultiCountry(c.code)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border font-medium transition ${
                      active
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <span>{c.flag}</span>
                    <span>{c.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Primary Search Form */}
        <form onSubmit={handleSearch} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            {searchMode === 'bulk' ? (
              <div className="md:col-span-6">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Bulk Keywords, Company Names, or Registration IDs (one per line · max 15)
                </label>
                <textarea
                  rows={3}
                  value={bulkQueriesText}
                  onChange={(e) => setBulkQueriesText(e.target.value)}
                  placeholder="Nordic Semiconductor&#10;DeepMind&#10;Renewable Energy"
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
            ) : (
              <div className="md:col-span-5">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Business Name, Keyword, or Registration ID
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g. Nordic Semiconductor, DeepMind, 923609016..."
                    className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-2 pl-9 focus:outline-none focus:border-blue-500"
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
                </div>
              </div>
            )}

            {searchMode === 'single' && divisions.length > 0 && (
              <div className="md:col-span-2">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {currentCountryObj?.addressFormat.regionLabel || 'Region'}
                </label>
                <select
                  value={selectedDivision}
                  onChange={(e) => setSelectedDivision(e.target.value)}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-2.5 py-2 focus:outline-none focus:border-blue-500"
                >
                  <option value="">All ({divisions.length})</option>
                  {divisions.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className={searchMode === 'bulk' ? 'md:col-span-3' : divisions.length > 0 && searchMode === 'single' ? 'md:col-span-3' : 'md:col-span-4'}>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                City or Locality
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Trondheim, London, Munich..."
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-2 pl-9 focus:outline-none focus:border-blue-500"
                />
                <MapPin className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
              </div>
            </div>

            <div className={searchMode === 'bulk' ? 'md:col-span-3' : divisions.length > 0 && searchMode === 'single' ? 'md:col-span-2' : 'md:col-span-3'}>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Postal Code
              </label>
              <input
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder={currentCountryObj?.addressFormat.postalCodeExample || 'e.g. 7052, N1C 4AG'}
                className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* City Quick Suggestions */}
          {searchMode === 'single' && citySuggestions.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Cities:</span>
              {citySuggestions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCity(c.name)}
                  className={`text-[11px] px-2 py-0.5 rounded border transition ${
                    city.toLowerCase() === c.name.toLowerCase()
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {/* Optional Advanced Filters */}
          {showAdvancedFilters && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="md:col-span-3">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Industry / Business Category
                </label>
                <input
                  type="text"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="e.g. Dental, Fintech, NACE 62"
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Website or Domain Filter
                </label>
                <input
                  type="text"
                  value={websiteDomain}
                  onChange={(e) => setWebsiteDomain(e.target.value)}
                  placeholder="e.g. nordicsemi.com"
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Center Coordinates (lat, lon)
                </label>
                <input
                  type="text"
                  value={coordInput}
                  onChange={(e) => setCoordInput(e.target.value)}
                  placeholder="e.g. 63.4305, 10.3951"
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Geographic Radius (km)
                </label>
                <input
                  type="number"
                  min={1}
                  max={250}
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(e.target.value)}
                  placeholder="e.g. 25"
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Products &amp; Services
                </label>
                <input
                  type="text"
                  value={productsServices}
                  onChange={(e) => setProductsServices(e.target.value)}
                  placeholder="e.g. BLE SoC, CNC machining, solar inverter"
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Business Type
                </label>
                <input
                  type="text"
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  placeholder="e.g. Manufacturer, B2B SaaS, Consultancy"
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Company Size
                </label>
                <input
                  type="text"
                  value={companySize}
                  onChange={(e) => setCompanySize(e.target.value)}
                  placeholder="e.g. SME, 50-250"
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Language
                </label>
                <input
                  type="text"
                  value={languageFilter}
                  onChange={(e) => setLanguageFilter(e.target.value)}
                  placeholder="e.g. en, de, no"
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Result Limit
                </label>
                <select
                  value={resultLimit}
                  onChange={(e) => setResultLimit(Number(e.target.value))}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500 tabular-nums"
                >
                  <option value={25}>25 results</option>
                  <option value={50}>50 results</option>
                  <option value={100}>100 results</option>
                  <option value={250}>250 results</option>
                </select>
              </div>

              <div className="md:col-span-4">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Verification / Source Provenance Filter
                </label>
                <select
                  value={verificationFilter}
                  onChange={(e) => setVerificationFilter(e.target.value as any)}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500"
                >
                  <option value="all">All Sources &amp; Verification Tiers</option>
                  <option value="officially_verified">Official Registry Verified Only</option>
                  <option value="official_website">Official Website Observed</option>
                  <option value="directory_listed">Business Directory Listed</option>
                  <option value="search_engine">Web Search Results</option>
                </select>
              </div>

              <div className="md:col-span-8">
                <span className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Source Categories (optional — leave unchecked for automatic smart routing)
                </span>
                <div className="flex items-center gap-3 flex-wrap text-xs">
                  {([
                    { id: 'government_registry', label: 'Government Registries' },
                    { id: 'search_engine', label: 'Web Search APIs' },
                    { id: 'business_directory', label: 'Business Directories' },
                    { id: 'maps_geo', label: 'Maps & Geo POI' },
                  ] as Array<{ id: SourceCategory; label: string }>).map((cat) => (
                    <label key={cat.id} className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={selectedSourceCategories.includes(cat.id)}
                        onChange={() => toggleSourceCategory(cat.id)}
                        className="rounded border-slate-300 dark:border-slate-700 text-blue-600"
                      />
                      <span>{cat.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Explicit Connector Routing */}
              <div className="md:col-span-12 pt-1">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Connector Routing Strategy
                  </span>
                  <div className="flex items-center gap-3 text-xs">
                    <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                      <input
                        type="radio"
                        checked={selectionMode === 'auto'}
                        onChange={() => setSelectionMode('auto')}
                      />
                      <span>Dynamic Auto-Select (Recommended)</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                      <input
                        type="radio"
                        checked={selectionMode === 'manual'}
                        onChange={() => setSelectionMode('manual')}
                      />
                      <span>Manual Connectors</span>
                    </label>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {availableConnectors.map((conn) => {
                    const isChecked = selectedConnectorIds.includes(conn.id);
                    const isDisabled = conn.healthState === 'disabled';
                    return (
                      <button
                        key={conn.id}
                        type="button"
                        onClick={() => toggleManualConnector(conn.id)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md border transition ${
                          selectionMode === 'manual' && isChecked
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                        } ${isDisabled ? 'opacity-60' : ''}`}
                      >
                        <span className="font-medium">{conn.shortName || conn.name}</span>
                        <span className="opacity-75">· {accessModeLabel(conn.accessMode)}</span>
                        {isDisabled && <span className="text-rose-500">· Disabled</span>}
                        {!isDisabled && conn.healthState === 'authentication_required' && (
                          <span className="text-amber-500">· Key Req</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* AI Suggested Queries Banner */}
          {aiQueryPlan && (
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-slate-800 dark:text-slate-200">
                  Query Suggestions ({aiQueryPlan.engine} · Inferred — not yet verified)
                </div>
                <button
                  type="button"
                  onClick={() => setAiQueryPlan(null)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{aiQueryPlan.rationale}</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {aiQueryPlan.suggestedQueries.map((sq, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      if (searchMode === 'bulk') {
                        setBulkQueriesText((prev) => (prev ? `${prev}\n${sq}` : sq));
                      } else {
                        setQuery(sq);
                      }
                    }}
                    className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-blue-500 transition"
                  >
                    {sq}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Presets & Action Row */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Industries:</span>
              {PRESET_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    if (searchMode === 'bulk') {
                      setBulkQueriesText((prev) => (prev ? `${prev}\n${cat}` : cat));
                    } else {
                      setQuery(cat);
                    }
                  }}
                  className="px-2 py-0.5 text-[11px] rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2.5 flex-wrap shrink-0">
              <button
                type="button"
                disabled={isGeneratingQueries}
                onClick={handleGenerateAiQueries}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isGeneratingQueries ? 'Planning...' : 'Suggest Queries'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowAdvancedFilters((v) => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition whitespace-nowrap shrink-0"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>{showAdvancedFilters ? 'Hide Filters' : 'Filters & Routing'}</span>
              </button>

              <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none whitespace-nowrap shrink-0">
                <input
                  type="checkbox"
                  checked={fetchAllPages}
                  onChange={(e) => setFetchAllPages(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700 text-blue-600"
                />
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                <span>Multi-page fetch</span>
              </label>

              {isLoading && activeRequestId ? (
                <button
                  type="button"
                  onClick={handleCancelSearch}
                  className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg transition whitespace-nowrap shrink-0"
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  <span>Cancel Search</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>Discover Businesses</span>
                </button>
              )}
            </div>
          </div>
        </form>
      </div>

      {/* Search Engine & Public Business Directory Availability Matrix */}
      {showProvidersMatrix && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                Web Search &amp; Business Directory Provider Matrix
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Verified provider availability, Credential Vault requirements, rate limits, and commercial licensing terms.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowProvidersMatrix(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {isLoadingProviders ? (
            <p className="text-xs text-slate-500">Loading provider matrix...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Provider</th>
                    <th className="py-2 pr-3 font-medium">Availability</th>
                    <th className="py-2 pr-3 font-medium">Authentication &amp; Quota</th>
                    <th className="py-2 pr-3 font-medium">Coverage &amp; Rate Limits</th>
                    <th className="py-2 font-medium">Commercial &amp; Status Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {providerDocs.map((p) => {
                    const statusText =
                      p.availability === 'available_configured'
                        ? 'Configured in Vault'
                        : p.availability === 'available_open'
                        ? 'Open Access'
                        : p.availability === 'restricted_legacy_sunsetting'
                        ? 'Legacy (Sunsets Jan 2027)'
                        : p.availability === 'retired_unavailable'
                        ? 'Retired / Unavailable'
                        : 'Config Required';
                    const statusTone =
                      p.availability === 'available_configured' || p.availability === 'available_open'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : p.availability === 'retired_unavailable'
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-amber-700 dark:text-amber-400';
                    return (
                      <tr key={p.id} className="align-top text-slate-700 dark:text-slate-300">
                        <td className="py-2 pr-3">
                          <div className="font-semibold text-slate-900 dark:text-white">{p.name}</div>
                          <div className="text-[11px] font-mono text-slate-500 break-all">{p.officialEndpoint}</div>
                        </td>
                        <td className={`py-2 pr-3 font-medium whitespace-nowrap ${statusTone}`}>{statusText}</td>
                        <td className="py-2 pr-3 text-[11px] space-y-0.5">
                          <div>{p.authentication}</div>
                          <div className="text-slate-500">{p.pricingAndQuota}</div>
                        </td>
                        <td className="py-2 pr-3 text-[11px] space-y-0.5">
                          <div>{p.supportedCountriesAndLanguages}</div>
                          <div className="text-slate-500">{p.rateLimits}</div>
                        </td>
                        <td className="py-2 text-[11px] space-y-0.5">
                          <div>{p.commercialUsage}</div>
                          <div className="text-slate-500">{p.honestStatusNote}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Direct Website Intelligence Inspector */}
      {showUrlInspector && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                Safe Multi-Page Website Intelligence Inspector
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Inspects public homepage, about, products/services, contact, locations, and imprint pages with SSRF protection, robots.txt compliance, and per-attribute URL provenance (business info only — no personal contact harvesting).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowUrlInspector(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleDirectInspectWebsite} className="flex items-center gap-2">
            <input
              type="url"
              value={directInspectUrl}
              onChange={(e) => setDirectInspectUrl(e.target.value)}
              placeholder="https://www.nordicsemi.com"
              className="flex-1 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={isDirectInspecting || !directInspectUrl.trim()}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {isDirectInspecting ? 'Inspecting...' : 'Inspect Official Website'}
            </button>
          </form>

          {directInspectResult?.inspection && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-xs space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-300">
                <span className="font-semibold text-slate-900 dark:text-white">
                  {directInspectResult.inspection.businessName || directInspectResult.inspection.title || directInspectResult.inspection.domain}
                </span>
                <span className="text-slate-400">·</span>
                <span className="tabular-nums">
                  {directInspectResult.inspection.isOnline ? `HTTP ${directInspectResult.inspection.httpStatus}` : 'Offline'}
                </span>
                <span className="text-slate-400">·</span>
                <span className="tabular-nums">
                  {directInspectResult.inspection.pagesVisited?.length || 0} page(s) inspected
                </span>
              </div>
              {directInspectResult.inspection.description && (
                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                  {directInspectResult.inspection.description}
                </p>
              )}
              {directInspectResult.aiIntel?.businessSummary && (
                <p className="text-[11px] text-slate-700 dark:text-slate-200">
                  <strong>{directInspectResult.aiIntel.provenanceClassification === 'ai_extracted' ? 'AI-Extracted' : 'Inferred'} Summary:</strong>{' '}
                  {directInspectResult.aiIntel.businessSummary}
                </p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                <div>
                  <span className="font-medium text-slate-800 dark:text-slate-200">General Emails:</span>{' '}
                  {directInspectResult.inspection.emailsFound?.join(', ') || 'None published'}
                </div>
                <div>
                  <span className="font-medium text-slate-800 dark:text-slate-200">Public Phones:</span>{' '}
                  {directInspectResult.inspection.phonesFound?.join(', ') || 'None published'}
                </div>
                <div>
                  <span className="font-medium text-slate-800 dark:text-slate-200">Products/Services:</span>{' '}
                  {directInspectResult.inspection.productsServices?.join(', ') || 'Not listed'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Execution History Panel */}
      {showHistory && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Recent Discovery &amp; Enrichment Executions
            </h3>
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {isLoadingHistory ? (
            <p className="text-xs text-slate-500">Loading execution history...</p>
          ) : historyItems.length === 0 ? (
            <p className="text-xs text-slate-500">No recorded connector discovery runs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Connector</th>
                    <th className="py-1.5 pr-3 font-medium">Operation</th>
                    <th className="py-1.5 pr-3 font-medium">Query</th>
                    <th className="py-1.5 pr-3 font-medium">Status</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Records</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Duration</th>
                    <th className="py-1.5 pr-3 font-medium">Timestamp</th>
                    <th className="py-1.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {historyItems.map((h) => (
                    <tr key={h.id} className="text-slate-700 dark:text-slate-300">
                      <td className="py-1.5 pr-3 font-medium">{h.connectorName}</td>
                      <td className="py-1.5 pr-3 font-mono text-[11px]">{h.operation}</td>
                      <td className="py-1.5 pr-3 max-w-[200px] truncate">
                        {String(h.queryParams?.query || h.queryParams?.url || h.diagnosticSummary || '—')}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span
                          className={
                            h.status === 'success'
                              ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                              : h.status === 'cancelled'
                              ? 'text-amber-600 dark:text-amber-400 font-medium'
                              : 'text-rose-600 dark:text-rose-400 font-medium'
                          }
                        >
                          {h.status}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{h.recordsNormalized}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {h.durationMs !== undefined ? `${h.durationMs}ms` : '—'}
                      </td>
                      <td className="py-1.5 pr-3 text-[11px] text-slate-500 tabular-nums">
                        {new Date(h.startedAt).toLocaleString()}
                      </td>
                      <td className="py-1.5 text-right">
                        {h.operation === 'search' ? (
                          <button
                            type="button"
                            onClick={() => handleRerunHistory(h)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                          >
                            <Play className="w-2.5 h-2.5" />
                            <span>Re-run</span>
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Per-Connector Execution Summary & Legal Provenance */}
      {(connectorSummaries.length > 0 || attribution || providerNote || abnLookupInfo) && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5 text-xs">
          {connectorSummaries.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Connector Runs:</span>
              {connectorSummaries.map((cs, i) => (
                <div
                  key={`${cs.connectorId}-${i}`}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-[11px]"
                >
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {cs.shortName}
                    {cs.countryCode ? ` (${cs.countryCode})` : ''}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span
                    className={
                      cs.status === 'success'
                        ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                        : cs.status === 'skipped' || cs.status === 'cancelled'
                        ? 'text-amber-600 dark:text-amber-400 font-medium'
                        : 'text-rose-600 dark:text-rose-400 font-medium'
                    }
                  >
                    {cs.status}
                  </span>
                  <span className="text-slate-500 tabular-nums">
                    {cs.recordsNormalized} found · {cs.durationMs}ms
                  </span>
                </div>
              ))}
            </div>
          )}

          {abnLookupInfo && !abnLookupInfo.isLiveApi && (
            <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>Offline Reference / Checksum Mode:</strong> Live Australian Business Register lookups require an official ABR GUID. Results reflect local ATO Modulo-89 validation and reference records only.
              </span>
            </div>
          )}

          {attribution && (
            <div className="flex items-start gap-2 text-slate-600 dark:text-slate-400">
              <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <span>
                <strong className="text-slate-800 dark:text-slate-200">Data Provenance:</strong> {attribution}
              </span>
            </div>
          )}

          {providerNote && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400 pl-6">{providerNote}</div>
          )}

          {appliedFilters?.region && appliedFilters.regionSupportedByConnector === false && (
            <div className="text-[11px] text-amber-600 dark:text-amber-400 pl-6">
              Region filter &ldquo;{appliedFilters.region}&rdquo; recorded; upstream corporate registry endpoint does not filter natively by region.
            </div>
          )}
        </div>
      )}

      {/* Errors / Save Feedback Banners */}
      {errors.length > 0 && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-300 text-xs space-y-1">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Connector Notice</span>
          </div>
          {errors.map((err, i) => (
            <div key={i} className="pl-6">
              · {err}
            </div>
          ))}
        </div>
      )}

      {saveBanner && (
        <div
          className={`p-3 rounded-xl border text-xs space-y-1 ${
            saveBanner.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : saveBanner.type === 'warning'
              ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
          }`}
        >
          <div className="font-semibold">{saveBanner.message}</div>
          {saveBanner.details?.map((d, idx) => (
            <div key={idx} className="text-[11px] opacity-90">
              · {d}
            </div>
          ))}
        </div>
      )}

      {/* Results Toolbar */}
      {summaryStats && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
              {summaryStats.totalDiscovered} Businesses
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-600 dark:text-slate-300 tabular-nums">
              {summaryStats.totalUnique} New
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-blue-700 dark:text-blue-400 tabular-nums">
              {summaryStats.existingCrmMatches} In CRM
            </span>
            {summaryStats.ambiguousMatches > 0 && (
              <>
                <span className="text-slate-400">·</span>
                <span className="text-amber-700 dark:text-amber-400 font-medium tabular-nums">
                  {summaryStats.ambiguousMatches} Review
                </span>
              </>
            )}
            <span className="text-slate-400">·</span>
            <span className="text-slate-500 tabular-nums">{summaryStats.durationMs}ms</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Duplicate Filter */}
            <select
              value={duplicateFilter}
              onChange={(e) => {
                const next = e.target.value as any;
                setDuplicateFilter(next);
                fetchServerPage(1, next, sortBy);
              }}
              className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs rounded-md px-2 py-1"
            >
              <option value="all">All Results</option>
              <option value="unique">Unique / New Only</option>
              <option value="existing_crm">Existing CRM Matches</option>
              <option value="ambiguous">Ambiguous (Needs Review)</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => {
                const next = e.target.value as any;
                setSortBy(next);
                fetchServerPage(1, duplicateFilter, next);
              }}
              className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs rounded-md px-2 py-1"
            >
              <option value="confidence_desc">Sort: Confidence</option>
              <option value="name_asc">Sort: Name (A–Z)</option>
            </select>

            <select
              value={duplicatePolicy}
              onChange={(e) => setDuplicatePolicy(e.target.value as any)}
              className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs rounded-md px-2 py-1"
              title="How duplicates are handled when saving to CRM"
            >
              <option value="merge_preserve_crm">Save Policy: Merge (Preserve CRM Notes/Stage)</option>
              <option value="skip">Save Policy: Skip Duplicates</option>
            </select>

            {/* View Toggle */}
            <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`p-1 rounded ${
                  viewMode === 'cards' ? 'bg-white dark:bg-slate-800 text-blue-600' : 'text-slate-500'
                }`}
                title="Card View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`p-1 rounded ${
                  viewMode === 'table' ? 'bg-white dark:bg-slate-800 text-blue-600' : 'text-slate-500'
                }`}
                title="Table View"
              >
                <Table2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {searchId && results.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => handleExportDiscovery('csv')}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportDiscovery('json')}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition whitespace-nowrap shrink-0"
                >
                  <FileJson className="w-3.5 h-3.5" />
                  <span>Export JSON</span>
                </button>
              </>
            )}

            {results.length > 0 && (
              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  const chosen =
                    selectedIds.size > 0
                      ? results.filter((r) => selectedIds.has(r.id))
                      : results;
                  handleSaveLeads(chosen);
                }}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-md transition disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>
                  {selectedIds.size > 0
                    ? `Save Selected (${selectedIds.size})`
                    : 'Save Page to CRM'}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Results View (Cards or Table) */}
      {results.length > 0 && viewMode === 'table' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-2.5 px-3 w-8">
                    <button type="button" onClick={toggleSelectPage} className="text-slate-500 hover:text-blue-600">
                      {results.every((r) => selectedIds.has(r.id)) ? (
                        <CheckSquare className="w-4 h-4 text-blue-600" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="py-2.5 px-3 font-medium">Business</th>
                  <th className="py-2.5 px-3 font-medium">Location</th>
                  <th className="py-2.5 px-3 font-medium">Identifier &amp; Provenance</th>
                  <th className="py-2.5 px-3 font-medium">Industry</th>
                  <th className="py-2.5 px-3 font-medium text-right">Confidence</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {results.map((lead) => {
                  const isAdded = addedIds.has(lead.id);
                  const isSelected = selectedIds.has(lead.id);
                  const dup = duplicateInfoByLeadId[lead.id];
                  const ver = verificationLabel(lead);
                  return (
                    <tr
                      key={lead.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition text-slate-700 dark:text-slate-200"
                    >
                      <td className="py-2.5 px-3">
                        <button type="button" onClick={() => toggleSelectId(lead.id)}>
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-blue-600" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400" />
                          )}
                        </button>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-900 dark:text-white">{lead.companyName}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2">
                          <span>{lead.sources?.[0]?.sourceName}</span>
                          {sanitizeExternalUrl(lead.website) && (
                            <a
                              href={sanitizeExternalUrl(lead.website)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5"
                            >
                              <span>{lead.domain || 'Website'}</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div>
                          {lead.address?.city || '—'}
                          {lead.address?.postalCode ? ` ${lead.address.postalCode}` : ''}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {lead.address?.country} ({lead.address?.countryCode})
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-mono text-[11px]">
                          {lead.registrationNumber
                            ? `${lead.registrationType || 'ID'}: ${lead.registrationNumber}`
                            : 'No Registry ID'}
                        </div>
                        <div className={`text-[11px] font-medium ${ver.tone}`}>{ver.text}</div>
                      </td>
                      <td className="py-2.5 px-3 max-w-[180px] truncate">{lead.industry}</td>
                      <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                        {lead.confidenceScore}%
                      </td>
                      <td className="py-2.5 px-3">{duplicateStatusIndicator(dup) || <span className="text-slate-400">New</span>}</td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap space-x-1.5">
                        <button
                          type="button"
                          onClick={() => setInspectedCandidate(lead)}
                          className="px-2 py-1 text-[11px] rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          Inspect
                        </button>
                        <button
                          type="button"
                          disabled={isAdded || isSaving}
                          onClick={() => handleSaveLeads([lead])}
                          className={`px-2.5 py-1 text-[11px] font-semibold rounded ${
                            isAdded
                              ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40'
                              : 'bg-blue-600 hover:bg-blue-700 text-white'
                          }`}
                        >
                          {isAdded ? 'Saved' : 'Add'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {results.length > 0 && viewMode === 'cards' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {results.map((lead) => {
            const isAdded = addedIds.has(lead.id);
            const isSelected = selectedIds.has(lead.id);
            const dup = duplicateInfoByLeadId[lead.id];
            const ver = verificationLabel(lead);

            return (
              <div
                key={lead.id}
                className={`bg-white dark:bg-slate-900 border rounded-xl p-4 flex flex-col justify-between transition ${
                  isSelected
                    ? 'border-blue-500 dark:border-blue-500'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => toggleSelectId(lead.id)}
                        className="mt-0.5 text-slate-400 hover:text-blue-600 shrink-0"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5 truncate">
                          <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                          <span className="truncate">{lead.companyName}</span>
                        </h3>
                        <div className="flex items-center gap-2 text-[11px] mt-0.5 flex-wrap">
                          <span className={`font-medium ${ver.tone}`}>{ver.text}</span>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="text-slate-500 dark:text-slate-400">
                            {lead.sources?.[0]?.sourceName}
                          </span>
                          {dup && dup.status !== 'unique' && (
                            <>
                              <span className="text-slate-300 dark:text-slate-700">·</span>
                              {duplicateStatusIndicator(dup)}
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 tabular-nums shrink-0">
                      {lead.confidenceScore}% Confidence
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div>
                      <span className="text-slate-400 text-[10px] uppercase tracking-wide block">
                        Registration ID
                      </span>
                      <span className="font-mono text-slate-800 dark:text-slate-200">
                        {lead.registrationNumber
                          ? `${lead.registrationType ? `${lead.registrationType}: ` : ''}${lead.registrationNumber}`
                          : 'Not listed'}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 text-[10px] uppercase tracking-wide block">
                        Location
                      </span>
                      <span className="text-slate-800 dark:text-slate-200">
                        {lead.address?.city || '—'}
                        {lead.address?.postalCode ? ` ${lead.address.postalCode}` : ''} ({lead.address?.countryCode})
                      </span>
                    </div>

                    <div className="col-span-2">
                      <span className="text-slate-400 text-[10px] block">
                        Industry &amp; Offerings
                      </span>
                      <span className="text-slate-800 dark:text-slate-200">
                        {lead.industry}
                        {lead.webMetadata?.productsServices?.length
                          ? ` · ${lead.webMetadata.productsServices.slice(0, 3).join(', ')}`
                          : ''}
                      </span>
                    </div>
                  </div>

                  {lead.address?.formattedAddress && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-1">
                      <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{lead.address.formattedAddress}</span>
                    </div>
                  )}

                  {dup?.note && (
                    <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-md px-2.5 py-1.5">
                      {dup.matchedLeadName ? `Matched "${dup.matchedLeadName}": ` : ''}
                      {dup.note}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    {sanitizeExternalUrl(lead.website) && (
                      <a
                        href={sanitizeExternalUrl(lead.website)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                      >
                        <Globe2 className="w-3.5 h-3.5" />
                        <span>{lead.domain || 'Website'}</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                    <button
                      type="button"
                      disabled={isEnrichingId === lead.id}
                      onClick={() =>
                        handleEnrichCandidate(lead, {
                          runWebInspector: Boolean(lead.website || lead.domain),
                          runAi: true,
                        })
                      }
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 disabled:opacity-50"
                    >
                      {isEnrichingId === lead.id ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3" />
                      )}
                      <span>Enrich</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setInspectedCandidate(lead)}
                      className="px-2.5 py-1 text-xs text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-md transition"
                    >
                      Details
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSaveLeads([lead])}
                      disabled={isAdded || isSaving}
                      className={`flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-md transition ${
                        isAdded
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      {isAdded ? (
                        <>
                          <Check className="w-3 h-3" />
                          <span>Saved to CRM</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-3 h-3" />
                          <span>Add to CRM</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Server-side Pagination Controls */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 text-xs text-slate-600 dark:text-slate-400">
          <span className="tabular-nums">
            Page {pagination.page} of {pagination.totalPages} ({pagination.totalItems} matching records)
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={isLoading || pagination.page <= 1}
              onClick={() => fetchServerPage(pagination.page - 1)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Prev</span>
            </button>
            <button
              type="button"
              disabled={isLoading || !pagination.hasMore}
              onClick={() => fetchServerPage(pagination.page + 1)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Discovery Candidate Detail & Enrichment Drawer */}
      {inspectedCandidate && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50">
          <div className="w-full max-w-xl bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 h-full overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  {inspectedCandidate.companyName}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {inspectedCandidate.sources?.[0]?.sourceName} · {verificationLabel(inspectedCandidate).text}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedCandidate(null)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Duplicate Comparison Alert if Present */}
            {duplicateInfoByLeadId[inspectedCandidate.id] &&
              duplicateInfoByLeadId[inspectedCandidate.id].status !== 'unique' && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      {duplicateInfoByLeadId[inspectedCandidate.id].requiresReview
                        ? 'Ambiguous Match — Owner Review Recommended'
                        : 'Duplicate / Corroboration Detected'}
                    </span>
                    {duplicateInfoByLeadId[inspectedCandidate.id].requiresReview &&
                      duplicateInfoByLeadId[inspectedCandidate.id].matchedLeadId && (
                        <button
                          type="button"
                          disabled={isAssessingDupId === inspectedCandidate.id}
                          onClick={() =>
                            handleAssessDuplicateWithAi(
                              inspectedCandidate,
                              duplicateInfoByLeadId[inspectedCandidate.id]
                            )
                          }
                          className="px-2 py-1 text-[11px] font-medium rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 text-amber-900 dark:text-amber-200 hover:bg-amber-100/60 whitespace-nowrap"
                        >
                          {isAssessingDupId === inspectedCandidate.id ? 'Assessing...' : 'AI Duplicate Review'}
                        </button>
                      )}
                  </div>
                  <div>{duplicateInfoByLeadId[inspectedCandidate.id].note}</div>
                  {duplicateAssessments[inspectedCandidate.id] && (
                    <div className="pt-1.5 border-t border-amber-200/70 dark:border-amber-800/70 text-[11px] space-y-0.5">
                      <div className="font-medium">
                        Inferred Review ({duplicateAssessments[inspectedCandidate.id].engine}):{' '}
                        {duplicateAssessments[inspectedCandidate.id].assessment.replace(/_/g, ' ')}
                      </div>
                      <div>{duplicateAssessments[inspectedCandidate.id].explanation}</div>
                    </div>
                  )}
                </div>
              )}

            {/* Enrichment Triggers */}
            <div className="flex items-center gap-2 flex-wrap">
              {(inspectedCandidate.website || inspectedCandidate.domain) && (
                <button
                  type="button"
                  disabled={isEnrichingId === inspectedCandidate.id}
                  onClick={() =>
                    handleEnrichCandidate(inspectedCandidate, { runWebInspector: true, runAi: false })
                  }
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Inspect Website (SSRF Safe)
                </button>
              )}
              <button
                type="button"
                disabled={isEnrichingId === inspectedCandidate.id}
                onClick={() =>
                  handleEnrichCandidate(inspectedCandidate, { runWebInspector: false, runAi: true })
                }
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
              >
                Run Gemini AI Qualification Brief
              </button>
            </div>

            {inspectedCandidate.customFields?.aiSummary && (
              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-1.5">
                <div className="font-semibold text-slate-900 dark:text-white flex items-center justify-between">
                  <span>AI Qualification Brief (Inferred)</span>
                  <span className="text-indigo-600 dark:text-indigo-400 tabular-nums">
                    {inspectedCandidate.customFields.aiQualification} · {inspectedCandidate.customFields.aiFitScore}%
                  </span>
                </div>
                <p className="text-slate-600 dark:text-slate-300">{inspectedCandidate.customFields.aiSummary}</p>
                <div className="text-[11px] text-slate-400">Engine: {inspectedCandidate.customFields.aiEngine}</div>
              </div>
            )}

            {inspectedCandidate.webMetadata?.inspectedAt && (
              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-2">
                <div className="font-semibold text-slate-900 dark:text-white flex items-center justify-between">
                  <span>Website Observation (HTTP {inspectedCandidate.webMetadata.httpStatus})</span>
                  <span className="text-[11px] font-normal text-slate-500 tabular-nums">
                    {inspectedCandidate.webMetadata.pagesVisited?.length || 1} page(s)
                  </span>
                </div>
                {inspectedCandidate.webMetadata.title && (
                  <div className="text-slate-700 dark:text-slate-300">{inspectedCandidate.webMetadata.title}</div>
                )}
                {inspectedCandidate.webMetadata.description && (
                  <div className="text-slate-500 text-[11px]">{inspectedCandidate.webMetadata.description}</div>
                )}
                <div className="grid grid-cols-1 gap-1 text-[11px] text-slate-600 dark:text-slate-400 pt-1">
                  {inspectedCandidate.webMetadata.productsServices?.length ? (
                    <div>
                      <span className="font-medium text-slate-800 dark:text-slate-200">Products &amp; Services:</span>{' '}
                      {inspectedCandidate.webMetadata.productsServices.join(', ')}
                    </div>
                  ) : null}
                  {inspectedCandidate.webMetadata.locationsServed?.length ? (
                    <div>
                      <span className="font-medium text-slate-800 dark:text-slate-200">Locations Served:</span>{' '}
                      {inspectedCandidate.webMetadata.locationsServed.join(', ')}
                    </div>
                  ) : null}
                  {inspectedCandidate.webMetadata.operatingInfo ? (
                    <div>
                      <span className="font-medium text-slate-800 dark:text-slate-200">Operating Info:</span>{' '}
                      {inspectedCandidate.webMetadata.operatingInfo}
                    </div>
                  ) : null}
                  {inspectedCandidate.webMetadata.emailsFound?.length ? (
                    <div>
                      <span className="font-medium text-slate-800 dark:text-slate-200">General Business Emails:</span>{' '}
                      {inspectedCandidate.webMetadata.emailsFound.join(', ')}
                    </div>
                  ) : null}
                  {inspectedCandidate.webMetadata.phonesFound?.length ? (
                    <div>
                      <span className="font-medium text-slate-800 dark:text-slate-200">Public Phones:</span>{' '}
                      {inspectedCandidate.webMetadata.phonesFound.join(', ')}
                    </div>
                  ) : null}
                  {inspectedCandidate.webMetadata.addressesFound?.length ? (
                    <div>
                      <span className="font-medium text-slate-800 dark:text-slate-200">Published Addresses:</span>{' '}
                      {inspectedCandidate.webMetadata.addressesFound.join(' | ')}
                    </div>
                  ) : null}
                </div>
                {(inspectedCandidate.webMetadata.aboutPageUrl ||
                  inspectedCandidate.webMetadata.productsPageUrl ||
                  inspectedCandidate.webMetadata.contactPageUrl ||
                  inspectedCandidate.webMetadata.locationsPageUrl ||
                  inspectedCandidate.webMetadata.imprintPageUrl) && (
                  <div className="flex items-center gap-3 flex-wrap pt-1 text-[11px]">
                    {[
                      { label: 'About', url: inspectedCandidate.webMetadata.aboutPageUrl },
                      { label: 'Products', url: inspectedCandidate.webMetadata.productsPageUrl },
                      { label: 'Contact', url: inspectedCandidate.webMetadata.contactPageUrl },
                      { label: 'Locations', url: inspectedCandidate.webMetadata.locationsPageUrl },
                      { label: 'Imprint', url: inspectedCandidate.webMetadata.imprintPageUrl },
                    ]
                      .filter((p) => sanitizeExternalUrl(p.url))
                      .map((p) => (
                        <a
                          key={p.label}
                          href={sanitizeExternalUrl(p.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5"
                        >
                          <span>{p.label}</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Attribute-Level Source Provenance Ledger */}
            {inspectedCandidate.webMetadata?.attributeProvenance &&
              Object.keys(inspectedCandidate.webMetadata.attributeProvenance).length > 0 && (
                <div className="space-y-2 text-xs">
                  <h4 className="font-semibold text-slate-800 dark:text-slate-200">
                    Attribute Provenance &amp; Verification Tiers
                  </h4>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                    {Object.values(inspectedCandidate.webMetadata.attributeProvenance).map((prov, idx) => (
                      <div key={idx} className="p-2.5 space-y-0.5 text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-900 dark:text-white">{prov.attribute}</span>
                          <span className="text-slate-600 dark:text-slate-300 font-medium">
                            {provenanceLabel(prov.sourceType)}
                          </span>
                        </div>
                        {prov.value && (
                          <div className="text-slate-700 dark:text-slate-300 truncate">{prov.value}</div>
                        )}
                        <div className="text-slate-500 flex items-center justify-between gap-2 tabular-nums">
                          <span className="truncate">{prov.sourceUrl || prov.sourceName}</span>
                          <span className="shrink-0">{new Date(prov.retrievedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            <div className="space-y-2 text-xs">
              <h4 className="font-semibold text-slate-800 dark:text-slate-200">Canonical Identifiers &amp; Provenance</h4>
              {inspectedCandidate.identifiers.length === 0 ? (
                <p className="text-slate-500">No external identifiers listed.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                  {inspectedCandidate.identifiers.map((ident, idx) => (
                    <div key={idx} className="p-2.5 flex items-center justify-between gap-2">
                      <div>
                        <span className="font-mono font-semibold text-slate-900 dark:text-white">
                          {ident.type}: {ident.value}
                        </span>
                        <div className="text-[11px] text-slate-500">
                          {ident.issuingAuthority || ident.source || 'Discovery Source'}
                        </div>
                      </div>
                      <span
                        className={`text-[11px] font-medium ${
                          ident.verified
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-500'
                        }`}
                      >
                        {ident.status || (ident.verified ? 'verified' : 'discovered')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Phase 11: Company-to-Person Decision-Maker Investigation */}
            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Investigate Decision-Makers</span>
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Inspect official website leadership, officer registries, Wikidata, and configured authorized providers before saving approved contacts with this company.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={drawerDmRoleFilter}
                  onChange={(e) => setDrawerDmRoleFilter(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  <option value="">All Decision-Maker Roles</option>
                  {EXPANDED_RELATIONSHIP_TYPES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_TAXONOMY_SPECS[role].label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={isDrawerDmLoading}
                  onClick={() => handleInvestigateDrawerDecisionMakers(inspectedCandidate)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white whitespace-nowrap shrink-0 inline-flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isDrawerDmLoading ? 'animate-spin' : ''}`} />
                  <span>{isDrawerDmLoading ? 'Investigating...' : 'Find Decision-Makers'}</span>
                </button>
              </div>

              {drawerDmError && (
                <div className="p-2 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-[11px]">
                  {drawerDmError}
                </div>
              )}

              {drawerDmSuccess && (
                <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-[11px]">
                  {drawerDmSuccess}
                </div>
              )}

              {drawerDmResult && (
                <div className="space-y-2.5">
                  <div className="text-[11px] text-slate-600 dark:text-slate-300">
                    {drawerDmResult.honestStatusNote}
                  </div>
                  <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[10px] font-mono text-slate-500">
                    {drawerDmResult.sourceSummaries.map((s) => (
                      <span key={s.sourceId}>
                        {s.sourceName}:{' '}
                        {s.status === 'success'
                          ? `${s.candidatesFound} found`
                          : s.status.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>

                  {drawerDmResult.candidates.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                          {drawerDmResult.candidates.length} candidate(s) · {drawerSelectedDmIds.size} selected
                        </span>
                        <button
                          type="button"
                          disabled={drawerSelectedDmIds.size === 0 || isSavingDrawerDm}
                          onClick={() => handleSaveCompanyWithApprovedContacts(inspectedCandidate)}
                          className="px-2.5 py-1 text-[11px] font-semibold rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white whitespace-nowrap shrink-0"
                        >
                          {isSavingDrawerDm
                            ? 'Saving...'
                            : `Save Company + Approved Contacts (${drawerSelectedDmIds.size})`}
                        </button>
                      </div>

                      <div className="space-y-1.5 max-h-60 overflow-y-auto">
                        {drawerDmResult.candidates.map((cand) => {
                          const selected = drawerSelectedDmIds.has(cand.candidateId);
                          return (
                            <div
                              key={cand.candidateId}
                              className={`p-2.5 rounded-md border text-[11px] space-y-1 ${
                                selected
                                  ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-300 dark:border-indigo-700'
                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDrawerSelectedDmIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(cand.candidateId)) next.delete(cand.candidateId);
                                      else next.add(cand.candidateId);
                                      return next;
                                    })
                                  }
                                  className="flex items-start gap-2 text-left min-w-0"
                                >
                                  {selected ? (
                                    <CheckSquare className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                                  ) : (
                                    <Square className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="font-semibold text-slate-900 dark:text-white">
                                      {cand.fullName}{' '}
                                      <span className="font-normal text-slate-500">
                                        · {cand.jobTitle || cand.relationshipType}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-slate-500">
                                      {cand.employmentStatus === 'historical'
                                        ? `Historical${cand.endedAt ? ` (ended ${cand.endedAt})` : ''}`
                                        : 'Current'}{' '}
                                      · {cand.verificationTier.replace(/_/g, ' ')} · {cand.confidenceScore}% conf
                                    </div>
                                  </div>
                                </button>
                              </div>
                              {cand.uncertainMatch && (
                                <div className="text-[10px] text-amber-700 dark:text-amber-300">
                                  Uncertain match with existing CRM contact (review before linking).
                                </div>
                              )}
                              {cand.relevanceExplanation && (
                                <div className="text-[10px] text-slate-500">
                                  {cand.relevanceExplanation}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Phase 12: Candidate Multi-Source Enrichment & Contact Verification Preview */}
            <div className="pt-2">
              <LeadEnrichmentPanel lead={inspectedCandidate} mode="candidate" />
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  onInspectLead(inspectedCandidate);
                  setInspectedCandidate(null);
                }}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
              >
                Open Full Lead Inspector
              </button>
              <button
                type="button"
                onClick={() => handleSaveLeads([inspectedCandidate])}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
              >
                Save to CRM Pipeline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
