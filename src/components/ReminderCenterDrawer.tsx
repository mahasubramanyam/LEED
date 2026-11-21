import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  AlertTriangle,
  Clock,
  RefreshCw,
  X,
  Bot,
} from 'lucide-react';
import { AiAgentLaunchContext, CrmReminderCenterResponse, CrmReminderItem } from '../types.ts';
import { apiFetch } from '../utils/apiFetch.ts';
import { SegmentedTabs } from './ui/SunsetUI.tsx';

interface ReminderCenterDrawerProps {
  onClose: () => void;
  onOpenCompany: (leadId: string) => void;
  onOpenPerson: (personId: string) => void;
  onNavigateTasks: () => void;
  onOpenAiAgent?: (ctx: AiAgentLaunchContext) => void;
}

export const ReminderCenterDrawer: React.FC<ReminderCenterDrawerProps> = ({
  onClose,
  onOpenCompany,
  onOpenPerson,
  onNavigateTasks,
  onOpenAiAgent,
}) => {
  const [data, setData] = useState<CrmReminderCenterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterKind, setFilterKind] = useState<'all' | 'overdue' | 'today' | 'meetings' | 'attention'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/crm/reminders');
      if (res.ok) {
        setData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = (data?.reminders || []).filter((r: CrmReminderItem) => {
    if (filterKind === 'overdue') return r.kind === 'overdue_task' || (r.kind === 'interaction_follow_up' && r.severity === 'urgent');
    if (filterKind === 'today') return r.kind === 'today_task' || (r.kind === 'interaction_follow_up' && r.severity === 'high');
    if (filterKind === 'meetings') return r.kind === 'upcoming_meeting';
    if (filterKind === 'attention') return r.kind === 'needs_attention' || r.kind === 'relationship_review';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 bg-[#0B1113]/75 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-lg bg-white dark:bg-[#192629] border-l border-slate-200 dark:border-[#3A4D50] h-full flex flex-col shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-[#3A4D50] flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight text-slate-950 dark:text-[#F2F6F5]">
            Reminders
          </h2>
          <div className="flex items-center gap-1.5">
            {onOpenAiAgent && (
              <button
                type="button"
                onClick={() => onOpenAiAgent({ tab: 'briefing' })}
                className="px-3 py-1.5 rounded-lg bg-[#335C67] hover:bg-[#3D6C79] text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Bot className="w-3.5 h-3.5 text-[#DFB76D]" />
                Briefing
              </button>
            )}
            <button
              type="button"
              onClick={load}
              aria-label="Refresh reminders"
              className="p-1.5 rounded-lg text-slate-600 hover:text-slate-950 dark:text-[#B8C7C4] dark:hover:text-[#F2F6F5] hover:bg-slate-100 dark:hover:bg-[#243638]"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close reminders"
              className="p-1.5 rounded-lg text-slate-600 hover:text-slate-950 dark:text-[#B8C7C4] dark:hover:text-[#F2F6F5] hover:bg-slate-100 dark:hover:bg-[#243638]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-4 pt-2 border-b border-slate-200 dark:border-[#3A4D50]">
          <SegmentedTabs
            activeId={filterKind}
            onChange={setFilterKind}
            items={[
              { id: 'all', label: 'All', count: data?.counts.total ?? 0 },
              { id: 'overdue', label: 'Overdue', count: data?.counts.overdueTasks ?? 0 },
              { id: 'today', label: 'Today', count: data?.counts.todayFollowUps ?? 0 },
              { id: 'meetings', label: 'Meetings', count: data?.counts.upcomingMeetings ?? 0 },
              {
                id: 'attention',
                label: 'Attention',
                count: (data?.counts.relationshipReviews ?? 0) + (data?.counts.needsAttention ?? 0),
              },
            ]}
          />
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-200 dark:divide-[#3A4D50]">
          {loading && !data ? (
            <div className="p-8 text-center text-xs font-medium text-slate-600 dark:text-[#B8C7C4]">Loading reminders...</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-xs font-medium text-slate-600 dark:text-[#B8C7C4]">
              No active reminders in this view.
            </div>
          ) : (
            filtered.map((item) => (
              <div
                key={item.id}
                className="px-5 py-3.5 hover:bg-slate-100/70 dark:hover:bg-[#243638] transition-colors space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-950 dark:text-[#F2F6F5] flex items-center gap-1.5">
                      {item.severity === 'urgent' ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-[#8F3438] dark:text-[#E58E92] shrink-0" />
                      ) : item.kind === 'upcoming_meeting' ? (
                        <Calendar className="w-3.5 h-3.5 text-[#335C67] dark:text-[#86BCC9] shrink-0" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-[#C49A52] dark:text-[#DFB76D] shrink-0" />
                      )}
                      <span className="truncate">{item.title}</span>
                    </div>
                    <p className="text-xs font-medium text-slate-600 dark:text-[#B8C7C4] mt-0.5">{item.detail}</p>
                  </div>
                  {item.dueAt && (
                    <span className="text-xs font-mono font-medium tabular-nums text-slate-600 dark:text-[#B8C7C4] shrink-0">
                      {new Date(item.dueAt).toLocaleDateString()}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs">
                  {item.leadId && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenCompany(item.leadId!);
                        onClose();
                      }}
                      className="text-[#335C67] dark:text-[#86BCC9] font-semibold hover:underline"
                    >
                      {item.companyName || 'Company'}
                    </button>
                  )}
                  {item.personId && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenPerson(item.personId!);
                        onClose();
                      }}
                      className="text-[#83632E] dark:text-[#DFB76D] font-semibold hover:underline"
                    >
                      {item.personName || 'Contact'}
                    </button>
                  )}
                  {item.taskId && (
                    <button
                      type="button"
                      onClick={() => {
                        onNavigateTasks();
                        onClose();
                      }}
                      className="text-slate-700 dark:text-[#F2F6F5] font-semibold hover:underline"
                    >
                      Open Task
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
