import { useCallback, useEffect, useState } from "react";
import { Graph } from "../lib/extractConceptGraph";
import { createBaseGraph, createLayout } from "../lib/createLayout";

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

export default function GraphDisplay({ graph }: { graph: Graph }) {
  const [layout, setLayout] = useState<Record<string, [number, number]>>();
  const [displayedGraph, setDisplayedGraph] = useState<Graph>();

  // Compute layout of graph.
  const computeLayout = useCallback(
    (graph: Graph) =>
      createLayout({
        edges: createBaseGraph(graph),
        iters: 5000,
        exaggerationIters: 100,
        exaggerationScale: 4,
        l2: 1e-4,
        learningRate: 0.1,
        beta1: 0.9,
        beta2: 0.99,
        epsilon: 1e-6,
        method: "gravity",
        // method: "tsne",
      }),
    []
  );

  const refresh = useCallback(() => {
    // Only perform during initial render.
    setLayout(computeLayout(graph));
    setDisplayedGraph(graph);
  }, [graph]);

  // Automatically refresh only on initial render.
  useEffect(refresh, []);

  const minX = Math.min(...Object.values(layout ?? {}).map((p) => p[0]));
  const maxX = Math.max(...Object.values(layout ?? {}).map((p) => p[0]));
  const minY = Math.min(...Object.values(layout ?? {}).map((p) => p[1]));
  const maxY = Math.max(...Object.values(layout ?? {}).map((p) => p[1]));
  const width = 200;
  const height = 200;

  return (
    <div
      style={{ width: width + 50, height: height + 50, position: "relative" }}
    >
      {/* {JSON.stringify(layout)} */}
      {/* {displayedGraph && isGraphUpdated(displayedGraph, graph) && (
        <button onClick={refresh}>Refresh</button>
      )} */}
      {JSON.stringify({ minX, maxX, minY, maxY })}
      <button
        onClick={refresh}
        style={{ zIndex: 1, position: "absolute", top: 5, left: 5 }}
      >
        Refresh
      </button>
      {layout &&
        displayedGraph &&
        Array.from(displayedGraph.nodes.entries()).map(([symbol, node]) => (
          <div
            key={symbol}
            style={{
              position: "absolute",
              left: (width * (layout[symbol][0] - minX)) / (maxX - minX),
              top: (height * (layout[symbol][1] - minY)) / (maxY - minY),
              width: 80,
              height: 40,
              border: "1px solid black",
              padding: 2,
            }}
          >
            {node.title} (@{symbol})
          </div>
        ))}
    </div>
  );
}
