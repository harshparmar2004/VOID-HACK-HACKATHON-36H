import React, { useEffect, useState } from "react";
import { FolderOpen, FolderPlus, Lock, X } from "lucide-react";
import { text } from "../format";
import { ErrorState, LoadingState } from "./States";

const INPUT =
  "px-2.5 py-1.5 rounded-sm border border-[#D4CEBF] bg-white text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]";
const BUTTON =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

export const isClosed = (caseRec) => caseRec?.data?.status === "CLOSED";
// A case that documents may be written to: one exists and it is not closed.
export const canWrite = (caseRec) => Boolean(caseRec?.data) && !isClosed(caseRec);

// The case of the selected victim: open one, see its status and events, close it.
export default function CaseBar({ victim, caseRec, caseInfo, onOpen, onClose, onRetry }) {
  const [form, setForm] = useState({ officer: "", firNumber: "", complainant: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // The closing dialog: null when shut, else the officer and note being typed.
  const [closing, setClosing] = useState(null);
  const data = caseRec.data;
  const closed = isClosed(caseRec);

  // What the officer typed when registering the FIR is offered, not assumed.
  useEffect(() => {
    setForm((f) => ({ ...f, firNumber: caseInfo?.firNumber || "", complainant: caseInfo?.complainant || "" }));
    setError(null);
  }, [victim, caseInfo]);

  const run = async (action) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  if (!victim) return null;
  if (caseRec.loading) return <LoadingState label="Loading the case..." />;
  if (caseRec.error) return <ErrorState title="The case could not be loaded" message={caseRec.error} onRetry={onRetry} />;

  return (
    <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
      {data && (
        <div className="p-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-[#E8E2D5] bg-[#FAF6EE]">
          <div className="text-xs font-mono flex flex-wrap gap-x-6 gap-y-1">
            <span>
              <span className="text-[#746D65]">Case: </span>
              <b className="text-[#2C2623]">{data.case_id}</b>
            </span>
            <span>
              <span className="text-[#746D65]">Status: </span>
              <b className={closed ? "text-[#DC2626]" : "text-[#059669]"}>{text(data.status)}</b>
            </span>
            <span>
              <span className="text-[#746D65]">Officer: </span>
              <b className="text-[#2C2623]">{text(data.officer)}</b>
            </span>
            <span>
              <span className="text-[#746D65]">FIR number: </span>
              <b className="text-[#2C2623]">{text(data.fir_number)}</b>
            </span>
            <span>
              <span className="text-[#746D65]">Complainant: </span>
              <b className="text-[#2C2623]">{text(data.complainant)}</b>
            </span>
          </div>
          <button
            type="button"
            disabled={busy || closed}
            title={closed ? "This case is closed" : undefined}
            onClick={() => setClosing({ officer: data.officer || "", note: "" })}
            className={`${BUTTON} bg-white border border-[#FECACA] text-[#991B1B] hover:bg-[#FEE2E2]`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Close case</span>
          </button>
        </div>
      )}

      {(!data || closed) && (
        <form
          className="p-3.5 flex flex-wrap items-end gap-2 border-b border-[#E8E2D5]"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => onOpen({ ...form, officer: form.officer.trim() }));
          }}
        >
          <span className="text-xs text-[#746D65] w-full">
            {closed ? "This case is closed. Open a new case for " : "No case is open for "}
            <b className="font-mono text-[#2C2623]">{victim}</b>
            {closed ? " to write further documents." : ". Documents are written to a case."}
          </span>
          <input className={INPUT} placeholder="Officer (required)" value={form.officer} onChange={set("officer")} required maxLength={300} />
          <input className={INPUT} placeholder="FIR number" value={form.firNumber} onChange={set("firNumber")} maxLength={300} />
          <input className={INPUT} placeholder="Complainant" value={form.complainant} onChange={set("complainant")} maxLength={300} />
          <button type="submit" disabled={busy || !form.officer.trim()} className={`${BUTTON} bg-[#D96B27] text-white hover:bg-[#C25A1C]`}>
            <FolderPlus className="w-3.5 h-3.5" />
            <span>Open case</span>
          </button>
        </form>
      )}

      {error && <p className="px-3.5 py-2 text-xs font-mono text-[#B91C1C] bg-[#FEF2F2] border-b border-[#FECACA] break-words">{error}</p>}

      {closing && data && (
        <div className="fixed inset-0 bg-[#2C2623]/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <form
            className="bg-white border border-[#E8E2D5] rounded-xl max-w-md w-full shadow-2xl overflow-hidden"
            onSubmit={(e) => {
              e.preventDefault();
              const body = { officer: closing.officer.trim(), note: closing.note.trim() };
              setClosing(null);
              run(() => onClose(data, body));
            }}
          >
            <div className="bg-[#FAF6EE] border-b border-[#E8E2D5] px-5 py-3 flex items-center justify-between">
              <h2 className="text-base font-serif font-bold text-[#2C2623]">Close case {data.case_id}</h2>
              <button type="button" onClick={() => setClosing(null)} title="Cancel" className="text-[#746D65] hover:text-[#2C2623] cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-[#746D65]">
                A closed case cannot be reopened. No notice, diary, FIR or freeze entry can be written to it afterwards.
              </p>
              <input
                className={`${INPUT} w-full`}
                placeholder="Officer (required)"
                value={closing.officer}
                onChange={(e) => setClosing((c) => ({ ...c, officer: e.target.value }))}
                required
                maxLength={300}
              />
              <textarea
                className={`${INPUT} w-full h-24`}
                placeholder="Closing note (required)"
                value={closing.note}
                onChange={(e) => setClosing((c) => ({ ...c, note: e.target.value }))}
                required
                maxLength={300}
                autoFocus
              />
            </div>
            <div className="px-5 py-3 border-t border-[#E8E2D5] flex justify-end gap-2">
              <button type="button" onClick={() => setClosing(null)} className={`${BUTTON} bg-white border border-[#D4CEBF] text-[#2C2623] hover:bg-[#FAF6EE]`}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={!closing.officer.trim() || !closing.note.trim()}
                className={`${BUTTON} bg-[#DC2626] text-white hover:bg-[#B91C1C]`}
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Close case</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {data && (
        <details className="text-xs">
          <summary className="px-3.5 py-2 cursor-pointer text-[#746D65] font-semibold flex items-center gap-1.5">
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Events ({(data.events || []).length})</span>
          </summary>
          <ul className="divide-y divide-[#EFEAE1] font-mono max-h-48 overflow-y-auto border-t border-[#E8E2D5]">
            {(data.events || []).map((ev) => (
              <li key={ev.event_id} className="px-3.5 py-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                <span className="text-[#746D65]">{ev.created_at}</span>
                <b className="text-[#2C2623]">{ev.event}</b>
                <span>{text(ev.officer)}</span>
                {ev.note && <span className="text-[#5C554E]">{ev.note}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
