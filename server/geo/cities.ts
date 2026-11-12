import { CityReference } from './types.js';

export const MAJOR_CITIES_DATA: CityReference[] = [
  // United Kingdom (GB)
  { id: 'gb-lon', name: 'London', countryCode: 'GB', divisionCode: 'ENG', divisionName: 'England', population: 8982000 },
  { id: 'gb-man', name: 'Manchester', countryCode: 'GB', divisionCode: 'ENG', divisionName: 'England', population: 553000 },
  { id: 'gb-bir', name: 'Birmingham', countryCode: 'GB', divisionCode: 'ENG', divisionName: 'England', population: 1149000 },
  { id: 'gb-lee', name: 'Leeds', countryCode: 'GB', divisionCode: 'ENG', divisionName: 'England', population: 789000 },
  { id: 'gb-gla', name: 'Glasgow', countryCode: 'GB', divisionCode: 'SCT', divisionName: 'Scotland', population: 635000 },
  { id: 'gb-edi', name: 'Edinburgh', countryCode: 'GB', divisionCode: 'SCT', divisionName: 'Scotland', population: 527000 },
  { id: 'gb-bri', name: 'Bristol', countryCode: 'GB', divisionCode: 'ENG', divisionName: 'England', population: 467000 },
  { id: 'gb-liv', name: 'Liverpool', countryCode: 'GB', divisionCode: 'ENG', divisionName: 'England', population: 498000 },
  { id: 'gb-cam', name: 'Cambridge', countryCode: 'GB', divisionCode: 'ENG', divisionName: 'England', population: 145000 },
  { id: 'gb-oxf', name: 'Oxford', countryCode: 'GB', divisionCode: 'ENG', divisionName: 'England', population: 152000 },
  { id: 'gb-car', name: 'Cardiff', countryCode: 'GB', divisionCode: 'WLS', divisionName: 'Wales', population: 362000 },
  { id: 'gb-bel', name: 'Belfast', countryCode: 'GB', divisionCode: 'NIR', divisionName: 'Northern Ireland', population: 343000 },

  // Norway (NO)
  { id: 'no-osl', name: 'Oslo', countryCode: 'NO', divisionCode: 'NO-03', divisionName: 'Oslo', population: 709000 },
  { id: 'no-ber', name: 'Bergen', countryCode: 'NO', divisionCode: 'NO-46', divisionName: 'Vestland', population: 289000 },
  { id: 'no-tro', name: 'Trondheim', countryCode: 'NO', divisionCode: 'NO-50', divisionName: 'Trøndelag', population: 212000 },
  { id: 'no-sta', name: 'Stavanger', countryCode: 'NO', divisionCode: 'NO-11', divisionName: 'Rogaland', population: 146000 },
  { id: 'no-kri', name: 'Kristiansand', countryCode: 'NO', divisionCode: 'NO-42', divisionName: 'Agder', population: 115000 },
  { id: 'no-dra', name: 'Drammen', countryCode: 'NO', divisionCode: 'NO-33', divisionName: 'Buskerud', population: 103000 },
  { id: 'no-trom', name: 'Tromsø', countryCode: 'NO', divisionCode: 'NO-55', divisionName: 'Troms', population: 77000 },
  { id: 'no-ale', name: 'Ålesund', countryCode: 'NO', divisionCode: 'NO-15', divisionName: 'Møre og Romsdal', population: 67000 },

  // United States (US)
  { id: 'us-nyc', name: 'New York', countryCode: 'US', divisionCode: 'NY', divisionName: 'New York', population: 8336000 },
  { id: 'us-lax', name: 'Los Angeles', countryCode: 'US', divisionCode: 'CA', divisionName: 'California', population: 3822000 },
  { id: 'us-chi', name: 'Chicago', countryCode: 'US', divisionCode: 'IL', divisionName: 'Illinois', population: 2665000 },
  { id: 'us-hou', name: 'Houston', countryCode: 'US', divisionCode: 'TX', divisionName: 'Texas', population: 2302000 },
  { id: 'us-phx', name: 'Phoenix', countryCode: 'US', divisionCode: 'AZ', divisionName: 'Arizona', population: 1644000 },
  { id: 'us-sfo', name: 'San Francisco', countryCode: 'US', divisionCode: 'CA', divisionName: 'California', population: 808000 },
  { id: 'us-sea', name: 'Seattle', countryCode: 'US', divisionCode: 'WA', divisionName: 'Washington', population: 749000 },
  { id: 'us-aus', name: 'Austin', countryCode: 'US', divisionCode: 'TX', divisionName: 'Texas', population: 974000 },
  { id: 'us-bos', name: 'Boston', countryCode: 'US', divisionCode: 'MA', divisionName: 'Massachusetts', population: 650000 },
  { id: 'us-mia', name: 'Miami', countryCode: 'US', divisionCode: 'FL', divisionName: 'Florida', population: 442000 },
  { id: 'us-atl', name: 'Atlanta', countryCode: 'US', divisionCode: 'GA', divisionName: 'Georgia', population: 499000 },
  { id: 'us-den', name: 'Denver', countryCode: 'US', divisionCode: 'CO', divisionName: 'Colorado', population: 713000 },
  { id: 'us-sjc', name: 'San Jose', countryCode: 'US', divisionCode: 'CA', divisionName: 'California', population: 971000 },
  { id: 'us-dal', name: 'Dallas', countryCode: 'US', divisionCode: 'TX', divisionName: 'Texas', population: 1304000 },

  // Australia (AU)
  { id: 'au-syd', name: 'Sydney', countryCode: 'AU', divisionCode: 'NSW', divisionName: 'New South Wales', population: 5312000 },
  { id: 'au-mel', name: 'Melbourne', countryCode: 'AU', divisionCode: 'VIC', divisionName: 'Victoria', population: 5078000 },
  { id: 'au-bri', name: 'Brisbane', countryCode: 'AU', divisionCode: 'QLD', divisionName: 'Queensland', population: 2560000 },
  { id: 'au-per', name: 'Perth', countryCode: 'AU', divisionCode: 'WA', divisionName: 'Western Australia', population: 2125000 },
  { id: 'au-ade', name: 'Adelaide', countryCode: 'AU', divisionCode: 'SA', divisionName: 'South Australia', population: 1387000 },
  { id: 'au-can', name: 'Canberra', countryCode: 'AU', divisionCode: 'ACT', divisionName: 'Australian Capital Territory', population: 456000 },
  { id: 'au-hob', name: 'Hobart', countryCode: 'AU', divisionCode: 'TAS', divisionName: 'Tasmania', population: 238000 },

  // Canada (CA)
  { id: 'ca-tor', name: 'Toronto', countryCode: 'CA', divisionCode: 'ON', divisionName: 'Ontario', population: 2794000 },
  { id: 'ca-mon', name: 'Montreal', countryCode: 'CA', divisionCode: 'QC', divisionName: 'Quebec', population: 1762000 },
  { id: 'ca-van', name: 'Vancouver', countryCode: 'CA', divisionCode: 'BC', divisionName: 'British Columbia', population: 662000 },
  { id: 'ca-cal', name: 'Calgary', countryCode: 'CA', divisionCode: 'AB', divisionName: 'Alberta', population: 1306000 },
  { id: 'ca-ott', name: 'Ottawa', countryCode: 'CA', divisionCode: 'ON', divisionName: 'Ontario', population: 1017000 },
  { id: 'ca-edm', name: 'Edmonton', countryCode: 'CA', divisionCode: 'AB', divisionName: 'Alberta', population: 1010000 },

  // Germany (DE)
  { id: 'de-ber', name: 'Berlin', countryCode: 'DE', divisionCode: 'BE', divisionName: 'Berlin', population: 3677000 },
  { id: 'de-mun', name: 'Munich', countryCode: 'DE', divisionCode: 'BY', divisionName: 'Bavaria', population: 1488000 },
  { id: 'de-ham', name: 'Hamburg', countryCode: 'DE', divisionCode: 'HH', divisionName: 'Hamburg', population: 1852000 },
  { id: 'de-fra', name: 'Frankfurt am Main', countryCode: 'DE', divisionCode: 'HE', divisionName: 'Hesse', population: 764000 },
  { id: 'de-kol', name: 'Cologne', countryCode: 'DE', divisionCode: 'NW', divisionName: 'North Rhine-Westphalia', population: 1083000 },
  { id: 'de-stu', name: 'Stuttgart', countryCode: 'DE', divisionCode: 'BW', divisionName: 'Baden-Württemberg', population: 630000 },
  { id: 'de-dus', name: 'Düsseldorf', countryCode: 'DE', divisionCode: 'NW', divisionName: 'North Rhine-Westphalia', population: 620000 },

  // France (FR)
  { id: 'fr-par', name: 'Paris', countryCode: 'FR', divisionCode: 'IDF', divisionName: 'Île-de-France', population: 2161000 },
  { id: 'fr-lyo', name: 'Lyon', countryCode: 'FR', divisionCode: 'ARA', divisionName: 'Auvergne-Rhône-Alpes', population: 522000 },
  { id: 'fr-mar', name: 'Marseille', countryCode: 'FR', divisionCode: 'PAC', divisionName: 'Provence-Alpes-Côte d\'Azur', population: 873000 },
  { id: 'fr-tou', name: 'Toulouse', countryCode: 'FR', divisionCode: 'OCC', divisionName: 'Occitanie', population: 498000 },
  { id: 'fr-bor', name: 'Bordeaux', countryCode: 'FR', divisionCode: 'NAQ', divisionName: 'Nouvelle-Aquitaine', population: 260000 },
  { id: 'fr-nic', name: 'Nice', countryCode: 'FR', divisionCode: 'PAC', divisionName: 'Provence-Alpes-Côte d\'Azur', population: 343000 },
  { id: 'fr-lil', name: 'Lille', countryCode: 'FR', divisionCode: 'HDF', divisionName: 'Hauts-de-France', population: 236000 },

  // India (IN)
  { id: 'in-mum', name: 'Mumbai', countryCode: 'IN', divisionCode: 'MH', divisionName: 'Maharashtra', population: 12442000 },
  { id: 'in-del', name: 'New Delhi', countryCode: 'IN', divisionCode: 'DL', divisionName: 'Delhi', population: 16787000 },
  { id: 'in-blr', name: 'Bengaluru', countryCode: 'IN', divisionCode: 'KA', divisionName: 'Karnataka', population: 8443000 },
  { id: 'in-hyd', name: 'Hyderabad', countryCode: 'IN', divisionCode: 'TG', divisionName: 'Telangana', population: 6809000 },
  { id: 'in-chn', name: 'Chennai', countryCode: 'IN', divisionCode: 'TN', divisionName: 'Tamil Nadu', population: 7088000 },
  { id: 'in-pune', name: 'Pune', countryCode: 'IN', divisionCode: 'MH', divisionName: 'Maharashtra', population: 3124000 },

  // Japan (JP)
  { id: 'jp-tok', name: 'Tokyo', countryCode: 'JP', divisionCode: 'JP-13', divisionName: 'Tokyo', population: 13960000 },
  { id: 'jp-osa', name: 'Osaka', countryCode: 'JP', divisionCode: 'JP-27', divisionName: 'Osaka', population: 2750000 },
  { id: 'jp-yok', name: 'Yokohama', countryCode: 'JP', divisionCode: 'JP-14', divisionName: 'Kanagawa', population: 3770000 },
  { id: 'jp-nag', name: 'Nagoya', countryCode: 'JP', divisionCode: 'JP-23', divisionName: 'Aichi', population: 2330000 },
  { id: 'jp-kyo', name: 'Kyoto', countryCode: 'JP', divisionCode: 'JP-26', divisionName: 'Kyoto', population: 1460000 },

  // Netherlands (NL)
  { id: 'nl-ams', name: 'Amsterdam', countryCode: 'NL', divisionCode: 'NH', divisionName: 'North Holland', population: 873000 },
  { id: 'nl-rot', name: 'Rotterdam', countryCode: 'NL', divisionCode: 'ZH', divisionName: 'South Holland', population: 651000 },
  { id: 'nl-hag', name: 'The Hague', countryCode: 'NL', divisionCode: 'ZH', divisionName: 'South Holland', population: 548000 },
  { id: 'nl-utr', name: 'Utrecht', countryCode: 'NL', divisionCode: 'UT', divisionName: 'Utrecht', population: 359000 },
  { id: 'nl-ein', name: 'Eindhoven', countryCode: 'NL', divisionCode: 'NB', divisionName: 'North Brabant', population: 235000 },

  // Switzerland (CH)
  { id: 'ch-zur', name: 'Zurich', countryCode: 'CH', divisionCode: 'ZH', divisionName: 'Zurich', population: 421000 },
  { id: 'ch-gen', name: 'Geneva', countryCode: 'CH', divisionCode: 'GE', divisionName: 'Geneva', population: 203000 },
  { id: 'ch-bas', name: 'Basel', countryCode: 'CH', divisionCode: 'BS', divisionName: 'Basel-Stadt', population: 178000 },
  { id: 'ch-ber', name: 'Bern', countryCode: 'CH', divisionCode: 'BE', divisionName: 'Bern', population: 134000 },
  { id: 'ch-zug', name: 'Zug', countryCode: 'CH', divisionCode: 'ZG', divisionName: 'Zug', population: 31000 },

  // Spain (ES)
  { id: 'es-mad', name: 'Madrid', countryCode: 'ES', divisionCode: 'MD', divisionName: 'Community of Madrid', population: 3305000 },
  { id: 'es-bcn', name: 'Barcelona', countryCode: 'ES', divisionCode: 'CT', divisionName: 'Catalonia', population: 1636000 },
  { id: 'es-val', name: 'Valencia', countryCode: 'ES', divisionCode: 'VC', divisionName: 'Valencian Community', population: 791000 },
  { id: 'es-sev', name: 'Seville', countryCode: 'ES', divisionCode: 'AN', divisionName: 'Andalusia', population: 688000 },
  { id: 'es-bil', name: 'Bilbao', countryCode: 'ES', divisionCode: 'PV', divisionName: 'Basque Country', population: 346000 },

  // Italy (IT)
  { id: 'it-rom', name: 'Rome', countryCode: 'IT', divisionCode: 'LAZ', divisionName: 'Lazio', population: 2873000 },
  { id: 'it-mil', name: 'Milan', countryCode: 'IT', divisionCode: 'LOM', divisionName: 'Lombardy', population: 1366000 },
  { id: 'it-nap', name: 'Naples', countryCode: 'IT', divisionCode: 'CAM', divisionName: 'Campania', population: 962000 },
  { id: 'it-tur', name: 'Turin', countryCode: 'IT', divisionCode: 'PIE', divisionName: 'Piedmont', population: 870000 },
  { id: 'it-flo', name: 'Florence', countryCode: 'IT', divisionCode: 'TOS', divisionName: 'Tuscany', population: 382000 },

  // Sweden (SE)
  { id: 'se-sto', name: 'Stockholm', countryCode: 'SE', divisionCode: 'AB', divisionName: 'Stockholm County', population: 975000 },
  { id: 'se-got', name: 'Gothenburg', countryCode: 'SE', divisionCode: 'O', divisionName: 'Västra Götaland County', population: 580000 },
  { id: 'se-mal', name: 'Malmö', countryCode: 'SE', divisionCode: 'M', divisionName: 'Skåne County', population: 344000 },
  { id: 'se-upp', name: 'Uppsala', countryCode: 'SE', divisionCode: 'C', divisionName: 'Uppsala County', population: 233000 },

  // Denmark (DK)
  { id: 'dk-cph', name: 'Copenhagen', countryCode: 'DK', divisionCode: 'DK-84', divisionName: 'Capital Region', population: 638000 },
  { id: 'dk-aar', name: 'Aarhus', countryCode: 'DK', divisionCode: 'DK-82', divisionName: 'Central Denmark', population: 352000 },
  { id: 'dk-ode', name: 'Odense', countryCode: 'DK', divisionCode: 'DK-83', divisionName: 'Southern Denmark', population: 180000 },
  { id: 'dk-aal', name: 'Aalborg', countryCode: 'DK', divisionCode: 'DK-81', divisionName: 'North Denmark', population: 120000 },

  // Singapore (SG)
  { id: 'sg-sin', name: 'Singapore', countryCode: 'SG', population: 5685000 },

  // United Arab Emirates (AE)
  { id: 'ae-dxb', name: 'Dubai', countryCode: 'AE', divisionCode: 'DXB', divisionName: 'Dubai', population: 3331000 },
  { id: 'ae-auh', name: 'Abu Dhabi', countryCode: 'AE', divisionCode: 'AUH', divisionName: 'Abu Dhabi', population: 1483000 },
  { id: 'ae-shj', name: 'Sharjah', countryCode: 'AE', divisionCode: 'SHJ', divisionName: 'Sharjah', population: 1274000 },

  // Hong Kong (HK)
  { id: 'hk-hkg', name: 'Hong Kong', countryCode: 'HK', population: 7413000 },

  // Ireland (IE)
  { id: 'ie-dub', name: 'Dublin', countryCode: 'IE', divisionName: 'County Dublin', population: 544000 },
  { id: 'ie-crk', name: 'Cork', countryCode: 'IE', divisionName: 'County Cork', population: 222000 },
  { id: 'ie-gal', name: 'Galway', countryCode: 'IE', divisionName: 'County Galway', population: 83000 },

  // Brazil (BR)
  { id: 'br-sao', name: 'São Paulo', countryCode: 'BR', divisionCode: 'SP', divisionName: 'São Paulo', population: 12396000 },
  { id: 'br-rio', name: 'Rio de Janeiro', countryCode: 'BR', divisionCode: 'RJ', divisionName: 'Rio de Janeiro', population: 6775000 },

  // South Africa (ZA)
  { id: 'za-jnb', name: 'Johannesburg', countryCode: 'ZA', divisionName: 'Gauteng', population: 5635000 },
  { id: 'za-cpt', name: 'Cape Town', countryCode: 'ZA', divisionName: 'Western Cape', population: 4618000 },

  // Mexico (MX)
  { id: 'mx-mex', name: 'Mexico City', countryCode: 'MX', divisionName: 'CDMX', population: 9209000 },
  { id: 'mx-gdl', name: 'Guadalajara', countryCode: 'MX', divisionName: 'Jalisco', population: 1385000 },
  { id: 'mx-mty', name: 'Monterrey', countryCode: 'MX', divisionName: 'Nuevo León', population: 1142000 },
];

