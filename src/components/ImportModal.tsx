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
    <div className="fixed inset-0 z-50 bg-[#240202]/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#440303] border border-[#E4DADA] dark:border-[#7A1E1E] rounded-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="px-6 py-4 border-b border-[#7A1E1E] bg-gradient-to-r from-[#440303] via-[#690303] to-[#910303] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/15 border border-white/20 text-white flex items-center justify-center">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-white tracking-tight">
                Lead &amp; Decision-Maker Import Engine (CSV / Excel .xlsx)
              </h2>
              <p className="text-[11px] font-medium text-[#F5DADA]">
                Dry-run validation, multi-column merge, CRM deduplication &amp; explicit confirmation
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close import modal"
            className="p-1.5 rounded-lg text-[#F5DADA] hover:text-white hover:bg-white/15 transition-colors"
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
