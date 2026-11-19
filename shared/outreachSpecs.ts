// Phase 15: Canonical Outreach & Follow-Up Automation Specifications
// Shared across server outreach services, API validation, and frontend Outreach Workspace.

export const OUTREACH_CAMPAIGN_STATUSES = [
  'draft',
  'active',
  'paused',
  'completed',
  'archived',
] as const;
export type OutreachCampaignStatus = (typeof OUTREACH_CAMPAIGN_STATUSES)[number];
export const OUTREACH_CAMPAIGN_STATUS_SET = new Set<string>(OUTREACH_CAMPAIGN_STATUSES);

export const OUTREACH_CAMPAIGN_MODES = ['individual', 'controlled_batch'] as const;
export type OutreachCampaignMode = (typeof OUTREACH_CAMPAIGN_MODES)[number];

export const OUTREACH_CHANNELS = [
  {
    value: 'email',
    label: 'Email',
    automatedSendingSupported: true,
    policyNote: 'Supports configured server-side email API providers after explicit owner approval.',
  },
  {
    value: 'linkedin',
    label: 'LinkedIn (Manual Draft Only)',
    automatedSendingSupported: false,
    policyNote:
      'Automated LinkedIn sending is disabled by policy. Generate and approve drafts here, then send manually.',
  },
  {
    value: 'phone',
    label: 'Phone / Call Script',
    automatedSendingSupported: false,
    policyNote: 'Prepares call talking points and follow-up tasks for manual owner execution.',
  },
  {
    value: 'custom',
    label: 'Custom Channel (Manual)',
    automatedSendingSupported: false,
    policyNote: 'Manual external delivery recorded by the owner.',
  },
] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number]['value'];
export const OUTREACH_CHANNEL_SET = new Set<string>(OUTREACH_CHANNELS.map((c) => c.value));

export const OUTREACH_ENROLLMENT_STATUSES = [
  'active',
  'paused',
  'completed',
  'exited_replied',
  'exited_meeting_booked',
  'exited_opportunity',
  'exited_uninterested',
  'exited_opted_out',
  'exited_suppressed',
  'exited_bounced',
  'cancelled',
] as const;
export type OutreachEnrollmentStatus = (typeof OUTREACH_ENROLLMENT_STATUSES)[number];
export const OUTREACH_ENROLLMENT_STATUS_SET = new Set<string>(OUTREACH_ENROLLMENT_STATUSES);

export const OUTREACH_FOLLOWUP_STATUSES = [
  'scheduled',
  'pending_approval',
  'completed',
  'cancelled',
  'suppressed',
] as const;
export type OutreachFollowUpStatus = (typeof OUTREACH_FOLLOWUP_STATUSES)[number];
export const OUTREACH_FOLLOWUP_STATUS_SET = new Set<string>(OUTREACH_FOLLOWUP_STATUSES);

export const OUTREACH_MESSAGE_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'sending',
  'sent',
  'manual_sent',
  'failed',
  'rejected',
  'cancelled',
] as const;
export type OutreachMessageStatus = (typeof OUTREACH_MESSAGE_STATUSES)[number];

export const OUTREACH_FOLLOWUP_TRIGGERS = [
  { value: 'no_response', label: 'No Response' },
  { value: 'response_received', label: 'Response Received' },
  { value: 'meeting_requested', label: 'Meeting Requested' },
  { value: 'meeting_scheduled', label: 'Meeting Scheduled' },
  { value: 'opportunity_created', label: 'Opportunity Created' },
  { value: 'contact_uninterested', label: 'Contact Marked Uninterested' },
  { value: 'opt_out', label: 'Opt-Out / Unsubscribe' },
  { value: 'failed_delivery', label: 'Failed Delivery' },
  { value: 'owner_requested', label: 'Owner-Requested Follow-Up' },
  { value: 'overdue_follow_up', label: 'Overdue Follow-Up' },
] as const;
export type OutreachFollowUpTrigger = (typeof OUTREACH_FOLLOWUP_TRIGGERS)[number]['value'];
export const OUTREACH_FOLLOWUP_TRIGGER_SET = new Set<string>(
  OUTREACH_FOLLOWUP_TRIGGERS.map((t) => t.value)
);

export const OUTREACH_REPLY_CLASSIFICATIONS = [
  { value: 'positive', label: 'Positive Response', exitsSequence: true, triggersSuppression: false },
  { value: 'meeting_interest', label: 'Meeting Interest', exitsSequence: true, triggersSuppression: false },
  { value: 'information_request', label: 'Information Request', exitsSequence: true, triggersSuppression: false },
  { value: 'referral', label: 'Referral', exitsSequence: true, triggersSuppression: false },
  { value: 'negative', label: 'Negative / Not Interested', exitsSequence: true, triggersSuppression: false },
  { value: 'unsubscribe', label: 'Unsubscribe / Opt-Out', exitsSequence: true, triggersSuppression: true },
  { value: 'unknown', label: 'Unknown / Needs Review', exitsSequence: false, triggersSuppression: false },
] as const;
export type OutreachReplyClassification = (typeof OUTREACH_REPLY_CLASSIFICATIONS)[number]['value'];
export const OUTREACH_REPLY_CLASSIFICATION_SET = new Set<string>(
  OUTREACH_REPLY_CLASSIFICATIONS.map((c) => c.value)
);

export const OUTREACH_SUPPRESSION_TYPES = [
  { value: 'unsubscribe', label: 'Unsubscribe / Opt-Out' },
  { value: 'do_not_contact', label: 'Do Not Contact' },
  { value: 'invalid_recipient', label: 'Invalid / Bounced Recipient' },
  { value: 'manual_suppression', label: 'Manual Owner Suppression' },
] as const;
export type OutreachSuppressionType = (typeof OUTREACH_SUPPRESSION_TYPES)[number]['value'];
export const OUTREACH_SUPPRESSION_TYPE_SET = new Set<string>(
  OUTREACH_SUPPRESSION_TYPES.map((t) => t.value)
);

