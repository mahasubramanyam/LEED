import React, { useState } from 'react';
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
} from 'lucide-react';
import { CanonicalLead, PipelineStage, LeadIdentifier } from '../types.js';
import { GeoSelector } from './GeoSelector.tsx';
import { apiFetch } from '../utils/apiFetch.ts';

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

interface LeadDetailModalProps {
  lead: CanonicalLead | null;
  stages: PipelineStage[];
  onClose: () => void;
  onUpdateLead: (lead: CanonicalLead) => void;
  onAddNote: (leadId: string, content: string) => void;
  onAddActivity: (leadId: string, activity: any) => void;
  onInspectUrl: (url: string, leadId: string) => Promise<any>;
}

export const LeadDetailModal: React.FC<LeadDetailModalProps> = ({
  lead,
  stages,
  onClose,
  onUpdateLead,
  onAddNote,
  onAddActivity,
  onInspectUrl,
}) => {
  if (!lead) return null;

  const [activeTab, setActiveTab] = useState<'overview' | 'web' | 'ai' | 'timeline' | 'notes'>('overview');
  const [newNote, setNewNote] = useState('');
  const [newTag, setNewTag] = useState('');
  const [oppValue, setOppValue] = useState(lead.opportunityValue?.toString() || '');
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectionResult, setInspectionResult] = useState<any>(null);

  // International Identifier state
  const [newIdentType, setNewIdentType] = useState('CRN');
  const [newIdentValue, setNewIdentValue] = useState('');
  const [newIdentCountry, setNewIdentCountry] = useState(lead.address?.countryCode || 'GB');
  const [newIdentAuthority, setNewIdentAuthority] = useState('');
  const [isAddingIdent, setIsAddingIdent] = useState(false);
  const [identValidationFeedback, setIdentValidationFeedback] = useState<{
    valid: boolean;
    normalizedValue?: string;
    status?: string;
    message?: string;
  } | null>(null);

  // Location & Contact Edit state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editGeo, setEditGeo] = useState({
    countryCode: lead.address?.countryCode || 'US',
    countryName: lead.address?.country || 'United States',
    region: lead.address?.region || '',
    city: lead.address?.city || '',
    postalCode: lead.address?.postalCode || '',
    street: lead.address?.street || '',
    currency: lead.currency || 'USD',
  });
  const [editPhone, setEditPhone] = useState(lead.phone || '');
  const [editEmail, setEditEmail] = useState(lead.email || '');
  const [editWebsite, setEditWebsite] = useState(lead.website || '');
  const [editProfileError, setEditProfileError] = useState<string | null>(null);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditProfileError(null);
    try {
      // 1. Format address according to destination country conventions
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
        if (addrData.postalValidation && !addrData.postalValidation.valid && editGeo.postalCode.trim()) {
          setEditProfileError(addrData.postalValidation.message || 'Invalid postal code format for country');
          return;
        }
        if (addrData.formattedAddress) formattedAddress = addrData.formattedAddress;
      }

      // 2. Normalize phone to E.164 if provided
      let finalPhone = editPhone.trim() || undefined;
      if (finalPhone) {
        const phoneRes = await apiFetch('/api/geo/normalize-phone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: finalPhone, countryCode: editGeo.countryCode }),
        });
        if (phoneRes.ok) {
          const phoneData = await phoneRes.json();
          if (phoneData.e164) finalPhone = phoneData.e164;
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
        phone: finalPhone,
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

  // AI Quick Actions state
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [aiPitch, setAiPitch] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const handleValidateIdentifier = async () => {
    if (!newIdentValue.trim()) return;
    try {
      const token = localStorage.getItem('leed_session_token');
      const csrfMatch = document.cookie.match(/leed_csrf=([^;]+)/);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (csrfMatch) headers['x-leed-csrf-token'] = csrfMatch[1];

      const res = await fetch('/api/identifiers/validate', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          type: newIdentType,
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

  const handleSaveIdentifier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIdentValue.trim()) return;

    const validatedStatus = identValidationFeedback?.valid ? 'syntax_validated' : 'user_provided';
    const normalizedVal = identValidationFeedback?.normalizedValue || newIdentValue.trim();

    const newIdentifier: LeadIdentifier = {
      type: newIdentType,
      value: newIdentValue.trim(),
      normalizedValue: normalizedVal,
      countryCode: newIdentCountry,
      issuingAuthority: newIdentAuthority.trim() || undefined,
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
    try {
      const res = await fetch('/api/ai/analyze-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const data = await res.json();
      setAiAnalysis(data);
    } finally {
      setAiLoading(false);
    }
  };

  const runQuickAiPitch = async () => {
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai/generate-pitch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const data = await res.json();
      setAiPitch(data);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Drawer Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-950/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl" title={lead.address?.country || lead.address?.countryCode}>
                {getCountryFlag(lead.address?.countryCode)}
              </span>
              <h2 className="text-lg font-bold text-white tracking-tight">{lead.companyName}</h2>
              {lead.address?.countryCode && (
                <span className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700 rounded uppercase">
                  {lead.address.countryCode}
                </span>
              )}
              {lead.registrationNumber && (
                <span className="px-2 py-0.5 text-xs font-mono bg-cyan-950/60 text-cyan-400 border border-cyan-800/60 rounded">
                  {lead.registrationType}: {lead.registrationNumber}
                </span>
              )}
            </div>

            <p className="text-xs text-slate-400">
              {lead.legalName && lead.legalName !== lead.companyName && (
                <span className="text-slate-300 font-medium mr-2">Legal: {lead.legalName} •</span>
              )}
              {lead.industry} • {lead.category}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Confidence Score Pill */}
            <div className="text-right">
              <span
                className={`px-2.5 py-1 text-xs font-bold rounded flex items-center gap-1.5 ${
                  lead.confidenceScore >= 80
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{lead.confidenceScore}% Confidence</span>
              </span>
            </div>

            {/* Close Button */}
            <button
              onClick={onClose}
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
                value={lead.pipelineStageId}
                onChange={(e) => handleUpdateStage(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-white rounded px-2 py-0.5 font-medium"
              >
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
        <div className="px-5 border-b border-slate-800 flex space-x-4 bg-slate-950/20 text-xs">
          {[
            { id: 'overview', label: 'Lead Facts & Profile' },
            { id: 'web', label: 'Live Web Inspector (SSRF Safe)' },
            { id: 'ai', label: 'Gemini AI Assistant' },
            { id: 'timeline', label: `Provenance Timeline (${lead.sources.length})` },
            { id: 'notes', label: `Notes & Logs (${lead.notes.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-3 font-semibold border-b-2 transition ${
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
                      {lead.website ? (
                        <a
                          href={lead.website}
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
                      {lead.phone ? (
                        <div className="text-right">
                          <a
                            href={`tel:${lead.phone}`}
                            className="text-emerald-400 hover:underline font-mono block font-semibold"
                          >
                            {lead.phone}
                          </a>
                          <span className="text-[10px] text-slate-500 font-mono">E.164 Standard</span>
                        </div>
                      ) : (
                        <span className="text-slate-500">None on record</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              )}

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
                          <option value="CRN">CRN (Company Reg No)</option>
                          <option value="ORGNR">ORGNR (Brønnøysund Org No)</option>
                          <option value="ABN">ABN (Australian Business No)</option>
                          <option value="ACN">ACN (Australian Company No)</option>
                          <option value="EIN">EIN (US Employer ID)</option>
                          <option value="VAT">VAT / Tax ID</option>
                          <option value="LEI">LEI (Legal Entity Identifier)</option>
                          <option value="SIREN">SIREN (France 9-digit)</option>
                          <option value="SIRET">SIRET (France 14-digit)</option>
                          <option value="HANDELSREGISTER">Handelsregister (DE)</option>
                          <option value="OTHER">Other Custom Registry</option>
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
                            {ident.type}
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

          {/* 2. WEB INSPECTOR TAB (SSRF SAFE) */}
          {activeTab === 'web' && (
            <div className="space-y-4 text-xs">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-white text-xs flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
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
              <div className="space-y-3">
                <h4 className="font-bold text-white text-xs">Source Observation Evidence</h4>
                {lead.sources.map((src, i) => (
                  <div key={i} className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">{src.sourceName}</span>
                      <span className="text-slate-500 font-mono text-[10px]">
                        Retrieved: {new Date(src.retrievedAt).toLocaleString()}
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
                          {new Date(act.date).toLocaleDateString()}
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
                        <span>{new Date(n.createdAt).toLocaleString()}</span>
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
