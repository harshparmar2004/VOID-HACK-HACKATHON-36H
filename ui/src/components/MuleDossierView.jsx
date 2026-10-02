import React, { useState, useEffect, useMemo, useCallback } from "react";
import { ChevronRight, Copy, Check, Download, Lock, RefreshCw, Search, X } from "lucide-react";
import { fetchActiveProfile, fetchMules } from "../api";
import { DASH, downloadCsv, inr, num, text } from "../format";
import { EmptyState, ErrorState, LoadingState, PageHeader, Stat } from "./States";

const MULE_LIMIT = 2000; // rows requested per call
const PAGE_SIZE = 50;

const ROLE_STYLES = {
  L1: "bg-[#FFEDD5] text-[#EA580C] border-[#FDBA74]",
  L2: "bg-[#FEF3C7] text-[#D97706] border-[#FDE68A]",
  L3: "bg-[#EDE9FE] text-[#7C3AED] border-[#DDD6FE]"
};
const ROLE_FALLBACK_STYLE = "bg-[#F3EDE2] text-[#746D65] border-[#E8E2D5]";
const NO_ROLE = "NO ROLE";

const reasonsOf = (m) =>
  Array.isArray(m.reasons)
    ? m.reasons
    : String(m.forensic_reason || m.reasons || "")
        .split(";")
        .map((r) => r.trim())
        .filter(Boolean);

const pointsOf = (m) =>
  Object.entries(m.param_points || {})
    .filter(([, points]) => Number(points) > 0)
    .sort((a, b) => b[1] - a[1]);

// The reason the engine recorded for one parameter carries its id as a tag: "... [MP1: 20.0 of 20]".
const reasonTag = (id) => new RegExp(`\\s*\\[${id}: [^\\]]*\\]\\s*$`);
const ANY_TAG = /\[[A-Z]+\d+: [^\]]*\]\s*$/;

// One row per parameter of the active profile (weights and names come from the profile,
// points from the account's param_points). Without the profile: the ids we have, no weights.
function breakdown(mule, profile) {
  const points = mule.param_points || {};
  const reasons = reasonsOf(mule);
  const params = Array.isArray(profile?.parameters)
    ? profile.parameters
    : Object.keys(points).map((id) => ({ id, name: null, index: null, weight: null, scored: null }));
  return params.map((p) => {
    const tag = reasonTag(p.id);
    const reason = reasons.find((r) => tag.test(r));
    const weight = p.weight ?? null;
    return {
      id: p.id,
      name: p.name,
      index: p.index,
      weight,
      points: points[p.id] ?? null,
      reason: reason ? reason.replace(tag, "") : null,
      notScored: p.scored === false ? p.disabled_reason || "Not scored by the active profile." : null,
      // Zero-weight and switched-off (gated) parameters cannot move the score.
      inactive: weight === 0 || p.scored === false
    };
  });
}

function ParameterRow({ row }) {
  const share = row.weight > 0 && row.points != null ? Math.min(100, (100 * row.points) / row.weight) : 0;
  const trust = row.index === "trust";
  return (
    <div data-param={row.id} className={`py-2 border-t border-[#F0EAE1] first:border-t-0 ${row.inactive ? "opacity-60" : ""}`}>
      <div className="flex items-baseline justify-between gap-2 font-mono">
        <span className="min-w-0 truncate">
          <strong className="text-[#2C2623]">{row.id}</strong>
          <span className="text-[#746D65] font-sans"> {text(row.name)}</span>
        </span>
        <span className="whitespace-nowrap">
          <strong className={trust ? "text-[#059669]" : "text-[#DC2626]"}>{num(row.points, 1)}</strong>
          <span className="text-[#9E968D]"> of {num(row.weight, 1)}</span>
        </span>
      </div>
      <div className="h-1 rounded-full bg-[#F3EDE2] mt-1 overflow-hidden">
        <div style={{ width: `${share}%` }} className={`h-full ${trust ? "bg-[#059669]" : "bg-[#DC2626]"}`} />
      </div>
      <p className="text-[11px] text-[#5C554E] mt-1 leading-snug">{row.reason || row.notScored || DASH}</p>
    </div>
  );
}

