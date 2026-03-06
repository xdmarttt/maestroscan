import type { Express } from "express";
import { createServer, type Server } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

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
