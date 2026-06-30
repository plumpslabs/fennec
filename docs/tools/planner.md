# Planner Tools

AI-powered multi-step execution planning. Describe a goal in natural language and Fennec creates an execution plan, converts it to a workflow, and executes every step automatically.

## Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `planner_execute_goal` | Plan + execute in one call. Converts goal to plan to workflow, executes every step | goal, initialContext? |
| `planner_create_plan` | Preview a plan WITHOUT executing (review steps first) | goal |
| `planner_list_plans` | List all previously created plans with execution status | — |
| `planner_get_plan` | Get detailed info about a specific plan by ID | planId |
| `planner_cancel_plan` | Cancel a running plan execution | planId |

## How It Works

```
User: "login to my app"
  │
  ▼
planner_execute_goal(goal: "login to my app")
  │
  ▼  Phase 1: Plan
Planner.createAutoPlan("login to my app")
  → 4-step plan: navigate → fill username → fill password → submit
  │
  ▼  Phase 2: Convert
WorkflowEngine.planToWorkflow(plan)
  → Registered Workflow with 'execute' steps
  │
  ▼  Phase 3: Execute
WorkflowEngine.executePlan(plan)
  → Each step calls real tools through the middleware pipeline
  → SmartHook, RetryHandler, TelemetryMiddleware all active
  │
  ▼  Phase 4: Return
{ success, planId, steps: [{status, tool, error}], summary }
```

## Examples

```typescript
// Plan + execute in one call
const result = await toolRegistry.call("planner_execute_goal", {
  goal: "login to my app"
});
// Returns: {
//   success: true,
//   planId: "plan_...",
//   steps: [
//     { status: "completed", tool: "browser_navigate", duration: 1234 },
//     { status: "completed", tool: "auth_fill_login_form", duration: 567 }
//   ],
//   summary: "✅ Completed 2/2 steps in 1801ms"
// }

// Preview a plan without executing
const preview = await toolRegistry.call("planner_create_plan", {
  goal: "debug the login error on the page"
});
// Returns: { planId, goal, steps: [{id, description, tool, input}], totalSteps }

// List all plans
const plans = await toolRegistry.call("planner_list_plans", {});
// Returns: { totalPlans: N, plans: [{id, goal, status, steps, createdAt}] }
```

## Supported Goals

The planner understands common development tasks:

| Goal Pattern | Typical Steps |
|-------------|---------------|
| "login to my app" | navigate → fill username → fill password → submit |
| "debug page error" | get current URL → get console logs → get failed requests → screenshot |
| "fill form and submit" | detect fields → fill fields → click submit |
| "take a screenshot" | navigate → wait for load → screenshot |
| "checkout cart" | navigate to cart → fill details → submit |
| "diagnose full-stack" | check browser → check server logs → correlate |
