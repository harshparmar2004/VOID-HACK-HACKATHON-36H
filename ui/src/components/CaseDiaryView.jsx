import React from "react";
import { Copy, Download, FileText } from "lucide-react";
import { text } from "../format";
import { EmptyState, ErrorState, LaterButton, LaterStep, LoadingState, PageHeader } from "./States";

const SUMMARY_PARTS = [
  ["who", "Who"],
  ["how", "How"],
  ["why", "Why"],
  ["when", "When"]
];

// The drafted case diary is not built yet. The engine's own trace summary and
// findings are shown as they are returned, without any generated text.
export default function CaseDiaryView({ trace, caseInfo, onRetry }) {
  const summary = trace.data?.summary;
  const findings = trace.data?.findings || [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Legal"
        title="Investigative Brief"
        subtitle="Case diary for the selected victim."
      >
        <LaterButton icon={FileText}>Generate case diary</LaterButton>
        <LaterButton icon={Copy}>Copy</LaterButton>
        <LaterButton icon={Download}>Download</LaterButton>
      </PageHeader>

      <LaterStep title="Drafting the case diary">
        Until then, this page shows the trace summary and findings exactly as the engine returns them.
      </LaterStep>

      <div className="bg-white border border-[#E8E2D5] rounded-md p-4 shadow-2xs text-xs flex flex-wrap gap-x-8 gap-y-1 font-mono">
        <span>
          <span className="text-[#746D65]">Victim account: </span>
          <b className="text-[#2C2623]">{text(trace.victim)}</b>
        </span>
        <span>
          <span className="text-[#746D65]">FIR number: </span>
          <b className="text-[#2C2623]">{text(caseInfo?.firNumber)}</b>
        </span>
        <span>
          <span className="text-[#746D65]">Complainant: </span>
          <b className="text-[#2C2623]">{text(caseInfo?.complainant)}</b>
        </span>
      </div>

      {trace.loading ? (
        <LoadingState label="Tracing..." />
      ) : trace.error ? (
        <ErrorState title="The trace could not be loaded" message={trace.error} onRetry={onRetry} />
      ) : !summary ? (
        <EmptyState title="No trace summary" hint="Select a victim account with a money trail." />
      ) : (
        <>
          <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
            <div className="p-3.5 border-b border-[#E8E2D5] bg-[#FAF6EE]">
              <h3 className="font-bold text-sm text-[#2C2623] font-serif">Trace summary (from the engine)</h3>
            </div>
            <dl className="divide-y divide-[#EFEAE1] text-xs">
              {SUMMARY_PARTS.map(([key, label]) => (
                <div key={key} className="p-3.5 grid grid-cols-[4rem_1fr] gap-3">
                  <dt className="font-bold uppercase text-[10px] tracking-wider text-[#9E968D] font-mono pt-0.5">{label}</dt>
                  <dd className="text-[#2C2623] leading-relaxed">{text(summary[key])}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
            <div className="p-3.5 border-b border-[#E8E2D5] bg-[#FAF6EE]">
              <h3 className="font-bold text-sm text-[#2C2623] font-serif">Findings ({findings.length})</h3>
            </div>
            {findings.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No findings for this trace" />
              </div>
            ) : (
              <ul className="divide-y divide-[#EFEAE1] text-xs">
                {findings.map((f, i) => (
                  <li key={`${f.pattern}-${i}`} className="p-3.5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[#2C2623]">{text(f.pattern)}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-xs bg-[#FAF6EE] border border-[#E8E2D5] text-[#746D65]">
                        confidence: {text(f.confidence)}
                      </span>
                    </div>
                    <ul className="list-disc pl-5 space-y-0.5 text-[#5C554E]">
                      {(f.evidence || []).map((line, j) => (
                        <li key={j}>{line}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
