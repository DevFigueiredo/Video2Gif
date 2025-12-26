#!/usr/bin/env node
import path from "node:path";
import { convertVideoToGif, type ConvertOptions } from "./convert";

type Options = ConvertOptions;

function printHelp(): void {
  console.log(
    [
      "Uso:",
      "  videotogif <input> [output] [opções]",
      "",
      "Opções:",
      "  --width <px>        Largura do GIF (default: 480)",
      "  --fps <n>           FPS do GIF (default: 15)",
      "  --start <time>      Início (ex: 00:00:02 ou 2.5)",
      "  --duration <time>   Duração (ex: 3 ou 00:00:03)",
      "  --loop <0|1>        0 = loop infinito, 1 = sem loop (default: 0)",
      "  --overwrite         Sobrescreve o arquivo de saída",
      "  -h, --help          Ajuda",
      "",
      "Exemplos:",
      "  videotogif input.mp4",
      "  videotogif input.mp4 out.gif --width 640 --fps 20",
      "  videotogif input.mp4 --start 00:00:05 --duration 3"
    ].join("\n")
  );
}

function parseArgs(argv: string[]): Options | { help: true } {
  const args = [...argv];

  let width = 480;
  let fps = 15;
  let start: string | undefined;
  let duration: string | undefined;
  let overwrite = false;
  let loop: 0 | 1 = 0;

  const positionals: string[] = [];

  while (args.length > 0) {
    const token = args.shift()!;

    if (token === "-h" || token === "--help") return { help: true };
    if (token === "--overwrite") {
      overwrite = true;
      continue;
    }

    if (token === "--width") {
      const v = args.shift();
      if (!v) throw new Error("--width requer um valor.");
      width = toPositiveInt(v, "--width");
      continue;
    }
    if (token === "--fps") {
      const v = args.shift();
      if (!v) throw new Error("--fps requer um valor.");
      fps = toPositiveInt(v, "--fps");
      continue;
    }
    if (token === "--start") {
      const v = args.shift();
      if (!v) throw new Error("--start requer um valor.");
      start = v;
      continue;
    }
    if (token === "--duration") {
      const v = args.shift();
      if (!v) throw new Error("--duration requer um valor.");
      duration = v;
      continue;
    }
    if (token === "--loop") {
      const v = args.shift();
      if (!v) throw new Error("--loop requer um valor (0 ou 1).");
      if (v !== "0" && v !== "1") throw new Error("--loop deve ser 0 ou 1.");
      loop = v === "0" ? 0 : 1;
      continue;
    }

    if (token.startsWith("-")) throw new Error(`Opção desconhecida: ${token}`);
    positionals.push(token);
  }

  const input = positionals[0];
  if (!input) throw new Error("Arquivo de entrada obrigatório.");

  const outputFromPositional = positionals[1];
  const output = outputFromPositional ?? defaultOutputPath(input);

  return { input, output, width, fps, start, duration, overwrite, loop };
}

function toPositiveInt(value: string, flagName: string): number {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) throw new Error(`${flagName} deve ser um inteiro > 0.`);
  return num;
}

function defaultOutputPath(input: string): string {
  const parsed = path.parse(input);
  return path.join(parsed.dir, `${parsed.name}.gif`);
}

async function main(): Promise<void> {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if ("help" in parsed) {
      printHelp();
      process.exitCode = 0;
      return;
    }

    await convertVideoToGif(parsed);
    console.log(`GIF gerado: ${parsed.output}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    console.error("\nUse --help para ver opções.");
    process.exitCode = 1;
  }
}

void main();
