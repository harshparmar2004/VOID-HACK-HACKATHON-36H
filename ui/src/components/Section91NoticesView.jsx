import React, { useMemo } from "react";
import { FileText, Lock, Unlock } from "lucide-react";
import { inr, num, text } from "../format";
import { EmptyState, ErrorState, LaterButton, LaterStep, LoadingState, PageHeader, Stat } from "./States";

// Notice documents and the freeze register are not built yet. The table lists the
// engine's freeze candidates for the selected victim; nothing here is sent to a bank.
export default function Section91NoticesView({ trace, onRetry }) {
  const candidates = trace.data?.freeze_candidates || [];

  const byBank = useMemo(() => {
    const map = {};
    candidates.forEach((c) => {
      const key = c.bank || "";
      if (!map[key]) map[key] = { bank: c.bank, accounts: 0, holding: 0 };
      map[key].accounts += 1;
      map[key].holding += Number(c.holding) || 0;
    });
    return Object.values(map).sort((a, b) => b.holding - a.holding);
  }, [candidates]);

  const totalHolding = candidates.reduce((sum, c) => sum + (Number(c.holding) || 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Legal"
        title="Section 91 Notices"
        subtitle="Accounts the engine recommends freezing for the selected victim, grouped by bank."
      >
        <LaterButton icon={FileText}>Generate notices</LaterButton>
        <LaterButton icon={Lock}>Freeze all</LaterButton>
      </PageHeader>

      <LaterStep title="Notice documents, freeze and unfreeze">
        The list below is a recommendation from the trace. No notice has been drafted and no bank has been contacted.
      </LaterStep>

      {trace.loading ? (
        <LoadingState label="Tracing..." />
      ) : trace.error ? (
        <ErrorState title="The trace could not be loaded" message={trace.error} onRetry={onRetry} />
      ) : !trace.data ? (
        <EmptyState title="No trace" hint="Select a victim account with a money trail to see its freeze candidates." />
      ) : candidates.length === 0 ? (
        <EmptyState
          title={`No freeze candidates for ${text(trace.victim)}`}
          hint="No freeze-recommended account in this trace still holds the victim's money."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Victim account" value={text(trace.victim)} />
            <Stat label="Freeze candidates" value={num(candidates.length)} tone="red" />
            <Stat label="Banks involved" value={num(byBank.length)} />
            <Stat label="Victim money held" value={inr(totalHolding)} tone="green" />
          </div>

          <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
            <div className="p-3.5 border-b border-[#E8E2D5] bg-[#FAF6EE]">
              <h3 className="font-bold text-sm text-[#2C2623] font-serif">By bank</h3>
            </div>
            <div className="p-3.5 flex flex-wrap gap-2 text-xs font-mono">
              {byBank.map((b) => (
                <span key={b.bank || "unknown"} className="px-2.5 py-1 rounded-sm bg-[#FAF6EE] border border-[#E8E2D5]">
                  <b className="text-[#D96B27]">{text(b.bank)}</b> • {num(b.accounts)} account(s) • {inr(b.holding)}
                </span>
              ))}
            </div>
          </div>

          <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#FAF6EE] border-b border-[#E8E2D5] text-[10px] font-bold uppercase tracking-wider text-[#746D65] font-mono">
                    <th className="py-2.5 px-4">Account</th>
                    <th className="py-2.5 px-4">Bank</th>
                    <th className="py-2.5 px-4">Role</th>
                    <th className="py-2.5 px-4">Hop</th>
                    <th className="py-2.5 px-4">Cell</th>
                    <th className="py-2.5 px-4">Victim money received</th>
                    <th className="py-2.5 px-4">Victim money held</th>
                    <th className="py-2.5 px-4">Receipts</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFEAE1] font-mono">
                  {candidates.map((c) => (
                    <tr key={c.acct_no} className="hover:bg-[#FAF6EE]">
                      <td className="py-2.5 px-4 font-bold text-[#2C2623]">{c.acct_no}</td>
                      <td className="py-2.5 px-4">{text(c.bank)}</td>
                      <td className="py-2.5 px-4">{text(c.role)}</td>
                      <td className="py-2.5 px-4">{num(c.hop)}</td>
                      <td className="py-2.5 px-4">{Array.isArray(c.cell_ids) && c.cell_ids.length ? c.cell_ids.join(", ") : text(c.cell_id)}</td>
                      <td className="py-2.5 px-4">{inr(c.tainted_in)}</td>
                      <td className="py-2.5 px-4 font-bold text-[#059669]">{inr(c.holding)}</td>
                      <td className="py-2.5 px-4" title={(c.receipts || []).map((r) => r.tx_id).join(", ")}>
                        {num((c.receipts || []).length)}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <LaterButton icon={Lock}>Freeze</LaterButton>
                          <LaterButton icon={Unlock}>Unfreeze</LaterButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
