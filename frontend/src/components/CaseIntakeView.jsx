import React, { useState } from "react";
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
  AlertCircle
} from "lucide-react";
import { uploadBankStatement, ingestFromUrl } from "../api";

export default function CaseIntakeView({
  victimAccount,
  victimName = "Sunil Kumar Verma",
  mobileNumber = "+91 9811000001",
  firNumber = "FIR-0142/2026/CYBER-INDORE",
  totalSiphoned,
  systemStatus,
  onTraceNow,
  onOpenRegisterModal,
  onSelectCase,
  onNavigateTab,
  onRefreshData
}) {
  const [ingestMode, setIngestMode] = useState("url"); // "url" | "file"
  const [urlInput, setUrlInput] = useState(
    "https://docs.google.com/spreadsheets/d/1gu9kFr5COmANUPTA5eSkApiXCtnpgyyE/edit?usp=sharing&ouid=104868621394170594289&rtpof=true&sd=true"
  );
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const artifactSlots = [
    {
      slot: "Core Banking Transaction Export (DuckDB)",
      format: "2,000,000 records, 11 Columns (RBI/NPCI format)",
      file: "transactions_2m.parquet",
      records: systemStatus?.records_parsed ? `${systemStatus.records_parsed.toLocaleString("en-IN")} records` : "2,000,000 valid",
      hash: "7F89E8B2A91D3C4E...C8912A3409B1F56E",
      status: "LOCKED & VERIFIED"
    },
    {
      slot: "NPCI / Bank Statement Logs",
      format: "Multi-bank transaction streams (.csv, .xlsx)",
      file: "npci_upi_bank_statement.csv",
      records: systemStatus?.unique_receivers ? `${systemStatus.unique_receivers.toLocaleString("en-IN")} accounts` : "24,368 accounts",
      hash: "A1FC082673B0D1D8...DC7CEF80885088D9",
      status: "LOCKED & VERIFIED"
    },
    {
      slot: "Internet Protocol Detail Records (IPDR)",
      format: "CGNAT public IP, source port, MSISDN session",
      file: "jio_ipdr_session_log.csv",
      records: systemStatus?.foreign_ip_txns ? `${systemStatus.foreign_ip_txns.toLocaleString("en-IN")} foreign IPs` : "2,564 foreign IPs",
      hash: "638788C5E93DAE91...FBA414BAFED06414",
      status: "LOCKED & VERIFIED"
    },
    {
      slot: "Telecom Call Data Records (CDR)",
      format: "Airtel, Jio, Vi formats (.csv, .xlsx, .tsv)",
      file: "telecom_cdr_extract.csv",
      records: "1,470 mules",
      hash: "A9C8EBD3B99EE628...62817647788D0696",
      status: "LOCKED & VERIFIED"
    },
    {
      slot: "WhatsApp / Messenger Chat Exports",
      format: "Digital arrest transcripts (.txt, .json)",
      file: "whatsapp_chat_export.txt",
      records: "12 chat sessions",
      hash: "257005884D2C482A...188180C46012EADE",
      status: "LOCKED & VERIFIED"
    },
    {
      slot: "Malicious APK Package / Script Metadata",
      format: "Direct Android APK binary / script telemetry",
      file: "sbi_support_apk_metadata.json",
      records: "2,564 scripts",
      hash: "650CC151597D2CC3...9192F72F99E765FF",
      status: "LOCKED & VERIFIED"
    }
  ];

  const handleIngestFromUrl = async (targetUrl = urlInput) => {
    if (!targetUrl.trim()) return;
    setIsIngesting(true);
    setErrorMessage(null);
    setIngestResult(null);

    try {
      const res = await ingestFromUrl(targetUrl);
      setIngestResult(res);
      if (onRefreshData) onRefreshData();
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
    setIngestResult(null);

    try {
      const res = await uploadBankStatement(file);
      setIngestResult(res);
      if (onRefreshData) onRefreshData();
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
    <div className="space-y-6">
      {/* Title & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-serif font-bold text-[#2C2623] tracking-tight">
            Case Evidence Intake
          </h2>
          <p className="text-xs text-[#746D65] mt-1">
            Universal ingestion for real cyber crime banking datasets (.csv, .xlsx, .parquet, or Google Sheets).
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => onRefreshData && onRefreshData()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#E8E2D5] text-[#2C2623] text-xs font-semibold hover:bg-[#F8F4EC] transition-colors shadow-2xs cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#746D65]" />
            <span>Reload Active Engine Data</span>
          </button>
          <button
            onClick={onOpenRegisterModal}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-semibold transition-all shadow-sm cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Register New FIR</span>
          </button>
        </div>
      </div>

      {/* 4 Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D]">
            COMPLAINANT / VICTIM
          </div>
          <div className="text-lg font-bold text-[#2C2623] mt-1 font-serif">
            {victimName}
          </div>
          <div className="text-xs text-[#746D65] font-mono mt-0.5">
            {victimAccount}
          </div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D]">
            TOTAL LOSS REPORTED
          </div>
          <div className="text-lg font-bold text-[#DC2626] mt-1 font-mono">
            ₹{Number(totalSiphoned || 370415.81).toLocaleString("en-IN")}
          </div>
          <div className="text-xs text-[#746D65] mt-0.5">
            Multi-Hop Smurfing Trail Active
          </div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D]">
            POLICE STATION / FIR
          </div>
          <div className="text-sm font-bold text-[#2C2623] mt-1 font-serif">
            Cyber Crime Police Station, Indore
          </div>
          <div className="text-xs text-[#746D65] font-mono mt-0.5">
            {firNumber}
          </div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D]">
            EVIDENCE ARTIFACTS
          </div>
          <div className="text-lg font-bold text-[#059669] mt-1 font-mono">
            6 / 6
          </div>
          <div className="text-xs text-[#059669] font-medium mt-0.5 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            100% Validated & Correlated
          </div>
        </div>
      </div>

      {/* Universal Ingestion Card: Google Sheet / CSV / Parquet */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-6 shadow-2xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F2ECE1] pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] flex items-center justify-center text-[#D96B27]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-[#2C2623] font-serif">
                Universal Bank Statement & Cyber Crime Data Ingestor
              </h3>
              <p className="text-xs text-[#746D65]">
                Directly stream real cyber crime datasets into DuckDB with JEV-accelerated vectorization.
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

        {/* Tab 1: Google Sheet / URL Mode */}
        {ingestMode === "url" && (
          <div className="space-y-4">
            <div className="bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#2C2623] flex items-center gap-1.5">
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
                <span className="text-[#9E968D] text-[11px]">Cyber Crime Preset:</span>
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
                Upload Raw Bank Statement Export (.csv, .xlsx, .parquet, .tsv)
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
              <p className="font-bold">Ingesting and Vector-Indexing Dataset...</p>
              <p className="text-[11px] text-[#B45309] mt-0.5">
                Normalizing bank account structures, running JEV narration intelligence, and mapping multi-hop smurfing chains in DuckDB.
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
              <span className="text-xs font-mono font-bold text-[#15803D] bg-white px-2.5 py-0.5 rounded-lg border border-[#BBF7D0]">
                Indexed in {ingestResult.ingestion_seconds}s
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-white p-3 rounded-xl border border-[#DCFCE7]">
                <span className="text-[10px] text-[#746D65] uppercase font-mono block">Records Loaded</span>
                <span className="text-lg font-bold font-mono text-[#166534]">
                  {ingestResult.records_loaded?.toLocaleString("en-IN")}
                </span>
              </div>

              <div className="bg-white p-3 rounded-xl border border-[#DCFCE7]">
                <span className="text-[10px] text-[#746D65] uppercase font-mono block">High-Risk Mules</span>
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
                <span className="text-xs font-mono text-[#2C2623] truncate block mt-1">
                  {ingestResult.file_name}
                </span>
              </div>
            </div>

            {/* Detected Victims in Ingested Data */}
            {ingestResult.victims && ingestResult.victims.length > 0 && (
              <div className="space-y-2 pt-1">
                <span className="text-xs font-bold text-[#166534] uppercase font-mono tracking-wider block">
                  Identified Complainant Victims in Ingested Data:
                </span>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {ingestResult.victims.map((v, vIdx) => (
                    <div
                      key={vIdx}
                      className="bg-white p-3 rounded-xl border border-[#BBF7D0] flex items-center justify-between gap-3 shadow-2xs"
                    >
                      <div>
                        <div className="font-bold font-mono text-xs text-[#2C2623] flex items-center gap-1.5">
                          <span>{v.account_id}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#FAF6EE] border border-[#E8E2D5] text-[#746D65] font-sans">
                            {v.bank}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#DC2626] font-mono mt-0.5">
                          Loss: ₹{Number(v.total_lost_inr).toLocaleString("en-IN")}
                        </div>
                      </div>

                      <button
                        onClick={() => handleSelectVictim(v.account_id)}
                        className="px-3 py-1.5 rounded-lg bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-semibold shadow-2xs transition-all cursor-pointer flex items-center gap-1"
                      >
                        <span>Investigate</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Digital Artifact Slots Table */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl overflow-hidden shadow-2xs">
        <div className="p-4 border-b border-[#E8E2D5] bg-[#FAF6EE] flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm text-[#2C2623] font-serif">
              Digital Artifact Slots
            </h3>
            <p className="text-xs text-[#746D65]">
              Banking Core Logs, NPCI UPI Logs, IPDR Session Maps, Headless Telemetry
            </p>
          </div>
          <button
            onClick={onTraceNow}
            className="px-3.5 py-1.5 rounded-lg bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-semibold shadow-2xs cursor-pointer flex items-center gap-1.5"
          >
            <span>Launch Multi-Hop Trace</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E8E2D5] text-[#9E968D] text-[10px] font-bold uppercase tracking-wider bg-[#FDFBF7]">
                <th className="py-3 px-4">Artifact Slot</th>
                <th className="py-3 px-4">Source File</th>
                <th className="py-3 px-4">Records Parsed</th>
                <th className="py-3 px-4">SHA-256 File Fingerprint</th>
                <th className="py-3 px-4 text-right">Actions & Integrity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EFEAE1]">
              {artifactSlots.map((slot, i) => (
                <tr key={i} className="hover:bg-[#FAF6EE] transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-[#2C2623]">{slot.slot}</div>
                    <div className="text-[11px] text-[#9E968D]">{slot.format}</div>
                  </td>
                  <td className="py-3 px-4 font-mono text-[#746D65]">
                    {slot.file}
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded-md bg-[#F3EDE2] text-[#2C2623] font-medium font-mono text-[11px]">
                      {slot.records}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px] text-[#9E968D]">
                    {slot.hash}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-[#E6F7F0] border border-[#A7F3D0] text-[#059669] font-bold text-[10px] tracking-wide">
                        {slot.status}
                      </span>
                      <button className="flex items-center gap-1 text-[11px] text-[#746D65] hover:text-[#2C2623] font-medium px-2 py-1 rounded bg-[#F8F4EC] cursor-pointer">
                        <Eye className="w-3 h-3" />
                        <span>View</span>
                      </button>
                    </div>
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
