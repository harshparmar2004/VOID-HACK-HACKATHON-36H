import React from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { num, text } from "../format";
import { Stat } from "./States";

const label = (key) => String(key).replace(/_/g, " ").toLowerCase();
const signed = (n) => (n > 0 ? `+${num(n)}` : num(n));

// Before / after counts per key, with the difference.
function CountTable({ title, counts, order = [] }) {
  const before = counts?.before || {};
  const after = counts?.after || {};
  const keys = [...new Set([...order, ...Object.keys(before), ...Object.keys(after)])].filter((k) => k in before || k in after);
  return (
    <div className="border border-[#E8E2D5] rounded-sm overflow-hidden">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="bg-[#FAF6EE] border-b border-[#E8E2D5] text-[10px] font-bold uppercase tracking-wider text-[#746D65] font-mono">
            <th className="py-2 px-3">{title}</th>
            <th className="py-2 px-3 text-right">Before</th>
            <th className="py-2 px-3 text-right">After</th>
            <th className="py-2 px-3 text-right">Change</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#EFEAE1] font-mono">
          {keys.map((k) => {
            const delta = (after[k] || 0) - (before[k] || 0);
            return (
              <tr key={k}>
                <td className="py-2 px-3 font-sans font-semibold text-[#2C2623]">{label(k)}</td>
                <td className="py-2 px-3 text-right">{num(before[k] || 0)}</td>
                <td className="py-2 px-3 text-right">{num(after[k] || 0)}</td>
                <td className={`py-2 px-3 text-right font-bold ${delta ? "text-[#D96B27]" : "text-[#9E968D]"}`}>{signed(delta)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Accounts whose flag or role would change. A currently flagged account opens its dossier, any other its trace.
function AccountList({ title, list, onOpenAccount }) {
  const accounts = list?.accounts || [];
  return (
    <div className="border border-[#E8E2D5] rounded-sm overflow-hidden min-w-0">
      <div className="px-3 py-2 bg-[#FAF6EE] border-b border-[#E8E2D5] flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#746D65] font-mono">{title}</span>
        <span className="text-[11px] font-mono font-bold text-[#2C2623]">{num(list?.count)}</span>
      </div>
      {!accounts.length ? (
        <p className="px-3 py-3 text-xs text-[#9E968D]">None</p>
      ) : (
        <div className="max-h-64 overflow-y-auto divide-y divide-[#EFEAE1]">
          {accounts.map((a) => (
            <button
              key={a.account}
              type="button"
              onClick={() => onOpenAccount?.(a.account, a.flagged_before === true)}
              title={a.flagged_before ? "Open the dossier" : "Open the trace"}
              className="w-full text-left px-3 py-2 hover:bg-[#FAF6EE] cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2 text-xs font-mono">
                <span className="font-bold text-[#D96B27]">{a.account}</span>
                <span className="text-[#746D65]">
                  {num(a.final_index_before, 1)} → {num(a.final_index_after, 1)}
                </span>
              </div>
              <div className="text-[11px] text-[#746D65] font-mono">
                {text(a.bank)} • {label(text(a.role_before))} → {label(text(a.role_after))}
              </div>
            </button>
          ))}
        </div>
      )}
      {list?.truncated && (
        <p className="px-3 py-1.5 border-t border-[#E8E2D5] text-[11px] text-[#746D65]">
          Showing the first {num(accounts.length)} of {num(list.count)}.
        </p>
      )}
    </div>
  );
}

// What a preview would change. Nothing here has been written.
export default function ProfilePreviewResult({ data, stale, bandOrder, onOpenAccount }) {
  const flagged = data.flagged || {};
  const transitions = data.role_changes?.transitions || [];
  const dim = stale ? "opacity-60" : "";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-bold text-sm text-[#2C2623] font-serif">Preview impact</h4>
        <span className="text-[11px] font-mono text-[#746D65]">
          {stale ? "Values have changed since this preview • " : ""}
          re-scored {num(data.accounts)} accounts in memory, nothing written
        </span>
      </div>

      <div className={`grid grid-cols-2 lg:grid-cols-6 gap-3 ${dim}`}>
        <Stat label="Flagged" value={`${num(flagged.before)} → ${num(flagged.after)}`} hint="before → after" />
        <Stat label="Flags gained" value={num(data.flags_gained?.count)} tone={data.flags_gained?.count ? "red" : "default"} />
        <Stat label="Flags lost" value={num(data.flags_lost?.count)} tone={data.flags_lost?.count ? "green" : "default"} />
        <Stat label="Role changes" value={num(data.role_changes?.count)} tone={data.role_changes?.count ? "orange" : "default"} />
        <Stat
          label="Index changed"
          value={num(data.final_index_changed)}
          hint={`largest change ${num(data.max_final_index_change, 1)}`}
        />
        <Stat label="Preview took" value={`${num(data.seconds, 2)} s`} />
      </div>

      {data.warnings?.length > 0 && (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-md p-3 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-[#B45309] mt-0.5 shrink-0" />
          <ul className="text-xs text-[#92400E] space-y-0.5">
            {data.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={`grid grid-cols-1 lg:grid-cols-2 gap-3 ${dim}`}>
        <CountTable title="Band" counts={data.band_counts} order={bandOrder} />
        <CountTable title="Role" counts={data.role_counts} />
      </div>

      {transitions.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[11px] font-mono">
          {transitions.map((t) => (
            <span
              key={`${t.role_before}>${t.role_after}`}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-sm bg-[#FAF6EE] border border-[#E8E2D5]"
            >
              {label(text(t.role_before))} <ArrowRight className="w-3 h-3" /> {label(text(t.role_after))}: <b>{num(t.count)}</b>
            </span>
          ))}
        </div>
      )}

      <div className={`grid grid-cols-1 lg:grid-cols-3 gap-3 ${dim}`}>
        <AccountList title="Flags gained" list={data.flags_gained} onOpenAccount={onOpenAccount} />
        <AccountList title="Flags lost" list={data.flags_lost} onOpenAccount={onOpenAccount} />
        <AccountList title="Role changes" list={data.role_changes} onOpenAccount={onOpenAccount} />
      </div>
    </div>
  );
}