export interface SearchCitiesOptions {
  countryCode?: string;
  divisionCode?: string;
  query?: string;
  limit?: number;
}

export function searchCities(options: SearchCitiesOptions = {}): CityReference[] {
  const { countryCode, divisionCode, query, limit = 20 } = options;
  const q = (query || '').toLowerCase().trim();
  const cCode = (countryCode || '').toUpperCase().trim();
  const dCode = (divisionCode || '').toUpperCase().trim();

  let filtered = MAJOR_CITIES_DATA;

  if (cCode && cCode !== 'ALL' && cCode !== 'GLOBAL') {
    filtered = filtered.filter((c) => c.countryCode.toUpperCase() === cCode);
  }

  if (dCode && dCode !== 'ALL') {
    filtered = filtered.filter((c) => c.divisionCode?.toUpperCase() === dCode);
  }

  if (q) {
    filtered = filtered.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.divisionName && c.divisionName.toLowerCase().includes(q))
    );
  }

  // Sort: prioritize exact prefix match, then population
  filtered = [...filtered].sort((a, b) => {
    if (q) {
      const aStarts = a.name.toLowerCase().startsWith(q);
      const bStarts = b.name.toLowerCase().startsWith(q);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
    }
    return (b.population || 0) - (a.population || 0);
  });

  return filtered.slice(0, limit);
}
