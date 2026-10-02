import React from "react";
import { AlertTriangle, Clock, Inbox, Loader2, RefreshCw } from "lucide-react";

// Shared page pieces: what a view shows while loading, when empty, on error,
// and for features that are not built yet. None of them carries sample data.

export const LATER = "Available in a later step";

export function LoadingState({ label = "Loading..." }) {
  return (
    <div className="bg-white border border-[#E8E2D5] rounded-md p-8 flex items-center justify-center gap-2.5 text-xs text-[#746D65] shadow-2xs">
      <Loader2 className="w-4 h-4 animate-spin text-[#D96B27]" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title = "Nothing to show", hint }) {
  return (
    <div className="bg-white border border-dashed border-[#D4CEBF] rounded-md p-8 text-center shadow-2xs">
      <Inbox className="w-6 h-6 text-[#9E968D] mx-auto" />
      <p className="text-sm font-semibold text-[#2C2623] mt-2">{title}</p>
      {hint && <p className="text-xs text-[#746D65] mt-1 max-w-xl mx-auto">{hint}</p>}
    </div>
  );
}

export function ErrorState({ title = "Could not load this data", message, onRetry }) {
  return (
    <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-md p-6 text-center shadow-2xs">
      <AlertTriangle className="w-6 h-6 text-[#DC2626] mx-auto" />
      <p className="text-sm font-semibold text-[#991B1B] mt-2">{title}</p>
      {message && <p className="text-xs font-mono text-[#B91C1C] mt-1 break-words">{message}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-white border border-[#FECACA] text-[#991B1B] text-xs font-semibold hover:bg-[#FEE2E2] cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Try again</span>
        </button>
      )}
    </div>
  );
}

// A feature the API does not serve yet. Says so plainly; shows nothing invented.
export function LaterStep({ title, children }) {
  return (
    <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-md p-4 flex items-start gap-3 shadow-2xs">
      <Clock className="w-4 h-4 text-[#B45309] mt-0.5 shrink-0" />
      <div>
        <p className="text-xs font-bold text-[#92400E]">
          {title ? `${title}: ` : ""}
          {LATER}
        </p>
        {children && <p className="text-xs text-[#92400E] mt-0.5">{children}</p>}
      </div>
    </div>
  );
}

// A disabled action button for a deferred feature.
export function LaterButton({ icon: Icon, children }) {
  return (
    <button
      type="button"
      disabled
      title={LATER}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#F3EDE2] border border-[#E8E2D5] text-[#9E968D] text-xs font-semibold cursor-not-allowed"
    >
      {Icon && <Icon className="w-3.5 h-3.5" />}
      <span>{children}</span>
    </button>
  );
}

export function PageHeader({ eyebrow, title, subtitle, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E8E2D5] pb-4">
      <div>
        {eyebrow && (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-xs bg-[#D96B27]"></span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">{eyebrow}</span>
          </div>
        )}
        <h2 className="text-xl sm:text-2xl font-serif font-bold text-[#2C2623] mt-0.5 tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-[#746D65] mt-0.5 max-w-3xl">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

const TONES = {
  default: "text-[#2C2623]",
  red: "text-[#DC2626]",
  green: "text-[#059669]",
  orange: "text-[#D96B27]",
  purple: "text-[#7C3AED]"
};

export function Stat({ label, value, hint, tone = "default" }) {
  return (
    <div className="bg-white border border-[#E8E2D5] rounded-md p-3.5 shadow-2xs min-w-0">
      <span className="text-[10px] font-bold uppercase tracking-wider text-[#746D65] font-mono block truncate">
        {label}
      </span>
      <div className={`text-lg font-bold font-mono tracking-tight my-0.5 truncate ${TONES[tone] || TONES.default}`}>
        {value}
      </div>
      {hint && <p className="text-[11px] text-[#746D65] truncate">{hint}</p>}
    </div>
  );
}
