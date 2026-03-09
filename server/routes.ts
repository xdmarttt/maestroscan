import type { Express } from "express";
import { createServer, type Server } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// In-memory store for last debug capture
let lastCapture: { imageBase64: string; studentId: string | null; answers: string[]; timestamp: number } | null = null;

const PYTHON_URL = "http://localhost:5002";

async function proxyToPython(path: string, body: unknown) {
  const resp = await fetch(`${PYTHON_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return resp.json();
}

const QuizQuestionSchema = z.object({
  id: z.number(),
  text: z.string(),
  choices: z.array(z.string()).min(4).max(5),
  correct: z.enum(["A", "B", "C", "D", "E"]),
});

const ScanRequestSchema = z.object({
  imageBase64: z.string().min(100),
  questions: z.array(QuizQuestionSchema).min(1).max(100),
  choiceCount: z.union([z.literal(4), z.literal(5)]).optional().default(4),
  // [[x,y],[x,y],[x,y],[x,y]] TL,TR,BL,BR — sent by app when using manual alignment
  corners: z.array(z.tuple([z.number(), z.number()])).length(4).optional(),
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Lightweight detection — just finds registration marks, no bubble analysis
  app.post("/api/detect", async (req, res) => {
    try {
      const { imageBase64 } = req.body;
      if (!imageBase64 || typeof imageBase64 !== "string") {
        return res.status(400).json({ found: false });
      }
      const result = await proxyToPython("/api/detect", { imageBase64 });
      res.json(result);
    } catch (err) {
      console.error("/api/detect error:", err);
      res.json({ found: false });
    }
  });

  // Debug: returns warped image with bubble circles drawn — useful for verifying alignment
  app.post("/api/debug-scan", async (req, res) => {
    try {
      const { imageBase64 } = req.body;
      if (!imageBase64 || typeof imageBase64 !== "string") {
        return res.status(400).json({ found: false });
      }
      const result = await proxyToPython("/api/debug-scan", { imageBase64 });
      res.json(result);
    } catch (err) {
      console.error("/api/debug-scan error:", err);
      res.json({ found: false });
    }
  });

  // Debug: receive warped image from offline scanner and save to disk for inspection
  // TODO: remove this endpoint when offline scanning is stable
  app.post("/api/debug-save-warped", async (req, res) => {
    try {
      const { imageBase64 } = req.body;
      if (!imageBase64 || typeof imageBase64 !== "string") {
        return res.status(400).json({ ok: false });
      }
      const buf = Buffer.from(imageBase64, "base64");
      const outPath = join(__dirname, "../../python/debug_last_scan_offline.jpg");
      writeFileSync(outPath, buf);
      console.log("[debug-save-warped] saved →", outPath);
      res.json({ ok: true });
    } catch (err) {
      console.error("/api/debug-save-warped error:", err);
      res.json({ ok: false });
    }
  });

  // Debug: save last scan capture for viewing in browser
  app.post("/api/debug-capture", async (req, res) => {
    try {
      const { imageBase64, studentId, answers } = req.body;
      if (!imageBase64 || typeof imageBase64 !== "string") {
        return res.status(400).json({ ok: false });
      }
      lastCapture = {
        imageBase64,
        studentId: studentId ?? null,
        answers: answers ?? [],
        timestamp: Date.now(),
      };
      console.log(`[debug-capture] saved (studentId=${studentId ?? "none"}, ${answers?.length ?? 0} answers)`);
      res.json({ ok: true });
    } catch (err) {
      console.error("/api/debug-capture POST error:", err);
      res.json({ ok: false });
    }
  });

  // Debug: view last captured scan in browser
  app.get("/api/debug-capture", async (_req, res) => {
    if (!lastCapture) {
      return res.send("<html><body style='font-family:sans-serif;padding:40px'><h2>No scan captured yet</h2><p>Scan a sheet from the app and it will appear here.</p></body></html>");
    }
    const { imageBase64, studentId, answers, timestamp } = lastCapture;
    const time = new Date(timestamp).toLocaleString();
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Debug Capture</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0a0f1a; color: #e0e0e0; padding: 20px; margin: 0; }
  h1 { font-size: 18px; color: #00c6ff; }
  .meta { font-size: 13px; color: #888; margin-bottom: 16px; }
  .meta span { color: #ccc; }
  .answers { display: flex; gap: 6px; flex-wrap: wrap; margin: 12px 0; }
  .answers span { background: #1a2236; border: 1px solid #2a3a5a; border-radius: 6px; padding: 4px 10px; font-size: 13px; font-family: monospace; }
  img { max-width: 100%; border-radius: 8px; border: 1px solid #2a3a5a; margin-top: 12px; }
  .refresh { color: #00c6ff; text-decoration: none; font-size: 13px; }
</style></head><body>
  <h1>Last Debug Capture</h1>
  <div class="meta">
    <div>Time: <span>${time}</span></div>
    <div>Student ID: <span>${studentId ?? "none"}</span></div>
    <div>Answers (${answers.length}): </div>
  </div>
  <div class="answers">${answers.map((a: string, i: number) => `<span>Q${i + 1}: ${a}</span>`).join("")}</div>
  <a class="refresh" href="/api/debug-capture">Refresh</a>
  <br>
  <img src="data:image/jpeg;base64,${imageBase64}" />
</body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  app.post("/api/scan", async (req, res) => {
    try {
      const body = ScanRequestSchema.parse(req.body);
      const result = await proxyToPython("/api/scan", body);
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request", errors: err.errors });
      }
      console.error("/api/scan error:", err);
      res.status(500).json({ message: "Scan processing failed" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
