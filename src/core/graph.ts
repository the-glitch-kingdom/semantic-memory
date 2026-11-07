import Graph from "graphology";
import { bfsFromNode } from "graphology-traversal";
import type { IndexedDocument, GraphNode, GraphStats, EdgeType } from "./types.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { minimatch } from "minimatch";

/** Edges that mean "this note points at that note"; tag edges only mean "same topic" and are opt-in. */
export const LINK_EDGE_TYPES: EdgeType[] = ["link", "wikilink", "related"];
export const DEFAULT_EXCLUDE_HUBS = ["**/INDEX.md", "**/REGISTRY.md"];

export interface GraphOptions {
  /** generated hub files that link to everything: not graph nodes */
  excludeHubs?: string[];
  /** archived copies lose a same-named wikilink to the live doc */
  isArchived?: (path: string) => boolean;
}

/** `graph.exclude_hubs` from vault.schema.yml; missing file, block or parse error gives the default. */
export function loadExcludeHubs(vaultPath: string): string[] {
  try {
    const parsed = parseYaml(readFileSync(join(vaultPath, "vault.schema.yml"), "utf-8")) as { graph?: { exclude_hubs?: unknown } } | null;
    const g = parsed?.graph?.exclude_hubs;
    return Array.isArray(g) ? g.filter((x): x is string => typeof x === "string") : DEFAULT_EXCLUDE_HUBS;
  } catch {
    return DEFAULT_EXCLUDE_HUBS;
  }
}

/**
 * Tags shared by more than this many docs are too generic to be meaningful
 * graph edges (e.g. "api", "testing"). Only specific/rare tags create edges.
 * Docs without frontmatter are unaffected — their inline #tags still participate
 * but only if those tags are specific enough to pass this threshold.
 */
const TAG_EDGE_MAX_DOCS = 15;

export class GraphBuilder {
  private graph: Graph;

  constructor(private opts: GraphOptions = {}) {
    this.graph = new Graph({ type: "directed", multi: false });
  }

  buildFromDocuments(allDocuments: IndexedDocument[]): void {
    this.graph.clear();
    const hubs = this.opts.excludeHubs ?? DEFAULT_EXCLUDE_HUBS;
    const documents = allDocuments.filter((d) => !hubs.some((g) => minimatch(d.path, g, { dot: true })));

    // Add nodes — store optional metadata fields when present
    for (const doc of documents) {
      this.graph.addNode(doc.path, {
        title: doc.title,
        tags: doc.tags,
        ...(doc.status !== undefined && { status: doc.status }),
        ...(doc.loadPriority !== undefined && { loadPriority: doc.loadPriority }),
      });
    }

    const pathLookup = new Map<string, string>();
    // live docs last, so they win a name shared with an archived copy
    const archived = this.opts.isArchived ?? (() => false);
    for (const doc of [...documents.filter((d) => archived(d.path)), ...documents.filter((d) => !archived(d.path))]) {
      const nameNoExt = doc.path.replace(/\.md$/, "");
      const basename = nameNoExt.split("/").pop()!;
      pathLookup.set(basename.toLowerCase(), doc.path);
      pathLookup.set(nameNoExt.toLowerCase(), doc.path);
    }

    // Add markdown-link edges (weight 1.0); targets are already vault-relative paths
    for (const doc of documents) {
      for (const target of doc.mdLinks ?? []) {
        if (target !== doc.path && this.graph.hasNode(target) && !this.graph.hasEdge(doc.path, target)) {
          this.graph.addEdge(doc.path, target, { type: "link", weight: 1.0 });
        }
      }
    }

    // Add wikilink edges (weight 1.0)
    for (const doc of documents) {
      for (const link of doc.wikilinks) {
        const target = pathLookup.get(link.toLowerCase());
        if (target && target !== doc.path && !this.graph.hasEdge(doc.path, target)) {
          this.graph.addEdge(doc.path, target, { type: "wikilink", weight: 1.0 });
        }
      }
    }

    // Add related_docs edges (weight 1.0) — only present when frontmatter has related_docs
    // Falls back gracefully: docs without this field are simply skipped
    for (const doc of documents) {
      if (!doc.relatedDocs?.length) continue;
      for (const ref of doc.relatedDocs) {
        // Try full normalized path first, then basename — same strategy as wikilinks
        const normalized = ref.replace(/\.md$/, "").toLowerCase();
        const base = normalized.split("/").pop()!;
        const target = pathLookup.get(normalized) ?? pathLookup.get(base);
        if (target && target !== doc.path && !this.graph.hasEdge(doc.path, target)) {
          this.graph.addEdge(doc.path, target, { type: "related", weight: 1.0 });
        }
      }
    }

    // Add tag-based edges (weight 0.5) — capped at TAG_EDGE_MAX_DOCS per tag.
    // Generic tags shared by many docs (e.g. "api", "testing") create noise;
    // only specific tags (e.g. "qdrant", "celery") create meaningful connections.
    const tagToNotes = new Map<string, string[]>();
    for (const doc of documents) {
      for (const tag of doc.tags) {
        const notes = tagToNotes.get(tag) ?? [];
        notes.push(doc.path);
        tagToNotes.set(tag, notes);
      }
    }

    for (const [, notes] of tagToNotes) {
      if (notes.length >= TAG_EDGE_MAX_DOCS) continue; // too generic — skip
      for (let i = 0; i < notes.length; i++) {
        for (let j = i + 1; j < notes.length; j++) {
          if (!this.graph.hasEdge(notes[i], notes[j])) {
            this.graph.addEdge(notes[i], notes[j], { type: "tag", weight: 0.5 });
          }
          if (!this.graph.hasEdge(notes[j], notes[i])) {
            this.graph.addEdge(notes[j], notes[i], { type: "tag", weight: 0.5 });
          }
        }
      }
    }
  }

