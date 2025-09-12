export interface GraphTsneOptions {
  edges: Record<string, string[]>;
  iters: number;
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

/** Used to create undirected graphs. */
export function ensureSymmetricEdges(edges: Record<string, string[]>) {
  const undirected: Record<string, Set<string>> = {};
  for (const [src, dsts] of Object.entries(edges)) {
    if (!(src in undirected)) {
      undirected[src] = new Set();
    }
    for (const dst of dsts) {
      if (!(dst in undirected)) {
        undirected[dst] = new Set();
      }
      undirected[src].add(dst);
      undirected[dst].add(src);
    }
  }
  const undirectedObj: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(undirected)) {
    undirectedObj[k] = Array.from(v);
  }
  return undirectedObj;
}

export function graphTnse(
  opts: GraphTsneOptions
): Record<string, [number, number]> {
  // Adaptation for graphs: p_{ij} = (1/degree(i) + 1/degree(j)) / 2n.
  // Also adapting the optimization to use AdamW instead of momentum.
  // Assumes undirected edges.
  const nodes = Object.keys(opts.edges);
  const degrees = nodes.map((n) => opts.edges[n].length);
  const n = nodes.length;
  // Positions.
  const y: Record<string, [number, number]> = {};
  // Adam moments.
  const m: Record<string, [number, number]> = {};
  const v: Record<string, [number, number]> = {};
  // Initialize positions and moments.
  for (const node of nodes) {
    y[node] = [1e-4 * randn(), 1e-4 * randn()];
    m[node] = [0, 0];
    v[node] = [0, 0];
  }
  // Perform iterative optimization
  for (let iter = 0; iter < opts.iters; iter++) {
    const g: Record<string, [number, number]> = {};
    let q_ij_sum = 0;
    for (const node of nodes) {
      // Compute normalization term.
      for (const other of opts.edges[node]) {
        const delta_y = [y[node][0] - y[other][0], y[node][1] - y[other][1]];
        const dist_y_sq = delta_y[0] * delta_y[0] + delta_y[1] * delta_y[1];
        const q_ij_unnormalized = 1 / (1 + dist_y_sq);
        q_ij_sum += q_ij_unnormalized;
      }
      // Perform update after normalization.
      for (const other of opts.edges[node]) {
        const p_ij = (1 / degrees[node] + 1 / degrees[other]) / (2 * n);
        const delta_y = [y[node][0] - y[other][0], y[node][1] - y[other][1]];
        const dist_y_sq = delta_y[0] * delta_y[0] + delta_y[1] * delta_y[1];
        const q_ij_unnormalized = 1 / (1 + dist_y_sq);
        q_ij_sum += q_ij_unnormalized;

        const kl_term =
          p_ij * (iter < opts.exaggerationIters ? opts.exaggerationScale : 1) -
          q_ij_unnormalized / q_ij_sum;
        const direction = delta_y;
        const scale = 4 * (1 / (1 + dist_y_sq)) * kl_term;
        g[node][0] += scale * direction[0];
        g[node][1] += scale * direction[1];
      }
      // Perform update step. Follows Algorithm 1 of Adam paper.
      for (const node of nodes) {
        const { beta1, beta2 } = opts;
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
      }
    }
  }
  return y;
}
