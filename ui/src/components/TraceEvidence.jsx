import React, { useState } from "react";
import { Check, Copy, Layers, X } from "lucide-react";
import { DASH, dateTime, inr, num, text } from "../format";

// Shared pieces for the two trace views (network graph and endpoint trail):
// role colours, the layered layout, and the evidence panels. Every value shown
// comes from the /trace response; a missing value is a dash.

// Colour is keyed by the ROLE the API returns, never by hop.
const ROLE_THEMES = {
  VICTIM: { color: "#10B981", soft: "#E6F7F0", border: "#A7F3D0", text: "#059669" },
  L1: { color: "#EA580C", soft: "#FFF7ED", border: "#FFEDD5", text: "#EA580C" },
  L2: { color: "#D97706", soft: "#FEF3C7", border: "#FDE68A", text: "#D97706" },
  L3: { color: "#7C3AED", soft: "#EDE9FE", border: "#DDD6FE", text: "#7C3AED" }
};
const NO_ROLE_THEME = { color: "#746D65", soft: "#F3EDE2", border: "#E8E2D5", text: "#746D65" };
const ROLE_ORDER = ["VICTIM", "L1", "L2", "L3"];

export const DENSE_FROM = 60; // more accounts than this: compact cards, plain links

export function roleTheme(role) {
  return ROLE_THEMES[role] || NO_ROLE_THEME;
}

export function roleKey(role) {
  return ROLE_THEMES[role] ? role : "NONE";
}

export const ROLE_KEYS = [...ROLE_ORDER, "NONE"];

// Roles present in the trace, in a stable order, for the legend.
export function rolesPresent(nodes) {
  const seen = [...new Set(nodes.map((n) => n.role || null))];
  return seen.sort((a, b) => {
    const ia = ROLE_ORDER.indexOf(a);
    const ib = ROLE_ORDER.indexOf(b);
    return (ia < 0 ? ROLE_ORDER.length : ia) - (ib < 0 ? ROLE_ORDER.length : ib);
  });
}

// Risk shown for an account: victim_score for the victim, final_index for everyone else.
export function riskOf(node) {
  if (node.role === "VICTIM") return { label: "Victim score", value: node.victim_score ?? null };
  return { label: "Final index", value: node.final_index ?? null };
}

export const endId = (end) => (end !== null && typeof end === "object" ? end.id : end);

const pretty = (v) => (v === null || v === undefined || v === "" ? DASH : String(v).replace(/_/g, " "));
const yesNo = (v) => (v === true ? "Yes" : v === false ? "No" : DASH);

export function lagText(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return DASH;
  return `${num(seconds)} s (${(Number(seconds) / 60).toFixed(1)} min)`;
}

// The highest hop among the accounts returned (hop is used for layout and this count only).
export function hopsShown(nodes) {
  return nodes.reduce((max, n) => Math.max(max, n.hop ?? 0), 0);
}

