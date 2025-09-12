import type { Root, RootContent } from "mdast";

export interface Edge {
  relationTypes: string[];
}
export interface Node {
  symbol: string;
  title: string;
  body: RootContent[];
}
export interface Graph {
  nodes: Map<string, Node>;
  edges: Map<string, Map<string, Edge>>;
}

function identifyOutwardEdges(body: RootContent[], wholeFileSource: string) {
  const bodySource = wholeFileSource.slice(
    body[0].position!.start.offset!,
    body.at(-1)!.position!.end.offset!
  );
  // For example: "(uses @node1, @node2, @node3)" means relationType == "uses", firstTarget == "@node1", otherTargets == ", @node2, @node3"
  const linkRegex =
    /\((?<relationType>[^)]+) (?<firstTarget>@\w+)(?<otherTargets>(,\s+@\w+)*)\)/g;

  const edges = new Map<string, Edge>();

  for (const match of bodySource.matchAll(linkRegex)) {
    const { relationType, firstTarget, otherTargets } = match.groups!;
    const targets = (firstTarget + otherTargets)
      .split(",")
      .map((s) => s.trim().slice("@".length));

    for (const target of targets) {
      // Create an edge for each target
      if (!edges.has(target)) {
        edges.set(target, { relationTypes: [] });
      }
      edges.get(target)!.relationTypes.push(relationType);
    }
  }

  return edges;
}

// Extracts a graph from a Markdown AST. Edges are directed and can contain metadata.
export default function extractConceptGraph(ast: Root, source: string): Graph {
  const graph: Graph = {
    nodes: new Map<string, Node>(),
    edges: new Map<string, Map<string, Edge>>(),
  };

  /*
  Identify nodes. Two ways to define a node:
		1) "<title> (id)" - e.g. "My Note (note-id-1234) is ..."
		2) As a paragraph under a header with the text "(@id)". e.g., "# My Note\n(@note-id-1234)\n..."
	In both cases, the declaration for a node occurs in 'paragraph' AST nodes.
	*/
  for (let i = 0; i < ast.children.length; i++) {
    const child = ast.children[i];
    if (child.type === "paragraph") {
      const text = source.slice(
        child.position!.start.offset!,
        child.position!.end.offset!
      );

      // Case 1.
      const case1 = text.match(/^(?<title>.*)\s+\(@(?<symbol>[^)]+)\)/);
      if (case1) {
        const { title, symbol } = case1.groups!;
        graph.nodes.set(symbol, { symbol, title, body: [child] });
        graph.edges.set(symbol, identifyOutwardEdges([child], source));
        console.log("Case 1", {
          title,
          symbol,
          edges: graph.edges.get(symbol),
        });
        continue;
      }

      // Case 2.
      const case2 = text.match(/^\(@(?<symbol>[^)]+)\)$/);
      if (case2 && i > 0) {
        const previousSibling = ast.children[i - 1];
        if (previousSibling.type === "heading") {
          const { symbol } = case2.groups!;
          // Remove leading #'s and whitespace.
          const titleOuter = source.slice(
            previousSibling.position!.start.offset!,
            previousSibling.position!.end.offset!
          ) as string;
          const title = titleOuter.trim().replace(/^#+\s*/, "");

          // Get nodes that constitute body. These will be any nodes that occur before the next header of the same or higher level.
          const body: RootContent[] = [previousSibling, child];
          for (const futureSibling of ast.children.slice(i + 1)) {
            if (
              futureSibling.type === "heading" &&
              futureSibling.depth <= previousSibling.depth
            ) {
              break;
            }
            body.push(futureSibling);
          }
          graph.nodes.set(symbol, { symbol, title, body });
          graph.edges.set(symbol, identifyOutwardEdges(body, source));
          console.log("Case 2", { title, symbol });
        }
      }
    }
  }

  return graph;
}
