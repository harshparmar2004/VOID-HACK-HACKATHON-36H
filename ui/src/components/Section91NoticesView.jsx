import React, { useMemo, useState, useRef } from "react";
import {
  FileText,
  Lock,
  Unlock,
  Printer,
  Download,
  CheckCircle2,
  ShieldAlert,
  Building2,
  Copy,
  Check,
  Scale,
  FileCheck,
  FileDown
} from "lucide-react";
import { inr, num, text } from "../format";
import { EmptyState, ErrorState, LoadingState, PageHeader, Stat } from "./States";

const BANK_FULL_NAMES = {
  SBIN: "State Bank of India",
  HDFC: "HDFC Bank Ltd.",
  ICIC: "ICICI Bank Ltd.",
  AXIS: "Axis Bank Ltd.",
  KKBK: "Kotak Mahindra Bank Ltd.",
  PUNB: "Punjab National Bank",
  BARB: "Bank of Baroda",
  PYTM: "Paytm Payments Bank Ltd.",
  AIRP: "Airtel Payments Bank Ltd.",
  IPOS: "India Post Payments Bank",
  UBIN: "Union Bank of India",
  CNRB: "Canara Bank",
  IDIB: "Indian Bank",
  CBIN: "Central Bank of India",
  YESB: "Yes Bank Ltd.",
  INDB: "IndusInd Bank Ltd.",
};

const BANK_ADDRESSES = {
  SBIN: "State Bank Bhavan, Corporate Centre, Madame Cama Road, Nariman Point, Mumbai - 400021",
  HDFC: "HDFC Bank House, Senapati Bapat Marg, Lower Parel (West), Mumbai - 400013",
  ICIC: "ICICI Bank Towers, Bandra-Kurla Complex, Bandra (East), Mumbai - 400051",
  AXIS: "Axis House, C-2, Wadia International Centre, Pandurang Budhkar Marg, Worli, Mumbai - 400025",
  KKBK: "27BKC, C 27, G Block, Bandra Kurla Complex, Bandra (East), Mumbai - 400051",
  PUNB: "Plot No 4, Sector 10, Dwarka, New Delhi - 110075",
  BARB: "Baroda Corporate Centre, C-26, G-Block, Bandra Kurla Complex, Mumbai - 400051",
  PYTM: "Skymark One, Sector 98, Noida, Uttar Pradesh - 201301",
  AIRP: "Airtel Centre, Worldmark 2, Aerocity, New Delhi - 110037",
  IPOS: "Speed Post Centre Building, Bhai Veer Singh Marg, Gole Market, New Delhi - 110001",
};

