import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, MoreHorizontal, X } from 'lucide-react';

/**
 * Shared Dark Sunset UI Primitives
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
    className={`flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800 ${className}`}
  >
    <div className="flex flex-wrap items-center gap-3 min-w-0">
      {title && (
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50 tracking-tight truncate">
          {title}
        </h2>
      )}
      {meta && (
        <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
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
          ? 'bg-[#FFF9D8] dark:bg-[#232A24] border-[#E09F3E]/50'
          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
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
    default: 'text-slate-900 dark:text-slate-50',
    teal: 'text-[#335C67] dark:text-[#8AB0BA]',
    amber: 'text-[#956219] dark:text-[#E09F3E]',
    danger: 'text-[#9E2A2B] dark:text-[#E09D9E]',
    burgundy: 'text-[#540B0E] dark:text-[#FFF3B0]',
  }[tone];

  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`w-full text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-4 transition-colors ${
        onClick ? 'hover:border-[#E09F3E] cursor-pointer' : ''
      }`}
    >
      <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wide">
        {label}
      </div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums tracking-tight truncate ${valueTone}`}>
        {value}
      </div>
      {detail && (
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate tabular-nums">
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
      <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-950 p-0.5 overflow-x-auto scrollbar-none">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-[#335C67] text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
              {typeof item.count === 'number' && item.count > 0 && (
                <span
                  className={`tabular-nums text-[11px] ${
                    active ? 'text-[#FFF3B0]' : 'text-slate-400'
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
    <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800 overflow-x-auto scrollbar-none">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              active
                ? 'border-[#E09F3E] text-[#540B0E] dark:text-[#FFF3B0]'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
            {typeof item.count === 'number' && item.count > 0 && (
              <span className="tabular-nums text-xs text-slate-400 dark:text-slate-500">
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
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
      >
        {iconOnly ? (
          <MoreHorizontal className="w-4 h-4" />
        ) : (
          <>
            <span>{label}</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute ${
            align === 'right' ? 'right-0' : 'left-0'
          } top-full mt-1.5 min-w-[180px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1 z-50`}
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
              className={`w-full px-3.5 py-2 text-left text-xs font-medium flex items-center gap-2 transition-colors disabled:opacity-40 ${
                item.destructive
                  ? 'text-[#9E2A2B] dark:text-[#E09D9E] hover:bg-[#FDF3F3] dark:hover:bg-[#540B0E]/30'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-[#FFF9D8]/70 dark:hover:bg-slate-800'
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
      'bg-[#EFF5F4] dark:bg-[#162E2A]/60 border-[#335C67]/30 text-[#1F3940] dark:text-[#B0CFC9]',
    warning:
      'bg-[#FFF9D8] dark:bg-[#332008]/60 border-[#E09F3E]/50 text-[#540B0E] dark:text-[#FFF3B0]',
    error:
      'bg-[#FDF3F3] dark:bg-[#540B0E]/40 border-[#9E2A2B]/40 text-[#540B0E] dark:text-[#F9E3E3]',
    info: 'bg-slate-100/80 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200',
  }[tone];

  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border text-xs ${styles}`}>
      <span>{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="p-0.5 opacity-70 hover:opacity-100 shrink-0"
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
  <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white/60 dark:bg-slate-900/50 px-6 py-10 text-center">
    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
    {description && (
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
        {description}
      </p>
    )}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
);
