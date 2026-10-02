import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Check, CheckCircle2, Loader2, Lock, RotateCcw, Save, Sparkles } from "lucide-react";
import { fetchActiveProfile, previewProfile } from "../api";
import { DASH, num, text } from "../format";
import { EmptyState, ErrorState, LATER, LaterButton, LoadingState, PageHeader } from "./States";
import ProfilePreviewResult from "./ProfilePreviewResult";
import TransactionSearchPanel from "./TransactionSearchPanel";

const inputClass =
  "w-full bg-[#FAF6EE] focus:bg-white border border-[#D4CEBF] focus:border-[#D96B27] rounded-sm px-2.5 py-2 text-xs font-mono text-[#2C2623] focus:outline-none";
const chipClass = "px-2.5 py-1 rounded-sm bg-[#FAF6EE] border border-[#E8E2D5]";

const GROUPS = [
  { key: "mule", title: "Mule index", note: "Signals that raise the mule index." },
  { key: "trust", title: "Trust index", note: "Signals that discount the mule index." },
  { key: "zero", title: "Zero-weight", note: "Kept in the profile at weight 0: not informative on this dataset." },
  { key: "gated", title: "Gated off", note: "Not scored because a reliability gate is closed on this dataset." }
];

// The settings the preview endpoint accepts besides parameter weight and enabled.
const SETTINGS = [
  {
    key: "flag_threshold",
    label: "Flag threshold",
    hint: "An account is flagged at or above this final index.",
    stored: (p) => p.final?.flag_threshold
  },
  {
    key: "trust_discount_factor",
    label: "Trust discount factor",
    hint: "How strongly the trust index reduces the mule index.",
    stored: (p) => p.final?.trust_discount_factor
  },
  {
    key: "min_parameters_at_half",
    label: "Minimum parameters at half",
    hint: "Two-signal rule: mule parameters that must reach at least half.",
    stored: (p) => p.final?.two_signal_rule?.min_parameters_at_half
  }
];

const label = (key) => String(key).replace(/_/g, " ");
const field = (v) => (v === null || v === undefined ? "" : String(v));
const toNumber = (v) => (String(v).trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

function groupOf(param) {
  if (param.scored && (param.index === "mule" || param.index === "trust")) return param.index;
  return param.gate && param.gate_status === "closed" ? "gated" : "zero";
}

// A full / half threshold as the profile stores it. Compound rules are spelled out in the description.
function level(thresholds, name) {
  const at = thresholds?.[`${name}_at`];
  const atMax = thresholds?.[`${name}_at_max`];
  if (at !== null && at !== undefined) return num(at, 2);
  if (atMax !== null && atMax !== undefined) return `≤ ${num(atMax, 2)}`;
  return thresholds?.[name] ? "see rule" : DASH;
}

function shown(value) {
  if (value && typeof value === "object") {
    return "min" in value || "max" in value ? `${text(value.min)}–${text(value.max)}` : JSON.stringify(value);
  }
  return text(value);
}

// The editable values exactly as the profile stores them.
function storedForm(p) {
  const params = {};
  (p.parameters || []).forEach((param) => {
    params[param.id] = { weight: field(param.weight), enabled: Boolean(param.enabled) };
  });
  const form = { params };
  SETTINGS.forEach((s) => {
    form[s.key] = field(s.stored(p));
  });
  return form;
}

// Only what differs from the stored profile is sent. Values that are not numbers are reported here.
function buildChanges(form, base) {
  const changes = {};
  const errors = {};
  const parameters = {};
  Object.keys(base.params).forEach((id) => {
    const now = form.params[id];
    const was = base.params[id];
    const change = {};
    if (now.weight !== was.weight) {
      const n = toNumber(now.weight);
      if (n === null) errors[id] = "Enter a number";
      else if (n !== Number(was.weight)) change.weight = n;
    }
    if (now.enabled !== was.enabled) change.enabled = now.enabled;
    if (Object.keys(change).length) parameters[id] = change;
  });
  if (Object.keys(parameters).length) changes.parameters = parameters;
  SETTINGS.forEach(({ key }) => {
    if (form[key] === base[key]) return;
    const n = toNumber(form[key]);
    if (n === null) errors[key] = "Enter a number";
    else if (n !== Number(base[key])) changes[key] = n;
  });
  return { changes, errors };
}

// Places the API's 422 messages on the field they are about. What cannot be placed is returned as general.
function placeErrors(err, ids) {
  const fields = {};
  const general = [];
  const put = (key, message) => {
    fields[key] = fields[key] ? `${fields[key]}; ${message}` : message;
  };
  if (err.status !== 422) return { fields, general: [err.message] };
  if (err.errors?.length) {
    err.errors.forEach(({ field: path, message }) => {
      const name = String(path || "").replace(/^body\.changes\./, "");
      const param = name.match(/^parameters\.([^.]+)/);
      if (param) put(param[1], message);
      else if (SETTINGS.some((s) => s.key === name)) put(name, message);
      else general.push(`${name}: ${message}`);
    });
    return { fields, general };
  }
  String(err.message)
    .replace(/^Invalid profile changes:\s*/, "")
    .split("; ")
    .forEach((piece) => {
      const id = ids.find((i) => piece.startsWith(`${i}: `));
      const setting = SETTINGS.find((s) => piece.includes(s.key));
      if (id) put(id, piece.slice(id.length + 2));
      else if (setting) put(setting.key, piece);
      else general.push(piece);
    });
  return { fields, general };
}

// Display filters only trim what the other pages list or draw.
function DisplayFilters({ forensicParams, defaults, onSaveParams, maxHops }) {
  const [form, setForm] = useState(forensicParams);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm(forensicParams);
  }, [forensicParams]);

  const set = (name, value) => {
    setSaved(false);
    setForm((f) => ({ ...f, [name]: value }));
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

  return (
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
  );
}

