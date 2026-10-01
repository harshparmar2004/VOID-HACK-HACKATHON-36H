import React from "react";
import { FileText, Copy, Printer, CheckCircle } from "lucide-react";

export default function CaseDiaryView({ diaryData, victimAccount }) {
  const diaryText = diaryData?.case_diary || "Loading Case Diary...";

  const handleCopy = () => {
    navigator.clipboard.writeText(diaryText);
    alert("Case Diary copied to clipboard!");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-serif font-bold text-[#2C2623]">
            Police Case Diary (Investigation Chronology)
          </h2>
          <p className="text-xs text-[#746D65] mt-1">
            Section 172 Cr.P.C. / Section 192 BNSS record for submission to the Judicial Magistrate.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white border border-[#E8E2D5] text-[#2C2623] text-xs font-semibold hover:bg-[#F8F4EC] transition-colors shadow-2xs"
          >
            <Copy className="w-3.5 h-3.5 text-[#746D65]" />
            <span>Copy Text</span>
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-semibold shadow-sm transition-all"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Case Diary</span>
          </button>
        </div>
      </div>

      {/* Diary Card */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-6 shadow-sm font-mono text-xs text-[#2C2623] leading-relaxed whitespace-pre-wrap bg-[#FCFAF5]">
        {diaryText}
      </div>
    </div>
  );
}
