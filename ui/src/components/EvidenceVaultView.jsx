import React from "react";
import { FileCheck, ShieldCheck } from "lucide-react";
import { dateTime, num, text } from "../format";
import { EmptyState, ErrorState, LaterButton, LaterStep, LoadingState, PageHeader } from "./States";

// The vault (artifact ledger, chain verification, certificates) is not built yet.
// What is shown here are the two fingerprints the engine already produces.
export default function EvidenceVaultView({ status, trace, onRetry }) {
  const s = status.data;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Case operations"
        title="Evidence Vault"
        subtitle="Chain-of-custody ledger for the case evidence."
      >
        <LaterButton icon={ShieldCheck}>Verify chain</LaterButton>
        <LaterButton icon={FileCheck}>Section 63 BSA certificate</LaterButton>
      </PageHeader>

      <LaterStep title="Artifact ledger, chain verification and certificates">
        No artifacts are listed until the vault is built. The fingerprints below are computed by the engine today.
      </LaterStep>

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
