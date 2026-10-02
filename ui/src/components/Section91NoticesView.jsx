import React, { useEffect, useMemo, useState } from "react";
import { FileText, Loader2, Lock, Unlock } from "lucide-react";
import { generateNotices } from "../api";
import { inr, num, text } from "../format";
import { canWrite, isClosed } from "./CaseBar";
import DocumentView from "./DocumentView";
import { EmptyState, ErrorState, LaterButton, LaterStep, LoadingState, PageHeader, Stat } from "./States";

const NO_NOTICES = { list: null, message: null, busy: false, error: null };

// Draft freeze notices, one per bank, written to the open case and read back from
// the case store. The freeze register is not wired here yet. The table lists the
// engine's freeze candidates for the selected victim; nothing here is sent to a bank.
export default function Section91NoticesView({ trace, onRetry, caseRec, caseBar, onCaseChanged }) {
  const candidates = trace.data?.freeze_candidates || [];
  const caseId = caseRec?.data?.case_id;
  const [notices, setNotices] = useState(NO_NOTICES);
  const [openDoc, setOpenDoc] = useState(null);

  useEffect(() => {
    setNotices(NO_NOTICES);
    setOpenDoc(null);
  }, [trace.victim, caseId]);

  const generate = async () => {
    setNotices({ ...NO_NOTICES, busy: true });
    setOpenDoc(null);
    try {
      const res = await generateNotices(trace.victim, caseId);
      setNotices({ ...NO_NOTICES, list: res.notices || [], message: res.message });
      onCaseChanged(caseId);
    } catch (err) {
      setNotices({ ...NO_NOTICES, error: err.message });
    }
  };

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
        <button
          type="button"
          onClick={generate}
          disabled={!canWrite(caseRec) || !trace.victim || notices.busy}
          title={isClosed(caseRec) ? "This case is closed" : !caseId ? "Open a case first" : undefined}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#D96B27] text-white text-xs font-semibold hover:bg-[#C25A1C] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {notices.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          <span>Generate notices</span>
        </button>
        <LaterButton icon={Lock}>Freeze all</LaterButton>
      </PageHeader>

      {caseBar}

      {notices.error && <ErrorState title="The notices could not be generated" message={notices.error} onRetry={generate} />}
      {notices.list && notices.list.length === 0 && (
        <EmptyState title="No notice was written" hint={notices.message || undefined} />
      )}
      {notices.list && notices.list.length > 0 && (
        <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
          <div className="p-3.5 border-b border-[#E8E2D5] bg-[#FAF6EE]">
            <h3 className="font-bold text-sm text-[#2C2623] font-serif">Draft notices ({notices.list.length}), one per bank</h3>
          </div>
          <ul className="divide-y divide-[#EFEAE1] text-xs font-mono">
            {notices.list.map((n) => (
              <li key={n.output_id} className="p-3.5 flex flex-wrap items-center justify-between gap-3">
                <span>
                  <b className="text-[#D96B27]">{text(n.bank)}</b> • {text(n.bank_name)} • version {n.version} • {text(n.generator)}
                </span>
                <button
                  type="button"
                  onClick={() => setOpenDoc(n)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-white border border-[#D4CEBF] text-[#2C2623] text-xs font-semibold hover:bg-[#FAF6EE] cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>{openDoc?.output_id === n.output_id ? "Showing" : "Open"}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {openDoc && <DocumentView key={openDoc.output_id} doc={openDoc} />}

      <LaterStep title="Freeze and unfreeze">
        The list below is a recommendation from the trace. A notice is a draft until an officer signs it; no bank has been contacted.
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
