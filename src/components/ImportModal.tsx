import React from 'react';
import { X, FileSpreadsheet } from 'lucide-react';
import { CanonicalLead } from '../types.ts';
import { ImportWizard } from './ImportWizard.tsx';

interface ImportModalProps {
  onClose: () => void;
  onImportComplete: (leads?: CanonicalLead[]) => void;
  existingLeads: CanonicalLead[];
}

export const ImportModal: React.FC<ImportModalProps> = ({
  onClose,
  onImportComplete,
  existingLeads,
}) => {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/15 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Lead &amp; Decision-Maker Import Engine (CSV / Excel .xlsx)
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Dry-run validation, multi-column merge, CRM deduplication &amp; explicit confirmation
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <ImportWizard
            existingLeads={existingLeads}
            onImportComplete={() => onImportComplete()}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
};
