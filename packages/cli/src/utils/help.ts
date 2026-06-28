export function showHelp(): void {
  console.error(`
Usage: fennec <command> [options]

Commands:
  start              Start the MCP server (default)
    --transport      Transport type (stdio | sse) [default: stdio]
    --port           SSE port [default: 3333]
    --config         Path to config file

  pipe               Pipe stdin to log watcher
    --name           Watcher name (required)

  attach-pid         Attach to a running process by PID
    <pid>            Process ID (required)
    --name           Name for the process

  attach-port        Attach to a process by port
    <port>           Port number (required)
    --name           Name for the process

  watch              Watch a log file
    --file           File path (required)
    --name           Watcher name

  sessions           List saved auth sessions
  setup              Configure MCP client (Claude Desktop)
  install-browsers   Install Playwright browser engines
  init               Generate fennec.config.yaml

  help               Show this help message
  `);
}
