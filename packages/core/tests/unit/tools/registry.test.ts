import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ToolRegistry, createTool } from "../../../src/tools/_registry.js";

describe("ToolRegistry", () => {
  const registry = new ToolRegistry();

  const testTool = createTool({
    name: "test_hello",
    description: "A test tool",
    inputSchema: z.object({
      name: z.string().describe("Name to greet"),
    }),
    handler: async (input) => {
      return { greeting: `Hello, ${input.name}!` };
    },
  });

  const emptyTool = createTool({
    name: "test_empty",
    description: "An empty tool",
    inputSchema: z.object({}),
    handler: async () => {
      return { ok: true };
    },
  });

  it("should register a new tool", () => {
    registry.register(testTool);
    expect(registry.has("test_hello")).toBe(true);
  });

  it("should throw when registering duplicate tool", () => {
    expect(() => registry.register(testTool)).toThrow("already registered");
  });

  it("should get a registered tool by name", () => {
    const tool = registry.get("test_hello");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("test_hello");
  });

  it("should return undefined for unregistered tool", () => {
    const tool = registry.get("nonexistent");
    expect(tool).toBeUndefined();
  });

  it("should list all registered tools", () => {
    registry.register(emptyTool);
    const allTools = registry.getAll();
    expect(allTools.length).toBeGreaterThanOrEqual(2);
    expect(allTools.find((t) => t.name === "test_hello")).toBeDefined();
    expect(allTools.find((t) => t.name === "test_empty")).toBeDefined();
  });

  it("should check if tool exists", () => {
    expect(registry.has("test_hello")).toBe(true);
    expect(registry.has("nonexistent")).toBe(false);
  });

  it("should execute tool handler via schema validation", () => {
    const tool = registry.get("test_hello")!;
    const parsed = tool.inputSchema.parse({ name: "World" });
    expect(parsed.name).toBe("World");
  });

  it("should validate input schema with Zod", () => {
    const tool = registry.get("test_hello")!;
    expect(() => tool.inputSchema.parse({})).toThrow();
    expect(() => tool.inputSchema.parse({ name: 123 })).toThrow();
  });

  it("should preserve tool descriptions", () => {
    const tool = registry.get("test_empty")!;
    expect(tool.description).toBe("An empty tool");
    expect(tool.inputSchema).toBeDefined();
  });
});
