import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header.tsx';
import { DiscoveryEngine } from './components/DiscoveryEngine.tsx';
import { LeadsView } from './components/LeadsView.tsx';
import { PipelineBoard } from './components/PipelineBoard.tsx';
import { AiSalesAgent } from './components/AiSalesAgent.tsx';
import { OutreachCampaigns } from './components/OutreachCampaigns.tsx';
import { DedupeHub } from './components/DedupeHub.tsx';
import { ConnectorsView } from './components/ConnectorsView.tsx';
import { TasksView } from './components/TasksView.tsx';
import { LeadDetailModal } from './components/LeadDetailModal.tsx';
import { ImportModal } from './components/ImportModal.tsx';
import { AuthModal } from './components/AuthModal.tsx';
import {
  CanonicalLead,
  PipelineStage,
  LeadTask,
  OutreachCampaign,
  ConnectorStatus,
  AppSettings,
} from './types.ts';

interface OwnerProfile {
  id: string;
  email: string;
  fullName: string;
  role: 'owner';
}

export default function App() {
  const [currentTab, setCurrentTab] = useState<string>('discovery');
  const [leads, setLeads] = useState<CanonicalLead[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [tasks, setTasks] = useState<LeadTask[]>([]);
  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([]);
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    ownerName: 'Lead Intelligence Operator',
    ownerEmail: 'owner@pipeline.local',
    defaultCountry: 'GB',
    defaultCurrency: 'USD',
    userAgent: 'GlobalLeadPipeline/1.0',
    enableSafeWebsiteCrawl: true,
    outreachApprovalRequired: true,
    autoDedupeThreshold: 0.85,
    suppressionDomains: [],
  });

  // Owner Authentication & Storage Engine State
  const [owner, setOwner] = useState<OwnerProfile | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [authModalMode, setAuthModalMode] = useState<'setup' | 'login' | 'change_password'>('login');
  const [storageEngine, setStorageEngine] = useState<'postgresql' | 'json_store'>('json_store');
  const [isDbConnected, setIsDbConnected] = useState<boolean>(false);

  const [selectedLeadForDetail, setSelectedLeadForDetail] = useState<CanonicalLead | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  // Helper to extract CSRF token cookie
  const getCsrfToken = (): string => {
    const match = document.cookie.match(/leed_csrf=([^;]+)/);
    return match ? match[1] : '';
  };

  // Central authenticated API fetch helper
  const apiFetch = useCallback(async (url: string, options: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(options.headers || {});
    const method = (options.method || 'GET').toUpperCase();

    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      const csrf = getCsrfToken();
      if (csrf && !headers.has('x-leed-csrf-token')) {
        headers.set('x-leed-csrf-token', csrf);
      }
    }

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });

    if (response.status === 401 && !url.includes('/api/auth/')) {
      setIsAuthenticated(false);
      setAuthModalMode('login');
      setAuthModalOpen(true);
    }

    return response;
  }, []);

  // Fetch initial system state & check owner authentication
  const checkAuthAndLoad = useCallback(async () => {
    try {
      setIsLoading(true);

      // 1. Fetch system & setup status
      const [setupRes, statusRes] = await Promise.all([
        fetch('/api/auth/setup-status', { credentials: 'include' }),
        fetch('/api/status', { credentials: 'include' }),
      ]);

      const setupData = await setupRes.json();
      const statusData = await statusRes.json();

      setStorageEngine(statusData.storageEngine || 'json_store');
      setIsDbConnected(!!statusData.databaseConnected);
      setAiAvailable(statusData.aiEngineAvailable ?? true);

      // If owner account is not yet initialized, show setup modal
      if (!setupData.initialized) {
        setAuthModalMode('setup');
        setAuthModalOpen(true);
        setIsLoading(false);
        return;
      }

      // 2. Check current session
      const meRes = await fetch('/api/auth/me', { credentials: 'include' });
      if (meRes.ok) {
        const meData = await meRes.json();
        setOwner(meData.owner);
        setIsAuthenticated(true);
        setAuthModalOpen(false);
        await fetchAllData();
      } else {
        setIsAuthenticated(false);
        setAuthModalMode('login');
        setAuthModalOpen(true);
      }
    } catch (err) {
      console.error('Failed to initialize application', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch all domain data
  const fetchAllData = async () => {
    try {
      const [leadsRes, stagesRes, tasksRes, campsRes, connsRes, settRes] = await Promise.all([
        apiFetch('/api/leads'),
        apiFetch('/api/pipeline/stages'),
        apiFetch('/api/tasks'),
        apiFetch('/api/campaigns'),
        apiFetch('/api/connectors'),
        apiFetch('/api/settings'),
      ]);

      if (leadsRes.ok) {
        const leadsData = await leadsRes.json();
        setLeads(leadsData.leads || []);
      }
      if (stagesRes.ok) {
        const stagesData = await stagesRes.json();
        setStages(stagesData || []);
      }
      if (tasksRes.ok) {
        const tasksData = await tasksRes.json();
        setTasks(tasksData || []);
      }
      if (campsRes.ok) {
        const campsData = await campsRes.json();
        setCampaigns(campsData || []);
      }
      if (connsRes.ok) {
        const connsData = await connsRes.json();
        setConnectors(connsData || []);
      }
      if (settRes.ok) {
        const settData = await settRes.json();
        setSettings(settData || settings);
      }
    } catch (err) {
      console.error('Failed to load application records', err);
    }
  };

  useEffect(() => {
    checkAuthAndLoad();
  }, [checkAuthAndLoad]);

  // Sync selected lead when leads update
  useEffect(() => {
    if (selectedLeadForDetail) {
      const updated = leads.find((l) => l.id === selectedLeadForDetail.id);
      if (updated) setSelectedLeadForDetail(updated);
    }
  }, [leads]);

  // Auth Handlers
  const handleAuthSuccess = (ownerProfile: OwnerProfile) => {
    setOwner(ownerProfile);
    setIsAuthenticated(true);
    setAuthModalOpen(false);
    fetchAllData();
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    }
    setOwner(null);
    setIsAuthenticated(false);
    setAuthModalMode('login');
    setAuthModalOpen(true);
  };

  // Lead Actions
  const handleAddLeadToCrm = async (newLead: CanonicalLead) => {
    try {
      const res = await apiFetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLead),
      });
      if (res.ok) {
        fetchAllData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleBatchAddLeads = async (newLeads: CanonicalLead[]) => {
    try {
      const res = await apiFetch('/api/leads/batch-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: newLeads }),
      });
      if (res.ok) {
        fetchAllData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateLead = async (lead: CanonicalLead) => {
    try {
      const res = await apiFetch(`/api/leads/${lead.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead),
      });
      if (res.ok) {
        const updated = await res.json();
        setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
        if (selectedLeadForDetail?.id === updated.id) {
          setSelectedLeadForDetail(updated);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteLead = async (leadId: string) => {
    try {
      const res = await apiFetch(`/api/leads/${leadId}`, { method: 'DELETE' });
      if (res.ok) {
        setLeads((prev) => prev.filter((l) => l.id !== leadId));
        if (selectedLeadForDetail?.id === leadId) {
          setSelectedLeadForDetail(null);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleBatchUpdateStage = async (leadIds: string[], stageId: string) => {
    for (const id of leadIds) {
      await apiFetch('/api/pipeline/move', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: id, stageId }),
      });
    }
    fetchAllData();
  };

  const handleBatchDelete = async (leadIds: string[]) => {
    for (const id of leadIds) {
      await apiFetch(`/api/leads/${id}`, { method: 'DELETE' });
    }
    fetchAllData();
  };

  const handleMoveStage = async (leadId: string, stageId: string, lostReason?: string) => {
    try {
      const res = await apiFetch('/api/pipeline/move', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, stageId, lostReason }),
      });
      if (res.ok) {
        const updated = await res.json();
        setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddNote = async (leadId: string, content: string) => {
    try {
      const res = await apiFetch(`/api/leads/${leadId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        const updated = await res.json();
        setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
        if (selectedLeadForDetail?.id === updated.id) {
          setSelectedLeadForDetail(updated);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddActivity = async (leadId: string, activity: any) => {
    try {
      const res = await apiFetch(`/api/leads/${leadId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activity),
      });
      if (res.ok) {
        const updated = await res.json();
        setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
        if (selectedLeadForDetail?.id === updated.id) {
          setSelectedLeadForDetail(updated);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleInspectUrl = async (url: string, leadId: string) => {
    const res = await apiFetch('/api/inspection/inspect-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, leadId }),
    });
    const data = await res.json();
    fetchAllData();
    return data;
  };

  // Task Actions
  const handleToggleTask = async (taskId: string, completed: boolean) => {
    try {
      const res = await apiFetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      });
      if (res.ok) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, completed } : t)));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateTask = async (task: Omit<LeadTask, 'id' | 'createdAt'>) => {
    try {
      const res = await apiFetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      });
      if (res.ok) {
        const created = await res.json();
        setTasks((prev) => [created, ...prev]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      const res = await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      if (res.ok) {
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateSettings = async (newSettings: Partial<AppSettings>) => {
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });
      if (res.ok) {
        const updated = await res.json();
        setSettings(updated);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleExportCsv = () => {
    window.open('/api/export/csv', '_blank');
  };

  const totalPipelineValue = leads.reduce((sum, l) => sum + (l.opportunityValue || 0), 0);
  const activeConnectorsCount = connectors.filter((c) => c.status === 'healthy').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Header with Navigation and Live Metrics */}
      <Header
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        totalLeads={leads.length}
        totalPipelineValue={totalPipelineValue}
        activeConnectorsCount={activeConnectorsCount}
        onOpenImport={() => setIsImportModalOpen(true)}
        onExportCsv={handleExportCsv}
        aiAvailable={aiAvailable}
        owner={owner}
        storageEngine={storageEngine}
        isDbConnected={isDbConnected}
        onOpenPasswordChange={() => {
          setAuthModalMode('change_password');
          setAuthModalOpen(true);
        }}
        onLogout={handleLogout}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center min-h-[400px] space-y-3">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-slate-400 font-medium">
              Verifying owner authentication & pipeline state...
            </span>
          </div>
        ) : (
          <>
            {currentTab === 'discovery' && (
              <DiscoveryEngine
                onAddLeadToCrm={handleAddLeadToCrm}
                onBatchAddLeads={handleBatchAddLeads}
                onInspectLead={(lead) => setSelectedLeadForDetail(lead)}
              />
            )}

            {currentTab === 'leads' && (
              <LeadsView
                leads={leads}
                stages={stages}
                onSelectLead={(lead) => setSelectedLeadForDetail(lead)}
                onUpdateLeadStage={handleMoveStage}
                onDeleteLead={handleDeleteLead}
                onBatchUpdateStage={handleBatchUpdateStage}
                onBatchDelete={handleBatchDelete}
              />
            )}

            {currentTab === 'pipeline' && (
              <PipelineBoard
                stages={stages}
                leads={leads}
                onSelectLead={(lead) => setSelectedLeadForDetail(lead)}
                onMoveLeadStage={handleMoveStage}
              />
            )}

            {currentTab === 'ai-agent' && (
              <AiSalesAgent
                leads={leads}
                selectedLeadId={selectedLeadForDetail?.id}
                onLeadSelect={(id) => {
                  const found = leads.find((l) => l.id === id);
                  if (found) setSelectedLeadForDetail(found);
                }}
                onAddActivityToLead={handleAddActivity}
              />
            )}

            {currentTab === 'outreach' && (
              <OutreachCampaigns
                campaigns={campaigns}
                leads={leads}
                onRefreshCampaigns={fetchAllData}
                onSelectLead={(lead) => setSelectedLeadForDetail(lead)}
              />
            )}

            {currentTab === 'dedupe' && (
              <DedupeHub
                onRefreshLeads={fetchAllData}
                onSelectLead={(lead) => setSelectedLeadForDetail(lead)}
              />
            )}

            {currentTab === 'connectors' && (
              <ConnectorsView
                connectors={connectors}
                settings={settings}
                onUpdateSettings={handleUpdateSettings}
                onRefreshConnectors={fetchAllData}
              />
            )}

            {currentTab === 'tasks' && (
              <TasksView
                tasks={tasks}
                leads={leads}
                onToggleTask={handleToggleTask}
                onCreateTask={handleCreateTask}
                onDeleteTask={handleDeleteTask}
                onSelectLead={(lead) => setSelectedLeadForDetail(lead)}
              />
            )}
          </>
        )}
      </main>

      {/* Deep Inspection Drawer / Modal */}
      <LeadDetailModal
        lead={selectedLeadForDetail}
        stages={stages}
        onClose={() => setSelectedLeadForDetail(null)}
        onUpdateLead={handleUpdateLead}
        onAddNote={handleAddNote}
        onAddActivity={handleAddActivity}
        onInspectUrl={handleInspectUrl}
      />

      {/* CSV Import Modal */}
      {isImportModalOpen && (
        <ImportModal
          onClose={() => setIsImportModalOpen(false)}
          onImportComplete={() => fetchAllData()}
          existingLeads={leads}
        />
      )}

      {/* Owner Setup / Login / Change Password Modal */}
      <AuthModal
        isOpen={authModalOpen}
        mode={authModalMode}
        onClose={isAuthenticated ? () => setAuthModalOpen(false) : undefined}
        onSuccess={handleAuthSuccess}
      />
    </div>
  );
}