function ParameterRow({ param, value, changed, error, gateReason, onChange }) {
  const reason = param.disabled_reason || gateReason;
  return (
    <tr className={changed ? "bg-[#FFFBEB]" : "hover:bg-[#FAF6EE]"}>
      <td className="py-2.5 px-3 font-mono font-bold text-[#D96B27] align-top">{param.id}</td>
      <td className="py-2.5 px-3 align-top">
        <div className="font-semibold text-[#2C2623]">{text(param.name)}</div>
        <div className="font-mono text-[11px] text-[#5C554E] line-clamp-1" title={param.description}>
          {text(param.description)}
        </div>
      </td>
      <td className="py-2.5 px-3 align-top">
        <input
          type="number"
          step="any"
          aria-label={`${param.id} weight`}
          value={value.weight}
          onChange={(e) => onChange({ weight: e.target.value })}
          className={`${inputClass} w-20 py-1.5 ${error ? "border-[#DC2626]" : ""}`}
        />
        {error && <p className="text-[11px] text-[#B91C1C] mt-1 w-40">{error}</p>}
      </td>
      <td className="py-2.5 px-3 font-mono align-top whitespace-nowrap">{level(param.thresholds, "full")}</td>
      <td className="py-2.5 px-3 font-mono align-top whitespace-nowrap">{level(param.thresholds, "half")}</td>
      <td className="py-2.5 px-3 align-top">
        <input
          type="checkbox"
          aria-label={`${param.id} enabled`}
          checked={value.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className="w-4 h-4 accent-[#D96B27] cursor-pointer"
        />
      </td>
      <td className="py-2.5 px-3 align-top max-w-xs">
        <span
          className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-xs ${
            param.gate ? "bg-[#F3EDE2] text-[#746D65]" : "bg-[#E6F7F0] text-[#059669]"
          }`}
        >
          {param.gate ? `${param.gate}: ${text(param.gate_status)}` : "no gate"}
        </span>
        {reason && (
          <div className="text-[11px] text-[#746D65] mt-1 line-clamp-2" title={reason}>
            {reason}
          </div>
        )}
      </td>
    </tr>
  );
}

// The active scoring profile, with a what-if preview. Nothing on this page writes to the profile:
// every weight and threshold shown is read from the API, and edits exist only until Reset.
export default function ForensicParametersView({ forensicParams, defaults, onSaveParams, onOpenAccount }) {
  const [profile, setProfile] = useState({ data: null, loading: true, error: null });
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({ fields: {}, general: [] });
  const [preview, setPreview] = useState({ data: null, loading: false, key: null });

  const loadProfile = useCallback(async () => {
    setProfile((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchActiveProfile();
      setProfile({ data, loading: false, error: null });
      setForm(storedForm(data));
    } catch (err) {
      setProfile({ data: null, loading: false, error: err.message });
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const p = profile.data;
  const base = useMemo(() => (p ? storedForm(p) : null), [p]);
  const built = useMemo(() => (form && base ? buildChanges(form, base) : { changes: {}, errors: {} }), [form, base]);
  const changeKey = JSON.stringify(built.changes);
  const changeCount = Object.keys(built.changes.parameters || {}).length + SETTINGS.filter((s) => s.key in built.changes).length;
  const edited = Boolean(form && base && JSON.stringify(form) !== JSON.stringify(base));

  const clearError = (key) =>
    setErrors((e) => {
      if (!(key in e.fields) && !e.general.length) return e;
      const fields = { ...e.fields };
      delete fields[key];
      return { fields, general: [] };
    });

  const setParam = (id, patch) => {
    clearError(id);
    setForm((f) => ({ ...f, params: { ...f.params, [id]: { ...f.params[id], ...patch } } }));
  };

  const setSetting = (key, value) => {
    clearError(key);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const reset = () => {
    setForm(base);
    setErrors({ fields: {}, general: [] });
    setPreview({ data: null, loading: false, key: null });
  };

  const runPreview = async () => {
    if (Object.keys(built.errors).length) {
      setErrors({ fields: built.errors, general: [] });
      return;
    }
    setErrors({ fields: {}, general: [] });
    setPreview((s) => ({ ...s, loading: true }));
    try {
      setPreview({ data: await previewProfile(built.changes), loading: false, key: changeKey });
    } catch (err) {
      setPreview((s) => ({ ...s, loading: false }));
      setErrors(placeErrors(err, Object.keys(base.params)));
    }
  };

  const gateReason = (id) => (p?.gates || []).find((g) => g.id === id)?.reason || null;
  const total = (index) =>
    (p?.parameters || [])
      .filter((param) => param.index === index && form?.params[param.id]?.enabled)
      .reduce((sum, param) => sum + (Number(form.params[param.id].weight) || 0), 0);
  const totals = p
    ? [
        { name: "Mule", now: total("mule"), stored: p.mule_total_weight },
        { name: "Trust", now: total("trust"), stored: p.trust_total_weight }
      ]
    : [];
  const readOnly = p
    ? [
        ...Object.entries(p.windows || {}).map(([k, v]) => [`window: ${label(k)}`, shown(v)]),
        ...Object.entries(p.definition?.feature_rules || {}).map(([k, v]) => [`feature rule: ${label(k)}`, shown(v)]),
        ["override floor", shown(p.final?.override_floor)],
        ["trace hops", shown(p.definition?.trace?.max_hops)],
        ["min transactions for trust", shown(p.min_tx_for_trust)]
      ]
    : [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Forensic analysis"
        title="Forensic Parameters"
        subtitle="The scoring profile the engine is using, a preview of what a change would do, and transaction search."
      />

      <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
        <div className="p-3.5 border-b border-[#E8E2D5] bg-[#FAF6EE] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-sm text-[#2C2623] font-serif flex flex-wrap items-center gap-2">
              <span>Scoring profile{p ? `: ${p.profile_id}` : ""}</span>
              {p && (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-xs ${
                    p.is_locked ? "bg-[#E6F7F0] text-[#059669]" : "bg-[#F3EDE2] text-[#746D65]"
                  }`}
                >
                  {p.is_locked && <Lock className="w-3 h-3" />}
                  {p.is_locked ? "Locked default" : "Not locked"}
                </span>
              )}
            </h3>
            {p?.description && <p className="text-[11px] text-[#746D65] mt-0.5 max-w-3xl">{p.description}</p>}
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <LaterButton icon={Save}>Save as new version</LaterButton>
              <LaterButton icon={CheckCircle2}>Activate</LaterButton>
            </div>
            <span className="text-[11px] text-[#9E968D]">{LATER}</span>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {profile.loading && !p ? (
            <LoadingState label="Loading the active profile..." />
          ) : profile.error ? (
            <ErrorState title="The scoring profile could not be loaded" message={profile.error} onRetry={loadProfile} />
          ) : !p || !form ? (
            <EmptyState title="No active scoring profile" />
          ) : (
            <>
              <p className="text-[11px] text-[#746D65]">
                Edits here are a what-if only. The stored profile is not changed; Preview impact re-scores in memory and writes nothing.
              </p>

              <div className="flex flex-wrap gap-2 text-[11px] font-mono">
                {totals.map((t) => (
                  <span
                    key={t.name}
                    className={t.now === t.stored ? chipClass : "px-2.5 py-1 rounded-sm bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] font-bold"}
                  >
                    {t.name} weights sum to {num(t.now, 2)}
                    {t.now === t.stored ? "" : ` (stored ${num(t.stored, 2)})`}
                  </span>
                ))}
              </div>

              <div className="overflow-x-auto border border-[#E8E2D5] rounded-sm">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#FAF6EE] border-b border-[#E8E2D5] text-[10px] font-bold uppercase tracking-wider text-[#746D65] font-mono">
                      <th className="py-2.5 px-3">ID</th>
                      <th className="py-2.5 px-3">Parameter</th>
                      <th className="py-2.5 px-3">Weight</th>
                      <th className="py-2.5 px-3">Full at</th>
                      <th className="py-2.5 px-3">Half at</th>
                      <th className="py-2.5 px-3">Enabled</th>
                      <th className="py-2.5 px-3">Gate</th>
                    </tr>
                  </thead>
                  {GROUPS.map((group) => {
                    const rows = p.parameters.filter((param) => groupOf(param) === group.key);
                    if (!rows.length) return null;
                    return (
                      <tbody key={group.key} className="divide-y divide-[#EFEAE1]">
                        <tr className="bg-[#F3EDE2] border-y border-[#E8E2D5]">
                          <td colSpan={7} className="py-1.5 px-3">
                            <span className="text-[11px] font-bold text-[#2C2623]">
                              {group.title} ({rows.map((param) => param.id).join(", ")})
                            </span>
                            <span className="text-[11px] text-[#746D65]"> — {group.note}</span>
                          </td>
                        </tr>
                        {rows.map((param) => (
                          <ParameterRow
                            key={param.id}
                            param={param}
                            value={form.params[param.id]}
                            changed={
                              form.params[param.id].weight !== base.params[param.id].weight ||
                              form.params[param.id].enabled !== base.params[param.id].enabled
                            }
                            error={errors.fields[param.id]}
                            gateReason={gateReason(param.gate)}
                            onChange={(patch) => setParam(param.id, patch)}
                          />
                        ))}
                      </tbody>
                    );
                  })}
                </table>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {SETTINGS.map((s) => (
                  <div key={s.key}>
                    <label className="text-[11px] font-bold text-[#2C2623] block mb-1">{s.label}</label>
                    <input
                      type="number"
                      step="any"
                      aria-label={s.key}
                      value={form[s.key]}
                      onChange={(e) => setSetting(s.key, e.target.value)}
                      className={`${inputClass} ${errors.fields[s.key] ? "border-[#DC2626]" : form[s.key] !== base[s.key] ? "bg-[#FFFBEB]" : ""}`}
                    />
                    {errors.fields[s.key] ? (
                      <p className="text-[11px] text-[#B91C1C] mt-1">{errors.fields[s.key]}</p>
                    ) : (
                      <p className="text-[11px] text-[#746D65] mt-1">{s.hint}</p>
                    )}
                  </div>
                ))}
              </div>
              {p.final?.formula && <p className="text-[11px] font-mono text-[#746D65]">{p.final.formula}</p>}

              <div className="border border-[#E8E2D5] rounded-sm p-3 space-y-2">
                <div className="flex flex-wrap gap-2 text-[11px] font-mono">
                  {readOnly.map(([name, value]) => (
                    <span key={name} className={chipClass}>
                      {name}: {value}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-[#746D65]">
                  Read-only. Windows and feature rules are measured into the stored features when the engine runs, so a preview
                  cannot re-score them; changing them needs an engine rebuild.
                </p>
              </div>

              {errors.general.length > 0 && (
                <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-md p-3 text-xs text-[#991B1B]">
                  {errors.general.map((message) => (
                    <p key={message}>{message}</p>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E8E2D5] pt-3">
                <span className="text-[11px] text-[#746D65] font-mono">
                  {changeCount ? `${changeCount} value${changeCount === 1 ? "" : "s"} changed from stored` : "No changes from the stored profile"}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={reset}
                    disabled={!edited && !preview.data}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-white border border-[#D4CEBF] text-[#2C2623] text-xs font-semibold hover:bg-[#FAF6EE] disabled:opacity-50 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset</span>
                  </button>
                  <button
                    type="button"
                    onClick={runPreview}
                    disabled={preview.loading}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-sm bg-[#D96B27] hover:bg-[#C25B1C] disabled:opacity-60 text-white text-xs font-bold shadow-2xs cursor-pointer"
                  >
                    {preview.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    <span>{preview.loading ? "Re-scoring..." : "Preview impact"}</span>
                  </button>
                </div>
              </div>

              {preview.data && (
                <ProfilePreviewResult
                  data={preview.data}
                  stale={preview.key !== changeKey}
                  bandOrder={(p.final?.bands || []).map((b) => b.name)}
                  onOpenAccount={onOpenAccount}
                />
              )}
            </>
          )}
        </div>
      </div>

      <TransactionSearchPanel />

      <DisplayFilters
        forensicParams={forensicParams}
        defaults={defaults}
        onSaveParams={onSaveParams}
        maxHops={p?.definition?.trace?.max_hops ?? null}
      />
    </div>
  );
}