export const OUTREACH_SUPPRESSION_SCOPES = ['global', 'campaign'] as const;
export type OutreachSuppressionScope = (typeof OUTREACH_SUPPRESSION_SCOPES)[number];

export interface OutreachProviderCatalogEntry {
  id: string;
  name: string;
  channel: OutreachChannel;
  automatedSendingSupported: boolean;
  inboundSyncSupported: boolean;
  endpointHost: string;
  envKeyNames: string[];
  requiredCredentialFields: Array<{
    key: string;
    label: string;
    secret: boolean;
    placeholder?: string;
  }>;
  defaultRateLimitPerHour: number;
  docsUrl: string;
  description: string;
}

export const OUTREACH_PROVIDER_CATALOG: OutreachProviderCatalogEntry[] = [
  {
    id: 'comm-resend',
    name: 'Resend Email API',
    channel: 'email',
    automatedSendingSupported: true,
    inboundSyncSupported: false,
    endpointHost: 'api.resend.com',
    envKeyNames: ['RESEND_API_KEY'],
    requiredCredentialFields: [
      { key: 'apiKey', label: 'Resend API Key', secret: true, placeholder: 're_...' },
    ],
    defaultRateLimitPerHour: 100,
    docsUrl: 'https://resend.com/docs/api-reference/emails/send-email',
    description:
      'Authorized HTTPS transactional and B2B email delivery via Resend. Supports Idempotency-Key headers and real provider message IDs.',
  },
  {
    id: 'comm-sendgrid',
    name: 'SendGrid Mail Send API (v3)',
    channel: 'email',
    automatedSendingSupported: true,
    inboundSyncSupported: false,
    endpointHost: 'api.sendgrid.com',
    envKeyNames: ['SENDGRID_API_KEY'],
    requiredCredentialFields: [
      { key: 'apiKey', label: 'SendGrid API Key', secret: true, placeholder: 'SG....' },
    ],
    defaultRateLimitPerHour: 100,
    docsUrl: 'https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send',
    description:
      'Authorized HTTPS email delivery via Twilio SendGrid v3 Mail Send API with server-side Bearer authentication.',
  },
  {
    id: 'comm-postmark',
    name: 'Postmark Email API',
    channel: 'email',
    automatedSendingSupported: true,
    inboundSyncSupported: false,
    endpointHost: 'api.postmarkapp.com',
    envKeyNames: ['POSTMARK_SERVER_TOKEN'],
    requiredCredentialFields: [
      { key: 'serverToken', label: 'Postmark Server Token', secret: true, placeholder: 'pm_...' },
    ],
    defaultRateLimitPerHour: 100,
    docsUrl: 'https://postmarkapp.com/developer/api/email-api',
    description:
      'Authorized HTTPS email delivery via Postmark Server API with real MessageID tracking.',
  },
  {
    id: 'comm-mailgun',
    name: 'Mailgun Messages API',
    channel: 'email',
    automatedSendingSupported: true,
    inboundSyncSupported: false,
    endpointHost: 'api.mailgun.net',
    envKeyNames: ['MAILGUN_API_KEY', 'MAILGUN_DOMAIN'],
    requiredCredentialFields: [
      { key: 'apiKey', label: 'Mailgun Private API Key', secret: true },
      { key: 'domain', label: 'Verified Sending Domain', secret: false, placeholder: 'mg.example.com' },
    ],
    defaultRateLimitPerHour: 100,
    docsUrl: 'https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages',
    description:
      'Authorized HTTPS email delivery via Mailgun v3 Messages API on an owner-verified sending domain.',
  },
  {
    id: 'comm-linkedin-manual',
    name: 'LinkedIn (Manual Draft Only)',
    channel: 'linkedin',
    automatedSendingSupported: false,
    inboundSyncSupported: false,
    endpointHost: '',
    envKeyNames: [],
    requiredCredentialFields: [],
    defaultRateLimitPerHour: 0,
    docsUrl: '',
    description:
      'Policy safeguard: LEED never performs unauthorized LinkedIn scraping or automated LinkedIn sending. Approved drafts can be copied and manually recorded.',
  },
];

export const OUTREACH_PROVIDER_MAP = new Map<string, OutreachProviderCatalogEntry>(
  OUTREACH_PROVIDER_CATALOG.map((p) => [p.id, p])
);

// Country ISO-2 to representative IANA timezone mapping for scheduling awareness when recipient timezone is known via country
export const COUNTRY_DEFAULT_TIMEZONE: Record<string, string> = {
  US: 'America/New_York',
  CA: 'America/Toronto',
  GB: 'Europe/London',
  UK: 'Europe/London',
  IE: 'Europe/Dublin',
  DE: 'Europe/Berlin',
  FR: 'Europe/Paris',
  NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels',
  CH: 'Europe/Zurich',
  AT: 'Europe/Vienna',
  NO: 'Europe/Oslo',
  SE: 'Europe/Stockholm',
  DK: 'Europe/Copenhagen',
  FI: 'Europe/Helsinki',
  PL: 'Europe/Warsaw',
  ES: 'Europe/Madrid',
  IT: 'Europe/Rome',
  PT: 'Europe/Lisbon',
  AU: 'Australia/Sydney',
  NZ: 'Pacific/Auckland',
  SG: 'Asia/Singapore',
  JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul',
  IN: 'Asia/Kolkata',
  AE: 'Asia/Dubai',
  BR: 'America/Sao_Paulo',
};
