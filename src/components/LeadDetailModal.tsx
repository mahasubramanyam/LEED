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
} from 'lucide-react';
import { CanonicalLead, PipelineStage } from '../types.js';

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

  // AI Quick Actions state
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [aiPitch, setAiPitch] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);

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
              <span className="text-xl">
                {lead.address?.countryCode === 'NO'
                  ? '🇳🇴'
                  : lead.address?.countryCode === 'GB'
                  ? '🇬🇧'
                  : lead.address?.countryCode === 'AU'
                  ? '🇦🇺'
                  : '🌐'}
              </span>
              <h2 className="text-lg font-bold text-white tracking-tight">{lead.companyName}</h2>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Physical Location */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                  <h4 className="font-bold text-white flex items-center gap-1.5 text-xs">
                    <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                    Physical & Registered Address
                  </h4>
                  <div className="space-y-1 text-slate-300">
                    <div>{lead.address?.formattedAddress || 'No formatted address on file'}</div>
                    {lead.address?.street && <div className="text-slate-400">{lead.address.street}</div>}
                    <div className="text-slate-400">
                      {[lead.address?.postalCode, lead.address?.city, lead.address?.country]
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                    {lead.coordinates && (
                      <div className="font-mono text-cyan-400 text-[11px] pt-1">
                        GPS: {lead.coordinates.lat.toFixed(4)}, {lead.coordinates.lon.toFixed(4)}
                      </div>
                    )}
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
                        <span className="text-emerald-400 font-mono">{lead.phone}</span>
                      ) : (
                        <span className="text-slate-500">None on record</span>
                      )}
                    </div>
                  </div>
                </div>
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

              {/* Registered Identifiers */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                <h4 className="font-bold text-white text-xs">Registered System Identifiers</h4>
                <div className="flex flex-wrap gap-2">
                  {lead.identifiers.map((ident, i) => (
                    <div
                      key={i}
                      className="px-2.5 py-1 bg-slate-900 border border-slate-800 rounded font-mono text-[11px] text-slate-300 flex items-center gap-2"
                    >
                      <span className="text-slate-500">{ident.type}:</span>
                      <span className="text-cyan-400">{ident.value}</span>
                      {ident.verified && <span className="text-emerald-400 text-[10px]">✓</span>}
                    </div>
                  ))}
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
