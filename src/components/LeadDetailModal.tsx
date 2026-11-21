import React, { useState, useEffect } from 'react';
import { sanitizeExternalUrl } from '../utils/safeUrl.ts';
import {
  X,
  Building2,
  MapPin,
  ExternalLink,
  Mail,
  Phone,
  ShieldCheck,
  Tag,
  Calendar,
  Globe2,
  Sparkles,
  Bot,
  Plus,
  Send,
  MessageSquare,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  DollarSign,
  Radio,
  Edit3,
  Save,
  AlertTriangle,
  RefreshCw,
  Scale,
  Users,
  Linkedin,
  Trash2,
  Briefcase,
  Search,
  Star,
  History,
  CheckSquare,
  Square,
} from 'lucide-react';
import {
  AttributeSourceProvenance,
  CanonicalLead,
  PipelineStage,
  LeadIdentifier,
  RegistryVerificationReport,
  VerificationConflict,
  VerificationHistoryEntry,
  RegistryVerificationState,
  LinkedPersonWithRelationship,
  DecisionMakerCandidate,
  DecisionMakerDiscoveryResponse,
  AiAgentLaunchContext,
  OutreachLaunchContext,
} from '../types.ts';
import { GeoSelector } from './GeoSelector.tsx';
import { LeadEnrichmentPanel } from './LeadEnrichmentPanel.tsx';
import { CompanyRelationshipPanel } from './CompanyRelationshipPanel.tsx';
import { apiFetch } from '../utils/apiFetch.ts';
import { ActionMenu } from './ui/SunsetUI.tsx';
import {
  EXPANDED_RELATIONSHIP_TYPES,
  ROLE_TAXONOMY_SPECS,
} from '../../shared/decisionMakerRoles.ts';
import {
  getUiIdentifierOptions,
  canonicalizeIdentifierType,
  getDefaultIdentifierTypeForCountry,
} from '../../shared/identifierRegistry.ts';
import {
  formatCurrencyLocale,
  formatDateLocale,
  getLocaleForCountry,
  getTimezoneForCountry,
} from '../../shared/localization.ts';

function getCountryFlag(code?: string): string {
  if (!code || code.length !== 2) return '🌐';
  try {
    const c = code.toUpperCase();
    const codePoints = [...c].map((char) => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  } catch {
    return '🌐';
  }
}

function getStatusBadge(status?: string, verified?: boolean) {
  if (status === 'officially_verified' || verified) {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
        Officially Verified
      </span>
    );
  }
  if (status === 'syntax_validated') {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center gap-1">
        <ShieldCheck className="w-3 h-3 text-blue-400" />
        Syntax Validated
      </span>
    );
  }
  if (status === 'discovered') {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
        <AlertCircle className="w-3 h-3 text-amber-400" />
        Discovered
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
      User Provided
    </span>
  );
}

function parseVerificationConflicts(customFields?: Record<string, string>): VerificationConflict[] {
  if (!customFields?.verificationConflicts) return [];
  try {
    const parsed = JSON.parse(customFields.verificationConflicts);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseVerificationHistory(customFields?: Record<string, string>): VerificationHistoryEntry[] {
  if (!customFields?.verificationHistory) return [];
  try {
    const parsed = JSON.parse(customFields.verificationHistory);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseAttributeSources(
  customFields?: Record<string, string>
): Record<string, AttributeSourceProvenance> {
  if (!customFields?.attributeSources) return {};
  try {
    const parsed = JSON.parse(customFields.attributeSources);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, AttributeSourceProvenance>)
      : {};
  } catch {
    return {};
  }
}

function renderRegistryStateBadge(state?: string) {
  switch (state as RegistryVerificationState) {
    case 'officially_verified':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
          <CheckCircle2 className="w-3 h-3" />
          <span>Officially Verified</span>
        </span>
      );
    case 'probable_match':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/40">
          <ShieldCheck className="w-3 h-3" />
          <span>Probable Match</span>
        </span>
      );
    case 'conflict_detected':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40">
          <AlertTriangle className="w-3 h-3" />
          <span>Conflict Detected</span>
        </span>
      );
    case 'offline_reference':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40">
          <AlertCircle className="w-3 h-3" />
          <span>Offline Reference Only</span>
        </span>
      );
    case 'not_found':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
          <AlertCircle className="w-3 h-3" />
          <span>Not Found in Registry</span>
        </span>
      );
    case 'unavailable':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
          <AlertCircle className="w-3 h-3" />
          <span>Registry Unavailable</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
          <span>Not Verified Yet</span>
        </span>
      );
  }
}

function renderLegalCompanyStatusBadge(status?: CanonicalLead['companyStatus']) {
  switch (status) {
    case 'active':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 uppercase">
          Active
        </span>
      );
    case 'inactive':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 uppercase">
          Inactive
        </span>
      );
    case 'dissolved':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30 uppercase">
          Dissolved
        </span>
      );
    default:
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700 uppercase">
          Unknown
        </span>
      );
  }
}

interface LeadDetailModalProps {
  lead: CanonicalLead | null;
  stages: PipelineStage[];
  onClose: () => void;
  onUpdateLead: (lead: CanonicalLead) => void;
  onLeadVerified?: (lead: CanonicalLead) => void;
  onAddNote: (leadId: string, content: string) => void;
  onAddActivity: (leadId: string, activity: any) => void;
  onInspectUrl: (url: string, leadId: string) => Promise<any>;
  onOpenPersonProfile?: (personId: string) => void;
  onOpenAiAgent?: (ctx: AiAgentLaunchContext) => void;
  onOpenOutreach?: (ctx: OutreachLaunchContext) => void;
  onRefreshData?: () => void;
}

