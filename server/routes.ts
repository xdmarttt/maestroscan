import type { Express } from "express";
import { createServer, type Server } from "node:http";
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
  choices: z.array(z.string()).length(4),
  correct: z.enum(["A", "B", "C", "D"]),
});

const ScanRequestSchema = z.object({
  imageBase64: z.string().min(100),
  questions: z.array(QuizQuestionSchema).length(5),
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