  backlinks(notePath: string, types: EdgeType[] = LINK_EDGE_TYPES): GraphNode[] {
    if (!this.graph.hasNode(notePath)) return [];
    return this.graph
      .filterInEdges(notePath, (_e, a) => types.includes(a.type))
      .map((e) => this.nodeToGraphNode(this.graph.source(e)));
  }

  forwardlinks(notePath: string, types: EdgeType[] = LINK_EDGE_TYPES): GraphNode[] {
    if (!this.graph.hasNode(notePath)) return [];
    return this.graph
      .filterOutEdges(notePath, (_e, a) => types.includes(a.type))
      .map((e) => this.nodeToGraphNode(this.graph.target(e)));
  }

  /** Shortest directed path over the given edge types (breadth-first). */
  findPath(from: string, to: string, types: EdgeType[] = LINK_EDGE_TYPES): string[] | null {
    if (!this.graph.hasNode(from) || !this.graph.hasNode(to)) return null;
    const prev = new Map<string, string | null>([[from, null]]);
    for (let queue = [from]; queue.length; ) {
      const next: string[] = [];
      for (const n of queue) {
        if (n === to) {
          const path: string[] = [];
          for (let p: string | null = to; p !== null; p = prev.get(p)!) path.unshift(p);
          return path;
        }
        for (const e of this.graph.filterOutEdges(n, (_e, a) => types.includes(a.type))) {
          const t = this.graph.target(e);
          if (!prev.has(t)) {
            prev.set(t, n);
            next.push(t);
          }
        }
      }
      queue = next;
    }
    return null;
  }

  searchGraph(concept: string, maxDepth = 2, limit = 20): GraphNode[] {
    const lc = concept.toLowerCase();

    const directMatches = new Set<string>(
      this.graph.nodes().filter((n) => {
        const attrs = this.graph.getNodeAttributes(n);
        const title = typeof attrs.title === "string" ? attrs.title : String(attrs.title ?? "");
        return (
          n.toLowerCase().includes(lc) ||
          title.toLowerCase().includes(lc) ||
          (attrs.tags as string[] | undefined)?.some((t) => t.toLowerCase().includes(lc))
        );
      })
    );

    const visited = new Set<string>();
    for (const start of directMatches) {
      bfsFromNode(this.graph, start, (_node, _attr, depth) => {
        if (visited.size >= limit * 3) return true; // gather 3x limit before ranking
        visited.add(_node);
        return depth >= maxDepth;
      });
    }

    // Sort: direct matches first, then by loadPriority desc, then by degree desc
    // deprecated/archived nodes sort to the end
    const ranked = [...visited].sort((a, b) => {
      const aAttrs = this.graph.getNodeAttributes(a);
      const bAttrs = this.graph.getNodeAttributes(b);
      const aDeprecated = aAttrs.status === "deprecated" || aAttrs.status === "archived" ? 1 : 0;
      const bDeprecated = bAttrs.status === "deprecated" || bAttrs.status === "archived" ? 1 : 0;
      if (aDeprecated !== bDeprecated) return aDeprecated - bDeprecated;
      const aDirect = directMatches.has(a) ? 0 : 1;
      const bDirect = directMatches.has(b) ? 0 : 1;
      if (aDirect !== bDirect) return aDirect - bDirect;
      const aPriority = (aAttrs.loadPriority as number | undefined) ?? 5;
      const bPriority = (bAttrs.loadPriority as number | undefined) ?? 5;
      if (aPriority !== bPriority) return bPriority - aPriority;
      return this.graph.degree(b) - this.graph.degree(a);
    });

    return ranked.slice(0, limit).map((n) => this.nodeToGraphNode(n));
  }

  statistics(): GraphStats {
    const nodes = this.graph.order;
    const edges = this.graph.size;
    const orphans = this.graph.nodes().filter(
      (n) => this.graph.degree(n) === 0
    );

    const connections = this.graph.nodes().map((n) => ({
      path: n,
      connections: this.graph.degree(n),
    }));
    connections.sort((a, b) => b.connections - a.connections);

    const maxPossibleEdges = nodes * (nodes - 1);
    const density = maxPossibleEdges > 0 ? edges / maxPossibleEdges : 0;

    return {
      totalNodes: nodes,
      totalEdges: edges,
      orphanCount: orphans.length,
      mostConnected: connections.slice(0, 10),
      density,
    };
  }

  private nodeToGraphNode(nodePath: string): GraphNode {
    const attrs = this.graph.getNodeAttributes(nodePath);
    return {
      path: nodePath,
      title: typeof attrs.title === "string" ? attrs.title : nodePath,
      tags: (attrs.tags as string[]) || [],
      linkCount: this.graph.outDegree(nodePath),
      backlinkCount: this.graph.inDegree(nodePath),
      ...(attrs.loadPriority !== undefined && { loadPriority: attrs.loadPriority as number }),
      ...(attrs.status !== undefined && { status: attrs.status as string }),
    };
  }

  async save(indexPath: string): Promise<void> {
    const data = this.graph.export();
    await writeFile(join(indexPath, "graph.json"), JSON.stringify(data));
  }

  async load(indexPath: string): Promise<boolean> {
    const filePath = join(indexPath, "graph.json");
    if (!existsSync(filePath)) return false;

    const raw = await readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    this.graph.import(data);
    return true;
  }

  getGraph(): Graph {
    return this.graph;
  }
}
