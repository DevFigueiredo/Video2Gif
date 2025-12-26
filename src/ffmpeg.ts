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

function shellEscape(value: string): string {
  if (/^[a-zA-Z0-9_./:=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

