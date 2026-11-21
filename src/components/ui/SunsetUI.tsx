import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, MoreHorizontal, X } from 'lucide-react';

/**
 * Shared Red & Maroon Enterprise UI Primitives
 * Balanced light-canvas contrast, distinctive architectural banners,
 * crisp neutral cards paired with selected dark-red spotlight cards.
 */

export interface FeatureBannerHighlight {
  label: string;
  value: string | number;
  sub?: string;
}

export interface FeatureBannerProps {
  eyebrow?: string;
  title: string;
  description: string;
  tone?: 'crimson' | 'maroon' | 'blood';
  highlights?: FeatureBannerHighlight[];
  actions?: React.ReactNode;
  className?: string;
}

export const FeatureBanner: React.FC<FeatureBannerProps> = ({
  eyebrow,
  title,
  description,
  tone = 'maroon',
  highlights,
  actions,
  className = '',
}) => {
  const bgClass = {
    maroon: 'bg-gradient-to-r from-[#440303] via-[#690303] to-[#910303]',
    blood: 'bg-gradient-to-r from-[#690303] via-[#910303] to-[#B30303]',
    crimson: 'bg-gradient-to-r from-[#690303] via-[#910303] to-[#B30303]',
  }[tone];

  return (
    <section
      className={`relative overflow-hidden rounded-2xl ${bgClass} text-white px-6 py-6 sm:px-8 sm:py-7 shadow-[0_12px_30px_-12px_rgba(68,3,3,0.45)] ring-1 ring-inset ring-white/15 ${className}`}
    >
      {/* Architectural Layered Depth Accents (subtle geometric lines + warm Candy Apple radial depth) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-[#CE0404]/30 blur-2xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-8 -bottom-24 h-56 w-56 rounded-full border border-white/12"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-24 -bottom-16 h-40 w-40 rounded-full border border-white/10"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
      />

      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div className="min-w-0 max-w-2xl space-y-2">
          {eyebrow && (
            <div className="inline-flex items-center gap-2 text-xs font-bold tracking-wide text-[#FFE2E1]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#E52825] shrink-0" aria-hidden="true" />
              <span>{eyebrow}</span>
            </div>
          )}
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight leading-snug">
            {title}
          </h2>
          <p className="text-sm font-medium text-[#FAF0F0] leading-relaxed">
            {description}
          </p>
          {actions && (
            <div className="pt-2 flex flex-wrap items-center gap-2.5">
              {actions}
            </div>
          )}
        </div>

        {highlights && highlights.length > 0 && (
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap lg:flex-nowrap items-stretch gap-3 shrink-0">
            {highlights.map((item) => (
              <div
                key={item.label}
                className="min-w-[132px] rounded-xl bg-[#240202]/45 border border-white/15 px-4 py-3 backdrop-blur-xs"
              >
                <div className="text-[11px] font-semibold text-[#F5DADA] truncate">
                  {item.label}
                </div>
                <div className="mt-1 text-xl font-extrabold text-white tabular-nums tracking-tight truncate">
                  {item.value}
                </div>
                {item.sub && (
                  <div className="mt-0.5 text-[11px] font-medium text-[#EBD0D0] truncate">
                    {item.sub}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

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
    className={`flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#E4DADA] dark:border-[#7A1E1E] ${className}`}
  >
    <div className="flex flex-wrap items-center gap-3 min-w-0">
      {title && (
        <h2 className="text-xl font-bold text-[#440303] dark:text-[#FAF4F4] tracking-tight truncate">
          {title}
        </h2>
      )}
      {meta && (
        <span className="text-xs font-semibold text-[#543F3F] dark:text-[#E6D2D2] truncate">
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
  variant?: 'default' | 'subtle' | 'featured';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const SurfaceCard: React.FC<SurfaceCardProps> = ({
  children,
  className = '',
  highlighted = false,
  variant,
  padding = 'md',
}) => {
  const padMap = {
    none: '',
    sm: 'p-4',
    md: 'p-5',
    lg: 'p-6',
  };
  const resolvedVariant = variant ?? (highlighted ? 'subtle' : 'default');
  const surfaceStyles = {
    default:
      'bg-white dark:bg-[#440303] border-[#E4DADA] dark:border-[#7A1E1E] shadow-[0_1px_3px_rgba(36,2,2,0.05)]',
    subtle:
      'bg-[#FBF7F7] dark:bg-[#690303] border-[#D8C2C2] dark:border-[#CE0404]/70 shadow-[0_1px_2px_rgba(36,2,2,0.04)]',
    featured:
      'bg-gradient-to-br from-[#440303] via-[#590303] to-[#690303] border-[#910303]/80 text-white shadow-[0_10px_24px_-12px_rgba(68,3,3,0.45)]',
  }[resolvedVariant];

  return (
    <div className={`rounded-xl border transition-colors ${surfaceStyles} ${padMap[padding]} ${className}`}>
      {children}
    </div>
  );
};

export interface KpiMetricProps {
  label: string;
  value: string | number;
  detail?: string;
  tone?: 'default' | 'teal' | 'amber' | 'danger' | 'burgundy';
  variant?: 'neutral' | 'maroon' | 'crimson';
  onClick?: () => void;
}

export const KpiMetric: React.FC<KpiMetricProps> = ({
  label,
  value,
  detail,
  tone = 'default',
  variant = 'neutral',
  onClick,
}) => {
  const isFeatured = variant === 'maroon' || variant === 'crimson';

  const valueTone = isFeatured
    ? 'text-white'
    : {
        default: 'text-[#240202] dark:text-[#FAF4F4]',
        teal: 'text-[#167C4D] dark:text-[#6EE7B7]',
        amber: 'text-[#B45309] dark:text-[#FCD34D]',
        danger: 'text-[#CE0404] dark:text-[#FF8A87]',
        burgundy: 'text-[#910303] dark:text-[#FF9492]',
      }[tone];

  const cardSurface =
    variant === 'maroon'
      ? 'bg-gradient-to-br from-[#440303] via-[#690303] to-[#7D0303] border-[#910303] text-white shadow-[0_8px_22px_-10px_rgba(68,3,3,0.45)]'
      : variant === 'crimson'
      ? 'bg-gradient-to-br from-[#910303] via-[#A30303] to-[#B30303] border-[#CE0404]/70 text-white shadow-[0_8px_22px_-10px_rgba(179,3,3,0.42)]'
      : 'bg-white dark:bg-[#440303] border-[#E4DADA] dark:border-[#7A1E1E] shadow-[0_1px_3px_rgba(36,2,2,0.05)]';

  const hoverStyles = onClick
    ? isFeatured
      ? 'hover:brightness-110 cursor-pointer'
      : 'hover:border-[#B30303]/60 hover:shadow-[0_4px_12px_-4px_rgba(68,3,3,0.12)] dark:hover:bg-[#690303] cursor-pointer'
    : '';

  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`relative overflow-hidden w-full text-left rounded-xl border px-5 py-4 transition-all ${cardSurface} ${hoverStyles}`}
    >
      {isFeatured && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-6 -bottom-6 h-20 w-20 rounded-full bg-white/10"
        />
      )}
      <div
        className={`relative text-xs font-semibold tracking-wide ${
          isFeatured ? 'text-[#F8E2E2]' : 'text-[#4E3737] dark:text-[#E6D2D2]'
        }`}
      >
        {label}
      </div>
      <div
        className={`relative mt-1.5 text-2xl font-extrabold tabular-nums tracking-tight truncate ${valueTone}`}
      >
        {value}
      </div>
      {detail && (
        <div
          className={`relative mt-1 text-xs font-medium truncate tabular-nums ${
            isFeatured ? 'text-[#F2D5D5]' : 'text-[#543F3F] dark:text-[#C9A7A7]'
          }`}
        >
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
      <div className="inline-flex items-center rounded-lg border border-[#D8CACA] dark:border-[#8C2828] bg-[#EFE9E9] dark:bg-[#240202] p-0.5 overflow-x-auto scrollbar-none">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-[#910303] text-white font-bold shadow-xs'
                  : 'text-[#440303] dark:text-[#E6D2D2] font-semibold hover:text-[#240202] dark:hover:text-white hover:bg-white/70 dark:hover:bg-[#690303]'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
              {typeof item.count === 'number' && item.count > 0 && (
                <span
                  className={`tabular-nums text-[11px] font-bold ${
                    active ? 'text-[#FAF4F4]' : 'text-[#5A4242] dark:text-[#C9A7A7]'
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
    <div className="flex items-center gap-1 border-b border-[#E4DADA] dark:border-[#7A1E1E] overflow-x-auto scrollbar-none">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              active
                ? 'border-[#CE0404] text-[#910303] dark:text-white font-bold'
                : 'border-transparent text-[#4E3737] dark:text-[#E6D2D2] font-semibold hover:text-[#440303] dark:hover:text-white'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
            {typeof item.count === 'number' && item.count > 0 && (
              <span
                className={`tabular-nums text-xs font-semibold ${
                  active ? 'text-[#B30303] dark:text-[#FF9492]' : 'text-[#5A4242] dark:text-[#C9A7A7]'
                }`}
              >
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
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#D4C2C2] dark:border-[#8C2828] bg-white dark:bg-[#240202] text-[#440303] dark:text-[#FAF4F4] hover:border-[#910303] hover:bg-[#FDF6F6] dark:hover:bg-[#690303] transition-colors whitespace-nowrap shrink-0"
      >
        {iconOnly ? (
          <MoreHorizontal className="w-4 h-4" />
        ) : (
          <>
            <span>{label}</span>
            <ChevronDown className="w-3.5 h-3.5 text-[#690303] dark:text-[#C9A7A7]" />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute ${
            align === 'right' ? 'right-0' : 'left-0'
          } top-full mt-1.5 min-w-[180px] rounded-xl border border-[#D8CACA] dark:border-[#8C2828] bg-white dark:bg-[#690303] shadow-xl py-1 z-50`}
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
              className={`w-full px-3.5 py-2 text-left text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-60 ${
                item.destructive
                  ? 'text-[#CE0404] dark:text-[#FF9492] hover:bg-[#FFF1F1] dark:hover:bg-[#910303]'
                  : 'text-[#240202] dark:text-[#FAF4F4] hover:bg-[#FAF4F4] dark:hover:bg-[#910303]'
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
      'bg-[#ECFDF5] dark:bg-[#0C3824] border-[#167C4D]/50 dark:border-[#1E9E63] text-[#0F4B30] dark:text-[#D1FAE5]',
    warning:
      'bg-[#FFFBEB] dark:bg-[#4A2408] border-[#D97706]/60 dark:border-[#FBBF24]/70 text-[#78350F] dark:text-[#FEF3C7]',
    error:
      'bg-[#FFF1F1] dark:bg-[#2A0303] border-[#E52825]/70 dark:border-[#E52825] text-[#910303] dark:text-[#FFE0DF]',
    info:
      'bg-[#F0F6FC] dark:bg-[#102D47] border-[#2B7CB8]/50 dark:border-[#7DD3FC]/60 text-[#143D5E] dark:text-[#DCEBFA]',
  }[tone];

  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border text-xs font-semibold ${styles}`}>
      <div className="flex items-center gap-2 min-w-0">
        {tone === 'error' && (
          <span
            aria-hidden="true"
            className="w-2 h-2 rounded-full bg-[#FA0502] shrink-0"
          />
        )}
        <span>{message}</span>
      </div>
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
  <div className="rounded-xl border border-dashed border-[#D2C0C0] dark:border-[#8C2828] bg-white dark:bg-[#440303]/85 px-6 py-10 text-center shadow-[0_1px_3px_rgba(36,2,2,0.04)]">
    <h3 className="text-base font-bold text-[#440303] dark:text-[#FAF4F4]">{title}</h3>
    {description && (
      <p className="mt-1 text-xs font-medium text-[#543F3F] dark:text-[#E6D2D2] max-w-md mx-auto">
        {description}
      </p>
    )}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
);
