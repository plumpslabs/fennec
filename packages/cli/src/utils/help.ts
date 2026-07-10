import pc from "picocolors";
import { hexColor } from "./banner.js";

const fennecOrange = hexColor("#FF6432");

export function showHelp(): void {
  const sep = fennecOrange("─".repeat(50));

  console.error(`

  ${pc.bold("Usage:")} fennec ${pc.dim("<command>")} ${pc.dim("[options]")}

  ${sep}
  ${pc.bold("Server")}
  ${sep}

    ${pc.cyan("start")}            ${pc.dim("Start Fennec MCP server (default)")}
                     ${pc.dim("--config")}    Path to config file
                     ${pc.dim("--transport")} Transport type ${pc.dim("(stdio | sse) [default: stdio]")}
                     ${pc.dim("--api-port")}  Management API port ${pc.dim("[default: 3456]")}

    ${pc.cyan("start")} ${pc.dim("<command>")}         ${pc.dim("Start an app under Fennec observation (new!)")}
                     ${pc.dim("--name")}    App name ${pc.dim("(required for tracking)")}
                     ${pc.dim("--port")}    Port the app listens on ${pc.dim("(optional)")}
                     ${pc.dim("--cwd")}     Working directory
                     ${pc.dim("--restart")}  Auto-restart on crash

  ${sep}
  ${pc.bold("Process Management")}
  ${sep}

    ${pc.cyan("ps")} ${pc.dim("[options]")}          ${pc.dim("List real system processes")}
                     ${pc.dim("--name")}    Filter by process name
                     ${pc.dim("--port")}    Filter by port
                     ${pc.dim("--sort")}    Sort by ${pc.dim("(cpu | mem | pid | name) [default: cpu]")}
                     ${pc.dim("-n")}        Max results ${pc.dim("[default: 30]")}
                     ${pc.dim("-w, --watch")}  Watch mode ${pc.dim("(refresh every 3s)")}
                     ${pc.dim("-a, --all")}   Show all processes ${pc.dim("(not just user)")}

    ${pc.cyan("run")} ${pc.dim("<command>")}        ${pc.dim("Run a command under Fennec observation")}
                     ${pc.dim("--name")}    Process name ${pc.dim("(required)")}
                     ${pc.dim("--cwd")}     Working directory
                     ${pc.dim("--restart")}  Auto-restart on crash

    ${pc.cyan("status")} ${pc.dim("[name]")}        ${pc.dim("Show system overview & top processes")}
                     ${pc.dim("-w, --watch")}  Watch mode ${pc.dim("(refresh every 3s)")}

    ${pc.cyan("log")} ${pc.dim("<pid|name>")}       ${pc.dim("Show logs for a process")}
                     ${pc.dim("--lines")}   Number of lines ${pc.dim("[default: 30]")}
                     ${pc.dim("-f, --follow")}  Follow mode ${pc.dim("(journalctl --follow)")}

    ${pc.cyan("kill")} ${pc.dim("<pid|name|all>")}  ${pc.dim("Kill process(es) by PID, name, or all")}
                     ${pc.dim("--signal")}  Signal to send ${pc.dim("[default: SIGTERM]")}
                     ${pc.dim("--all")}     Kill all user processes

    ${pc.cyan("restart")} ${pc.dim("<pid|name>")}   ${pc.dim("Kill + show re-run command")}

  ${sep}
  ${pc.bold("Observation")}
  ${sep}

    ${pc.cyan("attach")} ${pc.dim("<port>")}         ${pc.dim("Observe a process by port")}
                     ${pc.dim("--name")}    Process name

    ${pc.cyan("pipe")}             ${pc.dim("Pipe stdin to log watcher")}
                     ${pc.dim("--name")}    Watcher name ${pc.dim("(required)")}

    ${pc.cyan("watch")}            ${pc.dim("Watch a log file")}
                     ${pc.dim("--file")}    File path ${pc.dim("(required)")}
                     ${pc.dim("--name")}    Watcher name

    ${pc.cyan("attach-pid")} ${pc.dim("<pid>")}      ${pc.dim("Attach to process by PID")}
    ${pc.cyan("attach-port")} ${pc.dim("<port>")}    ${pc.dim("Attach to process by port")}

  ${sep}
  ${pc.bold("Configuration")}
  ${sep}

    ${pc.cyan("init")}             ${pc.dim("Generate fennec.config.yaml")}
    ${pc.cyan("setup")}            ${pc.dim("Configure MCP client")}
    ${pc.cyan("install-browsers")} ${pc.dim("Install Playwright browser engines")}
    ${pc.cyan("sessions")}         ${pc.dim("List saved auth sessions")}

  ${sep}
  ${pc.bold("Other")}
  ${sep}

    ${pc.cyan("help")}             ${pc.dim("Show this help message")}
    ${pc.cyan("version")}          ${pc.dim("Show version")}

  ${pc.dim("─".repeat(50))}

  ${pc.dim("Learn more:")} ${pc.cyan("https://github.com/plumpslabs/fennec")}
  `);
}
