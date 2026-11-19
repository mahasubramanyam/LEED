import {
  ColumnMappingRule,
  ImportCanonicalField,
  ImportMappingTemplate,
  ImportTargetField,
  MappingAmbiguityWarning,
  MultiColumnMergeRule,
} from '../types.js';

export interface FieldCatalogEntry {
  field: ImportCanonicalField;
  label: string;
  group: 'control' | 'company' | 'person' | 'relationship';
  sensitiveIdentity?: boolean;
  description: string;
}

export const IMPORT_FIELD_CATALOG: FieldCatalogEntry[] = [
  { field: 'ignore', label: 'Ignore / Do Not Import', group: 'control', description: 'Exclude column from import' },

  // Company Fields
  { field: 'companyName', label: 'Company Name', group: 'company', sensitiveIdentity: true, description: 'Primary business or brand name' },
  { field: 'legalName', label: 'Legal Entity Name', group: 'company', sensitiveIdentity: true, description: 'Official registered corporate name' },
  { field: 'tradingName', label: 'Trading Name / DBA', group: 'company', description: 'Commercial trading or DBA name' },
  { field: 'website', label: 'Website URL', group: 'company', description: 'Corporate website address' },
  { field: 'domain', label: 'Website Domain', group: 'company', sensitiveIdentity: true, description: 'Normalized domain hostname' },
  { field: 'industry', label: 'Industry / Sector', group: 'company', description: 'Primary industry classification' },
  { field: 'category', label: 'Category / Sub-sector', group: 'company', description: 'Specific business category' },
  { field: 'description', label: 'Company Description', group: 'company', description: 'Business overview or notes summary' },
  { field: 'country', label: 'Country Name', group: 'company', description: 'Country name or ISO code' },
  { field: 'countryCode', label: 'Country Code (ISO Alpha-2)', group: 'company', description: 'Two-letter ISO country code' },
  { field: 'region', label: 'Region / State / Province', group: 'company', description: 'Administrative state, province, or county' },
  { field: 'city', label: 'City / Locality', group: 'company', description: 'City or town' },
  { field: 'postalCode', label: 'Postal / ZIP Code', group: 'company', description: 'Postal or ZIP code' },
  { field: 'street', label: 'Street Address', group: 'company', description: 'Street line address' },
  { field: 'registrationNumber', label: 'Registration Number', group: 'company', sensitiveIdentity: true, description: 'Official corporate registration identifier' },
  { field: 'registrationType', label: 'Registration Type', group: 'company', description: 'Identifier scheme (NO_ORG, UK_CRN, AU_ABN, etc.)' },
  { field: 'vatNumber', label: 'VAT / Tax ID', group: 'company', sensitiveIdentity: true, description: 'VAT or national tax identifier' },
  { field: 'leiNumber', label: 'LEI (ISO 17442)', group: 'company', sensitiveIdentity: true, description: '20-character Legal Entity Identifier' },
  { field: 'companyStatus', label: 'Company Legal Status', group: 'company', description: 'Active, Inactive, or Dissolved' },
  { field: 'annualRevenue', label: 'Annual Revenue', group: 'company', description: 'Reported annual revenue amount' },
  { field: 'employeeCount', label: 'Employee Count', group: 'company', description: 'Exact headcount number' },
  { field: 'employeeRange', label: 'Employee Size Range', group: 'company', description: 'Headcount band (e.g. 50-200)' },
  { field: 'foundedYear', label: 'Founded Year', group: 'company', description: 'Four-digit incorporation year' },
  { field: 'currency', label: 'Currency (ISO 4217)', group: 'company', description: 'Three-letter currency code (USD, EUR, NOK...)' },
  { field: 'opportunityValue', label: 'Pipeline Opportunity Value', group: 'company', description: 'CRM deal estimate amount' },
  { field: 'phone', label: 'Company Phone', group: 'company', description: 'Business telephone number' },
  { field: 'email', label: 'Company / General Email', group: 'company', description: 'General business email (info@, contact@)' },
  { field: 'linkedinCompanyUrl', label: 'Company LinkedIn URL', group: 'company', description: 'Corporate LinkedIn page URL' },
  { field: 'tags', label: 'Tags', group: 'company', description: 'Semicolon or pipe delimited tags' },

  // Person / Decision-Maker Fields
  { field: 'personFirstName', label: 'Person First Name', group: 'person', description: 'Contact or decision-maker given name' },
  { field: 'personLastName', label: 'Person Last Name', group: 'person', description: 'Contact or decision-maker surname' },
  { field: 'personFullName', label: 'Person Full Name', group: 'person', sensitiveIdentity: true, description: 'Decision-maker or contact full name' },
  { field: 'personJobTitle', label: 'Person Job Title', group: 'person', description: 'Role title (e.g. CEO, Head of Procurement)' },
  { field: 'personDesignation', label: 'Person Designation / Seniority', group: 'person', description: 'Designation or executive rank' },
  { field: 'personRole', label: 'Person Role', group: 'person', description: 'Operational or board role' },
  { field: 'personDepartment', label: 'Person Department', group: 'person', description: 'Department (Engineering, Finance, Procurement)' },
  { field: 'personEmail', label: 'Person Work Email', group: 'person', sensitiveIdentity: true, description: 'Direct email of the decision-maker' },
  { field: 'personPhone', label: 'Person Direct Phone', group: 'person', description: 'Direct telephone or mobile' },
  { field: 'personLinkedInUrl', label: 'Person LinkedIn URL', group: 'person', sensitiveIdentity: true, description: 'Personal LinkedIn /in/ profile URL' },
  { field: 'personCountry', label: 'Person Country', group: 'person', description: 'Location country of person' },
  { field: 'personCity', label: 'Person City', group: 'person', description: 'Location city of person' },

  // Relationship Fields
  { field: 'associatedCompanyName', label: 'Associated Company Name', group: 'relationship', sensitiveIdentity: true, description: 'Links person row to an existing or imported company' },
  { field: 'associatedCompanyRegNumber', label: 'Associated Company Reg. No.', group: 'relationship', sensitiveIdentity: true, description: 'Links person row via official company reg. number' },
  { field: 'relationshipType', label: 'Relationship Type', group: 'relationship', description: 'founder, owner, director, executive, procurement_contact, employee...' },
  { field: 'relationshipPosition', label: 'Relationship Position', group: 'relationship', description: 'Formal board or appointment position' },
  { field: 'decisionMakerCategory', label: 'Decision-Maker Category', group: 'relationship', description: 'Economic Buyer, Technical Approver, Executive Sponsor, etc.' },
  { field: 'isPrimaryContact', label: 'Is Primary Contact', group: 'relationship', description: 'Boolean flag (true/false/yes/no)' },
  // Phase 13: Optional CRM Relationship & Interaction Import Fields
  { field: 'relationshipStatus', label: 'Relationship Status', group: 'relationship', description: 'new, active, warm, nurturing, needs_attention, dormant, archived' },
  { field: 'relationshipNotes', label: 'Private Relationship Notes', group: 'relationship', description: 'Owner-only private relationship context note' },
  { field: 'nextFollowUpDate', label: 'Next Follow-Up Date', group: 'relationship', description: 'Planned follow-up date (ISO or locale date)' },
  { field: 'lastInteractionDate', label: 'Last Interaction Date', group: 'relationship', description: 'Date of last manually recorded interaction' },
  { field: 'lastInteractionType', label: 'Last Interaction Type', group: 'relationship', description: 'phone_call, meeting, video_meeting, email, linkedin, whatsapp, note...' },
  { field: 'lastInteractionSummary', label: 'Last Interaction Summary', group: 'relationship', description: 'Summary of prior interaction history' },
];

