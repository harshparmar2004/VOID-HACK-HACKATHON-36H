import React, { useMemo, useState } from "react";
import { Download, Plus, RefreshCw, Search, UploadCloud, ArrowRight } from "lucide-react";
import { getTemplateDownloadUrl } from "../api";
import { dateTime, inr, num, text } from "../format";
import { EmptyState, ErrorState, LaterButton, LaterStep, LoadingState, PageHeader, Stat } from "./States";

const TEMPLATE_FILE = "transactions_template.csv";
const PAGE_SIZE = 25;

export default function CaseIntakeView({ status, victims, activeCase, trace, onReload, onSelectCase, onOpenRegisterModal }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const s = status.data;

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

      {/* Upload (deferred) */}
      <div className="bg-white border border-[#E8E2D5] rounded-md p-4 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-bold text-sm text-[#2C2623] font-serif">Load a new transaction file</h3>
          <div className="flex items-center gap-2">
            <a
              href={getTemplateDownloadUrl(TEMPLATE_FILE)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-white border border-[#E8E2D5] text-[#2C2623] text-xs font-semibold hover:bg-[#FAF6EE] shadow-2xs"
            >
              <Download className="w-3.5 h-3.5 text-[#D96B27]" />
              <span>CSV template</span>
            </a>
            <LaterButton icon={UploadCloud}>Upload file</LaterButton>
          </div>
        </div>
        <LaterStep title="Uploading from this screen">
          Until then a file is loaded by running the engine's ingest step on this machine. The template lists the columns it expects.
        </LaterStep>
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
