import { GoogleGenAI } from '@google/genai';
import { CanonicalLead } from './types.js';

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

export async function analyzeLeadWithAi(lead: CanonicalLead): Promise<{
  summary: string;
  qualificationStatus: 'Strong Fit' | 'Moderate Fit' | 'Low Fit' | 'Needs Verification';
  fitScore: number;
  keyStrengths: string[];
  missingDataGaps: string[];
  recommendedStrategy: string;
  suggestedQualificationQuestions: string[];
  engine: 'gemini-3.8-flash' | 'deterministic-pipeline';
}> {
  const ai = getAiClient();

  if (ai) {
    try {
      const prompt = `You are a Senior B2B Sales & Intelligence Director evaluating a lead record in our global pipeline.
Strict Policy: TRUTHFUL DATA ONLY. Do not invent or hallucinate facts that are not present in the lead data below. Explicitly identify what data is verified vs missing.

LEAD DATA:
Company Name: ${lead.companyName}
Legal Name: ${lead.legalName || 'N/A'}
Registration ID: ${lead.registrationNumber || 'N/A'} (${lead.registrationType || 'Unregistered/Unknown'})
Company Status: ${lead.companyStatus || 'Unknown'}
Industry: ${lead.industry || 'Unknown'}
Category: ${lead.category || 'Unknown'}
Location: ${lead.address?.formattedAddress || lead.address?.country || 'Unknown'}
Website: ${lead.website || 'No website registered'}
Email: ${lead.email || 'None discovered'} (${lead.emailStatus || 'N/A'})
Phone: ${lead.phone || 'None discovered'}
Coordinates: ${lead.coordinates ? `${lead.coordinates.lat}, ${lead.coordinates.lon}` : 'N/A'}
Confidence Score: ${lead.confidenceScore}/100
Sources: ${lead.sources.map((s) => s.sourceName).join(', ')}
Web Title: ${lead.webMetadata?.title || 'N/A'}
Web Description: ${lead.webMetadata?.description || 'N/A'}

Respond with a JSON object following this exact structure:
{
  "summary": "Brief 2-3 sentence executive synopsis based strictly on observed data",
  "qualificationStatus": "Strong Fit" | "Moderate Fit" | "Low Fit" | "Needs Verification",
  "fitScore": number from 0 to 100,
  "keyStrengths": ["list of 2-4 factual strengths observed"],
  "missingDataGaps": ["list of 1-3 critical gaps e.g. unverified email, missing phone"],
  "recommendedStrategy": "Actionable next sales step for this specific lead",
  "suggestedQualificationQuestions": ["2-3 insightful discovery questions tailored to this company"]
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = (response.text ?? '{}').trim();
      const parsed = JSON.parse(text);
      return { ...parsed, engine: 'gemini-3.8-flash' };
    } catch (err) {
      console.warn('Gemini API call returned error, switching to deterministic pipeline engine:', err);
    }
  }

  // Deterministic, factual analytical fallback based on real canonical lead facts
  const gaps: string[] = [];
  if (!lead.email) gaps.push('No direct contact email discovered in public records');
  if (!lead.phone) gaps.push('No telephone number on file');
  if (!lead.website) gaps.push('No official website or registered domain found');
  if (gaps.length === 0) gaps.push('Decision-maker executive name pending direct call verification');

  const strengths: string[] = [...lead.confidenceSignals];
  if (strengths.length === 0) {
    strengths.push(`Entity listed in ${lead.address?.country || 'international'} pipeline`);
  }

  const qualificationStatus =
    lead.confidenceScore >= 80 ? 'Strong Fit' : lead.confidenceScore >= 50 ? 'Moderate Fit' : 'Needs Verification';

  return {
    summary: `${lead.companyName} is an active business organization in ${lead.industry} based in ${
      lead.address?.city || lead.address?.country || 'their registered territory'
    }. Data provenance is verified via ${lead.sources.map((s) => s.sourceName).join(' & ') || 'registry records'}.`,
    qualificationStatus,
    fitScore: lead.confidenceScore,
    keyStrengths: strengths.slice(0, 4),
    missingDataGaps: gaps,
    recommendedStrategy: lead.phone
      ? `Conduct a polite 30-second introductory telephone inquiry via ${lead.phone} to identify the department head.`
      : lead.website
      ? `Submit a personalized partnership inquiry via their official contact domain (${lead.domain || lead.website}).`
      : 'Review official registry filings to identify officers or legal headquarters for outreach.',
    suggestedQualificationQuestions: [
      `What software systems are currently deployed across ${lead.companyName}'s ${lead.industry} operations?`,
      `Who within your executive leadership oversees new infrastructure integration and supplier qualification?`,
    ],
    engine: 'deterministic-pipeline',
  };
}

