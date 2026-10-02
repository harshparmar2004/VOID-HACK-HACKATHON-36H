import React, { useEffect, useState } from "react";
import { X, ArrowRight, FileText } from "lucide-react";
import { draftFir } from "../api";
import { canWrite, isClosed } from "./CaseBar";

const EMPTY_TRACE_FORM = { accountNumber: "", firNumber: "", complainant: "" };
const EMPTY_FIR_FORM = { name: "", address: "", phone: "", email: "", offenceSummary: "", sectionsOfLaw: "", policeStation: "" };

const INPUT =
  "w-full bg-[#FAF6EE] focus:bg-white border border-[#D4CEBF] focus:border-[#D96B27] rounded-sm px-2.5 py-2 text-xs font-mono text-[#2C2623] focus:outline-none transition-colors";
const LABEL = "text-[11px] font-bold text-[#2C2623] block mb-1";

// Two forms in one dialog. With a case open for the selected victim: the FIR
// draft, posted to the case and stored there. Otherwise (or on request): pick a
// victim account to trace; the FIR number and name typed there are offered to
// the open-case form and stored only when a case is opened.
export default function RegisterFIRModal({ isOpen, onClose, onRegisterCase, onFirDrafted, victim, caseRec, victimAccounts = [] }) {
  const [traceForm, setTraceForm] = useState(EMPTY_TRACE_FORM);
  const [firForm, setFirForm] = useState(EMPTY_FIR_FORM);
  const [pickAccount, setPickAccount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const data = caseRec?.data;
  const writable = canWrite(caseRec);
  const firMode = writable && !pickAccount;

  // The case's complainant is offered as the name; the officer may change it.
  useEffect(() => {
    if (!isOpen) return;
    setPickAccount(false);
    setError(null);
    setFirForm((f) => ({ ...f, name: f.name || data?.complainant || "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, data?.case_id]);

  if (!isOpen) return null;

  const setTrace = (field) => (e) => setTraceForm((f) => ({ ...f, [field]: e.target.value }));
  const setFir = (field) => (e) => setFirForm((f) => ({ ...f, [field]: e.target.value }));
  const account = traceForm.accountNumber.trim().toUpperCase();
  const known = victimAccounts.includes(account);

  const submitTrace = (e) => {
    e.preventDefault();
    if (!account) {
      setError("Enter the victim's bank account number.");
      return;
    }
    onRegisterCase({ accountNumber: account, firNumber: traceForm.firNumber.trim(), complainant: traceForm.complainant.trim() });
    setTraceForm(EMPTY_TRACE_FORM);
    setError(null);
    onClose();
  };

  const submitFir = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const doc = await draftFir({
        caseId: data.case_id,
        victim,
        complainant: { name: firForm.name.trim(), address: firForm.address, phone: firForm.phone, email: firForm.email },
        offenceSummary: firForm.offenceSummary.trim(),
        sectionsOfLaw: firForm.sectionsOfLaw,
        policeStation: firForm.policeStation
      });
      setFirForm(EMPTY_FIR_FORM);
      onFirDrafted(doc);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#2C2623]/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white border border-[#E8E2D5] rounded-xl max-w-xl w-full shadow-2xl overflow-hidden my-6">
        <div className="bg-[#FAF6EE] border-b border-[#E8E2D5] px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-serif font-bold text-[#2C2623] tracking-tight">
              {firMode ? "Register FIR (draft)" : "Open a case by victim account"}
            </h2>
            <p className="text-xs text-[#7C746D] mt-0.5">
              {firMode ? (
                <>
                  Case <b className="font-mono">{data.case_id}</b>, victim account <b className="font-mono">{victim}</b>. The draft is stored in
                  the case; it is not filed anywhere.
                </>
              ) : (
                "The account is traced through the loaded transactions."
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-md bg-white border border-[#E8E2D5] flex items-center justify-center text-[#746D65] hover:text-[#2C2623] hover:bg-[#F3EDE2] transition-colors cursor-pointer shrink-0"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {firMode ? (
          <form onSubmit={submitFir} className="p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Complainant name (required)</label>
                <input type="text" value={firForm.name} onChange={setFir("name")} className={INPUT} required maxLength={300} autoFocus />
              </div>
              <div>
                <label className={LABEL}>Phone (optional)</label>
                <input type="text" value={firForm.phone} onChange={setFir("phone")} className={INPUT} maxLength={300} />
              </div>
              <div>
                <label className={LABEL}>Address (optional)</label>
                <input type="text" value={firForm.address} onChange={setFir("address")} className={INPUT} maxLength={300} />
              </div>
              <div>
                <label className={LABEL}>Email (optional)</label>
                <input type="text" value={firForm.email} onChange={setFir("email")} className={INPUT} maxLength={300} />
              </div>
            </div>
            <div>
              <label className={LABEL}>Summary of the offence (required; printed as typed)</label>
              <textarea value={firForm.offenceSummary} onChange={setFir("offenceSummary")} className={`${INPUT} h-28`} required maxLength={4000} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Sections of law (optional)</label>
                <input type="text" value={firForm.sectionsOfLaw} onChange={setFir("sectionsOfLaw")} className={INPUT} maxLength={300} />
              </div>
              <div>
                <label className={LABEL}>Police station (optional)</label>
                <input type="text" value={firForm.policeStation} onChange={setFir("policeStation")} className={INPUT} maxLength={300} />
              </div>
            </div>

            {error && <p className="text-xs text-[#DC2626] font-medium break-words">{error}</p>}

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E8E2D5]">
              <button type="button" onClick={() => setPickAccount(true)} className="text-xs text-[#746D65] underline cursor-pointer">
                Trace another account instead
              </button>
              <button
                type="submit"
                disabled={busy || !firForm.name.trim() || !firForm.offenceSummary.trim()}
                className="flex items-center gap-2 px-5 py-2 rounded-sm bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-bold shadow-2xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{busy ? "Drafting..." : "Draft FIR"}</span>
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={submitTrace} className="p-6 space-y-4">
            <div>
              <label className={LABEL}>Victim account number (required)</label>
              <input type="text" value={traceForm.accountNumber} onChange={setTrace("accountNumber")} className={INPUT} autoFocus />
              {account && (
                <p className={`text-[11px] mt-1 ${known ? "text-[#059669]" : "text-[#B45309]"}`}>
                  {known
                    ? "This account is in the engine's victim list."
                    : "Not in the engine's victim list. It will still be traced if it appears in the data."}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>FIR number (optional)</label>
                <input type="text" value={traceForm.firNumber} onChange={setTrace("firNumber")} className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>Complainant name (optional)</label>
                <input type="text" value={traceForm.complainant} onChange={setTrace("complainant")} className={INPUT} />
              </div>
            </div>

            <p className="text-[11px] text-[#746D65]">
              {isClosed(caseRec) && !pickAccount
                ? "The case of the selected victim is closed, so no FIR can be drafted for it. "
                : ""}
              The FIR number and name are stored when you open a case for the account (case bar on the Endpoint Trail). With a case open, this
              dialog drafts the FIR.
            </p>

            {error && <p className="text-xs text-[#DC2626] font-medium">{error}</p>}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E8E2D5]">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-sm bg-white border border-[#D4CEBF] text-[#2C2623] text-xs font-semibold hover:bg-[#FAF6EE] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center gap-2 px-5 py-2 rounded-sm bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-bold shadow-2xs cursor-pointer"
              >
                <span>Trace this account</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
