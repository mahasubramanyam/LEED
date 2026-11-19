export type DecisionMakerRoleCategory =
  | 'ownership_leadership'
  | 'executive_management'
  | 'procurement_purchasing'
  | 'sales_business_dev'
  | 'other_contacts';

export type DecisionMakerCategory = DecisionMakerRoleCategory;

export type DecisionMakerSeniority =
  | 'c_suite'
  | 'board_owner'
  | 'vp_director'
  | 'manager_head'
  | 'specialist_advisor'
  | 'unknown';

export const EXPANDED_RELATIONSHIP_TYPES = [
  // Ownership & leadership
  'founder',
  'co_founder',
  'owner',
  'director',
  'managing_director',
  'ceo',
  'president',
  'chairman',
  'board_member',
  // Executive management
  'cfo',
  'coo',
  'cto',
  'cio',
  'chro',
  'cmo',
  'executive',
  'officer',
  // Procurement & purchasing
  'procurement_manager',
  'chief_procurement_officer',
  'purchasing_manager',
  'sourcing_manager',
  'supply_chain_director',
  'procurement_contact',
  // Sales & business development
  'sales_director',
  'business_development_director',
  'business_development_manager',
  'partnership_manager',
  'commercial_director',
  'sales_contact',
  // Other relevant contacts
  'department_head',
  'operations_manager',
  'finance_manager',
  'hr_manager',
  'technical_director',
  'advisor',
  'employee',
  'contact',
] as const;

export type ExpandedRelationshipType = (typeof EXPANDED_RELATIONSHIP_TYPES)[number];

export interface RoleMetadataSpec {
  relationshipType: ExpandedRelationshipType;
  label: string;
  roleCategory: DecisionMakerRoleCategory;
  categoryLabel: string;
  defaultDepartment: string;
  seniority: DecisionMakerSeniority;
  decisionMakingFunction: string;
}

export interface ClassifiedRoleResult extends RoleMetadataSpec {
  department: string;
  category: DecisionMakerRoleCategory;
  functionArea: string;
}