export async function generateSalesPitchWithAi(
  lead: CanonicalLead,
  valueProposition?: string
): Promise<{
  emailSubject: string;
  emailBody: string;
  linkedInMessage: string;
  coldCallOpener: string;
  rationale: string;
  engine: 'gemini-3.8-flash' | 'deterministic-pipeline';
}> {
  const userProp =
    valueProposition?.trim() ||
    'Modernizing operational workflows and improving client acquisition efficiency with verifiable data.';

  const ai = getAiClient();

  if (ai) {
    try {
      const prompt = `You are an elite Sales Automation Copywriter.
Draft high-converting, personalized outreach copy for this prospect.
Strict Constraint: Never invent claims or fake past interactions. Reference only the real company facts provided.

LEAD DETAILS:
Company: ${lead.companyName}
Industry: ${lead.industry}
Category: ${lead.category}
Location: ${lead.address?.city || ''}, ${lead.address?.country || ''}
Website: ${lead.website || 'N/A'}
Web Summary: ${lead.webMetadata?.description || lead.webMetadata?.title || 'N/A'}
Registration: ${lead.registrationNumber || 'N/A'}

OUR VALUE PROPOSITION / OFFERING:
"${userProp}"

Respond with a JSON object with this exact structure:
{
  "emailSubject": "Compelling, low-friction, natural subject line (under 7 words)",
  "emailBody": "Personalized, concise email body (under 120 words), focusing on mutual fit and asking for quick feedback or brief discussion",
  "linkedInMessage": "Personal connection note under 280 characters",
  "coldCallOpener": "30-second conversational phone script acknowledging their business context",
  "rationale": "Why this specific angle resonates with this company profile"
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = (response.text ?? '{}').trim();
      const parsed = JSON.parse(text);
      return { ...parsed, engine: 'gemini-3.8-flash' };
    } catch (err) {
      console.warn('Gemini pitch generation returned error, using factual copy engine:', err);
    }
  }

  // Factual, compliant deterministic sales copy generator
  const city = lead.address?.city || 'your region';
  return {
    emailSubject: `Quick inquiry for ${lead.companyName} leadership`,
    emailBody: `Hi ${lead.companyName} team,\n\nI came across your active work in ${lead.industry} in ${city}.\n\nWe assist organizations in your sector with ${userProp.toLowerCase()}\n\nGiven your focus on ${lead.category}, would you be open to a 5-minute conversation next week to see if this aligns with your current priorities?\n\nBest regards,\nLead Intelligence Operator`,
    linkedInMessage: `Hi, noticed ${lead.companyName}'s work in ${lead.industry} across ${city}. Would love to connect and share notes on recent workflow developments.`,
    coldCallOpener: `Hi, this is following up regarding ${lead.companyName}'s operations in ${city}. I noticed your focus on ${lead.industry}—have you got 30 seconds to discuss how peers in your market handle workflow automation?`,
    rationale: `Targeted specifically to their verified location (${city}) and registered sector (${lead.industry}). Respects human approval safeguard and avoids unverified assertions.`,
    engine: 'deterministic-pipeline',
  };
}

export async function generateMeetingBriefWithAi(lead: CanonicalLead): Promise<{
  executiveOverview: string;
  discussionTopics: string[];
  potentialObjections: Array<{ objection: string; suggestedRebuttal: string }>;
  closingGoal: string;
  engine: 'gemini-3.8-flash' | 'deterministic-pipeline';
}> {
  const ai = getAiClient();

  if (ai) {
    try {
      const prompt = `Prepare a 60-second executive sales briefing before an owner hops on a call with this prospective business:

Company: ${lead.companyName}
Industry: ${lead.industry} (${lead.category})
Address: ${lead.address?.formattedAddress || 'N/A'}
Registration: ${lead.registrationNumber || 'N/A'}
Confidence Score: ${lead.confidenceScore}/100
Sources: ${lead.sources.map((s) => s.sourceName).join(', ')}

Return a JSON object:
{
  "executiveOverview": "2 sentence summary of who they are and why we are talking to them",
  "discussionTopics": ["topic 1", "topic 2", "topic 3"],
  "potentialObjections": [
    { "objection": "likely concern", "suggestedRebuttal": "confident factual response" }
  ],
  "closingGoal": "Clear recommended next step or call outcome"
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = (response.text ?? '{}').trim();
      const parsed = JSON.parse(text);
      return { ...parsed, engine: 'gemini-3.8-flash' };
    } catch (err) {
      console.warn('Gemini meeting brief returned error, using factual briefing engine:', err);
    }
  }

  return {
    executiveOverview: `${lead.companyName} is an active prospect in ${lead.industry} located at ${
      lead.address?.formattedAddress || lead.address?.country || 'their registered office'
    }. They hold a confidence score of ${lead.confidenceScore}% with verified registry presence.`,
    discussionTopics: [
      `Review current software and data workflows within their ${lead.industry} division.`,
      `Discuss current pain points regarding registry reporting and contact data accuracy.`,
      `Evaluate compatibility with their existing infrastructure and timeline.`,
    ],
    potentialObjections: [
      {
        objection: 'We already have established internal workflows.',
        suggestedRebuttal:
          'Completely understood. Our system is designed to integrate alongside existing setups without ripping and replacing your current tools.',
      },
      {
        objection: 'Is our contact data compliant with local regulations?',
        suggestedRebuttal:
          'Yes, every lead record maintains full provenance, licensing details, and strict opt-out suppression.',
      },
    ],
    closingGoal: 'Secure a 15-minute technical discovery call with the primary operations or procurement stakeholder.',
    engine: 'deterministic-pipeline',
  };
}

export async function generateMarketReportWithAi(
  country: string,
  industry: string,
  sampleLeads: CanonicalLead[]
): Promise<{
  marketSummary: string;
  regionalTrends: string[];
  underservedNiches: string[];
  recommendedOutreachStrategy: string;
  competitorOrRegulatoryContext: string;
  engine: 'gemini-3.8-flash' | 'deterministic-pipeline';
}> {
  const ai = getAiClient();

  if (ai) {
    try {
      const prompt = `Analyze current market opportunities for B2B prospecting in ${country} within ${industry}.
Sample real leads in pipeline (${sampleLeads.length}):
${sampleLeads.slice(0, 10).map((l) => `- ${l.companyName} (${l.address?.city || 'Unknown City'}) - Score: ${l.confidenceScore}%`).join('\n')}

Provide an actionable market intelligence brief in JSON:
{
  "marketSummary": "2-3 sentences assessing market density and outreach readiness in ${country}",
  "regionalTrends": ["trend 1", "trend 2"],
  "underservedNiches": ["niche 1", "niche 2"],
  "recommendedOutreachStrategy": "Strategic recommendation for timing, value prop and communication channel",
  "competitorOrRegulatoryContext": "Key compliance, registration or market factors for ${country}"
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = (response.text ?? '{}').trim();
      const parsed = JSON.parse(text);
      return { ...parsed, engine: 'gemini-3.8-flash' };
    } catch (err) {
      console.warn('Gemini market report returned error, using fallback market engine:', err);
    }
  }

  return {
    marketSummary: `Prospect density in ${country} across ${industry} demonstrates strong demand for automated compliance and high-integrity data pipelines. Currently ${sampleLeads.length} active leads are cataloged.`,
    regionalTrends: [
      `Accelerating digital transformation across regional hubs in ${country}.`,
      `Increasing emphasis on official registry verification and transparent corporate attribution.`,
    ],
    underservedNiches: [
      `Mid-market engineering and technical consulting firms seeking automated qualification.`,
      `B2B service providers operating with unverified contact databases.`,
    ],
    recommendedOutreachStrategy: `Prioritize leads with verified physical addresses and active registry records. Utilize direct inquiry telephone outreach followed by tailored email briefings.`,
    competitorOrRegulatoryContext: `Ensure strict adherence to national marketing communication laws and GDPR/ePrivacy standards when conducting business outreach in ${country}.`,
    engine: 'deterministic-pipeline',
  };
}

export async function generateDiscoveryQueriesWithAi(params: {
  query?: string;
  industry?: string;
  productsServices?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  businessType?: string;
}): Promise<{
  suggestedQueries: string[];
  industryKeywords: string[];
  recommendedFollowUp: string[];
  rationale: string;
  provenanceType: 'inferred';
  engine: 'gemini-4-hydrogen' | 'deterministic-pipeline';
}> {
  const ai = getAiClient();
  const baseTerms = [
    params.query?.trim(),
    params.industry?.trim(),
    params.productsServices?.trim(),
    params.businessType?.trim(),
  ].filter(Boolean) as string[];
  const locationSuffix = [params.city?.trim(), params.region?.trim(), params.countryCode?.trim()]
    .filter((v) => v && v !== 'GLOBAL')
    .join(' ');

  if (ai && baseTerms.length > 0) {
    try {
      const prompt = `You are a B2B Global Business Discovery Planner.
Given the owner's targeting parameters below, generate focused search engine and business directory queries to discover genuine companies (not individuals).
Do NOT invent company names or fake URLs. Only propose search queries and industry keyword variations.

INPUT:
Query: ${params.query || 'N/A'}
Industry: ${params.industry || 'N/A'}
Products/Services: ${params.productsServices || 'N/A'}
Business Type: ${params.businessType || 'N/A'}
Location: ${locationSuffix || 'Global'}

Return JSON:
{
  "suggestedQueries": ["3 to 5 concise search queries suitable for Brave Search / Wikidata / business directories"],
  "industryKeywords": ["3 to 6 industry/product keyword terms"],
  "recommendedFollowUp": ["2 to 3 recommended verification steps (e.g. inspect official website, verify in GLEIF or national registry)"],
  "rationale": "1-2 sentences explaining the query strategy"
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      const parsed = JSON.parse((response.text ?? '{}').trim());
      if (Array.isArray(parsed.suggestedQueries) && parsed.suggestedQueries.length > 0) {
        return {
          suggestedQueries: parsed.suggestedQueries.slice(0, 6).map(String),
          industryKeywords: Array.isArray(parsed.industryKeywords)
            ? parsed.industryKeywords.slice(0, 8).map(String)
            : baseTerms,
          recommendedFollowUp: Array.isArray(parsed.recommendedFollowUp)
            ? parsed.recommendedFollowUp.slice(0, 4).map(String)
            : [],
          rationale: String(parsed.rationale || 'AI-generated search query expansion.'),
          provenanceType: 'inferred',
          engine: 'gemini-4-hydrogen',
        };
      }
    } catch (err) {
      console.warn('Gemini query planner fallback:', err);
    }
  }

  const core = baseTerms[0] || 'B2B supplier';
  const loc = locationSuffix ? ` ${locationSuffix}` : '';
  const prod = params.productsServices?.trim();
  const ind = params.industry?.trim();

  const queries = Array.from(
    new Set(
      [
        `${core}${loc}`.trim(),
        ind && prod ? `${ind} ${prod}${loc}`.trim() : `${core} company${loc}`.trim(),
        params.businessType ? `${core} ${params.businessType}${loc}`.trim() : `${core} official website${loc}`.trim(),
        ind ? `${ind} manufacturer OR provider${loc}`.trim() : `${core} services${loc}`.trim(),
      ].filter(Boolean)
    )
  ).slice(0, 5);

  return {
    suggestedQueries: queries,
    industryKeywords: Array.from(new Set([...baseTerms, ...(prod ? prod.split(/[,\s]+/).filter((w) => w.length > 3) : [])])).slice(0, 6),
    recommendedFollowUp: [
      'Inspect discovered official websites to verify public business addresses, phones, and offerings.',
      'Cross-verify candidate companies against national registries or GLEIF LEI before CRM qualification.',
    ],
    rationale: 'Deterministic keyword and location query expansion combining industry, product, and geographic terms.',
    provenanceType: 'inferred',
    engine: 'deterministic-pipeline',
  };
}

export async function extractBusinessIntelFromWebEvidence(params: {
  companyName: string;
  url: string;
  pageExcerpts: Array<{ url: string; pageType: string; textExcerpt: string }>;
  existingIndustry?: string;
}): Promise<{
  businessSummary: string;
  inferredIndustry: string;
  inferredCategory: string;
  extractedProductsServices: string[];
  extractedLocationsServed: string[];
  confidenceNote: string;
  provenanceClassification: 'ai_extracted' | 'inferred';
  engine: 'gemini-4-hydrogen' | 'deterministic-pipeline';
}> {
  const combinedEvidence = params.pageExcerpts
    .map((p) => `[${p.pageType.toUpperCase()} - ${p.url}]\n${p.textExcerpt.slice(0, 1400)}`)
    .join('\n\n')
    .slice(0, 5000);

  const ai = getAiClient();
  if (ai && combinedEvidence.trim().length > 40) {
    try {
      const prompt = `Analyze the retrieved official company website text below.
CRITICAL RULES:
- Base EVERY extracted fact strictly on the provided webpage text.
- NEVER invent registration numbers, revenue, employee counts, emails, phone numbers, or addresses not present in the text.
- Distinguish concise company summary and product/service extraction from inferred industry classification.

COMPANY: ${params.companyName}
WEBSITE: ${params.url}

RETRIEVED PAGE EVIDENCE:
${combinedEvidence}

Return JSON:
{
  "businessSummary": "2 concise factual sentences describing what the company states it does",
  "inferredIndustry": "Concise B2B industry label",
  "inferredCategory": "Concise business category",
  "extractedProductsServices": ["up to 6 concrete products or services explicitly named in the text"],
  "extractedLocationsServed": ["countries or cities explicitly mentioned as served or office locations"],
  "confidenceNote": "Brief note citing which page types provided evidence"
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      const parsed = JSON.parse((response.text ?? '{}').trim());
      return {
        businessSummary: String(parsed.businessSummary || '').trim() || `Public website observed at ${params.url}.`,
        inferredIndustry: String(parsed.inferredIndustry || params.existingIndustry || 'Commercial Enterprise'),
        inferredCategory: String(parsed.inferredCategory || 'Web-Observed Business'),
        extractedProductsServices: Array.isArray(parsed.extractedProductsServices)
          ? parsed.extractedProductsServices.slice(0, 8).map(String)
          : [],
        extractedLocationsServed: Array.isArray(parsed.extractedLocationsServed)
          ? parsed.extractedLocationsServed.slice(0, 8).map(String)
          : [],
        confidenceNote: String(
          parsed.confidenceNote ||
            `Extracted from ${params.pageExcerpts.length} crawled company page(s); industry classification is AI-inferred.`
        ),
        provenanceClassification: 'ai_extracted',
        engine: 'gemini-4-hydrogen',
      };
    } catch (err) {
      console.warn('Gemini web extraction fallback:', err);
    }
  }

  const firstSnippet = params.pageExcerpts[0]?.textExcerpt?.slice(0, 260).replace(/\s+/g, ' ').trim();
  return {
    businessSummary: firstSnippet
      ? `Observed on ${params.url}: ${firstSnippet}${firstSnippet.length >= 260 ? '...' : ''}`
      : `Company website inspected at ${params.url}.`,
    inferredIndustry: params.existingIndustry || 'General Commerce & Services',
    inferredCategory: 'Web-Observed Business',
    extractedProductsServices: [],
    extractedLocationsServed: [],
    confidenceNote: `Grounded strictly in ${params.pageExcerpts.length} fetched page(s) (${params.pageExcerpts.map((p) => p.pageType).join(', ') || 'homepage'}).`,
    provenanceClassification: 'inferred',
    engine: 'deterministic-pipeline',
  };
}

export async function assessDuplicatePairWithAi(params: {
  candidate: CanonicalLead;
  existing: CanonicalLead;
  matchReason: string;
}): Promise<{
  assessment: 'likely_same_entity' | 'possible_branch_or_subsidiary' | 'likely_distinct';
  explanation: string;
  provenanceType: 'inferred';
  engine: 'gemini-4-hydrogen' | 'deterministic-pipeline';
}> {
  const ai = getAiClient();
  if (ai) {
    try {
      const prompt = `Compare two business records flagged for duplicate review. Never recommend auto-merging if registration numbers differ or branches are distinct.
Record A: ${params.candidate.companyName} | Reg: ${params.candidate.registrationNumber || 'N/A'} | Domain: ${params.candidate.domain || 'N/A'} | City: ${params.candidate.address?.city || 'N/A'}, ${params.candidate.address?.countryCode || 'N/A'}
Record B: ${params.existing.companyName} | Reg: ${params.existing.registrationNumber || 'N/A'} | Domain: ${params.existing.domain || 'N/A'} | City: ${params.existing.address?.city || 'N/A'}, ${params.existing.address?.countryCode || 'N/A'}
Signal: ${params.matchReason}

Return JSON:
{
  "assessment": "likely_same_entity" | "possible_branch_or_subsidiary" | "likely_distinct",
  "explanation": "1-2 factual sentences for the owner"
}`;
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      const parsed = JSON.parse((response.text ?? '{}').trim());
      return {
        assessment: parsed.assessment || 'possible_branch_or_subsidiary',
        explanation: String(parsed.explanation || params.matchReason),
        provenanceType: 'inferred',
        engine: 'gemini-4-hydrogen',
      };
    } catch {
      // Fall through cleanly
    }
  }

  const diffReg =
    params.candidate.registrationNumber &&
    params.existing.registrationNumber &&
    params.candidate.registrationNumber !== params.existing.registrationNumber;

  return {
    assessment: diffReg ? 'possible_branch_or_subsidiary' : 'likely_same_entity',
    explanation: diffReg
      ? `Different registration numbers (${params.candidate.registrationNumber} vs ${params.existing.registrationNumber}) indicate separate legal entities or subsidiaries.`
      : params.matchReason,
    provenanceType: 'inferred',
    engine: 'deterministic-pipeline',
  };
}
