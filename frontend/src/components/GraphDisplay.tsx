import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  Simulation,
  SimulationLinkDatum,
  SimulationNodeDatum,
} from "d3-force";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createBaseGraph, createLayout } from "../lib/createLayout";
import { Graph } from "../lib/extractConceptGraph";

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
  return stableStringify(displayedGraph) !== stableStringify(currentGraph);
}

export interface CustomNodeDatum extends SimulationNodeDatum {
  id: string;
}

export default function GraphDisplay({ graph }: { graph: Graph }) {
  const [simulation, setSimulation] =
    useState<Simulation<CustomNodeDatum, SimulationLinkDatum<CustomNodeDatum>>>(
      forceSimulation
    );
  const [layout, setLayout] = useState<Record<string, [number, number]>>();
  const displayedGraphRef = useRef<Graph>();

  useEffect(() => {
    if (
      !displayedGraphRef.current ||
      isGraphUpdated(displayedGraphRef.current, graph)
    ) {
      console.log("Graph updated, creating new layout");

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
          Array.from(dstMap.keys()).map((dst) => ({
            source: indices[src],
            target: indices[dst],
          }))
        )
        .flat();

      simulation.force("charge", forceManyBody());
      simulation.force("center", forceCenter());
      simulation.force("link", forceLink(links));
      simulation.alpha(1);
      simulation.restart();
    }
  }, [graph, simulation]);

  useEffect(() => {
    simulation.on("tick", () => {
      const newLayout: Record<string, [number, number]> = {};
      simulation.nodes().forEach((node) => {
        if (node.id && node.x !== undefined && node.y !== undefined) {
          newLayout[node.id] = [node.x, node.y];
        }
      });
      setLayout(newLayout);
    });
  }, []);

  const minX = Math.min(...Object.values(layout ?? {}).map((p) => p[0]));
  const maxX = Math.max(...Object.values(layout ?? {}).map((p) => p[0]));
  const minY = Math.min(...Object.values(layout ?? {}).map((p) => p[1]));
  const maxY = Math.max(...Object.values(layout ?? {}).map((p) => p[1]));
  const width = 200;
  const height = 200;
  const nodeWidth = 80;
  const nodeHeight = 40;
  const padding = 60;
  const effectiveCenters = {};
  for (const node of simulation.nodes()) {
    if (node.id && layout && layout[node.id]) {
      effectiveCenters[node.id] = [
        (width * (layout[node.id][0] - minX)) / (maxX - minX) +
          padding +
          nodeWidth / 2,
        (height * (layout[node.id][1] - minY)) / (maxY - minY) +
          padding +
          nodeHeight / 2,
      ];
    }
  }

  const svgWidth = width + 2 * padding + nodeWidth;
  const svgHeight = height + 2 * padding + nodeHeight;

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      style={{ border: "1px solid black" }}
    >
      {/* https://stackoverflow.com/questions/15500894/background-color-of-text-in-svg */}
      <defs>
        <filter x="0" y="0" width="1" height="1" id="solid">
          <feFlood flood-color="white" result="bg" />
          <feMerge>
            <feMergeNode in="bg" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {layout &&
        Array.from(graph.edges.entries()).map(([src, dstMap]) =>
          Array.from(dstMap.keys()).map((dst) => {
            if (!layout[src] || !layout[dst]) {
              return null;
            }

            return (
              <Fragment key={`${src}-${dst}`}>
                <line
                  x1={effectiveCenters[src][0]}
                  y1={effectiveCenters[src][1]}
                  x2={effectiveCenters[dst][0]}
                  y2={effectiveCenters[dst][1]}
                  stroke="black"
                />
                {/* Characterize the relationship between the nodes */}
                <text
                  filter="url(#solid)"
                  x={(effectiveCenters[src][0] + effectiveCenters[dst][0]) / 2}
                  y={(effectiveCenters[src][1] + effectiveCenters[dst][1]) / 2}
                  dy=".35em"
                  textAnchor="middle"
                >
                  {graph.edges.get(src)?.get(dst)?.relationTypes.join(", ")}
                </text>
              </Fragment>
            );
          })
        )}

      {layout &&
        Array.from(graph.nodes.entries()).map(
          ([symbol, node]) =>
            layout[symbol] && (
              <g
                key={symbol}
                transform={`translate(${
                  effectiveCenters[symbol][0] - nodeWidth / 2
                }, ${effectiveCenters[symbol][1] - nodeHeight / 2})`}
              >
                <rect
                  x={0}
                  y={0}
                  width={nodeWidth}
                  height={nodeHeight}
                  stroke="black"
                  fill="white"
                />
                <text x={4} y={20} dy=".35em">
                  {node.title} (@{symbol})
                </text>
              </g>
            )
        )}
    </svg>
  );
}
