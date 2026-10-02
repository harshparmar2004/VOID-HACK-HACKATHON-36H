import React, { useState, useRef, useEffect, useMemo } from "react";
import { Play, Pause, RotateCcw, ZoomIn, ArrowRight, ArrowDown, GitBranch, Copy, Check, Move } from "lucide-react";
import { DASH, inr, num, text } from "../format";
import {
  AccountColumns,
  DENSE_FROM,
  EvidencePanels,
  LinkCard,
  MIN_ZOOM,
  NodePanel,
  READABLE_ZOOM,
  ROLE_KEYS,
  RoleLegend,
  ScoreBar,
  TrimBadge,
  ZoomBar,
  clampZoom,
  endId,
  layeredLayout,
  linkGeometry,
  riskOf,
  roleKey,
  roleTheme,
  traceTime
} from "./TraceEvidence";

export default function NetworkGraphView({ traceData, serverMs, isActive = true }) {
  const [treeOrientation, setTreeOrientation] = useState("horizontal"); // "horizontal" (L->R) or "vertical" (T->B)
  const [branchStyle, setBranchStyle] = useState("curved"); // "curved" (organic tree limbs) or "orthogonal" (stepped pipeline)
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 40, y: 30 });
  const [isDragging, setIsDragging] = useState(false);
  const [isWheeling, setIsWheeling] = useState(false);
  const [wheelMode, setWheelMode] = useState("pan"); // "pan" (wheel scrolls canvas) or "zoom" (wheel zooms at cursor)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredLink, setHoveredLink] = useState(null);
  const [selectedLink, setSelectedLink] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timeProgress, setTimeProgress] = useState(100);
  const [copiedId, setCopiedId] = useState(null);

  const viewportRef = useRef(null);
  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const wheelModeRef = useRef(wheelMode);
  wheelModeRef.current = wheelMode;
  const wheelTimeoutRef = useRef(null);

  // The parent mounts this view only with a trace that has nodes.
  const nodes = traceData.nodes;
  // Replay order: by transfer time.
  const rawLinks = useMemo(
    () => [...(traceData.links || [])].sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || ""))),
    [traceData.links]
  );

  // Replay slider: how many of the transfers are drawn
  const visibleLinksCount = Math.max(1, Math.floor((rawLinks.length * timeProgress) / 100));
  const effectiveLinks = useMemo(() => rawLinks.slice(0, visibleLinksCount), [rawLinks, visibleLinksCount]);

  const dense = nodes.length > DENSE_FROM;
  const isHorizontal = treeOrientation === "horizontal";

  // Layered by hop (victim -> L1 -> L2 -> L3). Hop decides position only; colour comes from the role.
  const layout = useMemo(
    () => layeredLayout(nodes, rawLinks, { vertical: !isHorizontal, dense }),
    [nodes, rawLinks, isHorizontal, dense]
  );

  const treeLayout = useMemo(() => {
    const roleOf = {};
    nodes.forEach((n) => {
      roleOf[n.id] = n.role;
    });
    const positionedNodes = nodes
      .filter((n) => layout.positions[n.id])
      .map((n) => ({ ...n, ...layout.positions[n.id] }));
    const positionedLinks = [];
    effectiveLinks.forEach((l) => {
      const sourceId = endId(l.source);
      const targetId = endId(l.target);
      const src = layout.positions[sourceId];
      const tgt = layout.positions[targetId];
      if (!src || !tgt) return;
      positionedLinks.push({
        ...l,
        sourceId,
        targetId,
        targetRole: roleOf[targetId],
        ...linkGeometry(src, tgt, { vertical: !isHorizontal, curved: branchStyle === "curved" })
      });
    });
    return { positionedNodes, positionedLinks, canvasBounds: layout.bounds };
  }, [nodes, layout, effectiveLinks, isHorizontal, branchStyle]);

  // The hovered or selected account and the accounts it traded with.
  const activeId = hoveredNodeId || selectedNode?.id || null;
  const activeSet = useMemo(() => {
    if (!activeId) return null;
    const set = new Set([activeId]);
    treeLayout.positionedLinks.forEach((l) => {
      if (l.sourceId === activeId) set.add(l.targetId);
      if (l.targetId === activeId) set.add(l.sourceId);
    });
    return set;
  }, [activeId, treeLayout.positionedLinks]);

  // Temporal Playback Animation Loop
  useEffect(() => {
    let interval;
    if (isPlaying) {
      interval = setInterval(() => {
        setTimeProgress((prev) => {
          if (prev >= 100) {
            setIsPlaying(false);
            return 100;
          }
          return prev + 5;
        });
      }, 450);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  // 1. Mouse Drag Interactions (Zero-lag direct tracking attached to window)
  const handleMouseDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return; // Allow left click (0) and middle click (1)
    if (e.target.closest("button") || e.target.closest("input") || e.target.closest(".tree-node-card") || e.target.closest(".trace-link")) {
      return;
    }
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleWindowMouseMove = (e) => {
      // If mouse button is no longer held down, release immediately
      if (e.buttons === 0) {
        setIsDragging(false);
        return;
      }
      setPan({
        x: Math.round(e.clientX - dragStart.x),
        y: Math.round(e.clientY - dragStart.y)
      });
    };

    const handleWindowMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleWindowMouseMove, { passive: true });
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [isDragging, dragStart]);

  // 2. High-Precision Native Wheel Listener (Non-Passive: prevents page jitter & handles cursor-centered zoom / smooth pan)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onWheel = (e) => {
      e.preventDefault();

      setIsWheeling(true);
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
      wheelTimeoutRef.current = setTimeout(() => {
        setIsWheeling(false);
      }, 150);

      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;
      // Pinch and trackpad gesture zoom arrive as ctrl+wheel: swallowed, zoom is on the slider.
      if (e.ctrlKey || e.metaKey) return;
      const isZoomAction = wheelModeRef.current === "zoom";

      if (isZoomAction) {
        // CURSOR-CENTERED ZOOM: Point under mouse cursor remains locked in place
        const rect = el.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;

        // Damped exponential factor prevents jumpy scaling
        const factor = Math.exp(-e.deltaY * 0.0016);
        const newZoom = clampZoom(currentZoom * factor);

        if (Math.abs(newZoom - currentZoom) > 0.001) {
          const scaleRatio = newZoom / currentZoom;
          const newPanX = cursorX - (cursorX - currentPan.x) * scaleRatio;
          const newPanY = cursorY - (cursorY - currentPan.y) * scaleRatio;

          setZoom(Number(newZoom.toFixed(2)));
          setPan({ x: Math.round(newPanX), y: Math.round(newPanY) });
        }
      } else {
        // SMOOTH DOCUMENT PAN: Natural directional scrolling
        let deltaX = e.deltaX;
        let deltaY = e.deltaY;

        // Shift key converts vertical scroll to horizontal scroll
        if (e.shiftKey && deltaX === 0) {
          deltaX = deltaY;
          deltaY = 0;
        }

        setPan({
          x: Math.round(currentPan.x - deltaX),
          y: Math.round(currentPan.y - deltaY)
        });
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
    };
  }, []);

  // 3. Center-Anchored Zoom Controls (Expanding from screen center instead of top-left)
  const zoomToTarget = (targetZoom) => {
    if (!viewportRef.current) return;
    const vWidth = viewportRef.current.clientWidth;
    const vHeight = viewportRef.current.clientHeight;
    const centerX = vWidth / 2;
    const centerY = vHeight / 2;
    const factor = targetZoom / zoom;
    setPan({
      x: Math.round(centerX - (centerX - pan.x) * factor),
      y: Math.round(centerY - (centerY - pan.y) * factor)
    });
    setZoom(Number(targetZoom.toFixed(2)));
  };

  // Fit the whole trace; the opening view passes a floor so card text stays readable.
  const handleFitView = (floor = MIN_ZOOM) => {
    if (viewportRef.current) {
      const vWidth = viewportRef.current.clientWidth - 40;
      const vHeight = viewportRef.current.clientHeight - 40;
      const cWidth = treeLayout.canvasBounds.width;
      const cHeight = treeLayout.canvasBounds.height;
      const autoZoom = Math.min(1.0, Math.max(floor, Math.min(vWidth / cWidth, vHeight / cHeight)));
      setZoom(Number(autoZoom.toFixed(2)));
      setPan({ x: 20, y: 20 });
    }
  };

  // Bring one account to the middle of the canvas.
  const centreOn = (id) => {
    const pos = layout.positions[id];
    if (!viewportRef.current || !pos) return;
    setPan({
      x: Math.round(viewportRef.current.clientWidth / 2 - (pos.x + pos.width / 2) * zoom),
      y: Math.round(viewportRef.current.clientHeight / 2 - (pos.y + pos.height / 2) * zoom)
    });
  };

  const handleCopy = (text, e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // The graph opens fitted to the canvas (once the tab is visible, so the canvas has a size).
  const fittedFor = useRef(null);
  useEffect(() => {
    if (!isActive || fittedFor.current === treeOrientation) return;
    fittedFor.current = treeOrientation;
    handleFitView(READABLE_ZOOM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, treeOrientation]);

  // Highlight: the hovered or pinned transfer, else the transfers of the active account.
  const sameLink = (a, b) => Boolean(a && b) && (a.tx_key != null ? a.tx_key === b.tx_key : a === b);
  const shownLink = hoveredLink || selectedLink;
  const touchesActive = (l) => !activeId || l.sourceId === activeId || l.targetId === activeId;
  const isLinkActive = (l) => (shownLink ? sameLink(l, shownLink) : touchesActive(l));
  const isNodeActive = (nodeId) => !activeSet || activeSet.has(nodeId);

  // Score bar: the hovered account, else the pinned one, else the victim.
  const scoreNode =
    (hoveredNodeId && nodes.find((n) => n.id === hoveredNodeId)) || selectedNode || nodes.find((n) => n.role === "VICTIM") || null;

  return (
    <div className="space-y-4 select-none">
      {/* Top Header & Legend */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-serif font-bold text-[#2C2623]">
              Mule Network Layered Graph
            </h2>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#FAF6EE] text-[#D96B27] border border-[#E8E2D5] font-mono flex items-center gap-1">
              <GitBranch className="w-3 h-3 text-[#D96B27]" />
              LAYERED BY HOP • COLOUR BY ROLE
            </span>
            <TrimBadge traceData={traceData} />
            <span className="text-[11px] font-mono text-[#746D65]" title="Time the API spent on this trace">
              {text(traceData.full_hops)} hops • {num(nodes.length)} accounts • {num(rawLinks.length)} transfers • trace time{" "}
              {traceTime(traceData, serverMs)}
            </span>
          </div>
          <p className="text-xs text-[#746D65] mt-0.5">
            The selected victim's money, one layer per hop. Colour shows the role the engine assigned. Click an account for its details; hover or click a transfer for its details.
          </p>
        </div>

        <RoleLegend nodes={nodes} />
      </div>

      {/* Toolbar Controls */}
      <div className="bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[#746D65] flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5 text-[#D96B27]" />
            Layout:
          </span>

          {/* Orientation Toggle: Horizontal Tree vs Vertical Tree */}
          <div className="flex items-center bg-white border border-[#E8E2D5] rounded-lg overflow-hidden shadow-2xs text-[11px]">
            <button
              onClick={() => setTreeOrientation("horizontal")}
              className={`flex items-center gap-1.5 px-3 py-1 font-bold transition-colors cursor-pointer ${
                treeOrientation === "horizontal" ? "bg-[#D96B27] text-white" : "hover:bg-[#F3EDE2] text-[#746D65]"
              }`}
            >
              <ArrowRight className="w-3 h-3" />
              <span>Left to Right</span>
            </button>
            <button
              onClick={() => setTreeOrientation("vertical")}
              className={`flex items-center gap-1.5 px-3 py-1 font-bold transition-colors cursor-pointer ${
                treeOrientation === "vertical" ? "bg-[#D96B27] text-white" : "hover:bg-[#F3EDE2] text-[#746D65]"
              }`}
            >
              <ArrowDown className="w-3 h-3" />
              <span>Top to Bottom</span>
            </button>
          </div>

          {/* Branch Style Toggle: Organic Curved Limbs vs Stepped Pipeline */}
          <button
            onClick={() => setBranchStyle(branchStyle === "curved" ? "orthogonal" : "curved")}
            className="px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-all shadow-2xs cursor-pointer bg-white border-[#E8E2D5] text-[#2C2623] hover:bg-[#F3EDE2] flex items-center gap-1"
          >
            <span>{branchStyle === "curved" ? "Tree Limbs (Curved)" : "Circuit Pipes (Orthogonal)"}</span>
          </button>
        </div>

        {/* Zoom & Canvas Controls */}
        <div className="flex items-center gap-2">
          {/* Mouse Wheel Mode Toggle: Pan vs Zoom */}
          <div className="flex items-center bg-white border border-[#E8E2D5] rounded-lg p-0.5 shadow-2xs text-[11px]">
            <span className="text-[10px] font-mono text-[#9E968D] px-1.5 font-bold uppercase">Wheel:</span>
            <button
              onClick={() => setWheelMode("pan")}
              className={`px-2 py-0.5 rounded font-bold transition-all cursor-pointer flex items-center gap-1 ${
                wheelMode === "pan"
                  ? "bg-[#D96B27] text-white shadow-2xs"
                  : "text-[#746D65] hover:text-[#2C2623]"
              }`}
              title="Scroll wheel pans the canvas"
            >
              <Move className="w-3 h-3" />
              <span>Pan</span>
            </button>
            <button
              onClick={() => setWheelMode("zoom")}
              className={`px-2 py-0.5 rounded font-bold transition-all cursor-pointer flex items-center gap-1 ${
                wheelMode === "zoom"
                  ? "bg-[#D96B27] text-white shadow-2xs"
                  : "text-[#746D65] hover:text-[#2C2623]"
              }`}
              title="Scroll wheel zooms at the cursor and moves the slider"
            >
              <ZoomIn className="w-3 h-3" />
              <span>Zoom</span>
            </button>
          </div>

          <ZoomBar zoom={zoom} onZoom={zoomToTarget} onFit={() => handleFitView()} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
      <div className="space-y-4 min-w-0">
      <ScoreBar node={scoreNode} />
      {/* GRAPH CANVAS VIEWPORT */}
      <div
        ref={viewportRef}
        onMouseDown={handleMouseDown}
        onDragStart={(e) => e.preventDefault()}
        className={`relative w-full h-[640px] bg-[#FAF7F0] rounded-2xl border-2 border-[#E8E2D5] overflow-hidden shadow-inner select-none ${
          isDragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{
          touchAction: "none",
          backgroundImage: `
            radial-gradient(circle, #D5CCC0 1.2px, transparent 1.2px),
            linear-gradient(to right, rgba(232, 226, 213, 0.4) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(232, 226, 213, 0.4) 1px, transparent 1px)
          `,
          backgroundPosition: `${pan.x}px ${pan.y}px, ${pan.x}px ${pan.y}px, ${pan.x}px ${pan.y}px`,
          backgroundSize: `${Math.round(28 * zoom)}px ${Math.round(28 * zoom)}px, ${Math.round(140 * zoom)}px ${Math.round(140 * zoom)}px, ${Math.round(140 * zoom)}px ${Math.round(140 * zoom)}px`
        }}
      >
        {/* TRANSFORMED TREE CANVAS */}
        <div
          className="absolute origin-top-left select-none will-change-transform"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            transition: isDragging || isWheeling ? "none" : "transform 200ms cubic-bezier(0.16, 1, 0.3, 1)",
            width: `${treeLayout.canvasBounds.width}px`,
            height: `${treeLayout.canvasBounds.height}px`
          }}
        >
          {/* SVG TREE BRANCHES & LABELS LAYER */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{
              width: `${treeLayout.canvasBounds.width}px`,
              height: `${treeLayout.canvasBounds.height}px`,
              overflow: "visible"
            }}
          >
            <defs>
              {ROLE_KEYS.map((key) => (
                <marker key={key} id={`tarrow-${key}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={roleTheme(key).color} />
                </marker>
              ))}
            </defs>

            {/* Layer captions (position only) */}
            {isHorizontal &&
              layout.layers.map((layer) => (
                <text key={layer.hop} x={layer.x} y={layer.y - 14} fontSize="11" fontWeight="bold" fill="#9E968D" fontFamily="monospace">
                  HOP {layer.hop} • {layer.count}
                </text>
              ))}

            {/* Transfers: coloured by the role of the receiving account */}
            {treeLayout.positionedLinks.map((l, i) => {
              const picked = sameLink(l, shownLink);
              const active = isLinkActive(l);
              const strokeColor = roleTheme(l.targetRole).color;
              const showLabel = !dense || picked || (activeId && touchesActive(l));
              const linkEvents = {
                onMouseEnter: () => setHoveredLink(l),
                onMouseLeave: () => setHoveredLink(null),
                onClick: () => setSelectedLink(l)
              };

              return (
                <g key={l.tx_key ?? i} className="transition-opacity duration-200" opacity={active ? 1.0 : 0.15}>
                  {!dense && (
                    <path
                      d={l.pathD}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={active ? 8 : 4}
                      strokeOpacity={active ? 0.22 : 0.1}
                      strokeLinecap="round"
                    />
                  )}

                  <path
                    d={l.pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={picked ? 4 : dense ? 1.5 : 2.5}
                    markerEnd={`url(#tarrow-${roleKey(l.targetRole)})`}
                    strokeOpacity={dense && !picked ? 0.7 : 1.0}
                    strokeLinecap="round"
                  />

                  {!dense && (
                    <path d={l.pathD} fill="none" stroke="#FFFFFF" strokeWidth={2} strokeDasharray="8,14" strokeOpacity={0.9} strokeLinecap="round">
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
                      <rect x="-65" y="-11" width="130" height="22" rx="6" fill="#FFFFFF" stroke={strokeColor} strokeWidth={picked ? "2" : "1.2"} />
                      <text x="0" y="-1" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#2C2623" fontFamily="monospace">
                        {inr(l.amount)}
                      </text>
                      <text x="0" y="7.5" textAnchor="middle" fontSize="7" fontWeight="bold" fill={strokeColor} fontFamily="sans-serif">
                        {l.payment_mode || DASH} • {l.timestamp ? String(l.timestamp).replace("T", " ").split(" ")[1] || DASH : DASH}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>

          {/* NODES LAYER */}
          {treeLayout.positionedNodes.map((node) => {
            const active = isNodeActive(node.id);
            const isSelected = selectedNode?.id === node.id;
            const theme = roleTheme(node.role);
            const risk = riskOf(node).value;
            const badge = `${node.role || DASH} • ${risk == null ? DASH : Math.round(risk)}`;
            const money =
              node.role === "VICTIM" ? `Paid: ${inr(traceData.total_siphoned_inr, 0)}` : `Holding: ${inr(node.holding_amount, 0)}`;

            return (
              <div
                key={node.id}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onClick={() => setSelectedNode(node)}
                title={dense ? `${node.id} • ${badge}` : undefined}
                style={{
                  position: "absolute",
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  width: `${node.width}px`,
                  height: `${node.height}px`,
                  borderColor: theme.color
                }}
                className={`tree-node-card bg-white border-2 rounded-xl shadow-sm cursor-pointer flex flex-col justify-between ${
                  dense ? "px-2 py-1" : "p-2.5 transition-all duration-150"
                } ${isSelected ? "ring-3 ring-[#D96B27]/40" : active ? "hover:shadow-md" : "opacity-40 hover:opacity-100"}`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`font-mono font-bold text-[#2C2623] truncate ${dense ? "text-[10px]" : "text-xs"}`}>{node.id}</span>
                    {!dense && (
                      <button onClick={(e) => handleCopy(node.id, e)} title="Copy account" className="text-[#9E968D] hover:text-[#2C2623] p-0.5">
                        {copiedId === node.id ? <Check className="w-3 h-3 text-[#10B981]" /> : <Copy className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                  <span
                    style={{ backgroundColor: theme.soft, color: theme.text }}
                    className="text-[9px] px-1.5 rounded font-bold font-mono whitespace-nowrap"
                    title="Role and risk from the engine"
                  >
                    {badge}
                  </span>
                </div>

                {dense ? (
                  <div className="text-[9px] font-mono text-[#059669] font-bold truncate">{money}</div>
                ) : (
                  <div className="flex items-center justify-between gap-2 text-[11px] pt-1 border-t border-[#F5EDE1] font-mono">
                    <span className="text-[#746D65] truncate font-sans text-[10px]">
                      {node.bank || DASH} ({node.ifsc || DASH})
                    </span>
                    <span className="text-[#059669] font-bold whitespace-nowrap">{money}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {shownLink && <LinkCard link={shownLink} pinned={!hoveredLink} onClose={() => setSelectedLink(null)} />}
      </div>

      {selectedNode && <NodePanel node={selectedNode} onClose={() => setSelectedNode(null)} />}

      {/* Transfer replay bar */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs space-y-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="w-8 h-8 rounded-lg bg-[#D96B27] hover:bg-[#C25B1C] text-white flex items-center justify-center shadow-2xs transition-colors cursor-pointer"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>
            <button
              onClick={() => {
                setIsPlaying(false);
                setTimeProgress(100);
              }}
              className="w-8 h-8 rounded-lg bg-[#F3EDE2] hover:bg-[#EAE4D8] text-[#2C2623] flex items-center justify-center transition-colors cursor-pointer"
              title="Reset Timeline"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <span className="font-medium text-[#2C2623]">Transfer replay (in time order)</span>
          </div>

          <span className="font-mono text-xs text-[#746D65]">
            {timeProgress}% ({treeLayout.positionedLinks.length} of {rawLinks.length} transfers)
          </span>
        </div>

        <input
          type="range"
          min="5"
          max="100"
          value={timeProgress}
          onChange={(e) => {
            setIsPlaying(false);
            setTimeProgress(Number(e.target.value));
          }}
          className="w-full accent-[#D96B27] cursor-pointer"
        />
      </div>
      </div>

      <div className="space-y-3 min-w-0">
        <AccountColumns
          nodes={nodes}
          activeId={activeId}
          pinnedId={selectedNode?.id ?? null}
          onHover={setHoveredNodeId}
          onPin={(node) => {
            setSelectedNode(node);
            centreOn(node.id);
          }}
        />
        <EvidencePanels traceData={traceData} />
      </div>
      </div>
    </div>
  );
}