// Layered layout: one layer per hop, laid out along the flow direction. Within a layer
// accounts are ordered by where their senders sit, and a long layer wraps into several lines.
export function layeredLayout(nodes, links, { vertical = false, dense = false } = {}) {
  const width = dense ? 184 : vertical ? 220 : 230;
  const height = dense ? 40 : vertical ? 74 : 66;
  const layerGap = dense ? 120 : vertical ? 130 : 150;
  const cardGap = dense ? 8 : vertical ? 36 : 20;
  const lineGap = dense ? 14 : 28;
  const perLine = dense ? 28 : 14;
  const alongSize = vertical ? height : width;
  const acrossSize = vertical ? width : height;

  const byHop = new Map();
  nodes.forEach((n) => {
    const h = n.hop ?? 0;
    if (!byHop.has(h)) byHop.set(h, []);
    byHop.get(h).push(n);
  });
  const hops = [...byHop.keys()].sort((a, b) => a - b);

  const senders = new Map();
  links.forEach((l) => {
    const t = endId(l.target);
    if (!senders.has(t)) senders.set(t, []);
    senders.get(t).push(endId(l.source));
  });

  const rank = new Map(); // account -> relative position inside its layer (0..1)
  const ordered = hops.map((h) => {
    const layer = byHop.get(h).map((n) => {
      const placed = (senders.get(n.id) || []).filter((s) => rank.has(s));
      const centre = placed.length ? placed.reduce((sum, s) => sum + rank.get(s), 0) / placed.length : 0.5;
      return { n, centre };
    });
    layer.sort(
      (a, b) =>
        a.centre - b.centre ||
        Number(b.n.tainted_received || 0) - Number(a.n.tainted_received || 0) ||
        String(a.n.id).localeCompare(String(b.n.id))
    );
    layer.forEach((item, i) => rank.set(item.n.id, layer.length > 1 ? i / (layer.length - 1) : 0.5));
    return layer.map((item) => item.n);
  });

  const extent = (count) => count * (acrossSize + cardGap) - cardGap;
  const widest = Math.max(1, ...ordered.map((layer) => Math.min(layer.length, perLine)));
  const acrossStart = 60;
  let along = 20;

  const positions = {};
  const layers = [];
  ordered.forEach((layer, i) => {
    const lines = Math.max(1, Math.ceil(layer.length / perLine));
    const inLine = Math.min(layer.length, perLine);
    const offset = acrossStart + (extent(widest) - extent(inLine)) / 2;
    layer.forEach((n, idx) => {
      const a = along + Math.floor(idx / perLine) * (alongSize + lineGap);
      const c = offset + (idx % perLine) * (acrossSize + cardGap);
      positions[n.id] = { x: vertical ? c : a, y: vertical ? a : c, width, height };
    });
    layers.push({ hop: hops[i], count: layer.length, x: vertical ? acrossStart : along, y: vertical ? along : acrossStart });
    along += lines * (alongSize + lineGap) - lineGap + layerGap;
  });

  const alongEnd = along - layerGap + 20;
  const acrossEnd = acrossStart + extent(widest) + 20;
  return {
    positions,
    layers,
    bounds: { width: vertical ? acrossEnd : alongEnd, height: vertical ? alongEnd : acrossEnd }
  };
}

// Path of one transfer between two placed cards.
export function linkGeometry(src, tgt, { vertical = false, curved = true } = {}) {
  let x1, y1, x2, y2, pathD;
  if (!vertical) {
    x1 = src.x + src.width;
    y1 = src.y + src.height / 2;
    x2 = tgt.x;
    y2 = tgt.y + tgt.height / 2;
    if (curved) {
      const dx = (x2 - x1) * 0.55;
      pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    } else if (Math.abs(y1 - y2) < 4) {
      pathD = `M ${x1} ${y1} L ${x2} ${y2}`;
    } else {
      const midX = (x1 + x2) / 2;
      const r = Math.min(14, Math.abs(y2 - y1) / 2);
      const s = y2 > y1 ? 1 : -1;
      pathD = `M ${x1} ${y1} L ${midX - r} ${y1} Q ${midX} ${y1} ${midX} ${y1 + r * s} L ${midX} ${y2 - r * s} Q ${midX} ${y2} ${midX + r} ${y2} L ${x2} ${y2}`;
    }
  } else {
    x1 = src.x + src.width / 2;
    y1 = src.y + src.height;
    x2 = tgt.x + tgt.width / 2;
    y2 = tgt.y;
    if (curved) {
      const dy = (y2 - y1) * 0.55;
      pathD = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
    } else if (Math.abs(x1 - x2) < 4) {
      pathD = `M ${x1} ${y1} L ${x2} ${y2}`;
    } else {
      const midY = (y1 + y2) / 2;
      const r = Math.min(14, Math.abs(x2 - x1) / 2);
      const s = x2 > x1 ? 1 : -1;
      pathD = `M ${x1} ${y1} L ${x1} ${midY - r} Q ${x1} ${midY} ${x1 + r * s} ${midY} L ${x2 - r * s} ${midY} Q ${x2} ${midY} ${x2} ${midY + r} L ${x2} ${y2}`;
    }
  }
  return { x1, y1, x2, y2, midX: (x1 + x2) / 2, midY: (y1 + y2) / 2, pathD };
}

function useCopy() {
  const [copied, setCopied] = useState(null);
  const copy = (value) => {
    navigator.clipboard?.writeText(String(value));
    setCopied(value);
    setTimeout(() => setCopied(null), 1500);
  };
  return [copied, copy];
}

