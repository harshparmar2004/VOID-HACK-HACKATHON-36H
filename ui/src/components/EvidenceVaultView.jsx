import React, { useCallback, useEffect, useState } from "react";
import { FileCheck, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { fetchVaultArtifacts, verifyVault } from "../api";
import { dateTime, num, text } from "../format";
import { EmptyState, ErrorState, LaterButton, LoadingState, PageHeader } from "./States";

// The artifact ledger of the case store (every stored document with its SHA-256)
// and its verification, as the API reports them, with the two fingerprints the
// engine produces. The certificate is not served by the API yet.
export default function EvidenceVaultView({ status, trace, onRetry, isActive }) {
  const s = status.data;
  const [ledger, setLedger] = useState({ data: null, loading: true, error: null });
  const [check, setCheck] = useState({ data: null, busy: false, error: null });

  const loadLedger = useCallback(async () => {
    setLedger((l) => ({ ...l, loading: true, error: null }));
    try {
      setLedger({ data: await fetchVaultArtifacts(), loading: false, error: null });
    } catch (err) {
      setLedger({ data: null, loading: false, error: err.message });
    }
  }, []);

  // Other tabs write documents, so the ledger is read again each time this tab is shown.
  useEffect(() => {
    if (isActive) loadLedger();
  }, [isActive, loadLedger]);

  const verify = async () => {
    setCheck({ data: null, busy: true, error: null });
    try {
      setCheck({ data: await verifyVault(), busy: false, error: null });
    } catch (err) {
      setCheck({ data: null, busy: false, error: err.message });
    }
  };

  const artifacts = ledger.data?.artifacts || [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Case operations"
        title="Evidence Vault"
        subtitle="Chain-of-custody ledger for the case evidence."
      >
        <button
          type="button"
          onClick={verify}
          disabled={check.busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#D96B27] text-white text-xs font-semibold hover:bg-[#C25A1C] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {check.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
          <span>Verify</span>
        </button>
        <LaterButton icon={FileCheck}>Section 63 BSA certificate</LaterButton>
      </PageHeader>

      {check.error && <ErrorState title="The vault could not be verified" message={check.error} onRetry={verify} />}
      {check.data && (
        <div
          className={`border rounded-md p-4 shadow-2xs text-xs ${
            check.data.ok ? "bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]" : "bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]"
          }`}
        >
          <p className="font-bold">{check.data.ok ? "PASS: the case store verifies" : "FAIL: the case store does not verify"}</p>
          <p className="font-mono mt-1">
            {num(check.data.documents)} stored document(s) re-hashed • triggers {num(check.data.triggers)} of{" "}
            {num(check.data.triggers_expected)} • rows:{" "}
            {Object.entries(check.data.rows || {})
              .map(([table, n]) => `${table} ${num(n)}`)
              .join(", ")}
          </p>
          {(check.data.problems || []).length > 0 && (
            <ul className="list-disc pl-5 mt-1.5 font-mono space-y-0.5 break-words">
              {check.data.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
        <div className="p-3.5 border-b border-[#E8E2D5] bg-[#FAF6EE] flex items-center justify-between gap-3">
          <h3 className="font-bold text-sm text-[#2C2623] font-serif">
            Stored documents{ledger.data ? ` (${num(ledger.data.count)})` : ""}
          </h3>
          <button
            type="button"
            onClick={loadLedger}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-white border border-[#D4CEBF] text-[#2C2623] text-xs font-semibold hover:bg-[#FAF6EE] cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
        {ledger.loading && !ledger.data ? (
          <div className="p-4">
            <LoadingState label="Reading the artifact ledger..." />
          </div>
        ) : ledger.error ? (
          <div className="p-4">
            <ErrorState title="The artifact ledger could not be loaded" message={ledger.error} onRetry={loadLedger} />
          </div>
        ) : artifacts.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No document has been stored yet" hint="Notices, case diaries and FIR drafts appear here once generated for a case." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#FAF6EE] border-b border-[#E8E2D5] text-[10px] font-bold uppercase tracking-wider text-[#746D65] font-mono">
                  <th className="py-2.5 px-4">Time</th>
                  <th className="py-2.5 px-4">Case</th>
                  <th className="py-2.5 px-4">Document type</th>
                  <th className="py-2.5 px-4">Bank</th>
                  <th className="py-2.5 px-4">Version</th>
                  <th className="py-2.5 px-4">Generator</th>
                  <th className="py-2.5 px-4">SHA-256</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFEAE1] font-mono">
                {artifacts.map((a) => (
                  <tr key={`${a.case_id}-${a.output_id}`} className="hover:bg-[#FAF6EE]">
                    <td className="py-2.5 px-4 whitespace-nowrap">{text(a.created_at)}</td>
                    <td className="py-2.5 px-4">{text(a.case_id)}</td>
                    <td className="py-2.5 px-4 font-bold text-[#2C2623]">{text(a.doc_type)}</td>
                    <td className="py-2.5 px-4">{text(a.bank)}</td>
                    <td className="py-2.5 px-4">{num(a.version)}</td>
                    <td className="py-2.5 px-4">{text(a.generator)}</td>
                    <td className="py-2.5 px-4 break-all">{text(a.sha256)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
        <div className="p-3.5 border-b border-[#E8E2D5] bg-[#FAF6EE]">
          <h3 className="font-bold text-sm text-[#2C2623] font-serif">Loaded transaction file</h3>
        </div>
        <div className="p-4">
          {status.loading && !s ? (
            <LoadingState label="Reading the loaded dataset..." />
          ) : status.error ? (
            <ErrorState title="The dataset status could not be loaded" message={status.error} onRetry={onRetry} />
          ) : !s ? (
            <EmptyState title="No dataset loaded" />
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-[#746D65]">File</dt>
                <dd className="font-mono font-semibold text-[#2C2623] truncate">{text(s.file_name)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#746D65]">Loaded at</dt>
                <dd className="font-mono text-[#2C2623]">{dateTime(s.loaded_at)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#746D65]">Rows loaded</dt>
                <dd className="font-mono text-[#2C2623]">{num(s.records_loaded)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#746D65]">Rows rejected</dt>
                <dd className="font-mono text-[#2C2623]">{num(s.rows_rejected)}</dd>
              </div>
              <div className="sm:col-span-2 flex justify-between gap-3">
                <dt className="text-[#746D65] shrink-0">SHA-256 of the file</dt>
                <dd className="font-mono text-[#2C2623] break-all text-right">{text(s.hash)}</dd>
              </div>
            </dl>
          )}
        </div>
      </div>

      <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
        <div className="p-3.5 border-b border-[#E8E2D5] bg-[#FAF6EE]">
          <h3 className="font-bold text-sm text-[#2C2623] font-serif">Trace fingerprint of the selected victim</h3>
        </div>
        <div className="p-4 text-xs">
          {trace.loading ? (
            <LoadingState label="Tracing..." />
          ) : trace.error ? (
            <ErrorState title="The trace could not be loaded" message={trace.error} />
          ) : !trace.data ? (
            <EmptyState title="No trace to fingerprint" hint="Select a victim account with a money trail." />
          ) : (
            <dl className="grid grid-cols-1 gap-y-2">
              <div className="flex justify-between gap-3">
                <dt className="text-[#746D65]">Victim account</dt>
                <dd className="font-mono font-semibold text-[#2C2623]">{text(trace.victim)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#746D65] shrink-0">SHA-256 of the traced transfers</dt>
                <dd className="font-mono text-[#2C2623] break-all text-right">{text(trace.data.fingerprint)}</dd>
              </div>
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}
