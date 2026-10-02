import React from "react";
import { AlertTriangle, FileText, Loader2, RefreshCw } from "lucide-react";
import { inr, num } from "../format";

export default function Header({
  activeCase,
  victims,
  onSelectCase,
  trace,
  status,
  caseInfo,
  onRetry,
  onOpenNotices,
  onOpenRegisterModal
}) {
  const paid = trace?.data?.total_siphoned_inr;
  const offline = Boolean(status.error || victims.error);
  // The selected account may come from a search and not be in the victim list.
  const options = activeCase && !victims.accounts.includes(activeCase) ? [activeCase, ...victims.accounts] : victims.accounts;

  return (
    <header className="w-full bg-[#FBF7EE] border-b border-[#E8E2D5] px-6 py-3 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-50">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-[#D96B27] flex items-center justify-center text-white font-bold text-lg shadow-sm">
          CF
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-base text-[#2C2623] tracking-tight">Cyber Fraud Correlator</span>
            <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#F3EDE2] text-[#746D65] border border-[#E8E2D5]">
              POLICE IO EDITION
            </span>
          </div>
          <p className="text-xs text-[#9E968D]">Operation Abhedya-Chakra</p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#F5EDE1] border border-[#E4DBD0] text-xs">
          <span className="font-medium text-[#746D65]">Selected victim:</span>
          <span className="font-mono font-bold text-[#2C2623]">{activeCase || "none"}</span>
          {caseInfo?.firNumber && (
            <>
              <span className="text-[#9E968D]">|</span>
              <span className="font-mono text-[#2C2623]">{caseInfo.firNumber}</span>
            </>
          )}
          {caseInfo?.complainant && (
            <>
              <span className="text-[#9E968D]">|</span>
              <span className="font-medium text-[#2C2623]">{caseInfo.complainant}</span>
            </>
          )}
          {trace?.loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D96B27]" />
          ) : paid != null ? (
            <span className="px-2 py-0.5 rounded bg-[#FEE2E2] text-[#DC2626] font-bold text-[11px]" title="Amount the victim paid (from the trace)">
              {inr(paid)}
            </span>
          ) : null}
        </div>

        <select
          value={activeCase || ""}
          onChange={(e) => onSelectCase(e.target.value)}
          disabled={victims.loading || options.length === 0}
          className="bg-white border border-[#E8E2D5] rounded-lg px-3 py-1.5 text-xs font-mono font-medium text-[#2C2623] focus:outline-none focus:border-[#D96B27] shadow-2xs cursor-pointer disabled:opacity-60"
        >
          {options.length === 0 && (
            <option value="">{victims.loading ? "Loading victims..." : "No victims available"}</option>
          )}
          {options.map((account) => (
            <option key={account} value={account}>
              {account}
            </option>
          ))}
        </select>

        <button
          onClick={onOpenRegisterModal}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FAF6EE] hover:bg-[#F3EDE2] border border-[#D96B27] text-[#D96B27] text-xs font-bold transition-colors cursor-pointer"
        >
          <span>+ Open case by account</span>
        </button>

        {offline ? (
          <button
            onClick={onRetry}
            title={status.error || victims.error}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-xs font-semibold cursor-pointer"
          >
            <AlertTriangle className="w-4 h-4" />
            <span>API not reachable</span>
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        ) : status.loading ? (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#E8E2D5] text-[#746D65] text-xs">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Connecting...</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E6F7F0] border border-[#A7F3D0] text-[#059669] text-xs font-semibold font-mono">
            <span>{num(status.data?.records_loaded)} transactions</span>
            <span className="text-[#6EE7B7]">|</span>
            <span>{num(status.data?.victims)} victims</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <button
          onClick={onOpenNotices}
          className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-semibold transition-all shadow-sm cursor-pointer"
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Section 91 Notices</span>
        </button>
      </div>
    </header>
  );
}
