# 🦊 Fennec — Agent Directives

> Observe first. Diagnose before fixing. Verify after edits.

Best-practice rules for AI coding agents using Fennec MCP tools (browser
observability, app-process supervision, smart debugging). Generated in full
by `fennec init` into your project's `AGENTS.md` — this file is the canonical
source.

<fennec_workflow>
## Workflow: observe → diagnose → act → verify

1. **Observe first:** `observe(detail="summary")` — one call shows browser
   URL/title, console error counts, network failures, and tracked processes.
   Never dump raw logs when a summary answers the question.
2. **Diagnose before fixing:** `diagnose_page()` (browser-only) or
   `diagnose_fullstack(processId)` (browser + server correlated). Trust the
   root-cause hypothesis over hunches.
3. **Act with cheap tools:** `browser_get_dom_snapshot` over full HTML;
   `summarize(source="console"|"network")` over raw log dumps.
4. **Verify after edits:** reload + `diagnose_page()`, or `smart_verify` for
   async flows. Re-run the failing check, don't assume.
</fennec_workflow>

<fennec_processes>
## Processes: spawn tracked, never bare bash

- Run dev servers via `process_spawn` (adopt-by-port: never double-start),
  NOT bare `bash` — spawned apps are tracked, logged, and restartable.
- Read logs with `process_get_logs` / `inspect --watch`, never `cat`.
- Pause with `process_stop_tracked`, resume with `process_spawn_tracked`;
  only `process_kill` when removal is intended.
</fennec_processes>

<fennec_token_discipline>
## Token discipline

- Prefer token-capped tools: `observe`, `summarize`, `inspect(tail)`.
- Use watch mode (`sinceOffset` watermarks) for streaming logs instead of
  re-reading full buffers.
- Set `FENNEC_WORKFLOW_ONLY=1` in large sessions to slim tool schemas.
</fennec_token_discipline>

<fennec_auth>
## Auth sessions: save once, reuse

- Log in via `auth_fill_login_form` (leaves `saveAfterLogin` ON).
- After manual login, persist explicitly with `auth_save_session`.
- Restore later with `auth_load_session` instead of re-logging in.
</fennec_auth>

<fennec_devices>
## Devices: emulate, don't guess

- Mobile-first bugs need `devtools_emulate_device` (viewport + touch +
  user-agent) — never infer mobile layout from a desktop viewport.
- `devtools_evaluate` accepts plain JS; bare function declarations and
  multi-statement scripts are auto-wrapped, but prefer single expressions.
</fennec_devices>
