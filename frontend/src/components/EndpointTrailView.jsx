import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import {
  Search,
  ArrowRight,
  ShieldAlert,
  CheckCircle,
  ExternalLink,
  Zap,
  Lock,
  DollarSign,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Move,
  Layers,
  Eye,
  Sliders,
  Share2,
  AlertTriangle,
  Info,
  X,
  Copy,
  Check
} from "lucide-react";

export default function EndpointTrailView({
  victimAccount,
  onSearchVictim,
  traceData,
  loading,
  onNavigateToNotices
}) {
  const [inputAcct, setInputAcct] = useState(victimAccount || "");
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [showEdgeAmounts, setShowEdgeAmounts] = useState(true);
  const [copiedId, setCopiedId] = useState(null);
  const [hop2Layout, setHop2Layout] = useState("grid"); // 'grid' (2-cols) or 'stack' (1-col)
  const [lineStyle, setLineStyle] = useState("pipeline"); // 'pipeline' (orthogonal) or 'curved' (bezier)

  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const nodeRefs = useRef({});
  const [renderedLinks, setRenderedLinks] = useState([]);

  useEffect(() => {
    if (victimAccount) {
      setInputAcct(victimAccount);
    }
  }, [victimAccount]);

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

  // Group nodes by hop level (0: Victim, 1: L1 Collector, 2: L2 Distributors, 3: L3 Cashout)
  const hopGroups = { 0: [], 1: [], 2: [], 3: [] };
  if (traceData && traceData.nodes) {
    traceData.nodes.forEach((n) => {
      const h = Math.min(n.hop, 3);
      if (hopGroups[h]) hopGroups[h].push(n);
    });
  }

  // Synthesize or extract multi-hop links to guarantee 100% graph connectivity
  const effectiveLinks = React.useMemo(() => {
    if (traceData && traceData.links && traceData.links.length > 0) {
      return traceData.links;
    }
    const generated = [];
    const h0 = hopGroups[0] || [];
    const h1 = hopGroups[1] || [];
    const h2 = hopGroups[2] || [];
    const h3 = hopGroups[3] || [];

    if (h0[0] && h1[0]) {
      generated.push({
        txn_id: "TXN-HOP1-01",
        source: h0[0].id,
        target: h1[0].id,
        amount: h1[0].tainted_received || traceData?.total_siphoned_inr || 1478894.0,
        payment_mode: "RTGS",
        narration: "DIGITAL-ARREST-TRANSFER",
        hop: 1
      });
    }

    if (h1[0]) {
      h2.forEach((n2, idx) => {
        generated.push({
          txn_id: `TXN-HOP2-${idx + 1}`,
          source: h1[0].id,
          target: n2.id,
          amount: n2.tainted_received || 99642.85,
          payment_mode: "IMPS",
          narration: "Bunny-Hop Smurfing",
          hop: 2
        });
      });
    }

    if (h3.length > 0 && h2.length > 0) {
      h3.forEach((n3, idx) => {
        const srcNode = h2[idx % h2.length];
        generated.push({
          txn_id: `TXN-HOP3-${idx + 1}`,
          source: srcNode.id,
          target: n3.id,
          amount: n3.tainted_received || 70000.0,
          payment_mode: "UPI/P2P",
          narration: "Crypto USDT Exit",
          hop: 3
        });
      });
    }

    return generated;
  }, [traceData, hopGroups]);

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

    setRenderedLinks(computed);
  };

  useLayoutEffect(() => {
    updateConnections();
    const t1 = setTimeout(updateConnections, 50);
    const t2 = setTimeout(updateConnections, 150);
    const t3 = setTimeout(updateConnections, 400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [traceData, hop2Layout, zoom, lineStyle, effectiveLinks]);

  useEffect(() => {
    window.addEventListener("resize", updateConnections);
    let ro = null;
    if (canvasRef.current && window.ResizeObserver) {
      ro = new ResizeObserver(() => updateConnections());
      ro.observe(canvasRef.current);
    }
    return () => {
      window.removeEventListener("resize", updateConnections);
      if (ro) ro.disconnect();
    };
  }, [lineStyle]);

  // Pan interaction handlers
  const handleMouseDown = (e) => {
    // Only drag when clicking canvas background or non-interactive container
    if (e.target.closest("button") || e.target.closest("input") || e.target.closest(".interactive-node-card")) {
      return;
    }
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Zoom controls
  const handleZoomIn = () => {
    setZoom((z) => Math.min(2.0, Number((z + 0.15).toFixed(2))));
  };

  const handleZoomOut = () => {
    setZoom((z) => Math.max(0.4, Number((z - 0.15).toFixed(2))));
  };

  const handleResetZoom = () => {
    setZoom(0.85);
    setPan({ x: 20, y: 20 });
  };

  const handleFitView = () => {
    if (viewportRef.current && canvasRef.current) {
      const vWidth = viewportRef.current.clientWidth - 40;
      const cWidth = 1450; // estimated layout total width
      const autoZoom = Math.min(1.0, Math.max(0.45, Number((vWidth / cWidth).toFixed(2))));
      setZoom(autoZoom);
      setPan({ x: 10, y: 15 });
    }
  };

  // Wheel zoom handler
  const handleWheel = (e) => {
    if (e.ctrlKey || e.metaKey || true) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.08 : -0.08;
      setZoom((z) => Math.min(2.0, Math.max(0.4, Number((z + delta).toFixed(2)))));
    }
  };

  // Path highlight determination
  const isLinkActive = (l) => {
    if (!hoveredNodeId && !selectedNode) return true;
    const activeId = hoveredNodeId || selectedNode?.id;
    return l.source === activeId || l.target === activeId;
  };

  const isNodeActive = (nodeId) => {
    if (!hoveredNodeId && !selectedNode) return true;
    const activeId = hoveredNodeId || selectedNode?.id;
    if (nodeId === activeId) return true;
    // Check if directly connected
    return effectiveLinks.some(
      (l) => (l.source === activeId && l.target === nodeId) || (l.target === activeId && l.source === nodeId)
    );
  };

  return (
    <div className="space-y-4 select-none">
      {/* Search & Top Action Bar */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-serif font-bold text-[#2C2623]">
                Endpoint Multi-Hop Money Trail & Flow Graph
              </h2>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#FAF6EE] text-[#D96B27] border border-[#E8E2D5] font-mono">
                HOP 0 → HOP 3
              </span>
            </div>
            <p className="text-xs text-[#746D65] mt-1">
              Interactive zoomable forensic canvas showing end-to-end multi-tier fund dispersion across 2,000,000 transactions.
            </p>
          </div>

          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <div className="relative">
              <input
                type="text"
                placeholder="Enter 12-digit Victim Account ID..."
                value={inputAcct}
                onChange={(e) => setInputAcct(e.target.value)}
                className="w-72 bg-[#FBF7EE] border border-[#E8E2D5] rounded-xl px-4 py-2 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
              />
              <Search className="w-3.5 h-3.5 absolute right-3 top-2.5 text-[#9E968D]" />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-semibold shadow-2xs transition-all cursor-pointer"
            >
              {loading ? "Tracing..." : "Trace Money Trail"}
            </button>
          </form>
        </div>

        {/* Quick Demo Victims */}
        <div className="flex items-center gap-2 mt-3 pt-2 text-xs flex-wrap">
          <span className="text-[#9E968D] font-mono text-[11px]">Demo Inquiry Targets:</span>
          {[
            { id: "100000000001", label: "Sunil Kumar (₹14.7L)" },
            { id: "100000000002", label: "Priya Sharma (₹8.9L)" },
            { id: "100000000003", label: "Ramesh Patel (₹11.2L)" }
          ].map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => {
                setInputAcct(d.id);
                onSearchVictim(d.id);
              }}
              className="px-2.5 py-1 rounded-lg bg-[#FAF6EE] hover:bg-[#F3EDE2] text-[#D96B27] border border-[#E8E2D5] font-semibold text-[11px] transition-colors cursor-pointer"
            >
              {d.label}
            </button>
          ))}
        </div>

        {/* Trail Metrics Summary Bar */}
        {traceData && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 pt-3 border-t border-[#F0EAE1]">
            <div>
              <span className="text-[10px] uppercase font-bold text-[#9E968D]">Trace Latency</span>
              <div className="text-base font-mono font-bold text-[#059669]">{traceData.latency_ms} ms</div>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-[#9E968D]">Total Siphoned</span>
              <div className="text-base font-mono font-bold text-[#DC2626]">
                ₹{traceData.total_siphoned_inr ? traceData.total_siphoned_inr.toLocaleString("en-IN") : "0"}
              </div>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-[#9E968D]">Trapped Recoverable Lien</span>
              <div className="text-base font-mono font-bold text-[#059669]">
                ₹{traceData.recoverable_holding_inr ? traceData.recoverable_holding_inr.toLocaleString("en-IN") : "0"}
              </div>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-[#9E968D]">Correlated Accounts</span>
              <div className="text-base font-mono font-bold text-[#2C2623]">{traceData.nodes_count} Nodes</div>
            </div>
            <div className="flex items-center justify-end">
              <button
                onClick={onNavigateToNotices}
                className="px-3.5 py-1.5 rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Freeze {traceData.freeze_candidates?.length || 0} Accounts</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Interactive Graph Canvas Toolbar */}
      <div className="bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[#746D65] flex items-center gap-1.5">
            <Share2 className="w-3.5 h-3.5 text-[#D96B27]" />
            Graph Canvas Controls:
          </span>
          <span className="text-[11px] text-[#9E968D] hidden sm:inline">
            Drag to pan • Scroll or buttons to zoom in/out
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom Percentage */}
          <div className="px-2.5 py-1 rounded-lg bg-white border border-[#E8E2D5] font-mono text-[11px] font-bold text-[#2C2623] shadow-2xs">
            {Math.round(zoom * 100)}%
          </div>

          {/* Zoom Buttons */}
          <div className="flex items-center bg-white border border-[#E8E2D5] rounded-lg overflow-hidden shadow-2xs">
            <button
              onClick={handleZoomIn}
              title="Zoom In"
              className="p-1.5 hover:bg-[#F3EDE2] text-[#2C2623] border-r border-[#E8E2D5] transition-colors cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleZoomOut}
              title="Zoom Out"
              className="p-1.5 hover:bg-[#F3EDE2] text-[#2C2623] border-r border-[#E8E2D5] transition-colors cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleResetZoom}
              title="Reset 100%"
              className="px-2 py-1 hover:bg-[#F3EDE2] text-[#2C2623] font-mono text-[11px] font-bold border-r border-[#E8E2D5] transition-colors cursor-pointer"
            >
              1:1
            </button>
            <button
              onClick={handleFitView}
              title="Fit to Screen"
              className="p-1.5 hover:bg-[#F3EDE2] text-[#2C2623] transition-colors cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Hop 2 Layout Toggle */}
          <div className="flex items-center bg-white border border-[#E8E2D5] rounded-lg overflow-hidden shadow-2xs text-[11px]">
            <button
              onClick={() => setHop2Layout("grid")}
              className={`px-2.5 py-1 font-semibold transition-colors cursor-pointer ${
                hop2Layout === "grid" ? "bg-[#D96B27] text-white" : "hover:bg-[#F3EDE2] text-[#746D65]"
              }`}
            >
              Grid Lanes
            </button>
            <button
              onClick={() => setHop2Layout("stack")}
              className={`px-2.5 py-1 font-semibold transition-colors cursor-pointer ${
                hop2Layout === "stack" ? "bg-[#D96B27] text-white" : "hover:bg-[#F3EDE2] text-[#746D65]"
              }`}
            >
              Cascade
            </button>
          </div>

          {/* Line Style Toggle: Pipeline vs Curved */}
          <button
            onClick={() => setLineStyle(lineStyle === "pipeline" ? "curved" : "pipeline")}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-all shadow-2xs cursor-pointer bg-white border-[#E8E2D5] text-[#2C2623] hover:bg-[#F3EDE2]"
            title="Toggle between Horizontal Pipeline and Curved Bézier Flow"
          >
            <span className={`w-2 h-2 rounded-full ${lineStyle === "pipeline" ? "bg-[#EA580C]" : "bg-[#7C3AED]"}`} />
            <span>{lineStyle === "pipeline" ? "Pipeline (Horizontal)" : "Curved Flow"}</span>
          </button>

          {/* Toggle Amounts on Wires */}
          <button
            onClick={() => setShowEdgeAmounts(!showEdgeAmounts)}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer ${
              showEdgeAmounts
                ? "bg-[#E6F7F0] border-[#A7F3D0] text-[#059669]"
                : "bg-white border-[#E8E2D5] text-[#746D65] hover:bg-[#F3EDE2]"
            }`}
          >
            {showEdgeAmounts ? "Amounts: Visible" : "Amounts: Hidden"}
          </button>
        </div>
      </div>

      {/* MAIN GRAPH CANVAS VIEWPORT */}
      <div
        ref={viewportRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        className={`relative w-full h-[620px] bg-[#FAF7F0] rounded-2xl border-2 border-[#E8E2D5] overflow-hidden shadow-inner ${
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
            style={{ minWidth: "1700px", minHeight: "1200px", overflow: "visible" }}
          >
            <defs>
              {/* Hop 0 -> Hop 1 Gradient */}
              <linearGradient id="grad-hop1" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#10B981" />
                <stop offset="100%" stopColor="#EA580C" />
              </linearGradient>

              {/* Hop 1 -> Hop 2 Gradient */}
              <linearGradient id="grad-hop2" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#EA580C" />
                <stop offset="100%" stopColor="#D97706" />
              </linearGradient>

              {/* Hop 2 -> Hop 3 Gradient */}
              <linearGradient id="grad-hop3" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#D97706" />
                <stop offset="100%" stopColor="#7C3AED" />
              </linearGradient>

              {/* Markers / Arrowheads */}
              <marker id="marker-hop1" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#EA580C" />
              </marker>

              <marker id="marker-hop2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#D97706" />
              </marker>

              <marker id="marker-hop3" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#7C3AED" />
              </marker>
            </defs>

            {/* Dynamic Rendered SVG Pipeline Connectors */}
            {renderedLinks.map((l, i) => {
              const active = isLinkActive(l);
              const hopGrad = l.hop === 1 ? "url(#grad-hop1)" : l.hop === 2 ? "url(#grad-hop2)" : "url(#grad-hop3)";
              const marker = l.hop === 1 ? "url(#marker-hop1)" : l.hop === 2 ? "url(#marker-hop2)" : "url(#marker-hop3)";
              const strokeColor = l.hop === 1 ? "#10B981" : l.hop === 2 ? "#EA580C" : "#7C3AED";

              return (
                <g key={l.txn_id || i} className="transition-opacity duration-200" opacity={active ? 1.0 : 0.18}>
                  {/* Outer Pipe Glow Casing */}
                  <path
                    d={l.pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={active ? 8 : 5}
                    strokeOpacity={active ? 0.22 : 0.12}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Core Solid Pipe Conduit */}
                  <path
                    d={l.pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={active ? 3 : 2}
                    markerEnd={marker}
                    strokeOpacity={active ? 1.0 : 0.85}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Animated Directional Fluid Pulse Dash */}
                  <path
                    d={l.pathD}
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth={2}
                    strokeDasharray="8,14"
                    strokeOpacity={0.9}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <animate
                      attributeName="stroke-dashoffset"
                      from="44"
                      to="0"
                      dur="1.2s"
                      repeatCount="indefinite"
                    />
                  </path>

                  {/* Amount Pill over the pipe midpoint */}
                  {showEdgeAmounts && (
                    <g transform={`translate(${l.midX}, ${l.midY})`}>
                      <rect
                        x="-48"
                        y="-10"
                        width="96"
                        height="20"
                        rx="6"
                        fill="#FFFFFF"
                        stroke={strokeColor}
                        strokeWidth="1.2"
                        className="shadow-xs"
                      />
                      <text
                        x="0"
                        y="3.5"
                        textAnchor="middle"
                        fontSize="9"
                        fontWeight="bold"
                        fill="#2C2623"
                        fontFamily="monospace"
                      >
                        ₹{l.amount ? Number(l.amount).toLocaleString("en-IN") : "0"}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>

          {/* 4 HIERARCHICAL HOP LANES (Nodes Layer) */}
          <div className="flex items-start gap-20 relative z-10">
            {/* ------------------------------------------------------------- */}
            {/* COLUMN 0: HOP 0 • VICTIM ACCOUNT                              */}
            {/* ------------------------------------------------------------- */}
            <div className="w-80 flex-shrink-0 space-y-4">
              <div className="bg-[#E6F7F0] border border-[#A7F3D0] rounded-xl px-4 py-2 flex items-center justify-between shadow-2xs">
                <div>
                  <span className="text-xs font-bold text-[#059669] uppercase font-mono tracking-wider">
                    HOP 0 • VICTIM ACCOUNT
                  </span>
                  <p className="text-[10px] text-[#047857]">Origin Fraud Source (FIR Complainant)</p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-white text-[#059669] font-bold border border-[#A7F3D0]">
                  Origin
                </span>
              </div>

              {hopGroups[0]?.map((node) => {
                const active = isNodeActive(node.id);
                const isSelected = selectedNode?.id === node.id;

                return (
                  <div
                    key={node.id}
                    ref={(el) => {
                      if (el) nodeRefs.current[node.id] = el;
                    }}
                    onMouseEnter={() => setHoveredNodeId(node.id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                    onClick={() => setSelectedNode(node)}
                    className={`interactive-node-card relative bg-white border-2 rounded-2xl p-4 shadow-sm transition-all duration-150 cursor-pointer ${
                      isSelected
                        ? "border-[#10B981] ring-3 ring-[#10B981]/30 scale-102"
                        : active
                        ? "border-[#10B981] hover:shadow-md"
                        : "border-[#E8E2D5] opacity-40 hover:opacity-100"
                    }`}
                  >
                    {/* Outgoing Right Connector Port */}
                    <div className="absolute right-[-7px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#10B981] border-2 border-white shadow-xs" />

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold text-[#2C2623]">{node.id}</span>
                        <button
                          onClick={(e) => handleCopy(node.id, e)}
                          title="Copy Account ID"
                          className="text-[#9E968D] hover:text-[#2C2623] p-0.5"
                        >
                          {copiedId === node.id ? <Check className="w-3 h-3 text-[#10B981]" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#E6F7F0] text-[#059669] font-bold">
                        Complainant
                      </span>
                    </div>

                    <div className="text-[11px] text-[#746D65] mt-1 font-medium">
                      {node.bank} ({node.ifsc})
                    </div>

                    <div className="mt-2.5 p-2 rounded-xl bg-[#FEF2F2] border border-[#FEE2E2]">
                      <span className="text-[10px] uppercase font-bold text-[#DC2626]">Total Funds Siphoned</span>
                      <div className="text-sm font-mono font-bold text-[#DC2626]">
                        ₹{traceData?.total_siphoned_inr ? traceData.total_siphoned_inr.toLocaleString("en-IN") : "0"}
                      </div>
                    </div>

                    <div className="mt-2 text-[10px] text-[#9E968D] font-mono flex items-center justify-between">
                      <span>{node.device_type || "Android"}</span>
                      <span>{node.ip_address || "103.118.121.99"}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ------------------------------------------------------------- */}
            {/* COLUMN 1: HOP 1 • L1 COLLECTOR                                */}
            {/* ------------------------------------------------------------- */}
            <div className="w-80 flex-shrink-0 space-y-4">
              <div className="bg-[#FFF7ED] border border-[#FFEDD5] rounded-xl px-4 py-2 flex items-center justify-between shadow-2xs">
                <div>
                  <span className="text-xs font-bold text-[#EA580C] uppercase font-mono tracking-wider">
                    HOP 1 • L1 COLLECTOR
                  </span>
                  <p className="text-[10px] text-[#C2410C]">Primary Aggregation Mule (Immediate Drain)</p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#EA580C] text-white font-bold animate-pulse">
                  Target
                </span>
              </div>

              {hopGroups[1]?.map((node) => {
                const active = isNodeActive(node.id);
                const isSelected = selectedNode?.id === node.id;

                return (
                  <div
                    key={node.id}
                    ref={(el) => {
                      if (el) nodeRefs.current[node.id] = el;
                    }}
                    onMouseEnter={() => setHoveredNodeId(node.id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                    onClick={() => setSelectedNode(node)}
                    className={`interactive-node-card relative bg-white border-2 rounded-2xl p-4 shadow-sm transition-all duration-150 cursor-pointer ${
                      isSelected
                        ? "border-[#EA580C] ring-3 ring-[#EA580C]/30 scale-102"
                        : active
                        ? "border-[#EA580C] hover:shadow-md"
                        : "border-[#E8E2D5] opacity-40 hover:opacity-100"
                    }`}
                  >
                    {/* Incoming Left Connector Port */}
                    <div className="absolute left-[-7px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#EA580C] border-2 border-white shadow-xs" />
                    {/* Outgoing Right Connector Port */}
                    <div className="absolute right-[-7px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#EA580C] border-2 border-white shadow-xs" />

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold text-[#2C2623]">{node.id}</span>
                        <button
                          onClick={(e) => handleCopy(node.id, e)}
                          title="Copy Account ID"
                          className="text-[#9E968D] hover:text-[#2C2623] p-0.5"
                        >
                          {copiedId === node.id ? <Check className="w-3 h-3 text-[#10B981]" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#FEF3C7] text-[#D97706] font-bold font-mono">
                        Score: {node.risk_score || 95}
                      </span>
                    </div>

                    <div className="text-[11px] text-[#746D65] mt-1 font-medium">
                      {node.bank} ({node.ifsc})
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-2.5">
                      <div className="p-2 rounded-xl bg-[#FFF7ED] border border-[#FFEDD5]">
                        <span className="text-[9px] uppercase font-bold text-[#C2410C]">Received</span>
                        <div className="text-xs font-mono font-bold text-[#EA580C]">
                          ₹{node.tainted_received ? node.tainted_received.toLocaleString("en-IN") : "0"}
                        </div>
                      </div>
                      <div className="p-2 rounded-xl bg-[#E6F7F0] border border-[#A7F3D0]">
                        <span className="text-[9px] uppercase font-bold text-[#047857]">Trapped Balance</span>
                        <div className="text-xs font-mono font-bold text-[#059669]">
                          ₹{node.holding_amount ? node.holding_amount.toLocaleString("en-IN") : "0"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2.5 px-2.5 py-1 rounded-lg bg-[#FEF2F2] border border-[#FEE2E2] text-[10px] text-[#DC2626] font-bold flex items-center gap-1.5">
                      <Zap className="w-3 h-3 text-[#DC2626] flex-shrink-0" />
                      <span>Dispersed into {hopGroups[2]?.length || 14} mules in &lt; 7 mins</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ------------------------------------------------------------- */}
            {/* COLUMN 2: HOP 2 • L2 DISTRIBUTOR MULES                        */}
            {/* ------------------------------------------------------------- */}
            <div className="w-[420px] flex-shrink-0 space-y-4">
              <div className="bg-[#FEF3C7] border border-[#FDE68A] rounded-xl px-4 py-2 flex items-center justify-between shadow-2xs">
                <div>
                  <span className="text-xs font-bold text-[#D97706] uppercase font-mono tracking-wider">
                    HOP 2 • L2 DISTRIBUTORS ({hopGroups[2]?.length || 0})
                  </span>
                  <p className="text-[10px] text-[#B45309]">Smurfing Ring / Bunny-Hop Splitting Layer</p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-white text-[#D97706] font-bold border border-[#FDE68A]">
                  Smurfing Ring
                </span>
              </div>

              {/* Cards Container (Grid or Stack) */}
              <div className={hop2Layout === "grid" ? "grid grid-cols-2 gap-3" : "space-y-3"}>
                {hopGroups[2]?.map((node) => {
                  const active = isNodeActive(node.id);
                  const isSelected = selectedNode?.id === node.id;

                  return (
                    <div
                      key={node.id}
                      ref={(el) => {
                        if (el) nodeRefs.current[node.id] = el;
                      }}
                      onMouseEnter={() => setHoveredNodeId(node.id)}
                      onMouseLeave={() => setHoveredNodeId(null)}
                      onClick={() => setSelectedNode(node)}
                      className={`interactive-node-card relative bg-white border rounded-xl p-3 shadow-2xs transition-all duration-150 cursor-pointer ${
                        isSelected
                          ? "border-[#D97706] ring-2 ring-[#D97706]/30 scale-102"
                          : active
                          ? "border-[#D97706] hover:shadow-md"
                          : "border-[#E8E2D5] opacity-40 hover:opacity-100"
                      }`}
                    >
                      {/* Incoming Left Connector Port */}
                      <div className="absolute left-[-6px] top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#D97706] border-2 border-white shadow-xs" />
                      {/* Outgoing Right Connector Port */}
                      <div className="absolute right-[-6px] top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#D97706] border-2 border-white shadow-xs" />

                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-[#2C2623]">{node.id}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#D97706] font-bold font-mono">
                          {node.risk_score}
                        </span>
                      </div>

                      <div className="text-[10px] text-[#746D65] mt-0.5 truncate font-medium">
                        {node.bank} ({node.ifsc})
                      </div>

                      <div className="flex items-center justify-between text-[11px] mt-2 font-mono pt-1.5 border-t border-[#F5EDE1]">
                        <span className="text-[#746D65]">
                          Share: ₹{node.tainted_received ? Number(node.tainted_received).toLocaleString("en-IN") : "0"}
                        </span>
                        <span className="text-[#059669] font-bold">
                          Lien: ₹{node.holding_amount ? Number(node.holding_amount).toLocaleString("en-IN") : "0"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* COLUMN 3: HOP 3 • L3 TERMINAL CASHOUT                         */}
            {/* ------------------------------------------------------------- */}
            <div className="w-80 flex-shrink-0 space-y-4">
              <div className="bg-[#EDE9FE] border border-[#DDD6FE] rounded-xl px-4 py-2 flex items-center justify-between shadow-2xs">
                <div>
                  <span className="text-xs font-bold text-[#7C3AED] uppercase font-mono tracking-wider">
                    HOP 3 • L3 CASHOUT / EXIT
                  </span>
                  <p className="text-[10px] text-[#6D28D9]">Crypto P2P / Offshore IP Terminal Nodes</p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-white text-[#7C3AED] font-bold border border-[#DDD6FE]">
                  Terminal
                </span>
              </div>

              <div className="space-y-3">
                {hopGroups[3]?.map((node) => {
                  const active = isNodeActive(node.id);
                  const isSelected = selectedNode?.id === node.id;

                  return (
                    <div
                      key={node.id}
                      ref={(el) => {
                        if (el) nodeRefs.current[node.id] = el;
                      }}
                      onMouseEnter={() => setHoveredNodeId(node.id)}
                      onMouseLeave={() => setHoveredNodeId(null)}
                      onClick={() => setSelectedNode(node)}
                      className={`interactive-node-card relative bg-white border-2 rounded-2xl p-4 shadow-sm transition-all duration-150 cursor-pointer ${
                        isSelected
                          ? "border-[#7C3AED] ring-3 ring-[#7C3AED]/30 scale-102"
                          : active
                          ? "border-[#7C3AED] hover:shadow-md"
                          : "border-[#E8E2D5] opacity-40 hover:opacity-100"
                      }`}
                    >
                      {/* Incoming Left Connector Port */}
                      <div className="absolute left-[-7px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#7C3AED] border-2 border-white shadow-xs" />

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-[#2C2623]">{node.id}</span>
                          <button
                            onClick={(e) => handleCopy(node.id, e)}
                            title="Copy Account ID"
                            className="text-[#9E968D] hover:text-[#2C2623] p-0.5"
                          >
                            {copiedId === node.id ? <Check className="w-3 h-3 text-[#10B981]" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[#EDE9FE] text-[#7C3AED] font-bold">
                          Crypto / P2P
                        </span>
                      </div>

                      <div className="text-[11px] text-[#746D65] mt-1 font-medium">
                        {node.bank} ({node.ifsc})
                      </div>

                      <div className="mt-2.5 p-2 rounded-xl bg-[#F5F3FF] border border-[#DDD6FE]">
                        <span className="text-[9px] uppercase font-bold text-[#6D28D9]">Exit Value</span>
                        <div className="text-xs font-mono font-bold text-[#7C3AED]">
                          ₹{node.tainted_received ? node.tainted_received.toLocaleString("en-IN") : "0"}
                        </div>
                      </div>

                      <div className="mt-2 text-[10px] text-[#9E968D] font-mono">
                        IP: <span className="text-[#DC2626] font-semibold">{node.ip_address || "194.26.29.11"}</span> (Foreign)
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* NODE FORENSIC INSPECTOR MODAL / DRAWER */}
      {selectedNode && (
        <div className="bg-white border-2 border-[#D96B27] rounded-2xl p-5 shadow-lg relative animate-in fade-in slide-in-from-bottom-2">
          <button
            onClick={() => setSelectedNode(null)}
            className="absolute right-4 top-4 text-[#9E968D] hover:text-[#2C2623] p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#F0EAE1] pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-[#2C2623]">{selectedNode.id}</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-[#FAF6EE] text-[#D96B27] border border-[#E8E2D5]">
                  Hop {selectedNode.hop} • {selectedNode.role || "MULE"}
                </span>
                <span className="text-xs font-bold text-[#059669]">
                  Risk Score: {selectedNode.risk_score || 90}/100
                </span>
              </div>
              <p className="text-xs text-[#746D65] mt-0.5">
                Bank: <b>{selectedNode.bank}</b> | IFSC: <b>{selectedNode.ifsc}</b> | Device: {selectedNode.device_type}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={onNavigateToNotices}
                className="px-4 py-2 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] text-white text-xs font-bold shadow-sm flex items-center gap-2 cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Issue Section 91 Freezing Notice for this Account</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4 text-xs font-mono">
            <div className="p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5]">
              <span className="text-[#9E968D] block text-[10px] uppercase font-bold">Tainted Inflow</span>
              <span className="text-sm font-bold text-[#EA580C]">
                ₹{selectedNode.tainted_received ? Number(selectedNode.tainted_received).toLocaleString("en-IN") : "0"}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5]">
              <span className="text-[#9E968D] block text-[10px] uppercase font-bold">Tainted Outflow</span>
              <span className="text-sm font-bold text-[#DC2626]">
                ₹{selectedNode.tainted_forwarded ? Number(selectedNode.tainted_forwarded).toLocaleString("en-IN") : "0"}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5]">
              <span className="text-[#9E968D] block text-[10px] uppercase font-bold">Trapped Lien Balance</span>
              <span className="text-sm font-bold text-[#059669]">
                ₹{selectedNode.holding_amount ? Number(selectedNode.holding_amount).toLocaleString("en-IN") : "0"}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5]">
              <span className="text-[#9E968D] block text-[10px] uppercase font-bold">IP & Device Signature</span>
              <span className="text-xs text-[#2C2623] truncate block">
                {selectedNode.ip_address} ({selectedNode.device_type})
              </span>
            </div>
          </div>

          {selectedNode.reasons && (
            <div className="mt-3 p-3 rounded-xl bg-[#FEF2F2] border border-[#FEE2E2] text-xs text-[#DC2626] font-medium">
              <b>Forensic Reason:</b> {selectedNode.reasons}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
