import pc from "picocolors";

// picocolors 1.x types don't include hex(), and on some Node.js versions
// the CJS/ESM interop can make pc.hex undefined at runtime.
// We detect and fall back gracefully.
export function hexColor(color: string): (s: string) => string {
  if (typeof (pc as any).hex === "function") {
    return (pc as any).hex(color);
  }
  // Fallback: return text unchanged if hex coloring isn't available
  return (s: string) => s;
}

const fennecOrange = hexColor("#FF6432");
const fennecYellow = hexColor("#FFB347");

const FOX = `
      ${fennecOrange("/\\\\   /\\\\")}
     ${fennecOrange("(")} ${fennecYellow("o o")} ${fennecOrange(")       ") + pc.bold("Fennec")} ${pc.dim("v1.11.1")}
     ${fennecOrange("=(")} ${fennecYellow(" Y ")} ${fennecOrange(")=")}       ${pc.dim("ears everywhere in your stack.")}
       ${fennecOrange(")   (")}
`;

const FOX_COMPACT = `${pc.redBright("  🦊")} ${pc.bold("Fennec")} ${pc.dim("v1.11.1")}`;

export function printBanner(): void {
  if (process.stdout.isTTY) {
    console.error(FOX);
  } else {
    console.error(FOX_COMPACT);
  }
}

export function printMiniBanner(): void {
  console.error(FOX_COMPACT + pc.dim(" — ears everywhere in your stack."));
}

export { FOX, FOX_COMPACT };
