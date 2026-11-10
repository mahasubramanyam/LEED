import { CanonicalLead, LeadSource, LeadIdentifier } from '../types.js';

interface BrregAddress {
  adresse?: string[];
  postnummer?: string;
  poststed?: string;
  kommunenummer?: string;
  kommune?: string;
  landkode?: string;
  land?: string;
}

interface BrregEnhet {
  organisasjonsnummer: string;
  navn: string;
  organisasjonsform?: {
    kode: string;
    beskrivelse: string;
  };
  naeringskode1?: {
    kode: string;
    beskrivelse: string;
  };
  forretningsadresse?: BrregAddress;
  postadresse?: BrregAddress;
  hjemmeside?: string;
  registreringsdatoEnhetsregisteret?: string;
  konkurs?: boolean;
  underAvvikling?: boolean;
}

export async function searchBrreg(
  query: string,
  cityFilter?: string
): Promise<{ leads: CanonicalLead[]; rawCount: number }> {
  const url = new URL('https://data.brreg.no/enhetsregisteret/api/enheter');
  url.searchParams.set('navn', query.trim());
  url.searchParams.set('size', '20');

  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'GlobalLeadPipeline/1.0 (contact@internal-pipeline.local)',
  };

  const response = await fetch(url.toString(), {
    headers,
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`Brreg registry returned HTTP ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    _embedded?: {
      enheter?: BrregEnhet[];
    };
    page?: {
      totalElements?: number;
    };
  };

  const enheter = data._embedded?.enheter || [];
  const now = new Date().toISOString();

  const leads: CanonicalLead[] = enheter
    .filter((e) => {
      if (!cityFilter) return true;
      const addr = e.forretningsadresse || e.postadresse;
      const city = addr?.poststed || '';
      return city.toLowerCase().includes(cityFilter.toLowerCase());
    })
    .map((e) => {
      const addr = e.forretningsadresse || e.postadresse;
      const street = addr?.adresse?.join(', ') || '';
      const city = addr?.poststed || 'Oslo';
      const postalCode = addr?.postnummer || '';
      const country = addr?.land || 'Norway';

      const website = e.hjemmeside
        ? e.hjemmeside.startsWith('http')
          ? e.hjemmeside
          : `https://${e.hjemmeside}`
        : undefined;

      const domain = website ? new URL(website).hostname.replace(/^www\./, '') : undefined;

      const isDissolved = e.konkurs || e.underAvvikling;
      const statusDesc = isDissolved ? 'dissolved' : 'active';

      const sources: LeadSource[] = [
        {
          sourceName: 'Brønnøysund Register Centre (Brreg)',
          providerId: e.organisasjonsnummer,
          url: `https://data.brreg.no/enhetsregisteret/oppslag/enheter/${e.organisasjonsnummer}`,
          retrievedAt: now,
          license: 'Norwegian Licence for Open Government Data (NLOD)',
          attribution: 'Official open public data from the Brønnøysund Register Centre',
        },
      ];

      const identifiers: LeadIdentifier[] = [
        {
          type: 'BRREG_ORG',
          value: e.organisasjonsnummer,
          verified: true,
        },
      ];

      if (domain) {
        identifiers.push({
          type: 'DOMAIN',
          value: domain,
          verified: false,
        });
      }

      // Transparent confidence calculation based on official registry verification
      const signals: string[] = ['Official Government Registry Record (Brreg Verified)'];
      let confidenceScore = 65; // Base for verified government registry record

      if (website) {
        confidenceScore += 15;
        signals.push('Official Registered Website Present');
      }
      if (e.naeringskode1?.beskrivelse) {
        confidenceScore += 10;
        signals.push(`Standard NACE Industry Code: ${e.naeringskode1.kode}`);
      }
      if (street && city) {
        confidenceScore += 10;
        signals.push('Physical Registered Address Verified');
      }

      const foundedYear = e.registreringsdatoEnhetsregisteret
        ? parseInt(e.registreringsdatoEnhetsregisteret.slice(0, 4), 10)
        : undefined;

      return {
        id: `brreg-${e.organisasjonsnummer}`,
        companyName: e.navn,
        legalName: e.navn,
        registrationNumber: e.organisasjonsnummer,
        registrationType: 'NO_ORG',
        companyStatus: statusDesc,
        website,
        domain,
        address: {
          street,
          city,
          postalCode,
          country,
          countryCode: 'NO',
          formattedAddress: [street, postalCode, city, country].filter(Boolean).join(', '),
        },
        industry: e.naeringskode1?.beskrivelse || 'General Commerce & Services',
        category: e.organisasjonsform?.beskrivelse || 'Aksjeselskap (AS)',
        foundedYear,
        confidenceScore,
        confidenceSignals: signals,
        sources,
        identifiers,
        status: 'new',
        pipelineStageId: 'stage-discovered',
        currency: 'NOK',
        tags: ['Norway', 'Official Registry', e.organisasjonsform?.kode || 'AS'].filter(Boolean),
        notes: [],
        activities: [
          {
            id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            type: 'enrichment',
            title: 'Discovered from Norwegian Business Register (Brreg)',
            outcome: `Official Org Nr ${e.organisasjonsnummer} matched`,
            date: now,
            actor: 'System Connector',
          },
        ],
        createdAt: now,
        updatedAt: now,
      };
    });

  return {
    leads,
    rawCount: data.page?.totalElements || leads.length,
  };
}
