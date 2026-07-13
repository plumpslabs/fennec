import { z } from 'zod';
import { createTool } from '../_registry.js';

export const recorderStart = createTool({
  name: 'recorder_start',
  category: 'recorder',
  description:
    "`<use_case>Test authoring</use_case> 🎬 Start recording the agent's browser actions (navigate/click/type/select/scroll/screenshot/wait). While recording is active, compatible tools auto-capture each step. Returns a recordingId. Stop and export it as a runnable Playwright/Puppeteer script with recorder_stop + recorder_export. Use to turn a manual exploration session into a reusable automated test.",
  inputSchema: z.object({
    name: z.string().optional().describe('Human-friendly recording name'),
  }),
  handler: async (input, { recorder, responseBuilder }) => {
    const id = recorder.startRecording(input.name ?? '');
    return responseBuilder.success({ recordingId: id, recording: true });
  },
});

export const recorderStop = createTool({
  name: 'recorder_stop',
  category: 'recorder',
  description:
    '`<use_case>Test authoring</use_case> ⏹️ Stop the active recording and return a summary (action count, duration, first/last URL). Pair with recorder_export to emit a Playwright/Puppeteer script.',
  inputSchema: z.object({}),
  handler: async (_input, { recorder, responseBuilder }) => {
    const rec = recorder.stopRecording();
    if (!rec) {
      return responseBuilder.error(new Error('No active recording to stop'), {
        code: 'NO_ACTIVE_RECORDING',
      });
    }
    const durations = rec.actions.map((a) => a.duration);
    return responseBuilder.success({
      recordingId: rec.id,
      name: rec.name,
      actionCount: rec.actions.length,
      startedAt: rec.startedAt,
      completedAt: rec.completedAt,
      firstUrl: rec.actions[0]?.url,
      lastUrl: rec.actions[rec.actions.length - 1]?.url,
      totalDurationMs: durations.reduce((s, d) => s + d, 0),
    });
  },
});

export const recorderExport = createTool({
  name: 'recorder_export',
  category: 'recorder',
  description:
    "`<use_case>Test authoring</use_case> 📦 Export a recording as a runnable test script. framework 'playwright' (default) or 'puppeteer'. Returns the generated source — save it to a .ts/.js file and run it. This is how a manual session becomes an automated test.",
  inputSchema: z.object({
    recordingId: z.string().describe('Recording ID from recorder_start/recorder_stop'),
    framework: z.enum(['playwright', 'puppeteer']).optional().default('playwright'),
  }),
  handler: async (input, { recorder, responseBuilder }) => {
    const script = recorder.exportAsScript(input.recordingId, input.framework);
    if (!script) {
      return responseBuilder.error(new Error(`Recording not found: ${input.recordingId}`), {
        code: 'RECORDING_NOT_FOUND',
      });
    }
    return responseBuilder.success({
      recordingId: input.recordingId,
      framework: input.framework,
      script,
    });
  },
});

export const recorderList = createTool({
  name: 'recorder_list',
  category: 'recorder',
  description:
    '`<use_case>Test authoring</use_case> 📋 List all saved recordings (id, name, action count, startedAt). Use to find a recordingId before recorder_export.',
  inputSchema: z.object({}),
  handler: async (_input, { recorder, responseBuilder }) => {
    const list = recorder.listRecordings().map((r) => ({
      id: r.id,
      name: r.name,
      actionCount: r.actions.length,
      startedAt: r.startedAt,
    }));
    return responseBuilder.success({ recordings: list, count: list.length });
  },
});

export const recorderCapture = createTool({
  name: 'recorder_capture',
  category: 'recorder',
  description:
    "`<use_case>Test authoring</use_case> ✍️ Manually append a step to the active recording (for actions the auto-capture doesn't cover, e.g. a drag, a file upload, or an evaluate call). Compatible tools (browser_navigate, browser_click, browser_type, browser_select) auto-capture; use this for the rest. Requires an active recording (recorder_start).",
  inputSchema: z.object({
    type: z
      .enum([
        'navigate',
        'click',
        'type',
        'select',
        'scroll',
        'screenshot',
        'wait',
        'evaluate',
        'custom',
      ])
      .describe('Step type'),
    description: z.string().describe('Human-readable step description'),
    params: z
      .record(z.unknown())
      .optional()
      .describe('Step parameters (selector, url, text, value, ...)'),
    url: z.string().optional().describe('Page URL at the time of the step'),
  }),
  handler: async (input, { recorder, responseBuilder, sessionManager }) => {
    if (!recorder.getCurrentRecording()) {
      return responseBuilder.error(new Error('No active recording — call recorder_start first'), {
        code: 'NO_ACTIVE_RECORDING',
      });
    }
    const session = sessionManager.getOrDefault();
    const action = recorder.recordAction(input.type, input.description, input.params ?? {}, {
      url: input.url ?? session.browser.url(),
      duration: 0,
    });
    return responseBuilder.success({ captured: true, actionId: action.id });
  },
});
