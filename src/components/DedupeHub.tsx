import React, { useState, useEffect } from 'react';
import { GitMerge, RotateCcw } from 'lucide-react';
import { DuplicateMatch, MergeHistoryRecord, CanonicalLead } from '../types.js';
import { apiFetch } from '../utils/apiFetch.ts';
import { formatDateLocale } from '../../shared/localization.ts';
import { EmptyState, NoticeBanner, SegmentedTabs, SurfaceCard, WorkspaceToolbar } from './ui/SunsetUI.tsx';

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
        apiFetch('/api/dedupe/candidates'),
        apiFetch('/api/dedupe/history'),
      ]);
      const candData = candRes.ok ? await candRes.json() : { candidates: [] };
      const histData = histRes.ok ? await histRes.json() : [];
      setCandidates(candData.candidates || []);
      setHistory(Array.isArray(histData) ? histData : []);
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
      const res = await apiFetch('/api/dedupe/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          survivorId,
          absorbedId,
          reason: `Matched by ${match.matchType} (${match.matchedValue})`,
        }),
      });

      if (res.ok) {
        setActionMessage('Records merged. Sources and identifiers preserved.');
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
      const res = await apiFetch(`/api/dedupe/undo/${historyId}`, {
        method: 'POST',
      });
      if (res.ok) {
        setActionMessage('Merge undone. Original record restored.');
        loadDedupeData();
        onRefreshLeads();
        setTimeout(() => setActionMessage(null), 3500);
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-5">
      <WorkspaceToolbar
        meta={isLoading ? 'Scanning records...' : `${candidates.length} candidates · ${history.length} merges`}
      >
        <SegmentedTabs
          variant="segmented"
          activeId={activeTab}
          onChange={setActiveTab}
          items={[
            { id: 'candidates', label: 'Candidates', count: candidates.length },
            { id: 'history', label: 'Merge History', count: history.length },
          ]}
        />
      </WorkspaceToolbar>

      {actionMessage && (
        <NoticeBanner tone="success" message={actionMessage} onDismiss={() => setActionMessage(null)} />
      )}

      {activeTab === 'candidates' && (
        <div className="space-y-4">
          {candidates.length === 0 ? (
            <EmptyState
              title="No duplicates found"
              description="All company records are unique across domains, registration numbers, and names."
            />
          ) : (
            candidates.map((match, i) => {
              const survivor = match.recommendedSurvivorId === match.leadA.id ? match.leadA : match.leadB;
              const absorbed = match.recommendedSurvivorId === match.leadA.id ? match.leadB : match.leadA;

              return (
                <SurfaceCard key={i} className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[#540B0E] dark:text-[#FFF3B0] capitalize">
                        {match.matchType.replace('_', ' ')} match
                      </span>
                      <span className="text-slate-300 dark:text-slate-700">·</span>
                      <code className="font-mono text-[#335C67] dark:text-[#8AB0BA]">
                        {match.matchedValue}
                      </code>
                    </div>
                    <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {Math.round(match.similarityScore * 100)}% similarity
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    {[match.leadA, match.leadB].map((lead) => {
                      const isSurvivor = survivor.id === lead.id;
                      return (
                        <div
                          key={lead.id}
                          className={`p-4 rounded-lg border space-y-2 transition-colors ${
                            isSurvivor
                              ? 'bg-[#FFF9D8]/60 dark:bg-[#232A24] border-[#E09F3E]/60'
                              : 'bg-slate-50/70 dark:bg-slate-950 border-slate-200 dark:border-slate-800'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => onSelectLead(lead)}
                              className="text-sm font-semibold text-slate-900 dark:text-white hover:text-[#335C67] dark:hover:text-[#FFF3B0] text-left truncate"
                            >
                              {lead.companyName}
                            </button>
                            {isSurvivor && (
                              <span className="text-xs font-semibold text-[#540B0E] dark:text-[#FFF3B0] shrink-0">
                                Recommended
                              </span>
                            )}
                          </div>
                          <div className="space-y-1 text-slate-600 dark:text-slate-400">
                            {lead.registrationNumber && <div>Registration: {lead.registrationNumber}</div>}
                            <div>City: {lead.address?.city || '—'}</div>
                            <div>Domain: {lead.domain || '—'}</div>
                            <div className="tabular-nums">Confidence: {lead.confidenceScore}%</div>
                            <div>Source: {lead.sources[0]?.sourceName || '—'}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => handleMerge(match, survivor.id, absorbed.id)}
                      className="px-4 py-1.5 bg-[#335C67] hover:bg-[#25454E] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors"
                    >
                      <GitMerge className="w-3.5 h-3.5" />
                      <span>Merge into {survivor.companyName}</span>
                    </button>
                  </div>
                </SurfaceCard>
              );
            })
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-3">
          {history.length === 0 ? (
            <EmptyState title="No merge history" description="Merged records can be restored from here." />
          ) : (
            <SurfaceCard padding="none" className="overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
              {history.map((record) => (
                <div
                  key={record.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-4 text-xs"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {record.mergedLeadSnapshot.companyName} → {record.survivorLeadId}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                      {record.mergedReason} · {formatDateLocale(record.mergedAt)}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleUndo(record.id)}
                    className="px-3 py-1.5 border border-[#E09F3E]/60 text-[#540B0E] dark:text-[#FFF3B0] hover:bg-[#FFF9D8]/60 dark:hover:bg-slate-800 rounded-lg inline-flex items-center gap-1.5 font-semibold transition-colors shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Undo</span>
                  </button>
                </div>
              ))}
            </SurfaceCard>
          )}
        </div>
      )}
    </div>
  );
};
