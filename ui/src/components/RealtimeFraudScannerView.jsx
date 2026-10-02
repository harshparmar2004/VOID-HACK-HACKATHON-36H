import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Download, GitCommit, Lock, Play, RefreshCw, Search } from "lucide-react";
import { fetchProblematicTransactions, fetchScannerSummary, runScannerBenchmark } from "../api";
import { dateTime, downloadCsv, inr, num, text } from "../format";
import { EmptyState, ErrorState, LaterButton, LaterStep, LoadingState, PageHeader, Stat } from "./States";

const ROW_LIMIT = 1000; // the API's maximum per call
const PAGE_SIZE = 50;
const ALL = "ALL";
const FOREIGN = "FOREIGN_IP";
const LARGE = "LARGE"; // local tab: sends min_amount, the amount is typed by the officer
const LINK_LABELS = { L1_L2: "L1 → L2 (second-hop split)" };
const VICTIM_LINK = "VICTIM_L1"; // on these links the sender is the victim

const seconds = (value) => (value == null ? text(null) : `${num(value, 2)} s`);
const millis = (value) => (value == null ? text(null) : `${num(value, 2)} ms`);

export default function RealtimeFraudScannerView({ forensicParams, onTraceVictim }) {
  const [summary, setSummary] = useState({ data: null, loading: true, error: null });
  const [txns, setTxns] = useState({ rows: [], loading: true, error: null });
  const [benchmark, setBenchmark] = useState({ data: null, loading: false, error: null });
  const [activeFilter, setActiveFilter] = useState(ALL);
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [largeInput, setLargeInput] = useState("");
  const [largeAmount, setLargeAmount] = useState(null); // rupees, applied on submit

  const minAmount = forensicParams?.minAmount;
  const bankFilter = forensicParams?.bankFilter;
  const narrationKeyword = forensicParams?.narrationKeyword;

  const loadSummary = useCallback(async () => {
    setSummary((s) => ({ ...s, loading: true, error: null }));
    try {
      setSummary({ data: await fetchScannerSummary(), loading: false, error: null });
    } catch (err) {
      setSummary({ data: null, loading: false, error: err.message });
    }
  }, []);

  const isLarge = activeFilter === LARGE;
  const needsAmount = isLarge && !largeAmount;

  const loadTxns = useCallback(async () => {
    if (needsAmount) {
      setTxns({ rows: [], loading: false, error: null });
      return;
    }
    setTxns((t) => ({ ...t, loading: true, error: null }));
    try {
      const rows = await fetchProblematicTransactions({
        limit: ROW_LIMIT,
        filterType: isLarge ? null : activeFilter,
        minAmount: isLarge ? Math.max(largeAmount, Number(minAmount) || 0) : minAmount,
        bankFilter,
        narrationKeyword
      });
      setTxns({ rows: Array.isArray(rows) ? rows : [], loading: false, error: null });
    } catch (err) {
      setTxns({ rows: [], loading: false, error: err.message });
    }
  }, [activeFilter, isLarge, needsAmount, largeAmount, minAmount, bankFilter, narrationKeyword]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadTxns();
  }, [loadTxns]);

  useEffect(() => {
    setPage(1);
  }, [activeFilter, searchTerm, minAmount, bankFilter, narrationKeyword]);

  const handleBenchmark = async () => {
    setBenchmark({ data: null, loading: true, error: null });
    try {
      setBenchmark({ data: await runScannerBenchmark(), loading: false, error: null });
    } catch (err) {
      setBenchmark({ data: null, loading: false, error: err.message });
    }
  };

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return txns.rows;
    return txns.rows.filter((t) =>
      [t.Transaction_ID, t.Sender_Account, t.Receiver_Account, t.Sender_IFSC, t.Receiver_IFSC, t.narration_category]
        .some((v) => String(v || "").toLowerCase().includes(term))
    );
  }, [txns.rows, searchTerm]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const s = summary.data;
  const tabs = [
    { id: ALL, label: "All flagged transfers", count: s?.flagged_transfers?.count },
    ...(s?.link_types || []).map((lt) => ({
      id: lt.link_type,
      label: LINK_LABELS[lt.link_type] || lt.link_type.replace(/_/g, " → "),
      count: lt.count
    })),
    { id: FOREIGN, label: "Sent from a foreign IP", count: s?.multi_ip_geolocation?.foreign_ip_txns },
    // The API has no count for an amount filter: the count is the rows it returned, once loaded.
    {
      id: LARGE,
      label: largeAmount ? `Large transfers (≥ ${inr(largeAmount, 0)})` : "Large transfers",
      count: isLarge && !needsAmount && !txns.loading && !txns.error
        ? `${num(txns.rows.length)}${txns.rows.length >= ROW_LIMIT ? "+" : ""}`
        : null
    }
  ];

  const applyLargeAmount = (e) => {
    e.preventDefault();
    const value = Number(largeInput);
    setLargeAmount(Number.isFinite(value) && value > 0 ? value : null);
  };

  const handleExport = () =>
    downloadCsv(
      "flagged_transfers.csv",
      ["Transaction ID", "Timestamp", "Sender account", "Sender IFSC", "Receiver account", "Receiver IFSC", "Amount (INR)",
        "Payment mode", "Link type", "Lag seconds", "Sender role", "Receiver role", "Receiver holding (INR)", "Foreign IP",
        "IP address", "Device", "Narration category"],
      filtered.map((t) => [
        t.Transaction_ID, t.txn_timestamp, t.Sender_Account, t.Sender_IFSC, t.Receiver_Account, t.Receiver_IFSC, t.Amount_INR,
        t.Payment_Mode, t.link_type, t.lag_seconds, t.sender_role, t.receiver_role, t.holding_balance, t.is_foreign_ip,
        t.IP_Address, t.Device_Type, t.narration_category
      ])
    );

  const b = benchmark.data;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Forensic analysis"
        title="Fraud Scanner"
        subtitle="Transfers that are proven layer links or that touch a flagged account, from the engine's stored results."
      >
        <button
          onClick={() => {
            loadSummary();
            loadTxns();
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-white border border-[#E8E2D5] text-[#2C2623] hover:border-[#D96B27] text-xs font-mono font-bold shadow-2xs cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[#D96B27] ${summary.loading || txns.loading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
        <button
          onClick={handleBenchmark}
          disabled={benchmark.loading}
          className="flex items-center gap-2 px-4 py-1.5 rounded-sm bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-bold shadow-2xs cursor-pointer disabled:opacity-60"
        >
          <Play className="w-3.5 h-3.5 fill-white" />
          <span>{benchmark.loading ? "Measuring..." : "Measure timings"}</span>
        </button>
      </PageHeader>

      {/* Summary (GET /scanner/summary) */}
      {summary.loading && !s ? (
        <LoadingState label="Loading the scanner summary..." />
      ) : summary.error ? (
        <ErrorState title="The scanner summary could not be loaded" message={summary.error} onRetry={loadSummary} />
      ) : !s ? (
        <EmptyState title="No scanner summary" />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Stat label="Transactions scanned" value={num(s.records_scanned)} hint={`profile ${text(s.profile_id)}`} />
          <Stat label="Flagged transfers" value={num(s.flagged_transfers?.count)} hint={inr(s.flagged_transfers?.total_volume_inr, 0)} tone="red" />
          <Stat label="Proven layer links" value={num(s.illegal_linkages?.flagged_txns)} hint={inr(s.illegal_linkages?.total_volume_inr, 0)} tone="orange" />
          <Stat label="Sent from a foreign IP" value={num(s.multi_ip_geolocation?.foreign_ip_txns)} hint={inr(s.multi_ip_geolocation?.total_volume_inr, 0)} tone="purple" />
          <Stat label="Flagged accounts holding money" value={num(s.early_intervention?.holding_accounts_at_risk)} hint={inr(s.early_intervention?.recoverable_holding_inr, 0)} tone="green" />
        </div>
      )}

      {/* Timings (POST /scanner/run-60s-benchmark) */}
      {(benchmark.loading || benchmark.error || b) && (
        <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
          <div className="p-3.5 border-b border-[#E8E2D5] bg-[#FAF6EE]">
            <h3 className="font-bold text-sm text-[#2C2623] font-serif">Measured timings</h3>
            <p className="text-[11px] text-[#746D65] mt-0.5">
              Load and graph-build times are the ones recorded when they ran. The trace sample is timed now. No speed-up is claimed.
            </p>
          </div>
          <div className="p-4">
            {benchmark.loading ? (
              <LoadingState label="Timing a sample of traces..." />
            ) : benchmark.error ? (
              <ErrorState title="The timings could not be measured" message={benchmark.error} onRetry={handleBenchmark} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Stat
                  label="File load (recorded)"
                  value={seconds(b.ingestion?.load_seconds)}
                  hint={`${num(b.ingestion?.rows_loaded)} rows • ${num(b.ingestion?.rows_per_second)} rows/s`}
                />
                <Stat
                  label="Graph build (recorded)"
                  value={b.graph ? seconds(b.graph.build_seconds) : "not built"}
                  hint={b.graph ? (b.graph.current ? "built from the current load" : "built from an older load") : null}
                />
                <Stat
                  label={`Trace time, ${num(b.trace_sample?.traces)} live traces`}
                  value={`median ${millis(b.trace_sample?.median_ms)}`}
                  hint={`max ${millis(b.trace_sample?.max_ms)} • total ${millis(b.trace_sample?.total_ms)}`}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Transfers (GET /scanner/problematic-transactions) */}
      <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
        <div className="p-3.5 border-b border-[#E8E2D5] bg-[#FAF6EE] space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveFilter(tab.id)}
                className={`px-3 py-1.5 rounded-xs text-xs font-mono font-bold cursor-pointer flex items-center gap-1.5 border ${
                  activeFilter === tab.id
                    ? "bg-[#D96B27] text-white border-[#C25B1D]"
                    : "text-[#746D65] hover:text-[#2C2623] border-transparent hover:bg-white"
                }`}
              >
                <span>{tab.label}</span>
                {tab.count != null && (
                  <span className={`text-[10px] px-1.5 rounded-xs ${activeFilter === tab.id ? "bg-white/20" : "bg-[#E8E2D5] text-[#5C554E]"}`}>
                    {typeof tab.count === "number" ? num(tab.count) : tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
          {isLarge && (
            <form onSubmit={applyLargeAmount} className="flex flex-wrap items-center gap-2 text-xs font-mono text-[#746D65]">
              <span>Show flagged transfers of at least ₹</span>
              <input
                type="number"
                min="1"
                value={largeInput}
                onChange={(e) => setLargeInput(e.target.value)}
                className="w-36 bg-white border border-[#D4CEBF] rounded-sm px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-[#D96B27]"
              />
              <button type="submit" className="px-3 py-1.5 rounded-sm bg-[#D96B27] hover:bg-[#C25B1C] text-white font-bold cursor-pointer">
                Apply
              </button>
            </form>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9E968D]" />
              <input
                type="text"
                placeholder="Search transaction, account, IFSC or category"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-80 bg-white border border-[#D4CEBF] rounded-sm pl-8 pr-3 py-1.5 text-xs font-mono focus:outline-none focus:border-[#D96B27]"
              />
            </div>
            <button
              onClick={handleExport}
              disabled={filtered.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-white border border-[#E8E2D5] text-[#2C2623] hover:border-[#D96B27] text-xs font-mono font-bold cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-[#D96B27]" />
              <span>Export CSV</span>
            </button>
            <LaterButton icon={Lock}>Freeze receivers</LaterButton>
            <span className="ml-auto text-[11px] font-mono text-[#746D65]">
              {num(filtered.length)} shown
              {txns.rows.length >= ROW_LIMIT ? ` (first ${num(ROW_LIMIT)} newest; the API returns no more per call)` : ""}
            </span>
          </div>
        </div>

        {needsAmount ? (
          <div className="p-4">
            <EmptyState title="Enter an amount" hint="This tab lists flagged transfers at or above the amount you enter. No threshold is preset." />
          </div>
        ) : txns.loading ? (
          <div className="p-4">
            <LoadingState label="Loading transfers..." />
          </div>
        ) : txns.error ? (
          <div className="p-4">
            <ErrorState title="The transfers could not be loaded" message={txns.error} onRetry={loadTxns} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No transfer matches" hint="No flagged transfer matches this tab, the display filters and the search." />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-[#FAF6EE] border-b border-[#E8E2D5]">
                  <tr className="text-[10px] font-bold uppercase tracking-wider text-[#746D65] font-mono">
                    <th className="py-2.5 px-3">Time / transaction</th>
                    <th className="py-2.5 px-3">Sender</th>
                    <th className="py-2.5 px-3">Receiver</th>
                    <th className="py-2.5 px-3">Amount</th>
                    <th className="py-2.5 px-3">Link</th>
                    <th className="py-2.5 px-3">Receiver holding</th>
                    <th className="py-2.5 px-3">Device / IP</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFEAE1] font-mono">
                  {rows.map((t) => (
                    <tr key={t.tx_key} className="hover:bg-[#FAF6EE]">
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="text-[#2C2623]">{dateTime(t.txn_timestamp)}</div>
                        <div className="text-[11px] text-[#9E968D]">{text(t.Transaction_ID)}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-[#2C2623]">{t.Sender_Account}</div>
                        <div className="text-[11px] text-[#9E968D]">
                          {text(t.Sender_IFSC)}
                          {t.sender_role ? ` • ${t.sender_role}` : ""}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-[#2C2623]">{t.Receiver_Account}</div>
                        <div className="text-[11px] text-[#9E968D]">
                          {text(t.Receiver_IFSC)}
                          {t.receiver_role ? ` • ${t.receiver_role}` : ""}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="font-bold text-[#DC2626]">{inr(t.Amount_INR)}</div>
                        <div className="text-[11px] text-[#9E968D]">{text(t.Payment_Mode)}</div>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="text-[#D96B27] font-bold">{text(t.link_type)}</div>
                        {t.lag_seconds != null && <div className="text-[11px] text-[#9E968D]">{num(t.lag_seconds / 60, 1)} min after inflow</div>}
                      </td>
                      <td className="py-2.5 px-3 text-[#059669] font-bold whitespace-nowrap">{inr(t.holding_balance)}</td>
                      <td className="py-2.5 px-3">
                        <div>{text(t.Device_Type)}</div>
                        <div className={`text-[11px] ${t.is_foreign_ip ? "text-[#DC2626] font-bold" : "text-[#9E968D]"}`}>
                          {text(t.IP_Address)}
                          {t.is_foreign_ip ? " (foreign)" : ""}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">{text(t.narration_category)}</td>
                      <td className="py-2.5 px-3 text-right">
                        {t.link_type === VICTIM_LINK && onTraceVictim && (
                          <button
                            onClick={() => onTraceVictim(t.Sender_Account)}
                            title="Trace this victim's money"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-sm bg-white border border-[#E8E2D5] hover:border-[#D96B27] text-[#2C2623] text-[11px] font-bold cursor-pointer"
                          >
                            <GitCommit className="w-3 h-3 text-[#D96B27]" />
                            <span>Trace</span>
                          </button>
                        )}
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
                <button onClick={() => setPage(Math.max(1, current - 1))} disabled={current === 1} className="px-2.5 py-1 rounded-sm border border-[#E8E2D5] bg-white font-bold text-[#2C2623] disabled:opacity-40 cursor-pointer">
                  Previous
                </button>
                <span>
                  Page {current} / {pages}
                </span>
                <button onClick={() => setPage(Math.min(pages, current + 1))} disabled={current === pages} className="px-2.5 py-1 rounded-sm border border-[#E8E2D5] bg-white font-bold text-[#2C2623] disabled:opacity-40 cursor-pointer">
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <LaterStep title="Freezing accounts from this page">
        The freeze register is not built yet, so no account can be frozen or marked as frozen here.
      </LaterStep>
    </div>
  );
}
