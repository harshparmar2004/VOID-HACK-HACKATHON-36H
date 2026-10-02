import React, { useState } from "react";
import { Shield, CheckCircle, Scale, Building, QrCode, Lock, Check } from "lucide-react";

export default function GovernmentRequisitionDocument({
  notice,
  singleTxn = null,
  victimAccount = "100000000001",
  victimName = "Sunil Kumar Verma",
  firNumber = "FIR-0142/2026/CYBER-INDORE"
}) {
  const [isProportionalLien, setIsProportionalLien] = useState(true);

  // If a single transaction is passed (from the Scanner view), format it to match notice schema
  const targets = singleTxn ? [{
    account_number: singleTxn.Receiver_Account || "200000000002",
    ifsc: singleTxn.Receiver_IFSC || "UTIB0000971",
    bank_name: singleTxn.receiver_bank || (singleTxn.Receiver_IFSC ? singleTxn.Receiver_IFSC.substring(0, 4) : "BANK"),
    role: singleTxn.receiver_role || singleTxn.hop_stage || "L1_COLLECTOR",
    lien_amount_inr: Number(singleTxn.Amount_INR || 0),
    disputed_txn_ids: [singleTxn.Transaction_ID],
    timestamp: singleTxn.txn_timestamp || singleTxn.Timestamp || "2026-10-02 11:30:00"
  }] : (notice?.targets || []);

  const totalAmount = singleTxn
    ? Number(singleTxn.Amount_INR || 0)
    : Number(notice?.total_freeze_amount || 0);

  const bankName = singleTxn
    ? (singleTxn.Receiver_IFSC ? `${singleTxn.Receiver_IFSC.substring(0, 4)} Bank` : "Target Bank")
    : (notice?.bank_name || "Commercial Bank of India");

  const noticeRefNo = singleTxn
    ? `PS/CCC/MP/2026/SEC91/${singleTxn.Transaction_ID}`
    : (notice?.notice_id || `PS/CCC/MP/2026/SEC91/${firNumber.replace(/\//g, "-")}`);

  const currentDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });

  return (
    <div className="government-requisition-doc relative bg-white border-4 border-double border-[#1E293B] p-6 sm:p-8 text-[#0F172A] shadow-lg font-sans max-w-5xl mx-auto my-2 select-text">
      {/* Background Watermark of Scales of Justice */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-[0.035] overflow-hidden">
        <svg viewBox="0 0 24 24" className="w-[450px] h-[450px] fill-current text-black">
          <path d="M12 2a1 1 0 0 1 1 1v2.07A8.005 8.005 0 0 1 20 13a1 1 0 1 1-2 0 6 6 0 0 0-5-5.917V20h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3V7.083A6 6 0 0 0 6 13a1 1 0 1 1-2 0 8.005 8.005 0 0 1 7-7.93V3a1 1 0 0 1 1-1z" />
        </svg>
      </div>

      {/* Decorative Outer Border Corner Flourishes */}
      <div className="relative border border-[#475569] p-5 sm:p-6 bg-white/95">
        {/* Corner Brackets */}
        <div className="absolute top-1 left-1 w-4 h-4 border-t-2 border-l-2 border-[#1E293B]" />
        <div className="absolute top-1 right-1 w-4 h-4 border-t-2 border-r-2 border-[#1E293B]" />
        <div className="absolute bottom-1 left-1 w-4 h-4 border-b-2 border-l-2 border-[#1E293B]" />
        <div className="absolute bottom-1 right-1 w-4 h-4 border-b-2 border-r-2 border-[#1E293B]" />

        {/* 1. Header with Scales of Justice & Police Crest */}
        <div className="relative flex items-center justify-between border-b border-[#334155] pb-4 mb-4">
          <div className="w-16 h-16 hidden sm:flex items-center justify-center">
            {/* National/Scales emblem emblem placeholder */}
            <div className="w-14 h-14 rounded-full border border-[#64748B] flex flex-col items-center justify-center p-1 text-[8px] font-bold text-center leading-tight">
              <span className="font-serif">सत्यमेव</span>
              <span className="font-serif">जयते</span>
              <div className="w-6 h-[1px] bg-[#64748B] my-0.5" />
              <span className="text-[7px] text-[#475569]">GOVT OF INDIA</span>
            </div>
          </div>

          <div className="flex-1 text-center px-2">
            {/* Top Center Icon: Scales of Justice */}
            <div className="flex justify-center mb-1">
              <div className="w-8 h-8 rounded-full bg-[#F1F5F9] border border-[#CBD5E1] flex items-center justify-center text-[#1E293B]">
                <Scale className="w-5 h-5" />
              </div>
            </div>

            <h1 className="text-base sm:text-lg font-serif font-black tracking-wider uppercase text-[#0F172A] leading-snug">
              URGENT REQUISITION NOTICE REGARDING BANK ACCOUNT FREEZING / LIEN
            </h1>

            {/* Dual Statutory Headings */}
            <div className="flex flex-col sm:flex-row items-center justify-between text-center gap-1 sm:gap-6 mt-2 pt-2 border-t border-dashed border-[#CBD5E1] text-[10px] sm:text-[11px] text-[#334155]">
              <div className="flex-1">
                <span className="font-bold text-[#0F172A]">Issued under SECTION 91 Cr.P.C. / SECTION 94 BNSS</span>
                <p className="text-[9px] text-[#64748B] italic">for production of documents and protection/warning</p>
              </div>
              <div className="hidden sm:block w-[1px] h-6 bg-[#CBD5E1]" />
              <div className="flex-1">
                <span className="font-bold text-[#0F172A]">under SECTION 102 Cr.P.C. / SECTION 106 BNSS</span>
                <p className="text-[9px] text-[#64748B] italic">for freezing of accounts</p>
              </div>
            </div>
          </div>

          {/* Top Right Police Crime Badge Crest */}
          <div className="w-16 h-16 flex items-center justify-center">
            <div className="w-14 h-16 bg-[#0F172A] text-white rounded-t-lg rounded-b-2xl border-2 border-[#D97706] flex flex-col items-center justify-center p-1 shadow-xs">
              <span className="text-[6px] tracking-widest font-black text-[#FDE68A] uppercase">POLICE CRIME</span>
              <Shield className="w-5 h-5 text-[#FDE68A] my-0.5" />
              <span className="text-[6px] tracking-widest font-black text-white uppercase">INDORE</span>
            </div>
          </div>
        </div>

        {/* 2. Notice Metadata Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-[#1E293B] border-b border-[#E2E8F0] pb-3 mb-4">
          <div className="space-y-1">
            <div>
              <span className="font-bold text-[#0F172A]">Notice Ref No: </span>
              <span className="font-mono font-semibold">{noticeRefNo}</span>
            </div>
            <div>
              <span className="font-bold text-[#0F172A]">Police Station: </span>
              <span>Cyber Crime Police Station, Indore Commissionerate, MP</span>
            </div>
            <div>
              <span className="font-bold text-[#0F172A]">FIR Details: </span>
              <span className="font-mono font-semibold">{firNumber} U/S 420/120B BNS & 66D IT Act</span>
            </div>
          </div>

          <div className="space-y-1 sm:text-right">
            <div>
              <span className="font-bold text-[#0F172A]">Date of Issuance: </span>
              <span className="font-mono font-semibold">{currentDate}</span>
            </div>
            <div>
              <span className="font-bold text-[#0F172A]">Complainant / Victim: </span>
              <span>{victimName} (Acc: <span className="font-mono">{victimAccount}</span>)</span>
            </div>
            <div>
              <span className="font-bold text-[#0F172A]">Addressed Bank: </span>
              <span className="font-bold text-[#1E293B]">{bankName} (Liaison Desk)</span>
            </div>
          </div>
        </div>

        {/* 3. Itemized Transaction Table */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <h2 className="text-xs font-bold font-serif uppercase tracking-wider text-[#0F172A]">
              Itemized Transaction & Target Beneficiary Table
            </h2>
            <span className="text-[10px] text-[#64748B] font-mono">
              Total Targets: {targets.length} Account(s)
            </span>
          </div>

          <div className="border border-[#334155] rounded-xs overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F1F5F9] border-b border-[#334155] text-[10px] font-bold uppercase text-[#1E293B]">
                  <th className="py-1.5 px-3 border-r border-[#CBD5E1]">UTR / Txn ID</th>
                  <th className="py-1.5 px-3 border-r border-[#CBD5E1]">Date & Time</th>
                  <th className="py-1.5 px-3 border-r border-[#CBD5E1]">Beneficiary / Target Account</th>
                  <th className="py-1.5 px-3 border-r border-[#CBD5E1]">IFSC & Bank</th>
                  <th className="py-1.5 px-3 text-right">Disputed Lien Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] font-mono text-[11px]">
                {targets.map((tgt, i) => (
                  <tr key={i} className="hover:bg-[#F8FAFC]">
                    <td className="py-1.5 px-3 border-r border-[#E2E8F0] font-bold text-[#0F172A]">
                      {tgt.disputed_txn_ids?.[0] || `TXN${100000000 + i}`}
                    </td>
                    <td className="py-1.5 px-3 border-r border-[#E2E8F0] text-[#475569]">
                      {tgt.timestamp || currentDate}
                    </td>
                    <td className="py-1.5 px-3 border-r border-[#E2E8F0] font-bold text-[#1E293B]">
                      {tgt.account_number}
                      <span className="ml-1 text-[9px] font-sans font-semibold text-[#D97706] bg-[#FEF3C7] px-1 py-0.2 rounded">
                        {tgt.role || "L1_MULE"}
                      </span>
                    </td>
                    <td className="py-1.5 px-3 border-r border-[#E2E8F0] text-[#334155]">
                      {tgt.ifsc || "BANK0001000"}
                    </td>
                    <td className="py-1.5 px-3 text-right font-bold text-[#059669]">
                      INR {Number(tgt.lien_amount_inr || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#F8FAFC] border-t-2 border-[#334155] font-bold text-xs">
                  <td colSpan={4} className="py-2 px-3 text-right text-[#0F172A] uppercase">
                    Grand Total Mandate:
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-sm text-[#059669]">
                    INR {totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 4. Proportional Lien Hold Option & Policy Warning */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-sm text-xs">
          {/* Proportional Lien Toggle */}
          <div className="flex items-start gap-2.5">
            <button
              type="button"
              onClick={() => setIsProportionalLien(!isProportionalLien)}
              className="mt-0.5 relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out bg-[#059669]"
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  isProportionalLien ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
            <div>
              <div className="font-bold text-[#0F172A] flex items-center gap-1.5">
                <span>Proportional Lien Hold</span>
                <span className="text-[10px] text-[#059669] bg-[#E6F7F0] px-1.5 py-0.2 rounded font-mono font-bold">
                  ACTIVE
                </span>
              </div>
              <p className="text-[11px] text-[#475569] mt-0.5 leading-snug">
                <b>Proportional Lien Hold:</b> A restricted <b>ONLY</b> amount while leaving non-disputed funds accessible.
              </p>
            </div>
          </div>

          {/* Statutory Warning Box */}
          <div className="text-[10.5px] leading-snug text-[#991B1B] bg-[#FEF2F2] p-2 border-l-2 border-[#DC2626]">
            <b>Statutory Warning:</b> Non-compliance with this requisition constitutes penal liability under 
            <b> Section 175 IPC / Section 210 BNS</b> and <b>Section 223 BNS</b>. 
            Non-compliance is warrantable and subject to criminal penal liability as per Section 223 BNS.
          </div>
        </div>

        {/* 5. Footer Signatures, Verification & Stamp Boxes */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-[#334155] items-end text-xs">
          {/* 1: Officer Signature Details */}
          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase text-[#475569]">Officer Signature details</div>
            <div className="h-10 border border-[#94A3B8] bg-[#F8FAFC] flex items-center justify-center font-serif italic text-xs text-[#334155]">
              [ Officer Signature ]
            </div>
            <div className="flex justify-between text-[10px] text-[#64748B]">
              <span>Insp. R. K. Sharma</span>
              <span>{currentDate}</span>
            </div>
          </div>

          {/* 2: QR Code Verification */}
          <div className="flex flex-col items-center justify-center text-center p-1 bg-[#F8FAFC] border border-[#CBD5E1]">
            <div className="w-12 h-12 bg-white border border-[#CBD5E1] flex items-center justify-center p-0.5 mb-1">
              <QrCode className="w-10 h-10 text-[#0F172A]" />
            </div>
            <span className="text-[9px] font-bold text-[#1E293B]">QR Code Verification</span>
            <span className="text-[8px] font-mono text-[#64748B]">SHA256: 7F89E8B2</span>
          </div>

          {/* 3: Police Station Seal Box */}
          <div className="h-20 border-2 border-dashed border-[#94A3B8] flex flex-col items-center justify-center p-1 text-center bg-[#F8FAFC]">
            <span className="text-[9px] font-bold text-[#0F172A] uppercase">Police Station</span>
            <span className="text-[9px] font-bold text-[#D97706] uppercase">Seal Box</span>
            <span className="text-[7.5px] text-[#64748B] mt-0.5">Indore Commissionerate</span>
          </div>

          {/* 4: e-Sign Digital Signature */}
          <div className="text-right space-y-1">
            <div className="text-[9px] text-[#64748B] font-mono border-b border-[#E2E8F0] pb-0.5">
              Signated Procedure
            </div>
            <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-[#E6F7F0] border border-[#A7F3D0] rounded text-[#059669]">
              <CheckCircle className="w-3.5 h-3.5 shrink-0" />
              <div className="text-left leading-none">
                <div className="text-[10px] font-black tracking-wide">e-Sign</div>
                <div className="text-[7px] text-[#047857]">Digital Signature Verified</div>
              </div>
            </div>
            <div className="text-[9px] font-mono text-[#64748B]">
              Date: {currentDate}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
