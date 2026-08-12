const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export class CausalDependencyGraph {
  constructor({ nodes = [], edges = [] } = {}) {
    this.nodes = new Map();
    this.edges = [];
    this.incoming = new Map();
    this.outgoing = new Map();

    for (const node of nodes) {
      if (!node?.id) throw new Error("Every causal node requires an id.");
      if (this.nodes.has(node.id)) throw new Error(`Duplicate causal node: ${node.id}`);
      const normalized = Object.freeze({
        ...node,
        localUncertainty: clamp01(node.localUncertainty)
      });
      this.nodes.set(node.id, normalized);
      this.incoming.set(node.id, []);
      this.outgoing.set(node.id, []);
    }

    for (const edge of edges) {
      if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
        throw new Error(`Unknown causal edge endpoint: ${edge.from} -> ${edge.to}`);
      }
      const normalized = Object.freeze({
        ...edge,
        strength: clamp01(edge.strength)
      });
      this.edges.push(normalized);
      this.incoming.get(edge.to).push(normalized);
      this.outgoing.get(edge.from).push(normalized);
    }
  }

  withLocalUncertainty(id, localUncertainty) {
    if (!this.nodes.has(id)) throw new Error(`Unknown causal node: ${id}`);
    return new CausalDependencyGraph({
      nodes: [...this.nodes.values()].map((node) =>
        node.id === id ? { ...node, localUncertainty: clamp01(localUncertainty) } : node
      ),
      edges: this.edges
    });
  }

  propagate({ maxIterations = 80, tolerance = 1e-8, damping = 0.72 } = {}) {
    const boundedDamping = clamp01(damping);
    let totals = new Map(
      [...this.nodes.values()].map((node) => [node.id, node.localUncertainty])
    );
    let iterations = 0;
    let converged = false;

    for (iterations = 1; iterations <= maxIterations; iterations++) {
      const next = new Map();
      let maxDelta = 0;

      for (const node of this.nodes.values()) {
        let noImportedUncertainty = 1;
        for (const edge of this.incoming.get(node.id)) {
          const sourceTotal = totals.get(edge.from) ?? 0;
          noImportedUncertainty *= 1 - clamp01(sourceTotal * edge.strength);
        }

        const imported = 1 - noImportedUncertainty;
        const total = clamp01(
          node.localUncertainty +
          (1 - node.localUncertainty) * imported * boundedDamping
        );
        next.set(node.id, total);
        maxDelta = Math.max(maxDelta, Math.abs(total - (totals.get(node.id) ?? 0)));
      }

      totals = next;
      if (maxDelta <= tolerance) {
        converged = true;
        break;
      }
    }

    const result = {};
    for (const node of this.nodes.values()) {
      const total = totals.get(node.id) ?? node.localUncertainty;
      result[node.id] = Object.freeze({
        localUncertainty: node.localUncertainty,
        propagatedUncertainty: Math.max(0, total - node.localUncertainty),
        totalUncertainty: total,
        evidence: node.evidence ?? "policy prior"
      });
    }

    return Object.freeze({
      converged,
      iterations: Math.min(iterations, maxIterations),
      nodes: Object.freeze(result)
    });
  }

  influenceFrom(id, { maxDepth = 8 } = {}) {
    if (!this.nodes.has(id)) throw new Error(`Unknown causal node: ${id}`);
    const best = new Map([[id, 1]]);
    const queue = [{ id, weight: 1, depth: 0 }];

    while (queue.length) {
      const current = queue.shift();
      if (current.depth >= maxDepth) continue;
      for (const edge of this.outgoing.get(current.id)) {
        const weight = current.weight * edge.strength;
        if (weight <= (best.get(edge.to) ?? 0) + 1e-12) continue;
        best.set(edge.to, weight);
        queue.push({ id: edge.to, weight, depth: current.depth + 1 });
      }
    }

    best.delete(id);
    return Object.freeze({
      systemsAffected: best.size,
      weightedReach: [...best.values()].reduce((sum, value) => sum + value, 0),
      targets: Object.freeze(Object.fromEntries(best))
    });
  }

  researchLeverage(id, { reductionFraction = 0.35, propagation = {} } = {}) {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Unknown causal node: ${id}`);
    const baseline = this.propagate(propagation);
    const reducedGraph = this.withLocalUncertainty(
      id,
      node.localUncertainty * (1 - clamp01(reductionFraction))
    );
    const intervention = reducedGraph.propagate(propagation);

    let downstreamReduction = 0;
    const reductions = {};
    for (const targetId of this.nodes.keys()) {
      if (targetId === id) continue;
      const reduction = Math.max(
        0,
        baseline.nodes[targetId].totalUncertainty - intervention.nodes[targetId].totalUncertainty
      );
      reductions[targetId] = reduction;
      downstreamReduction += reduction;
    }

    return Object.freeze({
      node: id,
      reductionFraction: clamp01(reductionFraction),
      downstreamReduction,
      reductions: Object.freeze(reductions)
    });
  }

  analyze(options = {}) {
    const propagation = this.propagate(options.propagation);
    const nodes = {};
    for (const id of this.nodes.keys()) {
      nodes[id] = Object.freeze({
        ...propagation.nodes[id],
        reach: this.influenceFrom(id, options.reach),
        researchLeverage: this.researchLeverage(id, {
          reductionFraction: options.reductionFraction ?? 0.35,
          propagation: options.propagation
        }).downstreamReduction
      });
    }
    return Object.freeze({
      converged: propagation.converged,
      iterations: propagation.iterations,
      nodes: Object.freeze(nodes)
    });
  }
}