const EXACT_ALIAS_MAP: Record<string, ImportCanonicalField> = {
  // Company
  'company name': 'companyName',
  company: 'companyName',
  'organization name': 'companyName',
  organization: 'companyName',
  organisation: 'companyName',
  'account name': 'companyName',
  business: 'companyName',
  'business name': 'companyName',
  'legal name': 'legalName',
  'registered name': 'legalName',
  'trading name': 'tradingName',
  dba: 'tradingName',
  website: 'website',
  'web site': 'website',
  'company website': 'website',
  url: 'website',
  domain: 'domain',
  'website domain': 'domain',
  industry: 'industry',
  sector: 'industry',
  category: 'category',
  'sub sector': 'category',
  description: 'description',
  'company description': 'description',
  country: 'country',
  'country name': 'country',
  nation: 'country',
  'country code': 'countryCode',
  'iso code': 'countryCode',
  iso2: 'countryCode',
  alpha2: 'countryCode',
  region: 'region',
  state: 'region',
  province: 'region',
  county: 'region',
  city: 'city',
  town: 'city',
  locality: 'city',
  'postal code': 'postalCode',
  postcode: 'postalCode',
  zip: 'postalCode',
  'zip code': 'postalCode',
  street: 'street',
  'street address': 'street',
  'address line 1': 'street',
  'registration number': 'registrationNumber',
  'reg number': 'registrationNumber',
  'reg no': 'registrationNumber',
  'company number': 'registrationNumber',
  orgnr: 'registrationNumber',
  'org nr': 'registrationNumber',
  crn: 'registrationNumber',
  abn: 'registrationNumber',
  siren: 'registrationNumber',
  siret: 'registrationNumber',
  uen: 'registrationNumber',
  cik: 'registrationNumber',
  cin: 'registrationNumber',
  'registration type': 'registrationType',
  'reg type': 'registrationType',
  'identifier type': 'registrationType',
  vat: 'vatNumber',
  'vat number': 'vatNumber',
  'tax id': 'vatNumber',
  lei: 'leiNumber',
  'lei code': 'leiNumber',
  'company status': 'companyStatus',
  'legal status': 'companyStatus',
  'annual revenue': 'annualRevenue',
  revenue: 'annualRevenue',
  'employee count': 'employeeCount',
  employees: 'employeeCount',
  headcount: 'employeeCount',
  'employee range': 'employeeRange',
  'company size': 'employeeRange',
  'founded year': 'foundedYear',
  founded: 'foundedYear',
  currency: 'currency',
  'currency code': 'currency',
  'opportunity value': 'opportunityValue',
  'deal value': 'opportunityValue',
  'company phone': 'phone',
  'business phone': 'phone',
  telephone: 'phone',
  'company email': 'email',
  'business email': 'email',
  'company linkedin': 'linkedinCompanyUrl',
  'company linkedin url': 'linkedinCompanyUrl',
  tags: 'tags',

  // Person / Decision-maker
  'first name': 'personFirstName',
  firstname: 'personFirstName',
  'given name': 'personFirstName',
  'last name': 'personLastName',
  lastname: 'personLastName',
  surname: 'personLastName',
  'family name': 'personLastName',
  'full name': 'personFullName',
  'person name': 'personFullName',
  'contact name': 'personFullName',
  'decision maker': 'personFullName',
  'decision maker name': 'personFullName',
  'job title': 'personJobTitle',
  title: 'personJobTitle',
  designation: 'personDesignation',
  role: 'personRole',
  department: 'personDepartment',
  'person email': 'personEmail',
  'contact email': 'personEmail',
  'work email': 'personEmail',
  'direct email': 'personEmail',
  'person phone': 'personPhone',
  'contact phone': 'personPhone',
  'direct phone': 'personPhone',
  mobile: 'personPhone',
  'person linkedin': 'personLinkedInUrl',
  'person linkedin url': 'personLinkedInUrl',
  'linkedin profile': 'personLinkedInUrl',
  'person country': 'personCountry',
  'person city': 'personCity',

  // Relationship
  'associated company': 'associatedCompanyName',
  'associated company name': 'associatedCompanyName',
  'employer': 'associatedCompanyName',
  'associated company reg number': 'associatedCompanyRegNumber',
  'relationship type': 'relationshipType',
  relationship: 'relationshipType',
  position: 'relationshipPosition',
  'decision maker category': 'decisionMakerCategory',
  'buying role': 'decisionMakerCategory',
  'primary contact': 'isPrimaryContact',
  'is primary contact': 'isPrimaryContact',
  'relationship status': 'relationshipStatus',
  'relationship notes': 'relationshipNotes',
  'private notes': 'relationshipNotes',
  'crm notes': 'relationshipNotes',
  'next follow up': 'nextFollowUpDate',
  'next follow up date': 'nextFollowUpDate',
  'follow up date': 'nextFollowUpDate',
  'last interaction': 'lastInteractionDate',
  'last interaction date': 'lastInteractionDate',
  'last contact date': 'lastInteractionDate',
  'last interaction type': 'lastInteractionType',
  'interaction type': 'lastInteractionType',
  'last interaction summary': 'lastInteractionSummary',
  'interaction summary': 'lastInteractionSummary',
  'interaction notes': 'lastInteractionSummary',
};

