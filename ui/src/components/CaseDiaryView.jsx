import React, { useEffect, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { fetchDiarySummary, generateDiary } from "../api";
import { text } from "../format";
import { canWrite, isClosed } from "./CaseBar";
import DocumentView from "./DocumentView";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "./States";

const NO_DIARY = { doc: null, busy: false, error: null };
const NO_SUMMARY = { data: null, busy: false, error: null };

const SUMMARY_PARTS = [
  ["who", "Who"],
  ["how", "How"],
  ["why", "Why"],
  ["when", "When"]
];

// The case diary of the open case: the template page at once, then the local
// model's summary, fetched separately and used only if it passed validation.
// Below it, the engine's own trace summary and findings, as they are returned.
export default function CaseDiaryView({ trace, onRetry, caseRec, caseBar, onCaseChanged, firDoc }) {
  const summary = trace.data?.summary;
  const findings = trace.data?.findings || [];
  const caseId = caseRec?.data?.case_id;
  const [diary, setDiary] = useState(NO_DIARY);
  const [ai, setAi] = useState(NO_SUMMARY);
  const requestNo = useRef(0);

  useEffect(() => {
    requestNo.current += 1;
    setDiary(NO_DIARY);
    setAi(NO_SUMMARY);
  }, [trace.victim, caseId]);

  const generate = async () => {
    const mine = ++requestNo.current;
    const victim = trace.victim;
    setDiary({ ...NO_DIARY, busy: true });
    setAi(NO_SUMMARY);
    try {
      const doc = await generateDiary(victim, caseId);
      if (mine !== requestNo.current) return;
      setDiary({ ...NO_DIARY, doc });
    } catch (err) {
      if (mine === requestNo.current) setDiary({ ...NO_DIARY, error: err.message });
      return;
    }
    // The summary is a second, slower call; the template page is already on screen.
    setAi({ ...NO_SUMMARY, busy: true });
    try {
      const data = await fetchDiarySummary(victim, caseId);
      if (mine !== requestNo.current) return;
      setAi({ ...NO_SUMMARY, data });
      if (data.document) setDiary({ ...NO_DIARY, doc: data.document });
    } catch (err) {
      if (mine === requestNo.current) setAi({ ...NO_SUMMARY, error: err.message });
    }
    onCaseChanged(caseId);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Legal"
        title="Investigative Brief"
        subtitle="Case diary for the selected victim."
      >
        <button
          type="button"
          onClick={generate}
          disabled={!canWrite(caseRec) || !trace.victim || diary.busy || ai.busy}
          title={isClosed(caseRec) ? "This case is closed" : !caseId ? "Open a case first" : undefined}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#D96B27] text-white text-xs font-semibold hover:bg-[#C25A1C] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {diary.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          <span>Generate case diary</span>
        </button>
      </PageHeader>

      {caseBar}

      {diary.error && <ErrorState title="The case diary could not be generated" message={diary.error} onRetry={generate} />}
      {diary.busy && <LoadingState label="Writing the case diary..." />}

      {diary.doc && (
        <div className="bg-white border border-[#E8E2D5] rounded-md p-3.5 shadow-2xs text-xs">
          {ai.busy ? (
            <p className="flex items-center gap-2 text-[#746D65]">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D96B27]" />
              <span>Generating summary...</span>
            </p>
          ) : ai.error ? (
            <p className="font-mono text-[#B91C1C] break-words">Summary not available: {ai.error}</p>
          ) : ai.data?.summary ? (
            <>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
                Summary ({ai.data.generator}, {ai.data.llm.seconds} s)
              </p>
              <p className="text-[#2C2623] leading-relaxed mt-1">{ai.data.summary}</p>
            </>
          ) : ai.data ? (
            <p className="text-[#746D65]">
              No AI summary was used ({ai.data.generator}: {ai.data.llm.status}). The template diary below stands.
            </p>
          ) : null}
        </div>
      )}

      {diary.doc && <DocumentView key={diary.doc.output_id} doc={diary.doc} />}

      {firDoc && (
        <>
          <h3 className="font-bold text-sm text-[#2C2623] font-serif">FIR draft</h3>
          <DocumentView key={firDoc.output_id} doc={firDoc} />
        </>
      )}

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
