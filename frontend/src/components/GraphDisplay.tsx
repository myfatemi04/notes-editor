import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  Simulation,
  SimulationLinkDatum,
  SimulationNodeDatum,
} from "d3-force";
import { Fragment, useEffect, useRef, useState } from "react";
import { Graph } from "../lib/extractConceptGraph";
import { createBaseGraph } from "../lib/createLayout";

const WIDTH = 200;
const HEIGHT = 200;
const NODE_WIDTH = 80;
const NODE_HEIGHT = 40;
const PADDING = 60;
const SVG_WIDTH = WIDTH + 2 * PADDING + NODE_WIDTH;
const SVG_HEIGHT = HEIGHT + 2 * PADDING + NODE_HEIGHT;
const MIN_SCALE = 0.25;
const CHARGE_FORCE = 500;
const COLLIDE_RADIUS = 100;

function stableStringify(obj: any) {
  if (Array.isArray(obj)) {
    return "[" + obj.map(stableStringify).join(",") + "]";
  }
  if (obj instanceof Map) {
    const entries = Array.from(obj.entries()).sort();
    return (
      "Map{" +
      entries
        .map(
          ([key, value]) => stableStringify(key) + "=>" + stableStringify(value)
        )
        .join(",") +
      "}"
    );
  }
  if (obj instanceof Set) {
    const entryStrings = Array.from(obj).map(stableStringify);
    entryStrings.sort();
    return "Set{" + entryStrings.join(",") + "}";
  }
  if (obj && typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys.map((key) => key + ":" + stableStringify(obj[key])).join(",") +
      "}"
    );
  }
  return JSON.stringify(obj);
}

function isGraphUpdated(displayedGraph: Graph, currentGraph: Graph) {
  return (
    stableStringify(createBaseGraph(displayedGraph)) !==
    stableStringify(createBaseGraph(currentGraph))
  );
}

export interface CustomNodeDatum extends SimulationNodeDatum {
  id: string;
}

function OutwardEdges({
  src,
  graph,
  layout,
  effectiveCenters,
  highlighted,
}: {
  src: string;
  graph: Graph;
  layout: Record<string, [number, number]>;
  effectiveCenters: Record<string, [number, number]>;
  highlighted: boolean;
}) {
  return (
    <>
      {Array.from(graph.edges.get(src)!.keys()).map((dst) => {
        if (!layout[src] || !layout[dst]) {
          return null;
        }

        // Compute x1, y1, x2, y2. Must be at the border of the rectangle.
        const dx = effectiveCenters[dst][0] - effectiveCenters[src][0];
        const dy = effectiveCenters[dst][1] - effectiveCenters[src][1];
        let x1 = effectiveCenters[src][0];
        let y1 = effectiveCenters[src][1];
        let x2 = effectiveCenters[dst][0];
        let y2 = effectiveCenters[dst][1];

        if (Math.abs(dy) < (40 / 80) * Math.abs(dx)) {
          // Horizontal-ish
          const sign = dx > 0 ? 1 : -1;
          x1 += sign * 40;
          x2 -= sign * 40;
          y1 += (sign * 40 * dy) / dx;
          y2 -= (sign * 40 * dy) / dx;
        } else {
          // Vertical-ish
          const sign = dy > 0 ? 1 : -1;
          y1 += sign * 20;
          y2 -= sign * 20;
          x1 += (sign * 20 * dx) / dy;
          x2 -= (sign * 20 * dx) / dy;
        }

        return (
          <Fragment key={`${src}-${dst}`}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="black"
              strokeWidth={highlighted ? 2 : 1}
              markerEnd="url(#arrow)"
            />
            {/* Characterize the relationship between the nodes */}
            <text
              filter="url(#solid)"
              x={(effectiveCenters[src][0] + effectiveCenters[dst][0]) / 2}
              y={(effectiveCenters[src][1] + effectiveCenters[dst][1]) / 2}
              dy=".35em"
              textAnchor="middle"
              style={{ userSelect: "none" }}
            >
              {graph.edges.get(src)?.get(dst)?.relationTypes.join(", ")}
            </text>
          </Fragment>
        );
      })}
    </>
  );
}

