import React, { useState, useEffect } from 'react';
import { Globe2, MapPin, Search } from 'lucide-react';
import { CountryReference, AdministrativeDivision, CityReference } from '../types.js';
import { apiFetch } from '../utils/apiFetch.ts';

interface GeoSelectorProps {
  countryCode: string;
  region?: string;
  city?: string;
  postalCode?: string;
  street?: string;
  onChange: (geo: {
    countryCode: string;
    countryName: string;
    region?: string;
    city?: string;
    postalCode?: string;
    street?: string;
    currency?: string;
  }) => void;
  showStreetAndPostal?: boolean;
  compact?: boolean;
}

export const GeoSelector: React.FC<GeoSelectorProps> = ({
  countryCode,
  region = '',
  city = '',
  postalCode = '',
  street = '',
  onChange,
  showStreetAndPostal = true,
  compact = false,
}) => {
  const [countries, setCountries] = useState<CountryReference[]>([]);
  const [countrySearch, setCountrySearch] = useState('');
  const [divisions, setDivisions] = useState<AdministrativeDivision[]>([]);
  const [citySuggestions, setCitySuggestions] = useState<CityReference[]>([]);

  useEffect(() => {
    apiFetch('/api/geo/countries')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: CountryReference[]) => {
        if (Array.isArray(data)) setCountries(data);
      })
      .catch(() => {});
  }, []);

  const currentCountry = countries.find((c) => c.code === (countryCode || 'US').toUpperCase());

  useEffect(() => {
    const code = (countryCode || '').toUpperCase();
    if (!code || code === 'ALL' || code === 'GLOBAL') {
      setDivisions([]);
      setCitySuggestions([]);
      return;
    }

    apiFetch(`/api/geo/divisions?country=${code}`)
      .then((res) => (res.ok ? res.json() : { divisions: [] }))
      .then((data) => setDivisions(data.divisions || []))
      .catch(() => setDivisions([]));
  }, [countryCode]);

  useEffect(() => {
    const code = (countryCode || '').toUpperCase();
    if (!code || code === 'ALL' || code === 'GLOBAL') {
      setCitySuggestions([]);
      return;
    }
    const params = new URLSearchParams();
    params.set('country', code);
    if (region) {
      const matchedDiv = divisions.find(
        (d) => d.name.toLowerCase() === region.toLowerCase() || d.code.toUpperCase() === region.toUpperCase()
      );
      if (matchedDiv) params.set('division', matchedDiv.code);
    }
    if (city && city.trim()) params.set('query', city.trim());
    params.set('limit', '8');

    apiFetch(`/api/geo/cities?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : { cities: [] }))
      .then((data) => setCitySuggestions(data.cities || []))
      .catch(() => setCitySuggestions([]));
  }, [countryCode, region, city, divisions]);

  const filteredCountries = countrySearch.trim()
    ? countries.filter((c) => {
        const q = countrySearch.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q) ||
          c.alpha3.toLowerCase().includes(q) ||
          (c.nativeName && c.nativeName.toLowerCase().includes(q))
        );
      })
    : countries;

  const regionLabel = currentCountry?.addressFormat?.regionLabel || 'State / Province / Region';
  const hasRegions = currentCountry ? currentCountry.addressFormat?.hasRegions !== false : true;
  const postalLabel = currentCountry?.addressFormat?.postalCodeLabel || 'Postal Code';
  const hasPostalCodes = currentCountry ? currentCountry.addressFormat?.hasPostalCodes !== false : true;

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1 flex items-center justify-between">
            <span>Country / Jurisdiction (ISO 3166)</span>
            {currentCountry && (
              <span className="font-mono text-[10px] text-slate-500">
                {currentCountry.code} / {currentCountry.alpha3} • {currentCountry.currency}
              </span>
            )}
          </label>
          <div className="space-y-1">
            {countries.length > 20 && (
              <div className="relative">
                <input
                  type="text"
                  value={countrySearch}
                  onChange={(e) => setCountrySearch(e.target.value)}
                  placeholder="Filter 210 jurisdictions..."
                  className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-[11px] rounded px-2.5 py-1 pl-7 focus:outline-none focus:border-indigo-500"
                />
                <Search className="w-3 h-3 text-slate-500 absolute left-2 top-1.5" />
              </div>
            )}
            <select
              value={countryCode}
              onChange={(e) => {
                const nextCode = e.target.value;
                const nextObj = countries.find((c) => c.code === nextCode);
                onChange({
                  countryCode: nextCode,
                  countryName: nextObj?.name || nextCode,
                  region: '',
                  city: '',
                  postalCode: '',
                  street,
                  currency: nextObj?.currency,
                });
              }}
              className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
            >
              {filteredCountries.length === 0 && (
                <option value={countryCode}>{countryCode}</option>
              )}
              {filteredCountries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>
        </div>

        {hasRegions && (
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              {regionLabel}
            </label>
            {divisions.length > 0 ? (
              <select
                value={region}
                onChange={(e) =>
                  onChange({
                    countryCode,
                    countryName: currentCountry?.name || countryCode,
                    region: e.target.value,
                    city,
                    postalCode,
                    street,
                    currency: currentCountry?.currency,
                  })
                }
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
              >
                <option value="">Select {regionLabel}...</option>
                {divisions.map((d) => (
                  <option key={d.code} value={d.name}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={region}
                onChange={(e) =>
                  onChange({
                    countryCode,
                    countryName: currentCountry?.name || countryCode,
                    region: e.target.value,
                    city,
                    postalCode,
                    street,
                    currency: currentCountry?.currency,
                  })
                }
                placeholder={`Enter ${regionLabel.toLowerCase()} (optional)`}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
              />
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">
            City / Locality
          </label>
          <input
            type="text"
            value={city}
            onChange={(e) =>
              onChange({
                countryCode,
                countryName: currentCountry?.name || countryCode,
                region,
                city: e.target.value,
                postalCode,
                street,
                currency: currentCountry?.currency,
              })
            }
            placeholder="Start typing city..."
            className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
          />
          {citySuggestions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {citySuggestions.slice(0, 5).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() =>
                    onChange({
                      countryCode,
                      countryName: currentCountry?.name || countryCode,
                      region: c.divisionName || region,
                      city: c.name,
                      postalCode,
                      street,
                      currency: currentCountry?.currency,
                    })
                  }
                  className="px-1.5 py-0.5 text-[10px] bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded transition"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {showStreetAndPostal && hasPostalCodes && (
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              {postalLabel}
              {currentCountry?.addressFormat?.postalCodeExample && (
                <span className="text-slate-500 font-mono ml-1">
                  (e.g. {currentCountry.addressFormat.postalCodeExample})
                </span>
              )}
            </label>
            <input
              type="text"
              value={postalCode}
              onChange={(e) =>
                onChange({
                  countryCode,
                  countryName: currentCountry?.name || countryCode,
                  region,
                  city,
                  postalCode: e.target.value,
                  street,
                  currency: currentCountry?.currency,
                })
              }
              placeholder={currentCountry?.addressFormat?.postalCodeExample || 'Postal code'}
              className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded px-2.5 py-1.5 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>
        )}
      </div>

      {showStreetAndPostal && (
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">
            Street / Suite / Building Address
          </label>
          <input
            type="text"
            value={street}
            onChange={(e) =>
              onChange({
                countryCode,
                countryName: currentCountry?.name || countryCode,
                region,
                city,
                postalCode,
                street: e.target.value,
                currency: currentCountry?.currency,
              })
            }
            placeholder="Street address, floor, or registered office..."
            className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
          />
        </div>
      )}
    </div>
  );
};
