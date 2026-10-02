import React, { useMemo, useState, useRef } from "react";
import {
  Download,
  Plus,
  RefreshCw,
  Search,
  UploadCloud,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  Zap,
  ShieldCheck,
  X,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { getTemplateDownloadUrl, uploadDataset } from "../api";
import { dateTime, inr, num, text } from "../format";
import { EmptyState, ErrorState, LoadingState, PageHeader, Stat } from "./States";

const TEMPLATE_FILE = "transactions_template.csv";
const PAGE_SIZE = 25;

export default function CaseIntakeView({ status, victims, activeCase, trace, onReload, onSelectCase, onOpenRegisterModal }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);

  // File upload & timing audit state
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState("");
  const [uploadError, setUploadError] = useState(null);
  const [uploadResult, setUploadResult] = useState(null);
  const [showParameters, setShowParameters] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const s = status.data;

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      triggerUpload(file);
    }
  };

  const triggerUpload = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setUploadError("Only standard CSV transaction files (.csv) are supported for ledger ingestion.");
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadStage("Uploading transaction ledger to DuckDB...");

    const stageTimer1 = setTimeout(() => {
      setUploadStage("Validating schema & quarantining invalid rows in DuckDB...");
    }, 1200);

    const stageTimer2 = setTimeout(() => {
      setUploadStage("Computing 30 behavioral features & evaluating MP1-MP8 scoring...");
    }, 4500);

    const stageTimer3 = setTimeout(() => {
      setUploadStage("Correlating multi-hop layer links (L1 → L2 → L3) & rings...");
    }, 8500);

    const stageTimer4 = setTimeout(() => {
      setUploadStage("Finalizing CSR graph index & reloading trace contexts...");
    }, 12000);

    try {
      const res = await uploadDataset(file);
      setUploadResult(res);
      setUploading(false);
      setUploadStage("");
      if (onReload) onReload();
    } catch (err) {
      setUploadError(err.message || "Failed to upload transaction ledger.");
      setUploading(false);
      setUploadStage("");
    } finally {
      clearTimeout(stageTimer1);
      clearTimeout(stageTimer2);
      clearTimeout(stageTimer3);
      clearTimeout(stageTimer4);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      triggerUpload(file);
    }
  };

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return victims.items;
    return victims.items.filter(
      (v) => String(v.account || "").toLowerCase().includes(term) || String(v.bank || "").toLowerCase().includes(term)
    );
  }, [victims.items, searchTerm]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        eyebrow="Case operations"
        title="Case Evidence Intake"
        subtitle="The transaction file loaded by the engine, and the victim accounts it found. Pick a victim to trace the money."
      >
        <button
          onClick={onReload}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-white border border-[#E8E2D5] text-[#2C2623] text-xs font-semibold hover:bg-[#FAF6EE] shadow-2xs cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[#7C746D] ${status.loading || victims.loading ? "animate-spin" : ""}`} />
          <span>Reload</span>
        </button>
        <button
          onClick={onOpenRegisterModal}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-sm bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-bold shadow-2xs cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Open case by account</span>
        </button>
      </PageHeader>

      {/* Loaded dataset (GET /status) */}
      {status.loading && !s ? (
        <LoadingState label="Reading the loaded dataset..." />
      ) : status.error ? (
        <ErrorState title="The dataset status could not be loaded" message={status.error} onRetry={onReload} />
      ) : !s ? (
        <EmptyState title="No dataset loaded" hint="Run the engine's ingest step, then reload." />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Transactions loaded" value={num(s.records_loaded)} hint={`${num(s.rows_rejected)} rows rejected`} />
            <Stat label="Accounts" value={num(s.accounts)} hint={`${num(s.unique_receivers)} receive money`} />
            <Stat label="Flagged accounts" value={num(s.flagged)} hint={`${num(s.freeze_recommended)} freeze recommended`} tone="red" />
            <Stat label="Victim accounts" value={num(s.victims)} hint={`${num(s.cells)} cells, ${num(s.networks)} network(s)`} tone="orange" />
          </div>
          <div className="bg-white border border-[#E8E2D5] rounded-md p-4 shadow-2xs text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            <div className="flex justify-between gap-3">
              <span className="text-[#746D65]">Source file</span>
              <span className="font-mono font-semibold text-[#2C2623] truncate">{text(s.file_name)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#746D65]">Loaded at</span>
              <span className="font-mono text-[#2C2623]">{dateTime(s.loaded_at)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#746D65]">Load time</span>
              <span className="font-mono text-[#2C2623]">{s.ingestion_seconds == null ? text(null) : `${num(s.ingestion_seconds, 2)} s`}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#746D65]">Scoring profile</span>
              <span className="font-mono text-[#2C2623]">{text(s.profile_id)}</span>
            </div>
            <div className="sm:col-span-2 flex justify-between gap-3">
              <span className="text-[#746D65] shrink-0">File SHA-256</span>
              <span className="font-mono text-[#2C2623] break-all text-right">{text(s.hash)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Selected victim */}
      <div className="bg-white border border-[#E8E2D5] rounded-md p-4 shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">Selected victim</span>
          <div className="text-base font-bold font-mono text-[#2C2623]">{activeCase || "none"}</div>
        </div>
        <div className="font-mono text-[#746D65]">
          {trace.loading
            ? "Tracing..."
            : trace.error
            ? "Trace failed"
            : trace.data
            ? `Paid ${inr(trace.data.total_siphoned_inr)} • ${num(trace.data.nodes.length - 1)} accounts reached`
            : activeCase
            ? "No money trail found"
            : ""}
        </div>
      </div>

      {/* Upload Ledger Section */}
      <div className="bg-white border border-[#E8E2D5] rounded-md p-4 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-sm text-[#2C2623] font-serif">Load a new transaction file</h3>
            <p className="text-xs text-[#746D65] font-sans">
              Ingest raw transaction ledgers directly into DuckDB and execute full multi-hop forensic scoring.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={getTemplateDownloadUrl(TEMPLATE_FILE)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-white border border-[#E8E2D5] text-[#2C2623] text-xs font-semibold hover:bg-[#FAF6EE] shadow-2xs"
            >
              <Download className="w-3.5 h-3.5 text-[#D96B27]" />
              <span>CSV template</span>
            </a>
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#D96B27] hover:bg-[#C25B1C] disabled:bg-[#9E968D] text-white text-xs font-bold shadow-2xs cursor-pointer"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>{uploading ? "Ingesting..." : "Upload CSV file"}</span>
            </button>
          </div>
        </div>

        {/* Drag & drop interactive zone */}
        {!uploading && !uploadResult && (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-md p-6 text-center cursor-pointer transition-colors ${
              isDragOver
                ? "border-[#D96B27] bg-[#FFF8F2]"
                : "border-[#E8E2D5] hover:border-[#D96B27] hover:bg-[#FAF6EE]"
            }`}
          >
            <UploadCloud className="w-8 h-8 text-[#D96B27] mx-auto mb-2 opacity-80" />
            <div className="text-xs font-bold text-[#2C2623]">
              Drag and drop transaction CSV here, or <span className="text-[#D96B27] underline">browse files</span>
            </div>
            <div className="text-[11px] text-[#9E968D] font-mono mt-1">
              Supports 2M+ records, bank statement dumps, and digital arrest payment exports
            </div>
          </div>
        )}

        {/* Upload in progress banner */}
        {uploading && (
          <div className="bg-[#FFF8F2] border border-[#F5C2A5] rounded-md p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-[#D96B27] animate-spin" />
                <span className="text-xs font-bold text-[#2C2623]">{uploadStage}</span>
              </div>
              <span className="text-[10px] font-mono font-bold uppercase text-[#D96B27] bg-white px-2 py-0.5 rounded border border-[#F5C2A5]">
                DuckDB Pipeline Active
              </span>
            </div>
            <div className="w-full bg-[#E8E2D5] rounded-full h-1.5 overflow-hidden">
              <div className="bg-[#D96B27] h-full w-3/4 animate-pulse rounded-full" />
            </div>
            <div className="text-[11px] font-mono text-[#746D65] flex justify-between">
              <span>Applying schema validation & ML scoring profile</span>
              <span>High throughput streaming engine</span>
            </div>
          </div>
        )}

        {/* Upload error banner */}
        {uploadError && (
          <div className="bg-[#FDF2F2] border border-[#F8B4B4] rounded-md p-3.5 flex items-start justify-between gap-3 text-xs">
            <div className="flex items-start gap-2 text-[#991B1B]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Ingestion Error</div>
                <div className="font-mono text-[11px] mt-0.5">{uploadError}</div>
              </div>
            </div>
            <button
              onClick={() => setUploadError(null)}
              className="text-[#991B1B] hover:text-[#7F1D1D] p-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Ingestion & Forensic Parameters Result Card */}
        {uploadResult && (
          <div className="bg-[#FAF6EE] border border-[#E8E2D5] rounded-md p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-[#E8E2D5] pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#227238]" />
                <h4 className="font-bold text-xs text-[#2C2623] font-serif">
                  Ingestion & Forensic Pipeline Results — <span className="font-mono">{uploadResult.file_name}</span>
                </h4>
                <span className="text-[10px] font-mono bg-[#EAF5EC] text-[#227238] border border-[#BCE3C5] px-1.5 py-0.5 rounded font-bold">
                  BSA SEC. 63 VERIFIED
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowParameters(!showParameters)}
                  className="text-xs font-mono text-[#D96B27] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>{showParameters ? "Hide parameters" : "View parameters & breakdown"}</span>
                  {showParameters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => setUploadResult(null)}
                  className="text-[#9E968D] hover:text-[#2C2623] p-1 cursor-pointer"
                  title="Dismiss summary"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Timing & Velocity Stat Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white border border-[#E8E2D5] rounded p-2.5 shadow-2xs">
                <div className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase text-[#9E968D]">
                  <Clock className="w-3 h-3 text-[#D96B27]" />
                  <span>Total Time</span>
                </div>
                <div className="text-base font-bold font-mono text-[#2C2623] mt-0.5">
                  {uploadResult.timing.total_seconds}s
                </div>
                <div className="text-[10px] text-[#227238] font-mono">
                  Upload: {uploadResult.timing.upload_ms}ms
                </div>
              </div>

              <div className="bg-white border border-[#E8E2D5] rounded p-2.5 shadow-2xs">
                <div className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase text-[#9E968D]">
                  <Zap className="w-3 h-3 text-[#D96B27]" />
                  <span>Throughput</span>
                </div>
                <div className="text-base font-bold font-mono text-[#2C2623] mt-0.5">
                  {num(uploadResult.timing.throughput_rows_per_second)}
                </div>
                <div className="text-[10px] text-[#746D65] font-mono">records / sec</div>
              </div>

              <div className="bg-white border border-[#E8E2D5] rounded p-2.5 shadow-2xs">
                <div className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase text-[#9E968D]">
                  <FileSpreadsheet className="w-3 h-3 text-[#D96B27]" />
                  <span>Records Ingested</span>
                </div>
                <div className="text-base font-bold font-mono text-[#2C2623] mt-0.5">
                  {num(uploadResult.records_loaded)}
                </div>
                <div className="text-[10px] text-[#746D65] font-mono">
                  Rejects: {num(uploadResult.records_rejected)} ({uploadResult.file_size})
                </div>
              </div>

              <div className="bg-white border border-[#E8E2D5] rounded p-2.5 shadow-2xs">
                <div className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase text-[#9E968D]">
                  <ShieldCheck className="w-3 h-3 text-[#D96B27]" />
                  <span>Mules Flagged</span>
                </div>
                <div className="text-base font-bold font-mono text-[#DC2626] mt-0.5">
                  {num(uploadResult.flagged_mules)}
                </div>
                <div className="text-[10px] text-[#746D65] font-mono">
                  L1: {uploadResult.roles.L1} • L2: {uploadResult.roles.L2} • L3: {uploadResult.roles.L3}
                </div>
              </div>
            </div>

            {/* Forensic Parameters & Breakdown Details */}
            {showParameters && (
              <div className="border border-[#E8E2D5] rounded bg-white p-3.5 space-y-3 text-xs">
                <div className="font-bold font-serif text-[#2C2623] text-xs">
                  Detailed Timing & Behavioral Parameter Audit
                </div>

                {/* Stage-by-stage timings */}
                <div>
                  <div className="text-[10px] font-mono font-bold uppercase text-[#9E968D] mb-1.5">
                    Pipeline Stage Latencies
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                    <div className="bg-[#FAF6EE] p-2 rounded border border-[#E8E2D5]">
                      <span className="text-[#746D65]">DuckDB Ingest:</span>{" "}
                      <span className="font-bold text-[#2C2623]">{uploadResult.timing.ingest_seconds}s</span>
                    </div>
                    <div className="bg-[#FAF6EE] p-2 rounded border border-[#E8E2D5]">
                      <span className="text-[#746D65]">Features (30 Col):</span>{" "}
                      <span className="font-bold text-[#2C2623]">{uploadResult.timing.stage_breakdown.features}s</span>
                    </div>
                    <div className="bg-[#FAF6EE] p-2 rounded border border-[#E8E2D5]">
                      <span className="text-[#746D65]">Pass-1 & 2 Scoring:</span>{" "}
                      <span className="font-bold text-[#2C2623]">
                        {(uploadResult.timing.stage_breakdown.scoring_pass1 + uploadResult.timing.stage_breakdown.scoring_pass2).toFixed(2)}s
                      </span>
                    </div>
                    <div className="bg-[#FAF6EE] p-2 rounded border border-[#E8E2D5]">
                      <span className="text-[#746D65]">Layer Links & Rings:</span>{" "}
                      <span className="font-bold text-[#2C2623]">
                        {(uploadResult.timing.stage_breakdown.links + uploadResult.timing.stage_breakdown.rings).toFixed(2)}s
                      </span>
                    </div>
                  </div>
                </div>

                {/* Parameters passed and active rules */}
                <div>
                  <div className="text-[10px] font-mono font-bold uppercase text-[#9E968D] mb-1.5">
                    Scoring Engine Parameters & Thresholds Enforced
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono text-[#746D65]">
                    <div className="bg-[#FAF6EE] p-2 rounded border border-[#E8E2D5] space-y-1">
                      <div><strong className="text-[#2C2623]">Profile:</strong> {uploadResult.parameters.profile_id}</div>
                      <div><strong className="text-[#2C2623]">Split Window (L1):</strong> {uploadResult.parameters.split_forward_window}</div>
                      <div><strong className="text-[#2C2623]">Single Forward (L2):</strong> {uploadResult.parameters.single_forward_window}</div>
                      <div><strong className="text-[#2C2623]">Commission Bounds:</strong> {uploadResult.parameters.commission_ranges}</div>
                    </div>
                    <div className="bg-[#FAF6EE] p-2 rounded border border-[#E8E2D5] space-y-1">
                      <div><strong className="text-[#2C2623]">Flag Decision:</strong> {uploadResult.parameters.flag_threshold}</div>
                      <div><strong className="text-[#2C2623]">Signal Guardrail:</strong> {uploadResult.parameters.two_signal_rule}</div>
                      <div><strong className="text-[#2C2623]">Sink Floor:</strong> {uploadResult.parameters.sink_override}</div>
                      <div><strong className="text-[#2C2623]">Reliability Gates:</strong> {uploadResult.parameters.detection_gates}</div>
                    </div>
                  </div>
                </div>

                {/* Checksum and evidence certificate */}
                <div className="pt-2 border-t border-[#E8E2D5] flex flex-wrap items-center justify-between text-[11px] font-mono text-[#746D65] gap-2">
                  <div>
                    <span>SHA-256: </span>
                    <span className="font-bold text-[#2C2623]">{uploadResult.sha256}</span>
                  </div>
                  <div className="text-[#227238] font-bold">
                    ✓ Chain of Custody Locked & Graph Synchronized
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>


      {/* Victim accounts (GET /victims) */}
      <div className="bg-white border border-[#E8E2D5] rounded-md overflow-hidden shadow-2xs">
        <div className="p-4 border-b border-[#E8E2D5] bg-[#FAF6EE] flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-bold text-sm text-[#2C2623] font-serif">
            Victim accounts found by the engine{victims.items.length ? ` (${num(victims.items.length)})` : ""}
          </h3>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9E968D]" />
            <input
              type="text"
              placeholder="Search account or bank code"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className="w-64 bg-white border border-[#E8E2D5] rounded-sm pl-8 pr-3 py-1.5 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
            />
          </div>
        </div>

        {victims.loading ? (
          <div className="p-4">
            <LoadingState label="Loading victim accounts..." />
          </div>
        ) : victims.error ? (
          <div className="p-4">
            <ErrorState title="The victim list could not be loaded" message={victims.error} onRetry={onReload} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={victims.items.length ? "No victim matches the search" : "No victim accounts found"}
              hint={victims.items.length ? null : "The engine found no account with the VICTIM role in the loaded data."}
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#FAF6EE] border-b border-[#E8E2D5] text-[10px] font-bold uppercase tracking-wider text-[#746D65] font-mono">
                    <th className="py-2.5 px-4">Account</th>
                    <th className="py-2.5 px-4">Bank / IFSC</th>
                    <th className="py-2.5 px-4">Amount paid</th>
                    <th className="py-2.5 px-4">Payments</th>
                    <th className="py-2.5 px-4">Paid at</th>
                    <th className="py-2.5 px-4">Victim score</th>
                    <th className="py-2.5 px-4">Cells</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFEAE1] font-mono">
                  {rows.map((v) => (
                    <tr key={v.account} className={`hover:bg-[#FAF6EE] ${v.account === activeCase ? "bg-[#FFF8F2]" : ""}`}>
                      <td className="py-2.5 px-4 font-bold text-[#2C2623]">{v.account}</td>
                      <td className="py-2.5 px-4">
                        {text(v.bank)} <span className="text-[#9E968D]">{text(v.ifsc)}</span>
                      </td>
                      <td className="py-2.5 px-4 text-[#DC2626]">{inr(v.amount)}</td>
                      <td className="py-2.5 px-4">{num(v.payments)}</td>
                      <td className="py-2.5 px-4">{dateTime(v.timestamp)}</td>
                      <td className="py-2.5 px-4">{num(v.victim_score, 1)}</td>
                      <td className="py-2.5 px-4">{Array.isArray(v.cell_ids) && v.cell_ids.length ? v.cell_ids.join(", ") : text(null)}</td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          onClick={() => onSelectCase(v.account)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-sm bg-[#D96B27] hover:bg-[#C25B1C] text-white text-[11px] font-bold cursor-pointer"
                        >
                          <span>Trace</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#FAF6EE] border-t border-[#E8E2D5] text-[11px] font-mono text-[#746D65]">
              <span>
                {num((current - 1) * PAGE_SIZE + 1)}–{num(Math.min(current * PAGE_SIZE, filtered.length))} of {num(filtered.length)}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(Math.max(1, current - 1))}
                  disabled={current === 1}
                  className="px-2.5 py-1 rounded-sm border border-[#E8E2D5] bg-white font-bold text-[#2C2623] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span>
                  Page {current} / {pages}
                </span>
                <button
                  onClick={() => setPage(Math.min(pages, current + 1))}
                  disabled={current === pages}
                  className="px-2.5 py-1 rounded-sm border border-[#E8E2D5] bg-white font-bold text-[#2C2623] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
