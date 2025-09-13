import { Graph } from "./extractConceptGraph";

export interface GraphLayoutOptions {
  edges: Record<string, Set<string>>;
  iters: number;
  method: "tsne" | "gravity";
  exaggerationScale: number;
  exaggerationIters: number;
  l2: number;
  learningRate: number;
  beta1: number;
  beta2: number;
  epsilon: number;
}

function randn() {
  // Box-Muller transform, because JavaScript doesn't have a built-in normal distribution.
  // https://stackoverflow.com/questions/25582882/javascript-math-random-normal-distribution-gaussian-bell-curve
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z;
}

/** Creates a symmetric graph with no other metadata for t-SNE. */
export function createBaseGraph(graph: Graph) {
  const edges: Record<string, Set<string>> = {};
  for (const [src, dstMap] of graph.edges.entries()) {
    if (!(src in edges)) {
      edges[src] = new Set();
    }
    for (const dst of dstMap.keys()) {
      if (!(dst in edges)) {
        edges[dst] = new Set();
      }
      edges[src].add(dst);
      edges[dst].add(src);
    }
  }
  return edges;
}

export function createLayout(
  opts: GraphLayoutOptions
): Record<string, [number, number]> {
  // Adaptation for graphs: p_{ij} = (1/degree(i) + 1/degree(j)) / 2n.
  // Also adapting the optimization to use AdamW instead of momentum.
  // Assumes undirected edges.
  const nodes = Object.keys(opts.edges);
  const degrees = new Map<string, number>();
  for (const node of nodes) {
    degrees.set(node, opts.edges[node].size);
  }

  const n = nodes.length;
  // Positions.
  const y: Record<string, [number, number]> = {};
  // Adam moments.
  const m: Record<string, [number, number]> = {};
  const v: Record<string, [number, number]> = {};
  // Initialize positions and moments.
  for (const node of nodes) {
    y[node] = [3 * randn(), 3 * randn()];
    m[node] = [0, 0];
    v[node] = [0, 0];
  }
  // Perform iterative optimization
  for (let iter = 0; iter < opts.iters; iter++) {
    const g: Record<string, [number, number]> = {};
    let loss = 0;
    let lossPerNode = {};
    let q_ij_sum = 0;
    for (const node of nodes) {
      g[node] = [0, 0];

      if (opts.method === "tsne") {
        // Compute normalization term.
        for (const other of opts.edges[node]) {
          const delta_y = [y[node][0] - y[other][0], y[node][1] - y[other][1]];
          const dist_y_sq = delta_y[0] * delta_y[0] + delta_y[1] * delta_y[1];
          const q_ij_unnormalized = 1 / (1 + dist_y_sq);
          q_ij_sum += q_ij_unnormalized;
        }
        // Perform update after normalization.
        for (const other of opts.edges[node]) {
          const p_ij =
            (1 / degrees.get(node)! + 1 / degrees.get(other)!) / (2 * n);
          const delta_y = [y[node][0] - y[other][0], y[node][1] - y[other][1]];
          const dist_y_sq = delta_y[0] * delta_y[0] + delta_y[1] * delta_y[1];
          const q_ij_unnormalized = 1 / (1 + dist_y_sq);
          q_ij_sum += q_ij_unnormalized;

          const kl_term =
            p_ij *
              (iter < opts.exaggerationIters ? opts.exaggerationScale : 1) -
            q_ij_unnormalized / q_ij_sum;
          const direction = delta_y;
          const scale = 4 * (1 / (1 + dist_y_sq)) * kl_term;
          g[node][0] += scale * direction[0];
          g[node][1] += scale * direction[1];
          if (isNaN(scale)) {
            console.warn("NaN scale", {
              p_ij,
              q_ij_unnormalized,
              q_ij_sum,
              dist_y_sq,
              n,
              degreeSelf: degrees[node],
              degreeOther: degrees[other],
            });
          }
        }
      } else {
        // Move nodes closer together if connected, and further apart if not.
        for (const other of nodes) {
          if (other === node) {
            continue;
          }
          // Use Lennard-Jones potential so that nodes don't allow each other to get too close.
          // Repulsive potential 1/(r^n) and attractive potential -1/(r^m) for m < n.
          const m = 2;
          const n = 4;
          const delta_y = [y[other][0] - y[node][0], y[other][1] - y[node][1]];
          const r = Math.sqrt(
            delta_y[0] * delta_y[0] + delta_y[1] * delta_y[1]
          );

          // Gradient of energy w.r.t. position is force. dy/dr = delta_y.
          const dRepulsive_dr = -n * Math.pow(1 / r, n + 1);
          const dAttractive_dr = m * Math.pow(1 / r, m + 1);
          const repulsivePotential = Math.pow(1 / r, n);
          const attractivePotential = -Math.pow(1 / r, m);
          const attraction = opts.edges[node].has(other) ? 1 : -1;

          g[node][0] -= delta_y[0] * (attraction * dAttractive_dr); //  + dRepulsive_dr);
          g[node][1] -= delta_y[1] * (attraction * dAttractive_dr); //  + dRepulsive_dr);

          const edgeLoss =
            repulsivePotential + attraction * attractivePotential;

          loss += edgeLoss;
          lossPerNode[node] = lossPerNode[node] || 0;
          lossPerNode[node] += edgeLoss;
        }
      }
    }
    // Perform update step. Follows Algorithm 1 of Adam paper.
    for (const node of nodes) {
      const { beta1, beta2 } = opts;
      if (!g[node]) {
        console.warn("No gradient for node", node);
      }
      if (!m[node]) {
        console.warn("No moment for node", node);
      }
      if (!v[node]) {
        console.warn("No velocity for node", node);
      }
      m[node][0] = beta1 * m[node][0] + (1 - beta1) * g[node][0];
      m[node][1] = beta1 * m[node][1] + (1 - beta1) * g[node][1];
      v[node][0] = beta2 * v[node][0] + (1 - beta2) * g[node][0] * g[node][0];
      v[node][1] = beta2 * v[node][1] + (1 - beta2) * g[node][1] * g[node][1];
      const mHat = [
        m[node][0] / (1 - Math.pow(beta1, iter + 1)),
        m[node][1] / (1 - Math.pow(beta1, iter + 1)),
      ];
      const vHat = [
        v[node][0] / (1 - Math.pow(beta2, iter + 1)),
        v[node][1] / (1 - Math.pow(beta2, iter + 1)),
      ];
      y[node][0] -=
        // Cost gradient.
        (opts.learningRate * mHat[0]) / (Math.sqrt(vHat[0]) + opts.epsilon) +
        // L2 regularization.
        opts.learningRate * opts.l2 * y[node][0];
      y[node][1] -=
        // Cost gradient.
        (opts.learningRate * mHat[1]) / (Math.sqrt(vHat[1]) + opts.epsilon) +
        // L2 regularization.
        opts.learningRate * opts.l2 * y[node][1];

      // Print the gradient magnitude.
      if (iter === opts.iters - 1) {
        const gradMag = Math.sqrt(
          g[node][0] * g[node][0] + g[node][1] * g[node][1]
        );
        console.log("Final gradient magnitude for node", node, gradMag);
      }
      console.log(loss, lossPerNode);
    }
  }
  return y;
}

/*
Test (@1)

Test (@2) (uses @1)

Test (@3) (uses @1, @2)

Test (@4) (uses @1)
*/