export function RoleLegend({ nodes }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold" title="Colour shows the role the engine assigned">
      {rolesPresent(nodes).map((role) => {
        const theme = roleTheme(role);
        return (
          <div
            key={role || "none"}
            style={{ backgroundColor: theme.soft, borderColor: theme.border, color: theme.text }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border"
          >
            <span style={{ backgroundColor: theme.color }} className="w-2.5 h-2.5 rounded-full"></span>
            <span>{role || "No role"}</span>
          </div>
        );
      })}
    </div>
  );
}

// Clear badge when the display filter trims the trace.
export function TrimBadge({ traceData }) {
  if (!traceData?.display_trimmed) return null;
  const f = traceData.filters || {};
  const fewerAccounts = f.nodes_returned != null && f.nodes_total != null && f.nodes_returned < f.nodes_total;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A] font-mono">
      <Layers className="w-3 h-3" />
      Showing {hopsShown(traceData.nodes || [])} of {text(traceData.full_hops)} hops
      {fewerAccounts ? ` • ${num(f.nodes_returned)} of ${num(f.nodes_total)} accounts` : ""}
    </span>
  );
}

function Field({ label, children, tone }) {
  return (
    <div className="p-2.5 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] min-w-0">
      <span className="text-[#9E968D] block text-[10px] uppercase font-bold font-mono">{label}</span>
      <span style={tone ? { color: tone } : undefined} className="text-xs font-bold font-mono text-[#2C2623] break-words block">
        {children}
      </span>
    </div>
  );
}

