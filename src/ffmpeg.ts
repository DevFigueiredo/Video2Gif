import { spawn } from "node:child_process";

export type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export function runCommand(command: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));

    child.on("error", (err) => reject(err));
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

export async function ensureFfmpegAvailable(): Promise<void> {
  try {
    const res = await runCommand("ffmpeg", ["-version"]);
    if (res.code !== 0) throw new Error(res.stderr || "ffmpeg retornou erro.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `ffmpeg não encontrado/indisponível. Instale o ffmpeg e tente novamente.\nDetalhes: ${message}`
    );
  }
}

export async function runFfmpeg(args: string[]): Promise<void> {
  const res = await runCommand("ffmpeg", args);
  if (res.code !== 0) {
    const rendered = [
      "Falha ao executar ffmpeg.",
      "",
      `Comando: ffmpeg ${args.map(shellEscape).join(" ")}`,
      "",
      "Saída:",
      (res.stderr || res.stdout || "").trim()
    ]
      .filter(Boolean)
      .join("\n");
    throw new Error(rendered);
  }
}

export type FfmpegProgress = {
  outTimeMs?: number;
  raw: Record<string, string>;
};

export async function runFfmpegWithProgress(
  args: string[],
  onProgress: (p: FfmpegProgress) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const augmentedArgs = [...args, "-progress", "pipe:1", "-nostats"];
    const child = spawn("ffmpeg", augmentedArgs, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));

    let buffer = "";
    let current: Record<string, string> = {};

    const flushBlock = () => {
      if (Object.keys(current).length === 0) return;
      const outTimeMs = parseOutTimeMs(current);
      onProgress({ outTimeMs, raw: current });
      current = {};
    };

    child.stdout.on("data", (d) => {
      buffer += String(d);
      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx === -1) break;
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);

        if (line.length === 0) {
          flushBlock();
          continue;
        }

        const eq = line.indexOf("=");
        if (eq !== -1) {
          const k = line.slice(0, eq);
          const v = line.slice(eq + 1);
          current[k] = v;
          if (k === "progress" && v === "end") {
            flushBlock();
          }
        }
      }
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      flushBlock();
      if ((code ?? 0) !== 0) {
        const rendered = [
          "Falha ao executar ffmpeg.",
          "",
          `Comando: ffmpeg ${augmentedArgs.map(shellEscape).join(" ")}`,
          "",
          "Saída:",
          (stderr || "").trim()
        ]
          .filter(Boolean)
          .join("\n");
        reject(new Error(rendered));
        return;
      }
      resolve();
    });
  });
}

function parseOutTimeMs(raw: Record<string, string>): number | undefined {
  const outUs = raw["out_time_us"];
  if (outUs && /^\d+$/.test(outUs)) {
    return Math.floor(Number(outUs) / 1000);
  }

  const outMs = raw["out_time_ms"];
  if (outMs && /^\d+$/.test(outMs)) {
    const num = Number(outMs);
    if (!Number.isFinite(num)) return undefined;
    // Alguns builds reportam us mesmo no campo *_ms; heurística baseada na magnitude.
    if (num > 60_000_000) return Math.floor(num / 1000);
    return Math.floor(num);
  }

  return undefined;
}

function shellEscape(value: string): string {
  if (/^[a-zA-Z0-9_./:=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}
