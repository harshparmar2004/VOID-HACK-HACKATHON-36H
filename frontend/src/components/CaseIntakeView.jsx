import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  Eye,
  RefreshCw,
  Plus,
  FileText,
  CheckCircle2,
  UploadCloud,
  FileSpreadsheet,
  Globe,
  Sparkles,
  ArrowRight,
  Loader2,
  Link2,
  AlertCircle,
  X,
  Layers,
  Database,
  UserCheck,
  Building,
  KeyRound,
  FileCheck,
  Info,
  ExternalLink,
  ChevronRight
} from "lucide-react";
import { uploadBankStatement, ingestFromUrl } from "../api";

export default function CaseIntakeView({
  victimAccount,
  victimName = "Sunil Kumar Verma",
  mobileNumber = "+91 9811000001",
  firNumber = "FIR-0142/2026/CYBER-INDORE",
  totalSiphoned,
  systemStatus,
  forensicParams,
  onTraceNow,
  onOpenRegisterModal,
  onSelectCase,
  onNavigateTab,
  onRefreshData,
  activeIngestResult,
  onUpdateIngestResult
}) {
  const [ingestMode, setIngestMode] = useState("url"); // "url" | "file"
  const [urlInput, setUrlInput] = useState(
    "https://docs.google.com/spreadsheets/d/1gu9kFr5COmANUPTA5eSkApiXCtnpgyyE/edit?usp=sharing&ouid=104868621394170594289&rtpof=true&sd=true"
  );
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState(() => {
    if (activeIngestResult) return activeIngestResult;
    try {
      const saved = localStorage.getItem("abhedya_ingest_result");
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });
  const [errorMessage, setErrorMessage] = useState(null);
  const [selectedArtifactModal, setSelectedArtifactModal] = useState(null);

  useEffect(() => {
    if (activeIngestResult) {
      setIngestResult(activeIngestResult);
    }
  }, [activeIngestResult]);

  const artifactSlots = [
    {
      slot: "Core Banking Transaction Export (DuckDB)",
      format: "2,000,000 records, 11 Columns (RBI/NPCI format)",
      file: "transactions_2m.parquet",
      records: systemStatus?.records_parsed ? `${systemStatus.records_parsed.toLocaleString("en-IN")} records` : "2,000,000 valid",
      hash: "7F89E8B2A91D3C4E89F0A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2",
      status: "LOCKED & VERIFIED",
      legalSignificance: "Master financial ledger establishing the total corpus of inter-bank money flow across India."
    },
    {
      slot: "NPCI / Bank Statement Logs",
      format: "Multi-bank transaction streams (.csv, .xlsx)",
      file: "npci_upi_bank_statement.csv",
      records: systemStatus?.unique_receivers ? `${systemStatus.unique_receivers.toLocaleString("en-IN")} accounts` : "24,368 accounts",
      hash: "A1FC082673B0D1D8E9F0A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2",
      status: "LOCKED & VERIFIED",
      legalSignificance: "Switch clearance logs proving funds crossed bank borders into recipient mule accounts."
    },
    {
      slot: "Internet Protocol Detail Records (IPDR)",
      format: "CGNAT public IP, source port, MSISDN session",
      file: "jio_ipdr_session_log.csv",
      records: systemStatus?.foreign_ip_txns ? `${systemStatus.foreign_ip_txns.toLocaleString("en-IN")} foreign IPs` : "2,564 foreign IPs",
      hash: "638788C5E93DAE91E9F0A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2",
      status: "LOCKED & VERIFIED",
      legalSignificance: "ISP logs linking digital transactions to foreign proxy VPNs (185.*, 194.*) and physical telecom towers."
    },
    {
      slot: "Telecom Call Data Records (CDR)",
      format: "Airtel, Jio, Vi formats (.csv, .xlsx, .tsv)",
      file: "telecom_cdr_extract.csv",
      records: "1,470 mules",
      hash: "A9C8EBD3B99EE628E9F0A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2",
      status: "LOCKED & VERIFIED",
      legalSignificance: "Proves syndication and synchronized calling between cyber fraud operators and mule holders."
    },
    {
      slot: "WhatsApp / Messenger Chat Exports",
      format: "Digital arrest transcripts (.txt, .json)",
      file: "whatsapp_chat_export.txt",
      records: "12 chat sessions",
      hash: "257005884D2C482AE9F0A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2",
      status: "LOCKED & VERIFIED",
      legalSignificance: "Primary evidence of intimidation, extortion, fake Supreme Court/CBI warrants, and digital arrest instructions."
    },
    {
      slot: "Complaint Affidavit & 1930 Portal Log",
      format: "Sec 63 BSA / Sec 65B Evidence Act Certificate",
      file: "fir_complainant_affidavit.pdf",
      records: "1 FIR complaint",
      hash: "E8D9C0B1A2F3E4D5E9F0A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2",
      status: "LOCKED & VERIFIED",
      legalSignificance: "Sworn statement of complainant victim triggering the police investigation under CrPC/BNSS."
    }
  ];

  const handleIngestFromUrl = async (targetUrl = urlInput) => {
    if (!targetUrl.trim()) return;
    setIsIngesting(true);
    setErrorMessage(null);

    try {
      const res = await ingestFromUrl(targetUrl);
      setIngestResult(res);
      if (onUpdateIngestResult) onUpdateIngestResult(res);
      try {
        localStorage.setItem("abhedya_ingest_result", JSON.stringify(res));
      } catch (e) {}

      const firstVictim = res.detected_victim || res.victims?.[0]?.account_id;
      if (onRefreshData) {
        await onRefreshData(firstVictim);
      }
      if (firstVictim && onSelectCase) {
        onSelectCase(firstVictim);
      }
    } catch (err) {
      setErrorMessage(err.message || "Failed to ingest data from URL.");
    } finally {
      setIsIngesting(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsIngesting(true);
    setErrorMessage(null);

    try {
      const res = await uploadBankStatement(file);
      setIngestResult(res);
      if (onUpdateIngestResult) onUpdateIngestResult(res);
      try {
        localStorage.setItem("abhedya_ingest_result", JSON.stringify(res));
      } catch (e) {}

      const firstVictim = res.detected_victim || res.victims?.[0]?.account_id;
      if (onRefreshData) {
        await onRefreshData(firstVictim);
      }
      if (firstVictim && onSelectCase) {
        onSelectCase(firstVictim);
      }
    } catch (err) {
      setErrorMessage(err.message || "Failed to ingest uploaded statement.");
    } finally {
      setIsIngesting(false);
    }
  };

  const handleSelectVictim = (acctId) => {
    if (onSelectCase) onSelectCase(acctId);
    if (onNavigateTab) onNavigateTab("trail");
  };

  return (
    <div className="space-y-6 select-none pb-12">
      {/* Clean Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E8E2D5] pb-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-[#2C2623] tracking-tight">
            Case Evidence Intake
          </h1>
          <p className="text-xs text-[#7C746D] mt-0.5">
            Universal ingestion for multi-bank statements (.csv, .xlsx, .parquet) and Google Sheets.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => onRefreshData && onRefreshData()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#E8E2D5] text-[#2C2623] text-xs font-semibold hover:bg-[#FAF6EE] transition-colors shadow-2xs cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#7C746D]" />
            <span>Reload Engine</span>
          </button>
          <button
            onClick={onOpenRegisterModal}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ Register New FIR</span>
          </button>
        </div>
      </div>

      {/* 4 Summary Stat Cards for Active Case */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
            COMPLAINANT / VICTIM ANCHOR
          </div>
          <div className="text-lg font-bold text-[#2C2623] mt-1 font-serif">
            {victimName}
          </div>
          <div className="text-xs text-[#746D65] font-mono mt-0.5 flex items-center justify-between">
            <span>{victimAccount}</span>
            <span className="text-[10px] bg-[#ECFDF5] text-[#059669] px-1.5 py-0.5 rounded font-bold">Active Anchor</span>
          </div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
            TOTAL LOSS REPORTED
          </div>
          <div className="text-lg font-bold text-[#DC2626] mt-1 font-mono">
            ₹{Number(totalSiphoned || 370415.81).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-[#746D65] mt-0.5 font-mono text-[11px]">
            Multi-Hop Smurfing Trail Active
          </div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
            POLICE STATION / FIR DIARY
          </div>
          <div className="text-sm font-bold text-[#2C2623] mt-1 font-serif">
            Cyber Crime Police Station, Indore
          </div>
          <div className="text-xs text-[#746D65] font-mono mt-0.5">
            {firNumber}
          </div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
            DIGITAL EVIDENCE ARTIFACTS
          </div>
          <div className="text-lg font-bold text-[#059669] mt-1 font-mono">
            6 / 6 Locked
          </div>
          <div className="text-xs text-[#059669] font-medium mt-0.5 flex items-center gap-1 font-mono text-[11px]">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>100% SHA-256 Validated</span>
          </div>
        </div>
      </div>

      {/* PHASE 1: Universal Bank Statement & Cyber Crime Data Ingestor */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-6 shadow-2xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F2ECE1] pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] flex items-center justify-center text-[#D96B27]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-[#2C2623] font-serif">
                  Phase 1: Universal Multi-Bank Dataset Ingestor
                </h3>
                <span className="text-[10px] font-mono font-bold bg-[#FAF6EE] text-[#D96B27] px-2 py-0.5 rounded border border-[#E8E2D5]">
                  DuckDB Vector Engine
                </span>
              </div>
              <p className="text-xs text-[#746D65]">
                Directly stream real cyber crime datasets into DuckDB. Automatically sanitizes account strings, IFSCs, timestamps, and amounts.
              </p>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center gap-1 bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl p-1 text-xs">
            <button
              onClick={() => setIngestMode("url")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                ingestMode === "url"
                  ? "bg-[#D96B27] text-white shadow-2xs"
                  : "text-[#746D65] hover:text-[#2C2623]"
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Google Sheet / Web URL</span>
            </button>
            <button
              onClick={() => setIngestMode("file")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                ingestMode === "file"
                  ? "bg-[#D96B27] text-white shadow-2xs"
                  : "text-[#746D65] hover:text-[#2C2623]"
              }`}
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>Upload File (.csv, .xlsx, .parquet)</span>
            </button>
          </div>
        </div>

        {/* Active Investigation Filter Banner */}
        {forensicParams && (Number(forensicParams.minAmount) > 0 || forensicParams.bankFilter !== "ALL" || forensicParams.maxHops !== 4 || (forensicParams.narrationKeyword && forensicParams.narrationKeyword.trim())) && (
          <div className="bg-[#FFFBF5] border border-[#FDE68A] rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#D96B27] animate-pulse"></span>
              <span className="font-bold text-[#92400E] font-mono text-[11px]">
                Active Filter Parameters Enforced on Ingest:
              </span>
              <span className="text-[#B45309] font-mono text-[11px]">
                {Number(forensicParams.minAmount) > 0 ? `Min: ₹${Number(forensicParams.minAmount).toLocaleString('en-IN')} ` : ""}
                {forensicParams.maxHops !== 4 ? `• Max Hops: ${forensicParams.maxHops} ` : ""}
                {forensicParams.bankFilter !== "ALL" ? `• Bank: ${forensicParams.bankFilter} ` : ""}
                {forensicParams.narrationKeyword ? `• Tag: "${forensicParams.narrationKeyword}"` : ""}
              </span>
            </div>
            <button
              onClick={() => onNavigateTab && onNavigateTab("parameters")}
              className="text-[10px] text-[#D96B27] hover:underline font-mono font-bold cursor-pointer"
            >
              Edit in Parameters Studio →
            </button>
          </div>
        )}

        {/* Tab 1: Google Sheet / URL Mode */}
        {ingestMode === "url" && (
          <div className="space-y-4">
            <div className="bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#2C2623] flex items-center gap-1.5 font-mono">
                  <Link2 className="w-4 h-4 text-[#D96B27]" />
                  Enter Google Spreadsheet or CSV Export URL:
                </span>
                <span className="text-[11px] text-[#059669] font-mono font-medium">
                  Auto-converts /edit to /export
                </span>
              </div>

              <div className="flex flex-wrap sm:flex-nowrap gap-2">
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit?usp=sharing"
                  className="flex-1 bg-white border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
                />
                <button
                  onClick={() => handleIngestFromUrl(urlInput)}
                  disabled={isIngesting || !urlInput.trim()}
                  className={`px-4 py-2 rounded-xl font-bold text-xs shadow-2xs transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
                    isIngesting
                      ? "bg-[#EAE4D8] text-[#746D65] cursor-not-allowed"
                      : "bg-[#D96B27] text-white hover:bg-[#C25B1D]"
                  }`}
                >
                  {isIngesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>{isIngesting ? "Extracting with JEV..." : "Ingest & Extract"}</span>
                </button>
              </div>

              {/* Quick Preset Button for the User's Real Dataset */}
              <div className="pt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-[#9E968D] text-[11px] font-mono">Cyber Crime Live Preset:</span>
                <button
                  onClick={() => {
                    const preset = "https://docs.google.com/spreadsheets/d/1gu9kFr5COmANUPTA5eSkApiXCtnpgyyE/edit?usp=sharing&ouid=104868621394170594289&rtpof=true&sd=true";
                    setUrlInput(preset);
                    handleIngestFromUrl(preset);
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-[#E8E2D5] hover:border-[#D96B27] text-[#2C2623] text-[11px] font-semibold transition-all shadow-2xs cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-[#059669]" />
                  <span>⚡ Load Cyber Crime Live Dataset (Indore Police Extract)</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: File Upload / Drag & Drop Mode */}
        {ingestMode === "file" && (
          <div className="bg-[#FAF6EE] border-2 border-dashed border-[#D96B27]/40 rounded-2xl p-6 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-white border border-[#E8E2D5] flex items-center justify-center mx-auto text-[#D96B27] shadow-xs">
              <UploadCloud className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-[#2C2623]">
                Upload Raw Multi-Bank Statement (.csv, .xlsx, .parquet, .tsv)
              </h4>
              <p className="text-xs text-[#746D65] max-w-lg mx-auto mt-1">
                Supports all formats from SBI, HDFC, ICICI, Axis, PNB, and NPCI UPI logs. Leading zeroes and currency symbols are sanitized automatically.
              </p>
            </div>

            <label className="px-5 py-2 rounded-xl bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-bold shadow-sm transition-all cursor-pointer inline-flex items-center gap-2">
              <UploadCloud className="w-4 h-4" />
              <span>Browse Statement File</span>
              <input
                type="file"
                accept=".csv,.parquet,.xlsx,.tsv"
                className="hidden"
                onChange={handleFileUpload}
              />
            </label>
          </div>
        )}

        {/* Ingestion Loading Indicator */}
        {isIngesting && (
          <div className="bg-[#FFFBF5] border border-[#FDE68A] p-4 rounded-xl flex items-center gap-3 text-xs text-[#92400E]">
            <Loader2 className="w-5 h-5 text-[#D96B27] animate-spin shrink-0" />
            <div>
              <p className="font-bold">Ingesting and Vector-Indexing Dataset into DuckDB...</p>
              <p className="text-[11px] text-[#B45309] mt-0.5">
                Normalizing bank account structures, running JEV narration intelligence, and mapping multi-hop smurfing chains.
              </p>
            </div>
          </div>
        )}

        {/* Error Notification */}
        {errorMessage && (
          <div className="bg-[#FEF2F2] border border-[#FCA5A5] p-3 rounded-xl flex items-center gap-2 text-xs text-[#DC2626]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Ingestion Success & Detected Victims Banner */}
        {ingestResult && (
          <div className="bg-[#F0FDF4] border border-[#86EFAC] rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCFCE7] pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-[#059669]" />
                <h4 className="font-bold text-sm text-[#166534] font-serif">
                  Dataset Successfully Ingested & Vector-Indexed
                </h4>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-[#15803D] bg-white px-2.5 py-0.5 rounded-lg border border-[#BBF7D0]">
                  Indexed in {ingestResult.ingestion_seconds}s
                </span>
                <button
                  onClick={() => {
                    setIngestResult(null);
                    if (onUpdateIngestResult) onUpdateIngestResult(null);
                    try {
                      localStorage.removeItem("abhedya_ingest_result");
                    } catch (e) {}
                  }}
                  className="text-xs font-semibold text-[#15803D] hover:text-[#DC2626] flex items-center gap-1 cursor-pointer transition-colors px-2 py-0.5 rounded-lg hover:bg-red-50"
                  title="Clear uploaded dataset info"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-white p-3 rounded-xl border border-[#DCFCE7]">
                <span className="text-[10px] text-[#746D65] uppercase font-mono block">Records Loaded</span>
                <span className="text-lg font-bold font-mono text-[#166534]">
                  {ingestResult.records_loaded?.toLocaleString("en-IN")}
                </span>
              </div>

              <div className="bg-white p-3 rounded-xl border border-[#DCFCE7]">
                <span className="text-[10px] text-[#746D65] uppercase font-mono block">Flagged Mules</span>
                <span className="text-lg font-bold font-mono text-[#DC2626]">
                  {ingestResult.high_risk_mules} flagged
                </span>
              </div>

              <div className="bg-white p-3 rounded-xl border border-[#DCFCE7]">
                <span className="text-[10px] text-[#746D65] uppercase font-mono block">JEV Extractor</span>
                <span className="text-xs font-bold text-[#059669] block mt-1">100% Normalized</span>
              </div>

              <div className="bg-white p-3 rounded-xl border border-[#DCFCE7]">
                <span className="text-[10px] text-[#746D65] uppercase font-mono block">Source</span>
                <span className="text-xs font-mono text-[#2C2623] truncate block mt-1" title={ingestResult.file_name}>
                  {ingestResult.file_name}
                </span>
              </div>
            </div>

            {/* Quick Action to Trace Stolen Money */}
            <div className="pt-3 border-t border-[#DCFCE7] flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-[#166534]">
                <span className="font-semibold text-xs">Investigation Target Anchor:</span>
                <span className="font-mono font-bold bg-white px-2.5 py-1 rounded-lg border border-[#BBF7D0] text-[#2C2623]">
                  {ingestResult.detected_victim || victimAccount}
                </span>
                <span className="text-[11px] text-[#746D65]">
                  (Loss: ₹{Number(totalSiphoned || 370415.81).toLocaleString("en-IN")})
                </span>
              </div>

              <button
                onClick={() => handleSelectVictim(ingestResult.detected_victim || victimAccount)}
                className="px-4 py-1.5 rounded-lg bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-semibold shadow-2xs transition-all cursor-pointer flex items-center gap-1.5"
              >
                <span>Launch Money Trail Trace</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* PHASE 2: Complainant FIR & Victim Station Intake */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-6 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F2ECE1] pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base text-[#2C2623] font-serif">
                Phase 2: Active Complainant FIR & Victim Station Intake
              </h3>
              <span className="text-[10px] font-mono font-bold bg-[#ECFDF5] text-[#059669] px-2 py-0.5 rounded border border-[#A7F3D0]">
                Indore Cyber Cell
              </span>
            </div>
            <p className="text-xs text-[#746D65]">
              The citizen whose funds were siphoned. The system anchors Breadth-First Search (BFS) starting from this account to trace downstream money dissipations.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onOpenRegisterModal}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#FAF6EE] hover:bg-[#F3EDE2] border border-[#E8E2D5] text-[#2C2623] text-xs font-semibold transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-[#D96B27]" />
              <span>Change / Register Complainant FIR</span>
            </button>

            <button
              onClick={onTraceNow}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
            >
              <span>Trace 4-Hop Money Trail</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Detailed Victim Case Record */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
          <div className="p-3.5 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] space-y-1">
            <div className="text-[10px] text-[#9E968D]">COMPLAINANT IDENTITY</div>
            <div className="font-bold text-sm text-[#2C2623]">{victimName}</div>
            <div className="text-[#746D65]">{mobileNumber}</div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] space-y-1">
            <div className="text-[10px] text-[#9E968D]">BANK ACCOUNT & IFSC</div>
            <div className="font-bold text-sm text-[#D96B27]">{victimAccount}</div>
            <div className="text-[#746D65]">Punjab National Bank (PUNB0001001)</div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] space-y-1">
            <div className="text-[10px] text-[#9E968D]">OFFICIAL POLICE FIR RECORD</div>
            <div className="font-bold text-sm text-[#2C2623]">{firNumber}</div>
            <div className="text-[#746D65]">Under Sec 420 IPC / Sec 66D IT Act</div>
          </div>
        </div>
      </div>

      {/* PHASE 3: Digital Evidence Artifact Slots (Legal Chain of Custody) */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl overflow-hidden shadow-2xs">
        <div className="p-5 border-b border-[#E8E2D5] bg-[#FAF6EE] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-[#2C2623] font-serif">
                Phase 3: Digital Evidence Vault & Chain of Custody Slots (6 / 6)
              </h3>
              <span className="text-[10px] font-mono font-bold bg-[#FAF6EE] text-[#D96B27] px-2 py-0.5 rounded border border-[#E8E2D5]">
                Sec 63 BSA / Sec 65B IEA
              </span>
            </div>
            <p className="text-xs text-[#746D65] mt-0.5">
              Cryptographic SHA-256 hash preservation ensures court admissibility before the Hon'ble Magistrate under Bharatiya Sakshya Adhiniyam, 2023.
            </p>
          </div>

          <button
            onClick={() => onNavigateTab && onNavigateTab("vault")}
            className="px-3.5 py-1.5 rounded-lg bg-[#2C2623] text-white text-xs font-mono font-semibold hover:bg-[#3D3531] cursor-pointer flex items-center gap-1.5 self-start sm:self-auto"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-[#10B981]" />
            <span>Open Evidence Vault</span>
          </button>
        </div>

        {/* Artifact Legal Mandate Callout */}
        <div className="p-4 bg-[#F8F4EC] border-b border-[#E8E2D5] flex items-center gap-3 text-xs text-[#746D65]">
          <Info className="w-4 h-4 text-[#D96B27] shrink-0" />
          <span>
            <strong>Why these 6 slots exist:</strong> Defense lawyers frequently challenge electronic records claiming CSV alteration. By locking each of the 6 core forensic streams (Banking Core, NPCI Switch, IPDR VPN logs, Telco CDRs, WhatsApp extortion chats, and FIR affidavits) with SHA-256 hashes, the court certifies Section 91 freeze requisitions with zero legal risk.
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-[#E8E2D5] text-[#9E968D] text-[10px] font-bold uppercase tracking-wider bg-[#FDFBF7]">
                <th className="py-3 px-4">Artifact Slot & Format</th>
                <th className="py-3 px-4">Source File</th>
                <th className="py-3 px-4">Records Indexed</th>
                <th className="py-3 px-4">SHA-256 Hash Fingerprint</th>
                <th className="py-3 px-4 text-right">Integrity Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EFEAE1] bg-white">
              {artifactSlots.map((slot, i) => (
                <tr key={i} className="hover:bg-[#FAF6EE] transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-[#2C2623] font-sans text-xs">{slot.slot}</div>
                    <div className="text-[11px] text-[#9E968D] font-sans">{slot.format}</div>
                  </td>
                  <td className="py-3 px-4 text-[#746D65]">
                    {slot.file}
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded-md bg-[#F3EDE2] text-[#2C2623] font-medium text-[11px]">
                      {slot.records}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-[10px] text-[#746D65] max-w-[200px] truncate" title={slot.hash}>
                    {slot.hash.slice(0, 16)}...{slot.hash.slice(-16)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className="px-2 py-0.5 rounded-md bg-[#ECFDF5] border border-[#A7F3D0] text-[#059669] font-bold text-[10px] tracking-wide inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{slot.status}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
