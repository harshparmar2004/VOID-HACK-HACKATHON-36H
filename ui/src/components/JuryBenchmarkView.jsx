import React, { useState } from "react";
import { Award, CheckCircle2, Play, XCircle } from "lucide-react";
import { runJuryBenchmark } from "../api";
import { inr, num, text } from "../format";
import { EmptyState, ErrorState, LoadingState, PageHeader, Stat } from "./States";

const ms = (value) => (value == null ? text(null) : `${num(value, 2)} ms`);

// Our role names, in display order; any other role the engine returns is listed after them.
const ROLE_ORDER = ["VICTIM", "L1", "L2", "L3"];
const rolesText = (breakdown) => {
  const entries = Object.entries(breakdown || {});
  const rank = (role) => (ROLE_ORDER.includes(role) ? ROLE_ORDER.indexOf(role) : ROLE_ORDER.length);
  return entries
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([role, count]) => `${role}: ${count}`)
    .join(" • ");
};

// Every figure on this page is measured by POST /jury/blind-test when the test is run.
export default function JuryBenchmarkView() {
  const [victimCount, setVictimCount] = useState("");
  const [state, setState] = useState({ data: null, loading: false, error: null });

  const handleRun = async () => {
    setState({ data: null, loading: true, error: null });
    try {
      const n = Number(victimCount);
      setState({ data: await runJuryBenchmark(Number.isInteger(n) && n > 0 ? n : null), loading: false, error: null });
    } catch (err) {
      setState({ data: null, loading: false, error: err.message });
    }
  };

  const results = state.data;
  const summary = results?.jury_criteria_summary;
  const rows = results?.query_results || [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Audit & evaluation"
        title="Blind Victim Trace Test"
        subtitle="Traces randomly chosen victim accounts and checks each trace against a chain built from the transactions alone. No ground-truth file is used."
      >
        <input
          type="number"
          min="1"
          placeholder="Victims (API default)"
          value={victimCount}
          onChange={(e) => setVictimCount(e.target.value)}
          className="w-44 bg-white border border-[#D4CEBF] rounded-sm px-2.5 py-2 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
        />
        <button
          onClick={handleRun}
          disabled={state.loading}
          className="flex items-center gap-2 px-5 py-2 rounded-sm bg-[#D96B27] hover:bg-[#C25B1C] text-white font-bold text-xs shadow-2xs cursor-pointer disabled:opacity-60"
        >
          <Play className="w-3.5 h-3.5 fill-white" />
          <span>{state.loading ? "Running..." : "Run blind test"}</span>
        </button>
      </PageHeader>

      {state.loading ? (
        <LoadingState label="Tracing random victims and checking each trace..." />
      ) : state.error ? (
        <ErrorState title="The blind test could not be run" message={state.error} onRetry={handleRun} />
      ) : !results ? (
        <EmptyState title="The test has not been run" hint="Run the blind test to measure correctness and trace time on this machine." />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Victims traced" value={num(summary?.victims_traced)} hint={`${num(results.n_requested)} requested`} />
            <Stat label="Correct" value={num(summary?.correct)} hint={`${num(summary?.incorrect)} incorrect`} tone={summary?.incorrect ? "red" : "green"} />
            <Stat label="Average trace time" value={ms(summary?.avg_blind_query_latency_ms)} hint={`median ${ms(summary?.median_latency_ms)}`} />
            <Stat label="Slowest trace" value={ms(summary?.max_latency_ms)} />
            <Stat label="Check chain built in" value={ms(summary?.chain_build_ms)} />
          </div>

          <div className="bg-white border border-[#E8E2D5] rounded-md p-4 shadow-2xs text-xs text-[#5C554E] space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-[#2C2623]">
              <Award className="w-4 h-4 text-[#D96B27]" />
              <span>How a trace is judged</span>
            </div>
            <p>{text(results.method)}</p>
            <p className="text-[#746D65]">
              Detection precision, recall and F1 are not reported: they need ground truth, which this system does not use.
              Scoring profile: <span className="font-mono">{text(results.profile_id)}</span>.
            </p>
          </div>

          <div className="bg-white border border-[#E8E2D5] rounded-md overflow-hidden shadow-2xs">
            <div className="p-3.5 border-b border-[#E8E2D5] bg-[#FAF6EE] flex items-center justify-between">
              <h3 className="font-bold text-sm text-[#2C2623] font-serif">Results per victim ({num(rows.length)})</h3>
              <span className="text-[11px] font-mono font-semibold text-[#746D65]">
                {num(summary?.correct)} of {num(summary?.victims_traced)} correct
              </span>
            </div>
            <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-[#FAF6EE]">
                  <tr className="border-b border-[#E8E2D5] text-[10px] font-bold uppercase tracking-wider text-[#746D65] font-mono">
                    <th className="py-2.5 px-4">Victim account</th>
                    <th className="py-2.5 px-4">Correct</th>
                    <th className="py-2.5 px-4">Trace time</th>
                    <th className="py-2.5 px-4">Accounts found / expected</th>
                    <th className="py-2.5 px-4">Transfers found / expected</th>
                    <th className="py-2.5 px-4">Amount paid</th>
                    <th className="py-2.5 px-4">Roles</th>
                    <th className="py-2.5 px-4 text-right">Freeze targets</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFEAE1] font-mono">
                  {rows.map((q) => (
                    <tr key={q.victim_account} className="hover:bg-[#FAF6EE]">
                      <td className="py-2.5 px-4 font-bold text-[#2C2623]">{q.victim_account}</td>
                      <td className="py-2.5 px-4">
                        {q.correct ? (
                          <span className="inline-flex items-center gap-1 text-[#059669] font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5" /> yes
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[#DC2626] font-bold">
                            <XCircle className="w-3.5 h-3.5" /> no
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4">{ms(q.latency_ms)}</td>
                      <td className="py-2.5 px-4">
                        {num(q.nodes_identified)} / {num(q.accounts_expected)}
                      </td>
                      <td className="py-2.5 px-4">
                        {num(q.transfers_found)} / {num(q.transfers_expected)}
                      </td>
                      <td className="py-2.5 px-4 text-[#DC2626]">{inr(q.siphoned_amount)}</td>
                      <td className="py-2.5 px-4 font-sans text-[11px]">
                        {rolesText(q.roles_breakdown) || text(null)}
                      </td>
                      <td className="py-2.5 px-4 text-right">{num(q.freeze_targets)}</td>
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
