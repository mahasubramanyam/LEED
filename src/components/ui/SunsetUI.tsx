import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, MoreHorizontal, X } from 'lucide-react';

/**
 * Shared Midnight Teal & Burnished Gold UI Primitives
 * Reusable, zero-pill, accessible building blocks for LEED workspaces.
 */

export interface WorkspaceToolbarProps {
  title?: string;
  meta?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export const WorkspaceToolbar: React.FC<WorkspaceToolbarProps> = ({
  title,
  meta,
  children,
  actions,
  className = '',
}) => (
  <div
    className={`flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-[#3A4D50] ${className}`}
  >
    <div className="flex flex-wrap items-center gap-3 min-w-0">
      {title && (
        <h2 className="text-xl font-bold text-slate-950 dark:text-[#F2F6F5] tracking-tight truncate">
          {title}
        </h2>
      )}
      {meta && (
        <span className="text-xs font-medium text-slate-600 dark:text-[#B8C7C4] truncate">
          {meta}
        </span>
      )}
      {children}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

export interface SurfaceCardProps {
  children: React.ReactNode;
  className?: string;
  highlighted?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const SurfaceCard: React.FC<SurfaceCardProps> = ({
  children,
  className = '',
  highlighted = false,
  padding = 'md',
}) => {
  const padMap = {
    none: '',
    sm: 'p-4',
    md: 'p-5',
    lg: 'p-6',
  };
  return (
    <div
      className={`rounded-xl border transition-colors ${
        highlighted
          ? 'bg-slate-100/90 dark:bg-[#243638] border-[#C49A52]/65 dark:border-[#C49A52]/55'
          : 'bg-white dark:bg-[#192629] border-slate-200 dark:border-[#3A4D50]'
      } ${padMap[padding]} ${className}`}
    >
      {children}
    </div>
  );
};

export interface KpiMetricProps {
  label: string;
  value: string | number;
  detail?: string;
  tone?: 'default' | 'teal' | 'amber' | 'danger' | 'burgundy';
  onClick?: () => void;
}

export const KpiMetric: React.FC<KpiMetricProps> = ({
  label,
  value,
  detail,
  tone = 'default',
  onClick,
}) => {
  const valueTone = {
    default: 'text-slate-950 dark:text-[#F2F6F5]',
    teal: 'text-[#25464F] dark:text-[#86BCC9]',
    amber: 'text-[#7A5924] dark:text-[#DFB76D]',
    danger: 'text-[#8F3438] dark:text-[#E58E92]',
    burgundy: 'text-[#59444C] dark:text-[#C8B2BA]',
  }[tone];

  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`w-full text-left rounded-xl border border-slate-200 dark:border-[#3A4D50] bg-white dark:bg-[#192629] px-5 py-4 transition-colors ${
        onClick ? 'hover:border-[#C49A52] dark:hover:bg-[#243638] cursor-pointer' : ''
      }`}
    >
      <div className="text-xs font-semibold text-slate-600 dark:text-[#B8C7C4] tracking-wide">
        {label}
      </div>
      <div className={`mt-1.5 text-2xl font-extrabold tabular-nums tracking-tight truncate ${valueTone}`}>
        {value}
      </div>
      {detail && (
        <div className="mt-1 text-xs font-medium text-slate-600 dark:text-[#B8C7C4] truncate tabular-nums">
          {detail}
        </div>
      )}
    </Tag>
  );
};

export interface SegmentedTabItem<T extends string = string> {
  id: T;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

export function SegmentedTabs<T extends string>({
  items,
  activeId,
  onChange,
  variant = 'underline',
}: {
  items: SegmentedTabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  variant?: 'underline' | 'segmented';
}) {
  if (variant === 'segmented') {
    return (
      <div className="inline-flex items-center rounded-lg border border-slate-300 dark:border-[#3E5256] bg-slate-100/90 dark:bg-[#0B1113] p-0.5 overflow-x-auto scrollbar-none">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-[#335C67] text-white font-bold'
                  : 'text-slate-700 dark:text-[#B8C7C4] font-semibold hover:text-slate-950 dark:hover:text-[#F2F6F5]'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
              {typeof item.count === 'number' && item.count > 0 && (
                <span
                  className={`tabular-nums text-[11px] font-bold ${
                    active ? 'text-[#EFE4CC]' : 'text-slate-600 dark:text-[#B8C7C4]'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 border-b border-slate-200 dark:border-[#3A4D50] overflow-x-auto scrollbar-none">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              active
                ? 'border-[#C49A52] text-[#25464F] dark:text-[#DFB76D] font-bold'
                : 'border-transparent text-slate-600 dark:text-[#B8C7C4] font-semibold hover:text-slate-950 dark:hover:text-[#F2F6F5]'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
            {typeof item.count === 'number' && item.count > 0 && (
              <span className="tabular-nums text-xs font-semibold text-slate-500 dark:text-[#B8C7C4]">
                ({item.count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface ActionMenuItem {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
}

export const ActionMenu: React.FC<{
  label?: string;
  items: ActionMenuItem[];
  align?: 'left' | 'right';
  iconOnly?: boolean;
}> = ({ label = 'More', items, align = 'right', iconOnly = false }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-[#3E5256] bg-white dark:bg-[#192629] text-slate-800 dark:text-[#F0F4F3] hover:bg-slate-50 dark:hover:bg-[#243638] transition-colors whitespace-nowrap shrink-0"
      >
        {iconOnly ? (
          <MoreHorizontal className="w-4 h-4" />
        ) : (
          <>
            <span>{label}</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 dark:text-[#B8C7C4]" />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute ${
            align === 'right' ? 'right-0' : 'left-0'
          } top-full mt-1.5 min-w-[180px] rounded-xl border border-slate-300 dark:border-[#3E5256] bg-white dark:bg-[#243638] shadow-xl py-1 z-50`}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className={`w-full px-3.5 py-2 text-left text-xs font-medium flex items-center gap-2 transition-colors disabled:opacity-60 ${
                item.destructive
                  ? 'text-[#8F3438] dark:text-[#E58E92] hover:bg-[#F9EFEF] dark:hover:bg-[#8F3438]/25'
                  : 'text-slate-800 dark:text-[#F0F4F3] hover:bg-slate-100 dark:hover:bg-[#335C67]/35'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const NoticeBanner: React.FC<{
  tone: 'success' | 'warning' | 'error' | 'info';
  message: string;
  onDismiss?: () => void;
}> = ({ tone, message, onDismiss }) => {
  const styles = {
    success:
      'bg-[#EDF4F2] dark:bg-[#192629] border-[#335C67]/50 dark:border-[#4D7F8E] text-[#14282D] dark:text-[#F0F4F3]',
    warning:
      'bg-[#F8F3E8] dark:bg-[#243638] border-[#C49A52]/70 dark:border-[#C49A52]/70 text-[#523C1A] dark:text-[#E8CB92]',
    error:
      'bg-[#F9EFEF] dark:bg-[#280D0F]/90 border-[#8F3438]/60 dark:border-[#A64448] text-[#662226] dark:text-[#F0C9CB]',
    info: 'bg-slate-100 dark:bg-[#192629] border-slate-300 dark:border-[#3E5256] text-slate-900 dark:text-[#F0F4F3]',
  }[tone];

  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border text-xs font-medium ${styles}`}>
      <span>{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="p-0.5 opacity-80 hover:opacity-100 shrink-0"
          aria-label="Dismiss notice"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export const EmptyState: React.FC<{
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ title, description, action }) => (
  <div className="rounded-xl border border-dashed border-slate-300 dark:border-[#3E5256] bg-white/80 dark:bg-[#192629]/80 px-6 py-10 text-center">
    <h3 className="text-base font-bold text-slate-950 dark:text-[#F2F6F5]">{title}</h3>
    {description && (
      <p className="mt-1 text-xs font-medium text-slate-600 dark:text-[#B8C7C4] max-w-md mx-auto">
        {description}
      </p>
    )}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
);
