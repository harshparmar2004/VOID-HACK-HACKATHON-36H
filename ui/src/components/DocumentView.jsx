import React, { useCallback, useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { fetchStoredPage } from "../api";
import { text } from "../format";
import { ErrorState, LoadingState } from "./States";

// One stored page of a case, read back from the case store and shown as it is.
// `doc` is the document's row: { case_id, output_id, generator, sha256, file_name, version }.
// Printing uses the page's own window, so only the document is printed.
export default function DocumentView({ doc }) {
  const [page, setPage] = useState({ html: null, sha256: null, computed: null, loading: true, error: null });
  const frame = useRef(null);
  const caseId = doc?.case_id;
  const outputId = doc?.output_id;

  const load = useCallback(async () => {
    setPage({ html: null, sha256: null, computed: null, loading: true, error: null });
    try {
      setPage({ ...(await fetchStoredPage(caseId, outputId)), loading: false, error: null });
    } catch (err) {
      setPage({ html: null, sha256: null, computed: null, loading: false, error: err.message });
    }
  }, [caseId, outputId]);

  useEffect(() => {
    load();
  }, [load]);

  // The API's header when the browser may read it, else the hash of the bytes received.
  const sha = page.sha256 || page.computed;
  const mismatch = Boolean(sha && doc?.sha256 && sha !== doc.sha256);

  return (
    <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
      <div className="p-3.5 border-b border-[#E8E2D5] bg-[#FAF6EE] flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-mono flex flex-wrap gap-x-6 gap-y-1 min-w-0">
          <span>
            <span className="text-[#746D65]">Case: </span>
            <b className="text-[#2C2623]">{text(caseId)}</b>
          </span>
          <span>
            <span className="text-[#746D65]">Generator: </span>
            <b className="text-[#2C2623]">{text(doc?.generator)}</b>
          </span>
          {doc?.version != null && (
            <span>
              <span className="text-[#746D65]">Version: </span>
              <b className="text-[#2C2623]">{doc.version}</b>
            </span>
          )}
          <span className="break-all">
            <span className="text-[#746D65]">SHA-256: </span>
            <b className={mismatch ? "text-[#DC2626]" : "text-[#2C2623]"}>{text(sha)}</b>
          </span>
        </div>
        <button
          type="button"
          onClick={() => frame.current?.contentWindow?.print()}
          disabled={!page.html}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#D96B27] text-white text-xs font-semibold hover:bg-[#C25A1C] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Printer className="w-3.5 h-3.5" />
          <span>Print / Save as PDF</span>
        </button>
      </div>
      {mismatch && (
        <p className="px-3.5 py-2 text-xs font-mono text-[#B91C1C] bg-[#FEF2F2] border-b border-[#FECACA]">
          The page read back does not match the SHA-256 recorded for this document ({doc.sha256}).
        </p>
      )}
      {page.loading ? (
        <div className="p-4">
          <LoadingState label="Loading the stored page..." />
        </div>
      ) : page.error ? (
        <div className="p-4">
          <ErrorState title="The stored page could not be loaded" message={page.error} onRetry={load} />
        </div>
      ) : (
        <iframe
          ref={frame}
          title={doc?.file_name || "Stored document"}
          srcDoc={page.html}
          sandbox="allow-same-origin allow-modals"
          className="w-full h-[75vh] bg-white"
        />
      )}
    </div>
  );
}
