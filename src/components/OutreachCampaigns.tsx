import React, { useState } from 'react';
import {
  Send,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  Mail,
  UserCheck,
  ShieldAlert,
  Sparkles,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { OutreachCampaign, CampaignMessage, CanonicalLead } from '../types.js';

interface OutreachCampaignsProps {
  campaigns: OutreachCampaign[];
  leads: CanonicalLead[];
  onRefreshCampaigns: () => void;
  onSelectLead: (lead: CanonicalLead) => void;
}

export const OutreachCampaigns: React.FC<OutreachCampaignsProps> = ({
  campaigns,
  leads,
  onRefreshCampaigns,
  onSelectLead,
}) => {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(
    campaigns[0]?.id || ''
  );
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false);
  const [newCampName, setNewCampName] = useState('');
  const [newSubject, setNewSubject] = useState('Introduction: {{company_name}} & verified pipeline');
  const [newBody, setNewBody] = useState(
    'Hi {{company_name}} team,\n\nI was reviewing your active work in {{city}} and wanted to connect.\n\nWe provide verified data pipeline automation for {{industry}} organizations.\n\nWould you be open to a brief conversation?\n\nBest regards,\n{{owner_name}}'
  );

  const [activeTab, setActiveTab] = useState<'pending' | 'sent' | 'all'>('pending');
  const [isProcessing, setIsProcessing] = useState(false);

  const currentCampaign = campaigns.find((c) => c.id === selectedCampaignId) || campaigns[0];

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCampName.trim()) return;

    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCampName,
          channel: 'email',
          subjectTemplate: newSubject,
          bodyTemplate: newBody,
          status: 'active',
          messages: [],
        }),
      });

      if (res.ok) {
        setIsCreatingCampaign(false);
        setNewCampName('');
        onRefreshCampaigns();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleGenerateMessages = async () => {
    if (!currentCampaign) return;
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/campaigns/${currentCampaign.id}/generate-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        onRefreshCampaigns();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMessageAction = async (messageId: string, action: 'approve' | 'reject' | 'send') => {
    if (!currentCampaign) return;
    try {
      const res = await fetch(
        `/api/campaigns/${currentCampaign.id}/messages/${messageId}/action`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        }
      );
      if (res.ok) {
        onRefreshCampaigns();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const messages = currentCampaign?.messages || [];
  const pendingMessages = messages.filter((m) => m.status === 'pending_approval');
  const approvedMessages = messages.filter((m) => m.status === 'approved');
  const sentMessages = messages.filter((m) => m.status === 'sent');

  const displayedMessages =
    activeTab === 'pending'
      ? pendingMessages
      : activeTab === 'sent'
      ? sentMessages
      : messages;

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Send className="w-5 h-5 text-indigo-400" />
            Outreach Campaigns & Human-in-the-Loop Approval Queue
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Strict human approval safeguard: Review and sign off on personalized outbound messages before dispatch.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={currentCampaign?.id || ''}
            onChange={(e) => setSelectedCampaignId(e.target.value)}
            className="bg-slate-950 border border-slate-700 text-white text-xs rounded p-2 focus:outline-none focus:border-indigo-500 font-medium"
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.messages.length} msgs)
              </option>
            ))}
          </select>

          <button
            onClick={() => setIsCreatingCampaign(!isCreatingCampaign)}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded flex items-center gap-1.5 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Campaign</span>
          </button>
        </div>
      </div>

      {/* Campaign Creator Form Modal/Drawer */}
      {isCreatingCampaign && (
        <form onSubmit={handleCreateCampaign} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-white">Create New Outreach Sequence</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Campaign Name</label>
              <input
                type="text"
                value={newCampName}
                onChange={(e) => setNewCampName(e.target.value)}
                placeholder="e.g. Q4 High-Tech Outreach"
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2 focus:outline-none focus:border-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Subject Template</label>
              <input
                type="text"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2 focus:outline-none focus:border-indigo-500"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Body Template (Tokens: <code>{`{{company_name}}`}</code>, <code>{`{{city}}`}</code>, <code>{`{{industry}}`}</code>, <code>{`{{owner_name}}`}</code>)
            </label>
            <textarea
              rows={4}
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2 focus:outline-none focus:border-indigo-500 font-mono"
              required
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsCreatingCampaign(false)}
              className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded"
            >
              Save Campaign
            </button>
          </div>
        </form>
      )}

      {/* Main Campaign Messages Canvas */}
      {currentCampaign && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 px-4 py-3 rounded-lg border border-slate-800 text-xs">
            {/* Filter Tabs */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab('pending')}
                className={`px-3 py-1 rounded font-medium transition ${
                  activeTab === 'pending'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Needs Approval ({pendingMessages.length})
              </button>

              <button
                onClick={() => setActiveTab('sent')}
                className={`px-3 py-1 rounded font-medium transition ${
                  activeTab === 'sent'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Dispatched ({sentMessages.length})
              </button>

              <button
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1 rounded font-medium transition ${
                  activeTab === 'all'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All Messages ({messages.length})
              </button>
            </div>

            <button
              onClick={handleGenerateMessages}
              disabled={isProcessing}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded font-medium flex items-center gap-1.5 transition"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Generate Messages for Pipeline Leads</span>
            </button>
          </div>

          {/* Messages List */}
          <div className="space-y-3">
            {displayedMessages.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-xs">
                No messages found in this category. Click &quot;Generate Messages for Pipeline Leads&quot; to stage
                proposals into the approval queue.
              </div>
            ) : (
              displayedMessages.map((msg) => {
                const lead = leads.find((l) => l.id === msg.leadId);

                return (
                  <div
                    key={msg.id}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-sm hover:border-slate-700 transition"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-white">{msg.leadCompanyName}</h4>
                          {lead && (
                            <button
                              onClick={() => onSelectLead(lead)}
                              className="text-[11px] text-indigo-400 hover:underline flex items-center gap-0.5"
                            >
                              <span>Inspect Lead</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Recipient: <span className="text-cyan-400 font-mono">{msg.recipientEmail || 'Public Contact Channel'}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                            msg.status === 'pending_approval'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                              : msg.status === 'approved'
                              ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                              : msg.status === 'sent'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {msg.status.replace('_', ' ').toUpperCase()}
                        </span>

                        {msg.deliveryId && (
                          <span className="text-[10px] font-mono text-slate-500">
                            ID: {msg.deliveryId}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Message Preview */}
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2 text-xs">
                      <div className="font-semibold text-white">
                        Subject: <span className="font-normal text-slate-300">{msg.subject}</span>
                      </div>
                      <pre className="font-sans text-slate-300 whitespace-pre-wrap leading-relaxed text-[11px] pt-2 border-t border-slate-800/80">
                        {msg.content}
                      </pre>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between text-xs pt-1">
                      <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
                        <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Owner Approval Required before Provider Dispatch</span>
                      </div>

                      <div className="flex items-center gap-2">
                        {msg.status === 'pending_approval' && (
                          <>
                            <button
                              onClick={() => handleMessageAction(msg.id, 'reject')}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-rose-400 rounded text-xs font-medium"
                            >
                              Reject
                            </button>
                            <button
                              onClick={() => handleMessageAction(msg.id, 'approve')}
                              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleMessageAction(msg.id, 'send')}
                              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold flex items-center gap-1"
                            >
                              <Send className="w-3 h-3" />
                              <span>Approve & Dispatch</span>
                            </button>
                          </>
                        )}

                        {msg.status === 'approved' && (
                          <button
                            onClick={() => handleMessageAction(msg.id, 'send')}
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold flex items-center gap-1"
                          >
                            <Send className="w-3 h-3" />
                            <span>Dispatch Confirmed</span>
                          </button>
                        )}

                        {msg.status === 'sent' && (
                          <div className="text-emerald-400 text-[11px] flex items-center gap-1 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Dispatched & Recorded in CRM Activity</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