export default function MuleDossierView({ forensicParams, onNavigateTab }) {
  const [state, setState] = useState({ rows: [], loading: true, error: null });
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedBank, setSelectedBank] = useState(forensicParams?.bankFilter || "ALL");
  const [minRisk, setMinRisk] = useState(Number(forensicParams?.minRisk) || 0);
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("risk_desc");
  const [page, setPage] = useState(1);
  const [openAccount, setOpenAccount] = useState(null);
  const [copied, setCopied] = useState(null);
  const [profile, setProfile] = useState({ data: null, error: null });
  const [showAll, setShowAll] = useState(false);

  // Parameter names and weights come from the active scoring profile.
  useEffect(() => {
    let live = true;
    fetchActiveProfile()
      .then((data) => live && setProfile({ data, error: null }))
      .catch((err) => live && setProfile({ data: null, error: err.message }));
    return () => {
      live = false;
    };
  }, []);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchMules({ limit: MULE_LIMIT });
      setState({ rows: Array.isArray(data) ? data : [], loading: false, error: null });
    } catch (err) {
      setState({ rows: [], loading: false, error: err.message });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setSelectedBank(forensicParams?.bankFilter || "ALL");
    setMinRisk(Number(forensicParams?.minRisk) || 0);
  }, [forensicParams?.bankFilter, forensicParams?.minRisk]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setOpenAccount(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const mules = state.rows;

  const stats = useMemo(() => {
    const roles = {};
    const bands = {};
    const banks = {};
    let holding = 0;
    mules.forEach((m) => {
      const role = m.role || NO_ROLE;
      roles[role] = (roles[role] || 0) + 1;
      if (m.risk_band) bands[m.risk_band] = (bands[m.risk_band] || 0) + 1;
      if (m.bank) banks[m.bank] = (banks[m.bank] || 0) + 1;
      holding += Number(m.current_holding_balance) || 0;
    });
    return {
      roles: Object.entries(roles).sort((a, b) => a[0].localeCompare(b[0])),
      bands: Object.entries(bands).sort((a, b) => a[0].localeCompare(b[0])),
      banks: Object.entries(banks).sort((a, b) => b[1] - a[1]),
      holding,
      freeze: mules.filter((m) => m.freeze_recommended).length
    };
  }, [mules]);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const list = mules.filter((m) => {
      if (roleFilter !== "ALL" && (m.role || NO_ROLE) !== roleFilter) return false;
      if (selectedBank !== "ALL" && m.bank !== selectedBank) return false;
      if (Number(m.risk_index) < minRisk) return false;
      if (!term) return true;
      return (
        String(m.account || "").toLowerCase().includes(term) ||
        String(m.ifsc || "").toLowerCase().includes(term) ||
        String(m.forensic_reason || "").toLowerCase().includes(term)
      );
    });
    const by = {
      risk_desc: (a, b) => b.risk_index - a.risk_index,
      risk_asc: (a, b) => a.risk_index - b.risk_index,
      holding_desc: (a, b) => (b.current_holding_balance || 0) - (a.current_holding_balance || 0),
      incoming_desc: (a, b) => (b.total_incoming_amt || 0) - (a.total_incoming_amt || 0)
    };
    return [...list].sort(by[sortBy]);
  }, [mules, searchTerm, selectedBank, minRisk, roleFilter, sortBy]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, selectedBank, minRisk, roleFilter, sortBy]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const open = openAccount ? mules.find((m) => m.account === openAccount) : null;
  const openRows = open ? breakdown(open, profile.data) : [];
  const hiddenRows = openRows.filter((r) => r.inactive).length;
  const otherReasons = open ? reasonsOf(open).filter((r) => !ANY_TAG.test(r)) : [];

  const handleCopy = (account) => {
    navigator.clipboard.writeText(account);
    setCopied(account);
    setTimeout(() => setCopied(null), 1800);
  };

  const handleExport = () =>
    downloadCsv(
      "mule_dossier.csv",
      ["Account", "IFSC", "Bank", "Role", "Role confirmed", "Final index", "Mule index", "Trust index", "Band",
        "Freeze recommended", "Total incoming (INR)", "Total outgoing (INR)", "Holding (INR)", "Distinct senders",
        "Distinct receivers", "Parameter points", "Reasons"],
      filtered.map((m) => [
        m.account, m.ifsc, m.bank, m.role, m.role_confirmed, m.final_index, m.mule_index, m.trust_index, m.risk_band,
        m.freeze_recommended, m.total_incoming_amt, m.total_outgoing_amt, m.current_holding_balance, m.distinct_senders,
        m.distinct_receivers, pointsOf(m).map(([id, pts]) => `${id}=${pts}`).join(" "), reasonsOf(m).join("; ")
      ])
    );

  const roleTabs = [["ALL", mules.length], ...stats.roles];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Scoring"
        title="Mule Account Dossier"
        subtitle="Accounts flagged by the active scoring profile, with their Final / Mule / Trust index, role and the reasons the engine recorded."
      >
        <button
          onClick={load}
          disabled={state.loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-white border border-[#E8E2D5] text-[#2C2623] hover:border-[#D96B27] text-xs font-mono font-bold shadow-2xs cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[#D96B27] ${state.loading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
        <button
          onClick={handleExport}
          disabled={filtered.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-white border border-[#E8E2D5] text-[#2C2623] hover:border-[#D96B27] text-xs font-mono font-bold shadow-2xs cursor-pointer disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5 text-[#D96B27]" />
          <span>Export CSV</span>
        </button>
        {onNavigateTab && (
          <button
            onClick={() => onNavigateTab("notices")}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-sm bg-[#D96B27] text-white hover:bg-[#C25B1D] text-xs font-mono font-bold shadow-2xs cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Section 91 notices</span>
          </button>
        )}
      </PageHeader>

      {state.loading && mules.length === 0 ? (
        <LoadingState label="Loading flagged accounts..." />
      ) : state.error ? (
        <ErrorState title="The mule dossier could not be loaded" message={state.error} onRetry={load} />
      ) : mules.length === 0 ? (
        <EmptyState title="No flagged accounts" hint="The active scoring profile flags no account in the loaded data." />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Stat label="Flagged accounts" value={num(mules.length)} />
            {stats.bands.map(([band, count]) => (
              <Stat key={band} label={band.replace(/_/g, " ")} value={num(count)} tone="red" />
            ))}
            {stats.roles.map(([role, count]) => (
              <Stat key={role} label={`Role ${role}`} value={num(count)} tone="orange" />
            ))}
            <Stat label="Total holding" value={inr(stats.holding, 0)} hint={`${num(stats.freeze)} freeze recommended`} tone="green" />
          </div>

          <div className="bg-white border border-[#E8E2D5] rounded-sm p-3.5 shadow-2xs space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9E968D]" />
                <input
                  type="text"
                  placeholder="Search account, IFSC or reason"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-white border border-[#D4CEBF] rounded-sm pl-8 pr-3 py-1.5 text-xs font-mono focus:outline-none focus:border-[#D96B27]"
                />
              </div>
              <select
                value={selectedBank}
                onChange={(e) => setSelectedBank(e.target.value)}
                className="bg-white border border-[#D4CEBF] rounded-sm px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-[#D96B27]"
              >
                <option value="ALL">All banks</option>
                {stats.banks.map(([code, count]) => (
                  <option key={code} value={code}>
                    {code} ({num(count)})
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-xs font-mono text-[#746D65]">
                <span>Min. final index</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={minRisk}
                  onChange={(e) => setMinRisk(Number(e.target.value) || 0)}
                  className="w-20 bg-white border border-[#D4CEBF] rounded-sm px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-[#D96B27]"
                />
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-white border border-[#D4CEBF] rounded-sm px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-[#D96B27]"
              >
                <option value="risk_desc">Final index, high to low</option>
                <option value="risk_asc">Final index, low to high</option>
                <option value="holding_desc">Holding, high to low</option>
                <option value="incoming_desc">Incoming, high to low</option>
              </select>
              <span className="ml-auto text-[11px] font-mono text-[#746D65]">
                {num(filtered.length)} of {num(mules.length)} shown
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-[#E8E2D5]">
              {roleTabs.map(([role, count]) => (
                <button
                  key={role}
                  onClick={() => setRoleFilter(role)}
                  className={`px-3 py-1.5 rounded-xs text-xs font-mono font-bold cursor-pointer flex items-center gap-1.5 border ${
                    roleFilter === role
                      ? "bg-[#D96B27] text-white border-[#C25B1D]"
                      : "text-[#746D65] hover:text-[#2C2623] border-transparent hover:bg-[#FAF6EE]"
                  }`}
                >
                  <span>{role}</span>
                  <span className={`text-[10px] px-1.5 rounded-xs ${roleFilter === role ? "bg-white/20" : "bg-[#E8E2D5] text-[#5C554E]"}`}>
                    {num(count)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white border border-[#E8E2D5] rounded-sm overflow-hidden shadow-2xs">
            {rows.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No flagged account matches these filters" />
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 z-10 bg-[#FAF6EE] border-b border-[#E8E2D5]">
                    <tr className="text-[10px] font-bold uppercase tracking-wider text-[#746D65] font-mono">
                      <th className="py-2.5 px-3">Account</th>
                      <th className="py-2.5 px-3">Role</th>
                      <th className="py-2.5 px-3">Final index</th>
                      <th className="py-2.5 px-3">In / out</th>
                      <th className="py-2.5 px-3">Holding</th>
                      <th className="py-2.5 px-3">Parameter points</th>
                      <th className="py-2.5 px-3">First reason</th>
                      <th className="py-2.5 px-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFEAE1]">
                    {rows.map((m) => (
                      <tr key={m.account} className="hover:bg-[#FAF6EE]">
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1">
                            <span className="font-mono font-bold text-[#2C2623]">{m.account}</span>
                            <button onClick={() => handleCopy(m.account)} title="Copy account" className="text-[#9E968D] hover:text-[#D96B27] p-1 cursor-pointer">
                              {copied === m.account ? <Check className="w-3 h-3 text-[#059669]" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                          <div className="text-[11px] font-mono text-[#746D65]">
                            <span className="text-[#D96B27] font-semibold">{text(m.ifsc)}</span> • {text(m.bank)}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded-xs font-mono font-bold text-[10px] border ${ROLE_STYLES[m.role] || ROLE_FALLBACK_STYLE}`}>
                            {m.role || NO_ROLE}
                          </span>
                          <div className="text-[10px] text-[#9E968D] mt-1">{m.role_confirmed ? "confirmed by a link" : "not confirmed"}</div>
                        </td>
                        <td className="py-2.5 px-3 font-mono">
                          <span className="font-bold text-[#DC2626]">{num(m.risk_index, 1)}</span>
                          <div className="text-[10px] text-[#9E968D]">{text(m.risk_band)}</div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                          <div className="text-[#059669]">{inr(m.total_incoming_amt, 0)}</div>
                          <div className="text-[#746D65]">{inr(m.total_outgoing_amt, 0)}</div>
                        </td>
                        <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                          <span className="font-bold text-[#059669]">{inr(m.current_holding_balance)}</span>
                          {m.freeze_recommended && <div className="text-[10px] text-[#B45309] font-bold">freeze recommended</div>}
                        </td>
                        <td className="py-2.5 px-3 text-[10px] font-mono text-[#746D65]">
                          <div className="flex flex-wrap gap-1 max-w-[220px]">
                            {pointsOf(m).map(([id, points]) => (
                              <span key={id} className="bg-[#FAF6EE] px-1.5 py-0.5 rounded-xs border border-[#E8E2D5]">
                                {id}:<strong className="text-[#2C2623]">{num(points, 1)}</strong>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-[#746D65] max-w-xs truncate" title={reasonsOf(m).join("\n")}>
                          {text(reasonsOf(m)[0])}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => setOpenAccount(m.account)}
                            title="Open dossier"
                            className="p-1.5 rounded-sm border border-[#E8E2D5] bg-white hover:border-[#D96B27] text-[#746D65] cursor-pointer"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {filtered.length > PAGE_SIZE && (
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
            )}
          </div>
        </>
      )}

      {open && (
        <>
          <div className="fixed inset-0 bg-[#2C2623]/20 z-40" onClick={() => setOpenAccount(null)} />
          <aside className="fixed right-0 top-0 h-full w-full sm:w-[520px] bg-white border-l border-[#E8E2D5] shadow-2xl z-50 overflow-y-auto">
            <div className="p-4 border-b border-[#E8E2D5] bg-[#FAF6EE] flex items-start justify-between gap-3">
              <div>
                <div className="font-mono font-bold text-base text-[#2C2623]">{open.account}</div>
                <div className="text-[11px] font-mono text-[#746D65]">
                  {text(open.ifsc)} • {text(open.bank_name ?? open.bank)}
                </div>
              </div>
              <button onClick={() => setOpenAccount(null)} className="text-[#9E968D] hover:text-[#2C2623] p-1 cursor-pointer" title="Close (Esc)">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-4 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Final" value={num(open.final_index, 1)} tone="red" />
                <Stat label="Mule" value={num(open.mule_index, 1)} />
                <Stat label="Trust" value={num(open.trust_index, 1)} tone="green" />
              </div>
              <div data-final-line className="p-2.5 rounded-sm bg-[#FAF6EE] border border-[#E8E2D5] font-mono">
                <strong className="text-[#2C2623]">
                  Final {num(open.final_index, 1)} = Mule {num(open.mule_index, 1)} reduced by Trust {num(open.trust_index, 1)}
                </strong>
                <div className="text-[10px] text-[#746D65] mt-1 break-words">
                  {text(profile.data?.final?.formula)}
                  {profile.data?.final?.trust_discount_factor == null
                    ? ""
                    : ` • trust_discount_factor ${profile.data.final.trust_discount_factor}`}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono">
                <dt className="text-[#746D65]">Role</dt>
                <dd className="text-right font-bold">{open.role || NO_ROLE}{open.role_confirmed ? " (confirmed)" : " (not confirmed)"}</dd>
                <dt className="text-[#746D65]">Band</dt>
                <dd className="text-right">{text(open.risk_band)}</dd>
                <dt className="text-[#746D65]">Freeze recommended</dt>
                <dd className="text-right">{open.freeze_recommended ? "yes" : "no"}</dd>
                <dt className="text-[#746D65]">Total incoming</dt>
                <dd className="text-right">{inr(open.total_incoming_amt)}</dd>
                <dt className="text-[#746D65]">Total outgoing</dt>
                <dd className="text-right">{inr(open.total_outgoing_amt)}</dd>
                <dt className="text-[#746D65]">Holding</dt>
                <dd className="text-right font-bold text-[#059669]">{inr(open.current_holding_balance)}</dd>
                <dt className="text-[#746D65]">Distinct senders / receivers</dt>
                <dd className="text-right">{num(open.distinct_senders)} / {num(open.distinct_receivers)}</dd>
                <dt className="text-[#746D65]">Cells</dt>
                <dd className="text-right">{Array.isArray(open.cell_ids) && open.cell_ids.length ? open.cell_ids.join(", ") : text(null)}</dd>
                <dt className="text-[#746D65]">Network</dt>
                <dd className="text-right">{text(open.network_id)}</dd>
              </dl>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
                    Score breakdown (points of weight, per parameter)
                  </h4>
                  {hiddenRows > 0 && (
                    <button
                      onClick={() => setShowAll(!showAll)}
                      className="text-[10px] font-mono font-bold text-[#D96B27] hover:underline cursor-pointer whitespace-nowrap"
                    >
                      {showAll ? "Hide zero-weight / gated" : `Show all (+${hiddenRows})`}
                    </button>
                  )}
                </div>
                {profile.error && (
                  <p className="text-[11px] text-[#B45309] mb-1">
                    The scoring profile could not be loaded, so names and weights are missing ({profile.error}).
                  </p>
                )}
                {openRows.length === 0 ? (
                  <p className="text-[#746D65]">No parameter points recorded.</p>
                ) : (
                  [["mule", "Mule index"], ["trust", "Trust index"], [null, "Parameters"]].map(([index, label]) => {
                    const group = openRows.filter((r) => (r.index ?? null) === index && (showAll || !r.inactive));
                    if (group.length === 0) return null;
                    return (
                      <div key={label} className="mt-2">
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase font-mono text-[#746D65] bg-[#FAF6EE] border border-[#E8E2D5] rounded-xs px-2 py-1">
                          <span>{label}</span>
                          {index && <span>{num(index === "mule" ? open.mule_index : open.trust_index, 1)}</span>}
                        </div>
                        {group.map((row) => (
                          <ParameterRow key={row.id} row={row} />
                        ))}
                      </div>
                    );
                  })
                )}
              </div>
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono mb-1.5">Other reasons recorded by the engine</h4>
                {otherReasons.length === 0 ? (
                  <p className="text-[#746D65]">{DASH}</p>
                ) : (
                  <ul className="list-disc pl-5 space-y-1 text-[#5C554E]">
                    {otherReasons.map((reason, i) => (
                      <li key={i}>{reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
