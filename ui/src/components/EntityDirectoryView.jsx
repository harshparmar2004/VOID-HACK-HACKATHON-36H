import React, { useState, useEffect, useCallback } from "react";
import { Search, RefreshCw } from "lucide-react";
import { fetchEntities } from "../api";
import { inr, num, text } from "../format";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "./States";

const PAGE_LIMIT = 500; // rows requested per call

const ROLE_STYLES = {
  VICTIM: "bg-[#E6F7F0] text-[#059669]",
  L1: "bg-[#FFEDD5] text-[#EA580C]",
  L2: "bg-[#FEF3C7] text-[#D97706]",
  L3: "bg-[#EDE9FE] text-[#7C3AED]"
};

export default function EntityDirectoryView({ forensicParams }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedBank, setSelectedBank] = useState("ALL");
  const [state, setState] = useState({ data: null, loading: true, error: null });

  const bankFilter = forensicParams?.bankFilter;
  const minAmount = forensicParams?.minAmount;

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      setState({ data: await fetchEntities({ limit: PAGE_LIMIT, bankFilter, minAmount }), loading: false, error: null });
    } catch (err) {
      setState({ data: null, loading: false, error: err.message });
    }
  }, [bankFilter, minAmount]);

  useEffect(() => {
    load();
  }, [load]);

  const entities = state.data?.entities || [];
  const bankStats = state.data?.bank_stats || [];
  const term = searchTerm.trim().toLowerCase();

  const filtered = entities.filter((e) => {
    const matchesSearch =
      !term ||
      String(e.account || "").toLowerCase().includes(term) ||
      String(e.ifsc || "").toLowerCase().includes(term) ||
      String(e.bank || "").toLowerCase().includes(term);
    return matchesSearch && (selectedBank === "ALL" || e.bank === selectedBank);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Accounts index"
        title={`Entity Directory${state.data ? ` (${num(state.data.total_accounts)} accounts)` : ""}`}
        subtitle="Every sender and receiver account in the loaded data, with its totals and the engine's score."
      >
        <div className="relative">
          <input
            type="text"
            placeholder="Search account, bank code or IFSC"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-72 bg-white border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
          />
          <Search className="w-3.5 h-3.5 absolute right-3 top-2.5 text-[#9E968D]" />
        </div>
        <select
          value={selectedBank}
          onChange={(e) => setSelectedBank(e.target.value)}
          className="bg-white border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-semibold text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
        >
          <option value="ALL">All banks</option>
          {bankStats.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name ? `${b.name} (${b.code})` : b.code}
            </option>
          ))}
        </select>
        <button
          onClick={load}
          disabled={state.loading}
          title="Refresh"
          className="p-2 border border-[#E8E2D5] rounded-xl bg-white hover:bg-[#FAF6EE] text-[#746D65] cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${state.loading ? "animate-spin" : ""}`} />
        </button>
      </PageHeader>

      {state.loading && !state.data ? (
        <LoadingState label="Loading accounts..." />
      ) : state.error ? (
        <ErrorState title="The entity directory could not be loaded" message={state.error} onRetry={load} />
      ) : entities.length === 0 ? (
        <EmptyState title="No accounts match" hint="No account matches the current display filters." />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
            {bankStats.map((b) => (
              <div
                key={b.code}
                onClick={() => setSelectedBank(selectedBank === b.code ? "ALL" : b.code)}
                className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                  selectedBank === b.code
                    ? "bg-[#FAF6EE] border-[#D96B27] shadow-sm"
                    : "bg-white border-[#E8E2D5] hover:border-[#D96B27]"
                }`}
              >
                <div className="text-xs font-mono font-bold text-[#D96B27]">{b.code}</div>
                {b.name && <div className="text-xs font-bold text-[#2C2623] truncate mt-0.5">{b.name}</div>}
                <div className="text-[11px] text-[#746D65] mt-1 font-mono">
                  {num(b.count)} accounts{b.share == null ? "" : ` • ${num(b.share, 2)}%`}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white border border-[#E8E2D5] rounded-2xl overflow-hidden shadow-2xs">
            <div className="p-4 border-b border-[#E8E2D5] bg-[#FAF6EE] flex items-center justify-between">
              <h3 className="font-bold text-sm text-[#2C2623] font-serif">Accounts</h3>
              <span className="text-xs text-[#746D65] font-mono">
                Showing {num(filtered.length)} of {num(state.data.returned)} loaded ({num(state.data.matched)} match the filters)
              </span>
            </div>

            {filtered.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No account matches the search" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#FAF6EE] border-b border-[#E8E2D5] text-[10px] font-bold uppercase tracking-wider text-[#746D65]">
                      <th className="py-3 px-4">Account</th>
                      <th className="py-3 px-4">Bank &amp; IFSC</th>
                      <th className="py-3 px-4">Role</th>
                      <th className="py-3 px-4">Total inflow</th>
                      <th className="py-3 px-4">Total outflow</th>
                      <th className="py-3 px-4">Balance</th>
                      <th className="py-3 px-4">Transactions</th>
                      <th className="py-3 px-4 text-right">Risk</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFEAE1] font-mono">
                    {filtered.map((e) => (
                      <tr key={e.account} className="hover:bg-[#FAF6EE] transition-colors">
                        <td className="py-3 px-4 font-bold text-[#2C2623]">{e.account}</td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-[#2C2623]">{text(e.bank)}</div>
                          <div className="text-[11px] text-[#9E968D]">{text(e.ifsc)}</div>
                        </td>
                        <td className="py-3 px-4 font-sans">
                          {e.role ? (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${ROLE_STYLES[e.role] || "bg-[#F3EDE2] text-[#746D65]"}`}>
                              {e.role}
                              {e.role_confirmed ? " ✓" : ""}
                            </span>
                          ) : (
                            <span className="text-[#9E968D]">{text(null)}</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-[#059669]">{inr(e.totalIn)}</td>
                        <td className="py-3 px-4 text-[#DC2626]">{inr(e.totalOut)}</td>
                        <td className="py-3 px-4 font-bold text-[#2C2623]">{inr(e.balance)}</td>
                        <td className="py-3 px-4">{num(e.tx_count)}</td>
                        <td className="py-3 px-4 text-right font-sans">
                          <span
                            className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                              e.is_flagged ? "bg-[#FEE2E2] text-[#DC2626]" : "bg-[#E6F7F0] text-[#059669]"
                            }`}
                          >
                            {text(e.risk)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
