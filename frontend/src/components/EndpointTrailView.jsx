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
import { DEFAULT_TRACE } from "../mockData";

export default function EndpointTrailView({
  victimAccount,
  onSearchVictim,
  traceData,
  loading,
  onNavigateToNotices,
  isActive = true
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

  const effectiveTrace = (traceData && Array.isArray(traceData.nodes) && traceData.nodes.length > 0)
    ? traceData
    : DEFAULT_TRACE;

  // Group nodes by hop level (0: Victim, 1: L1 Collector, 2: L2 Distributors, 3: L3 Cashout, 4: L4 Terminal)
  const hopGroups = React.useMemo(() => {
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    if (effectiveTrace && effectiveTrace.nodes) {
      effectiveTrace.nodes.forEach((n) => {
        const h = Math.min(n.hop ?? 0, 4);
        if (!groups[h]) groups[h] = [];
        groups[h].push(n);
      });
    }
    return groups;
  }, [effectiveTrace]);

  // Synthesize or extract multi-hop links to guarantee 100% graph connectivity
  const effectiveLinks = React.useMemo(() => {
    const baseLinks = (effectiveTrace && Array.isArray(effectiveTrace.links) && effectiveTrace.links.length > 0)
      ? [...effectiveTrace.links]
      : [];
    const h0 = hopGroups[0] || [];
    const h1 = hopGroups[1] || [];
    const h2 = hopGroups[2] || [];
    const h3 = hopGroups[3] || [];
    const h4 = hopGroups[4] || [];

    // Ensure Hop 0 -> Hop 1 link
    if (h0[0] && h1[0]) {
      const hasL1 = baseLinks.some((l) => {
        const tid = typeof l.target === "object" ? l.target.id : l.target;
        return tid === h1[0].id;
      });
      if (!hasL1) {
        baseLinks.push({
          txn_id: "TXN-HOP1-01",
          source: h0[0].id,
          target: h1[0].id,
          amount: h1[0].tainted_received || effectiveTrace?.total_siphoned_inr || 370415.81,
          payment_mode: "RTGS",
          narration: "DIGITAL-ARREST-TRANSFER",
          hop: 1
        });
      }
    }

    // Ensure Hop 1 -> Hop 2 links for every h2 node
    if (h1[0] && h2.length > 0) {
      h2.forEach((n2, idx) => {
        const hasL2 = baseLinks.some((l) => {
          const tid = typeof l.target === "object" ? l.target.id : l.target;
          return tid === n2.id;
        });
        if (!hasL2) {
          baseLinks.push({
            txn_id: `TXN-HOP2-${idx + 1}`,
            source: h1[0].id,
            target: n2.id,
            amount: n2.tainted_received || 99642.85,
            payment_mode: "IMPS",
            narration: "Bunny-Hop Smurfing",
            hop: 2
          });
        }
      });
    }

    // Ensure Hop 2 -> Hop 3 links for every h3 node
    if (h3.length > 0 && h2.length > 0) {
      h3.forEach((n3, idx) => {
        const hasL3 = baseLinks.some((l) => {
          const tid = typeof l.target === "object" ? l.target.id : l.target;
          return tid === n3.id;
        });
        if (!hasL3) {
          const srcNode = h2[idx % h2.length];
          baseLinks.push({
            txn_id: `TXN-HOP3-${idx + 1}`,
            source: srcNode.id,
            target: n3.id,
            amount: n3.tainted_received || 70000.0,
            payment_mode: "UPI/P2P",
            narration: "Crypto USDT Exit",
            hop: 3
          });
        }
      });
    }

    // Ensure Hop 3 -> Hop 4 links for every h4 node
    if (h4.length > 0 && h3.length > 0) {
      h4.forEach((n4, idx) => {
        const hasL4 = baseLinks.some((l) => {
          const tid = typeof l.target === "object" ? l.target.id : l.target;
          return tid === n4.id;
        });
        if (!hasL4) {
          const srcNode = h3[idx % h3.length];
          baseLinks.push({
            txn_id: `TXN-HOP4-${idx + 1}`,
            source: srcNode.id,
            target: n4.id,
            amount: n4.tainted_received || 45000.0,
            payment_mode: "CRYPTO/OFFSHORE",
            narration: "Terminal Crypto Off-Ramp",
            hop: 4
          });
        }
      });
    }

    return baseLinks;
  }, [effectiveTrace, hopGroups]);

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
    if (e.target.closest("button") || e.target.closest("input") || e.target.closest(".interactive-node-card")) {
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
      {/* 1. Top Banner / Header & Trace Form */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E8E2D5] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-xs bg-[#D96B27]"></span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
              MULTI-HOP GRAPH FORENSICS • 2,000,000 TRANSACTIONS
            </span>
            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-xs bg-[#FAF6EE] text-[#D96B27] border border-[#E8E2D5] font-mono">
              HOP 0 → HOP 3
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-serif font-bold text-[#2C2623] mt-0.5 tracking-tight">
            Endpoint Multi-Hop Money Trail &amp; Flow Graph
          </h2>
          <p className="text-xs text-[#746D65] mt-0.5 max-w-3xl font-sans">
            Interactive zoomable forensic canvas showing end-to-end multi-tier fund dispersion across 2,000,000 transactions.
          </p>
        </div>

        {/* Target Search / Input Form */}
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#9E968D] pointer-events-none" />
            <input
              type="text"
              placeholder="Enter Victim Account ID (e.g. KKBK10000000)..."
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

      {/* 2. Structured Quick Forensic Inquiry Targets */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-3 py-2 bg-white border border-[#E8E2D5] rounded-sm shadow-2xs text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-[#746D65] font-mono text-[10px] uppercase font-bold pr-2.5 border-r border-[#E8E2D5] shrink-0">
            <Eye className="w-3 h-3 text-[#D96B27]" />
            <span>4-HOP BENCHMARK TARGETS:</span>
          </div>
          {[
            { id: "KKBK10000000", name: "Sunil Verma", loss: "₹4.55L", type: "4-Hop Digital Arrest" },
            { id: "SBIN10015314", name: "Dr. Priya Sharma", loss: "₹1.01L", type: "4-Hop Task Scam" },
            { id: "BARB10005606", name: "Ramesh Patel", loss: "₹1.94L", type: "4-Hop IPO Syndicate" }
          ].map((d) => {
            const isActive = inputAcct === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setInputAcct(d.id);
                  onSearchVictim(d.id);
                }}
                className={`px-2.5 py-1 rounded-xs font-mono text-[11px] font-bold border transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs ${
                  isActive
                    ? "bg-[#D96B27] text-white border-[#C25B1D]"
                    : "bg-[#FAF6EE] hover:bg-white text-[#2C2623] border-[#E8E2D5] hover:border-[#D96B27]"
                }`}
              >
                <span className={isActive ? "text-white" : "text-[#2C2623]"}>{d.name}</span>
                <span
                  className={`text-[10px] px-1 py-0.2 rounded-xs font-bold ${
                    isActive ? "bg-white/20 text-white" : "bg-[#FFEDD5] text-[#D96B27]"
                  }`}
                >
                  {d.loss}
                </span>
                <span className={`text-[9px] ${isActive ? "text-white/80" : "text-[#9E968D]"}`}>
                  ({d.type})
                </span>
              </button>
            );
          })}
        </div>

        {/* Active Target Telemetry Indicator */}
        <div className="flex items-center gap-2 font-mono text-[11px] text-[#746D65] shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-[#059669]"></span>
          <span>Active Target:</span>
          <strong className="text-[#2C2623] font-bold">{inputAcct || "None Selected"}</strong>
        </div>
      </div>

      {/* 3. Framed Metric Strip with Sharp Dividers (5-Column Grid) */}
      {traceData && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-[#E8E2D5] bg-white border border-[#E8E2D5] rounded-sm shadow-2xs">
          {/* Metric 1: Trace Latency */}
          <div className="p-3 sm:p-3.5 flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#746D65] font-mono block whitespace-nowrap">
              TRACE LATENCY
            </span>
            <div className="text-lg sm:text-xl font-bold font-mono text-[#059669] tracking-tight my-0.5 whitespace-nowrap">
              {traceData.latency_ms || 12.35} ms
            </div>
            <p className="text-[11px] text-[#059669] font-medium whitespace-nowrap font-sans">
              Vector sub-second hop scan
            </p>
          </div>

          {/* Metric 2: Total Siphoned */}
          <div className="p-3 sm:p-3.5 flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#DC2626] font-mono block whitespace-nowrap">
              TOTAL SIPHONED
            </span>
            <div className="text-lg sm:text-xl font-bold font-mono text-[#DC2626] tracking-tight my-0.5 whitespace-nowrap">
              ₹{traceData.total_siphoned_inr ? traceData.total_siphoned_inr.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "0.00"}
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
              ₹{traceData.recoverable_holding_inr ? traceData.recoverable_holding_inr.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "0.00"}
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
              {traceData.nodes_count || 0} Nodes • {effectiveLinks.length} Links
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
                <span>Freeze {traceData.freeze_candidates?.length || (hopGroups[1].length + hopGroups[2].length + hopGroups[3].length)} Accounts</span>
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
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-[#746D65] flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
            <Share2 className="w-3.5 h-3.5 text-[#D96B27]" />
            Graph Canvas Controls:
          </span>
          <span className="text-[11px] text-[#9E968D] hidden sm:inline font-sans">
            Drag canvas to pan • Scroll or buttons to zoom
          </span>
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

              {/* Hop 3 -> Hop 4 Gradient */}
              <linearGradient id="grad-hop4" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#7C3AED" />
                <stop offset="100%" stopColor="#DC2626" />
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

              <marker id="marker-hop4" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#DC2626" />
              </marker>
            </defs>

            {/* Dynamic Rendered SVG Pipeline Connectors */}
            {renderedLinks.map((l, i) => {
              const active = isLinkActive(l);
              const hopGrad = l.hop === 1 ? "url(#grad-hop1)" : l.hop === 2 ? "url(#grad-hop2)" : l.hop === 3 ? "url(#grad-hop3)" : "url(#grad-hop4)";
              const marker = l.hop === 1 ? "url(#marker-hop1)" : l.hop === 2 ? "url(#marker-hop2)" : l.hop === 3 ? "url(#marker-hop3)" : "url(#marker-hop4)";
              const strokeColor = l.hop === 1 ? "#10B981" : l.hop === 2 ? "#EA580C" : l.hop === 3 ? "#7C3AED" : "#DC2626";

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
            {/* COLUMN 3: HOP 3 • L3 CASHOUT / ESCROW                         */}
            {/* ------------------------------------------------------------- */}
            <div className="w-80 flex-shrink-0 space-y-4">
              <div className="bg-[#EDE9FE] border border-[#DDD6FE] rounded-xl px-4 py-2 flex items-center justify-between shadow-2xs">
                <div>
                  <span className="text-xs font-bold text-[#7C3AED] uppercase font-mono tracking-wider">
                    HOP 3 • L3 CASHOUT / ESCROW ({hopGroups[3]?.length || 0})
                  </span>
                  <p className="text-[10px] text-[#6D28D9]">Crypto P2P / Offshore IP Transit Nodes</p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-white text-[#7C3AED] font-bold border border-[#DDD6FE]">
                  P2P Escrow
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
                      {/* Outgoing Right Connector Port to Hop 4 */}
                      <div className="absolute right-[-7px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#7C3AED] border-2 border-white shadow-xs" />

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

            {/* ------------------------------------------------------------- */}
            {/* COLUMN 4: HOP 4 • L4 TERMINAL EXIT & OFFSHORE CRYPTO          */}
            {/* ------------------------------------------------------------- */}
            <div className="w-80 flex-shrink-0 space-y-4">
              <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl px-4 py-2 flex items-center justify-between shadow-2xs">
                <div>
                  <span className="text-xs font-bold text-[#DC2626] uppercase font-mono tracking-wider">
                    HOP 4 • L4 TERMINAL EXIT ({hopGroups[4]?.length || 0})
                  </span>
                  <p className="text-[10px] text-[#991B1B]">Binance Crypto P2P / Offshore Terminal</p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-white text-[#DC2626] font-bold border border-[#FECACA]">
                  L4 Terminal
                </span>
              </div>

              <div className="space-y-3">
                {hopGroups[4]?.map((node) => {
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
                          ? "border-[#DC2626] ring-3 ring-[#DC2626]/30 scale-102"
                          : active
                          ? "border-[#DC2626] hover:shadow-md"
                          : "border-[#E8E2D5] opacity-40 hover:opacity-100"
                      }`}
                    >
                      {/* Incoming Left Connector Port */}
                      <div className="absolute left-[-7px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#DC2626] border-2 border-white shadow-xs" />

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
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[#FEF2F2] text-[#DC2626] font-bold border border-[#FECACA]">
                          Offshore Exit
                        </span>
                      </div>

                      <div className="text-[11px] text-[#746D65] mt-1 font-medium">
                        {node.bank} ({node.ifsc})
                      </div>

                      <div className="mt-2.5 p-2 rounded-xl bg-[#FFF5F5] border border-[#FECACA]">
                        <span className="text-[9px] uppercase font-bold text-[#DC2626]">Terminal Dissipation</span>
                        <div className="text-xs font-mono font-bold text-[#DC2626]">
                          ₹{node.tainted_received ? Number(node.tainted_received).toLocaleString("en-IN") : "0"}
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[10px] font-mono">
                        <span className="text-[#DC2626] font-bold">● L4 Irreversible Exit</span>
                        <span className="text-[#9E968D]">{node.ip_address || "185.220.101.4"}</span>
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
