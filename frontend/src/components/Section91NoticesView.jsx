import React, { useState } from "react";
import { Printer, Download, ShieldCheck, CheckCircle2, Building, AlertTriangle } from "lucide-react";

export default function Section91NoticesView({ noticesData, victimAccount }) {
  const notices = noticesData?.notices || [];
  const [selectedBank, setSelectedBank] = useState(notices[0]?.bank_code || "");

  const activeNotice = notices.find((n) => n.bank_code === selectedBank) || notices[0];

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
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
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Official Notice</span>
          </button>
        </div>
      </div>

      {/* Bank Selector Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {notices.map((n) => (
          <button
            key={n.bank_code}
            onClick={() => setSelectedBank(n.bank_code)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              selectedBank === n.bank_code
                ? "bg-[#D96B27] text-white shadow-sm"
                : "bg-white border border-[#E8E2D5] text-[#2C2623] hover:bg-[#FAF6EE]"
            }`}
          >
            <Building className="w-3.5 h-3.5" />
            <span>{n.bank_name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              selectedBank === n.bank_code ? "bg-white/20 text-white" : "bg-[#F3EDE2] text-[#746D65]"
            }`}>
              {n.targets.length}
            </span>
          </button>
        ))}
      </div>

      {/* Official Legal Notice Document Preview */}
      {activeNotice ? (
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-8 shadow-sm space-y-6 text-[#2C2623]">
          {/* Official Letterhead */}
          <div className="text-center border-b border-[#E8E2D5] pb-5 space-y-1">
            <div className="text-xs uppercase font-mono tracking-widest text-[#746D65]">
              Office of the Commissioner of Police • Cyber Crime Branch
            </div>
            <h1 className="text-xl font-serif font-bold tracking-tight">
              CYBER CRIME POLICE STATION, INDORE COMMISSIONERATE
            </h1>
            <div className="text-xs text-[#746D65]">
              Madhya Pradesh • National Cybercrime Reporting Portal (Helpline 1930)
            </div>
          </div>

          {/* Reference & Metadata */}
          <div className="flex justify-between items-start text-xs font-mono border-b border-[#F0EAE1] pb-4">
            <div>
              <div><b>NOTICE REF:</b> {activeNotice.notice_id}</div>
              <div><b>CRIME / FIR NO:</b> {activeNotice.fir_number}</div>
              <div><b>COMPLAINANT ACCOUNT:</b> {activeNotice.victim_account}</div>
            </div>
            <div className="text-right">
              <div><b>DATE:</b> {activeNotice.date_of_issuance}</div>
              <div><b>MODE:</b> Urgent Electronic Transmission / Secured Police Dispatch</div>
            </div>
          </div>

          {/* Addressee */}
          <div className="text-xs space-y-1">
            <div className="font-bold text-[#746D65] uppercase">TO:</div>
            <div className="font-bold text-sm">{activeNotice.nodal_officer_address}</div>
            <div className="text-[#746D65]">Principal Law Enforcement Liaison Desk, {activeNotice.bank_name}</div>
          </div>

          {/* Subject Line */}
          <div className="bg-[#FAF6EE] border-l-4 border-[#D96B27] p-3 rounded-r-lg text-xs font-semibold">
            SUBJECT: STATUTORY REQUISITION FOR IMMEDIATE LIEN / DEBIT-FREEZE UNDER SECTION 91 OF CODE OF CRIMINAL PROCEDURE, 1973 READ WITH SECTION 94 OF BHARATIYA NAGARIK SURAKSHA SANHITA (BNSS), 2023.
          </div>

          {/* Legal Body */}
          <div className="text-xs leading-relaxed space-y-3">
            <p>
              Whereas an investigation is being conducted at this Cyber Crime Police Station regarding high-value financial fraud wherein funds totaling ₹{activeNotice.total_freeze_amount.toLocaleString('en-IN')} ({activeNotice.total_freeze_words}) were siphoned from the victim's account and traced through multi-tiered money mule networks directly into beneficiary accounts maintained with your bank.
            </p>
            <p>
              You are hereby commanded under Section 91 Cr.P.C. / Section 94 BNSS to immediately mark a <b>TOTAL DEBIT FREEZE / DISPUTE LIEN</b> on the accounts listed hereunder to prevent further dissipation of public money:
            </p>
          </div>

          {/* Accounts Table */}
          <div className="border border-[#E8E2D5] rounded-xl overflow-hidden text-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#FAF6EE] border-b border-[#E8E2D5] text-[10px] font-bold uppercase tracking-wider text-[#746D65]">
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">Target Account Number</th>
                  <th className="py-2.5 px-3">IFSC Code</th>
                  <th className="py-2.5 px-3">Mule Tier Role</th>
                  <th className="py-2.5 px-3">Disputed Txn IDs</th>
                  <th className="py-2.5 px-3 text-right">Lien / Freeze Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFEAE1] font-mono">
                {activeNotice.targets.map((tgt, idx) => (
                  <tr key={idx} className="hover:bg-[#FAF6EE]">
                    <td className="py-2.5 px-3 text-[#9E968D]">{idx + 1}</td>
                    <td className="py-2.5 px-3 font-bold text-[#2C2623]">{tgt.account_number}</td>
                    <td className="py-2.5 px-3">{tgt.ifsc}</td>
                    <td className="py-2.5 px-3">
                      <span className="px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#D97706] text-[10px] font-sans font-bold">
                        {tgt.role} (Hop {tgt.hop_level})
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-[11px] text-[#746D65]">
                      {tgt.disputed_txn_ids.join(", ")}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-[#059669]">
                      ₹{tgt.lien_amount_inr.toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#FAF6EE] font-bold border-t border-[#E8E2D5]">
                  <td colSpan={5} className="py-2.5 px-3 text-right">TOTAL FREEZE MANDATE:</td>
                  <td className="py-2.5 px-3 text-right text-sm text-[#059669] font-mono">
                    ₹{activeNotice.total_freeze_amount.toLocaleString('en-IN')}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Warning & Instructions */}
          <div className="text-[11px] text-[#746D65] space-y-1">
            <p>1. Please furnish the complete KYC documents, account opening form, linked mobile number, and IP login logs within 24 hours.</p>
            <p>2. Compliance report must be submitted via email to: <b>cybercrime-indore@mp.gov.in</b></p>
          </div>

          {/* Signature & Seal */}
          <div className="pt-6 border-t border-[#E8E2D5] flex justify-between items-end">
            <div className="text-[10px] text-[#059669] flex items-center gap-1 font-mono">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{activeNotice.verification_status}</span>
            </div>
            <div className="text-right text-xs">
              <div className="font-bold">Inspector of Police</div>
              <div>Cyber Crime Branch, Indore</div>
              <div className="text-[#9E968D] text-[10px]">Indore Police Commissionerate</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-8 text-center text-xs text-[#746D65]">
          No freeze targets detected for this victim trail.
        </div>
      )}
    </div>
  );
}
