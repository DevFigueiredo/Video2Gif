import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureFfmpegAvailable, runCommand, runFfmpeg, runFfmpegWithProgress } from "./ffmpeg";

export type ConvertOptions = {
  input: string;
  output: string;
  width: number;
  fps: number;
  start?: string;
  duration?: string;
  overwrite: boolean;
  loop: 0 | 1;
};

export type ConvertProgress =
  | { phase: "palette"; percent: number }
  | { phase: "encode"; percent: number; outTimeMs?: number; durationMs?: number }
  | { phase: "done"; percent: number };

function fileExists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function getDurationMs(inputPath: string): Promise<number | undefined> {
  try {
    const res = await runCommand("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath
    ]);
    if (res.code !== 0) return undefined;
    const seconds = Number(String(res.stdout).trim());
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
    return Math.floor(seconds * 1000);
  } catch {
    return undefined;
  }
}

function parseTimeToMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  // "SS" or "SS.mmm"
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;
    return Math.floor(seconds * 1000);
  }

  // "HH:MM:SS" or "HH:MM:SS.mmm"
  const m = trimmed.match(/^(\d+):([0-5]?\d):([0-5]?\d)(\.\d+)?$/);
  if (!m) return undefined;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = Number(`${m[3]}${m[4] ?? ""}`);
  if (![hours, minutes, seconds].every((n) => Number.isFinite(n) && n >= 0)) return undefined;
  return Math.floor(((hours * 60 + minutes) * 60 + seconds) * 1000);
}

function computeEffectiveDurationMs(
  fullDurationMs: number | undefined,
  startMs: number | undefined,
  explicitDurationMs: number | undefined
): number | undefined {
  if (explicitDurationMs != null) return explicitDurationMs;
  if (fullDurationMs == null) return undefined;
  if (startMs == null) return fullDurationMs;
  return Math.max(0, fullDurationMs - startMs);
}

export async function convertVideoToGif(options: ConvertOptions): Promise<void> {
  await convertVideoToGifWithProgress(options, () => {});
}

export async function convertVideoToGifWithProgress(
  options: ConvertOptions,
  onProgress: (p: ConvertProgress) => void
): Promise<void> {
  await ensureFfmpegAvailable();

  if (!fileExists(options.input)) {
    throw new Error(`Arquivo de entrada não encontrado: ${options.input}`);
  }

  const outputDir = path.dirname(options.output);
  if (outputDir && outputDir !== "." && !fileExists(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  if (!options.overwrite && fileExists(options.output)) {
    throw new Error(
      `Arquivo de saída já existe: ${options.output}\nUse --overwrite para sobrescrever.`
    );
  }

  const palettePath = path.join(os.tmpdir(), `videotogif-palette-${process.pid}-${Date.now()}.png`);

  const baseFilters = [
    `fps=${options.fps}`,
    `scale=${options.width}:-1:flags=lanczos:force_original_aspect_ratio=decrease`
  ].join(",");

  const commonSeekArgs: string[] = [];
  if (options.start) commonSeekArgs.push("-ss", options.start);
  if (options.duration) commonSeekArgs.push("-t", options.duration);

  try {
    onProgress({ phase: "palette", percent: 0 });
    await runFfmpeg([
      "-y",
      "-v",
      "error",
      ...commonSeekArgs,
      "-i",
      options.input,
      "-an",
      "-vf",
      `${baseFilters},palettegen=stats_mode=diff`,
      palettePath
    ]);
    onProgress({ phase: "palette", percent: 10 });

    const overwriteArgs = options.overwrite ? ["-y"] : ["-n"];

    const fullDurationMs = await getDurationMs(options.input);
    const startMs = parseTimeToMs(options.start);
    const explicitDurationMs = parseTimeToMs(options.duration);
    const durationMs = computeEffectiveDurationMs(fullDurationMs, startMs, explicitDurationMs);
    await runFfmpegWithProgress(
      [
      ...overwriteArgs,
      "-v",
      "error",
      ...commonSeekArgs,
      "-i",
      options.input,
      "-i",
      palettePath,
      "-an",
      "-lavfi",
      `${baseFilters}[x];[x][1:v]paletteuse=dither=sierra2_4a`,
      "-loop",
      String(options.loop),
      options.output
      ],
      (p) => {
        const outTimeMs = p.outTimeMs;
        const encodePct =
          durationMs && outTimeMs != null && durationMs > 0
            ? Math.max(0, Math.min(1, outTimeMs / durationMs))
            : undefined;
        const percent = encodePct != null ? Math.round(10 + encodePct * 90) : 10;
        onProgress({ phase: "encode", percent, outTimeMs, durationMs });
      }
    );

    onProgress({ phase: "done", percent: 100 });
  } finally {
    try {
      fs.unlinkSync(palettePath);
    } catch {
      // ignore
    }
  }
}