export const ROLE_TAXONOMY_SPECS: Record<ExpandedRelationshipType, RoleMetadataSpec> = {
  founder: {
    relationshipType: 'founder',
    label: 'Founder',
    roleCategory: 'ownership_leadership',
    categoryLabel: 'Ownership & Leadership',
    defaultDepartment: 'Executive Leadership',
    seniority: 'board_owner',
    decisionMakingFunction: 'Company Ownership & Strategic Control',
  },
  co_founder: {
    relationshipType: 'co_founder',
    label: 'Co-Founder',
    roleCategory: 'ownership_leadership',
    categoryLabel: 'Ownership & Leadership',
    defaultDepartment: 'Executive Leadership',
    seniority: 'board_owner',
    decisionMakingFunction: 'Company Ownership & Strategic Control',
  },
  owner: {
    relationshipType: 'owner',
    label: 'Business Owner',
    roleCategory: 'ownership_leadership',
    categoryLabel: 'Ownership & Leadership',
    defaultDepartment: 'Ownership',
    seniority: 'board_owner',
    decisionMakingFunction: 'Ultimate Ownership & Sign-Off Authority',
  },
  director: {
    relationshipType: 'director',
    label: 'Director',
    roleCategory: 'ownership_leadership',
    categoryLabel: 'Ownership & Leadership',
    defaultDepartment: 'Board & Governance',
    seniority: 'board_owner',
    decisionMakingFunction: 'Corporate Governance & Fiduciary Sign-Off',
  },
  managing_director: {
    relationshipType: 'managing_director',
    label: 'Managing Director',
    roleCategory: 'ownership_leadership',
    categoryLabel: 'Ownership & Leadership',
    defaultDepartment: 'Executive Management',
    seniority: 'c_suite',
    decisionMakingFunction: 'Overall Operational & Commercial Sign-Off',
  },
  ceo: {
    relationshipType: 'ceo',
    label: 'CEO',
    roleCategory: 'ownership_leadership',
    categoryLabel: 'Ownership & Leadership',
    defaultDepartment: 'Executive Management',
    seniority: 'c_suite',
    decisionMakingFunction: 'Chief Executive & Enterprise Strategy',
  },
  president: {
    relationshipType: 'president',
    label: 'President',
    roleCategory: 'ownership_leadership',
    categoryLabel: 'Ownership & Leadership',
    defaultDepartment: 'Executive Management',
    seniority: 'c_suite',
    decisionMakingFunction: 'Executive Leadership & Corporate Direction',
  },
  chairman: {
    relationshipType: 'chairman',
    label: 'Chairman / Chair',
    roleCategory: 'ownership_leadership',
    categoryLabel: 'Ownership & Leadership',
    defaultDepartment: 'Board & Governance',
    seniority: 'board_owner',
    decisionMakingFunction: 'Board Chairmanship & Oversight',
  },
  board_member: {
    relationshipType: 'board_member',
    label: 'Board Member',
    roleCategory: 'ownership_leadership',
    categoryLabel: 'Ownership & Leadership',
    defaultDepartment: 'Board & Governance',
    seniority: 'board_owner',
    decisionMakingFunction: 'Board Governance & Oversight',
  },
  cfo: {
    relationshipType: 'cfo',
    label: 'CFO',
    roleCategory: 'executive_management',
    categoryLabel: 'Executive Management',
    defaultDepartment: 'Finance & Accounting',
    seniority: 'c_suite',
    decisionMakingFunction: 'Financial Governance & Budget Approval',
  },
  coo: {
    relationshipType: 'coo',
    label: 'COO',
    roleCategory: 'executive_management',
    categoryLabel: 'Executive Management',
    defaultDepartment: 'Operations',
    seniority: 'c_suite',
    decisionMakingFunction: 'Operations & Delivery Execution',
  },
  cto: {
    relationshipType: 'cto',
    label: 'CTO',
    roleCategory: 'executive_management',
    categoryLabel: 'Executive Management',
    defaultDepartment: 'Technology & Engineering',
    seniority: 'c_suite',
    decisionMakingFunction: 'Technical Architecture & Platform Decisions',
  },
  cio: {
    relationshipType: 'cio',
    label: 'CIO',
    roleCategory: 'executive_management',
    categoryLabel: 'Executive Management',
    defaultDepartment: 'Information Technology',
    seniority: 'c_suite',
    decisionMakingFunction: 'Enterprise IT & Systems Governance',
  },
  chro: {
    relationshipType: 'chro',
    label: 'CHRO',
    roleCategory: 'executive_management',
    categoryLabel: 'Executive Management',
    defaultDepartment: 'Human Resources',
    seniority: 'c_suite',
    decisionMakingFunction: 'People Operations & Organizational Strategy',
  },
  cmo: {
    relationshipType: 'cmo',
    label: 'CMO',
    roleCategory: 'executive_management',
    categoryLabel: 'Executive Management',
    defaultDepartment: 'Marketing',
    seniority: 'c_suite',
    decisionMakingFunction: 'Brand, Growth & Marketing Strategy',
  },
  executive: {
    relationshipType: 'executive',
    label: 'Senior Executive',
    roleCategory: 'executive_management',
    categoryLabel: 'Executive Management',
    defaultDepartment: 'Executive Management',
    seniority: 'c_suite',
    decisionMakingFunction: 'Executive Decision-Making',
  },
  officer: {
    relationshipType: 'officer',
    label: 'Corporate Officer',
    roleCategory: 'executive_management',
    categoryLabel: 'Executive Management',
    defaultDepartment: 'Corporate Governance',
    seniority: 'vp_director',
    decisionMakingFunction: 'Statutory Corporate Representation',
  },
  procurement_manager: {
    relationshipType: 'procurement_manager',
    label: 'Procurement Manager',
    roleCategory: 'procurement_purchasing',
    categoryLabel: 'Procurement & Purchasing',
    defaultDepartment: 'Procurement',
    seniority: 'manager_head',
    decisionMakingFunction: 'Vendor Evaluation & Purchasing Decisions',
  },
  chief_procurement_officer: {
    relationshipType: 'chief_procurement_officer',
    label: 'Chief Procurement Officer',
    roleCategory: 'procurement_purchasing',
    categoryLabel: 'Procurement & Purchasing',
    defaultDepartment: 'Procurement',
    seniority: 'c_suite',
    decisionMakingFunction: 'Enterprise Procurement & Supplier Governance',
  },
  purchasing_manager: {
    relationshipType: 'purchasing_manager',
    label: 'Purchasing Manager',
    roleCategory: 'procurement_purchasing',
    categoryLabel: 'Procurement & Purchasing',
    defaultDepartment: 'Purchasing',
    seniority: 'manager_head',
    decisionMakingFunction: 'Purchasing & Vendor Selection',
  },
  sourcing_manager: {
    relationshipType: 'sourcing_manager',
    label: 'Sourcing Manager',
    roleCategory: 'procurement_purchasing',
    categoryLabel: 'Procurement & Purchasing',
    defaultDepartment: 'Strategic Sourcing',
    seniority: 'manager_head',
    decisionMakingFunction: 'Strategic Sourcing & Supplier Qualification',
  },
  supply_chain_director: {
    relationshipType: 'supply_chain_director',
    label: 'Supply Chain Director',
    roleCategory: 'procurement_purchasing',
    categoryLabel: 'Procurement & Purchasing',
    defaultDepartment: 'Supply Chain',
    seniority: 'vp_director',
    decisionMakingFunction: 'Supply Chain & Procurement Strategy',
  },
  procurement_contact: {
    relationshipType: 'procurement_contact',
    label: 'Procurement Contact',
    roleCategory: 'procurement_purchasing',
    categoryLabel: 'Procurement & Purchasing',
    defaultDepartment: 'Procurement',
    seniority: 'manager_head',
    decisionMakingFunction: 'Vendor Qualification & Purchasing',
  },
  sales_director: {
    relationshipType: 'sales_director',
    label: 'Sales Director',
    roleCategory: 'sales_business_dev',
    categoryLabel: 'Sales & Business Development',
    defaultDepartment: 'Sales',
    seniority: 'vp_director',
    decisionMakingFunction: 'Commercial Revenue & Sales Leadership',
  },
  business_development_director: {
    relationshipType: 'business_development_director',
    label: 'Business Development Director',
    roleCategory: 'sales_business_dev',
    categoryLabel: 'Sales & Business Development',
    defaultDepartment: 'Business Development',
    seniority: 'vp_director',
    decisionMakingFunction: 'Commercial Expansion & Partnerships',
  },
  business_development_manager: {
    relationshipType: 'business_development_manager',
    label: 'Business Development Manager',
    roleCategory: 'sales_business_dev',
    categoryLabel: 'Sales & Business Development',
    defaultDepartment: 'Business Development',
    seniority: 'manager_head',
    decisionMakingFunction: 'Pipeline Growth & Commercial Deals',
  },
  partnership_manager: {
    relationshipType: 'partnership_manager',
    label: 'Partnership Manager',
    roleCategory: 'sales_business_dev',
    categoryLabel: 'Sales & Business Development',
    defaultDepartment: 'Partnerships & Alliances',
    seniority: 'manager_head',
    decisionMakingFunction: 'Channel & Strategic Partnerships',
  },
  commercial_director: {
    relationshipType: 'commercial_director',
    label: 'Commercial Director',
    roleCategory: 'sales_business_dev',
    categoryLabel: 'Sales & Business Development',
    defaultDepartment: 'Commercial',
    seniority: 'vp_director',
    decisionMakingFunction: 'Commercial Contracts & Revenue Strategy',
  },
  sales_contact: {
    relationshipType: 'sales_contact',
    label: 'Sales / Commercial Contact',
    roleCategory: 'sales_business_dev',
    categoryLabel: 'Sales & Business Development',
    defaultDepartment: 'Sales & Commercial',
    seniority: 'manager_head',
    decisionMakingFunction: 'Commercial Engagement',
  },
  department_head: {
    relationshipType: 'department_head',
    label: 'Department Head',
    roleCategory: 'other_contacts',
    categoryLabel: 'Other Relevant Contacts',
    defaultDepartment: 'Department Leadership',
    seniority: 'manager_head',
    decisionMakingFunction: 'Departmental Budget & Operational Ownership',
  },
  operations_manager: {
    relationshipType: 'operations_manager',
    label: 'Operations Manager',
    roleCategory: 'other_contacts',
    categoryLabel: 'Other Relevant Contacts',
    defaultDepartment: 'Operations',
    seniority: 'manager_head',
    decisionMakingFunction: 'Operational Execution & Tooling Adoption',
  },
  finance_manager: {
    relationshipType: 'finance_manager',
    label: 'Finance Manager',
    roleCategory: 'other_contacts',
    categoryLabel: 'Other Relevant Contacts',
    defaultDepartment: 'Finance',
    seniority: 'manager_head',
    decisionMakingFunction: 'Financial Review & Budget Management',
  },
  hr_manager: {
    relationshipType: 'hr_manager',
    label: 'HR Manager',
    roleCategory: 'other_contacts',
    categoryLabel: 'Other Relevant Contacts',
    defaultDepartment: 'Human Resources',
    seniority: 'manager_head',
    decisionMakingFunction: 'People & HR Operations',
  },
  technical_director: {
    relationshipType: 'technical_director',
    label: 'Technical Director',
    roleCategory: 'other_contacts',
    categoryLabel: 'Other Relevant Contacts',
    defaultDepartment: 'Engineering & Technical',
    seniority: 'vp_director',
    decisionMakingFunction: 'Technical Evaluation & Engineering Leadership',
  },
  advisor: {
    relationshipType: 'advisor',
    label: 'Advisor',
    roleCategory: 'other_contacts',
    categoryLabel: 'Other Relevant Contacts',
    defaultDepartment: 'Advisory',
    seniority: 'specialist_advisor',
    decisionMakingFunction: 'Strategic Advisory',
  },
  employee: {
    relationshipType: 'employee',
    label: 'Employee',
    roleCategory: 'other_contacts',
    categoryLabel: 'Other Relevant Contacts',
    defaultDepartment: 'General',
    seniority: 'specialist_advisor',
    decisionMakingFunction: 'Operational Staff',
  },
  contact: {
    relationshipType: 'contact',
    label: 'Business Contact',
    roleCategory: 'other_contacts',
    categoryLabel: 'Other Relevant Contacts',
    defaultDepartment: 'General',
    seniority: 'unknown',
    decisionMakingFunction: 'General Business Contact',
  },
};

