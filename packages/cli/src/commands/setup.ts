/**
 * Command: setup — Interactive MCP client setup.
 */
import pc from "picocolors";
import { symbols, renderSuccess, renderCommand, selectPrompt } from "../utils/format.js";

export async function setupCommand(): Promise<void> {
  console.error(`\n  ${symbols.fox} ${pc.bold("Fennec Setup")}\n`);

  const mcpClient = await selectPrompt("Which MCP client are you using?", [
    { value: "claude", label: "Claude Desktop", description: "Anthropic's AI desktop app" },
    { value: "cursor", label: "Cursor", description: "AI-powered code editor" },
    { value: "cline", label: "Cline", description: "VS Code MCP client" },
    { value: "other", label: "Other MCP client", description: "Any MCP-compatible client" },
  ]);

  if (!mcpClient) { console.error(`  ${pc.dim("Setup cancelled.")}\n`); return; }

  console.error(`\n  ${pc.green("✓")} Selected: ${pc.bold(mcpClient)}\n`);

  const configSnippet = `{\n  "mcpServers": {\n    "fennec": {\n      "command": "fennec",\n      "args": ["start"]\n    }\n  }\n}`;

  console.error(`  ${pc.bold("Add this to your MCP client config:")}\n`);
  console.error(`  ${pc.dim("```")}`);
  console.error(configSnippet.split("\n").map((l) => `  ${l}`).join("\n"));
  console.error(`  ${pc.dim("```")}\n`);
  console.error(`  ${renderSuccess("Setup complete!")} ${pc.dim("Run")} ${renderCommand("fennec start")} ${pc.dim("to begin.")}\n`);
}