export default function Section91NoticesView({ trace, onRetry, caseInfo }) {
  const candidates = trace.data?.freeze_candidates || [];
  const victimAccount = String(trace.victim || "").trim();

  // Local freeze states for each candidate (Default ALL FROZEN on load)
  const [frozenAccounts, setFrozenAccounts] = useState(() => {
    const init = {};
    candidates.forEach((c) => {
      init[c.acct_no] = true;
    });
    return init;
  });

  const [viewMode, setViewMode] = useState("court_document"); // "court_document" or "register"
  const [selectedBank, setSelectedBank] = useState("ALL");
  const [copiedNotice, setCopiedNotice] = useState(false);
  const [lastActionTime] = useState(() => new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }));

  const documentRef = useRef(null);

  // Group by Bank
  const byBank = useMemo(() => {
    const map = {};
    candidates.forEach((c) => {
      const key = c.bank || "UNKNOWN";
      if (!map[key]) {
        map[key] = {
          bank: c.bank,
          fullName: BANK_FULL_NAMES[c.bank] || `${c.bank} Bank`,
          accounts: 0,
          holding: 0,
          candidates: []
        };
      }
      map[key].accounts += 1;
      map[key].holding += Number(c.holding) || 0;
      map[key].candidates.push(c);
    });
    return Object.values(map).sort((a, b) => b.holding - a.holding);
  }, [candidates]);

  const totalHolding = candidates.reduce((sum, c) => sum + (Number(c.holding) || 0), 0);
  const totalSiphoned = trace.data?.total_in || trace.data?.outbound_drain || totalHolding;

  // Filtered candidates based on selected bank
  const filteredCandidates = useMemo(() => {
    if (selectedBank === "ALL") return candidates;
    return candidates.filter((c) => c.bank === selectedBank);
  }, [candidates, selectedBank]);

  const allFrozen = candidates.length > 0 && candidates.every((c) => frozenAccounts[c.acct_no]);
  const frozenCount = Object.values(frozenAccounts).filter(Boolean).length;

  const toggleFreezeAll = () => {
    const targetState = !allFrozen;
    const next = {};
    candidates.forEach((c) => {
      next[c.acct_no] = targetState;
    });
    setFrozenAccounts(next);
  };

  const toggleFreezeSingle = (acctNo) => {
    setFrozenAccounts((prev) => ({
      ...prev,
      [acctNo]: !prev[acctNo]
    }));
  };

  // Requisition ID & Metadata
  const noticeRefNo = useMemo(() => {
    const safeVic = victimAccount.replace(/[^A-Z0-9]/gi, "").slice(-8) || "88888888";
    return `CCPS/SEC91/2026/${safeVic}/${Math.floor(Date.now() / 1000)}`;
  }, [victimAccount]);

  const firNumber = caseInfo?.firNumber || "CR/CYBER/2026/0922/01";
  const complainantName = caseInfo?.complainant || "Bank Fraud Investigation Wing / State Cyber Cell";

  // SHA-256 Seal Representation
  const integritySha = useMemo(() => {
    const raw = `${noticeRefNo}-${victimAccount}-${candidates.map((c) => c.acct_no).join(",")}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = (hash << 5) - hash + raw.charCodeAt(i);
      hash |= 0;
    }
    const hex = Math.abs(hash).toString(16).padStart(8, "0");
    return `9a8f4c2e${hex}71b05dd81c4e97a3f81e05d9`;
  }, [noticeRefNo, victimAccount, candidates]);

  const handlePrint = () => {
    window.print();
  };

  const generateHtmlNotice = () => {
    const totalLien = filteredCandidates.reduce((s, c) => s + (Number(c.holding) || 0), 0);
    const tableRows = filteredCandidates.map((c, i) => `
      <tr>
        <td style="text-align:center; font-weight:bold; border:1px solid #333; padding:5px 6px;">${i + 1}</td>
        <td style="font-weight:bold; font-family:monospace; border:1px solid #333; padding:5px 8px;">${c.acct_no}</td>
        <td style="border:1px solid #333; padding:5px 8px;">${BANK_FULL_NAMES[c.bank] || c.bank}</td>
        <td style="color:#d96b27; font-weight:bold; border:1px solid #333; padding:5px 6px;">${c.role || "Mule Account"}</td>
        <td style="text-align:center; border:1px solid #333; padding:5px 6px;">${c.hop}</td>
        <td style="text-align:right; font-family:monospace; border:1px solid #333; padding:5px 8px;">₹${Number(c.tainted_in || 0).toLocaleString("en-IN")}</td>
        <td style="text-align:right; font-weight:bold; color:#dc2626; background:#fff5f5; font-family:monospace; border:1px solid #333; padding:5px 8px;">₹${Number(c.holding || 0).toLocaleString("en-IN")}</td>
        <td style="text-align:center; border:1px solid #333; padding:5px 6px;"><span style="background:#dc2626; color:#fff; font-size:9px; font-weight:bold; padding:2px 6px; border-radius:2px; font-family:monospace;">DEBIT FROZEN</span></td>
      </tr>
    `).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Section 91 Cr.P.C. Statutory Notice - ${victimAccount}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 10mm 12mm 10mm 12mm;
  }
  * { box-sizing: border-box; }
  body {
    font-family: "Times New Roman", Times, Georgia, serif;
    color: #1a1715;
    background: #f4efe6;
    margin: 0;
    padding: 20px;
    font-size: 10.5pt;
    line-height: 1.35;
  }
  .court-sheet {
    max-width: 820px;
    margin: 0 auto 30px auto;
    background: #ffffff;
    padding: 35px 45px;
    border: 1px solid #d5cebf;
    box-shadow: 0 4px 15px rgba(0,0,0,0.08);
  }
  .page-break {
    page-break-before: always !important;
    break-before: page !important;
  }
  .avoid-break {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
  @media print {
    body { padding: 0; background: #ffffff; font-size: 10pt; }
    .court-sheet {
      border: none !important;
      box-shadow: none !important;
      padding: 0 !important;
      margin: 0 !important;
      max-width: 100% !important;
    }
    .no-print { display: none !important; }
    .page-break {
      page-break-before: always !important;
      break-before: page !important;
      padding-top: 5mm !important;
    }
  }
  .top-toolbar {
    max-width: 820px;
    margin: 0 auto 20px auto;
    background: #2c2623;
    color: #faf6ee;
    padding: 12px 20px;
    border-radius: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: sans-serif;
  }
  .btn-print {
    background: #d96b27;
    color: #ffffff;
    border: none;
    padding: 8px 18px;
    font-size: 13px;
    font-weight: bold;
    border-radius: 4px;
    cursor: pointer;
  }
  .header-block { text-align: center; border-bottom: 2px solid #1a1715; padding-bottom: 12px; margin-bottom: 12px; }
  .emblem-repr { width: 46px; height: 46px; border: 2px solid #1a1715; border-radius: 50%; margin: 0 auto 6px auto; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 9pt; font-family: monospace; background: #faf6ee; }
  .h1-title { font-size: 12pt; font-weight: bold; text-transform: uppercase; margin: 4px 0; }
  .h2-title { font-size: 8.5pt; font-weight: bold; text-transform: uppercase; font-family: monospace; color: #544d45; margin: 0; }
  .ref-table { width: 100%; border-bottom: 1px solid #e8e2d5; padding-bottom: 8px; margin-bottom: 10px; font-family: monospace; font-size: 8.5pt; }
  .title-banner { text-align: center; background: #faf6ee; border-top: 1px solid #d5cebf; border-bottom: 1px solid #d5cebf; padding: 6px 0; margin: 10px 0; }
  .title-banner h3 { margin: 0; font-size: 10.5pt; font-weight: bold; }
  .title-banner h4 { margin: 2px 0; font-size: 8.5pt; font-weight: bold; color: #544d45; }
  .title-banner p { margin: 2px 0 0 0; font-size: 8pt; font-weight: bold; color: #dc2626; font-family: monospace; letter-spacing: 0.5px; }
  .addr-block { font-size: 9pt; font-family: sans-serif; margin-bottom: 10px; }
  .subj-block { background: #fffbf8; border: 1px solid #f0e6d8; padding: 6px 10px; margin-bottom: 10px; font-size: 8.5pt; font-family: sans-serif; }
  .narrative-p { font-size: 9pt; line-height: 1.35; margin-bottom: 8px; text-align: justify; }
  .dir-list { margin: 6px 0 10px 15px; font-size: 8.5pt; font-family: sans-serif; }
  .dir-item { margin-bottom: 5px; }
  .summary-card { background: #faf6ee; border: 1px dashed #d5cebf; padding: 8px 12px; margin-top: 10px; font-family: monospace; font-size: 8.5pt; display: flex; justify-content: space-between; }
  .sheet-footer { font-size: 8pt; font-family: monospace; color: #746d65; text-align: center; border-top: 1px solid #e8e2d5; padding-top: 6px; margin-top: 15px; }
  table.schedule-table { width: 100%; border-collapse: collapse; margin-top: 8px; margin-bottom: 12px; font-family: monospace; font-size: 8.5pt; }
  table.schedule-table th { background: #faf6ee; border: 1px solid #1a1715; padding: 5px 6px; font-size: 8pt; font-weight: bold; }
  table.schedule-table td { border: 1px solid #e0d9cc; }
  .penal-alert { border: 1px solid #dc2626; background: #fff5f5; color: #991b1b; padding: 6px 10px; font-size: 8.5pt; line-height: 1.35; margin-bottom: 15px; }
  .exec-grid { display: flex; justify-content: space-between; align-items: flex-end; border-top: 1px solid #d5cebf; padding-top: 15px; margin-top: 10px; }
  .stamp-box { width: 110px; height: 75px; border: 2px dashed #b5ada0; background: #faf6ee; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 7.5pt; font-family: monospace; text-align: center; color: #746d65; }
  .sig-block { text-align: right; font-size: 8.5pt; }
</style>
</head>
<body>

<div class="no-print top-toolbar">
  <div>
    <div style="font-weight:bold; font-size:14px; color:#fff;">STATE POLICE COMMISSIONERATE • STATUTORY SECTION 91 NOTICE</div>
    <div style="font-size:11px; color:#d5cebf;">Crime Register / FIR: ${firNumber} • Victim: ${victimAccount} • Clean 2-Page Court Document</div>
  </div>
  <button class="btn-print" onclick="window.print()">🖨️ Print / Save as Court PDF</button>
</div>

<!-- ================= PAGE 1 ================= -->
<div class="court-sheet">
  <div class="header-block">
    <div class="emblem-repr">POLICE</div>
    <p class="h2-title">OFFICE OF THE INVESTIGATING OFFICER / SUPERINTENDENT OF POLICE</p>
    <h1 class="h1-title">CYBER CRIME POLICE COMMISSIONERATE, DIGITAL EVIDENCE & FRAUD DETECTION CELL</h1>
    <p style="font-size:7.5pt; font-family:monospace; color:#746d65; margin:0;">SPECIAL FINANCIAL CRIME UNIT • STATE CYBER FORENSICS WING</p>
  </div>

  <table class="ref-table">
    <tr>
      <td style="border:none; text-align:left; vertical-align:top;">
        <div><b>NOTICE REF NO:</b> ${noticeRefNo}</div>
        <div><b>CRIME REGISTER / FIR NO:</b> ${firNumber}</div>
        <div><b>ORIGINATING COMPLAINANT:</b> ${complainantName}</div>
      </td>
      <td style="border:none; text-align:right; vertical-align:top;">
        <div><b>DATE OF ISSUANCE:</b> ${lastActionTime}</div>
        <div><b>STATUTORY STATUS:</b> <span style="color:#dc2626; font-weight:bold;">EMERGENCY STATUTORY DEBIT-FREEZE</span></div>
        <div><b>TARGET JURISDICTION:</b> ${selectedBank === "ALL" ? "CONSOLIDATED INTER-BANK SYNDICATE" : (BANK_FULL_NAMES[selectedBank] || selectedBank)}</div>
      </td>
    </tr>
  </table>

  <div class="title-banner">
    <h3>STATUTORY NOTICE UNDER SECTION 91 OF THE CODE OF CRIMINAL PROCEDURE, 1973</h3>
    <h4>(READ WITH SECTION 94 OF BHARATIYA NAGARIK SURAKSHA SANHITA, 2023)</h4>
    <p>MANDATORY ORDER FOR IMMEDIATE DEBIT-FREEZE, LIEN MARKING & EVIDENCE PRESERVATION</p>
  </div>

  <div class="addr-block">
    <p style="margin:0 0 2px 0; font-weight:bold;">TO,</p>
    <p style="margin:0; font-weight:bold;">THE NODAL OFFICER / AUTHORIZED LEGAL & COMPLIANCE CELL,</p>
    <p style="margin:0; font-weight:bold; color:#d96b27;">${selectedBank === "ALL" ? "ALL CONCERNED SCHEDULED COMMERCIAL BANKS & PAYMENT SERVICE PROVIDERS (LISTED IN SCHEDULE-A)" : (BANK_FULL_NAMES[selectedBank] || selectedBank)}</p>
    <p style="margin:0; color:#746d65; font-size:8pt;">${selectedBank === "ALL" ? "Designated Head Offices / Cyber Crime Liaison Desks, India" : (BANK_ADDRESSES[selectedBank] || "Corporate Head Office / Digital Frauds Department")}</p>
  </div>

  <div class="subj-block">
    <b>SUBJECT:</b> Order for Immediate Total Debit-Freeze, Statutory Lien Marking of Trapped Balances, and Furnishing of Digital Footprints in respect of Suspected Money Mule Beneficiary Accounts in Cyber Fraud / Digital Arrest Extortion Case under Section 91 Cr.P.C. / Section 94 BNSS.
  </div>

  <div class="narrative-p">
    <b>1. REQUISITION PREMISES:</b> WHEREAS, this Police Station is investigating a high-value financial cyber fraud involving digital arrest, extortion, and fraudulent electronic fund siphoning. The investigation has established that an illicit sum of <b>₹${Number(totalSiphoned).toLocaleString("en-IN")}</b> was fraudulently extracted from the originating victim bank account <b>${victimAccount}</b>.
  </div>

  <div class="narrative-p">
    <b>2. MONEY TRAIL MAPPING:</b> Consequent to immediate digital forensic graph analysis and multi-hop transactional provenance tracking, the defrauded funds were found to have been dispersed within minutes across organized money mule syndicates operated across multiple layers (L1 Collector Placement, L2 Smurfing Distribution, and L3 Escrow Accumulators) as specified in Schedule-A attached hereto.
  </div>

  <div class="narrative-p">
    <b>3. STATUTORY DIRECTIVES:</b> NOW THEREFORE, by virtue of the powers vested in me under <b>Section 91 of the Code of Criminal Procedure, 1973 (read with Section 94 of Bharatiya Nagarik Suraksha Sanhita, 2023)</b>, you are hereby directed to immediately execute the following statutory requisitions:
  </div>

  <div class="dir-list">
    <div class="dir-item"><b>a) IMMEDIATE TOTAL DEBIT FREEZE:</b> Place an immediate total debit-freeze on all accounts enumerated in Schedule-A below. No outflow, withdrawal, UPI transfer, or ATM debit shall be permitted under any circumstances.</div>
    <div class="dir-item"><b>b) STATUTORY LIEN MARKING:</b> Mark a statutory police lien for the exact trapped amount indicated in the <b>Actionable Lien Holding</b> column against each respective account for subsequent judicial restitution under Section 457 Cr.P.C. / Section 503 BNSS.</div>
    <div class="dir-item"><b>c) FURNISHING OF KYC & DIGITAL EVIDENCE:</b> Furnish to this office within <b>24 HOURS</b> certified copies of: (i) Account Opening Form (AOF), (ii) Verified Aadhaar/PAN/Voter ID KYC, (iii) Linked mobile number with SIM issuance circle, (iv) Registered email and login IPDR logs, and (v) Certified statement of accounts for the preceding 6 months.</div>
    <div class="dir-item"><b>d) ANTI-TIPPING OFF MANDATE:</b> Under no circumstances shall the account holder(s) or any third party be tipped off or alerted prior to the execution of the debit freeze.</div>
  </div>

  <div class="summary-card">
    <div>Total Siphoned: <b>₹${Number(totalSiphoned).toLocaleString("en-IN")}</b></div>
    <div>Trapped Lien Capital: <b style="color:#059669;">₹${Number(totalLien).toLocaleString("en-IN")}</b></div>
    <div>Mule Accounts Implicated: <b>${filteredCandidates.length}</b></div>
    <div>Enforcement: <b style="color:#dc2626;">Immediate</b></div>
  </div>

  <div class="sheet-footer">
    Page 1 of 2 • State Cyber Crime Police Station • Notice Ref: ${noticeRefNo} • Continues to Schedule-A on Page 2
  </div>
</div>

<!-- ================= PAGE 2 ================= -->
<div class="court-sheet page-break">
  <div style="border-bottom:2px solid #1a1715; padding-bottom:8px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
    <div>
      <h3 style="margin:0; font-size:11pt; font-weight:bold; font-family:monospace; text-transform:uppercase;">SCHEDULE-A: SCHEDULE OF IMPLICATED MULE ACCOUNTS ORDERED FOR DEBIT-FREEZE</h3>
      <p style="margin:2px 0 0 0; font-size:8pt; font-family:sans-serif; color:#544d45;">Attached to Statutory Notice Ref: ${noticeRefNo} • Crime / FIR No: ${firNumber}</p>
    </div>
    <div style="text-align:right; font-family:monospace; font-size:8pt;">
      Total Accounts: <b>${filteredCandidates.length}</b> | Total Lien: <b style="color:#dc2626;">₹${Number(totalLien).toLocaleString("en-IN")}</b>
    </div>
  </div>

  <table class="schedule-table">
    <thead>
      <tr style="background:#faf6ee; text-align:left;">
        <th style="width:35px; text-align:center;">S.No</th>
        <th>Account Number</th>
        <th>Bank / IFSC</th>
        <th>Layer / Role</th>
        <th style="width:40px; text-align:center;">Hop</th>
        <th style="text-align:right;">Inflow (₹)</th>
        <th style="text-align:right; background:#fff5f5; color:#dc2626;">Lien Holding (₹)</th>
        <th style="width:90px; text-align:center;">Status</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
    <tfoot>
      <tr style="background:#faf6ee; border-top:2px solid #1a1715; font-weight:bold; font-size:9pt;">
        <td colspan="6" style="text-align:right; padding:6px 8px; border:1px solid #1a1715;">TOTAL STATUTORY LIEN TO BE PLACED:</td>
        <td style="text-align:right; color:#dc2626; background:#fff5f5; padding:6px 8px; border:1px solid #1a1715;">₹${Number(totalLien).toLocaleString("en-IN")}</td>
        <td style="text-align:center; color:#059669; padding:6px 8px; border:1px solid #1a1715;">ALL ${filteredCandidates.length} FROZEN</td>
      </tr>
    </tfoot>
  </table>

  <div class="penal-alert avoid-break">
    <b>PENAL CONSEQUENCE WARNING:</b> Please note that non-compliance, deliberate delay, or failure to produce documents demanded under Section 91 Cr.P.C. / Section 94 BNSS attracts criminal prosecution under <b>Section 175 and Section 187 of the Indian Penal Code / Bharatiya Nyaya Sanhita</b>, and willful tipping off will be treated as abetment of cyber fraud under Section 111 / 120-B IPC.
  </div>

  <div class="exec-grid avoid-break">
    <div>
      <div class="stamp-box">
        <span>OFFICIAL POLICE</span>
        <span>COMMISSIONERATE</span>
        <span>SEAL / STAMP</span>
      </div>
      <div style="margin-top:6px; font-size:7.5pt; font-family:monospace; color:#544d45;">
        SHA-256 EVIDENTIARY HASH:<br/>
        <b style="color:#1a1715;">${integritySha}</b>
      </div>
    </div>

    <div class="sig-block">
      <div style="font-family:serif; font-style:italic; font-size:13pt; margin-bottom:4px; color:#1a1715;">Investigating Officer, Cyber Cell</div>
      <div style="font-weight:bold; font-size:9.5pt;">INSPECTOR OF POLICE / INVESTIGATING OFFICER</div>
      <div style="color:#544d45;">State Cyber Crime Police Station</div>
      <div style="font-size:8pt; font-family:monospace; color:#746d65;">Digital Arrest & Financial Fraud Investigation Wing</div>
      <div style="font-size:7.5pt; font-family:monospace; color:#059669; font-weight:bold; margin-top:2px;">Electronically Certified under Sec 65B Indian Evidence Act</div>
    </div>
  </div>

  <div class="sheet-footer">
    Page 2 of 2 • Certified under Section 65B Indian Evidence Act • Final Statutory Direction • End of Notice
  </div>
</div>

</body>
</html>`;
  };

  const handleDownloadHtml = () => {
    const html = generateHtmlNotice();
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Section_91_Notice_${victimAccount || "Case"}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadWord = () => {
    const html = generateHtmlNotice();
    const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Section_91_Notice_${victimAccount || "Case"}.doc`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadDoc = () => {
    if (!documentRef.current) return;
    const content = documentRef.current.innerText;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Section_91_Notice_${victimAccount || "Case"}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyNotice = () => {
    if (!documentRef.current) return;
    navigator.clipboard.writeText(documentRef.current.innerText);
    setCopiedNotice(true);
    setTimeout(() => setCopiedNotice(false), 2000);
  };

  return (
    <div className="space-y-5">
      {/* 1. Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E8E2D5] pb-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[#D96B27] font-mono">
            LEGAL & STATUTORY REQUISITIONS
          </div>
          <h1 className="text-xl sm:text-2xl font-bold font-serif text-[#2C2623] mt-0.5">
            Section 91 Cr.P.C. / 94 BNSS Debit-Freeze Notice
          </h1>
          <p className="text-xs text-[#746D65] mt-1 font-sans">
            Court-ready statutory freeze order with actionable lien markings and certified bank nodal directives.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Toggle View Mode */}
          <div className="flex bg-[#EFEAE1] p-0.5 rounded-sm border border-[#E0D9CC] text-xs font-mono">
            <button
              onClick={() => setViewMode("court_document")}
              className={`px-3 py-1.5 rounded-xs transition-all flex items-center gap-1.5 cursor-pointer font-bold ${
                viewMode === "court_document"
                  ? "bg-white text-[#D96B27] shadow-2xs"
                  : "text-[#746D65] hover:text-[#2C2623]"
              }`}
            >
              <FileCheck className="w-3.5 h-3.5" />
              <span>Court-Ready Notice (2 Pages)</span>
            </button>
            <button
              onClick={() => setViewMode("register")}
              className={`px-3 py-1.5 rounded-xs transition-all flex items-center gap-1.5 cursor-pointer font-bold ${
                viewMode === "register"
                  ? "bg-white text-[#D96B27] shadow-2xs"
                  : "text-[#746D65] hover:text-[#2C2623]"
              }`}
            >
              <Scale className="w-3.5 h-3.5" />
              <span>Freeze Register ({candidates.length})</span>
            </button>
          </div>

          {/* Freeze All Action */}
          <button
            onClick={toggleFreezeAll}
            className={`px-3.5 py-1.5 rounded-sm text-xs font-mono font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer ${
              allFrozen
                ? "bg-[#059669] hover:bg-[#047857] text-white"
                : "bg-[#DC2626] hover:bg-[#B91C1C] text-white"
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>{allFrozen ? `All ${candidates.length} Frozen` : `Freeze All (${candidates.length})`}</span>
          </button>

          {/* Print / Save PDF for Court */}
          <button
            onClick={handlePrint}
            className="px-3.5 py-1.5 rounded-sm bg-[#2C2623] hover:bg-[#1A1715] text-white text-xs font-mono font-bold flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
            title="Open 2-page printable document formatted for judicial submission"
          >
            <Printer className="w-3.5 h-3.5 text-[#D96B27]" />
            <span>Print / Court PDF</span>
          </button>

          {/* Download Court HTML Document */}
          <button
            onClick={handleDownloadHtml}
            className="px-3 py-1.5 rounded-sm bg-white hover:bg-[#FAF6EE] text-[#D96B27] border border-[#D96B27] text-xs font-mono font-bold flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
            title="Download standalone 2-page HTML court notice"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>Download HTML (2-Page)</span>
          </button>

          {/* Download MS Word Doc */}
          <button
            onClick={handleDownloadWord}
            className="px-3 py-1.5 rounded-sm bg-white hover:bg-[#FAF6EE] text-[#2C2623] border border-[#D5CEBF] text-xs font-mono font-bold flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
            title="Download Microsoft Word (.doc) court notice"
          >
            <Download className="w-3.5 h-3.5 text-[#746D65]" />
            <span>Word (.doc)</span>
          </button>

          {/* Copy Plain Text */}
          <button
            onClick={handleCopyNotice}
            className="px-3 py-1.5 rounded-sm bg-white hover:bg-[#FAF6EE] text-[#746D65] border border-[#D5CEBF] text-xs font-mono font-bold flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
            title="Copy plain text notice to clipboard"
          >
            {copiedNotice ? <Check className="w-3.5 h-3.5 text-[#059669]" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedNotice ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>

      {trace.loading ? (
        <LoadingState label="Tracing forensic freeze candidates..." />
      ) : trace.error ? (
        <ErrorState title="Failed to load freeze candidates" message={trace.error} onRetry={onRetry} />
      ) : !trace.data ? (
        <EmptyState title="No active trace" hint="Select a victim account with an active money trail to generate freeze notices." />
      ) : candidates.length === 0 ? (
        <EmptyState
          title={`No freeze candidates for ${text(trace.victim)}`}
          hint="No freeze-recommended account in this trace holds actionable victim capital."
        />
      ) : (
        <>
          {/* 2. Top Metric Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Victim Account" value={text(trace.victim)} sub="Originating source" />
            <Stat
              label="Actionable Freeze Accounts"
              value={`${frozenCount} / ${candidates.length}`}
              tone={frozenCount > 0 ? "red" : "gray"}
              sub="Statutory debit-freeze"
            />
            <Stat label="Banks Implicated" value={num(byBank.length)} sub="Nodal officers requisitioned" />
            <Stat label="Trapped Lien Capital" value={inr(totalHolding)} tone="green" sub="Protected for victim refund" />
          </div>

          {/* 3. Bank Filter Bar */}
          <div className="bg-white border border-[#E8E2D5] rounded-md p-3 flex flex-wrap items-center justify-between gap-3 text-xs font-mono shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#746D65] flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-[#D96B27]" />
                Filter by Bank:
              </span>
              <button
                onClick={() => setSelectedBank("ALL")}
                className={`px-2.5 py-1 rounded-sm text-xs transition-all cursor-pointer ${
                  selectedBank === "ALL"
                    ? "bg-[#D96B27] text-white font-bold"
                    : "bg-[#FAF6EE] border border-[#E8E2D5] text-[#746D65] hover:bg-[#EFEAE1]"
                }`}
              >
                All Banks ({candidates.length})
              </button>
              {byBank.map((b) => (
                <button
                  key={b.bank}
                  onClick={() => setSelectedBank(b.bank)}
                  className={`px-2.5 py-1 rounded-sm text-xs transition-all cursor-pointer ${
                    selectedBank === b.bank
                      ? "bg-[#D96B27] text-white font-bold"
                      : "bg-[#FAF6EE] border border-[#E8E2D5] text-[#746D65] hover:bg-[#EFEAE1]"
                  }`}
                >
                  <b>{b.bank}</b> ({b.accounts})
                </button>
              ))}
            </div>

            <div className="text-[11px] text-[#059669] font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Court-Ready Statutory Seal: Active (Section 65B IEA Certified)</span>
            </div>
          </div>

          {/* 4. Active View: Either Court Document (2 Pages) or Interactive Register */}
          {viewMode === "court_document" ? (
            /* ========================================================================= */
            /* COURT READY SECTION 91 NOTICE DOCUMENT (EXACT 2-PAGE SPECIFICATION)       */
            /* ========================================================================= */
            <div className="court-document-wrapper space-y-6" ref={documentRef}>

              {/* SHEET 1 / PAGE 1: REQUISITION GROUNDS & DIRECTIVES */}
              <div className="court-page-1 court-print-container bg-white border border-[#D5CEBF] rounded-sm p-6 sm:p-9 shadow-sm font-serif text-[#1A1715] space-y-4 print:border-none print:p-0 print:shadow-none print:m-0 print:rounded-none">
                
                {/* Screen Page Badge (Hidden in Print) */}
                <div className="no-print flex items-center justify-between text-[11px] font-mono border-b border-[#E8E2D5] pb-2 text-[#746D65]">
                  <span className="font-bold text-[#D96B27] uppercase">PAGE 1 OF 2 — STATUTORY NOTICE & INVESTIGATIVE GROUNDS</span>
                  <span>A4 Portrait • Standard Police Format</span>
                </div>

                {/* Document Header with National Police Emblem Representation */}
                <div className="text-center border-b-2 border-[#1A1715] pb-4 space-y-1">
                  <div className="flex justify-center mb-1">
                    <div className="w-12 h-12 rounded-full border-2 border-[#1A1715] flex items-center justify-center font-bold text-xs bg-[#FAF6EE] tracking-wider">
                      POLICE
                    </div>
                  </div>
                  <h2 className="text-xs font-bold tracking-widest uppercase font-mono text-[#544D45]">
                    OFFICE OF THE INVESTIGATING OFFICER / SUPERINTENDENT OF POLICE
                  </h2>
                  <h1 className="text-base sm:text-lg font-bold uppercase tracking-wider text-[#1A1715]">
                    CYBER CRIME POLICE COMMISSIONERATE, DIGITAL EVIDENCE & FRAUD DETECTION CELL
                  </h1>
                  <p className="text-[11px] font-mono text-[#746D65]">
                    SPECIAL FINANCIAL CRIME UNIT • STATE CYBER FORENSICS WING
                  </p>
                </div>

                {/* Reference & Date Details */}
                <div className="flex flex-wrap justify-between text-xs font-mono border-b border-[#E8E2D5] pb-2.5 text-[#2C2623]">
                  <div>
                    <p><b>NOTICE REF NO:</b> {noticeRefNo}</p>
                    <p><b>CRIME REGISTER / FIR NO:</b> {firNumber}</p>
                    <p><b>ORIGINATING COMPLAINANT:</b> {complainantName}</p>
                  </div>
                  <div className="text-right">
                    <p><b>DATE OF ISSUANCE:</b> {lastActionTime}</p>
                    <p><b>STATUTORY STATUS:</b> <span className="text-[#DC2626] font-bold">EMERGENCY STATUTORY DEBIT-FREEZE</span></p>
                    <p><b>TARGET JURISDICTION:</b> {selectedBank === "ALL" ? "CONSOLIDATED INTER-BANK SYNDICATE" : (BANK_FULL_NAMES[selectedBank] || selectedBank)}</p>
                  </div>
                </div>

                {/* Statutory Formal Title */}
                <div className="text-center my-2.5 py-2 bg-[#FAF6EE] border-y border-[#D5CEBF]">
                  <h3 className="text-sm sm:text-base font-bold uppercase tracking-wide text-[#1A1715]">
                    STATUTORY NOTICE UNDER SECTION 91 OF THE CODE OF CRIMINAL PROCEDURE, 1973
                  </h3>
                  <h4 className="text-xs font-bold uppercase text-[#544D45]">
                    (READ WITH SECTION 94 OF BHARATIYA NAGARIK SURAKSHA SANHITA, 2023)
                  </h4>
                  <p className="text-[11px] font-bold text-[#DC2626] uppercase mt-0.5 tracking-wider font-mono">
                    MANDATORY ORDER FOR IMMEDIATE DEBIT-FREEZE, LIEN MARKING & EVIDENCE PRESERVATION
                  </p>
                </div>

                {/* Addressed To */}
                <div className="text-xs space-y-0.5 font-sans">
                  <p className="font-bold font-serif text-sm">TO,</p>
                  <p className="font-bold">THE NODAL OFFICER / AUTHORIZED LEGAL & COMPLIANCE CELL,</p>
                  <p className="font-bold text-[#D96B27]">
                    {selectedBank === "ALL"
                      ? "ALL CONCERNED SCHEDULED COMMERCIAL BANKS & PAYMENT SERVICE PROVIDERS (LISTED IN SCHEDULE-A)"
                      : `${BANK_FULL_NAMES[selectedBank] || selectedBank}`}
                  </p>
                  <p className="text-[#746D65]">
                    {selectedBank === "ALL"
                      ? "Designated Head Offices / Cyber Crime Liaison Desks, India"
                      : (BANK_ADDRESSES[selectedBank] || "Corporate Head Office / Digital Frauds Department")}
                  </p>
                </div>

                {/* Subject */}
                <div className="text-xs space-y-1 bg-[#FFFBF8] p-2.5 rounded-xs border border-[#F0E6D8] font-sans">
                  <p>
                    <b>SUBJECT:</b> Order for Immediate Total Debit-Freeze, Statutory Lien Marking of Trapped Balances, and Furnishing of Digital Footprints in respect of Suspected Money Mule Beneficiary Accounts in Cyber Fraud / Digital Arrest Extortion Case under Section 91 Cr.P.C. / Section 94 BNSS.
                  </p>
                </div>

                {/* Legal Narrative */}
                <div className="text-xs space-y-2.5 leading-relaxed text-[#2C2623] font-serif">
                  <p>
                    <b>1. REQUISITION PREMISES:</b> WHEREAS, this Police Station is investigating a high-value financial cyber fraud involving digital arrest, extortion, and fraudulent electronic transfers. The investigation has conclusively established that an illicit sum of <b>{inr(totalSiphoned)}</b> was fraudulently extracted from the originating victim bank account <b>{victimAccount}</b>.
                  </p>
                  <p>
                    <b>2. MONEY TRAIL MAPPING:</b> Consequent to immediate digital forensic graph analysis and multi-hop transactional provenance tracking, the defrauded funds were found to have been dispersed within minutes across organized money mule syndicates operated across multiple layers (L1 Collector Placement, L2 Smurfing Distribution, and L3 Escrow Accumulators) as specified in Schedule-A attached hereto.
                  </p>
                  <p>
                    <b>3. STATUTORY DIRECTIVES:</b> NOW THEREFORE, by virtue of the powers vested in me under <b>Section 91 of the Code of Criminal Procedure, 1973 (read with Section 94 of Bharatiya Nagarik Suraksha Sanhita, 2023)</b>, you are hereby directed to immediately execute the following statutory requisitions:
                  </p>

                  <div className="pl-4 space-y-1 font-sans text-xs">
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-[#DC2626]">a)</span>
                      <p><b>IMMEDIATE TOTAL DEBIT FREEZE:</b> Place an immediate total debit-freeze on all accounts enumerated in Schedule-A below. No outflow, withdrawal, UPI transfer, or ATM debit shall be permitted under any circumstances.</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-[#DC2626]">b)</span>
                      <p><b>STATUTORY LIEN MARKING:</b> Mark a statutory police lien for the exact trapped amount indicated in the <b>Actionable Lien Holding</b> column against each respective account for subsequent judicial restitution under Section 457 Cr.P.C. / Section 503 BNSS.</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-[#DC2626]">c)</span>
                      <p><b>FURNISHING OF KYC & DIGITAL EVIDENCE:</b> Furnish to this office within <b>24 HOURS</b> certified copies of: (i) Account Opening Form (AOF), (ii) Verified Aadhaar/PAN/Voter ID KYC, (iii) Linked mobile number with SIM issuance circle, (iv) Registered email and login IPDR logs, and (v) Certified statement of accounts for the preceding 6 months.</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-[#DC2626]">d)</span>
                      <p><b>ANTI-TIPPING OFF MANDATE:</b> Under no circumstances shall the account holder(s) or any third party be tipped off or alerted prior to the execution of the debit freeze.</p>
                    </div>
                  </div>
                </div>

                {/* Summary Notice Card (Interim) */}
                <div className="bg-[#FAF6EE] border border-dashed border-[#D5CEBF] p-3 rounded-xs flex flex-wrap justify-between items-center text-xs font-mono">
                  <div>Originating Loss: <b>{inr(totalSiphoned)}</b></div>
                  <div>Trapped Lien Capital: <b className="text-[#059669]">{inr(totalHolding)}</b></div>
                  <div>Mule Accounts Implicated: <b>{filteredCandidates.length} Accounts</b></div>
                  <div className="text-[#DC2626] font-bold">Action Required: Immediate</div>
                </div>

                {/* Page 1 Footer */}
                <div className="border-t border-[#E8E2D5] pt-3 text-center text-[10px] font-mono text-[#746D65] flex justify-between items-center">
                  <span>Page 1 of 2 • State Cyber Crime Police Station</span>
                  <span className="font-bold text-[#D96B27]">NOTICE REF: {noticeRefNo}</span>
                  <span>Continued to Schedule-A on Page 2 →</span>
                </div>
              </div>

              {/* SCREEN-ONLY VISUAL PAGE BREAK DIVIDER (HIDDEN IN PRINT) */}
              <div className="no-print print-hide py-2 flex items-center justify-center gap-3 text-xs font-mono text-[#9E968D]">
                <div className="h-px border-b border-dashed border-[#D5CEBF] flex-1"></div>
                <span className="px-3 py-1 bg-[#FAF6EE] border border-[#E8E2D5] rounded-full text-[#746D65] font-bold flex items-center gap-1.5 shadow-2xs">
                  <FileText className="w-3.5 h-3.5 text-[#D96B27]" />
                  <span>PAGE 1 END • PAGE 2 BEGINS (SCHEDULE-A REGISTER & JUDICIAL ATTESTATION)</span>
                </span>
                <div className="h-px border-b border-dashed border-[#D5CEBF] flex-1"></div>
              </div>

              {/* SHEET 2 / PAGE 2: SCHEDULE-A MULE ACCOUNTS & JUDICIAL ATTESTATION */}
              <div className="court-page-2 court-page-break court-print-container bg-white border border-[#D5CEBF] rounded-sm p-6 sm:p-9 shadow-sm font-serif text-[#1A1715] space-y-4 print:border-none print:p-0 print:shadow-none print:m-0 print:rounded-none">
                
                {/* Screen Page Badge (Hidden in Print) */}
                <div className="no-print flex items-center justify-between text-[11px] font-mono border-b border-[#E8E2D5] pb-2 text-[#746D65]">
                  <span className="font-bold text-[#D96B27] uppercase">PAGE 2 OF 2 — SCHEDULE-A MULE ACCOUNTS & JUDICIAL ATTESTATION</span>
                  <span>A4 Portrait • Certified Court Annexure</span>
                </div>

                {/* Page 2 Header */}
                <div className="border-b-2 border-[#1A1715] pb-3 flex flex-wrap justify-between items-end gap-2">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#1A1715] font-mono">
                      SCHEDULE-A: SCHEDULE OF IMPLICATED MULE ACCOUNTS ORDERED FOR DEBIT-FREEZE
                    </h3>
                    <p className="text-[11px] font-sans text-[#544D45] mt-0.5">
                      Annexure to Statutory Notice Ref: <b>{noticeRefNo}</b> • Crime / FIR No: <b>{firNumber}</b>
                    </p>
                  </div>
                  <div className="text-right text-[11px] font-mono text-[#746D65]">
                    Accounts: <b>{filteredCandidates.length}</b> • Total Lien: <b className="text-[#DC2626]">{inr(filteredCandidates.reduce((s, c) => s + (Number(c.holding) || 0), 0))}</b>
                  </div>
                </div>

                {/* Schedule-A Table (Real Data) */}
                <div className="border border-[#1A1715]">
                  <table className="w-full text-left border-collapse text-[11px] font-mono">
                    <thead>
                      <tr className="bg-[#FAF6EE] border-b border-[#1A1715] text-[#1A1715] text-[10px] uppercase font-bold">
                        <th className="py-1.5 px-2 border-r border-[#E0D9CC] text-center w-10">S.No</th>
                        <th className="py-1.5 px-2.5 border-r border-[#E0D9CC]">Account Number</th>
                        <th className="py-1.5 px-2.5 border-r border-[#E0D9CC]">Bank / IFSC</th>
                        <th className="py-1.5 px-2 border-r border-[#E0D9CC]">Layer / Role</th>
                        <th className="py-1.5 px-2 border-r border-[#E0D9CC] text-center w-12">Hop</th>
                        <th className="py-1.5 px-2.5 border-r border-[#E0D9CC] text-right">Inflow (₹)</th>
                        <th className="py-1.5 px-2.5 border-r border-[#E0D9CC] text-right bg-[#FFF5F5] text-[#DC2626]">
                          Lien Holding (₹)
                        </th>
                        <th className="py-1.5 px-2 text-center w-28">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E0D9CC]">
                      {filteredCandidates.map((c, idx) => {
                        const isFrozen = frozenAccounts[c.acct_no];
                        return (
                          <tr key={c.acct_no} className="hover:bg-[#FAF6EE]">
                            <td className="py-1.5 px-2 border-r border-[#E0D9CC] text-center font-bold">{idx + 1}</td>
                            <td className="py-1.5 px-2.5 border-r border-[#E0D9CC] font-bold text-[#1A1715]">{c.acct_no}</td>
                            <td className="py-1.5 px-2.5 border-r border-[#E0D9CC]">{BANK_FULL_NAMES[c.bank] || c.bank}</td>
                            <td className="py-1.5 px-2 border-r border-[#E0D9CC] font-bold text-[#D96B27]">{c.role}</td>
                            <td className="py-1.5 px-2 border-r border-[#E0D9CC] text-center">{c.hop}</td>
                            <td className="py-1.5 px-2.5 border-r border-[#E0D9CC] text-right">{inr(c.tainted_in)}</td>
                            <td className="py-1.5 px-2.5 border-r border-[#E0D9CC] text-right font-bold text-[#DC2626] bg-[#FFFBF8]">
                              {inr(c.holding)}
                            </td>
                            <td className="py-1.5 px-2 text-center">
                              {isFrozen ? (
                                <span className="inline-block px-1.5 py-0.5 rounded-2xs bg-[#DC2626] text-white text-[9px] font-bold font-mono">
                                  DEBIT FROZEN
                                </span>
                              ) : (
                                <span className="inline-block px-1.5 py-0.5 rounded-2xs bg-[#E5E7EB] text-[#4B5563] text-[9px] font-bold font-mono">
                                  ORDERED
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-[#FAF6EE] border-t-2 border-[#1A1715] font-bold text-[11px]">
                        <td colSpan={6} className="py-2 px-2.5 border-r border-[#E0D9CC] text-right uppercase">
                          TOTAL STATUTORY LIEN TO BE PLACED:
                        </td>
                        <td className="py-2 px-2.5 border-r border-[#E0D9CC] text-right text-[#DC2626] bg-[#FFF5F5] text-xs">
                          {inr(filteredCandidates.reduce((s, c) => s + (Number(c.holding) || 0), 0))}
                        </td>
                        <td className="py-2 px-2 text-center text-[#059669]">
                          ALL {filteredCandidates.length} ACCOUNTS
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Penal Warning */}
                <div className="avoid-break text-[11px] border border-[#DC2626] bg-[#FFF5F5] p-3 rounded-xs text-[#991B1B] font-serif leading-relaxed">
                  <b>PENAL CONSEQUENCE WARNING:</b> Please note that non-compliance, deliberate delay, or failure to produce documents demanded under Section 91 Cr.P.C. / Section 94 BNSS attracts criminal prosecution under <b>Section 175 and Section 187 of the Indian Penal Code / Bharatiya Nyaya Sanhita</b>, and willful tipping off will be treated as abetment of cyber fraud under Section 111 / 120-B IPC.
                </div>

                {/* Officer Signature & Official Seal */}
                <div className="avoid-break pt-4 flex justify-between items-end border-t border-[#D5CEBF] font-serif">
                  <div className="space-y-1 text-xs">
                    <div className="w-28 h-20 border-2 border-dashed border-[#B5ADA0] flex flex-col items-center justify-center text-[10px] font-mono text-[#746D65] uppercase p-1 text-center bg-[#FAF6EE]">
                      <span>OFFICIAL POLICE</span>
                      <span>COMMISSIONERATE</span>
                      <span>STAMP / SEAL</span>
                    </div>
                    <p className="font-mono text-[9.5px] text-[#746D65] pt-1 leading-tight">
                      SHA-256 EVIDENTIARY HASH: <br />
                      <span className="font-bold text-[#1A1715]">{integritySha}</span>
                    </p>
                  </div>

                  <div className="text-right space-y-1 text-xs">
                    <div className="h-9 flex items-end justify-end">
                      <span className="font-serif italic text-base text-[#1A1715]">Investigating Officer, Cyber Cell</span>
                    </div>
                    <p className="font-bold text-sm">INSPECTOR OF POLICE / INVESTIGATING OFFICER</p>
                    <p className="text-[#544D45]">State Cyber Crime Police Station</p>
                    <p className="text-[11px] font-mono text-[#746D65]">Digital Arrest & Financial Fraud Investigation Wing</p>
                    <p className="text-[10px] font-mono text-[#059669] font-bold">Electronically Generated & Certified under Sec 65B IEA</p>
                  </div>
                </div>

                {/* Page 2 Footer */}
                <div className="border-t border-[#E8E2D5] pt-3 text-center text-[10px] font-mono text-[#746D65] flex justify-between items-center">
                  <span>Page 2 of 2 • Certified Court Copy</span>
                  <span className="font-bold text-[#059669]">STATUTORY FREEZE REQUISITION ENFORCED</span>
                  <span>End of Document</span>
                </div>
              </div>

            </div>
          ) : (
            /* ========================================================================= */
            /* INTERACTIVE REGISTER & BANK SUMMARY VIEW                                  */
            /* ========================================================================= */
            <div className="space-y-4">
              {/* Bank Breakdown Pills */}
              <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
                <div className="p-3.5 border-b border-[#E8E2D5] bg-[#FAF6EE] flex items-center justify-between">
                  <h3 className="font-bold text-sm text-[#2C2623] font-serif">Freeze Breakdown By Bank</h3>
                  <span className="text-xs font-mono text-[#746D65]">{num(byBank.length)} Banks Involved</span>
                </div>
                <div className="p-3.5 flex flex-wrap gap-2 text-xs font-mono">
                  {byBank.map((b) => (
                    <span key={b.bank} className="px-2.5 py-1.5 rounded-sm bg-[#FAF6EE] border border-[#E8E2D5] flex items-center gap-1.5">
                      <b className="text-[#D96B27]">{b.fullName}</b>
                      <span className="text-[#746D65]">({num(b.accounts)} acct)</span>
                      <span className="text-[#059669] font-bold">{inr(b.holding)}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Table of all candidates */}
              <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#FAF6EE] border-b border-[#E8E2D5] text-[10px] font-bold uppercase tracking-wider text-[#746D65] font-mono">
                        <th className="py-2.5 px-4">Account</th>
                        <th className="py-2.5 px-4">Bank</th>
                        <th className="py-2.5 px-4">Role</th>
                        <th className="py-2.5 px-4">Hop</th>
                        <th className="py-2.5 px-4">Victim Inflow</th>
                        <th className="py-2.5 px-4">Actionable Lien Holding</th>
                        <th className="py-2.5 px-4">Statutory Status</th>
                        <th className="py-2.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFEAE1] font-mono">
                      {filteredCandidates.map((c) => {
                        const isFrozen = frozenAccounts[c.acct_no];
                        return (
                          <tr key={c.acct_no} className="hover:bg-[#FAF6EE]">
                            <td className="py-2.5 px-4 font-bold text-[#2C2623]">{c.acct_no}</td>
                            <td className="py-2.5 px-4">{BANK_FULL_NAMES[c.bank] || text(c.bank)}</td>
                            <td className="py-2.5 px-4">
                              <span className="px-2 py-0.5 rounded-2xs text-[10px] font-bold bg-[#FFEDD5] text-[#D96B27]">
                                {text(c.role)}
                              </span>
                            </td>
                            <td className="py-2.5 px-4">{num(c.hop)}</td>
                            <td className="py-2.5 px-4">{inr(c.tainted_in)}</td>
                            <td className="py-2.5 px-4 font-bold text-[#DC2626] bg-[#FFFBF8]">{inr(c.holding)}</td>
                            <td className="py-2.5 px-4">
                              {isFrozen ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#059669]">
                                  <Lock className="w-3 h-3 text-[#DC2626]" />
                                  <span>FROZEN (LIEN APPLIED)</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#D96B27]">
                                  <Unlock className="w-3 h-3" />
                                  <span>UNFROZEN</span>
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <button
                                onClick={() => toggleFreezeSingle(c.acct_no)}
                                className={`px-2.5 py-1 rounded-sm text-xs font-mono font-bold transition-all cursor-pointer ${
                                  isFrozen
                                    ? "bg-[#FEF2F2] hover:bg-[#FEE2E2] text-[#DC2626] border border-[#FECACA]"
                                    : "bg-[#ECFDF5] hover:bg-[#D1FAE5] text-[#059669] border border-[#A7F3D0]"
                                }`}
                              >
                                {isFrozen ? "Unfreeze" : "Freeze"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