// Account details, shown when a node is clicked.
export function NodePanel({ node, onClose, children }) {
  const theme = roleTheme(node.role);
  const risk = riskOf(node);
  const reasons = Array.isArray(node.reasons) ? node.reasons : node.reasons ? [node.reasons] : [];
  const cells = Array.isArray(node.cell_ids) && node.cell_ids.length ? node.cell_ids.join(", ") : DASH;
  return (
    <div className="bg-white border-2 border-[#D96B27] rounded-2xl p-5 shadow-lg relative">
      <button onClick={onClose} title="Close" className="absolute right-4 top-4 text-[#9E968D] hover:text-[#2C2623] p-1 cursor-pointer">
        <X className="w-4 h-4" />
      </button>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#F0EAE1] pb-3 pr-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-bold text-[#2C2623]">{node.id}</span>
          <span
            style={{ backgroundColor: theme.soft, color: theme.text, borderColor: theme.border }}
            className="text-xs px-2.5 py-0.5 rounded-full font-bold border"
          >
            {node.role || "No role"}
          </span>
          {node.freeze_recommended === true && (
            <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]">
              Freeze recommended
            </span>
          )}
        </div>
        {children}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <Field label="Role">{text(node.role)}</Field>
        <Field label={`Risk (${risk.label})`} tone="#DC2626">{num(risk.value, 1)}</Field>
        <Field label="Mule index">{num(node.mule_index, 1)}</Field>
        <Field label="Trust index">{num(node.trust_index, 1)}</Field>
        <Field label="Band">{pretty(node.band)}</Field>
        <Field label="Role confirmed">{yesNo(node.role_confirmed)}</Field>
        <Field label="Freeze recommended">{yesNo(node.freeze_recommended)}</Field>
        <Field label="Bank">{text(node.bank)}</Field>
        <Field label="Tainted in" tone="#EA580C">{inr(node.tainted_received)}</Field>
        <Field label="Tainted out" tone="#DC2626">{inr(node.tainted_forwarded)}</Field>
        <Field label="Holding" tone="#059669">{inr(node.holding_amount)}</Field>
        <Field label="Cell IDs">{cells}</Field>
        <Field label="Device">{text(node.device_type)}</Field>
        <Field label="IP">{text(node.ip_address)}</Field>
      </div>

      <div className="mt-3 p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] text-xs text-[#2C2623]">
        <span className="text-[#9E968D] block text-[10px] uppercase font-bold font-mono mb-1">Reasons</span>
        {reasons.length ? (
          <ul className="list-disc pl-4 space-y-0.5">
            {reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : (
          <span className="font-mono">{DASH}</span>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5">
      <span className="text-[#9E968D] text-[10px] uppercase font-bold font-mono shrink-0">{label}</span>
      <span className="text-[11px] font-mono text-[#2C2623] text-right break-all">{children}</span>
    </div>
  );
}

// Transfer details, shown inside the canvas while a link is hovered or after it is clicked.
export function LinkCard({ link, pinned, onClose }) {
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute right-3 top-3 z-20 w-80 max-w-[calc(100%-1.5rem)] bg-white border-2 border-[#D96B27] rounded-xl p-3 shadow-lg cursor-default select-text"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[#F0EAE1] pb-1.5 mb-1.5">
        <span className="text-[11px] font-bold font-mono text-[#2C2623] truncate">
          {text(endId(link.source))} → {text(endId(link.target))}
        </span>
        {pinned ? (
          <button onClick={onClose} title="Close" className="text-[#9E968D] hover:text-[#2C2623] cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span className="text-[9px] font-mono text-[#9E968D] whitespace-nowrap">click to pin</span>
        )}
      </div>
      <Row label="Amount">{inr(link.amount)}</Row>
      <Row label="Timestamp">{dateTime(link.timestamp)}</Row>
      <Row label="Txn ID">{text(link.txn_id)}</Row>
      <Row label="Link type">{text(link.link_type)}</Row>
      <Row label="Lag">{lagText(link.lag_seconds)}</Row>
      <Row label="Via">{pretty(link.via)}</Row>
      <Row label="Confidence">{pretty(link.confidence)}</Row>
      <Row label="Narration">{text(link.narration)}</Row>
      <Row label="Device">{text(link.device_type)}</Row>
      <Row label="IP">{text(link.ip_address)}</Row>
    </div>
  );
}

function Panel({ title, count, children }) {
  return (
    <div className="bg-white border border-[#E8E2D5] rounded-xl p-3.5 shadow-2xs">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#746D65] font-mono">{title}</span>
        {count != null && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FAF6EE] border border-[#E8E2D5] font-bold font-mono text-[#D96B27]">
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Confidence({ value }) {
  const high = value === "high";
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded font-bold font-mono border ${
        value == null
          ? "bg-[#F3EDE2] text-[#746D65] border-[#E8E2D5]"
          : high
          ? "bg-[#E6F7F0] text-[#059669] border-[#A7F3D0]"
          : "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]"
      }`}
    >
      {pretty(value)} confidence
    </span>
  );
}

function TxnChips({ ids }) {
  if (!ids?.length) return <span className="font-mono text-[11px]">{DASH}</span>;
  return (
    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
      {ids.map((id, i) => (
        <span key={`${id}-${i}`} className="text-[10px] px-1.5 py-0.5 rounded bg-[#FAF6EE] border border-[#E8E2D5] font-mono text-[#2C2623] select-text">
          {id}
        </span>
      ))}
    </div>
  );
}

const SUMMARY_PARTS = [
  ["who", "Who"],
  ["how", "How"],
  ["why", "Why"],
  ["when", "When"]
];

// Summary, per-hop table, findings, freeze list, reconciliation and fingerprint.
export function EvidencePanels({ traceData }) {
  const [copied, copy] = useCopy();
  const summary = traceData.summary || {};
  const perHop = Array.isArray(traceData.per_hop) ? traceData.per_hop : [];
  const findings = Array.isArray(traceData.findings) ? traceData.findings : [];
  const freeze = Array.isArray(traceData.freeze_candidates) ? traceData.freeze_candidates : [];
  const rec = traceData.reconcile || null;
  const fingerprint = traceData.fingerprint || null;
  const offBy = rec && rec.difference != null && Number(rec.difference) !== 0;

  return (
    <div className="space-y-3 select-text">
      <Panel title="Summary">
        <div className="space-y-2">
          {SUMMARY_PARTS.map(([key, label]) => (
            <div key={key}>
              <span className="text-[10px] font-bold uppercase font-mono text-[#D96B27]">{label}</span>
              <p className="text-xs text-[#2C2623] leading-snug">{text(summary[key])}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Reconciliation">
        {rec ? (
          <>
            <p className="text-xs font-mono text-[#2C2623] leading-relaxed">
              Paid <b className="text-[#DC2626]">{inr(rec.victim_paid)}</b> = kept <b>{inr(rec.commissions_kept)}</b> + held{" "}
              <b className="text-[#059669]">{inr(rec.holding_at_end)}</b> + untraced <b>{inr(rec.untraced)}</b>
            </p>
            <p className={`text-[11px] font-mono mt-1 ${offBy ? "text-[#DC2626] font-bold" : "text-[#746D65]"}`}>
              Difference: {inr(rec.difference)}
            </p>
          </>
        ) : (
          <span className="font-mono text-xs">{DASH}</span>
        )}
      </Panel>

      <Panel title="Per hop" count={perHop.length}>
        {perHop.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-left text-[#9E968D] text-[10px] uppercase border-b border-[#E8E2D5]">
                  <th className="py-1 pr-2 font-bold">Hop</th>
                  <th className="py-1 pr-2 font-bold">Accts</th>
                  <th className="py-1 pr-2 font-bold">Txns</th>
                  <th className="py-1 pr-2 font-bold">Tainted</th>
                  <th className="py-1 font-bold" title="Minutes since the previous hop">Gap (min)</th>
                </tr>
              </thead>
              <tbody>
                {perHop.map((h, i) => (
                  <React.Fragment key={h.hop ?? i}>
                    <tr className="text-[#2C2623]">
                      <td className="pt-1 pr-2 font-bold">{text(h.hop)}</td>
                      <td className="pt-1 pr-2">{num(h.accounts)}</td>
                      <td className="pt-1 pr-2">{num(h.transfers)}</td>
                      <td className="pt-1 pr-2">{inr(h.tainted)}</td>
                      <td className="pt-1">{num(h.minutes_since_previous_hop, 1)}</td>
                    </tr>
                    <tr className="border-b border-[#F0EAE1] text-[#746D65]">
                      <td colSpan={5} className="pb-1 text-[10px]">
                        {dateTime(h.first_ts)} → {dateTime(h.last_ts)}
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <span className="font-mono text-xs">{DASH}</span>
        )}
      </Panel>

      <Panel title="Findings" count={findings.length}>
        {findings.length ? (
          <div className="space-y-3">
            {findings.map((f, i) => (
              <div key={`${f.pattern}-${i}`} className="border-t border-[#F0EAE1] first:border-t-0 pt-2 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold font-mono text-[#2C2623]">{text(f.pattern)}</span>
                  <Confidence value={f.confidence ?? null} />
                </div>
                {f.evidence?.length ? (
                  <ul className="list-disc pl-4 mt-1 space-y-0.5 text-[11px] text-[#2C2623] leading-snug">
                    {f.evidence.map((sentence, j) => (
                      <li key={j}>{sentence}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] font-mono mt-1">{DASH}</p>
                )}
                <span className="text-[10px] font-bold uppercase font-mono text-[#9E968D] block mt-1.5 mb-1">
                  Transactions ({f.tx_ids?.length ?? 0})
                </span>
                <TxnChips ids={f.tx_ids} />
              </div>
            ))}
          </div>
        ) : (
          <span className="font-mono text-xs">{DASH}</span>
        )}
      </Panel>

      <Panel title="Freeze list" count={freeze.length}>
        {freeze.length ? (
          <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
            {freeze.map((c, i) => (
              <div key={c.acct_no ?? i} className="border-t border-[#F0EAE1] first:border-t-0 pt-2 first:pt-0">
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="font-bold text-[#2C2623]">{text(c.acct_no)}</span>
                  <span className="text-[#746D65]">{text(c.bank)}</span>
                  <span className="font-bold text-[#059669]">{inr(c.holding)}</span>
                </div>
                <span className="text-[10px] font-bold uppercase font-mono text-[#9E968D] block mt-1 mb-1">Proving txn IDs</span>
                <TxnChips ids={(c.receipts || []).map((r) => r.tx_id).filter(Boolean)} />
              </div>
            ))}
          </div>
        ) : (
          <span className="font-mono text-xs">{DASH}</span>
        )}
      </Panel>

      <Panel title="Fingerprint">
        <div className="flex items-start gap-2">
          <span className="text-[11px] font-mono text-[#2C2623] break-all flex-1">{text(fingerprint)}</span>
          {fingerprint && (
            <button
              onClick={() => copy(fingerprint)}
              title="Copy fingerprint"
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-sm bg-[#FAF6EE] border border-[#E8E2D5] text-[11px] font-bold font-mono text-[#2C2623] hover:bg-[#F3EDE2] cursor-pointer"
            >
              {copied === fingerprint ? <Check className="w-3 h-3 text-[#10B981]" /> : <Copy className="w-3 h-3" />}
              <span>{copied === fingerprint ? "Copied" : "Copy"}</span>
            </button>
          )}
        </div>
      </Panel>
    </div>
  );
}
