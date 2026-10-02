import React, { useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import { searchTransactions } from "../api";
import { dateTime, inr, num, text } from "../format";
import { EmptyState, ErrorState, LoadingState } from "./States";

const EMPTY = {
  minAmount: "",
  maxAmount: "",
  bank: "",
  paymentMode: "",
  device: "",
  foreignIp: "",
  narrationCategory: "",
  fromTs: "",
  toTs: "",
  limit: ""
};

// API query name -> form field, for placing a 422 message next to its input.
const FIELD_OF = {
  min_amount: "minAmount",
  max_amount: "maxAmount",
  bank: "bank",
  payment_mode: "paymentMode",
  device: "device",
  foreign_ip: "foreignIp",
  narration_category: "narrationCategory",
  from_ts: "fromTs",
  to_ts: "toTs",
  limit: "limit"
};

const NO_RESULT = { data: null, loading: false, error: null, fields: {} };

const inputClass =
  "w-full bg-[#FAF6EE] focus:bg-white border border-[#D4CEBF] focus:border-[#D96B27] rounded-sm px-2.5 py-2 text-xs font-mono text-[#2C2623] focus:outline-none";

function Field({ label, error, children }) {
  return (
    <div>
      <label className="text-[11px] font-bold text-[#2C2623] block mb-1">{label}</label>
      {children}
      {error && <p className="text-[11px] text-[#B91C1C] mt-1">{error}</p>}
    </div>
  );
}

// Searches transactions with the filters the API whitelists, and nothing else.
export default function TransactionSearchPanel() {
  const [form, setForm] = useState(EMPTY);
  const [state, setState] = useState(NO_RESULT);

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const run = async () => {
    setState((s) => ({ ...s, loading: true, error: null, fields: {} }));
    try {
      setState({ ...NO_RESULT, data: await searchTransactions(form) });
    } catch (err) {
      const fields = {};
      const other = [];
      (err.errors || []).forEach(({ field, message }) => {
        const key = FIELD_OF[String(field || "").replace(/^query\./, "")];
        if (key) fields[key] = message;
        else other.push(`${field}: ${message}`);
      });
      const placed = Object.keys(fields).length > 0;
      setState({ ...NO_RESULT, error: placed && !other.length ? null : other.join("; ") || err.message, fields });
    }
  };

  const textInput = (field) => (
    <input type="text" placeholder="any" value={form[field]} onChange={(e) => set(field, e.target.value)} className={inputClass} />
  );
  const d = state.data;
  const rows = d?.transactions || [];

  return (
    <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
      <div className="p-3.5 border-b border-[#E8E2D5] bg-[#FAF6EE]">
        <h3 className="font-bold text-sm text-[#2C2623] font-serif">Transaction search</h3>
        <p className="text-[11px] text-[#746D65] mt-0.5">
          Looks up stored transactions by the fields the API allows. It does not change scores or roles.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Field label="Minimum amount (₹)" error={state.fields.minAmount}>
            <input type="number" step="any" value={form.minAmount} onChange={(e) => set("minAmount", e.target.value)} className={inputClass} />
          </Field>
          <Field label="Maximum amount (₹)" error={state.fields.maxAmount}>
            <input type="number" step="any" value={form.maxAmount} onChange={(e) => set("maxAmount", e.target.value)} className={inputClass} />
          </Field>
          <Field label="Bank code" error={state.fields.bank}>
            {textInput("bank")}
          </Field>
          <Field label="Payment mode" error={state.fields.paymentMode}>
            {textInput("paymentMode")}
          </Field>
          <Field label="Device" error={state.fields.device}>
            {textInput("device")}
          </Field>
          <Field label="Foreign IP" error={state.fields.foreignIp}>
            <select value={form.foreignIp} onChange={(e) => set("foreignIp", e.target.value)} className={inputClass}>
              <option value="">Any</option>
              <option value="true">Foreign only</option>
              <option value="false">Domestic only</option>
            </select>
          </Field>
          <Field label="Narration category" error={state.fields.narrationCategory}>
            {textInput("narrationCategory")}
          </Field>
          <Field label="From" error={state.fields.fromTs}>
            <input type="datetime-local" step="1" value={form.fromTs} onChange={(e) => set("fromTs", e.target.value)} className={inputClass} />
          </Field>
          <Field label="To" error={state.fields.toTs}>
            <input type="datetime-local" step="1" value={form.toTs} onChange={(e) => set("toTs", e.target.value)} className={inputClass} />
          </Field>
          <Field label="Limit" error={state.fields.limit}>
            <input type="number" placeholder="API default" value={form.limit} onChange={(e) => set("limit", e.target.value)} className={inputClass} />
          </Field>
        </div>
        <div className="px-4 py-3 border-t border-[#E8E2D5] flex items-center justify-between gap-3">
          <span className="text-[11px] text-[#746D65] font-mono">
            {d ? `${num(d.matched)} matched • showing ${num(d.returned)} (limit ${num(d.limit)})` : ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setForm(EMPTY);
                setState(NO_RESULT);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-white border border-[#D4CEBF] text-[#2C2623] text-xs font-semibold hover:bg-[#FAF6EE] cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
            <button
              type="submit"
              disabled={state.loading}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-sm bg-[#D96B27] hover:bg-[#C25B1C] disabled:opacity-60 text-white text-xs font-bold shadow-2xs cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Search</span>
            </button>
          </div>
        </div>
      </form>

      {(state.loading || state.error || d) && (
        <div className="p-4 border-t border-[#E8E2D5]">
          {state.loading ? (
            <LoadingState label="Searching transactions..." />
          ) : state.error ? (
            <ErrorState title="The search could not be run" message={state.error} onRetry={run} />
          ) : !rows.length ? (
            <EmptyState title="No transactions match these filters" />
          ) : (
            <div className="overflow-auto border border-[#E8E2D5] rounded-sm max-h-[28rem]">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0">
                  <tr className="bg-[#FAF6EE] border-b border-[#E8E2D5] text-[10px] font-bold uppercase tracking-wider text-[#746D65] font-mono">
                    <th className="py-2.5 px-3">Time</th>
                    <th className="py-2.5 px-3">From</th>
                    <th className="py-2.5 px-3">To</th>
                    <th className="py-2.5 px-3 text-right">Amount</th>
                    <th className="py-2.5 px-3">Mode</th>
                    <th className="py-2.5 px-3">Narration</th>
                    <th className="py-2.5 px-3">Device</th>
                    <th className="py-2.5 px-3">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFEAE1]">
                  {rows.map((t) => (
                    <tr key={t.tx_key} className="hover:bg-[#FAF6EE]">
                      <td className="py-2 px-3 font-mono whitespace-nowrap">{dateTime(t.timestamp)}</td>
                      <td className="py-2 px-3 font-mono">
                        {t.source}
                        <span className="text-[#9E968D]"> {text(t.source_bank)}</span>
                      </td>
                      <td className="py-2 px-3 font-mono">
                        {t.target}
                        <span className="text-[#9E968D]"> {text(t.target_bank)}</span>
                      </td>
                      <td className="py-2 px-3 font-mono text-right whitespace-nowrap">{inr(t.amount)}</td>
                      <td className="py-2 px-3 font-mono">{text(t.payment_mode)}</td>
                      <td className="py-2 px-3">
                        <span className="font-mono font-bold text-[#2C2623]">{text(t.narration_category)}</span>
                        <div className="text-[11px] text-[#746D65] font-mono">{text(t.narration)}</div>
                      </td>
                      <td className="py-2 px-3 font-mono">{text(t.device_type)}</td>
                      <td className="py-2 px-3 font-mono whitespace-nowrap">
                        {text(t.ip_address)}
                        {t.is_foreign_ip && (
                          <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-xs bg-[#FEF2F2] text-[#DC2626]">foreign</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
