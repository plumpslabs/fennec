import { describe, it, expect, beforeEach } from "vitest";
import { KnowledgeGraph } from "../../../src/knowledge/KnowledgeGraph.js";

describe("KnowledgeGraph", () => {
  let kg: KnowledgeGraph;

  beforeEach(() => {
    kg = new KnowledgeGraph("/tmp/test-project");
  });

  describe("node management", () => {
    it("should return empty state before scan", () => {
      expect(kg.getAllNodes()).toHaveLength(0);
      expect(kg.getAllEdges()).toHaveLength(0);
    });

    it("should find nodes by type", () => {
      // Nodes are populated via scan(), which reads files
      // Before scan, all type queries return empty
      expect(kg.findNodesByType("file")).toHaveLength(0);
      expect(kg.findNodesByType("function")).toHaveLength(0);
    });

    it("should return undefined for unknown node", () => {
      expect(kg.getNode("nonexistent")).toBeUndefined();
    });

    it("should return empty edges for unknown node", () => {
      expect(kg.findEdges("nonexistent")).toHaveLength(0);
    });
  });

  describe("getReport", () => {
    it("should return a report with empty stats before scan", () => {
      const report = kg.getReport();
      expect(report.nodes).toHaveLength(0);
      expect(report.edges).toHaveLength(0);
      expect(report.stats.totalNodes).toBe(0);
      expect(report.stats.totalEdges).toBe(0);
      expect(report.insights).toEqual([]);
    });
  });

  describe("resolvePath", () => {
    it("should return empty path for unknown node", () => {
      const path = kg.resolvePath("nonexistent");
      expect(path).toHaveLength(0);
    });

    it("should filter by edge type", () => {
      const path = kg.resolvePath("nonexistent", "imports");
      expect(path).toHaveLength(0);
    });
  });

  describe("findRootCausePath", () => {
    it("should return not-found explanation for unknown node", () => {
      const result = kg.findRootCausePath("nonexistent");
      expect(result.path).toHaveLength(0);
      expect(result.explanation).toBe("Root cause path not found");
    });
  });

  describe("scan", () => {
    it("should handle non-existent project root gracefully", async () => {
      const kg2 = new KnowledgeGraph("/nonexistent/path/12345");
      await kg2.scan();
      expect(kg2.getAllNodes()).toHaveLength(0);
      expect(kg2.getAllEdges()).toHaveLength(0);
    });

    it("should scan the Fennec project itself and find files", async () => {
      const realKg = new KnowledgeGraph(process.cwd());
      await realKg.scan();
      const report = realKg.getReport();
      expect(report.stats.totalNodes).toBeGreaterThan(0);
      expect(report.stats.files).toBeGreaterThan(0);
    });
  });
});
