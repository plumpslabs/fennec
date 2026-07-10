import pc from "picocolors";

// picocolors 1.x types don't include hex(), but it works at runtime.
// We expose hexColor for use by the format module.
export function hexColor(color: string): (s: string) => string {
  return (pc as any).hex(color);
}

const fennecOrange = hexColor("#FF6432");
const fennecYellow = hexColor("#FFB347");

const FOX = `
      ${fennecOrange("/\\\\   /\\\\")}
     ${fennecOrange("(")} ${fennecYellow("o o")} ${fennecOrange(")       ") + pc.bold("Fennec")} ${pc.dim("v1.10.0")}
     ${fennecOrange("=(")} ${fennecYellow(" Y ")} ${fennecOrange(")=")}       ${pc.dim("ears everywhere in your stack.")}
       ${fennecOrange(")   (")}
`;

const FOX_COMPACT = `${pc.redBright("  🦊")} ${pc.bold("Fennec")} ${pc.dim("v1.10.0")}`;

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
