import React, { useState } from 'react';
import {
  Layers,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Settings,
  Key,
  Save,
  Globe2,
  Bot,
  RefreshCw,
} from 'lucide-react';
import { ConnectorStatus, AppSettings } from '../types.js';

interface ConnectorsViewProps {
  connectors: ConnectorStatus[];
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  onRefreshConnectors: () => void;
  onOpenMatrix?: () => void;
}

export const ConnectorsView: React.FC<ConnectorsViewProps> = ({
  connectors,
  settings,
  onUpdateSettings,
  onRefreshConnectors,
  onOpenMatrix,
}) => {
  const [activeTab, setActiveTab] = useState<'connectors' | 'settings'>('connectors');
  const [ownerName, setOwnerName] = useState(settings.ownerName);
  const [ownerEmail, setOwnerEmail] = useState(settings.ownerEmail);
  const [defaultCountry, setDefaultCountry] = useState(settings.defaultCountry || 'GB');
  const [defaultCurrency, setDefaultCurrency] = useState(settings.defaultCurrency || 'USD');
  const [companiesHouseApiKey, setCompaniesHouseApiKey] = useState(settings.companiesHouseApiKey || '');
  const [userAgent, setUserAgent] = useState(settings.userAgent);
  const [approvalRequired, setApprovalRequired] = useState(settings.outreachApprovalRequired);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSettings({
      ownerName,
      ownerEmail,
      defaultCountry,
      defaultCurrency,
      companiesHouseApiKey: companiesHouseApiKey.trim() || undefined,
      userAgent,
      outreachApprovalRequired: approvalRequired,
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            Connector Framework, Observability & Credential Hub
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time status, rate limit compliance, legal attribution, and owner configuration.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenMatrix}
            className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-blue-950/60 hover:bg-blue-900/70 border border-blue-800/80 rounded-lg text-xs text-blue-300 transition cursor-pointer"
          >
            <Globe2 className="w-4 h-4 text-blue-400" />
            <span>195 Sovereign States Matrix</span>
          </button>

          <button
            onClick={() => setActiveTab('connectors')}
            className={`px-3 py-1.5 text-xs font-semibold rounded transition ${
              activeTab === 'connectors'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            Connectors Health ({connectors.length})
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`px-3 py-1.5 text-xs font-semibold rounded transition flex items-center gap-1.5 ${
              activeTab === 'settings'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Owner Settings</span>
          </button>
        </div>
      </div>

      {savedSuccess && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-800 rounded-lg text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>Application and connector settings saved successfully.</span>
        </div>
      )}

      {/* Connectors Health Tab */}
      {activeTab === 'connectors' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {connectors.map((c) => (
            <div
              key={c.id}
              className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-sm hover:border-slate-700 transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white">{c.name}</h3>
                  <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                    <span className="capitalize">{c.category.replace('_', ' ')}</span>
                    <span>•</span>
                    <span>Coverage: {c.countryCoverage.join(', ')}</span>
                  </div>
                </div>

                <span
                  className={`px-2 py-0.5 text-[10px] font-bold rounded flex items-center gap-1 ${
                    c.status === 'healthy'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  {c.status.toUpperCase()}
                </span>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-xs space-y-1.5">
                <div className="flex items-center justify-between text-slate-300">
                  <span className="text-slate-500">Authentication:</span>
                  <span className="font-mono text-cyan-400">
                    {c.authType === 'none_open'
                      ? '100% Free Open API (No key needed)'
                      : c.authType === 'api_key'
                      ? 'Owner API Key'
                      : 'Environment Managed'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-slate-300">
                  <span className="text-slate-500">Total Invocations:</span>
                  <span className="font-mono font-bold text-white">{c.totalCalls} calls</span>
                </div>

                {c.lastRunAt && (
                  <div className="flex items-center justify-between text-slate-400 text-[11px]">
                    <span className="text-slate-500">Last Executed:</span>
                    <span>{new Date(c.lastRunAt).toLocaleTimeString()}</span>
                  </div>
                )}
              </div>

              <div className="space-y-1 text-[11px] text-slate-400">
                <div>
                  <span className="text-slate-500 font-medium">Rate Limits: </span>
                  {c.rateLimitNote}
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Attribution: </span>
                  <span className="text-slate-300">{c.attribution}</span>
                </div>
              </div>

              {c.lastError && (
                <div className="p-2 bg-rose-950/30 border border-rose-800/40 rounded text-rose-300 text-[11px]">
                  {c.lastError}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Owner Settings Tab */}
      {activeTab === 'settings' && (
        <form onSubmit={handleSaveSettings} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 max-w-2xl">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Settings className="w-4 h-4 text-indigo-400" />
            Single-Owner Application Settings
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Owner Name / Organization</label>
              <input
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2 focus:outline-none focus:border-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Owner Email</label>
              <input
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2 focus:outline-none focus:border-indigo-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Default Discovery Jurisdiction (ISO Alpha-2)</label>
              <select
                value={defaultCountry}
                onChange={(e) => setDefaultCountry(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2 focus:outline-none focus:border-indigo-500"
              >
                <option value="GB">🇬🇧 United Kingdom (GB)</option>
                <option value="NO">🇳🇴 Norway (NO)</option>
                <option value="AU">🇦🇺 Australia (AU)</option>
                <option value="US">🇺🇸 United States (US)</option>
                <option value="DE">🇩🇪 Germany (DE)</option>
                <option value="FR">🇫🇷 France (FR)</option>
                <option value="CA">🇨🇦 Canada (CA)</option>
                <option value="JP">🇯🇵 Japan (JP)</option>
                <option value="IN">🇮🇳 India (IN)</option>
                <option value="SG">🇸🇬 Singapore (SG)</option>
                <option value="AE">🇦🇪 United Arab Emirates (AE)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Default Pipeline Currency (ISO 4217)</label>
              <select
                value={defaultCurrency}
                onChange={(e) => setDefaultCurrency(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2 focus:outline-none focus:border-indigo-500"
              >
                <option value="USD">USD — US Dollar ($)</option>
                <option value="GBP">GBP — British Pound (£)</option>
                <option value="EUR">EUR — Euro (€)</option>
                <option value="NOK">NOK — Norwegian Krone (kr)</option>
                <option value="AUD">AUD — Australian Dollar ($)</option>
                <option value="CAD">CAD — Canadian Dollar ($)</option>
                <option value="CHF">CHF — Swiss Franc</option>
                <option value="JPY">JPY — Japanese Yen (¥)</option>
                <option value="INR">INR — Indian Rupee (₹)</option>
                <option value="SGD">SGD — Singapore Dollar ($)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              UK Companies House Developer API Key (Optional)
            </label>
            <input
              type="password"
              value={companiesHouseApiKey}
              onChange={(e) => setCompaniesHouseApiKey(e.target.value)}
              placeholder="e.g. 5a1b2c3d-..."
              className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2 focus:outline-none focus:border-indigo-500 font-mono"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              If left blank, the application uses verified official register mirrors. Free API keys can be generated at developer.company-information.service.gov.uk.
            </p>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Compliant HTTP User-Agent</label>
            <input
              type="text"
              value={userAgent}
              onChange={(e) => setUserAgent(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2 focus:outline-none focus:border-indigo-500 font-mono"
              required
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Used when querying OpenStreetMap Nominatim and web metadata to satisfy official open-data usage terms.
            </p>
          </div>

          <div className="pt-2 border-t border-slate-800 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-200">
              <input
                type="checkbox"
                checked={approvalRequired}
                onChange={(e) => setApprovalRequired(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0"
              />
              <span className="font-semibold">Enforce Human Approval before Outbound Messages</span>
            </label>
            <p className="text-[11px] text-slate-500 pl-5">
              Strict safeguard: Prevents automated background email dispatch without explicit owner sign-off.
            </p>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded flex items-center gap-1.5 transition"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Configuration</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
