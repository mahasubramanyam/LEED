import React, { useState, useEffect } from 'react';
import {
  GitMerge,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  ArrowRight,
  Building2,
  MapPin,
  ExternalLink,
  Layers,
} from 'lucide-react';
import { DuplicateMatch, MergeHistoryRecord, CanonicalLead } from '../types.js';

interface DedupeHubProps {
  onRefreshLeads: () => void;
  onSelectLead: (lead: CanonicalLead) => void;
}

export const DedupeHub: React.FC<DedupeHubProps> = ({
  onRefreshLeads,
  onSelectLead,
}) => {
  const [candidates, setCandidates] = useState<DuplicateMatch[]>([]);
  const [history, setHistory] = useState<MergeHistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'candidates' | 'history'>('candidates');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadDedupeData = async () => {
    setIsLoading(true);
    try {
      const [candRes, histRes] = await Promise.all([
        fetch('/api/dedupe/candidates'),
        fetch('/api/dedupe/history'),
      ]);
      const candData = await candRes.json();
      const histData = await histRes.json();
      setCandidates(candData.candidates || []);
      setHistory(histData || []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDedupeData();
  }, []);

  const handleMerge = async (match: DuplicateMatch, survivorId: string, absorbedId: string) => {
    try {
      const res = await fetch('/api/dedupe/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          survivorId,
          absorbedId,
          reason: `Matched by ${match.matchType} (${match.matchedValue})`,
        }),
      });

      if (res.ok) {
        setActionMessage('Leads merged successfully. All sources and identifiers preserved.');
        loadDedupeData();
        onRefreshLeads();
        setTimeout(() => setActionMessage(null), 3500);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleUndo = async (historyId: string) => {
    try {
      const res = await fetch(`/api/dedupe/undo/${historyId}`, {
        method: 'POST',
      });
      if (res.ok) {
        setActionMessage('Merge undone. Original absorbed lead restored.');
        loadDedupeData();
        onRefreshLeads();
        setTimeout(() => setActionMessage(null), 3500);
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <GitMerge className="w-5 h-5 text-indigo-400" />
            Canonical Deduplication & Provenance Merge Engine
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Exact domain, official registration number (CRN/ABN/OrgNr), phone, and fuzzy string similarity detector.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('candidates')}
            className={`px-3 py-1.5 text-xs font-semibold rounded transition ${
              activeTab === 'candidates'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            Review Candidates ({candidates.length})
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1.5 text-xs font-semibold rounded transition ${
              activeTab === 'history'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            Merge History & Undo ({history.length})
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-800 rounded-lg text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {/* Review Candidates View */}
      {activeTab === 'candidates' && (
        <div className="space-y-4">
          {candidates.length === 0 ? (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-12 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <h3 className="text-sm font-semibold text-white">Pipeline is 100% Clean</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                No duplicate domains, registration numbers, or high-similarity business records detected across your canonical leads.
              </p>
            </div>
          ) : (
            candidates.map((match, i) => {
              const survivor = match.recommendedSurvivorId === match.leadA.id ? match.leadA : match.leadB;
              const absorbed = match.recommendedSurvivorId === match.leadA.id ? match.leadB : match.leadA;

              return (
                <div
                  key={i}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-sm"
                >
                  {/* Match Header */}
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-amber-400 uppercase tracking-wide text-[10px] bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
                        {match.matchType.replace('_', ' ')} Match
                      </span>
                      <span className="text-slate-300">
                        Signal: <code className="text-cyan-400">{match.matchedValue}</code>
                      </span>
                    </div>

                    <div className="text-slate-400">
                      Similarity: <span className="font-bold text-white">{Math.round(match.similarityScore * 100)}%</span>
                    </div>
                  </div>

                  {/* Side-by-Side Comparison */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    {/* Lead A */}
                    <div
                      className={`p-3.5 rounded-lg border space-y-2 transition ${
                        survivor.id === match.leadA.id
                          ? 'bg-slate-950 border-emerald-600/50'
                          : 'bg-slate-950/60 border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white">{match.leadA.companyName}</span>
                        {survivor.id === match.leadA.id && (
                          <span className="text-[10px] bg-emerald-500/10 text-emerald-400 font-bold px-1.5 py-0.2 rounded border border-emerald-500/30">
                            Recommended Survivor
                          </span>
                        )}
                      </div>

                      <div className="space-y-1 text-slate-400">
                        {match.leadA.registrationNumber && (
                          <div>
                            <span className="text-slate-500">Reg:</span> {match.leadA.registrationNumber}
                          </div>
                        )}
                        <div>
                          <span className="text-slate-500">City:</span> {match.leadA.address?.city || 'Unknown'}
                        </div>
                        <div>
                          <span className="text-slate-500">Domain:</span> {match.leadA.domain || 'N/A'}
                        </div>
                        <div>
                          <span className="text-slate-500">Confidence:</span> {match.leadA.confidenceScore}%
                        </div>
                        <div>
                          <span className="text-slate-500">Source:</span> {match.leadA.sources[0]?.sourceName}
                        </div>
                      </div>
                    </div>

                    {/* Lead B */}
                    <div
                      className={`p-3.5 rounded-lg border space-y-2 transition ${
                        survivor.id === match.leadB.id
                          ? 'bg-slate-950 border-emerald-600/50'
                          : 'bg-slate-950/60 border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white">{match.leadB.companyName}</span>
                        {survivor.id === match.leadB.id && (
                          <span className="text-[10px] bg-emerald-500/10 text-emerald-400 font-bold px-1.5 py-0.2 rounded border border-emerald-500/30">
                            Recommended Survivor
                          </span>
                        )}
                      </div>

                      <div className="space-y-1 text-slate-400">
                        {match.leadB.registrationNumber && (
                          <div>
                            <span className="text-slate-500">Reg:</span> {match.leadB.registrationNumber}
                          </div>
                        )}
                        <div>
                          <span className="text-slate-500">City:</span> {match.leadB.address?.city || 'Unknown'}
                        </div>
                        <div>
                          <span className="text-slate-500">Domain:</span> {match.leadB.domain || 'N/A'}
                        </div>
                        <div>
                          <span className="text-slate-500">Confidence:</span> {match.leadB.confidenceScore}%
                        </div>
                        <div>
                          <span className="text-slate-500">Source:</span> {match.leadB.sources[0]?.sourceName}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                    <span className="text-slate-500 text-[11px]">
                      Merging absorbs duplicate fields, merges source history, and preserves raw evidence.
                    </span>

                    <button
                      onClick={() => handleMerge(match, survivor.id, absorbed.id)}
                      className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded flex items-center gap-1.5 transition"
                    >
                      <GitMerge className="w-3.5 h-3.5" />
                      <span>Merge into {survivor.companyName}</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Merge History & Undo View */}
      {activeTab === 'history' && (
        <div className="space-y-3">
          {history.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-500 text-xs">
              No previous merges recorded. All merged records have snapshot backups here.
            </div>
          ) : (
            history.map((record) => (
              <div
                key={record.id}
                className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex items-center justify-between gap-4 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">
                      Merged: {record.mergedLeadSnapshot.companyName}
                    </span>
                    <span className="text-slate-500">→</span>
                    <span className="text-emerald-400 font-medium">Survivor ID {record.survivorLeadId}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Reason: {record.mergedReason} • Timestamp: {new Date(record.mergedAt).toLocaleString()}
                  </div>
                </div>

                <button
                  onClick={() => handleUndo(record.id)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-600/40 rounded flex items-center gap-1.5 font-medium transition"
                  title="Undo merge and restore lead record"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Undo Merge</span>
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
