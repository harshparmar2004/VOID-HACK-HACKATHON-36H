import React, { useState } from "react";
import { X, ArrowRight } from "lucide-react";
import { LaterStep } from "./States";

const EMPTY_FORM = { accountNumber: "", firNumber: "", complainant: "" };

// Opens a case for a victim account. The FIR number and complainant name are
// typed by the officer and are only labels in this browser session.
export default function RegisterFIRModal({ isOpen, onClose, onRegisterCase, victimAccounts = [] }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const account = form.accountNumber.trim().toUpperCase();
  const known = victimAccounts.includes(account);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!account) {
      setError("Enter the victim's bank account number.");
      return;
    }
    onRegisterCase({ accountNumber: account, firNumber: form.firNumber.trim(), complainant: form.complainant.trim() });
    setForm(EMPTY_FORM);
    setError(null);
    onClose();
  };

  const inputClass =
    "w-full bg-[#FAF6EE] focus:bg-white border border-[#D4CEBF] focus:border-[#D96B27] rounded-sm px-2.5 py-2 text-xs font-mono text-[#2C2623] focus:outline-none transition-colors";

  return (
    <div className="fixed inset-0 bg-[#2C2623]/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white border border-[#E8E2D5] rounded-xl max-w-xl w-full shadow-2xl overflow-hidden my-6">
        <div className="bg-[#FAF6EE] border-b border-[#E8E2D5] px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-serif font-bold text-[#2C2623] tracking-tight">Open a case by victim account</h2>
            <p className="text-xs text-[#7C746D] mt-0.5">The account is traced through the loaded transactions.</p>
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-[11px] font-bold text-[#2C2623] block mb-1">Victim account number (required)</label>
            <input type="text" value={form.accountNumber} onChange={set("accountNumber")} className={inputClass} autoFocus />
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
              <label className="text-[11px] font-bold text-[#2C2623] block mb-1">FIR number (optional)</label>
              <input type="text" value={form.firNumber} onChange={set("firNumber")} className={inputClass} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-[#2C2623] block mb-1">Complainant name (optional)</label>
              <input type="text" value={form.complainant} onChange={set("complainant")} className={inputClass} />
            </div>
          </div>

          <LaterStep title="Saving the case register">
            The FIR number and name are shown in the header for this session only. They are not stored.
          </LaterStep>

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
      </div>
    </div>
  );
}
