import React, { useState } from 'react';
import {
  Bot,
  Sparkles,
  Target,
  Send,
  FileText,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Building2,
  BarChart3,
  Lightbulb,
} from 'lucide-react';
import { CanonicalLead } from '../types.js';
import { apiFetch } from '../utils/apiFetch.ts';

interface AiSalesAgentProps {
  leads: CanonicalLead[];
  selectedLeadId?: string;
  onLeadSelect?: (id: string) => void;
  onAddActivityToLead: (leadId: string, activity: any) => void;
}

export const AiSalesAgent: React.FC<AiSalesAgentProps> = ({
  leads,
  selectedLeadId: initialLeadId,
  onAddActivityToLead,
}) => {
  const [selectedLeadId, setSelectedLeadId] = useState<string>(
    initialLeadId || (leads[0]?.id ?? '')
  );
  const [activeMode, setActiveMode] = useState<'analyze' | 'pitch' | 'brief' | 'market'>('analyze');
  const [valueProposition, setValueProposition] = useState(
    'Automating B2B data governance and verified registry pipeline workflows with zero fake records.'
  );
  const [marketCountry, setMarketCountry] = useState('NO');
  const [marketIndustry, setMarketIndustry] = useState('Technology & Engineering');

  const [isLoading, setIsLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [pitchResult, setPitchResult] = useState<any>(null);
  const [briefResult, setBriefResult] = useState<any>(null);
  const [marketResult, setMarketResult] = useState<any>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const currentLead = leads.find((l) => l.id === selectedLeadId) || leads[0];

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const runAnalysis = async () => {
    if (!currentLead) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/ai/analyze-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: currentLead.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI Analysis failed');
      setAnalysisResult(data);

      onAddActivityToLead(currentLead.id, {
        id: `act-${Date.now()}`,
        type: 'enrichment',
        title: 'Gemini AI Lead Qualification Completed',
        outcome: `${data.qualificationStatus} (${data.fitScore}% Fit Score)`,
        date: new Date().toISOString(),
        actor: 'Gemini AI Agent',
      });
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const runPitchDraft = async () => {
    if (!currentLead) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/ai/generate-pitch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: currentLead.id, valueProposition }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Pitch generation failed');
      setPitchResult(data);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const runMeetingBrief = async () => {
    if (!currentLead) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/ai/meeting-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: currentLead.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Meeting brief generation failed');
      setBriefResult(data);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const runMarketReport = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/ai/market-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country: marketCountry, industry: marketIndustry }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Market report failed');
      setMarketResult(data);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-indigo-950/60 to-slate-900 border border-indigo-800/40 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 flex-shrink-0">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">AI Sales Agent & Intelligence Studio</h2>
                <span className="text-[10px] font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded">
                  gemini-3.8-flash
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Truthful, context-grounded AI agent analyzing genuine registry and web facts without hallucinating claims.
              </p>
            </div>
          </div>

          {/* Mode Selector */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setActiveMode('analyze')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition flex items-center gap-1.5 ${
                activeMode === 'analyze' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Target className="w-3.5 h-3.5" />
              <span>Qualification</span>
            </button>

            <button
              onClick={() => setActiveMode('pitch')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition flex items-center gap-1.5 ${
                activeMode === 'pitch' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>Outreach Pitch</span>
            </button>

            <button
              onClick={() => setActiveMode('brief')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition flex items-center gap-1.5 ${
                activeMode === 'brief' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Meeting Brief</span>
            </button>

            <button
              onClick={() => setActiveMode('market')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition flex items-center gap-1.5 ${
                activeMode === 'market' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Market Report</span>
            </button>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 bg-rose-950/40 border border-rose-800 rounded-lg text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Grid: Target Lead Selector & Work Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Target Lead Context Card */}
        {activeMode !== 'market' ? (
          <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Select Prospect from Pipeline
              </label>
              <select
                value={currentLead?.id || ''}
                onChange={(e) => setSelectedLeadId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2 focus:outline-none focus:border-indigo-500 font-medium"
              >
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.companyName} ({l.address?.countryCode || 'INT'}) - {l.confidenceScore}% Conf
                  </option>
                ))}
              </select>
            </div>

            {currentLead && (
              <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-white">{currentLead.companyName}</h4>
                  <span className="px-1.5 py-0.5 text-[10px] bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/30">
                    {currentLead.confidenceScore}% Conf
                  </span>
                </div>

                {currentLead.registrationNumber && (
                  <div className="text-[11px] font-mono text-cyan-400">
                    {currentLead.registrationType}: {currentLead.registrationNumber}
                  </div>
                )}

                <div className="space-y-1 text-slate-300">
                  <div>
                    <span className="text-slate-500">Location: </span>
                    {currentLead.address?.formattedAddress || currentLead.address?.country || 'Unknown'}
                  </div>
                  <div>
                    <span className="text-slate-500">Industry: </span>
                    {currentLead.industry}
                  </div>
                  <div>
                    <span className="text-slate-500">Website: </span>
                    {currentLead.website ? (
                      <span className="text-indigo-400 font-mono">{currentLead.domain || currentLead.website}</span>
                    ) : (
                      <span className="text-slate-500">None on record</span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-500">Public Email: </span>
                    {currentLead.email ? (
                      <span className="text-cyan-400 font-mono">{currentLead.email}</span>
                    ) : (
                      <span className="text-slate-500">None on record</span>
                    )}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800">
                  <span className="text-[10px] text-slate-500 uppercase font-semibold">Verified Signals:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {currentLead.confidenceSignals.map((sig, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.5 text-[10px] bg-slate-900 text-slate-300 rounded border border-slate-800"
                      >
                        {sig}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeMode === 'pitch' && (
              <div className="space-y-1.5 pt-2 border-t border-slate-800">
                <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Our Value Proposition / Offer
                </label>
                <textarea
                  rows={3}
                  value={valueProposition}
                  onChange={(e) => setValueProposition(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2 focus:outline-none focus:border-indigo-500"
                  placeholder="What service or product are you offering this business?"
                />
              </div>
            )}

            <button
              onClick={() => {
                if (activeMode === 'analyze') runAnalysis();
                if (activeMode === 'pitch') runPitchDraft();
                if (activeMode === 'brief') runMeetingBrief();
              }}
              disabled={isLoading || !currentLead}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded flex items-center justify-center gap-2 transition shadow-sm"
            >
              {isLoading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Synthesizing with Gemini...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {activeMode === 'analyze'
                      ? 'Analyze & Qualify Lead'
                      : activeMode === 'pitch'
                      ? 'Generate Personalized Pitch'
                      : 'Prepare Meeting Brief'}
                  </span>
                </>
              )}
            </button>
          </div>
        ) : (
          /* Market Mode Parameters */
          <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Market Intelligence Parameters
            </h3>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Target Country</label>
              <select
                value={marketCountry}
                onChange={(e) => setMarketCountry(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2"
              >
                <option value="NO">🇳🇴 Norway</option>
                <option value="GB">🇬🇧 United Kingdom</option>
                <option value="AU">🇦🇺 Australia</option>
                <option value="US">🇺🇸 United States</option>
                <option value="DE">🇩🇪 Germany</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Target Industry / Domain</label>
              <input
                type="text"
                value={marketIndustry}
                onChange={(e) => setMarketIndustry(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2"
              />
            </div>

            <button
              onClick={runMarketReport}
              disabled={isLoading}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded flex items-center justify-center gap-2 transition"
            >
              {isLoading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Generating Market Report...</span>
                </>
              ) : (
                <>
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span>Generate Market Report</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Right Column: AI Output Canvas */}
        <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl p-5 min-h-[450px]">
          {activeMode === 'analyze' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Target className="w-4 h-4 text-indigo-400" />
                  Prospect Qualification & Fit Assessment
                </h3>
                {analysisResult && (
                  <span
                    className={`px-2 py-0.5 text-xs font-bold rounded ${
                      analysisResult.qualificationStatus === 'Strong Fit'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    {analysisResult.qualificationStatus} ({analysisResult.fitScore}/100)
                  </span>
                )}
              </div>

              {!analysisResult && !isLoading && (
                <div className="p-12 text-center text-slate-500 text-xs">
                  Click &quot;Analyze & Qualify Lead&quot; to inspect this business profile using Gemini AI.
                </div>
              )}

              {analysisResult && (
                <div className="space-y-4 text-xs">
                  <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 text-slate-200 leading-relaxed">
                    <span className="font-semibold text-white block mb-1 text-xs">Executive Summary:</span>
                    {analysisResult.summary}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-emerald-950/20 border border-emerald-800/40 rounded-lg p-3 space-y-1.5">
                      <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Key Strengths Observed
                      </span>
                      <ul className="space-y-1 text-slate-300">
                        {analysisResult.keyStrengths?.map((st: string, i: number) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-emerald-400">•</span>
                            <span>{st}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="bg-amber-950/20 border border-amber-800/40 rounded-lg p-3 space-y-1.5">
                      <span className="font-semibold text-amber-400 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5" /> Data Gaps & Missing Information
                      </span>
                      <ul className="space-y-1 text-slate-300">
                        {analysisResult.missingDataGaps?.map((gap: string, i: number) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-amber-400">•</span>
                            <span>{gap}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 space-y-2">
                    <span className="font-semibold text-white block text-xs">
                      Recommended Sales Strategy:
                    </span>
                    <p className="text-slate-300">{analysisResult.recommendedStrategy}</p>
                  </div>

                  {analysisResult.suggestedQualificationQuestions && (
                    <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 space-y-2">
                      <span className="font-semibold text-indigo-400 block text-xs">
                        Suggested Discovery Questions for Call:
                      </span>
                      <ul className="space-y-1 text-slate-300">
                        {analysisResult.suggestedQualificationQuestions.map((q: string, i: number) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-indigo-400 font-mono font-bold">{i + 1}.</span>
                            <span>{q}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeMode === 'pitch' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Send className="w-4 h-4 text-indigo-400" />
                  Personalized Multi-Channel Outreach Copy
                </h3>
              </div>

              {!pitchResult && !isLoading && (
                <div className="p-12 text-center text-slate-500 text-xs">
                  Click &quot;Generate Personalized Pitch&quot; to compose custom email, LinkedIn, and cold call scripts.
                </div>
              )}

              {pitchResult && (
                <div className="space-y-4 text-xs">
                  {/* Email Pitch */}
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">Subject: {pitchResult.emailSubject}</span>
                      <button
                        onClick={() =>
                          handleCopy(
                            `Subject: ${pitchResult.emailSubject}\n\n${pitchResult.emailBody}`,
                            'email'
                          )
                        }
                        className="text-slate-400 hover:text-white flex items-center gap-1 font-medium"
                      >
                        {copiedKey === 'email' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey === 'email' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <pre className="font-sans text-slate-300 whitespace-pre-wrap leading-relaxed pt-2 border-t border-slate-800">
                      {pitchResult.emailBody}
                    </pre>
                  </div>

                  {/* LinkedIn Connection Note */}
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-indigo-400">LinkedIn InMail / Connection Note</span>
                      <button
                        onClick={() => handleCopy(pitchResult.linkedInMessage, 'li')}
                        className="text-slate-400 hover:text-white flex items-center gap-1 font-medium"
                      >
                        {copiedKey === 'li' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey === 'li' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <p className="text-slate-300 leading-relaxed">{pitchResult.linkedInMessage}</p>
                  </div>

                  {/* Cold Call Opener */}
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-emerald-400">Conversational Cold Call Opener</span>
                      <button
                        onClick={() => handleCopy(pitchResult.coldCallOpener, 'call')}
                        className="text-slate-400 hover:text-white flex items-center gap-1 font-medium"
                      >
                        {copiedKey === 'call' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey === 'call' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <p className="text-slate-300 leading-relaxed italic">&quot;{pitchResult.coldCallOpener}&quot;</p>
                  </div>

                  {pitchResult.rationale && (
                    <div className="p-3 bg-indigo-950/20 border border-indigo-900/40 rounded-lg text-indigo-300 text-xs">
                      <span className="font-semibold block mb-0.5">Copywriter Rationale:</span>
                      {pitchResult.rationale}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeMode === 'brief' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-400" />
                  60-Second Executive Meeting Brief & Battle Card
                </h3>
              </div>

              {!briefResult && !isLoading && (
                <div className="p-12 text-center text-slate-500 text-xs">
                  Click &quot;Prepare Meeting Brief&quot; to review objection handling cards and talking points.
                </div>
              )}

              {briefResult && (
                <div className="space-y-4 text-xs">
                  <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800">
                    <span className="font-semibold text-white block mb-1 text-xs">Executive Overview:</span>
                    <p className="text-slate-300 leading-relaxed">{briefResult.executiveOverview}</p>
                  </div>

                  <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 space-y-2">
                    <span className="font-semibold text-white block text-xs">Recommended Discussion Topics:</span>
                    <ul className="space-y-1 text-slate-300">
                      {briefResult.discussionTopics?.map((t: string, i: number) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-indigo-400">•</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <span className="font-semibold text-white block text-xs">
                      Objection Handling Battle Card:
                    </span>
                    <div className="grid grid-cols-1 gap-2.5">
                      {briefResult.potentialObjections?.map((obj: any, i: number) => (
                        <div key={i} className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1">
                          <div className="font-semibold text-rose-400 flex items-center gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5" /> Objection: &quot;{obj.objection}&quot;
                          </div>
                          <div className="text-slate-300 pl-5 text-[11px] leading-relaxed">
                            <span className="text-emerald-400 font-semibold">Suggested Rebuttal: </span>
                            {obj.suggestedRebuttal}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-indigo-950/20 border border-indigo-800/40 p-3 rounded-lg text-indigo-300">
                    <span className="font-semibold block mb-0.5">Closing Objective:</span>
                    {briefResult.closingGoal}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeMode === 'market' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-indigo-400" />
                  Regional Market Opportunity Intelligence
                </h3>
              </div>

              {!marketResult && !isLoading && (
                <div className="p-12 text-center text-slate-500 text-xs">
                  Generate a market report for the selected country and industry to analyze pipeline opportunities.
                </div>
              )}

              {marketResult && (
                <div className="space-y-4 text-xs">
                  <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800">
                    <span className="font-semibold text-white block mb-1 text-xs">Market Assessment:</span>
                    <p className="text-slate-300 leading-relaxed">{marketResult.marketSummary}</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1.5">
                      <span className="font-semibold text-indigo-400 flex items-center gap-1.5">
                        <Lightbulb className="w-3.5 h-3.5" /> Regional Trends
                      </span>
                      <ul className="space-y-1 text-slate-300">
                        {marketResult.regionalTrends?.map((tr: string, i: number) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-indigo-400">•</span>
                            <span>{tr}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1.5">
                      <span className="font-semibold text-cyan-400 flex items-center gap-1.5">
                        <Target className="w-3.5 h-3.5" /> Underserved Niches
                      </span>
                      <ul className="space-y-1 text-slate-300">
                        {marketResult.underservedNiches?.map((n: string, i: number) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-cyan-400">•</span>
                            <span>{n}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 space-y-1.5">
                    <span className="font-semibold text-emerald-400 block text-xs">
                      Recommended Go-To-Market & Outreach Angle:
                    </span>
                    <p className="text-slate-300 leading-relaxed">{marketResult.recommendedOutreachStrategy}</p>
                  </div>

                  <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg text-slate-400 text-[11px]">
                    <span className="font-semibold text-slate-300 block mb-0.5">Regulatory / Market Context:</span>
                    {marketResult.competitorOrRegulatoryContext}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
