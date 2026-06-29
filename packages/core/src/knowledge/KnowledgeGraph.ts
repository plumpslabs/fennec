import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, extname } from "node:path";
import { getLogger } from "../utils/logger.js";

export interface GraphNode {
  id: string;
  type: "file" | "function" | "class" | "route" | "api" | "database" | "component" | "page" | "service" | "dependency";
  name: string;
  filePath?: string;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: "imports" | "calls" | "extends" | "implements" | "defines" | "contains" | "routes_to" | "queries" | "renders" | "depends_on";
  metadata?: Record<string, unknown>;
}

export interface KnowledgeReport {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    files: number;
    functions: number;
    routes: number;
    components: number;
    databases: number;
  };
  insights: string[];
}

export class KnowledgeGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];
  private projectRoot: string;
  private scanned = false;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? process.cwd();
  }

  /**
   * Scan the project and build the knowledge graph.
   */
  async scan(): Promise<void> {
    const logger = getLogger();
    logger.info({ projectRoot: this.projectRoot }, "KnowledgeGraph: scanning project");

    this.nodes.clear();
    this.edges = [];
    this.scanned = false;

    // Walk through project files (max depth 5)
    await this.walkDirectory(this.projectRoot, 0, 5);

    this.scanned = true;
    logger.info(
      { nodes: this.nodes.size, edges: this.edges.length },
      "KnowledgeGraph: scan complete",
    );
  }

  /**
   * Get a node by ID.
   */
  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get all nodes.
   */
  getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get all edges.
   */
  getAllEdges(): GraphEdge[] {
    return [...this.edges];
  }

  /**
   * Find nodes by type.
   */
  findNodesByType(type: GraphNode["type"]): GraphNode[] {
    return this.getAllNodes().filter((n) => n.type === type);
  }

  /**
   * Find edges connected to a node.
   */
  findEdges(nodeId: string): GraphEdge[] {
    return this.edges.filter((e) => e.source === nodeId || e.target === nodeId);
  }

  /**
   * Get the full knowledge report.
   */
  getReport(): KnowledgeReport {
    const nodes = this.getAllNodes();
    const stats = {
      totalNodes: nodes.length,
      totalEdges: this.edges.length,
      files: this.findNodesByType("file").length,
      functions: this.findNodesByType("function").length,
      routes: this.findNodesByType("route").length,
      components: this.findNodesByType("component").length,
      databases: this.findNodesByType("database").length,
    };

    return {
      nodes,
      edges: this.getAllEdges(),
      stats,
      insights: this.generateInsights(),
    };
  }

  /**
   * Resolve a path in the knowledge graph by following edges from a starting point.
   */
  resolvePath(startNodeId: string, edgeType?: GraphEdge["type"]): GraphNode[] {
    const visited = new Set<string>();
    const path: GraphNode[] = [];
    const queue = [startNodeId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const node = this.nodes.get(currentId);
      if (node) {
        path.push(node);
      }

      for (const edge of this.edges) {
        if (edge.source === currentId && (!edgeType || edge.type === edgeType)) {
          if (!visited.has(edge.target)) {
            queue.push(edge.target);
          }
        }
        if (edge.target === currentId && (!edgeType || edge.type === edgeType)) {
          if (!visited.has(edge.source)) {
            queue.push(edge.source);
          }
        }
      }
    }

    return path;
  }

  /**
   * Get the likely root cause path by following edges from an error node.
   */
  findRootCausePath(errorNodeId: string): { path: GraphNode[]; explanation: string } {
    const path: GraphNode[] = [];
    const visited = new Set<string>();

    const dfs = (nodeId: string, depth: number): boolean => {
      if (depth > 10 || visited.has(nodeId)) return false;
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (!node) return false;

      path.push(node);

      // Look for probable root causes
      const incomingEdges = this.edges.filter((e) => e.target === nodeId);
      for (const edge of incomingEdges) {
        const sourceNode = this.nodes.get(edge.source);
        if (sourceNode && (sourceNode.type === "database" || sourceNode.type === "dependency")) {
          return true; // Found a leaf cause
        }
        if (dfs(edge.source, depth + 1)) {
          return true;
        }
      }

      path.pop();
      return false;
    };

    dfs(errorNodeId, 0);

    let explanation = "Root cause path not found";
    if (path.length >= 2) {
      const cause = path[path.length - 1]!;
      const affected = path[0]!;
      explanation = `${cause.name} (${cause.type}) likely causes issues in ${affected.name} (${affected.type})`;
    }

    return { path, explanation };
  }

  /**
   * Walk directory and extract knowledge.
   */
  private async walkDirectory(dir: string, depth: number, maxDepth: number): Promise<void> {
    if (depth > maxDepth) return;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relPath = relative(this.projectRoot, fullPath);

        // Skip hidden dirs and node_modules
        if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
          continue;
        }

        if (entry.isDirectory()) {
          await this.walkDirectory(fullPath, depth + 1, maxDepth);
        } else if (entry.isFile()) {
          this.analyzeFile(relPath, fullPath);
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  /**
   * Analyze a file and extract nodes and edges.
   */
  private analyzeFile(relPath: string, fullPath: string): void {
    const ext = extname(fullPath).toLowerCase();
    const fileNodeId = `file:${relPath}`;

    // Add file node
    this.addNode({
      id: fileNodeId,
      type: "file",
      name: relPath.split("/").pop() ?? relPath,
      filePath: relPath,
      metadata: { extension: ext, size: statSync(fullPath).size },
    });

    // Analyze based on extension
    if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
      this.analyzeSourceFile(relPath, fullPath, fileNodeId);
    } else if (ext === ".json") {
      this.analyzeJsonFile(relPath, fullPath, fileNodeId);
    } else if (ext === ".prisma" || ext === ".sql") {
      this.analyzeSchemaFile(relPath, fullPath, fileNodeId);
    } else if (ext === ".yaml" || ext === ".yml") {
      this.analyzeYamlFile(relPath, fullPath, fileNodeId);
    }
  }

  /**
   * Analyze a source file for functions, classes, components, etc.
   */
  private analyzeSourceFile(relPath: string, fullPath: string, fileNodeId: string): void {
    try {
      const content = readFileSync(fullPath, "utf-8");

      // Detect imports/requires (edges)
      const importRegex = /import\s+(?:\{[^}]*\}\s+from\s+)?['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1]!;
        if (importPath.startsWith(".")) {
          // Relative import — resolve to a file node
          const dir = relPath.split("/").slice(0, -1).join("/");
          const resolvedImport = resolve(join(dir, importPath));
          const relativeImport = relative(this.projectRoot, resolvedImport);
          // Normalize extension
          const normalizedImport = relativeImport.replace(/\.(ts|tsx|js|jsx)$/, "");
          const targetFileId = `file:${normalizedImport}.ts`;

          this.addEdge({
            source: fileNodeId,
            target: targetFileId,
            type: "imports",
          });
        } else {
          // External dependency
          const depId = `dependency:${importPath}`;
          this.addNode({
            id: depId,
            type: "dependency",
            name: importPath,
            metadata: { kind: "external" },
          });
          this.addEdge({ source: fileNodeId, target: depId, type: "depends_on" });
        }
      }

      // Detect function declarations
      const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
      while ((match = funcRegex.exec(content)) !== null) {
        const funcId = `function:${match[1]}`;
        this.addNode({
          id: funcId,
          type: "function",
          name: match[1]!,
          filePath: relPath,
          metadata: {},
        });
        this.addEdge({ source: fileNodeId, target: funcId, type: "contains" });
      }

      // Detect class declarations
      const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;
      while ((match = classRegex.exec(content)) !== null) {
        const classId = `class:${match[1]}`;
        this.addNode({
          id: classId,
          type: "class",
          name: match[1]!,
          filePath: relPath,
          metadata: {},
        });
        this.addEdge({ source: fileNodeId, target: classId, type: "contains" });
      }

      // Detect React components (function starting with uppercase)
      const componentRegex = /(?:export\s+)?(?:default\s+)?(?:function|const)\s+([A-Z]\w+)\s*(?:=|:)/g;
      while ((match = componentRegex.exec(content)) !== null) {
        const compId = `component:${match[1]}`;
        this.addNode({
          id: compId,
          type: "component",
          name: match[1]!,
          filePath: relPath,
          metadata: {},
        });
        this.addEdge({ source: fileNodeId, target: compId, type: "contains" });
      }

      // Detect API routes (Express/Next.js)
      const routeRegex = /(?:router|app)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
      while ((match = routeRegex.exec(content)) !== null) {
        const routeId = `route:${match[2]}`;
        this.addNode({
          id: routeId,
          type: "route",
          name: `${match[1]!.toUpperCase()} ${match[2]}`,
          filePath: relPath,
          metadata: { method: match[1]!, path: match[2] },
        });
        this.addEdge({ source: fileNodeId, target: routeId, type: "contains" });
      }

      // Detect page components (Next.js file-based routing)
      if (relPath.includes("/pages/") || relPath.includes("/app/")) {
        const routePath = relPath
          .replace(/^.*?\/pages\//, "/")
          .replace(/^.*?\/app\//, "/")
          .replace(/\/page\.(tsx|jsx)$/, "")
          .replace(/\/route\.(ts|js)$/, "")
          .replace(/\.(tsx|jsx)$/, "")
          .replace(/\/index$/, "/")
          .replace(/\[(\w+)\]/g, ":$1");

        const routeId = `route:${routePath}`;
        this.addNode({
          id: routeId,
          type: "route",
          name: routePath,
          filePath: relPath,
          metadata: { framework: "Next.js" },
        });
        this.addEdge({ source: fileNodeId, target: routeId, type: "defines" });
      }
    } catch {
      // Skip files we can't read
    }
  }

  private analyzeJsonFile(relPath: string, fullPath: string, fileNodeId: string): void {
    try {
      const content = readFileSync(fullPath, "utf-8");
      const data = JSON.parse(content);

      if (relPath === "package.json") {
        if (data.dependencies) {
          for (const dep of Object.keys(data.dependencies)) {
            const depId = `dependency:${dep}`;
            this.addNode({
              id: depId, type: "dependency", name: dep,
              metadata: { kind: "runtime", version: data.dependencies[dep] },
            });
            this.addEdge({ source: fileNodeId, target: depId, type: "depends_on" });
          }
        }
        if (data.devDependencies) {
          for (const dep of Object.keys(data.devDependencies)) {
            const depId = `dependency:${dep}`;
            if (!this.nodes.has(depId)) {
              this.addNode({
                id: depId, type: "dependency", name: dep,
                metadata: { kind: "dev", version: data.devDependencies[dep] },
              });
            }
          }
        }
      }
    } catch { /* ignore */ }
  }

  private analyzeSchemaFile(relPath: string, fullPath: string, fileNodeId: string): void {
    try {
      const content = readFileSync(fullPath, "utf-8");

      const dbId = `database:${relPath.replace(/\.[^.]+$/, "")}`;
      this.addNode({
        id: dbId,
        type: "database",
        name: relPath.split("/").pop() ?? relPath,
        filePath: relPath,
        metadata: { type: extname(fullPath) === ".prisma" ? "Prisma" : "SQL" },
      });
      this.addEdge({ source: fileNodeId, target: dbId, type: "defines" });

      // Detect model/table names
      const modelRegex = /(?:model|table|CREATE TABLE)\s+(\w+)/gi;
      let match: RegExpExecArray | null;
      while ((match = modelRegex.exec(content)) !== null) {
        const modelId = `database:${match[1]}`;
        this.addNode({
          id: modelId, type: "database", name: match[1]!,
          filePath: relPath, metadata: { kind: "table" },
        });
        this.addEdge({ source: dbId, target: modelId, type: "contains" });
      }
    } catch { /* ignore */ }
  }

  private analyzeYamlFile(relPath: string, fullPath: string, fileNodeId: string): void {
    try {
      const content = readFileSync(fullPath, "utf-8");

      // Detect Docker services
      if (relPath.includes("docker-compose")) {
        const serviceRegex = /^\s{2}(\w+):\s*$/gm;
        let match: RegExpExecArray | null;
        while ((match = serviceRegex.exec(content)) !== null) {
          const serviceId = `service:${match[1]}`;
          this.addNode({
            id: serviceId, type: "service", name: match[1]!,
            filePath: relPath, metadata: { kind: "docker" },
          });
          this.addEdge({ source: fileNodeId, target: serviceId, type: "contains" });
        }
      }
    } catch { /* ignore */ }
  }

  /**
   * Add a node if it doesn't already exist.
   */
  private addNode(node: GraphNode): void {
    if (!this.nodes.has(node.id)) {
      this.nodes.set(node.id, node);
    }
  }

  /**
   * Add an edge if it doesn't already exist.
   */
  private addEdge(edge: GraphEdge): void {
    const exists = this.edges.some(
      (e) => e.source === edge.source && e.target === edge.target && e.type === edge.type,
    );
    if (!exists) {
      this.edges.push(edge);
    }
  }

  /**
   * Generate insights from the knowledge graph.
   */
  private generateInsights(): string[] {
    const insights: string[] = [];
    const nodes = this.getAllNodes();
    const routes = this.findNodesByType("route");
    const components = this.findNodesByType("component");
    const databases = this.findNodesByType("database");
    const dependencies = this.findNodesByType("dependency");

    if (routes.length > 0) {
      insights.push(`Found ${routes.length} API routes/pages`);
    }
    if (components.length > 0) {
      insights.push(`Detected ${components.length} UI components`);
    }
    if (databases.length > 0) {
      insights.push(`Found ${databases.length} database models/tables`);
    }
    if (dependencies.length > 0) {
      insights.push(`Project uses ${dependencies.length} external dependencies`);
    }

    return insights;
  }
}