function normalizeHeaderToken(header: string): string {
  return header
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\(\d+\)$/, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectColumnMappings(
  headers: string[],
  sampleRows: string[][] = []
): {
  mappings: ColumnMappingRule[];
  ambiguityWarnings: MappingAmbiguityWarning[];
  suggestedMergeRules: MultiColumnMergeRule[];
} {
  const normalizedHeaders = headers.map(normalizeHeaderToken);
  const hasExplicitCompanyHeader = normalizedHeaders.some(
    (h) =>
      h.includes('company') ||
      h.includes('organization') ||
      h.includes('organisation') ||
      h.includes('business') ||
      h.includes('legal name')
  );
  const hasPersonHeader = normalizedHeaders.some(
    (h) =>
      h.includes('first name') ||
      h.includes('last name') ||
      h.includes('person') ||
      h.includes('contact') ||
      h.includes('job title') ||
      h.includes('decision maker') ||
      h.includes('founder') ||
      h.includes('director')
  );

  const mappings: ColumnMappingRule[] = [];
  const ambiguityWarnings: MappingAmbiguityWarning[] = [];

  for (let idx = 0; idx < headers.length; idx++) {
    const rawHeader = headers[idx];
    const token = normalizedHeaders[idx];
    const samples = sampleRows.slice(0, 8).map((r) => (r[idx] || '').trim()).filter(Boolean);

    // Explicitly ambiguous generic headers -> warn and do NOT silently auto-map sensitive identity fields
    if (token === 'id' || token === 'record id' || token === 'external id' || token === 'number' || token === 'ref' || token === 'reference') {
      mappings.push({
        sourceColumnIndex: idx,
        sourceHeader: rawHeader,
        targetField: 'ignore',
        confidence: 0.2,
        autoDetected: true,
        ambiguousReason: `Header "${rawHeader}" is generic and could be an internal export ID or an official registration number. Please select explicitly.`,
      });
      ambiguityWarnings.push({
        sourceColumnIndex: idx,
        sourceHeader: rawHeader,
        suggestedTarget: 'ignore',
        candidateTargets: ['registrationNumber', 'associatedCompanyRegNumber', 'customField:external_id', 'ignore'],
        reason: `"${rawHeader}" is ambiguous and was not auto-mapped to Registration Number.`,
        severity: 'high',
      });
      continue;
    }

    if (token === 'name') {
      if (hasExplicitCompanyHeader && !hasPersonHeader) {
        mappings.push({
          sourceColumnIndex: idx,
          sourceHeader: rawHeader,
          targetField: 'personFullName',
          confidence: 0.55,
          autoDetected: true,
          ambiguousReason: 'Header "Name" alongside company column may refer to a contact person.',
        });
        ambiguityWarnings.push({
          sourceColumnIndex: idx,
          sourceHeader: rawHeader,
          suggestedTarget: 'personFullName',
          candidateTargets: ['personFullName', 'companyName', 'tradingName'],
          reason: 'Generic "Name" column detected alongside company fields — confirm whether this is Person Full Name or Company Name.',
          severity: 'high',
        });
      } else {
        mappings.push({
          sourceColumnIndex: idx,
          sourceHeader: rawHeader,
          targetField: 'ignore',
          confidence: 0.3,
          autoDetected: true,
          ambiguousReason: 'Generic "Name" could be a company name or a person name.',
        });
        ambiguityWarnings.push({
          sourceColumnIndex: idx,
          sourceHeader: rawHeader,
          suggestedTarget: 'ignore',
          candidateTargets: ['companyName', 'personFullName', 'legalName'],
          reason: 'Generic "Name" header is ambiguous between Company Name and Person Full Name; manual confirmation required.',
          severity: 'high',
        });
      }
      continue;
    }

    // Generic "email" or "phone" or "linkedin" when person columns exist
    if (token === 'email' || token === 'e mail' || token === 'email address') {
      const target: ImportCanonicalField = hasPersonHeader && !hasExplicitCompanyHeader ? 'personEmail' : 'email';
      mappings.push({
        sourceColumnIndex: idx,
        sourceHeader: rawHeader,
        targetField: target,
        confidence: hasPersonHeader ? 0.65 : 0.9,
        autoDetected: true,
      });
      if (hasPersonHeader && hasExplicitCompanyHeader) {
        ambiguityWarnings.push({
          sourceColumnIndex: idx,
          sourceHeader: rawHeader,
          suggestedTarget: target,
          candidateTargets: ['email', 'personEmail'],
          reason: `Generic "${rawHeader}" column in a mixed company+person file — verify if this is Company Email or Person Work Email.`,
          severity: 'medium',
        });
      }
      continue;
    }

    if (token === 'phone' || token === 'phone number' || token === 'tel') {
      const target: ImportCanonicalField = hasPersonHeader && !hasExplicitCompanyHeader ? 'personPhone' : 'phone';
      mappings.push({
        sourceColumnIndex: idx,
        sourceHeader: rawHeader,
        targetField: target,
        confidence: hasPersonHeader ? 0.65 : 0.9,
        autoDetected: true,
      });
      if (hasPersonHeader && hasExplicitCompanyHeader) {
        ambiguityWarnings.push({
          sourceColumnIndex: idx,
          sourceHeader: rawHeader,
          suggestedTarget: target,
          candidateTargets: ['phone', 'personPhone'],
          reason: `Generic "${rawHeader}" column in a mixed company+person file — verify if this is Company Phone or Person Direct Phone.`,
          severity: 'medium',
        });
      }
      continue;
    }

    if (token === 'linkedin' || token === 'linkedin url') {
      const hasIn = samples.some((s) => s.toLowerCase().includes('/in/'));
      const hasCo = samples.some((s) => s.toLowerCase().includes('/company/'));
      const target: ImportCanonicalField = hasIn ? 'personLinkedInUrl' : hasCo ? 'linkedinCompanyUrl' : hasPersonHeader ? 'personLinkedInUrl' : 'linkedinCompanyUrl';
      mappings.push({
        sourceColumnIndex: idx,
        sourceHeader: rawHeader,
        targetField: target,
        confidence: hasIn || hasCo ? 0.92 : 0.6,
        autoDetected: true,
      });
      if (!hasIn && !hasCo) {
        ambiguityWarnings.push({
          sourceColumnIndex: idx,
          sourceHeader: rawHeader,
          suggestedTarget: target,
          candidateTargets: ['linkedinCompanyUrl', 'personLinkedInUrl'],
          reason: `"${rawHeader}" could be a Company LinkedIn page or Personal LinkedIn profile.`,
          severity: 'medium',
        });
      }
      continue;
    }

    if (token === 'address') {
      mappings.push({
        sourceColumnIndex: idx,
        sourceHeader: rawHeader,
        targetField: 'street',
        confidence: 0.72,
        autoDetected: true,
      });
      ambiguityWarnings.push({
        sourceColumnIndex: idx,
        sourceHeader: rawHeader,
        suggestedTarget: 'street',
        candidateTargets: ['street', 'city', 'region'],
        reason: `"${rawHeader}" mapped to Street Address; verify if full composite address.`,
        severity: 'medium',
      });
      continue;
    }

    if (token === 'status') {
      mappings.push({
        sourceColumnIndex: idx,
        sourceHeader: rawHeader,
        targetField: 'companyStatus',
        confidence: 0.7,
        autoDetected: true,
      });
      ambiguityWarnings.push({
        sourceColumnIndex: idx,
        sourceHeader: rawHeader,
        suggestedTarget: 'companyStatus',
        candidateTargets: ['companyStatus', 'ignore', 'customField:source_status'],
        reason: `"${rawHeader}" mapped to Company Legal Status (Active/Inactive/Dissolved). Note: existing CRM pipeline stage is never overwritten.`,
        severity: 'medium',
      });
      continue;
    }

    // Direct alias lookup
    if (EXACT_ALIAS_MAP[token]) {
      mappings.push({
        sourceColumnIndex: idx,
        sourceHeader: rawHeader,
        targetField: EXACT_ALIAS_MAP[token],
        confidence: 0.95,
        autoDetected: true,
      });
      continue;
    }

    // Keyword heuristics
    let inferred: ImportCanonicalField = 'ignore';
    let confidence = 0;

    if (token.includes('first name') || token === 'fname') {
      inferred = 'personFirstName';
      confidence = 0.88;
    } else if (token.includes('last name') || token === 'lname') {
      inferred = 'personLastName';
      confidence = 0.88;
    } else if (token.includes('person') && token.includes('name')) {
      inferred = 'personFullName';
      confidence = 0.85;
    } else if (token.includes('company') && token.includes('name')) {
      inferred = 'companyName';
      confidence = 0.92;
    } else if (token.includes('legal') && token.includes('name')) {
      inferred = 'legalName';
      confidence = 0.9;
    } else if (token.includes('reg') && token.includes('type')) {
      inferred = 'registrationType';
      confidence = 0.88;
    } else if (token.includes('reg') && (token.includes('num') || token.includes('no') || token.includes('id'))) {
      inferred = 'registrationNumber';
      confidence = 0.86;
    } else if (token.includes('vat') || token.includes('gst') || token.includes('tin')) {
      inferred = 'vatNumber';
      confidence = 0.8;
    } else if (token.includes('web') || token.includes('homepage')) {
      inferred = 'website';
      confidence = 0.85;
    } else if (token.includes('job') || token.includes('position')) {
      inferred = token.includes('rel') ? 'relationshipPosition' : 'personJobTitle';
      confidence = 0.8;
    } else if (token.includes('depart')) {
      inferred = 'personDepartment';
      confidence = 0.82;
    } else if (token.includes('country') && token.includes('code')) {
      inferred = 'countryCode';
      confidence = 0.88;
    } else if (token.includes('country')) {
      inferred = 'country';
      confidence = 0.85;
    } else if (token.includes('postal') || token.includes('zip')) {
      inferred = 'postalCode';
      confidence = 0.85;
    } else if (token.includes('revenue') || token.includes('turnover')) {
      inferred = 'annualRevenue';
      confidence = 0.82;
    } else if (token.includes('employee') || token.includes('headcount')) {
      inferred = samples.some((s) => /^\d+$/.test(s)) ? 'employeeCount' : 'employeeRange';
      confidence = 0.8;
    }

    mappings.push({
      sourceColumnIndex: idx,
      sourceHeader: rawHeader,
      targetField: inferred,
      confidence,
      autoDetected: inferred !== 'ignore',
    });
  }

  // Detect duplicate target mappings across different columns
  const targetUsage = new Map<string, number[]>();
  for (const m of mappings) {
    if (m.targetField === 'ignore') continue;
    const list = targetUsage.get(m.targetField) || [];
    list.push(m.sourceColumnIndex);
    targetUsage.set(m.targetField, list);
  }
  for (const [target, idxs] of targetUsage.entries()) {
    if (idxs.length > 1) {
      for (const i of idxs) {
        ambiguityWarnings.push({
          sourceColumnIndex: i,
          sourceHeader: headers[i],
          suggestedTarget: target as ImportTargetField,
          candidateTargets: [target as ImportTargetField, 'ignore'],
          reason: `Multiple columns are mapped to "${target}". Review or configure a multi-column merge rule.`,
          severity: 'medium',
        });
      }
    }
  }

  // Suggest multi-column merge for First Name + Last Name -> personFullName if personFullName not mapped
  const suggestedMergeRules: MultiColumnMergeRule[] = [];
  const fnIdx = mappings.find((m) => m.targetField === 'personFirstName')?.sourceColumnIndex;
  const lnIdx = mappings.find((m) => m.targetField === 'personLastName')?.sourceColumnIndex;
  const hasFullName = mappings.some((m) => m.targetField === 'personFullName');
  if (fnIdx !== undefined && lnIdx !== undefined && !hasFullName) {
    suggestedMergeRules.push({
      id: 'auto-merge-person-fullname',
      targetField: 'personFullName',
      sourceColumnIndexes: [fnIdx, lnIdx],
      separator: ' ',
    });
  }

  return { mappings, ambiguityWarnings, suggestedMergeRules };
}

export function applyTemplateToHeaders(
  headers: string[],
  template: ImportMappingTemplate
): ColumnMappingRule[] {
  const byHeader = new Map<string, ImportTargetField>();
  for (const item of template.columnMappings) {
    byHeader.set(normalizeHeaderToken(item.sourceHeader), item.targetField);
  }

  return headers.map((h, idx) => {
    const matched = byHeader.get(normalizeHeaderToken(h));
    return {
      sourceColumnIndex: idx,
      sourceHeader: h,
      targetField: matched || 'ignore',
      confidence: matched ? 1 : 0,
      autoDetected: false,
    };
  });
}

export function validateExplicitMappings(
  headers: string[],
  mappings: ColumnMappingRule[],
  mergeRules: MultiColumnMergeRule[] = []
): MappingAmbiguityWarning[] {
  const warnings: MappingAmbiguityWarning[] = [];
  const usedTargets = new Map<string, number[]>();

  for (const rule of mappings) {
    if (!rule.targetField || rule.targetField === 'ignore') continue;
    if (rule.targetField.startsWith('customField:')) {
      const customKey = rule.targetField.slice('customField:'.length).trim();
      if (!customKey) {
        warnings.push({
          sourceColumnIndex: rule.sourceColumnIndex,
          sourceHeader: headers[rule.sourceColumnIndex] || rule.sourceHeader,
          suggestedTarget: rule.targetField,
          candidateTargets: ['ignore'],
          reason: 'Custom field key is empty.',
          severity: 'high',
        });
      }
      continue;
    }
    const list = usedTargets.get(rule.targetField) || [];
    list.push(rule.sourceColumnIndex);
    usedTargets.set(rule.targetField, list);
  }

  const mergeTargets = new Set(mergeRules.map((mr) => mr.targetField));
  for (const [target, colIdxs] of usedTargets.entries()) {
    if (colIdxs.length > 1 && !mergeTargets.has(target as ImportTargetField)) {
      for (const idx of colIdxs) {
        warnings.push({
          sourceColumnIndex: idx,
          sourceHeader: headers[idx] || `Column ${idx + 1}`,
          suggestedTarget: target as ImportTargetField,
          candidateTargets: [target as ImportTargetField, 'ignore'],
          reason: `Columns ${colIdxs.map((c) => `"${headers[c] || c}"`).join(' & ')} all target "${target}" without a merge rule.`,
          severity: 'medium',
        });
      }
    }
  }

  return warnings;
}

export function extractMappedRowValues(
  headers: string[],
  rowCells: string[],
  mappings: ColumnMappingRule[],
  mergeRules: MultiColumnMergeRule[] = []
): {
  rawData: Record<string, string>;
  fields: Record<string, string>;
  customFields: Record<string, string>;
} {
  const rawData: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    rawData[headers[i]] = (rowCells[i] ?? '').trim();
  }

  const fields: Record<string, string> = {};
  const customFields: Record<string, string> = {};

  for (const rule of mappings) {
    if (!rule.targetField || rule.targetField === 'ignore') continue;
    const val = (rowCells[rule.sourceColumnIndex] ?? '').trim();
    if (!val) continue;

    if (rule.targetField.startsWith('customField:')) {
      const key = rule.targetField
        .slice('customField:'.length)
        .trim()
        .replace(/[^a-zA-Z0-9_.-]/g, '_');
      if (key) {
        customFields[key] = customFields[key] ? `${customFields[key]} ${val}` : val;
      }
    } else {
      fields[rule.targetField] = fields[rule.targetField]
        ? `${fields[rule.targetField]} ${val}`
        : val;
    }
  }

  // Apply explicit multi-column merge rules cleanly
  for (const merge of mergeRules) {
    if (!merge.targetField || merge.targetField === 'ignore' || !Array.isArray(merge.sourceColumnIndexes)) {
      continue;
    }
    const sep = merge.separator ?? ' ';
    const parts = merge.sourceColumnIndexes
      .map((idx) => (rowCells[idx] ?? '').trim())
      .filter(Boolean);
    if (parts.length === 0) continue;
    const mergedVal = parts.join(sep).trim();
    if (merge.targetField.startsWith('customField:')) {
      const key = merge.targetField
        .slice('customField:'.length)
        .trim()
        .replace(/[^a-zA-Z0-9_.-]/g, '_');
      if (key) customFields[key] = mergedVal;
    } else {
      fields[merge.targetField] = mergedVal;
    }
  }

  return { rawData, fields, customFields };
}