export const LeadDetailModal: React.FC<LeadDetailModalProps> = ({
  lead,
  stages,
  onClose,
  onUpdateLead,
  onLeadVerified,
  onAddNote,
  onAddActivity,
  onInspectUrl,
  onOpenPersonProfile,
  onOpenAiAgent,
  onOpenOutreach,
  onRefreshData,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'relationship' | 'enrichment' | 'contacts' | 'web' | 'ai' | 'timeline' | 'notes'>('overview');
  const [newNote, setNewNote] = useState('');
  const [newTag, setNewTag] = useState('');
  const [oppValue, setOppValue] = useState(lead?.opportunityValue?.toString() || '');
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectionResult, setInspectionResult] = useState<any>(null);

  // International Identifier state
  const [newIdentType, setNewIdentType] = useState<string>(
    getDefaultIdentifierTypeForCountry(lead?.address?.countryCode)
  );
  const [newIdentValue, setNewIdentValue] = useState('');
  const [newIdentCountry, setNewIdentCountry] = useState(lead?.address?.countryCode || 'GB');
  const [newIdentAuthority, setNewIdentAuthority] = useState('');
  const [isAddingIdent, setIsAddingIdent] = useState(false);
  const [identValidationFeedback, setIdentValidationFeedback] = useState<{
    valid: boolean;
    normalizedValue?: string;
    issuingAuthority?: string;
    status?: string;
    message?: string;
  } | null>(null);

  // Location & Contact Edit state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editGeo, setEditGeo] = useState({
    countryCode: lead?.address?.countryCode || 'US',
    countryName: lead?.address?.country || 'United States',
    region: lead?.address?.region || '',
    city: lead?.address?.city || '',
    postalCode: lead?.address?.postalCode || '',
    street: lead?.address?.street || '',
    currency: lead?.currency || 'USD',
  });
  const [editPhone, setEditPhone] = useState(lead?.phone || '');
  const [editEmail, setEditEmail] = useState(lead?.email || '');
  const [editWebsite, setEditWebsite] = useState(lead?.website || '');
  const [editProfileError, setEditProfileError] = useState<string | null>(null);

  // Official Registry Verification state
  const [isVerifyingRegistry, setIsVerifyingRegistry] = useState(false);
  const [verificationReport, setVerificationReport] = useState<RegistryVerificationReport | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  // AI Quick Actions state
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [aiPitch, setAiPitch] = useState<any>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Decision-Makers & M:N Relationships state
  const [linkedPersons, setLinkedPersons] = useState<LinkedPersonWithRelationship[]>([]);
  const [loadingPersons, setLoadingPersons] = useState(false);
  const [isAddingPerson, setIsAddingPerson] = useState(false);
  const [savingPerson, setSavingPerson] = useState(false);
  const [personError, setPersonError] = useState<string | null>(null);
  const [personForm, setPersonForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    linkedinUrl: '',
    relationshipType: 'director',
    jobTitle: '',
    designation: '',
    department: '',
    isPrimaryContact: false,
  });

  // Phase 11 Decision-Maker Discovery & Approval state
  const [dmTargetJobTitle, setDmTargetJobTitle] = useState('');
  const [dmTargetDepartment, setDmTargetDepartment] = useState('');
  const [dmTargetRole, setDmTargetRole] = useState('');
  const [dmIncludeHistorical, setDmIncludeHistorical] = useState(true);
  const [isDiscoveringDm, setIsDiscoveringDm] = useState(false);
  const [dmDiscoveryResult, setDmDiscoveryResult] = useState<DecisionMakerDiscoveryResponse | null>(null);
  const [dmError, setDmError] = useState<string | null>(null);
  const [selectedDmIds, setSelectedDmIds] = useState<Set<string>>(new Set());
  const [isApprovingDm, setIsApprovingDm] = useState(false);
  const [dmSaveBanner, setDmSaveBanner] = useState<string | null>(null);
  const [dmAiPlan, setDmAiPlan] = useState<{
    suggestedQueries: string[];
    targetTitles: string[];
    rationale: string;
    engine: string;
  } | null>(null);
  const [isPlanningDmAi, setIsPlanningDmAi] = useState(false);

  // Inline Edit & Provenance for saved linked contacts
  const [expandedContactProvId, setExpandedContactProvId] = useState<string | null>(null);
  const [editingRelId, setEditingRelId] = useState<string | null>(null);
  const [editContactForm, setEditContactForm] = useState({
    personId: '',
    fullName: '',
    email: '',
    phone: '',
    linkedinUrl: '',
    relationshipType: 'director',
    jobTitle: '',
    department: '',
  });

  const fetchLinkedPersons = async (leadId: string) => {
    setLoadingPersons(true);
    try {
      const res = await apiFetch(`/api/leads/${leadId}/persons`);
      if (res.ok) {
        const data = await res.json();
        setLinkedPersons(data.persons || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingPersons(false);
    }
  };

  // Keep modal local state synced when active lead changes
  useEffect(() => {
    if (!lead) return;
    setOppValue(lead.opportunityValue?.toString() || '');
    setNewIdentCountry(lead.address?.countryCode || 'GB');
    setNewIdentType(getDefaultIdentifierTypeForCountry(lead.address?.countryCode));
    setEditGeo({
      countryCode: lead.address?.countryCode || 'US',
      countryName: lead.address?.country || 'United States',
      region: lead.address?.region || '',
      city: lead.address?.city || '',
      postalCode: lead.address?.postalCode || '',
      street: lead.address?.street || '',
      currency: lead.currency || 'USD',
    });
    setEditPhone(lead.phone || '');
    setEditEmail(lead.email || '');
    setEditWebsite(lead.website || '');
    setEditProfileError(null);
    setIsEditingProfile(false);
    setAiAnalysis(null);
    setAiPitch(null);
    setAiError(null);
    setInspectionResult(null);
    setVerificationReport(null);
    setVerificationError(null);
    setIsAddingPerson(false);
    setPersonError(null);
    setDmDiscoveryResult(null);
    setDmError(null);
    setSelectedDmIds(new Set());
    setDmSaveBanner(null);
    setDmAiPlan(null);
    setEditingRelId(null);
    setExpandedContactProvId(null);
    fetchLinkedPersons(lead.id);
  }, [lead?.id]);

  if (!lead) return null;

  const storedConflicts = parseVerificationConflicts(lead.customFields);
  const activeConflicts = verificationReport?.conflicts ?? storedConflicts;
  const verificationHistory = parseVerificationHistory(lead.customFields);
  const activeAttributeSources =
    verificationReport?.attributeSources ?? parseAttributeSources(lead.customFields);
  const lastVerifiedAt = lead.customFields?.lastVerifiedAt;
  const lastVerificationSource = lead.customFields?.lastVerificationSource;
  const lastVerificationSourceUrl = lead.customFields?.lastVerificationSourceUrl;
  const lastRegistryState = lead.customFields?.lastRegistryState;
  const lastVerificationMatchType = lead.customFields?.lastVerificationMatchType;

  const handleVerifyWithOfficialRegistry = async () => {
    setIsVerifyingRegistry(true);
    setVerificationError(null);
    try {
      const res = await apiFetch(`/api/leads/${lead.id}/verify-registry`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Official registry verification failed');
      }
      if (data.report) setVerificationReport(data.report);
      if (data.lead) {
        if (onLeadVerified) {
          onLeadVerified(data.lead);
        } else {
          onUpdateLead(data.lead);
        }
      }
    } catch (err: unknown) {
      setVerificationError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsVerifyingRegistry(false);
    }
  };

  const handleAddPersonSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!personForm.fullName.trim()) return;
    setSavingPerson(true);
    setPersonError(null);
    try {
      const res = await apiFetch(`/api/leads/${lead.id}/persons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...personForm,
          countryCode: lead.address?.countryCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPersonError(data.error || 'Failed to add contact');
        return;
      }
      setPersonForm({
        fullName: '',
        email: '',
        phone: '',
        linkedinUrl: '',
        relationshipType: 'director',
        jobTitle: '',
        designation: '',
        department: '',
        isPrimaryContact: false,
      });
      setIsAddingPerson(false);
      await fetchLinkedPersons(lead.id);
    } catch (err: unknown) {
      setPersonError(err instanceof Error ? err.message : 'Failed to link person');
    } finally {
      setSavingPerson(false);
    }
  };

  const handleUnlinkPerson = async (relationshipId: string) => {
    try {
      const res = await apiFetch(`/api/leads/${lead.id}/persons/${relationshipId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setLinkedPersons((prev) => prev.filter((item) => item.relationship.id !== relationshipId));
      }
    } catch {
      // ignore
    }
  };

  const handleSetPrimaryContact = async (relationshipId: string) => {
    try {
      const res = await apiFetch(`/api/leads/${lead.id}/persons/${relationshipId}/primary`, {
        method: 'PUT',
      });
      if (res.ok) {
        const data = await res.json();
        setLinkedPersons(data.persons || []);
      }
    } catch {
      // ignore
    }
  };

  const handleToggleEmploymentStatus = async (relationshipId: string, currentStatus?: string) => {
    const nextStatus = currentStatus === 'historical' ? 'current' : 'historical';
    try {
      const res = await apiFetch(`/api/leads/${lead.id}/persons/${relationshipId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employmentStatus: nextStatus,
          endedAt: nextStatus === 'historical' ? new Date().toISOString().slice(0, 10) : undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setLinkedPersons(data.persons || []);
      }
    } catch {
      // ignore
    }
  };

  const handleStartEditContact = (item: LinkedPersonWithRelationship) => {
    setEditingRelId(item.relationship.id);
    setEditContactForm({
      personId: item.person.id,
      fullName: item.person.fullName,
      email: item.person.email || '',
      phone: item.person.phoneNormalized || item.person.phone || '',
      linkedinUrl: item.person.linkedinUrl || '',
      relationshipType: item.relationship.relationshipType || 'director',
      jobTitle: item.relationship.jobTitle || '',
      department: item.relationship.department || '',
    });
  };

  const handleSaveEditContact = async (e: React.FormEvent, relationshipId: string) => {
    e.preventDefault();
    try {
      await apiFetch(`/api/persons/${editContactForm.personId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: editContactForm.fullName,
          email: editContactForm.email || undefined,
          phone: editContactForm.phone || undefined,
          linkedinUrl: editContactForm.linkedinUrl || undefined,
        }),
      });
      const relRes = await apiFetch(`/api/leads/${lead.id}/persons/${relationshipId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relationshipType: editContactForm.relationshipType,
          jobTitle: editContactForm.jobTitle || undefined,
          department: editContactForm.department || undefined,
        }),
      });
      if (relRes.ok) {
        const data = await relRes.json();
        setLinkedPersons(data.persons || []);
        setEditingRelId(null);
      }
    } catch {
      // ignore
    }
  };

  const handleGenerateDmAiPlan = async () => {
    setIsPlanningDmAi(true);
    setDmError(null);
    try {
      const res = await apiFetch('/api/decision-makers/ai-queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: lead.companyName,
          domain: lead.domain,
          countryCode: lead.address?.countryCode,
          industry: lead.industry,
          targetJobTitle: dmTargetJobTitle.trim() || undefined,
          targetDepartment: dmTargetDepartment.trim() || undefined,
          targetRelationshipType: dmTargetRole || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate AI query plan');
      setDmAiPlan(data);
    } catch (err: unknown) {
      setDmError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsPlanningDmAi(false);
    }
  };

  const handleDiscoverDecisionMakers = async () => {
    setIsDiscoveringDm(true);
    setDmError(null);
    setDmSaveBanner(null);
    try {
      const res = await apiFetch('/api/decision-makers/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: lead.id,
          companyName: lead.companyName,
          domain: lead.domain,
          website: lead.website,
          countryCode: lead.address?.countryCode,
          registrationNumber: lead.registrationNumber,
          registrationType: lead.registrationType,
          industry: lead.industry,
          targetJobTitle: dmTargetJobTitle.trim() || undefined,
          targetDepartment: dmTargetDepartment.trim() || undefined,
          targetRelationshipType: dmTargetRole || undefined,
          includeHistorical: dmIncludeHistorical,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Decision-maker discovery failed');
      setDmDiscoveryResult(data);
      setSelectedDmIds(new Set());
      if (data.aiQueryPlan) setDmAiPlan(data.aiQueryPlan);
    } catch (err: unknown) {
      setDmError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDiscoveringDm(false);
    }
  };

  const toggleDmCandidate = (candidateId: string) => {
    setSelectedDmIds((prev) => {
      const next = new Set(prev);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  };

  const handleApproveSelectedDm = async () => {
    if (!dmDiscoveryResult || selectedDmIds.size === 0) return;
    const approved: DecisionMakerCandidate[] = dmDiscoveryResult.candidates.filter((c) =>
      selectedDmIds.has(c.candidateId)
    );
    if (approved.length === 0) return;
    setIsApprovingDm(true);
    setDmError(null);
    try {
      const res = await apiFetch('/api/decision-makers/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: lead.id,
          candidates: approved,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to approve and save contacts');
      setLinkedPersons(data.persons || []);
      setSelectedDmIds(new Set());
      setDmSaveBanner(`Saved ${approved.length} approved decision-maker(s) into CRM with provenance.`);
    } catch (err: unknown) {
      setDmError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsApprovingDm(false);
    }
  };

  const uiIdentifierOptions = getUiIdentifierOptions();
  const leadLocale = getLocaleForCountry(lead.address?.countryCode, lead.currency);
  const leadTimezone = getTimezoneForCountry(lead.address?.countryCode);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditProfileError(null);
    try {
      // 1. Format address according to destination country conventions & validate postal requirement
      let formattedAddress = [editGeo.street, editGeo.city, editGeo.region, editGeo.postalCode, editGeo.countryName]
        .filter(Boolean)
        .join(', ');
      const addrRes = await apiFetch('/api/geo/format-address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          street: editGeo.street,
          city: editGeo.city,
          region: editGeo.region,
          postalCode: editGeo.postalCode,
          country: editGeo.countryName,
          countryCode: editGeo.countryCode,
        }),
      });
      if (addrRes.ok) {
        const addrData = await addrRes.json();
        if (addrData.postalValidation && !addrData.postalValidation.valid) {
          setEditProfileError(addrData.postalValidation.message || 'Postal code is required or invalid for this country');
          return;
        }
        if (addrData.formattedAddress) formattedAddress = addrData.formattedAddress;
      }

      // 2. Preserve raw phone and normalize phoneNormalized to E.164 separately
      const rawPhone = editPhone.trim() || undefined;
      let normalizedPhone: string | undefined = undefined;
      if (rawPhone) {
        const phoneRes = await apiFetch('/api/geo/normalize-phone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: rawPhone, countryCode: editGeo.countryCode }),
        });
        if (phoneRes.ok) {
          const phoneData = await phoneRes.json();
          if (phoneData.valid && phoneData.e164) {
            normalizedPhone = phoneData.e164;
          }
        }
      }

      let domain = lead.domain;
      if (editWebsite.trim()) {
        try {
          const u = new URL(editWebsite.trim().startsWith('http') ? editWebsite.trim() : `https://${editWebsite.trim()}`);
          domain = u.hostname.replace(/^www\./, '');
        } catch {
          // ignore
        }
      }

      onUpdateLead({
        ...lead,
        phone: rawPhone,
        phoneNormalized: normalizedPhone,
        email: editEmail.trim() || undefined,
        website: editWebsite.trim() || undefined,
        domain,
        currency: editGeo.currency || lead.currency || 'USD',
        address: {
          ...lead.address,
          street: editGeo.street.trim() || undefined,
          city: editGeo.city.trim() || undefined,
          region: editGeo.region.trim() || undefined,
          postalCode: editGeo.postalCode.trim() || undefined,
          country: editGeo.countryName,
          countryCode: editGeo.countryCode,
          formattedAddress,
        },
      });
      setIsEditingProfile(false);
    } catch (err) {
      console.error(err);
      setEditProfileError('Failed to save location updates');
    }
  };

  const handleValidateIdentifier = async () => {
    if (!newIdentValue.trim()) return;
    try {
      const canonicalType = canonicalizeIdentifierType(newIdentType, newIdentCountry);
      const res = await apiFetch('/api/identifiers/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: canonicalType,
          value: newIdentValue.trim(),
          countryCode: newIdentCountry,
        }),
      });
      const data = await res.json();
      setIdentValidationFeedback({
        ...data,
        message: data.message || data.error || (data.valid ? 'Valid identifier syntax' : 'Invalid syntax'),
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveIdentifier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIdentValue.trim()) return;

    const canonicalType = canonicalizeIdentifierType(newIdentType, newIdentCountry);
    let validationData = identValidationFeedback;
    if (!validationData) {
      try {
        const res = await apiFetch('/api/identifiers/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: canonicalType,
            value: newIdentValue.trim(),
            countryCode: newIdentCountry,
          }),
        });
        if (res.ok) {
          validationData = await res.json();
        }
      } catch {
        // fallback to user_provided
      }
    }

    const validatedStatus = validationData?.valid ? 'syntax_validated' : 'user_provided';
    const normalizedVal =
      validationData?.normalizedValue || newIdentValue.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    const newIdentifier: LeadIdentifier = {
      type: canonicalType,
      value: newIdentValue.trim(),
      normalizedValue: normalizedVal,
      countryCode: newIdentCountry,
      issuingAuthority: newIdentAuthority.trim() || validationData?.issuingAuthority || undefined,
      source: 'owner_manual_entry',
      status: validatedStatus,
      verified: false,
    };

    const existingIdents = lead.identifiers || [];
    const updatedIdents = [...existingIdents, newIdentifier];

    onUpdateLead({
      ...lead,
      identifiers: updatedIdents,
    });

    setNewIdentValue('');
    setNewIdentAuthority('');
    setIdentValidationFeedback(null);
    setIsAddingIdent(false);
  };

  const handleRemoveIdentifier = (index: number) => {
    const updated = (lead.identifiers || []).filter((_, i) => i !== index);
    onUpdateLead({ ...lead, identifiers: updated });
  };

  const handleRunWebInspect = async () => {
    if (!lead.website) return;
    setIsInspecting(true);
    try {
      const res = await onInspectUrl(lead.website, lead.id);
      setInspectionResult(res);
    } finally {
      setIsInspecting(false);
    }
  };

  const handleAddNoteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    onAddNote(lead.id, newNote.trim());
    setNewNote('');
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTag.trim()) return;
    const updatedTags = Array.from(new Set([...lead.tags, newTag.trim()]));
    onUpdateLead({ ...lead, tags: updatedTags });
    setNewTag('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const updatedTags = lead.tags.filter((t) => t !== tagToRemove);
    onUpdateLead({ ...lead, tags: updatedTags });
  };

  const handleUpdateStage = (stageId: string) => {
    onUpdateLead({ ...lead, pipelineStageId: stageId });
  };

  const handleUpdateValue = () => {
    const val = parseFloat(oppValue) || 0;
    onUpdateLead({ ...lead, opportunityValue: val });
  };

  const runQuickAiAnalysis = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await apiFetch('/api/ai/analyze-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI analysis failed');
      setAiAnalysis(data);
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  };

  const runQuickAiPitch = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await apiFetch('/api/ai/generate-pitch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI pitch generation failed');
      setAiPitch(data);
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Drawer Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-lg shrink-0" title={lead.address?.country || lead.address?.countryCode}>
                {getCountryFlag(lead.address?.countryCode)}
              </span>
              <h2 className="text-xl font-bold text-white tracking-tight truncate">{lead.companyName}</h2>
            </div>

            <p className="text-xs text-slate-400 truncate">
              {[
                lead.address?.countryCode,
                lead.registrationNumber ? `${lead.registrationType || 'ID'} ${lead.registrationNumber}` : null,
                lead.legalName && lead.legalName !== lead.companyName ? `Legal: ${lead.legalName}` : null,
                lead.industry,
                lead.category,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <span
              className={`text-xs font-semibold tabular-nums flex items-center gap-1 ${
                lead.confidenceScore >= 80 ? 'text-[#8AB0BA]' : 'text-[#E09F3E]'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{lead.confidenceScore}%</span>
            </span>

            {(onOpenAiAgent || onOpenOutreach) && (
              <ActionMenu
                label="Engage"
                items={[
                  ...(onOpenAiAgent
                    ? [
                        {
                          label: 'AI Company Intel',
                          icon: <Bot className="w-3.5 h-3.5 text-slate-400" />,
                          onClick: () => onOpenAiAgent({ tab: 'company_intel', leadId: lead.id }),
                        },
                        {
                          label: 'Prepare Meeting Brief',
                          icon: <Calendar className="w-3.5 h-3.5 text-slate-400" />,
                          onClick: () => onOpenAiAgent({ tab: 'meeting_prep', leadId: lead.id }),
                        },
                        {
                          label: 'Draft Sales Message',
                          icon: <Mail className="w-3.5 h-3.5 text-slate-400" />,
                          onClick: () => onOpenAiAgent({ tab: 'drafting', leadId: lead.id }),
                        },
                      ]
                    : []),
                  ...(onOpenOutreach
                    ? [
                        {
                          label: 'Enroll in Outreach',
                          icon: <Send className="w-3.5 h-3.5 text-slate-400" />,
                          onClick: () => onOpenOutreach({ leadId: lead.id, tab: 'campaigns' }),
                        },
                      ]
                    : []),
                ]}
              />
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close company details"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Quick Attributes Strip */}
        <div className="px-5 py-3 bg-slate-950/40 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-slate-400">
              <span className="text-slate-500 font-semibold">Stage:</span>
              <select
                value={lead.pipelineStageId || ''}
                onChange={(e) => {
                  if (e.target.value) handleUpdateStage(e.target.value);
                }}
                className="bg-slate-900 border border-slate-700 text-white rounded px-2 py-0.5 font-medium"
              >
                {(!lead.pipelineStageId || !stages.some((s) => s.id === lead.pipelineStageId)) && (
                  <option value="">Unassigned</option>
                )}
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1 text-slate-400">
              <span className="text-slate-500 font-semibold">Value:</span>
              <input
                type="number"
                value={oppValue}
                onChange={(e) => setOppValue(e.target.value)}
                onBlur={handleUpdateValue}
                placeholder="0"
                className="w-20 bg-slate-900 border border-slate-700 text-white rounded px-2 py-0.5 text-right font-mono"
              />
              <span>{lead.currency}</span>
              {lead.opportunityValue ? (
                <span className="text-emerald-400 font-mono font-semibold ml-1">
                  ({formatCurrencyLocale(lead.opportunityValue, lead.currency || 'USD', leadLocale)})
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            {lead.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-800 text-slate-300 rounded text-[11px] group"
              >
                <span>{tag}</span>
                <button
                  onClick={() => handleRemoveTag(tag)}
                  className="text-slate-500 hover:text-rose-400 ml-0.5"
                >
                  ×
                </button>
              </span>
            ))}
            <form onSubmit={handleAddTag} className="inline-block">
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="+ tag"
                className="w-16 bg-slate-950 border border-slate-800 text-white text-[11px] rounded px-1.5 py-0.5 focus:outline-none focus:border-indigo-500"
              />
            </form>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="px-5 border-b border-slate-800 flex space-x-4 bg-slate-950/20 text-xs overflow-x-auto">
          {[
            { id: 'overview', label: 'Lead Facts & Profile' },
            { id: 'relationship', label: 'Relationship & CRM' },
            { id: 'enrichment', label: 'Enrichment & Quality' },
            { id: 'contacts', label: `Decision-Makers (${linkedPersons.length})` },
            { id: 'web', label: 'Live Web Inspector (SSRF Safe)' },
            { id: 'ai', label: 'Gemini AI Assistant' },
            { id: 'timeline', label: `Provenance Timeline (${lead.sources.length})` },
            { id: 'notes', label: `Notes & Logs (${lead.notes.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-3 font-semibold border-b-2 transition whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* 1A. RELATIONSHIP & PERSONAL CRM TAB (Phase 13) */}
          {activeTab === 'relationship' && (
            <CompanyRelationshipPanel
              leadId={lead.id}
              stages={stages}
              onOpenPersonProfile={onOpenPersonProfile}
              onDataMutated={onRefreshData}
            />
          )}

          {/* 1B. ENRICHMENT & DATA QUALITY TAB (Phase 12) */}
          {activeTab === 'enrichment' && (
            <LeadEnrichmentPanel
              lead={lead}
              mode="crm"
              onLeadUpdated={(updated) => {
                if (onLeadVerified) onLeadVerified(updated);
                else onUpdateLead(updated);
              }}
            />
          )}

          {/* 1. OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">
                  Geographic & Contact Profile
                </span>
                <button
                  type="button"
                  onClick={() => setIsEditingProfile(!isEditingProfile)}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center gap-1.5 text-[11px] font-medium transition"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>{isEditingProfile ? 'Cancel Edit' : 'Edit Location & Contact'}</span>
                </button>
              </div>

              {isEditingProfile ? (
                <form onSubmit={handleSaveProfile} className="bg-slate-950 border border-indigo-500/40 rounded-xl p-4 space-y-3">
                  <GeoSelector
                    countryCode={editGeo.countryCode}
                    region={editGeo.region}
                    city={editGeo.city}
                    postalCode={editGeo.postalCode}
                    street={editGeo.street}
                    onChange={(geo) =>
                      setEditGeo({
                        countryCode: geo.countryCode,
                        countryName: geo.countryName,
                        region: geo.region || '',
                        city: geo.city || '',
                        postalCode: geo.postalCode || '',
                        street: geo.street || '',
                        currency: geo.currency || editGeo.currency,
                      })
                    }
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-800">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">Phone (Auto-normalizes E.164)</label>
                      <input
                        type="text"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        placeholder="+44 20 7946 0912"
                        className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded px-2.5 py-1.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">Public Email</label>
                      <input
                        type="email"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        placeholder="contact@company.com"
                        className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded px-2.5 py-1.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">Website URL</label>
                      <input
                        type="text"
                        value={editWebsite}
                        onChange={(e) => setEditWebsite(e.target.value)}
                        placeholder="https://company.com"
                        className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded px-2.5 py-1.5 font-mono"
                      />
                    </div>
                  </div>

                  {editProfileError && (
                    <div className="p-2 bg-rose-950/50 border border-rose-800 rounded text-rose-300 text-xs">
                      {editProfileError}
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsEditingProfile(false)}
                      className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded text-xs flex items-center gap-1.5"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Save Normalized Profile</span>
                    </button>
                  </div>
                </form>
              ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Physical Location */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-white flex items-center gap-1.5 text-xs">
                      <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                      Physical & Registered Address
                    </h4>
                    {lead.address?.countryCode && (
                      <span className="px-2 py-0.5 text-[10px] bg-slate-900 border border-slate-800 rounded text-slate-400 font-mono">
                        ISO: {lead.address.countryCode}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5 text-slate-300">
                    <div className="font-medium text-white">{lead.address?.formattedAddress || 'No formatted address on file'}</div>
                    {lead.address?.street && <div className="text-slate-400">{lead.address.street}</div>}
                    <div className="text-slate-400 flex flex-wrap gap-2 text-[11px]">
                      {lead.address?.postalCode && (
                        <span className="bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                          Postal: {lead.address.postalCode}
                        </span>
                      )}
                      {lead.address?.city && (
                        <span className="bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                          City: {lead.address.city}
                        </span>
                      )}
                      {lead.address?.region && (
                        <span className="bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                          Region: {lead.address.region}
                        </span>
                      )}
                      {lead.address?.country && (
                        <span className="bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                          Country: {lead.address.country}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      {lead.currency && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-indigo-950/50 text-indigo-300 border border-indigo-900/60 rounded font-mono">
                          Currency: {lead.currency}
                        </span>
                      )}
                      {lead.coordinates && (
                        <span className="font-mono text-cyan-400 text-[10px] bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                          GPS: {lead.coordinates.lat.toFixed(4)}, {lead.coordinates.lon.toFixed(4)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Digital Contact Channels */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                  <h4 className="font-bold text-white flex items-center gap-1.5 text-xs">
                    <Globe2 className="w-3.5 h-3.5 text-indigo-400" />
                    Verified Contact Channels
                  </h4>
                  <div className="space-y-2 text-slate-300">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Website:</span>
                      {sanitizeExternalUrl(lead.website) ? (
                        <a
                          href={sanitizeExternalUrl(lead.website)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-400 hover:underline flex items-center gap-1 font-mono"
                        >
                          <span>{lead.domain || lead.website}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-slate-500">None detected</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Public Email:</span>
                      {lead.email ? (
                        <span className="text-cyan-400 font-mono">{lead.email}</span>
                      ) : (
                        <span className="text-slate-500">None on record</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Telephone:</span>
                      {lead.phone || lead.phoneNormalized ? (
                        <div className="text-right">
                          <a
                            href={`tel:${lead.phoneNormalized || lead.phone}`}
                            className="text-emerald-400 hover:underline font-mono block font-semibold"
                          >
                            {lead.phone || lead.phoneNormalized}
                          </a>
                          {lead.phoneNormalized && lead.phoneNormalized !== lead.phone ? (
                            <span className="text-[10px] text-cyan-400 font-mono block">
                              E.164: {lead.phoneNormalized}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-500 font-mono">
                              {lead.phoneNormalized ? 'E.164 Normalized' : 'Raw Input'}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-500">None on record</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              )}

              {/* Official Government Registry Verification & Legal Identity */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div>
                    <h4 className="font-bold text-white flex items-center gap-1.5 text-xs">
                      <Scale className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Official Government Registry &amp; Legal Identity</span>
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Higher-trust registry verification preserves CRM pipeline stages, notes, and deal history while detecting legal identity conflicts.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleVerifyWithOfficialRegistry}
                    disabled={isVerifyingRegistry}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded text-xs transition shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isVerifyingRegistry ? 'animate-spin' : ''}`} />
                    <span>{isVerifyingRegistry ? 'Verifying Registry...' : 'Verify with Official Registry'}</span>
                  </button>
                </div>

                {verificationError && (
                  <div className="p-2.5 bg-rose-950/40 border border-rose-800 rounded text-rose-300 text-xs">
                    {verificationError}
                  </div>
                )}

                {verificationReport && (
                  <div className="p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-[11px] text-slate-200 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-semibold text-white">Latest Verification Run</span>
                      <div className="flex items-center gap-1.5">
                        {verificationReport.authRequired && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            Credentials Required
                          </span>
                        )}
                        {renderRegistryStateBadge(verificationReport.state)}
                      </div>
                    </div>
                    <p className="text-slate-300">{verificationReport.summary}</p>
                    {verificationReport.attemptedConnectors && verificationReport.attemptedConnectors.length > 0 && (
                      <div className="text-[10px] text-slate-400 font-mono">
                        Attempted connectors: {verificationReport.attemptedConnectors.join(' -> ')}
                      </div>
                    )}
                    {verificationReport.notes && verificationReport.notes.length > 0 && (
                      <ul className="list-disc list-inside text-[10px] text-slate-400 space-y-0.5">
                        {verificationReport.notes.map((n, idx) => (
                          <li key={idx}>{n}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  <div className="p-2.5 bg-slate-900 border border-slate-800/80 rounded-lg">
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">Legal Business Name</div>
                    <div className="text-xs font-semibold text-white mt-0.5 truncate" title={lead.legalName || lead.companyName}>
                      {lead.legalName || lead.companyName}
                    </div>
                  </div>

                  <div className="p-2.5 bg-slate-900 border border-slate-800/80 rounded-lg">
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">Official Registration No.</div>
                    <div className="text-xs font-mono text-cyan-300 mt-0.5">
                      {lead.registrationNumber
                        ? `${lead.registrationType || 'REG'}: ${lead.registrationNumber}`
                        : 'Not registered'}
                    </div>
                  </div>

                  <div className="p-2.5 bg-slate-900 border border-slate-800/80 rounded-lg">
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">Jurisdiction &amp; Legal Status</div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-xs text-slate-200 font-mono">
                        {lead.address?.countryCode || '—'} · {lead.address?.country || 'Unknown'}
                      </span>
                      {renderLegalCompanyStatusBadge(lead.companyStatus)}
                    </div>
                  </div>

                  <div className="p-2.5 bg-slate-900 border border-slate-800/80 rounded-lg">
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">Official Registry Source</div>
                    <div className="text-xs text-slate-200 mt-0.5 flex items-center gap-1.5">
                      <span className="truncate">
                        {lastVerificationSource || lead.sources[0]?.sourceName || 'Not verified with registry'}
                      </span>
                      {sanitizeExternalUrl(lastVerificationSourceUrl || lead.sources[0]?.url) && (
                        <a
                          href={sanitizeExternalUrl(lastVerificationSourceUrl || lead.sources[0]?.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-400 hover:text-indigo-300 shrink-0"
                          title="Open Official Registry Record"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="p-2.5 bg-slate-900 border border-slate-800/80 rounded-lg">
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">Verification Status</div>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      {renderRegistryStateBadge(lastRegistryState)}
                      {lastVerificationMatchType && lastVerificationMatchType !== 'none' && (
                        <span className="text-[10px] font-mono text-slate-400">
                          ({lastVerificationMatchType.replace(/_/g, ' ')})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-2.5 bg-slate-900 border border-slate-800/80 rounded-lg">
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">Last Verified Timestamp</div>
                    <div className="text-xs font-mono tabular-nums text-slate-200 mt-0.5">
                      {lastVerifiedAt
                        ? formatDateLocale(lastVerifiedAt, leadLocale, leadTimezone)
                        : 'Not verified yet'}
                    </div>
                  </div>
                </div>

                {Object.keys(activeAttributeSources).length > 0 && (
                  <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">
                      Field-Level Official Provenance
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {Object.entries(activeAttributeSources).map(([field, meta]) => (
                        <div
                          key={field}
                          className="p-2 bg-slate-900/80 border border-slate-800 rounded text-[10px] flex items-center justify-between gap-2"
                        >
                          <span className="font-mono text-slate-300">{field}</span>
                          <span className="text-slate-400 truncate" title={meta.sourceName}>
                            {meta.sourceName}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Conflicts / Outdated Information Alert Panel */}
                {activeConflicts.length > 0 && (
                  <div className="p-3 bg-rose-950/35 border border-rose-800/70 rounded-lg space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-rose-300">
                      <AlertTriangle className="w-4 h-4 text-rose-400" />
                      <span>
                        Conflicting or Outdated Information Detected ({activeConflicts.length})
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {activeConflicts.map((conflict, idx) => (
                        <div
                          key={idx}
                          className="p-2 bg-slate-950/80 border border-rose-900/60 rounded text-[11px] space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-semibold text-rose-200 uppercase">
                              {conflict.field}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                conflict.severity === 'high'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                  : conflict.severity === 'medium'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                  : 'bg-slate-800 text-slate-300 border border-slate-700'
                              }`}
                            >
                              {conflict.severity}
                            </span>
                          </div>
                          <p className="text-slate-300">{conflict.message}</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[10px] pt-0.5">
                            <div className="text-slate-400">
                              CRM: <span className="text-slate-200">{conflict.crmValue}</span>
                            </div>
                            <div className="text-emerald-300">
                              Official: <span>{conflict.officialValue}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Confidence Signals Audit */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                <h4 className="font-bold text-white flex items-center gap-1.5 text-xs">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  Data Verification Signals & Proof
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {lead.confidenceSignals.map((signal, i) => (
                    <div
                      key={i}
                      className="p-2 bg-slate-900 border border-slate-800/80 rounded flex items-center gap-2 text-slate-300"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                      <span>{signal}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* International Business Identifiers Registry */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-white text-xs flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-cyan-400" />
                      International Business Identifiers ({lead.identifiers?.length || 0})
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Country-specific registration numbers, tax identifiers, LEI, and VAT with provenance tracking.
                    </p>
                  </div>

                  <button
                    onClick={() => setIsAddingIdent(!isAddingIdent)}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded border border-slate-700 flex items-center gap-1 transition"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Identifier</span>
                  </button>
                </div>

                {/* Inline Add Identifier Form */}
                {isAddingIdent && (
                  <form onSubmit={handleSaveIdentifier} className="p-3 bg-slate-900 border border-slate-800 rounded-lg space-y-2.5">
                    <div className="font-semibold text-white text-xs">Register Organization Identifier</div>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5">Type</label>
                        <select
                          value={newIdentType}
                          onChange={(e) => setNewIdentType(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2 py-1 text-xs"
                        >
                          {uiIdentifierOptions.map((opt) => (
                            <option key={opt.code} value={opt.code}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[10px] text-slate-400 mb-0.5">Identifier Value</label>
                        <input
                          type="text"
                          value={newIdentValue}
                          onChange={(e) => {
                            setNewIdentValue(e.target.value);
                            setIdentValidationFeedback(null);
                          }}
                          placeholder="e.g. 998877665 or 01234567"
                          className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2 py-1 text-xs font-mono"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5">Jurisdiction (ISO)</label>
                        <input
                          type="text"
                          maxLength={2}
                          value={newIdentCountry}
                          onChange={(e) => setNewIdentCountry(e.target.value.toUpperCase())}
                          className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2 py-1 text-xs font-mono uppercase"
                          placeholder="GB"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5">Issuing Authority (Optional)</label>
                        <input
                          type="text"
                          value={newIdentAuthority}
                          onChange={(e) => setNewIdentAuthority(e.target.value)}
                          placeholder="e.g. Companies House, Brønnøysundregistrene"
                          className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2 py-1 text-xs"
                        />
                      </div>

                      <div className="flex items-end gap-2">
                        <button
                          type="button"
                          onClick={handleValidateIdentifier}
                          className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs border border-slate-700"
                        >
                          Check Syntax
                        </button>
                        <button
                          type="submit"
                          className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded text-xs"
                        >
                          Save to Lead
                        </button>
                      </div>
                    </div>

                    {identValidationFeedback && (
                      <div className={`p-2 rounded text-xs border flex items-center justify-between ${
                        identValidationFeedback.valid
                          ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                          : 'bg-amber-950/40 border-amber-800 text-amber-300'
                      }`}>
                        <span>{identValidationFeedback.message}</span>
                        {identValidationFeedback.normalizedValue && (
                          <span className="font-mono text-[11px] opacity-80">
                            Norm: {identValidationFeedback.normalizedValue}
                          </span>
                        )}
                      </div>
                    )}
                  </form>
                )}

                {/* Identifiers List */}
                <div className="space-y-2">
                  {(!lead.identifiers || lead.identifiers.length === 0) ? (
                    <div className="p-3 text-center text-slate-500 text-xs bg-slate-900/50 rounded-lg">
                      No business identifiers recorded for this organization.
                    </div>
                  ) : (
                    lead.identifiers.map((ident, i) => (
                      <div
                        key={i}
                        className="p-2.5 bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="px-1.5 py-0.5 bg-slate-950 text-cyan-400 font-mono text-[11px] font-bold rounded border border-slate-800">
                            {canonicalizeIdentifierType(ident.type, ident.countryCode || lead.address?.countryCode)}
                          </span>
                          <span className="font-mono text-white text-xs font-semibold">{ident.value}</span>
                          {ident.normalizedValue && ident.normalizedValue !== ident.value && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              (norm: {ident.normalizedValue})
                            </span>
                          )}
                          {ident.countryCode && (
                            <span className="text-[10px] text-slate-400 uppercase font-mono">
                              [{ident.countryCode}]
                            </span>
                          )}
                          {ident.issuingAuthority && (
                            <span className="text-[10px] text-slate-500">
                              • {ident.issuingAuthority}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {getStatusBadge(ident.status, ident.verified)}
                          <button
                            onClick={() => handleRemoveIdentifier(i)}
                            className="text-slate-500 hover:text-rose-400 px-1 py-0.5 text-xs"
                            title="Remove identifier"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 1B. DECISION-MAKERS & M:N RELATIONSHIPS TAB */}
          {activeTab === 'contacts' && (
            <div className="space-y-4 text-xs">
              {/* Company-to-Person Discovery Panel (Explicit Owner Review & Approval) */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-white flex items-center gap-1.5 text-xs">
                      <Search className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Discover Decision-Makers for {lead.companyName}</span>
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Queries official website leadership pages, corporate officer registries, Wikidata, and configured authorized providers. Discovered candidates require explicit approval before CRM save.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleGenerateDmAiPlan}
                      disabled={isPlanningDmAi}
                      className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-medium rounded flex items-center gap-1 text-xs transition whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{isPlanningDmAi ? 'Planning...' : 'AI Query Plan'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDiscoverDecisionMakers}
                      disabled={isDiscoveringDm}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded flex items-center gap-1.5 text-xs transition whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isDiscoveringDm ? 'animate-spin' : ''}`} />
                      <span>{isDiscoveringDm ? 'Discovering...' : 'Discover Decision-Makers'}</span>
                    </button>
                  </div>
                </div>

                {/* Role & Tenure Filters */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-1">
                  <select
                    value={dmTargetRole}
                    onChange={(e) => setDmTargetRole(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-white rounded px-2 py-1.5 text-xs"
                  >
                    <option value="">All Roles</option>
                    {EXPANDED_RELATIONSHIP_TYPES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_TAXONOMY_SPECS[role].label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={dmTargetJobTitle}
                    onChange={(e) => setDmTargetJobTitle(e.target.value)}
                    placeholder="Target title (e.g. Procurement)"
                    className="bg-slate-900 border border-slate-700 text-white rounded px-2.5 py-1.5 text-xs"
                  />
                  <input
                    type="text"
                    value={dmTargetDepartment}
                    onChange={(e) => setDmTargetDepartment(e.target.value)}
                    placeholder="Department (e.g. Finance)"
                    className="bg-slate-900 border border-slate-700 text-white rounded px-2.5 py-1.5 text-xs"
                  />
                  <label className="inline-flex items-center gap-2 text-[11px] text-slate-300 px-2">
                    <input
                      type="checkbox"
                      checked={dmIncludeHistorical}
                      onChange={(e) => setDmIncludeHistorical(e.target.checked)}
                      className="rounded border-slate-600"
                    />
                    <span>Include historical / former</span>
                  </label>
                </div>

                {dmError && (
                  <div className="p-2.5 bg-rose-950/40 border border-rose-800 rounded text-rose-300 text-xs">
                    {dmError}
                  </div>
                )}

                {dmSaveBanner && (
                  <div className="p-2.5 bg-emerald-950/40 border border-emerald-800 rounded text-emerald-300 text-xs flex items-center justify-between">
                    <span>{dmSaveBanner}</span>
                    <button
                      type="button"
                      onClick={() => setDmSaveBanner(null)}
                      className="text-emerald-400 hover:text-white"
                    >
                      ×
                    </button>
                  </div>
                )}

                {dmAiPlan && (
                  <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-indigo-300">
                        AI Query &amp; Role Plan (Inferred · {dmAiPlan.engine})
                      </span>
                      <span className="text-slate-400">
                        Recommended titles: {dmAiPlan.targetTitles.slice(0, 5).join(', ')}
                      </span>
                    </div>
                    <p className="text-slate-400">{dmAiPlan.rationale}</p>
                    <div className="text-slate-300 font-mono text-[10px] space-y-0.5">
                      {dmAiPlan.suggestedQueries.slice(0, 4).map((q, i) => (
                        <div key={i}>• {q}</div>
                      ))}
                    </div>
                  </div>
                )}

                {dmDiscoveryResult && (
                  <div className="space-y-3 pt-1">
                    <div className="p-2.5 bg-slate-900 border border-slate-800 rounded-lg text-[11px] text-slate-300 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span>{dmDiscoveryResult.honestStatusNote}</span>
                        <span className="font-mono text-slate-400 tabular-nums shrink-0">
                          {dmDiscoveryResult.durationMs}ms
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400">
                        {dmDiscoveryResult.sourceSummaries.map((s) => (
                          <span key={s.sourceId} className="font-mono">
                            <span
                              className={
                                s.status === 'success'
                                  ? 'text-emerald-400'
                                  : s.status === 'skipped_missing_credentials'
                                  ? 'text-amber-400'
                                  : 'text-slate-500'
                              }
                            >
                              {s.sourceName}
                            </span>
                            : {s.status === 'success' ? `${s.candidatesFound} found` : s.status.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </div>

                    {dmDiscoveryResult.candidates.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-slate-300">
                            Discovered Candidates ({dmDiscoveryResult.candidates.length}) — {selectedDmIds.size} selected
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedDmIds(
                                  selectedDmIds.size === dmDiscoveryResult.candidates.length
                                    ? new Set()
                                    : new Set(dmDiscoveryResult.candidates.map((c) => c.candidateId))
                                )
                              }
                              className="px-2 py-1 text-[11px] rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
                            >
                              {selectedDmIds.size === dmDiscoveryResult.candidates.length ? 'Clear All' : 'Select All'}
                            </button>
                            <button
                              type="button"
                              disabled={selectedDmIds.size === 0 || isApprovingDm}
                              onClick={handleApproveSelectedDm}
                              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold rounded text-[11px] whitespace-nowrap shrink-0"
                            >
                              {isApprovingDm
                                ? 'Saving...'
                                : `Approve & Save Selected (${selectedDmIds.size})`}
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                          {dmDiscoveryResult.candidates.map((cand) => {
                            const checked = selectedDmIds.has(cand.candidateId);
                            const roleSpec =
                              ROLE_TAXONOMY_SPECS[cand.relationshipType as keyof typeof ROLE_TAXONOMY_SPECS];
                            return (
                              <div
                                key={cand.candidateId}
                                className={`p-3 rounded-lg border transition space-y-1.5 ${
                                  checked
                                    ? 'bg-indigo-950/30 border-indigo-500/60'
                                    : 'bg-slate-900 border-slate-800'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleDmCandidate(cand.candidateId)}
                                    className="flex items-start gap-2 text-left min-w-0"
                                  >
                                    {checked ? (
                                      <CheckSquare className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                                    ) : (
                                      <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                                    )}
                                    <div className="min-w-0">
                                      <div className="font-semibold text-white">
                                        {cand.fullName}{' '}
                                        <span className="font-normal text-slate-400">
                                          · {cand.jobTitle || roleSpec?.label || cand.relationshipType}
                                        </span>
                                      </div>
                                      <div className="text-[10px] text-slate-400 mt-0.5">
                                        {cand.department || roleSpec?.defaultDepartment || 'General'} ·{' '}
                                        {cand.employmentStatus === 'historical'
                                          ? `Historical${cand.endedAt ? ` (ended ${cand.endedAt})` : ''}`
                                          : cand.employmentStatus === 'unknown'
                                          ? 'Tenure unknown'
                                          : 'Current'}{' '}
                                        · {cand.isExplicitlyPublished ? 'Explicitly published' : 'Inferred'}
                                      </div>
                                    </div>
                                  </button>
                                  <div className="text-right shrink-0 font-mono text-[10px] tabular-nums">
                                    <div className="text-emerald-400 font-semibold">
                                      {cand.verificationTier.replace(/_/g, ' ')}
                                    </div>
                                    <div className="text-slate-400">{cand.confidenceScore}% conf</div>
                                  </div>
                                </div>

                                {cand.uncertainMatch && cand.uncertainMatchReasons && (
                                  <div className="px-2 py-1 rounded bg-amber-950/40 border border-amber-800/70 text-amber-300 text-[10px]">
                                    Uncertain CRM identity match (not auto-merged): {cand.uncertainMatchReasons[0]}
                                  </div>
                                )}

                                {cand.outdatedSignalNote && (
                                  <div className="px-2 py-1 rounded bg-amber-950/30 border border-amber-900/60 text-amber-300 text-[10px]">
                                    {cand.outdatedSignalNote}
                                  </div>
                                )}

                                {(cand.bioSummary || cand.relevanceExplanation) && (
                                  <div className="text-[11px] text-slate-300 space-y-0.5">
                                    {cand.bioSummary && <p>{cand.bioSummary}</p>}
                                    {cand.relevanceExplanation && (
                                      <p className="text-slate-400 text-[10px]">
                                        Relevance (Inferred): {cand.relevanceExplanation}
                                      </p>
                                    )}
                                  </div>
                                )}

                                <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400">
                                  {cand.email && <span className="font-mono text-cyan-400">{cand.email}</span>}
                                  {cand.phone && <span className="font-mono text-emerald-400">{cand.phone}</span>}
                                  {sanitizeExternalUrl(cand.linkedinUrl) && (
                                    <a
                                      href={sanitizeExternalUrl(cand.linkedinUrl)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-400 hover:underline"
                                    >
                                      LinkedIn
                                    </a>
                                  )}
                                  {cand.sources.map((src, i) => (
                                    <span key={i}>
                                      {sanitizeExternalUrl(src.sourceUrl) ? (
                                        <a
                                          href={sanitizeExternalUrl(src.sourceUrl)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-indigo-400 hover:underline inline-flex items-center gap-0.5"
                                        >
                                          <span>{src.sourceName}</span>
                                          <ExternalLink className="w-2.5 h-2.5" />
                                        </a>
                                      ) : (
                                        src.sourceName
                                      )}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Saved CRM Decision-Makers & Manual Link Panel */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-white flex items-center gap-1.5 text-xs">
                      <Users className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Linked CRM Decision-Makers, Officers &amp; Contacts ({linkedPersons.length})</span>
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Many-to-many links between persons and companies supporting multiple roles per company and current vs historical tenure.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAddingPerson(!isAddingPerson)}
                    className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded flex items-center gap-1 text-xs transition shrink-0 whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{isAddingPerson ? 'Cancel' : 'Add / Link Contact'}</span>
                  </button>
                </div>

                {isAddingPerson && (
                  <form onSubmit={handleAddPersonSubmit} className="p-3.5 bg-slate-900 border border-slate-800 rounded-lg space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5">Full Name *</label>
                        <input
                          type="text"
                          required
                          value={personForm.fullName}
                          onChange={(e) => setPersonForm((p) => ({ ...p, fullName: e.target.value }))}
                          placeholder="e.g. Astrid Solberg"
                          className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2.5 py-1.5 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5">Email</label>
                        <input
                          type="email"
                          value={personForm.email}
                          onChange={(e) => setPersonForm((p) => ({ ...p, email: e.target.value }))}
                          placeholder="astrid@company.no"
                          className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2.5 py-1.5 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5">Phone</label>
                        <input
                          type="text"
                          value={personForm.phone}
                          onChange={(e) => setPersonForm((p) => ({ ...p, phone: e.target.value }))}
                          placeholder="+47 22 34 56 78"
                          className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2.5 py-1.5 text-xs font-mono"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5">Relationship Type</label>
                        <select
                          value={personForm.relationshipType}
                          onChange={(e) => setPersonForm((p) => ({ ...p, relationshipType: e.target.value }))}
                          className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2 py-1.5 text-xs"
                        >
                          {EXPANDED_RELATIONSHIP_TYPES.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_TAXONOMY_SPECS[role].label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5">Job Title</label>
                        <input
                          type="text"
                          value={personForm.jobTitle}
                          onChange={(e) => setPersonForm((p) => ({ ...p, jobTitle: e.target.value }))}
                          placeholder="Managing Director"
                          className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2.5 py-1.5 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5">Designation</label>
                        <input
                          type="text"
                          value={personForm.designation}
                          onChange={(e) => setPersonForm((p) => ({ ...p, designation: e.target.value }))}
                          placeholder="Board Member / VP"
                          className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2.5 py-1.5 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5">Department</label>
                        <input
                          type="text"
                          value={personForm.department}
                          onChange={(e) => setPersonForm((p) => ({ ...p, department: e.target.value }))}
                          placeholder="Executive / Procurement"
                          className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2.5 py-1.5 text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-3 flex-1 min-w-[220px]">
                        <input
                          type="url"
                          value={personForm.linkedinUrl}
                          onChange={(e) => setPersonForm((p) => ({ ...p, linkedinUrl: e.target.value }))}
                          placeholder="https://linkedin.com/in/..."
                          className="flex-1 bg-slate-950 border border-slate-700 text-white rounded px-2.5 py-1.5 text-xs font-mono"
                        />
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            checked={personForm.isPrimaryContact}
                            onChange={(e) => setPersonForm((p) => ({ ...p, isPrimaryContact: e.target.checked }))}
                            className="rounded border-slate-600"
                          />
                          <span>Primary Contact</span>
                        </label>
                      </div>
                      <button
                        type="submit"
                        disabled={savingPerson}
                        className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded text-xs"
                      >
                        {savingPerson ? 'Linking...' : 'Save & Link Person'}
                      </button>
                    </div>

                    {personError && (
                      <div className="p-2 bg-rose-950/40 border border-rose-800 rounded text-rose-300 text-xs">
                        {personError}
                      </div>
                    )}
                  </form>
                )}

                {loadingPersons ? (
                  <div className="p-6 text-center text-slate-400 text-xs">Loading linked decision-makers...</div>
                ) : linkedPersons.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 text-xs bg-slate-900/50 rounded-lg">
                    No decision-makers or contacts linked to this company yet. Click &ldquo;Discover Decision-Makers&rdquo; above or &ldquo;Add / Link Contact&rdquo;.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {linkedPersons.map((item) => {
                      const { person, relationship, otherCompanies } = item;
                      const empStatus = relationship.provenance?.employmentStatus || 'current';
                      const endedAt = relationship.provenance?.endedAt;
                      const isEditing = editingRelId === relationship.id;
                      const showProv = expandedContactProvId === relationship.id;
                      const roleLabel =
                        ROLE_TAXONOMY_SPECS[
                          relationship.relationshipType as keyof typeof ROLE_TAXONOMY_SPECS
                        ]?.label || relationship.relationshipType.replace(/_/g, ' ');

                      return (
                        <div
                          key={relationship.id}
                          className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-white text-sm">{person.fullName}</span>
                                <span className="text-[11px] text-indigo-300 font-medium">
                                  {roleLabel}
                                </span>
                                {relationship.isPrimaryContact && (
                                  <span className="text-[10px] font-semibold text-emerald-400">
                                    · Primary Contact
                                  </span>
                                )}
                                {empStatus === 'historical' && (
                                  <span className="text-[10px] font-semibold text-amber-400">
                                    · Historical{endedAt ? ` (ended ${endedAt})` : ''}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-300 flex items-center gap-2 mt-0.5 flex-wrap">
                                {relationship.jobTitle && (
                                  <span className="inline-flex items-center gap-1">
                                    <Briefcase className="w-3 h-3 text-slate-400" />
                                    {relationship.jobTitle}
                                  </span>
                                )}
                                {relationship.designation && (
                                  <span className="text-slate-400">· {relationship.designation}</span>
                                )}
                                {relationship.department && (
                                  <span className="text-slate-400">· {relationship.department}</span>
                                )}
                                <span className="text-slate-500 font-mono tabular-nums">
                                  · {relationship.confidenceScore}% conf · {relationship.sourceName}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {onOpenPersonProfile && (
                                <button
                                  type="button"
                                  onClick={() => onOpenPersonProfile(person.id)}
                                  className="px-2 py-1 rounded text-[10px] font-semibold bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-300 border border-indigo-500/30 transition"
                                  title="Open Unified Person Relationship Profile"
                                >
                                  CRM Profile
                                </button>
                              )}
                              {getStatusBadge(person.verificationStatus)}
                              {!relationship.isPrimaryContact && (
                                <button
                                  type="button"
                                  onClick={() => handleSetPrimaryContact(relationship.id)}
                                  className="p-1 text-slate-400 hover:text-amber-400 transition"
                                  title="Set as Primary Contact"
                                >
                                  <Star className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleToggleEmploymentStatus(relationship.id, empStatus)}
                                className="p-1 text-slate-400 hover:text-cyan-400 transition"
                                title={
                                  empStatus === 'historical'
                                    ? 'Mark as Current Role'
                                    : 'Mark as Historical / Former'
                                }
                              >
                                <History className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  isEditing ? setEditingRelId(null) : handleStartEditContact(item)
                                }
                                className="p-1 text-slate-400 hover:text-indigo-400 transition"
                                title="Edit contact & role"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUnlinkPerson(relationship.id)}
                                className="p-1 text-slate-500 hover:text-rose-400 transition"
                                title="Unlink from company"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {person.bioSummary && (
                            <p className="text-[11px] text-slate-400 leading-relaxed">
                              {person.bioSummary}
                            </p>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300">
                            <div className="flex flex-wrap gap-3">
                              {person.email && (
                                <span className="inline-flex items-center gap-1 font-mono text-cyan-400">
                                  <Mail className="w-3 h-3" />
                                  {person.email}
                                </span>
                              )}
                              {(person.phoneNormalized || person.phone) && (
                                <span className="inline-flex items-center gap-1 font-mono text-emerald-400">
                                  <Phone className="w-3 h-3" />
                                  {person.phoneNormalized || person.phone}
                                </span>
                              )}
                              {sanitizeExternalUrl(person.linkedinUrl) && (
                                <a
                                  href={sanitizeExternalUrl(person.linkedinUrl)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-blue-400 hover:underline"
                                >
                                  <Linkedin className="w-3 h-3" />
                                  <span>LinkedIn</span>
                                </a>
                              )}
                              {sanitizeExternalUrl(person.officialBioUrl) && (
                                <a
                                  href={sanitizeExternalUrl(person.officialBioUrl)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-indigo-400 hover:underline"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  <span>Official Bio</span>
                                </a>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedContactProvId(showProv ? null : relationship.id)
                              }
                              className="text-[10px] text-slate-400 hover:text-slate-200 underline"
                            >
                              {showProv ? 'Hide Provenance' : 'Provenance'}
                            </button>
                          </div>

                          {isEditing && (
                            <form
                              onSubmit={(e) => handleSaveEditContact(e, relationship.id)}
                              className="p-3 bg-slate-950 border border-indigo-500/40 rounded-lg space-y-2"
                            >
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <input
                                  type="text"
                                  required
                                  value={editContactForm.fullName}
                                  onChange={(e) =>
                                    setEditContactForm((f) => ({ ...f, fullName: e.target.value }))
                                  }
                                  placeholder="Full Name"
                                  className="bg-slate-900 border border-slate-700 text-white rounded px-2 py-1 text-xs"
                                />
                                <input
                                  type="email"
                                  value={editContactForm.email}
                                  onChange={(e) =>
                                    setEditContactForm((f) => ({ ...f, email: e.target.value }))
                                  }
                                  placeholder="Email"
                                  className="bg-slate-900 border border-slate-700 text-white rounded px-2 py-1 text-xs font-mono"
                                />
                                <input
                                  type="text"
                                  value={editContactForm.phone}
                                  onChange={(e) =>
                                    setEditContactForm((f) => ({ ...f, phone: e.target.value }))
                                  }
                                  placeholder="Phone"
                                  className="bg-slate-900 border border-slate-700 text-white rounded px-2 py-1 text-xs font-mono"
                                />
                                <select
                                  value={editContactForm.relationshipType}
                                  onChange={(e) =>
                                    setEditContactForm((f) => ({
                                      ...f,
                                      relationshipType: e.target.value,
                                    }))
                                  }
                                  className="bg-slate-900 border border-slate-700 text-white rounded px-2 py-1 text-xs"
                                >
                                  {EXPANDED_RELATIONSHIP_TYPES.map((role) => (
                                    <option key={role} value={role}>
                                      {ROLE_TAXONOMY_SPECS[role].label}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="text"
                                  value={editContactForm.jobTitle}
                                  onChange={(e) =>
                                    setEditContactForm((f) => ({ ...f, jobTitle: e.target.value }))
                                  }
                                  placeholder="Job Title"
                                  className="bg-slate-900 border border-slate-700 text-white rounded px-2 py-1 text-xs"
                                />
                                <input
                                  type="text"
                                  value={editContactForm.department}
                                  onChange={(e) =>
                                    setEditContactForm((f) => ({
                                      ...f,
                                      department: e.target.value,
                                    }))
                                  }
                                  placeholder="Department"
                                  className="bg-slate-900 border border-slate-700 text-white rounded px-2 py-1 text-xs"
                                />
                              </div>
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingRelId(null)}
                                  className="px-2.5 py-1 bg-slate-800 text-slate-300 rounded text-xs"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="submit"
                                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded text-xs"
                                >
                                  Save Contact
                                </button>
                              </div>
                            </form>
                          )}

                          {showProv && (
                            <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-[10px] text-slate-400 space-y-1">
                              <div>
                                Source: <span className="text-slate-200">{relationship.sourceName}</span>
                                {relationship.provenance?.sourceType
                                  ? ` · Type: ${relationship.provenance.sourceType}`
                                  : ''}
                                {relationship.provenance?.reviewedByOwner
                                  ? ' · Approved by Owner'
                                  : ''}
                              </div>
                              {relationship.provenance?.firstObservedAt && (
                                <div className="font-mono tabular-nums">
                                  Observed: {relationship.provenance.firstObservedAt.slice(0, 10)}
                                  {relationship.provenance.lastObservedAt
                                    ? ` → ${relationship.provenance.lastObservedAt.slice(0, 10)}`
                                    : ''}
                                </div>
                              )}
                              {sanitizeExternalUrl(relationship.provenance?.sourceUrl) && (
                                <a
                                  href={sanitizeExternalUrl(relationship.provenance?.sourceUrl)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-indigo-400 hover:underline inline-flex items-center gap-1"
                                >
                                  <span>{relationship.provenance?.sourceUrl}</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              )}
                            </div>
                          )}

                          {otherCompanies && otherCompanies.length > 0 && (
                            <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5 text-[10px]">
                              <span className="text-slate-500 uppercase font-semibold">Also linked to (M:N):</span>
                              {otherCompanies.map((oc) => (
                                <span
                                  key={oc.leadId}
                                  className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300"
                                >
                                  {oc.companyName} ({oc.jobTitle || oc.relationshipType})
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 2. WEB INSPECTOR TAB (SSRF SAFE) */}
          {activeTab === 'web' && (
            <div className="space-y-4 text-xs">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-white text-xs flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-cyan-400" />
                      Live Website Crawler & SSRF Boundary Shield
                    </h4>
                    <p className="text-slate-400 text-[11px] mt-0.5">
                      Validates DNS, blocks private/local IP targets (127.0.0.1, 10.*, 192.168.*, 169.254.*), and extracts real metadata.
                    </p>
                  </div>

                  <button
                    onClick={handleRunWebInspect}
                    disabled={isInspecting || !lead.website}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded flex items-center gap-1.5 transition"
                  >
                    {isInspecting ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Inspecting Site...</span>
                      </>
                    ) : (
                      <>
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Inspect {lead.domain || 'Website'}</span>
                      </>
                    )}
                  </button>
                </div>

                {!lead.website && (
                  <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded text-amber-300 text-xs">
                    This lead currently does not have a public website recorded to inspect.
                  </div>
                )}
              </div>

              {/* Inspection Output */}
              {(inspectionResult || lead.webMetadata) && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <span className="font-semibold text-white">Live HTTP Signals</span>
                    <div className="flex items-center gap-3 font-mono text-[11px]">
                      <span className="text-emerald-400">
                        Status: HTTP {inspectionResult?.httpStatus || lead.webMetadata?.httpStatus || 200} OK
                      </span>
                      <span className="text-slate-400">
                        Latency: {inspectionResult?.serverLatencyMs || lead.webMetadata?.serverLatencyMs || 120}ms
                      </span>
                      <span className="text-cyan-400">
                        {(inspectionResult?.isHttps ?? lead.webMetadata?.isHttps) ? 'SSL Valid' : 'HTTP'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div>
                      <span className="text-slate-500 font-semibold block text-[11px]">HTML Page Title:</span>
                      <p className="text-white font-medium">
                        {inspectionResult?.title || lead.webMetadata?.title || 'None provided'}
                      </p>
                    </div>

                    <div>
                      <span className="text-slate-500 font-semibold block text-[11px]">Meta Description:</span>
                      <p className="text-slate-300 leading-relaxed">
                        {inspectionResult?.description || lead.webMetadata?.description || 'None provided'}
                      </p>
                    </div>

                    {inspectionResult?.emailsFound && inspectionResult.emailsFound.length > 0 && (
                      <div className="pt-2 border-t border-slate-800">
                        <span className="text-slate-500 font-semibold block text-[11px]">Discovered Emails in HTML:</span>
                        <div className="flex gap-2 mt-1">
                          {inspectionResult.emailsFound.map((e: string, i: number) => (
                            <span key={i} className="px-2 py-0.5 bg-slate-900 text-cyan-400 font-mono rounded border border-slate-800">
                              {e}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3. GEMINI AI TAB */}
          {activeTab === 'ai' && (
            <div className="space-y-4 text-xs">
              <div className="flex items-center gap-2">
                <button
                  onClick={runQuickAiAnalysis}
                  disabled={aiLoading}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded flex items-center gap-1.5 transition"
                >
                  <Bot className="w-3.5 h-3.5" />
                  <span>Analyze Lead with Gemini</span>
                </button>

                <button
                  onClick={runQuickAiPitch}
                  disabled={aiLoading}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-semibold rounded flex items-center gap-1.5 transition border border-slate-700"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Generate Custom Pitch</span>
                </button>
              </div>

              {aiError && (
                <div className="p-3 bg-rose-950/40 border border-rose-800 rounded text-rose-300 text-xs">
                  {aiError}
                </div>
              )}

              {aiAnalysis && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <span className="font-bold text-white">Gemini Qualification</span>
                    <span className="px-2 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded font-bold">
                      {aiAnalysis.qualificationStatus} ({aiAnalysis.fitScore}/100)
                    </span>
                  </div>
                  <p className="text-slate-300 leading-relaxed">{aiAnalysis.summary}</p>
                  <div>
                    <span className="font-semibold text-white block mb-1">Recommended Strategy:</span>
                    <p className="text-slate-300">{aiAnalysis.recommendedStrategy}</p>
                  </div>
                </div>
              )}

              {aiPitch && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="font-bold text-white pb-2 border-b border-slate-800">
                    Subject: {aiPitch.emailSubject}
                  </div>
                  <pre className="font-sans text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {aiPitch.emailBody}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* 4. PROVENANCE TIMELINE TAB */}
          {activeTab === 'timeline' && (
            <div className="space-y-4 text-xs">
              {/* Official Registry Verification History */}
              <div className="space-y-3">
                <h4 className="font-bold text-white text-xs flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Official Registry Verification History ({verificationHistory.length})</span>
                </h4>
                {verificationHistory.length === 0 ? (
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-500 text-xs">
                    No official registry verification runs recorded yet. Use &ldquo;Verify with Official Registry&rdquo; in Lead Facts to run a live check.
                  </div>
                ) : (
                  verificationHistory.map((entry, idx) => (
                    <div key={idx} className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">{entry.sourceName}</span>
                          {renderRegistryStateBadge(entry.state)}
                        </div>
                        <span className="text-slate-400 font-mono tabular-nums text-[10px]">
                          {formatDateLocale(entry.verifiedAt, leadLocale, leadTimezone)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300">{entry.summary}</p>
                      <div className="flex items-center flex-wrap gap-3 text-[10px] font-mono text-slate-400">
                        <span>Match: {entry.matchType}</span>
                        <span>Mode: {entry.isLiveApi ? 'Live API' : 'Offline / Unavailable'}</span>
                        {entry.matchedRegistrationNumber && (
                          <span>Reg: {entry.matchedRegistrationNumber}</span>
                        )}
                        {entry.conflictCount > 0 && (
                          <span className="text-rose-400">Conflicts: {entry.conflictCount}</span>
                        )}
                        {sanitizeExternalUrl(entry.sourceUrl) && (
                          <a
                            href={sanitizeExternalUrl(entry.sourceUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-400 hover:underline inline-flex items-center gap-1"
                          >
                            <span>Registry Record</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-3 pt-3 border-t border-slate-800">
                <h4 className="font-bold text-white text-xs">Source Observation Evidence</h4>
                {lead.sources.map((src, i) => (
                  <div key={i} className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">{src.sourceName}</span>
                      <span className="text-slate-500 font-mono tabular-nums text-[10px]">
                        Retrieved: {formatDateLocale(src.retrievedAt, leadLocale, leadTimezone)}
                      </span>
                    </div>

                    {src.providerId && (
                      <div className="text-[11px] text-cyan-400 font-mono">
                        Provider ID: {src.providerId}
                      </div>
                    )}

                    {src.attribution && (
                      <div className="text-[11px] text-slate-400">
                        <span className="text-slate-500">Attribution: </span>
                        {src.attribution}
                      </div>
                    )}

                    {src.license && (
                      <div className="text-[10px] text-slate-500">
                        License: <span className="text-slate-400">{src.license}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-3 pt-3 border-t border-slate-800">
                <h4 className="font-bold text-white text-xs">CRM Activity History</h4>
                {lead.activities.map((act) => (
                  <div
                    key={act.id}
                    className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-lg flex items-start gap-3"
                  >
                    <div className="w-2 h-2 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white">{act.title}</span>
                        <span className="text-[10px] text-slate-500">
                          {formatDateLocale(act.date, leadLocale, leadTimezone)}
                        </span>
                      </div>
                      {act.outcome && <p className="text-slate-400 text-[11px]">{act.outcome}</p>}
                      {act.notes && <p className="text-slate-500 text-[11px] italic">&quot;{act.notes}&quot;</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 5. NOTES TAB */}
          {activeTab === 'notes' && (
            <div className="space-y-4 text-xs">
              <form onSubmit={handleAddNoteSubmit} className="space-y-2">
                <textarea
                  rows={3}
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Record call summary, decision maker details, or next action items..."
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded p-2.5 focus:outline-none focus:border-indigo-500 text-xs"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded"
                  >
                    Post Note
                  </button>
                </div>
              </form>

              <div className="space-y-2">
                {lead.notes.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 text-xs">No notes recorded yet.</div>
                ) : (
                  lead.notes.map((n) => (
                    <div key={n.id} className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span className="font-semibold text-slate-300">{n.author}</span>
                        <span>{formatDateLocale(n.createdAt, leadLocale, leadTimezone)}</span>
                      </div>
                      <p className="text-slate-200 leading-relaxed">{n.content}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
