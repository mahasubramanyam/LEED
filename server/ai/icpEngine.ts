// Phase 14: Explainable Ideal Customer Profile (ICP) Matching Engine
// Evaluates CRM companies or discovery candidates against owner-configured ICPs.
// Strictly transparent: separates matching facts, mismatches, missing fields, and confidence.

import type {
  CanonicalLead,
  IcpCriterionEvaluation,
  IcpMatchResult,
  IcpProfile,
  LinkedPersonWithRelationship,
} from '../types.js';
import { evaluateCompanyDataQuality } from '../enrichment/dataQualityEngine.js';

export interface DiscoveryCandidateForIcp {
  companyName: string;
  legalName?: string;
  industry?: string;
  category?: string;
  businessType?: string;
  description?: string;
  website?: string;
  email?: string;
  phone?: string;
  country?: string;
  countryCode?: string;
  city?: string;
  confidenceScore?: number;
  tags?: string[];
}

function norm(value?: string): string {
  return (value || '').trim().toLowerCase();
}

function includesAnyToken(haystack: string, needles: string[]): string[] {
  const lower = norm(haystack);
  if (!lower) return [];
  return needles.filter((n) => {
    const token = norm(n);
    return token.length > 0 && lower.includes(token);
  });
}

export function evaluateCompanyAgainstIcp(params: {
  icp: IcpProfile;
  lead?: CanonicalLead;
  candidate?: DiscoveryCandidateForIcp;
  decisionMakers?: LinkedPersonWithRelationship[];
}): IcpMatchResult {
  const { icp, lead, candidate, decisionMakers = [] } = params;
  const targetType: IcpMatchResult['targetType'] = lead ? 'crm_company' : 'discovery_candidate';
  const companyName = lead?.companyName || candidate?.companyName || 'Unnamed Company';

  const industryText = [
    lead?.industry || candidate?.industry || '',
    lead?.category || candidate?.category || '',
  ]
    .filter(Boolean)
    .join(' ');
  const countryCode = (lead?.address?.countryCode || candidate?.countryCode || '').toUpperCase();
  const countryName = lead?.address?.country || candidate?.country || '';
  const businessType =
    lead?.registrationType || lead?.category || candidate?.businessType || candidate?.category || '';
  const website = lead?.website || candidate?.website || '';
  const email = lead?.email || candidate?.email || '';
  const phone = lead?.phone || candidate?.phone || '';
  const descriptionCorpus = [
    companyName,
    lead?.legalName || candidate?.legalName || '',
    industryText,
    candidate?.description || '',
    lead?.webMetadata?.title || '',
    lead?.webMetadata?.description || '',
    ...(lead?.tags || candidate?.tags || []),
  ]
    .filter(Boolean)
    .join(' ');

  const dq = lead ? evaluateCompanyDataQuality(lead, { linkedPersonsCount: decisionMakers.length }) : null;
  const dataQualityScore = dq?.overallScore;
  const confidenceVal = lead?.confidenceScore ?? candidate?.confidenceScore ?? 50;

  const matchingCriteria: IcpCriterionEvaluation[] = [];
  const nonMatchingCriteria: IcpCriterionEvaluation[] = [];
  const missingInformation: string[] = [];
  const evidenceSummary: string[] = [];

  let earnedPoints = 0;
  let possiblePoints = 0;
  let evaluatedCriteria = 0;
  let totalConfiguredCriteria = 0;
  let excluded = false;

  // 1. Excluded Industries check (hard disqualification if matched)
  if (icp.excludedIndustries.length > 0) {
    totalConfiguredCriteria++;
    if (industryText) {
      evaluatedCriteria++;
      const matchedExcluded = includesAnyToken(industryText, icp.excludedIndustries);
      if (matchedExcluded.length > 0) {
        excluded = true;
        nonMatchingCriteria.push({
          criterion: 'Excluded Industry Check',
          status: 'excluded',
          pointsAwarded: 0,
          maxPoints: 25,
          evidence: `Matches excluded industry filter: ${matchedExcluded.join(', ')} (company industry: ${industryText}).`,
          factSource: 'source_reported',
        });
        evidenceSummary.push(`Excluded industry hit: ${matchedExcluded.join(', ')}`);
      } else {
        matchingCriteria.push({
          criterion: 'Excluded Industry Check',
          status: 'matched',
          pointsAwarded: 5,
          maxPoints: 5,
          evidence: `Industry "${industryText}" does not trigger any excluded industries.`,
          factSource: 'source_reported',
        });
        earnedPoints += 5;
        possiblePoints += 5;
      }
    } else {
      missingInformation.push('Company industry is missing; excluded industry check could not be confirmed.');
    }
  }

  // 2. Target Industries (25 pts)
  if (icp.targetIndustries.length > 0) {
    totalConfiguredCriteria++;
    possiblePoints += 25;
    if (industryText) {
      evaluatedCriteria++;
      const matched = includesAnyToken(descriptionCorpus, icp.targetIndustries);
      const directIndustryMatch = includesAnyToken(industryText, icp.targetIndustries);
      if (directIndustryMatch.length > 0) {
        earnedPoints += 25;
        matchingCriteria.push({
          criterion: 'Target Industry',
          status: 'matched',
          pointsAwarded: 25,
          maxPoints: 25,
          evidence: `Direct industry match: ${directIndustryMatch.join(', ')} (record industry: ${industryText}).`,
          factSource: lead?.sources?.length ? 'verified_fact' : 'source_reported',
        });
        evidenceSummary.push(`Industry match: ${directIndustryMatch.join(', ')}`);
      } else if (matched.length > 0) {
        earnedPoints += 15;
        matchingCriteria.push({
          criterion: 'Target Industry',
          status: 'partial',
          pointsAwarded: 15,
          maxPoints: 25,
          evidence: `Partial match in company description/tags: ${matched.join(', ')} (listed industry: ${industryText}).`,
          factSource: 'source_reported',
        });
      } else {
        nonMatchingCriteria.push({
          criterion: 'Target Industry',
          status: 'mismatch',
          pointsAwarded: 0,
          maxPoints: 25,
          evidence: `Company industry "${industryText}" does not match target industries (${icp.targetIndustries.join(', ')}).`,
          factSource: 'source_reported',
        });
      }
    } else {
      missingInformation.push('Industry classification is not recorded.');
      nonMatchingCriteria.push({
        criterion: 'Target Industry',
        status: 'missing',
        pointsAwarded: 0,
        maxPoints: 25,
        evidence: 'No industry field present on company record.',
        factSource: 'unknown',
      });
    }
  }

  // 3. Target Countries / Geography (20 pts)
  if (icp.targetCountries.length > 0) {
    totalConfiguredCriteria++;
    possiblePoints += 20;
    if (countryCode || countryName) {
      evaluatedCriteria++;
      const hit = icp.targetCountries.some(
        (c) =>
          c.toUpperCase() === countryCode ||
          (countryName && norm(countryName).includes(norm(c))) ||
          (countryCode && norm(c) === norm(countryCode))
      );
      if (hit) {
        earnedPoints += 20;
        matchingCriteria.push({
          criterion: 'Target Geography',
          status: 'matched',
          pointsAwarded: 20,
          maxPoints: 20,
          evidence: `Located in ${countryName || countryCode} (${countryCode || 'N/A'}), matching ICP countries.`,
          factSource: 'verified_fact',
        });
        evidenceSummary.push(`Geography match: ${countryName || countryCode}`);
      } else {
        nonMatchingCriteria.push({
          criterion: 'Target Geography',
          status: 'mismatch',
          pointsAwarded: 0,
          maxPoints: 20,
          evidence: `Located in ${countryName || countryCode}, outside target countries (${icp.targetCountries.join(', ')}).`,
          factSource: 'verified_fact',
        });
      }
    } else {
      missingInformation.push('Country / location data is missing.');
      nonMatchingCriteria.push({
        criterion: 'Target Geography',
        status: 'missing',
        pointsAwarded: 0,
        maxPoints: 20,
        evidence: 'Country is missing from company record.',
        factSource: 'unknown',
      });
    }
  }

  // 4. Preferred Keywords & Offering Signals (15 pts)
  if (icp.preferredKeywords.length > 0) {
    totalConfiguredCriteria++;
    possiblePoints += 15;
    if (descriptionCorpus.trim().length > 2) {
      evaluatedCriteria++;
      const matchedKeywords = includesAnyToken(descriptionCorpus, icp.preferredKeywords);
      if (matchedKeywords.length > 0) {
        const ratio = Math.min(1, matchedKeywords.length / Math.min(3, icp.preferredKeywords.length));
        const pts = Math.round(15 * ratio);
        earnedPoints += pts;
        matchingCriteria.push({
          criterion: 'Preferred Keywords & Signals',
          status: pts >= 12 ? 'matched' : 'partial',
          pointsAwarded: pts,
          maxPoints: 15,
          evidence: `Observed keywords: ${matchedKeywords.join(', ')}.`,
          factSource: 'source_reported',
        });
        evidenceSummary.push(`Keyword signals: ${matchedKeywords.join(', ')}`);
      } else {
        nonMatchingCriteria.push({
          criterion: 'Preferred Keywords & Signals',
          status: 'mismatch',
          pointsAwarded: 0,
          maxPoints: 15,
          evidence: `None of the preferred keywords (${icp.preferredKeywords.join(', ')}) found in available profile text.`,
          factSource: 'source_reported',
        });
      }
    } else {
      missingInformation.push('Company description/website summary is missing for keyword evaluation.');
    }
  }

  // 5. Target Business Types (10 pts)
  if (icp.targetBusinessTypes.length > 0) {
    totalConfiguredCriteria++;
    possiblePoints += 10;
    if (businessType) {
      evaluatedCriteria++;
      const matchedTypes = includesAnyToken(`${businessType} ${descriptionCorpus}`, icp.targetBusinessTypes);
      if (matchedTypes.length > 0) {
        earnedPoints += 10;
        matchingCriteria.push({
          criterion: 'Business Type',
          status: 'matched',
          pointsAwarded: 10,
          maxPoints: 10,
          evidence: `Matched business type signal: ${matchedTypes.join(', ')}.`,
          factSource: 'source_reported',
        });
      } else {
        nonMatchingCriteria.push({
          criterion: 'Business Type',
          status: 'mismatch',
          pointsAwarded: 0,
          maxPoints: 10,
          evidence: `Recorded business type "${businessType}" did not match target types (${icp.targetBusinessTypes.join(', ')}).`,
          factSource: 'source_reported',
        });
      }
    } else {
      missingInformation.push('Business type / registration category is missing.');
    }
  }

  // 6. Target Decision-Maker Roles (15 pts)
  if (icp.targetDecisionMakerRoles.length > 0) {
    totalConfiguredCriteria++;
    possiblePoints += 15;
    if (decisionMakers.length > 0) {
      evaluatedCriteria++;
      const activeRoles = decisionMakers
        .filter((d) => d.relationship.provenance?.employmentStatus !== 'historical')
        .map((d) => `${d.person.fullName} (${d.relationship.jobTitle || d.relationship.designation || d.relationship.relationshipType})`);
      const roleCorpus = decisionMakers
        .filter((d) => d.relationship.provenance?.employmentStatus !== 'historical')
        .map((d) => [d.relationship.jobTitle, d.relationship.designation, d.relationship.relationshipType, d.relationship.department, d.person.seniority, d.person.decisionMakingFunction].filter(Boolean).join(' '))
        .join(' | ');
      const matchedRoles = includesAnyToken(roleCorpus, icp.targetDecisionMakerRoles);
      if (matchedRoles.length > 0) {
        earnedPoints += 15;
        matchingCriteria.push({
          criterion: 'Target Decision-Maker Roles',
          status: 'matched',
          pointsAwarded: 15,
          maxPoints: 15,
          evidence: `Target role(s) identified (${matchedRoles.join(', ')}) among: ${activeRoles.slice(0, 3).join('; ')}.`,
          factSource: 'verified_fact',
        });
        evidenceSummary.push(`Decision-makers matching target role: ${matchedRoles.join(', ')}`);
      } else {
        nonMatchingCriteria.push({
          criterion: 'Target Decision-Maker Roles',
          status: 'mismatch',
          pointsAwarded: 0,
          maxPoints: 15,
          evidence: `Linked people (${activeRoles.slice(0, 3).join('; ')}) do not yet include target roles (${icp.targetDecisionMakerRoles.join(', ')}).`,
          factSource: 'verified_fact',
        });
      }
    } else {
      missingInformation.push('No linked decision-makers recorded yet to evaluate target executive roles.');
      nonMatchingCriteria.push({
        criterion: 'Target Decision-Maker Roles',
        status: 'missing',
        pointsAwarded: 0,
        maxPoints: 15,
        evidence: 'Zero linked decision-makers in LEED.',
        factSource: 'unknown',
      });
    }
  }

  // 7. Data Quality & Confidence Thresholds (10 pts)
  if (icp.minDataQualityScore !== undefined && icp.minDataQualityScore > 0) {
    totalConfiguredCriteria++;
    possiblePoints += 10;
    if (dataQualityScore !== undefined) {
      evaluatedCriteria++;
      if (dataQualityScore >= icp.minDataQualityScore) {
        earnedPoints += 10;
        matchingCriteria.push({
          criterion: 'Minimum Data Quality',
          status: 'matched',
          pointsAwarded: 10,
          maxPoints: 10,
          evidence: `Data quality score ${dataQualityScore}/100 meets minimum threshold (${icp.minDataQualityScore}).`,
          factSource: 'verified_fact',
        });
      } else {
        nonMatchingCriteria.push({
          criterion: 'Minimum Data Quality',
          status: 'mismatch',
          pointsAwarded: 0,
          maxPoints: 10,
          evidence: `Data quality score ${dataQualityScore}/100 is below threshold (${icp.minDataQualityScore}).`,
          factSource: 'verified_fact',
        });
      }
    } else {
      missingInformation.push('Full CRM data quality score not yet evaluated (discovery candidate).');
    }
  }

  // 8. Website / Contact Requirements (5 pts each)
  if (icp.requireWebsite) {
    totalConfiguredCriteria++;
    possiblePoints += 5;
    evaluatedCriteria++;
    if (website) {
      earnedPoints += 5;
      matchingCriteria.push({
        criterion: 'Official Website Present',
        status: 'matched',
        pointsAwarded: 5,
        maxPoints: 5,
        evidence: `Website recorded: ${website}.`,
        factSource: 'source_reported',
      });
    } else {
      missingInformation.push('Official company website is missing.');
      nonMatchingCriteria.push({
        criterion: 'Official Website Present',
        status: 'missing',
        pointsAwarded: 0,
        maxPoints: 5,
        evidence: 'No website URL recorded.',
        factSource: 'unknown',
      });
    }
  }

  if (icp.requireVerifiedContact) {
    totalConfiguredCriteria++;
    possiblePoints += 5;
    evaluatedCriteria++;
    const hasVerifiedEmail =
      lead?.emailStatus === 'verified' ||
      decisionMakers.some((d) => d.person.emailStatus === 'verified' || d.person.verificationStatus === 'officially_verified');
    if (hasVerifiedEmail) {
      earnedPoints += 5;
      matchingCriteria.push({
        criterion: 'Verified Contact Information',
        status: 'matched',
        pointsAwarded: 5,
        maxPoints: 5,
        evidence: 'Verified email or verified decision-maker record present.',
        factSource: 'verified_fact',
      });
    } else if (email || phone) {
      earnedPoints += 2;
      matchingCriteria.push({
        criterion: 'Verified Contact Information',
        status: 'partial',
        pointsAwarded: 2,
        maxPoints: 5,
        evidence: 'Contact details exist but are not yet formally verified.',
        factSource: 'source_reported',
      });
    } else {
      missingInformation.push('No verified business email or decision-maker contact on file.');
      nonMatchingCriteria.push({
        criterion: 'Verified Contact Information',
        status: 'missing',
        pointsAwarded: 0,
        maxPoints: 5,
        evidence: 'No verified email or phone contact available.',
        factSource: 'unknown',
      });
    }
  }

  let overallScore = possiblePoints > 0 ? Math.round((earnedPoints / possiblePoints) * 100) : Math.round(confidenceVal * 0.6);
  if (excluded) {
    overallScore = Math.min(overallScore, 10);
  }

  let fitLabel: IcpMatchResult['fitLabel'] = 'poor_fit';
  if (excluded) fitLabel = 'excluded';
  else if (overallScore >= 80) fitLabel = 'strong_fit';
  else if (overallScore >= 60) fitLabel = 'good_fit';
  else if (overallScore >= 38) fitLabel = 'partial_fit';
  else fitLabel = 'poor_fit';

  const coverageRatio = totalConfiguredCriteria > 0 ? evaluatedCriteria / totalConfiguredCriteria : 0.5;
  const matchConfidence = Math.min(
    98,
    Math.max(20, Math.round(coverageRatio * 60 + (confidenceVal / 100) * 40))
  );

  return {
    icpId: icp.id,
    icpName: icp.name,
    targetType,
    leadId: lead?.id,
    companyName,
    overallScore,
    fitLabel,
    confidenceScore: matchConfidence,
    isInferred: true,
    transparencyLabel: `Derived ICP fit (${overallScore}/100 · ${fitLabel.replace('_', ' ')}) against "${icp.name}" based on ${evaluatedCriteria}/${Math.max(1, totalConfiguredCriteria)} measurable criteria — analytical estimate, not an external fact.`,
    matchingCriteria,
    nonMatchingCriteria,
    missingInformation,
    evidenceSummary,
    evaluatedAt: new Date().toISOString(),
  };
}
