import React from "react";
import { Shield, ShieldCheck, Download, MessageSquare, RefreshCw, FileText, Settings } from "lucide-react";

export default function Header({
  activeCase,
  cases,
  onSelectCase,
  totalSiphoned,
  onExportPdf,
  onOpenAssistant,
  onOpenSettings,
  activeTab,
  systemStatus,
  victimName = "Sunil Kumar Verma",
  firNumber = "FIR-0142/2026/CYBER-INDORE",
  onOpenRegisterModal
}) {
  return (
    <header className="w-full bg-[#FBF7EE] border-b border-[#E8E2D5] px-6 py-3 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-50">
      {/* Brand & Edition */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-[#D96B27] flex items-center justify-center text-white font-bold text-lg shadow-sm">
          CF
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-base text-[#2C2623] tracking-tight">
              Cyber Fraud Correlator
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#F3EDE2] text-[#746D65] border border-[#E8E2D5]">
              POLICE IO EDITION
            </span>
          </div>
          <p className="text-xs text-[#9E968D]">Operation Abhedya-Chakra • Indore Police Commissionerate</p>
        </div>
      </div>

      {/* Case Selector & Pills */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#F5EDE1] border border-[#E4DBD0] text-xs">
          <span className="font-medium text-[#746D65]">Active Case:</span>
          <span className="font-mono font-bold text-[#2C2623]">{firNumber}</span>
          <span className="text-[#9E968D]">|</span>
          <span className="font-medium text-[#2C2623]">{victimName}</span>
          <span className="px-2 py-0.5 rounded bg-[#FEE2E2] text-[#DC2626] font-bold text-[11px]">
            ₹{totalSiphoned ? totalSiphoned.toLocaleString('en-IN') : "14,78,894"}
          </span>
        </div>

        <button
          onClick={onOpenRegisterModal}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FAF6EE] hover:bg-[#F3EDE2] border border-[#D96B27] text-[#D96B27] text-xs font-bold transition-colors cursor-pointer"
        >
          <span>+ New Victim Complaint</span>
        </button>

        <select
          value={activeCase}
          onChange={(e) => onSelectCase(e.target.value)}
          className="bg-white border border-[#E8E2D5] rounded-lg px-3 py-1.5 text-xs font-medium text-[#2C2623] focus:outline-none focus:border-[#D96B27] shadow-2xs cursor-pointer"
        >
          {cases.map((c, idx) => (
            <option key={c} value={c}>
              Case #{idx + 1} (Acc: ...{c.slice(-4)})
            </option>
          ))}
        </select>

        {/* Vault Verified Badge */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E6F7F0] border border-[#A7F3D0] text-[#059669] text-xs font-semibold">
          <ShieldCheck className="w-4 h-4 text-[#059669]" />
          <span>Vault Verified</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={onOpenSettings}
          title="Configure LLM & JEV API Keys"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#E8E2D5] text-[#2C2623] text-xs font-medium hover:bg-[#F8F4EC] transition-colors shadow-2xs cursor-pointer"
        >
          <Settings className="w-3.5 h-3.5 text-[#746D65]" />
          <span>Settings</span>
        </button>

        <button
          onClick={onOpenAssistant}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white border border-[#E8E2D5] text-[#2C2623] text-xs font-medium hover:bg-[#F8F4EC] transition-colors shadow-2xs cursor-pointer"
        >
          <MessageSquare className="w-3.5 h-3.5 text-[#746D65]" />
          <span>Ask Assistant</span>
        </button>

        <button
          onClick={onExportPdf}
          className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-semibold transition-all shadow-sm cursor-pointer"
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Export Section 91 Notices (PDF)</span>
        </button>
      </div>
    </header>
  );
}
