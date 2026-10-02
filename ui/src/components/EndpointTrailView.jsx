import React, { useState, useEffect, useRef } from "react";
import { Search, Zap, Lock, ZoomIn, ZoomOut, Maximize2, Share2, Copy, Check } from "lucide-react";
import { DASH, inr, num, text } from "../format";
import { EmptyState, ErrorState, LoadingState } from "./States";
import {
  DENSE_FROM,
  EvidencePanels,
  LinkCard,
  NodePanel,
  ROLE_KEYS,
  RoleLegend,
  TrimBadge,
  hopsShown,
  riskOf,
  roleKey,
  roleTheme
} from "./TraceEvidence";

const EMPTY_TRACE = { nodes: [], links: [] };
const WIDE_LANE_FROM = 4; // a lane with more accounts than this may use two columns
const DENSE_LANE_ROWS = 24; // accounts per column in a lane of a large trace
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2.0;

export default function EndpointTrailView({
  victimAccount,
  onSearchVictim,
  trace,
  onRetry,
  onNavigateToNotices,
  isActive = true
}) {
  const traceData = trace?.data || null;
  const loading = Boolean(trace?.loading);
  const [inputAcct, setInputAcct] = useState(victimAccount || "");
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredLink, setHoveredLink] = useState(null);
  const [selectedLink, setSelectedLink] = useState(null);
  const [showEdgeAmounts, setShowEdgeAmounts] = useState(true);
  const [copiedId, setCopiedId] = useState(null);
  const [hop2Layout, setHop2Layout] = useState("grid"); // 'grid' (2-cols) or 'stack' (1-col)
  const [lineStyle, setLineStyle] = useState("pipeline"); // 'pipeline' (orthogonal) or 'curved' (bezier)

  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const lanesRef = useRef(null);
  const nodeRefs = useRef({});
  const [renderedLinks, setRenderedLinks] = useState([]);

  useEffect(() => {
    if (victimAccount) {
      setInputAcct(victimAccount);
    }
  }, [victimAccount]);

  // A new trace starts with nothing selected.
  useEffect(() => {
    setSelectedNode(null);
    setSelectedLink(null);
    setHoveredLink(null);
    nodeRefs.current = {};
  }, [traceData]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (inputAcct.trim()) {
      onSearchVictim(inputAcct.trim());
    }
  };

  const handleCopy = (text, e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const hasTrace = Boolean(traceData && Array.isArray(traceData.nodes) && traceData.nodes.length > 0);
  const effectiveTrace = hasTrace ? traceData : EMPTY_TRACE;

  // Lanes: one per hop, left to right. Hop decides position only; colour comes from the role.
  const hopGroups = React.useMemo(() => {
    // One group per hop the trace actually returned: no fixed number of columns.
    const groups = {};
    effectiveTrace.nodes.forEach((n) => {
      const h = n.hop ?? 0;
      if (!groups[h]) groups[h] = [];
      groups[h].push(n);
    });
    return groups;
  }, [effectiveTrace]);

  // Only the transfers the trace returned are drawn.
  const effectiveLinks = effectiveTrace.links || [];
  const hopNumbers = Object.keys(hopGroups).map(Number).filter((h) => hopGroups[h].length > 0).sort((a, b) => a - b);
  const lastHop = hopNumbers.length ? hopNumbers[hopNumbers.length - 1] : 0;
  const fullHops = traceData?.full_hops ?? null;
  const spanSeconds = traceData?.summary?.seconds_first_to_last;
  const dense = effectiveTrace.nodes.length > DENSE_FROM;
  const roleOf = React.useMemo(() => {
    const map = {};
    effectiveTrace.nodes.forEach((n) => {
      map[n.id] = n.role;
    });
    return map;
  }, [effectiveTrace]);

  // Orthogonal Horizontal Pipeline Path with rounded elbow fillets
  const makePipelinePath = (x1, y1, x2, y2) => {
    // If cards are horizontally aligned (like Hop 0 and Hop 1), straight horizontal pipeline!
    if (Math.abs(y1 - y2) < 4) {
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    }

    const midX = x1 + (x2 - x1) * 0.48;
    const radius = Math.min(16, Math.abs(y2 - y1) / 2, Math.abs(x2 - x1) / 4);
    const signY = y2 > y1 ? 1 : -1;

    return `M ${x1} ${y1} L ${midX - radius} ${y1} Q ${midX} ${y1} ${midX} ${y1 + radius * signY} L ${midX} ${y2 - radius * signY} Q ${midX} ${y2} ${midX + radius} ${y2} L ${x2} ${y2}`;
  };

  // Smooth Horizontal Cubic Bézier Path
  const makeBezierPath = (x1, y1, x2, y2) => {
    const dx = Math.abs(x2 - x1) * 0.52;
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  // Compute exact anchor-to-anchor SVG pipeline paths between cards
  const updateConnections = () => {
    if (!canvasRef.current) return;
    const canvasRect = canvasRef.current.getBoundingClientRect();
    if (canvasRect.width === 0 || canvasRect.height === 0) return;

    const computed = [];

    effectiveLinks.forEach((l) => {
      const srcEl = nodeRefs.current[l.source];
      const tgtEl = nodeRefs.current[l.target];

      if (srcEl && tgtEl) {
        const srcRect = srcEl.getBoundingClientRect();
        const tgtRect = tgtEl.getBoundingClientRect();

        // Convert client bounding rects into unscaled canvas-local coordinates
        const x1 = (srcRect.right - canvasRect.left) / zoom;
        const y1 = (srcRect.top + srcRect.height / 2 - canvasRect.top) / zoom;
        const x2 = (tgtRect.left - canvasRect.left) / zoom;
        const y2 = (tgtRect.top + tgtRect.height / 2 - canvasRect.top) / zoom;

        const pathD = lineStyle === "pipeline"
          ? makePipelinePath(x1, y1, x2, y2)
          : makeBezierPath(x1, y1, x2, y2);

        computed.push({
          ...l,
          x1,
          y1,
          x2,
          y2,
          midX: (x1 + x2) / 2,
          midY: (y1 + y2) / 2,
          pathD
        });
      }
    });

    setRenderedLinks((prev) => {
      if (prev.length === computed.length && prev.length > 0) {
        if (prev[0].pathD === computed[0]?.pathD && prev[prev.length - 1].pathD === computed[computed.length - 1]?.pathD) {
          return prev;
        }
      }
      return computed;
    });
  };

  useEffect(() => {
    if (isActive !== false) {
      const timer1 = setTimeout(updateConnections, 50);
      const timer2 = setTimeout(updateConnections, 200);
      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
      };
    }
  }, [traceData, hop2Layout, zoom, lineStyle, effectiveLinks.length, isActive]);

  useEffect(() => {
    window.addEventListener("resize", updateConnections);
    return () => window.removeEventListener("resize", updateConnections);
  }, []);

  // Pan interaction handlers with physical button check (fixes mouse sticking bug)
  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("button") || e.target.closest("input") || e.target.closest(".interactive-node-card") || e.target.closest(".trace-link")) {
      return;
    }
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e) => {
    // If left mouse button is NOT physically held down (e.buttons !== 1), release immediately!
    if (e.buttons !== 1) {
      if (isDragging) setIsDragging(false);
      return;
    }
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  useEffect(() => {
    const handleGlobalMouseUp = () => setIsDragging(false);
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  // Zoom controls
  const handleZoomIn = () => {
    setZoom((z) => Math.min(MAX_ZOOM, Number((z + 0.15).toFixed(2))));
  };

  const handleZoomOut = () => {
    setZoom((z) => Math.max(MIN_ZOOM, Number((z - 0.15).toFixed(2))));
  };

  const handleResetZoom = () => {
    setZoom(0.85);
    setPan({ x: 20, y: 20 });
  };

  const handleFitView = () => {
    if (viewportRef.current && lanesRef.current) {
      const vWidth = viewportRef.current.clientWidth - 40;
      const cWidth = lanesRef.current.offsetWidth + 80; // lanes plus canvas padding, before zoom
      const autoZoom = Math.min(1.0, Math.max(MIN_ZOOM, Number((vWidth / cWidth).toFixed(2))));
      setZoom(autoZoom);
      setPan({ x: 10, y: 15 });
    }
  };

  // A new trace opens fitted to the canvas (once the tab is visible, so the canvas has a size).
  const fittedFor = useRef(null);
  useEffect(() => {
    if (!isActive || !hasTrace || fittedFor.current === traceData) return;
    fittedFor.current = traceData;
    handleFitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, hasTrace, traceData]);

  // Wheel zoom handler
  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.08 : -0.08;
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((z + delta).toFixed(2)))));
  };

  // Highlight: the hovered or pinned transfer, else the transfers of the active account.
  const activeId = hoveredNodeId || selectedNode?.id || null;
  const activeSet = React.useMemo(() => {
    if (!activeId) return null;
    const set = new Set([activeId]);
    effectiveLinks.forEach((l) => {
      if (l.source === activeId) set.add(l.target);
      if (l.target === activeId) set.add(l.source);
    });
    return set;
  }, [activeId, effectiveLinks]);
  const sameLink = (a, b) => Boolean(a && b) && (a.tx_key != null ? a.tx_key === b.tx_key : a === b);
  const shownLink = hoveredLink || selectedLink;
  const touchesActive = (l) => !activeId || l.source === activeId || l.target === activeId;
  const isLinkActive = (l) => (shownLink ? sameLink(l, shownLink) : touchesActive(l));
  const isNodeActive = (nodeId) => !activeSet || activeSet.has(nodeId);

  return (
    <div className="space-y-4 select-none">
      {/* 1. Top Banner / Header & Trace Form */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E8E2D5] pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-2 h-2 rounded-xs bg-[#D96B27]"></span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
              MULTI-HOP MONEY TRAIL
            </span>
            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-xs bg-[#FAF6EE] text-[#D96B27] border border-[#E8E2D5] font-mono">
              {hasTrace ? `${text(fullHops)} HOPS • LAYERED BY HOP • COLOUR BY ROLE` : "NO TRACE"}
            </span>
            {hasTrace && <TrimBadge traceData={traceData} />}
          </div>
          <h2 className="text-xl sm:text-2xl font-serif font-bold text-[#2C2623] mt-0.5 tracking-tight">
            Endpoint Multi-Hop Money Trail &amp; Flow Graph
          </h2>
          <p className="text-xs text-[#746D65] mt-0.5 max-w-3xl font-sans">
            How the selected victim's money moved from account to account. Click an account for its details; hover or click a transfer for its details.
          </p>
        </div>

        {/* Target Search / Input Form */}
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#9E968D] pointer-events-none" />
            <input
              type="text"
              placeholder="Enter victim account number"
              value={inputAcct}
              onChange={(e) => setInputAcct(e.target.value)}
              className="w-64 sm:w-80 bg-white border border-[#D4CEBF] rounded-sm pl-8 pr-3 py-1.5 text-xs font-mono text-[#2C2623] placeholder-[#9E968D] focus:outline-none focus:border-[#D96B27] focus:ring-1 focus:ring-[#D96B27]/30 shadow-2xs transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-3.5 py-1.5 rounded-sm bg-[#D96B27] hover:bg-[#C25B1D] text-white text-xs font-mono font-bold shadow-2xs transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>{loading ? "Tracing..." : "Trace Money Trail"}</span>
          </button>
        </form>
      </div>

      {/* 2. Selected account */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white border border-[#E8E2D5] rounded-sm shadow-2xs font-mono text-[11px] text-[#746D65]">
        <span className={`w-1.5 h-1.5 rounded-full ${hasTrace ? "bg-[#059669]" : "bg-[#9E968D]"}`}></span>
        <span>Selected victim:</span>
        <strong className="text-[#2C2623] font-bold">{victimAccount || "none"}</strong>
      </div>

      {!hasTrace ? (
        loading ? (
          <LoadingState label={`Tracing ${trace?.victim || "victim"}...`} />
        ) : trace?.error ? (
          <ErrorState title="The trace could not be loaded" message={trace.error} onRetry={onRetry} />
        ) : (
          <EmptyState
            title={
              !victimAccount ? "No victim selected" : trace?.notFound ? "No transaction graph found" : `No money trail for ${victimAccount}`
            }
            hint={
              !victimAccount
                ? "Enter a victim account above, or pick one in the header."
                : trace?.notFound
                ? `The engine has no transaction graph for account ${victimAccount}.`
                : "The current display filters leave no accounts of this trace to show."
            }
          />
        )
      ) : (
        <>
      {/* 3. Framed Metric Strip with Sharp Dividers (5-Column Grid) */}
      {traceData && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-[#E8E2D5] bg-white border border-[#E8E2D5] rounded-sm shadow-2xs">
          {/* Metric 1: Trace Latency */}
          <div className="p-3 sm:p-3.5 flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#746D65] font-mono block whitespace-nowrap">
              TRACE TIME (SERVER)
            </span>
            <div className="text-lg sm:text-xl font-bold font-mono text-[#059669] tracking-tight my-0.5 whitespace-nowrap">
              {trace?.serverMs == null ? DASH : `${trace.serverMs} ms`}
            </div>
            <p className="text-[11px] text-[#059669] font-medium whitespace-nowrap font-sans">
              {text(fullHops)} hops{traceData.display_trimmed ? `, ${hopsShown(effectiveTrace.nodes)} shown` : ""} •{" "}
              {spanSeconds == null ? DASH : `${(spanSeconds / 60).toFixed(1)} min`} first to last transfer
            </p>
          </div>

          {/* Metric 2: Total Siphoned */}
          <div className="p-3 sm:p-3.5 flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#DC2626] font-mono block whitespace-nowrap">
              TOTAL SIPHONED
            </span>
            <div className="text-lg sm:text-xl font-bold font-mono text-[#DC2626] tracking-tight my-0.5 whitespace-nowrap">
              {inr(traceData.total_siphoned_inr)}
            </div>
            <p className="text-[11px] text-[#DC2626] font-medium whitespace-nowrap font-sans">
              Victim outbound drain
            </p>
          </div>

          {/* Metric 3: Trapped Recoverable Lien */}
          <div className="p-3 sm:p-3.5 flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#059669] font-mono block whitespace-nowrap">
              TRAPPED LIEN HOLDING
            </span>
            <div className="text-lg sm:text-xl font-bold font-mono text-[#059669] tracking-tight my-0.5 whitespace-nowrap">
              {inr(traceData.recoverable_holding_inr)}
            </div>
            <p className="text-[11px] text-[#059669] font-medium whitespace-nowrap font-sans">
              Actionable for Sec 91 freeze
            </p>
          </div>

          {/* Metric 4: Correlated Network */}
          <div className="p-3 sm:p-3.5 flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#2C2623] font-mono block whitespace-nowrap">
              CORRELATED NETWORK
            </span>
            <div className="text-lg sm:text-xl font-bold font-mono text-[#2C2623] tracking-tight my-0.5 whitespace-nowrap">
              {num(effectiveTrace.nodes.length)} Nodes • {num(effectiveLinks.length)} Links
            </div>
            <p className="text-[11px] text-[#746D65] whitespace-nowrap font-sans">
              Intake to exit endpoints
            </p>
          </div>

          {/* Metric 5: Emergency Action */}
          <div className="p-3 sm:p-3.5 flex flex-col justify-between bg-[#FFFBF8] col-span-2 sm:col-span-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#DC2626] font-mono block whitespace-nowrap">
              STATUTORY REMEDY
            </span>
            <div className="my-0.5">
              <button
                onClick={onNavigateToNotices}
                className="w-full px-3 py-1.5 rounded-sm bg-[#DC2626] hover:bg-[#B91C1C] text-white text-xs font-mono font-bold shadow-2xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{Array.isArray(traceData.freeze_candidates) ? num(traceData.freeze_candidates.length) : DASH} freeze candidates</span>
              </button>
            </div>
            <p className="text-[10px] text-[#9E968D] font-mono whitespace-nowrap">
              Section 91 Cr.P.C. / 94 BNSS
            </p>
          </div>
        </div>
      )}

      {/* 4. Interactive Graph Canvas Toolbar */}
      <div className="bg-[#FAF6EE] border border-[#E8E2D5] rounded-sm px-3.5 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-bold text-[#746D65] flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
            <Share2 className="w-3.5 h-3.5 text-[#D96B27]" />
            Graph Canvas Controls:
          </span>
          <span className="text-[11px] text-[#9E968D] hidden sm:inline font-sans">
            Drag canvas to pan • Scroll or buttons to zoom
          </span>
          <RoleLegend nodes={effectiveTrace.nodes} />
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom Percentage */}
          <div className="px-2.5 py-1 rounded-sm bg-white border border-[#E8E2D5] font-mono text-[11px] font-bold text-[#2C2623] shadow-2xs">
            {Math.round(zoom * 100)}%
          </div>

          {/* Zoom Buttons */}
          <div className="flex items-center bg-white border border-[#E8E2D5] rounded-sm overflow-hidden shadow-2xs">
            <button
              onClick={handleZoomIn}
              title="Zoom In"
              className="p-1.5 hover:bg-[#FAF6EE] text-[#2C2623] border-r border-[#E8E2D5] transition-colors cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleZoomOut}
              title="Zoom Out"
              className="p-1.5 hover:bg-[#FAF6EE] text-[#2C2623] border-r border-[#E8E2D5] transition-colors cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleResetZoom}
              title="Reset 100%"
              className="px-2 py-1 hover:bg-[#FAF6EE] text-[#2C2623] font-mono text-[11px] font-bold border-r border-[#E8E2D5] transition-colors cursor-pointer"
            >
              1:1
            </button>
            <button
              onClick={handleFitView}
              title="Fit to Screen"
              className="p-1.5 hover:bg-[#FAF6EE] text-[#2C2623] transition-colors cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Hop 2 Layout Toggle */}
          <div className="flex items-center bg-white border border-[#E8E2D5] rounded-sm overflow-hidden shadow-2xs text-[11px] font-mono">
            <button
              onClick={() => setHop2Layout("grid")}
              className={`px-2.5 py-1 font-bold transition-colors cursor-pointer ${
                hop2Layout === "grid" ? "bg-[#D96B27] text-white" : "hover:bg-[#FAF6EE] text-[#746D65]"
              }`}
            >
              Grid Lanes
            </button>
            <button
              onClick={() => setHop2Layout("stack")}
              className={`px-2.5 py-1 font-bold transition-colors cursor-pointer ${
                hop2Layout === "stack" ? "bg-[#D96B27] text-white" : "hover:bg-[#FAF6EE] text-[#746D65]"
              }`}
            >
              Cascade
            </button>
          </div>

          {/* Line Style Toggle: Pipeline vs Curved */}
          <button
            onClick={() => setLineStyle(lineStyle === "pipeline" ? "curved" : "pipeline")}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm border text-[11px] font-mono font-bold transition-all shadow-2xs cursor-pointer bg-white border-[#E8E2D5] text-[#2C2623] hover:bg-[#FAF6EE]"
            title="Toggle between Horizontal Pipeline and Curved Bézier Flow"
          >
            <span className={`w-2 h-2 rounded-xs ${lineStyle === "pipeline" ? "bg-[#EA580C]" : "bg-[#7C3AED]"}`} />
            <span>{lineStyle === "pipeline" ? "Pipeline" : "Curved Flow"}</span>
          </button>

          {/* Toggle Amounts on Wires */}
          <button
            onClick={() => setShowEdgeAmounts(!showEdgeAmounts)}
            className={`px-2.5 py-1 rounded-sm border text-[11px] font-mono font-bold transition-colors cursor-pointer ${
              showEdgeAmounts
                ? "bg-[#E6F7F0] border-[#A7F3D0] text-[#059669]"
                : "bg-white border-[#E8E2D5] text-[#746D65] hover:bg-[#FAF6EE]"
            }`}
          >
            {showEdgeAmounts ? "Amounts: On" : "Amounts: Off"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
      <div className="space-y-4 min-w-0">
      {/* MAIN GRAPH CANVAS VIEWPORT */}
      <div
        ref={viewportRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setIsDragging(false)}
        onDragStart={(e) => e.preventDefault()}
        onWheel={handleWheel}
        className={`relative w-full h-[620px] bg-[#FAF7F0] rounded-sm border border-[#E8E2D5] overflow-hidden shadow-inner select-none ${
          isDragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{
          backgroundImage: `
            radial-gradient(circle, #D5CCC0 1.2px, transparent 1.2px),
            linear-gradient(to right, rgba(232, 226, 213, 0.4) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(232, 226, 213, 0.4) 1px, transparent 1px)
          `,
          backgroundSize: "28px 28px, 140px 140px, 140px 140px"
        }}
      >
        {/* TRANSFORMED WORLD CONTAINER */}
        <div
          ref={canvasRef}
          className="absolute origin-top-left transition-transform duration-75 ease-out select-none"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            minWidth: "1600px",
            minHeight: "950px",
            padding: "40px"
          }}
        >
          {/* SVG CONNECTOR LINES LAYER (Behind Nodes) */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ minWidth: "2200px", minHeight: "1200px", overflow: "visible" }}
          >
            <defs>
              {ROLE_KEYS.map((key) => (
                <marker key={key} id={`marker-${key}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={roleTheme(key).color} />
                </marker>
              ))}
            </defs>

            {/* Transfers: coloured by the role of the receiving account */}
            {renderedLinks.map((l, i) => {
              const picked = sameLink(l, shownLink);
              const active = isLinkActive(l);
              const targetRole = roleOf[l.target];
              const strokeColor = roleTheme(targetRole).color;
              const showLabel = showEdgeAmounts && (!dense || picked || (activeId && touchesActive(l)));
              const linkEvents = {
                onMouseEnter: () => setHoveredLink(l),
                onMouseLeave: () => setHoveredLink(null),
                onClick: () => setSelectedLink(l)
              };

              return (
                <g key={l.tx_key ?? i} className="transition-opacity duration-200" opacity={active ? 1.0 : 0.18}>
                  {!dense && (
                    <path
                      d={l.pathD}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={active ? 8 : 5}
                      strokeOpacity={active ? 0.22 : 0.12}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  <path
                    d={l.pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={picked ? 4 : dense ? 1.5 : 2.5}
                    markerEnd={`url(#marker-${roleKey(targetRole)})`}
                    strokeOpacity={dense && !picked ? 0.7 : 1.0}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {!dense && (
                    <path d={l.pathD} fill="none" stroke="#FFFFFF" strokeWidth={2} strokeDasharray="8,14" strokeOpacity={0.9} strokeLinecap="round" strokeLinejoin="round">
                      <animate attributeName="stroke-dashoffset" from="44" to="0" dur="1.2s" repeatCount="indefinite" />
                    </path>
                  )}

                  {/* Wide invisible stroke: hover or click the transfer for its details */}
                  <path
                    d={l.pathD}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    pointerEvents="stroke"
                    className="trace-link cursor-pointer"
                    {...linkEvents}
                  />

                  {showLabel && (
                    <g transform={`translate(${l.midX}, ${l.midY})`} className="trace-link pointer-events-auto cursor-pointer" {...linkEvents}>
                      <rect x="-48" y="-10" width="96" height="20" rx="6" fill="#FFFFFF" stroke={strokeColor} strokeWidth={picked ? "2" : "1.2"} />
                      <text x="0" y="3.5" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#2C2623" fontFamily="monospace">
                        {inr(l.amount)}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>

          {/* HOP LANES: one column per hop found in the trace. Cards are coloured by the engine's role. */}
          <div ref={lanesRef} className="inline-flex items-start gap-20 relative z-10 pointer-events-none">
            {hopNumbers.map((h) => {
              const lane = hopGroups[h] || [];
              const cols =
                hop2Layout !== "grid" ? 1 : dense ? Math.ceil(lane.length / DENSE_LANE_ROWS) : lane.length > WIDE_LANE_FROM ? 2 : 1;
              const laneWidth = dense ? cols * 200 + (cols - 1) * 12 : cols > 1 ? 420 : 320;
              const roles = [...new Set(lane.map((n) => n.role || "no role"))].join(" / ");

              return (
                <div key={h} style={{ width: `${laneWidth}px` }} className="flex-shrink-0 space-y-4 pointer-events-auto">
                  <div className="border border-[#E8E2D5] bg-[#FAF6EE] rounded-xl px-4 py-2 flex items-center justify-between shadow-2xs">
                    <span className="text-xs font-bold uppercase font-mono tracking-wider text-[#746D65] truncate">
                      HOP {h} • {roles}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-white font-bold border border-[#E8E2D5] font-mono text-[#746D65]">
                      {lane.length}
                    </span>
                  </div>

                  <div
                    style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                    className={`grid ${dense ? "gap-x-3 gap-y-2" : "gap-3"}`}
                  >
                    {lane.map((node) => {
                      const active = isNodeActive(node.id);
                      const isSelected = selectedNode?.id === node.id;
                      const isVictim = node.role === "VICTIM";
                      const theme = roleTheme(node.role);
                      const risk = riskOf(node).value;
                      const badge = `${node.role || DASH} • ${risk == null ? DASH : Math.round(risk)}`;
                      const cardEvents = {
                        ref: (el) => {
                          if (el) nodeRefs.current[node.id] = el;
                        },
                        onMouseEnter: () => setHoveredNodeId(node.id),
                        onMouseLeave: () => setHoveredNodeId(null),
                        onClick: () => setSelectedNode(node)
                      };

                      if (dense) {
                        return (
                          <div
                            key={node.id}
                            {...cardEvents}
                            title={`${node.id} • ${badge}`}
                            style={{ borderColor: theme.color }}
                            className={`interactive-node-card bg-white border-2 rounded-lg px-2 py-1 shadow-sm cursor-pointer ${
                              isSelected ? "ring-3 ring-[#D96B27]/40" : active ? "" : "opacity-40 hover:opacity-100"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="font-mono text-[10px] font-bold text-[#2C2623] truncate">{node.id}</span>
                              <span style={{ backgroundColor: theme.soft, color: theme.text }} className="text-[9px] px-1.5 rounded font-bold font-mono whitespace-nowrap">
                                {badge}
                              </span>
                            </div>
                            <div className="text-[9px] font-mono font-bold text-[#059669] truncate">
                              {isVictim ? `Paid: ${inr(traceData?.total_siphoned_inr, 0)}` : `Holding: ${inr(node.holding_amount, 0)}`}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={node.id}
                          {...cardEvents}
                          style={{ borderColor: theme.color }}
                          className={`interactive-node-card relative bg-white border-2 rounded-2xl p-3.5 shadow-sm transition-all duration-150 cursor-pointer ${
                            isSelected ? "ring-3 ring-[#D96B27]/40 shadow-md" : active ? "hover:shadow-md" : "opacity-40 hover:opacity-100"
                          }`}
                        >
                          {h !== hopNumbers[0] && (
                            <div
                              style={{ backgroundColor: theme.color }}
                              className="absolute left-[-7px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-white shadow-xs"
                            />
                          )}
                          {h !== lastHop && (
                            <div
                              style={{ backgroundColor: theme.color }}
                              className="absolute right-[-7px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-white shadow-xs"
                            />
                          )}

                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-mono text-xs font-bold text-[#2C2623] truncate">{node.id}</span>
                              <button
                                onClick={(e) => handleCopy(node.id, e)}
                                title="Copy Account ID"
                                className="text-[#9E968D] hover:text-[#2C2623] p-0.5"
                              >
                                {copiedId === node.id ? <Check className="w-3 h-3 text-[#10B981]" /> : <Copy className="w-3 h-3" />}
                              </button>
                            </div>
                            <span
                              style={{ backgroundColor: theme.soft, color: theme.text }}
                              className="text-[10px] px-2 py-0.5 rounded font-bold font-mono whitespace-nowrap"
                              title="Role and risk from the engine"
                            >
                              {badge}
                            </span>
                          </div>

                          <div className="text-[11px] text-[#746D65] mt-1 font-medium truncate">
                            {node.bank || DASH} ({node.ifsc || DASH})
                          </div>

                          {isVictim ? (
                            <div className="mt-2.5 p-2 rounded-xl bg-[#FEF2F2] border border-[#FEE2E2]">
                              <span className="text-[10px] uppercase font-bold text-[#DC2626]">Paid by the victim</span>
                              <div className="text-sm font-mono font-bold text-[#DC2626]">{inr(traceData?.total_siphoned_inr)}</div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-2 mt-2.5">
                              <div className="p-2 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5]">
                                <span className="text-[9px] uppercase font-bold text-[#746D65]">Received</span>
                                <div className="text-xs font-mono font-bold text-[#2C2623]">{inr(node.tainted_received)}</div>
                              </div>
                              <div className="p-2 rounded-xl bg-[#E6F7F0] border border-[#A7F3D0]">
                                <span className="text-[9px] uppercase font-bold text-[#047857]">Holding</span>
                                <div className="text-xs font-mono font-bold text-[#059669]">{inr(node.holding_amount)}</div>
                              </div>
                            </div>
                          )}

                          <div className="mt-2 text-[10px] text-[#9E968D] font-mono flex items-center justify-between gap-2">
                            <span>{node.device_type || DASH}</span>
                            <span>{node.ip_address || DASH}</span>
                          </div>
                          {node.freeze_recommended && (
                            <div className="mt-2 text-[10px] font-bold text-[#B45309] font-mono">freeze recommended</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {shownLink && <LinkCard link={shownLink} pinned={!hoveredLink} onClose={() => setSelectedLink(null)} />}
      </div>

      {selectedNode && (
        <NodePanel node={selectedNode} onClose={() => setSelectedNode(null)}>
          <button
            onClick={onNavigateToNotices}
            className="px-4 py-2 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] text-white text-xs font-bold shadow-sm flex items-center gap-2 cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Open Section 91 notices</span>
          </button>
        </NodePanel>
      )}
      </div>

      <EvidencePanels traceData={traceData} />
      </div>
        </>
      )}
    </div>
  );
}