export function classifyDecisionMakerRole(
  arg1?: string | { rawRelationshipType?: string; rawJobTitle?: string; rawDepartment?: string },
  arg2?: string
): ClassifiedRoleResult {
  const rawRelationshipType = typeof arg1 === 'object' && arg1 !== null ? arg1.rawRelationshipType : arg1;
  const rawJobTitle = typeof arg1 === 'object' && arg1 !== null ? arg1.rawJobTitle : arg2;
  const rawDepartment = typeof arg1 === 'object' && arg1 !== null ? arg1.rawDepartment : undefined;

  const finalize = (spec: RoleMetadataSpec): ClassifiedRoleResult => ({
    ...spec,
    department: rawDepartment?.trim() || spec.defaultDepartment,
    category: spec.roleCategory,
    functionArea: spec.decisionMakingFunction,
  });

  const relClean = (rawRelationshipType || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (relClean && relClean in ROLE_TAXONOMY_SPECS) {
    return finalize(ROLE_TAXONOMY_SPECS[relClean as ExpandedRelationshipType]);
  }

  const hay = `${rawJobTitle || ''} ${rawRelationshipType || ''}`.toLowerCase();

  if (/\bco-?founder\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.co_founder);
  if (/\bfounder\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.founder);
  if (/\b(managing\s+director|daglig\s+leder|administrerende\s+direkt[oø]r|gesch[aä]ftsf[uü]hrer|directeur\s+g[eé]n[eé]ral)\b/.test(hay)) {
    return finalize(ROLE_TAXONOMY_SPECS.managing_director);
  }
  if (/\b(chief\s+executive\s+officer|ceo)\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.ceo);
  if (/\b(chairman|chairperson|chair\s+of\s+the\s+board|styreleder)\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.chairman);
  if (/\bpresident\b/.test(hay) && !/\bvice\s+president\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.president);
  if (/\b(owner|proprietor|beneficial\s+owner|eier)\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.owner);
  if (/\b(board\s+member|styremedlem|supervisory\s+board|non-executive\s+director)\b/.test(hay)) {
    return finalize(ROLE_TAXONOMY_SPECS.board_member);
  }
  if (/\b(chief\s+procurement\s+officer|cpo)\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.chief_procurement_officer);
  if (/\b(chief\s+financial\s+officer|cfo)\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.cfo);
  if (/\b(chief\s+operating\s+officer|coo)\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.coo);
  if (/\b(chief\s+technology\s+officer|cto)\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.cto);
  if (/\b(chief\s+information\s+officer|cio)\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.cio);
  if (/\b(chief\s+human\s+resources\s+officer|chro)\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.chro);
  if (/\b(chief\s+marketing\s+officer|cmo)\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.cmo);

  if (/\bsupply\s+chain\s+director\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.supply_chain_director);
  if (/\bpurchasing\s+manager\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.purchasing_manager);
  if (/\bsourcing\s+manager\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.sourcing_manager);
  if (/\bprocurement\s+manager\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.procurement_manager);
  if (/\b(procurement|purchasing|sourcing|buyer)\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.procurement_contact);

  if (/\bbusiness\s+development\s+director\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.business_development_director);
  if (/\bbusiness\s+development\s+manager\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.business_development_manager);
  if (/\bpartnership(?:s)?\s+manager\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.partnership_manager);
  if (/\bcommercial\s+director\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.commercial_director);
  if (/\bsales\s+director\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.sales_director);
  if (/\b(sales|business\s+development|partnerships|commercial|account\s+director)\b/.test(hay)) {
    return finalize(ROLE_TAXONOMY_SPECS.sales_contact);
  }

  if (/\btechnical\s+director\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.technical_director);
  if (/\boperations\s+manager\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.operations_manager);
  if (/\bfinance\s+manager\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.finance_manager);
  if (/\b(hr\s+manager|human\s+resources\s+manager)\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.hr_manager);
  if (/\b(head\s+of|department\s+head)\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.department_head);

  if (/\bdirector\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.director);
  if (/\b(vp|vice\s+president|chief|executive|svp|evp)\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.executive);
  if (/\b(officer|company\s+secretary|signatory)\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.officer);
  if (/\b(advisor|advisory|counsel)\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.advisor);
  if (/\b(manager|lead|specialist|engineer|coordinator)\b/.test(hay)) return finalize(ROLE_TAXONOMY_SPECS.employee);

  return finalize(ROLE_TAXONOMY_SPECS.contact);
}

export function getRecommendedTargetTitlesForIndustry(industry?: string, businessType?: string): string[] {
  const base = [
    'CEO',
    'Managing Director',
    'Founder',
    'Co-Founder',
    'CFO',
    'COO',
    'Procurement Manager',
    'Sales Director',
    'Business Development Manager',
  ];
  const combined = `${industry || ''} ${businessType || ''}`.toLowerCase();
  if (/\b(manufactur|industrial|hardware|engineer|energy|logistics|supply|construction|semiconductor|maritime)\b/.test(combined)) {
    return Array.from(
      new Set([
        'Managing Director',
        'CEO',
        'Chief Procurement Officer',
        'Supply Chain Director',
        'Procurement Manager',
        'Operations Manager',
        'Technical Director',
        'Commercial Director',
        ...base,
      ])
    );
  }
  if (/\b(software|saas|tech|ai|fintech|cloud|cyber|it)\b/.test(combined)) {
    return Array.from(
      new Set([
        'Founder',
        'Co-Founder',
        'CEO',
        'CTO',
        'CIO',
        'COO',
        'Partnership Manager',
        'Business Development Director',
        ...base,
      ])
    );
  }
  if (/\b(retail|commerce|wholesale|distributor|consumer|food|pharma|health)\b/.test(combined)) {
    return Array.from(
      new Set([
        'Managing Director',
        'Purchasing Manager',
        'Sourcing Manager',
        'Commercial Director',
        'CMO',
        'Supply Chain Director',
        ...base,
      ])
    );
  }
  return base;
}
