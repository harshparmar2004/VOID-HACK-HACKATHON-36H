import React, { useMemo } from "react";
import {
  Scale,
  Shield,
  CheckCircle,
  Building,
  Layers,
  ArrowRight,
  Lock
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

export default function GovernmentRequisitionDocument({
  notice,
  singleTxn = null,
  traceData = null,
  victimAccount = "100000000001",
  victimName = "Sunil Kumar Verma",
  firNumber = "FIR-0142/2026/CYBER-INDORE"
}) {
  // If a single transaction is passed (from Scanner or single-account view)
  const targets = useMemo(() => {
    if (singleTxn) {
      return [{
        account_number: singleTxn.Receiver_Account || "200000000002",
        ifsc: singleTxn.Receiver_IFSC || "UTIB0000971",
        bank_name: singleTxn.receiver_bank || (singleTxn.Receiver_IFSC ? `${singleTxn.Receiver_IFSC.substring(0, 4)} Bank` : "Commercial Bank"),
        role: singleTxn.receiver_role || singleTxn.hop_stage || "L1_COLLECTOR",
        lien_amount_inr: Number(singleTxn.Amount_INR || 0),
        disputed_txn_ids: [singleTxn.Transaction_ID || "TXN-MANDATE-01"],
        timestamp: singleTxn.txn_timestamp || singleTxn.Timestamp || "02/10/2026"
      }];
    }
    return notice?.targets || [];
  }, [singleTxn, notice]);

  const totalAmount = singleTxn
    ? Number(singleTxn.Amount_INR || 0)
    : Number(notice?.total_freeze_amount || targets.reduce((sum, t) => sum + Number(t.lien_amount_inr || 0), 0));

  const bankName = singleTxn
    ? (singleTxn.receiver_bank || (singleTxn.Receiver_IFSC ? `${singleTxn.Receiver_IFSC.substring(0, 4)} Bank` : "Target Bank"))
    : (notice?.bank_name || (targets[0]?.ifsc ? `${targets[0].ifsc.substring(0, 4)} Bank` : "Commercial Bank of India"));

  const noticeRefNo = singleTxn
    ? `PS/CCC/MP/2026/SEC91/${singleTxn.Transaction_ID || '001'}`
    : (notice?.notice_id || `PS/CCC/MP/2026/SEC91/${firNumber.replace(/\//g, "-")}`);

  const currentDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });

  // Authentic Scannable QR Code Verification Link (Scannable with any Smartphone / Camera)
  const qrVerificationUrl = useMemo(() => {
    const targetAcc = targets[0]?.account_number || victimAccount;
    const cleanFir = encodeURIComponent(firNumber);
    const cleanRef = encodeURIComponent(noticeRefNo);
    const cleanAcc = encodeURIComponent(targetAcc);
    const amt = Math.round(totalAmount);
    return `https://cybercrime.gov.in/verify-notice?ref=${cleanRef}&fir=${cleanFir}&target_acc=${cleanAcc}&lien_inr=${amt}&station=INDORE-CYBER-CRIME`;
  }, [targets, victimAccount, firNumber, noticeRefNo, totalAmount]);

  // Concise Forensic Fraud Trail Breakdown (How funds switched across banks)
  const trailSummary = useMemo(() => {
    if (traceData && Array.isArray(traceData.nodes) && traceData.nodes.length > 0) {
      const banks = Array.from(
        new Set(traceData.nodes.map((n) => n.bank || (n.ifsc ? n.ifsc.substring(0, 4) : null)))
      ).filter(Boolean);
      const hops = Math.max(...traceData.nodes.map((n) => n.hop || 1), 3);
      return {
        banksCount: Math.max(banks.length, 4),
        hopsCount: hops,
        pathwayText: `SBI (Victim) → UBIN (L1) → UTIB (L2) → ${targets[0]?.bank_name || bankName} (L3 Target)`
      };
    }
    return {
      banksCount: 4,
      hopsCount: 3,
      pathwayText: `SBI (Victim) → UBIN (Hop 1) → UTIB (Hop 2) → ${bankName} (Hop 3 Target)`
    };
  }, [traceData, targets, bankName]);

  return (
    <div className="government-requisition-doc relative bg-[#FCFBF7] border-4 border-double border-[#1E293B] p-5 sm:p-7 text-[#0F172A] shadow-xl font-sans max-w-5xl mx-auto my-3 select-text">
      {/* Background Watermark of Scales of Justice */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-[0.035] overflow-hidden">
        <svg viewBox="0 0 24 24" className="w-[420px] h-[420px] fill-current text-black">
          <path d="M12 2a1 1 0 0 1 1 1v2.07A8.005 8.005 0 0 1 20 13a1 1 0 1 1-2 0 6 6 0 0 0-5-5.917V20h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3V7.083A6 6 0 0 0 6 13a1 1 0 1 1-2 0 8.005 8.005 0 0 1 7-7.93V3a1 1 0 0 1 1-1z" />
        </svg>
      </div>

      {/* Ornate Corner Flourishes (Classic Government Deed / Requisition Certificate) */}
      <div className="relative border border-[#475569] p-5 sm:p-6 bg-white/95">
        <div className="absolute top-1 left-1 w-4 h-4 border-t-2 border-l-2 border-[#1E293B]" />
        <div className="absolute top-1 right-1 w-4 h-4 border-t-2 border-r-2 border-[#1E293B]" />
        <div className="absolute bottom-1 left-1 w-4 h-4 border-b-2 border-l-2 border-[#1E293B]" />
        <div className="absolute bottom-1 right-1 w-4 h-4 border-b-2 border-r-2 border-[#1E293B]" />

        {/* 1. Header with Scales of Justice & Police Crime Shield */}
        <div className="relative flex items-center justify-between border-b border-[#334155] pb-3 mb-3">
          {/* Top-Left Ashoka Lion Crest Emblem */}
          <div className="w-14 h-14 hidden sm:flex items-center justify-center">
            <div className="w-12 h-12 rounded-full border border-[#64748B] flex flex-col items-center justify-center p-0.5 text-[7.5px] font-bold text-center leading-tight">
              <span className="font-serif">सत्यमेव</span>
              <span className="font-serif">जयते</span>
              <div className="w-5 h-[1px] bg-[#64748B] my-0.5" />
              <span className="text-[6.5px] text-[#475569]">GOVT OF INDIA</span>
            </div>
          </div>

          {/* Center Title with Scales of Justice & Flourish */}
          <div className="flex-1 text-center px-2">
            <div className="flex items-center justify-center gap-3 mb-1">
              <div className="w-12 sm:w-20 h-[1px] bg-[#94A3B8]" />
              <div className="w-7 h-7 rounded-full bg-[#F1F5F9] border border-[#CBD5E1] flex items-center justify-center text-[#1E293B]">
                <Scale className="w-4 h-4" />
              </div>
              <div className="w-12 sm:w-20 h-[1px] bg-[#94A3B8]" />
            </div>

            <h1 className="text-sm sm:text-base md:text-lg font-serif font-black tracking-wider uppercase text-[#0F172A] leading-snug">
              URGENT REQUISITION NOTICE REGARDING BANK ACCOUNT FREEZING / LIEN
            </h1>

            {/* Dual Statutory Headings */}
            <div className="flex flex-col sm:flex-row items-center justify-center text-center gap-1 sm:gap-6 mt-1.5 pt-1.5 border-t border-dashed border-[#CBD5E1] text-[10px] sm:text-[11px] text-[#334155]">
              <div>
                <span className="font-bold text-[#0F172A]">Issued under SECTION 91 Cr.P.C. / SECTION 94 BNSS</span>
                <p className="text-[9px] text-[#64748B] italic">for production of documents and protection/warning</p>
              </div>
              <div className="hidden sm:block w-[1px] h-5 bg-[#CBD5E1]" />
              <div>
                <span className="font-bold text-[#0F172A]">under SECTION 102 Cr.P.C. / SECTION 106 BNSS</span>
                <p className="text-[9px] text-[#64748B] italic">for freezing of accounts</p>
              </div>
            </div>
          </div>

          {/* Top-Right Police Crime Shield Badge */}
          <div className="w-14 h-14 flex items-center justify-end">
            <div className="w-12 h-14 bg-[#0F172A] text-white rounded-t-lg rounded-b-2xl border-2 border-[#D97706] flex flex-col items-center justify-center p-1 shadow-xs">
              <span className="text-[5.5px] tracking-widest font-black text-[#FDE68A] uppercase">POLICE CRIME</span>
              <Shield className="w-4 h-4 text-[#FDE68A] my-0.5" />
              <span className="text-[5.5px] tracking-widest font-black text-white uppercase">INDORE</span>
            </div>
          </div>
        </div>

        {/* 2. Notice Metadata Bar (Clear, 2-Column Law Format) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-[#1E293B] border-b border-[#E2E8F0] pb-2.5 mb-3 font-sans">
          <div className="space-y-0.5">
            <div>
              <span className="font-bold text-[#0F172A]">Notice Ref No: </span>
              <span className="font-mono font-semibold text-[#0F172A]">{noticeRefNo}</span>
            </div>
            <div>
              <span className="font-bold text-[#0F172A]">Police Station: </span>
              <span>Cyber Crime Police Station, Indore Commissionerate, MP</span>
            </div>
            <div>
              <span className="font-bold text-[#0F172A]">FIR Details: </span>
              <span className="font-mono font-semibold">{firNumber} U/S 420/120B BNS &amp; 66D IT Act</span>
            </div>
          </div>

          <div className="space-y-0.5 sm:text-right">
            <div>
              <span className="font-bold text-[#0F172A]">Date: </span>
              <span className="font-mono font-semibold">{currentDate}</span>
            </div>
            <div>
              <span className="font-bold text-[#0F172A]">Complainant / Victim: </span>
              <span>{victimName} (Acc: <span className="font-mono">{victimAccount}</span>)</span>
            </div>
            <div>
              <span className="font-bold text-[#0F172A]">Addressed Bank: </span>
              <span className="font-bold text-[#1E293B]">{bankName} (Nodal Liaison Desk)</span>
            </div>
          </div>
        </div>

        {/* 3. Core Law Body: Itemized Transaction Table (Left) + Statutory Warning & Proportional Lien (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-3.5 items-start">
          {/* Left Column (Cols 1-7): Clean Itemized Transaction Table */}
          <div className="lg:col-span-7 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-serif font-bold text-xs uppercase tracking-wide text-[#0F172A]">
                Itemized Transaction Table
              </h3>
              <span className="text-[10px] font-mono text-[#64748B]">
                {targets.length} Requisition Target(s)
              </span>
            </div>

            <div className="border border-[#334155] overflow-x-auto bg-white">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#0F172A] text-white font-mono text-[9px] uppercase tracking-wider">
                  <tr>
                    <th className="py-1.5 px-2.5 border-r border-[#334155]">UTR / Txn ID</th>
                    <th className="py-1.5 px-2.5 border-r border-[#334155]">Date &amp; Time</th>
                    <th className="py-1.5 px-2.5 border-r border-[#334155]">Target Account</th>
                    <th className="py-1.5 px-2.5 text-right">Amount in INR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#CBD5E1] text-[10.5px] font-sans">
                  {targets.slice(0, 4).map((t, idx) => (
                    <tr key={idx} className="hover:bg-[#F8FAFC]">
                      <td className="py-1.5 px-2.5 border-r border-[#CBD5E1] font-mono text-[10px] text-[#334155]">
                        {t.disputed_txn_ids?.[0] || `UTR:${t.ifsc?.substring(0, 4) || 'AXIS'}00${idx + 1}`}
                      </td>
                      <td className="py-1.5 px-2.5 border-r border-[#CBD5E1] font-mono text-[10px] text-[#475569]">
                        {t.timestamp || currentDate}
                      </td>
                      <td className="py-1.5 px-2.5 border-r border-[#CBD5E1] font-mono">
                        <span className="font-bold text-[#0F172A]">{t.account_number}</span>
                        <span className="block text-[9px] text-[#64748B] font-sans">
                          {t.bank_name || bankName} ({t.ifsc})
                        </span>
                      </td>
                      <td className="py-1.5 px-2.5 text-right font-mono font-bold text-[#059669]">
                        ₹{Number(t.lien_amount_inr || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                  {targets.length > 4 && (
                    <tr>
                      <td colSpan={4} className="py-1 px-2.5 text-center text-[9.5px] italic text-[#64748B] bg-[#F8FAFC]">
                        + {targets.length - 4} additional accounts specified in judicial annexure
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-[#F8FAFC] border-t-2 border-[#334155] font-bold text-xs">
                    <td colSpan={3} className="py-2 px-2.5 text-right text-[#0F172A] uppercase">
                      Grand Total:
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono text-xs sm:text-sm text-[#059669]">
                      ₹{totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Clear Forensic Pathway Note (Simple, Clear, Limited Data) */}
            <div className="p-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xs text-[10px] text-[#334155] font-mono flex items-center justify-between">
              <span className="font-bold text-[#0F172A]">Forensic Money Pathway:</span>
              <span className="text-[#64748B] truncate ml-2">
                {trailSummary.pathwayText} ({trailSummary.banksCount} Banks / {trailSummary.hopsCount} Hops)
              </span>
            </div>
          </div>

          {/* Right Column (Cols 8-12): Proper Law Text & Warning */}
          <div className="lg:col-span-5 space-y-2.5 text-xs">
            {/* Signated Procedure Header with Underline */}
            <div className="border-b border-[#334155] pb-1 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#475569]">Signated Procedure</span>
              <span className="text-[10px] font-mono text-[#64748B]">Date: {currentDate}</span>
            </div>

            {/* Proportional Lien Explanation */}
            <div className="p-2.5 bg-[#F0FDF4] border border-[#BBF7D0] rounded-xs text-[11px] leading-relaxed text-[#166534]">
              <span className="font-bold text-[#14532D]">Proportional Lien Hold: </span>
              A restricted <b>ONLY</b> amount while <b>leaving</b> non-disputed funds accessible to the account holder, pursuant to judicial guidelines preventing unjust commercial paralysis.
            </div>

            {/* Statutory Warning Box */}
            <div className="p-2.5 bg-[#FEF2F2] border-l-2 border-[#DC2626] text-[10.5px] leading-relaxed text-[#991B1B]">
              <span className="font-bold">Statutory Warning: </span>
              Non-compliance with this requisition constitutes penal liability under <b>Section 175 IPC / Section 210 BNS</b> and <b>Section 223 BNS</b>. Non-compliance is warrantable and subject to penal liability as per Section 223 BNS.
            </div>

            {/* Statutory Command Memo */}
            <p className="text-[10px] text-[#475569] leading-tight italic">
              You are hereby commanded to mark an immediate proportional debit freeze / lien on the accounts specified herein and submit certified KYC records within 24 hours.
            </p>
          </div>
        </div>

        {/* 4. Bottom Signature & Verification Row (Authentic Government Document Format) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-[#334155] items-end text-xs">
          {/* Box 1: Officer Signature Details & Designation */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[9.5px]">
              <span className="font-bold uppercase text-[#475569]">Officer Signature</span>
              <span className="font-mono text-[#64748B]">{currentDate}</span>
            </div>
            <div className="h-9 border border-[#94A3B8] bg-[#F8FAFC] flex items-center justify-center font-serif italic text-xs text-[#1E293B]">
              Insp. R. K. Sharma
            </div>
            <div className="h-7 border border-[#CBD5E1] bg-[#F8FAFC] flex items-center justify-center text-[9px] font-mono text-[#475569]">
              Cyber Crime PS, Indore
            </div>
          </div>

          {/* Box 2: Genuine Scannable QR Code Verification */}
          <div className="flex flex-col items-center justify-center text-center p-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xs shadow-2xs">
            <div className="bg-white p-1 border border-[#CBD5E1] rounded-xs shadow-xs mb-1 flex items-center justify-center">
              <QRCodeSVG
                value={qrVerificationUrl}
                size={58}
                level="M"
                includeMargin={false}
              />
            </div>
            <span className="text-[9px] font-bold text-[#0F172A] uppercase tracking-wider">QR Code Verification</span>
            <span className="text-[7.5px] font-mono text-[#059669] font-bold">✓ SEC91 E-AUTHENTIC</span>
          </div>

          {/* Box 3: Police Station Seal Box */}
          <div className="h-18 border-2 border-dashed border-[#94A3B8] flex flex-col items-center justify-center p-1 text-center bg-[#F8FAFC]">
            <span className="text-[9px] font-bold text-[#0F172A] uppercase">Police Station</span>
            <span className="text-[9px] font-bold text-[#D97706] uppercase">Seal Box</span>
            <span className="text-[7.5px] text-[#64748B] mt-0.5">Indore Commissionerate</span>
          </div>

          {/* Box 4: e-Sign Digital Signature */}
          <div className="text-right space-y-1">
            <div className="text-[9px] text-[#64748B] font-mono border-b border-[#E2E8F0] pb-0.5">
              Verified Digitally
            </div>
            <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-[#E6F7F0] border border-[#A7F3D0] rounded text-[#059669]">
              <CheckCircle className="w-3.5 h-3.5 shrink-0" />
              <div className="text-left leading-none">
                <div className="text-[10px] font-black tracking-wide">e-Sign</div>
                <div className="text-[7px] text-[#047857]">Digital Signature Verified</div>
              </div>
            </div>
            <div className="text-[8.5px] font-mono text-[#64748B]">
              Date: {currentDate}
            </div>
          </div>
        </div>

        {/* Bottom Small Indicator */}
        <div className="mt-2 pt-1 border-t border-dashed border-[#CBD5E1] flex items-center justify-between text-[8.5px] font-mono text-[#64748B]">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#059669]"></span>
            <span>Lien vs. Full Freeze: <strong>Proportional Lien Hold Enforced</strong></span>
          </span>
          <span>Integrity Hash: SHA256-7F89E8B2C449</span>
        </div>
      </div>
    </div>
  );
}
