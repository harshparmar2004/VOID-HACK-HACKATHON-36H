import React, { useState, useEffect, useCallback } from "react";
import { Check, Pencil, RotateCcw, Sparkles } from "lucide-react";
import { fetchActiveProfile } from "../api";
import { num, text } from "../format";
import { EmptyState, ErrorState, LaterButton, LaterStep, LoadingState, PageHeader } from "./States";

const minutes = (w) => (w ? `${num(w.min, 1)}–${num(w.max, 1)} min` : text(null));

// Two things live here:
//   1. display filters, which only trim what the other pages show;
//   2. the active scoring profile, read from the API and shown read-only.
// Weights and thresholds are never typed into this file.
export default function ForensicParametersView({ forensicParams, defaults, onSaveParams }) {
  const [form, setForm] = useState(forensicParams);
  const [saved, setSaved] = useState(false);
  const [profile, setProfile] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    setForm(forensicParams);
  }, [forensicParams]);

  const loadProfile = useCallback(async () => {
    setProfile((p) => ({ ...p, loading: true, error: null }));
    try {
      setProfile({ data: await fetchActiveProfile(), loading: false, error: null });
    } catch (err) {
      setProfile({ data: null, loading: false, error: err.message });
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const p = profile.data;
  const maxHops = p?.definition?.trace?.max_hops ?? null;
  const set = (field, value) => {
    setSaved(false);
    setForm((f) => ({ ...f, [field]: value }));
  };

  const apply = (next) => {
    onSaveParams({
      minAmount: Math.max(0, Number(next.minAmount) || 0),
      minRisk: Math.max(0, Number(next.minRisk) || 0),
      maxHops: next.maxHops ? Number(next.maxHops) : null,
      bankFilter: String(next.bankFilter || "").trim().toUpperCase() || "ALL",
      narrationKeyword: String(next.narrationKeyword || "").trim()
    });
    setSaved(true);
  };

  const inputClass =
    "w-full bg-[#FAF6EE] focus:bg-white border border-[#D4CEBF] focus:border-[#D96B27] rounded-sm px-2.5 py-2 text-xs font-mono text-[#2C2623] focus:outline-none";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Forensic analysis"
        title="Forensic Parameters"
        subtitle="Display filters for the other pages, and the scoring profile the engine is using."
      />

      {/* 1. Display filters */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply(form);
        }}
        className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden"
      >
        <div className="p-3.5 border-b border-[#E8E2D5] bg-[#FAF6EE]">
          <h3 className="font-bold text-sm text-[#2C2623] font-serif">Display filters</h3>
          <p className="text-[11px] text-[#746D65] mt-0.5">
            These only limit what is listed or drawn. They never change scores, roles or how a trace is followed.
          </p>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-[11px] font-bold text-[#2C2623] block mb-1">Minimum amount (₹)</label>
            <input type="number" min="0" value={form.minAmount} onChange={(e) => set("minAmount", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="text-[11px] font-bold text-[#2C2623] block mb-1">
              Hops shown{maxHops ? ` (1–${maxHops})` : ""}
            </label>
            <input
              type="number"
              min="1"
              max={maxHops || undefined}
              placeholder="all"
              value={form.maxHops ?? ""}
              onChange={(e) => set("maxHops", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-[#2C2623] block mb-1">Bank code</label>
            <input
              type="text"
              placeholder="ALL"
              value={form.bankFilter === "ALL" ? "" : form.bankFilter}
              onChange={(e) => set("bankFilter", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-[#2C2623] block mb-1">Minimum risk index</label>
            <input type="number" min="0" max="100" value={form.minRisk} onChange={(e) => set("minRisk", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="text-[11px] font-bold text-[#2C2623] block mb-1">Narration category keyword</label>
            <input type="text" value={form.narrationKeyword} onChange={(e) => set("narrationKeyword", e.target.value)} className={inputClass} />
          </div>
        </div>
        <div className="px-4 py-3 border-t border-[#E8E2D5] flex items-center justify-between gap-3">
          <span className="text-[11px] text-[#059669] font-semibold flex items-center gap-1">
            {saved && (
              <>
                <Check className="w-3.5 h-3.5" /> Filters applied
              </>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => apply(defaults)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-white border border-[#D4CEBF] text-[#2C2623] text-xs font-semibold hover:bg-[#FAF6EE] cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear filters</span>
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-sm bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-bold shadow-2xs cursor-pointer"
            >
              Apply filters
            </button>
          </div>
        </div>
      </form>

      {/* 2. Active scoring profile (read-only) */}
      <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
        <div className="p-3.5 border-b border-[#E8E2D5] bg-[#FAF6EE] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-sm text-[#2C2623] font-serif">
              Active scoring profile{p ? `: ${p.profile_id}` : ""}
            </h3>
            {p?.description && <p className="text-[11px] text-[#746D65] mt-0.5 max-w-3xl">{p.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            <LaterButton icon={Pencil}>Edit profile</LaterButton>
            <LaterButton icon={Sparkles}>Preview a change</LaterButton>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <LaterStep title="Editing the profile and previewing its effect">
            The profile is shown as stored. Weights, thresholds, windows and gates are read from it, never set in the interface.
          </LaterStep>

          {profile.loading && !p ? (
            <LoadingState label="Loading the active profile..." />
          ) : profile.error ? (
            <ErrorState title="The scoring profile could not be loaded" message={profile.error} onRetry={loadProfile} />
          ) : !p ? (
            <EmptyState title="No active scoring profile" />
          ) : (
            <>
              <div className="flex flex-wrap gap-2 text-[11px] font-mono">
                <span className="px-2.5 py-1 rounded-sm bg-[#FAF6EE] border border-[#E8E2D5]">Mule weights total: {num(p.mule_total_weight, 1)}</span>
                <span className="px-2.5 py-1 rounded-sm bg-[#FAF6EE] border border-[#E8E2D5]">Trust weights total: {num(p.trust_total_weight, 1)}</span>
                <span className="px-2.5 py-1 rounded-sm bg-[#FAF6EE] border border-[#E8E2D5]">Trace hops: {num(maxHops)}</span>
                {p.windows?.split_forward_minutes && (
                  <span className="px-2.5 py-1 rounded-sm bg-[#FAF6EE] border border-[#E8E2D5]">
                    Split-forward window: {minutes(p.windows.split_forward_minutes)}
                  </span>
                )}
                <span className="px-2.5 py-1 rounded-sm bg-[#FAF6EE] border border-[#E8E2D5]">{p.is_locked ? "Locked" : "Not locked"}</span>
              </div>

              <div className="overflow-x-auto border border-[#E8E2D5] rounded-sm">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#FAF6EE] border-b border-[#E8E2D5] text-[10px] font-bold uppercase tracking-wider text-[#746D65] font-mono">
                      <th className="py-2.5 px-3">ID</th>
                      <th className="py-2.5 px-3">Parameter</th>
                      <th className="py-2.5 px-3">Index</th>
                      <th className="py-2.5 px-3">Weight</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Rule</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFEAE1]">
                    {(p.parameters || []).map((param) => (
                      <tr key={param.id} className="hover:bg-[#FAF6EE]">
                        <td className="py-2.5 px-3 font-mono font-bold text-[#D96B27]">{param.id}</td>
                        <td className="py-2.5 px-3 font-semibold text-[#2C2623]">{text(param.name)}</td>
                        <td className="py-2.5 px-3 font-mono">{text(param.index)}</td>
                        <td className="py-2.5 px-3 font-mono">{num(param.weight, 1)}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-xs ${
                              param.scored ? "bg-[#E6F7F0] text-[#059669]" : "bg-[#F3EDE2] text-[#746D65]"
                            }`}
                            title={param.disabled_reason || (param.gate ? `gate ${param.gate}: ${param.gate_status}` : "")}
                          >
                            {param.scored ? "scored" : param.enabled ? "not scored" : "off"}
                            {param.gate_status ? ` • gate ${param.gate_status}` : ""}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-[#5C554E]">{text(param.description)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
