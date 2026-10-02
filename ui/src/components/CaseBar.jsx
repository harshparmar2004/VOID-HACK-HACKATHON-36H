import React, { useEffect, useState } from "react";
import { FolderOpen, FolderPlus, Lock } from "lucide-react";
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
            onClick={() => run(() => onClose(data))}
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
