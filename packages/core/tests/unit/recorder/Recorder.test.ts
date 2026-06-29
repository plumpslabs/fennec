import { describe, it, expect, beforeEach } from "vitest";
import { Recorder } from "../../../src/recorder/Recorder.js";
import type { RecordedAction } from "../../../src/recorder/Recorder.js";

describe("Recorder", () => {
  let recorder: Recorder;

  beforeEach(() => {
    recorder = new Recorder();
  });

  describe("startRecording and stopRecording", () => {
    it("should start a recording session", () => {
      const id = recorder.startRecording("Test Recording");
      expect(id).toBeDefined();
      expect(recorder.getCurrentRecording()).toBeDefined();
      expect(recorder.getCurrentRecording()!.name).toBe("Test Recording");
    });

    it("should stop recording and save", () => {
      recorder.startRecording("Test");
      const recording = recorder.stopRecording();
      expect(recording).not.toBeNull();
      expect(recording!.completedAt).toBeDefined();
      expect(recording!.id).toBeDefined();
      // Should be stored in recordings list
      expect(recorder.getRecording(recording!.id)).toBeDefined();
    });

    it("should return null when no recording in progress", () => {
      expect(recorder.stopRecording()).toBeNull();
    });

    it("should generate a name when not provided", () => {
      const id = recorder.startRecording();
      expect(recorder.getCurrentRecording()!.name).toBeTruthy();
    });
  });

  describe("recordAction", () => {
    it("should record an action", () => {
      recorder.startRecording("Test");
      const action = recorder.recordAction("click", "Click submit button", { selector: "#submit" }, {
        url: "https://example.com",
        duration: 150,
      });

      expect(action.id).toBeDefined();
      expect(action.type).toBe("click");
      expect(action.description).toBe("Click submit button");
      expect(action.params.selector).toBe("#submit");
      expect(action.url).toBe("https://example.com");
      expect(action.duration).toBe(150);
      expect(action.timestamp).toBeGreaterThan(0);
    });

    it("should store console and network snapshots", () => {
      recorder.startRecording("Test");
      const action = recorder.recordAction("navigate", "Go to page", {}, {
        url: "https://example.com",
        duration: 200,
        consoleLogs: ["Error: something broke"],
        networkLogs: ["GET /api/data 500"],
      });

      expect(action.consoleSnapshot).toContain("Error: something broke");
      expect(action.networkSnapshot).toContain("GET /api/data 500");
    });
  });

  describe("updateLastAction", () => {
    it("should update the last recorded action with result", () => {
      recorder.startRecording("Test");
      recorder.recordAction("click", "Click", {}, { url: "https://example.com", duration: 50 });
      recorder.updateLastAction({ clicked: true });

      const recording = recorder.getCurrentRecording();
      expect(recording!.actions[0]!.result).toEqual({ clicked: true });
    });

    it("should update the last recorded action with error", () => {
      recorder.startRecording("Test");
      recorder.recordAction("click", "Click", {}, { url: "https://example.com", duration: 50 });
      recorder.updateLastAction(undefined, "Element not found");

      const recording = recorder.getCurrentRecording();
      expect(recording!.actions[0]!.error).toBe("Element not found");
    });
  });

  describe("listRecordings and deleteRecording", () => {
    it("should list recordings", () => {
      recorder.startRecording("Test 1");
      recorder.stopRecording();
      recorder.startRecording("Test 2");
      recorder.stopRecording();

      expect(recorder.listRecordings()).toHaveLength(2);
    });

    it("should delete a recording", () => {
      recorder.startRecording("Test");
      const recording = recorder.stopRecording()!;
      expect(recorder.deleteRecording(recording.id)).toBe(true);
      expect(recorder.listRecordings()).toHaveLength(0);
    });

    it("should return false when deleting unknown recording", () => {
      expect(recorder.deleteRecording("nonexistent")).toBe(false);
    });
  });

  describe("replay", () => {
    it("should replay all actions successfully", async () => {
      recorder.startRecording("Test Replay");
      recorder.recordAction("click", "Click button", {}, { url: "https://example.com", duration: 50 });
      recorder.recordAction("type", "Type text", {}, { url: "https://example.com", duration: 100 });
      const recording = recorder.stopRecording()!;

      let callCount = 0;
      const result = await recorder.replay(recording.id, async () => {
        callCount++;
        return {};
      });

      expect(result.totalActions).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.successRate).toBe(100);
    });

    it("should handle replay failures", async () => {
      recorder.startRecording("Fail Replay");
      recorder.recordAction("click", "Click", {}, { url: "https://example.com", duration: 50 });
      recorder.recordAction("type", "Type", {}, { url: "https://example.com", duration: 50 });
      const recording = recorder.stopRecording()!;

      const result = await recorder.replay(recording.id, async (action) => {
        if (action.id === recording.actions[1]!.id) throw new Error("Failed on type");
        return {};
      });

      expect(result.failed).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(result.successRate).toBe(50);
    });

    it("should skip actions in skip list", async () => {
      recorder.startRecording("Skip Replay");
      recorder.recordAction("click", "Click", {}, { url: "https://example.com", duration: 50 });
      recorder.recordAction("type", "Type", {}, { url: "https://example.com", duration: 50 });
      const recording = recorder.stopRecording()!;

      const result = await recorder.replay(recording.id, async () => ({}), {
        skipActions: [recording.actions[1]!.id],
      });

      expect(result.skipped).toBe(1);
      expect(result.succeeded).toBe(1);
    });

    it("should pause on error when pauseOnError is true", async () => {
      recorder.startRecording("Pause Replay");
      recorder.recordAction("click", "Click 1", {}, { url: "https://example.com", duration: 10 });
      recorder.recordAction("click", "Click 2", {}, { url: "https://example.com", duration: 10 });
      recorder.recordAction("click", "Click 3", {}, { url: "https://example.com", duration: 10 });
      const recording = recorder.stopRecording()!;

      const result = await recorder.replay(recording.id, async (action) => {
        if (action.id === recording.actions[1]!.id) throw new Error("Failed");
        return {};
      }, { pauseOnError: true });

      expect(result.failed).toBe(1);
      expect(result.succeeded).toBe(1);
    });
  });

  describe("export and import", () => {
    it("should export a recording as JSON", () => {
      recorder.startRecording("Export Test");
      recorder.recordAction("click", "Click", {}, { url: "https://example.com", duration: 50 });
      const recording = recorder.stopRecording()!;

      const json = recorder.exportRecording(recording.id);
      expect(json).not.toBeNull();
      const parsed = JSON.parse(json!);
      expect(parsed.name).toBe("Export Test");
      expect(parsed.actions).toHaveLength(1);
    });

    it("should return null for nonexistent recording export", () => {
      expect(recorder.exportRecording("nonexistent")).toBeNull();
    });

    it("should import a recording from JSON", () => {
      const json = JSON.stringify({
        id: "rec_imported",
        name: "Imported Recording",
        startedAt: new Date().toISOString(),
        actions: [],
        metadata: { tags: [] },
      });

      const recording = recorder.importRecording(json);
      expect(recording.id).toBe("rec_imported");
      expect(recording.name).toBe("Imported Recording");
      expect(recorder.getRecording("rec_imported")).toBeDefined();
    });
  });
});
