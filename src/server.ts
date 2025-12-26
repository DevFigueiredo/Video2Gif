import express from "express";
import multer from "multer";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { convertVideoToGifWithProgress, type ConvertProgress } from "./convert";

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

type JobStatus = "running" | "done" | "error";
type Job = {
  id: string;
  status: JobStatus;
  createdAt: number;
  progress: number;
  phase: ConvertProgress["phase"];
  outputPath?: string;
  error?: string;
  emitter: EventEmitter;
};

const jobs = new Map<string, Job>();
const jobTtlMs = 10 * 60 * 1000;

function scheduleJobCleanup(job: Job): void {
  setTimeout(() => {
    const current = jobs.get(job.id);
    if (!current) return;
    if (Date.now() - current.createdAt < jobTtlMs) return;
    if (current.outputPath) safeUnlink(current.outputPath);
    jobs.delete(job.id);
  }, jobTtlMs + 1000);
}

function emitJob(job: Job, event: string, data: unknown): void {
  job.emitter.emit(event, data);
}

app.get("/jobs/:id/events", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).end();
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send("status", { status: job.status, progress: job.progress, phase: job.phase });

  const onProgress = (p: ConvertProgress) => {
    send("progress", p);
  };
  const onDone = () => {
    send("done", { ok: true });
    res.end();
  };
  const onJobError = (payload: { error: string }) => {
    send("joberror", payload);
    res.end();
  };

  job.emitter.on("progress", onProgress);
  job.emitter.on("done", onDone);
  job.emitter.on("joberror", onJobError);

  req.on("close", () => {
    job.emitter.off("progress", onProgress);
    job.emitter.off("done", onDone);
    job.emitter.off("joberror", onJobError);
  });
});

app.get("/jobs/:id/result", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).send("Job não encontrado.");
    return;
  }
  if (job.status === "error") {
    res.status(409).send(job.error ?? "Falha na conversão.");
    return;
  }
  if (job.status !== "done" || !job.outputPath) {
    res.status(409).send("Conversão ainda em andamento.");
    return;
  }

  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Content-Disposition", "attachment; filename=\"output.gif\"");

  const stream = fs.createReadStream(job.outputPath);
  stream.on("error", () => {
    res.status(500).end("Erro ao ler o GIF gerado.");
  });
  stream.pipe(res);
});

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

  const jobId = crypto.randomUUID();
  const outputPath = path.join(os.tmpdir(), `videotogif-${Date.now()}-${jobId}.gif`);

  const job: Job = {
    id: jobId,
    status: "running",
    createdAt: Date.now(),
    progress: 0,
    phase: "palette",
    outputPath,
    emitter: new EventEmitter()
  };
  jobs.set(jobId, job);
  scheduleJobCleanup(job);

  // responde rápido com o jobId; a UI acompanha via SSE e baixa o resultado quando pronto
  res.json({ jobId });

  void (async () => {
    try {
      await convertVideoToGifWithProgress(
        {
          input: inputPath,
          output: outputPath,
          width,
          fps,
          start,
          duration,
          overwrite: true,
          loop
        },
        (p) => {
          job.phase = p.phase;
          job.progress = p.percent;
          emitJob(job, "progress", p);
        }
      );

      job.status = "done";
      job.progress = 100;
      emitJob(job, "done", {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      job.status = "error";
      job.error = message;
      emitJob(job, "joberror", { error: message });
      if (job.outputPath) safeUnlink(job.outputPath);
    } finally {
      safeUnlink(inputPath);
    }
  })();
});

const port = Number(process.env.PORT ?? "3000");
const server = app.listen(port, () => {
  console.log(`VideoToGif web: http://localhost:${port}`);
});
server.on("error", (err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Falha ao iniciar servidor: ${message}`);
  process.exitCode = 1;
});
