import express from "express";
import multer from "multer";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { convertVideoToGif } from "./convert";

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "string") return fallback;
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return fallback;
  return num;
}

function parseTimeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseLoop(value: unknown): 0 | 1 {
  if (value === "1") return 1;
  return 0;
}

function safeUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

const app = express();

const uploadDir = path.join(os.tmpdir(), "videotogif-uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".bin";
    cb(null, `upload-${Date.now()}-${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 } // 1GB
});

const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

app.post("/convert", upload.single("video"), async (req, res) => {
  const inputPath = req.file?.path;
  if (!inputPath) {
    res.status(400).send("Envie um arquivo no campo 'video'.");
    return;
  }

  const width = parsePositiveInt(req.body.width, 480);
  const fps = parsePositiveInt(req.body.fps, 15);
  const start = parseTimeString(req.body.start);
  const duration = parseTimeString(req.body.duration);
  const loop = parseLoop(req.body.loop);

  const outputPath = path.join(os.tmpdir(), `videotogif-${Date.now()}-${crypto.randomUUID()}.gif`);

  const cleanup = () => {
    safeUnlink(inputPath);
    safeUnlink(outputPath);
  };

  try {
    await convertVideoToGif({
      input: inputPath,
      output: outputPath,
      width,
      fps,
      start,
      duration,
      overwrite: true,
      loop
    });

    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Content-Disposition", "attachment; filename=\"output.gif\"");

    const stream = fs.createReadStream(outputPath);
    stream.on("error", () => {
      res.status(500).end("Erro ao ler o GIF gerado.");
      cleanup();
    });
    res.on("finish", cleanup);
    stream.pipe(res);
  } catch (err) {
    cleanup();
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).send(message);
  }
});

const port = Number(process.env.PORT ?? "3000");
app.listen(port, () => {
  console.log(`VideoToGif web: http://localhost:${port}`);
});
