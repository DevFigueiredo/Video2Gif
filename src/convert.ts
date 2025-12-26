import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureFfmpegAvailable, runFfmpeg } from "./ffmpeg";

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

function fileExists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function convertVideoToGif(options: ConvertOptions): Promise<void> {
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

    const overwriteArgs = options.overwrite ? ["-y"] : ["-n"];

    await runFfmpeg([
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
    ]);
  } finally {
    try {
      fs.unlinkSync(palettePath);
    } catch {
      // ignore
    }
  }
}

