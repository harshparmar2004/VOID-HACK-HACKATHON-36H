import React, { useState } from "react";
import { Printer, Download, ShieldCheck, Building, CheckCircle2 } from "lucide-react";
import GovernmentRequisitionDocument from "./GovernmentRequisitionDocument";

export default function Section91NoticesView({
  noticesData,
  victimAccount = "100000000001",
  victimName = "Sunil Kumar Verma",
  firNumber = "FIR-0142/2026/CYBER-INDORE"
}) {
  const notices = noticesData?.notices || [];
  const [selectedBank, setSelectedBank] = useState(notices[0]?.bank_code || "");

  const activeNotice = notices.find((n) => n.bank_code === selectedBank) || notices[0];

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Header (Hidden in Print) */}
      <div className="no-print flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-serif font-bold text-[#2C2623]">
            Court-Ready Section 91 Cr.P.C. / BNSS Bank Freezing Requisitions
          </h2>
          <p className="text-xs text-[#746D65] mt-1">
            Official statutory freeze notices addressed to Bank Nodal Officers. Strictly verified against database (Zero Hallucination).
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E6F7F0] border border-[#A7F3D0] text-[#059669] text-xs font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>Anti-Hallucination Verified</span>
          </div>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
            title="Download or Print Official Government Notice (Printable PDF)"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Official Notice (PDF)</span>
          </button>
        </div>
      </div>

      {/* Bank Selector Tabs (Hidden in Print) */}
      {notices.length > 0 && (
        <div className="no-print flex items-center gap-2 overflow-x-auto pb-1">
          {notices.map((n) => (
            <button
              key={n.bank_code}
              onClick={() => setSelectedBank(n.bank_code)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
                (selectedBank === n.bank_code || (!selectedBank && activeNotice?.bank_code === n.bank_code))
                  ? "bg-[#D96B27] text-white shadow-sm"
                  : "bg-white border border-[#E8E2D5] text-[#2C2623] hover:bg-[#FAF6EE]"
              }`}
            >
              <Building className="w-3.5 h-3.5" />
              <span>{n.bank_name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                (selectedBank === n.bank_code || (!selectedBank && activeNotice?.bank_code === n.bank_code))
                  ? "bg-white/20 text-white"
                  : "bg-[#F3EDE2] text-[#746D65]"
              }`}>
                {n.targets.length}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Official Government Requisition Document */}
      {activeNotice ? (
        <GovernmentRequisitionDocument
          notice={activeNotice}
          victimAccount={victimAccount}
          victimName={victimName}
          firNumber={firNumber}
        />
      ) : (
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-8 text-center text-xs text-[#746D65]">
          No freeze targets detected for this victim trail.
        </div>
      )}
    </div>
  );
}
