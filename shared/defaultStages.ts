export interface DefaultPipelineStageSeed {
  id: string;
  name: string;
  color: string;
  order: number;
}

export const DEFAULT_PIPELINE_STAGES: DefaultPipelineStageSeed[] = [
  { id: 'stage-discovered', name: 'Discovered', color: '#64748b', order: 1 },
  { id: 'stage-qualified', name: 'Qualified', color: '#3b82f6', order: 2 },
  { id: 'stage-pitch-ready', name: 'Outreach Drafted', color: '#8b5cf6', order: 3 },
  { id: 'stage-contacted', name: 'Contacted', color: '#f59e0b', order: 4 },
  { id: 'stage-meeting', name: 'Meeting Scheduled', color: '#06b6d4', order: 5 },
  { id: 'stage-proposal', name: 'Proposal / Review', color: '#ec4899', order: 6 },
  { id: 'stage-won', name: 'Closed Won', color: '#10b981', order: 7 },
  { id: 'stage-lost', name: 'Closed Lost', color: '#ef4444', order: 8 },
];