export default function GraphDisplay({ graph }: { graph: Graph }) {
  const [simulation, setSimulation] =
    useState<Simulation<CustomNodeDatum, SimulationLinkDatum<CustomNodeDatum>>>(
      forceSimulation
    );
  const [layout, setLayout] = useState<Record<string, [number, number]>>({});
  const displayedGraphRef = useRef<Graph>();
  const [highlightedNode, setHighlightedNode] = useState<string | null>(null);
  const tickCounterRef = useRef<number>(0);

  useEffect(() => {
    if (
      !displayedGraphRef.current ||
      isGraphUpdated(displayedGraphRef.current, graph)
    ) {
      displayedGraphRef.current = graph;
      const indices = {};
      const currentNodes = simulation.nodes();
      simulation.nodes(
        Array.from(graph.nodes).map(([symbol, node], i) => {
          indices[symbol] = i;
          const existingNode = currentNodes.find((n) => n.id === symbol);
          return existingNode ? existingNode : { id: symbol };
        })
      );

      const links: SimulationLinkDatum<CustomNodeDatum>[] = Array.from(
        graph.edges.entries()
      )
        .map(([src, dstMap]) =>
          Array.from(dstMap.keys())
            .map((dst) => {
              if (indices[src] === undefined || indices[dst] === undefined) {
                return null;
              }
              return {
                source: indices[src],
                target: indices[dst],
              };
            })
            .filter((x) => x !== null)
        )
        .flat();

      simulation
        .force("charge", forceManyBody().strength(-CHARGE_FORCE))
        .force("center", forceCenter())
        .force("x", forceX())
        .force("y", forceY())
        .force("collide", forceCollide().radius(COLLIDE_RADIUS))
        .force("link", forceLink(links));
      simulation.alpha(1).alphaDecay(1 - Math.pow(0.001, 1 / 3000));
      simulation.restart();
    }
    // stableStringify debounces graph updates for unrelated sections
  }, [graph, simulation]);

  useEffect(() => {
    simulation.on("tick", () => {
      if (tickCounterRef.current === 250) {
        const newLayout: Record<string, [number, number]> = {};
        simulation.nodes().forEach((node) => {
          if (node.id && node.x !== undefined && node.y !== undefined) {
            newLayout[node.id] = [node.x, node.y];
          }
        });
        setLayout(newLayout);
        tickCounterRef.current = 0;
      } else {
        tickCounterRef.current += 1;
      }
    });
  }, []);

  const minX = Math.min(...Object.values(layout ?? {}).map((p) => p[0]));
  const maxX = Math.max(...Object.values(layout ?? {}).map((p) => p[0]));
  const minY = Math.min(...Object.values(layout ?? {}).map((p) => p[1]));
  const maxY = Math.max(...Object.values(layout ?? {}).map((p) => p[1]));
  const effectiveCenters = {};
  for (const node of simulation.nodes()) {
    if (node.id && layout && layout[node.id]) {
      effectiveCenters[node.id] = layout[node.id];
    }
  }

  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [scale, setScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const lastMousePosition = useRef<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Can't just be a prop because we need {passive: false}
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const svgElement = svgRef.current;
      if (!svgElement) return;
      const cx = SVG_WIDTH / 2;
      const cy = SVG_HEIGHT / 2;

      setScale((scale) => {
        const oldScale = scale;
        const newScale = Math.max(MIN_SCALE, oldScale * (1 + e.deltaY * 0.001));

        setOffsetX((prev) => cx - ((cx - prev) / oldScale) * newScale);
        setOffsetY((prev) => cy - ((cy - prev) / oldScale) * newScale);

        return newScale;
      });
    };

    const svgElement = svgRef.current;
    if (svgElement) {
      svgElement.addEventListener("wheel", handleWheel, { passive: false });

      return () => {
        svgElement.removeEventListener("wheel", handleWheel);
      };
    }
  }, []);

  return (
    <svg
      ref={svgRef}
      width={SVG_WIDTH}
      height={SVG_HEIGHT}
      viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
      style={{ border: "1px solid black" }}
      onMouseDown={(e) => {
        setIsPanning(true);
        lastMousePosition.current = { x: e.clientX, y: e.clientY };
      }}
      onMouseMove={(e) => {
        if (isPanning && lastMousePosition.current) {
          const dx = e.clientX - lastMousePosition.current.x;
          const dy = e.clientY - lastMousePosition.current.y;
          setOffsetX((prev) => prev + dx);
          setOffsetY((prev) => prev + dy);
          lastMousePosition.current = { x: e.clientX, y: e.clientY };
        }
      }}
      onMouseUp={() => {
        setIsPanning(false);
        lastMousePosition.current = null;
      }}
      onMouseLeave={() => {
        setIsPanning(false);
        lastMousePosition.current = null;
      }}
    >
      <defs>
        {/* https://stackoverflow.com/questions/15500894/background-color-of-text-in-svg */}
        <filter x="0" y="0" width="1" height="1" id="solid">
          <feFlood flood-color="white" result="bg" />
          <feMerge>
            <feMergeNode in="bg" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/marker */}
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>

      <g transform={`translate(${offsetX}, ${offsetY}) scale(${scale})`}>
        {/* Non-highlighted elements */}
        {Array.from(graph.edges.keys())
          .sort(
            // Show highlightedNode last
            (a, b) =>
              Number(a === highlightedNode) - Number(b === highlightedNode)
          )
          .map((src) => (
            <OutwardEdges
              key={src}
              src={src}
              graph={graph}
              layout={layout}
              effectiveCenters={effectiveCenters}
              highlighted={src === highlightedNode}
            />
          ))}

        {Array.from(graph.nodes.entries()).map(
          ([symbol, node]) =>
            layout[symbol] && (
              <g
                key={symbol}
                transform={`translate(${
                  effectiveCenters[symbol][0] - NODE_WIDTH / 2
                }, ${effectiveCenters[symbol][1] - NODE_HEIGHT / 2})`}
                onMouseOver={() => setHighlightedNode(symbol)}
                onMouseLeave={() => setHighlightedNode(null)}
              >
                <rect
                  x={1}
                  y={1}
                  width={NODE_WIDTH - 2}
                  height={NODE_HEIGHT - 2}
                  stroke="black"
                  strokeWidth={symbol === highlightedNode ? 2 : 1}
                  fill="white"
                />
                <text
                  x={4}
                  y={20}
                  dy=".35em"
                  style={{ cursor: "pointer", userSelect: "none" }}
                >
                  {node.title} (@{symbol})
                </text>
              </g>
            )
        )}
      </g>

      <g transform={`translate(12, 12)`}>
        {/* Reset button */}
        <rect
          x={0}
          y={0}
          width={60}
          height={20}
          fill="none"
          stroke="black"
          strokeWidth={1}
        />
        <text
          x={30}
          y={10}
          dy=".35em"
          textAnchor="middle"
          style={{ cursor: "pointer", userSelect: "none" }}
          onClick={() => {
            setOffsetX(0);
            setOffsetY(0);
            setScale(1);
          }}
        >
          Reset
        </text>

        {/* Zoom button */}
        <rect
          x={70}
          y={0}
          width={20}
          height={20}
          fill="none"
          stroke="black"
          strokeWidth={1}
        />
        <text
          x={80}
          y={10}
          dy=".35em"
          textAnchor="middle"
          style={{ cursor: "pointer", userSelect: "none" }}
          onClick={() => {
            // Zoom in centered at the SVG center
            const cx = SVG_WIDTH / 2;
            const cy = SVG_HEIGHT / 2;
            const oldScale = scale;
            const newScale = oldScale * 2;
            setOffsetX((prev) => cx - ((cx - prev) / oldScale) * newScale);
            setOffsetY((prev) => cy - ((cy - prev) / oldScale) * newScale);
            setScale(newScale);
          }}
        >
          +
        </text>

        <rect
          x={100}
          y={0}
          width={20}
          height={20}
          fill="none"
          stroke="black"
          strokeWidth={1}
        />
        <text
          x={110}
          y={10}
          dy=".35em"
          textAnchor="middle"
          style={{ cursor: "pointer", userSelect: "none" }}
          onClick={() => {
            // Zoom out centered at the SVG center
            const cx = SVG_WIDTH / 2;
            const cy = SVG_HEIGHT / 2;
            const oldScale = scale;
            const newScale = Math.max(MIN_SCALE, oldScale * 0.5);
            setOffsetX((prev) => cx - ((cx - prev) / oldScale) * newScale);
            setOffsetY((prev) => cy - ((cy - prev) / oldScale) * newScale);
            setScale(newScale);
          }}
        >
          -
        </text>
      </g>
    </svg>
  );
}
