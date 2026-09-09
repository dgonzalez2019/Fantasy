import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import accountsRouter from "./routes/accounts.js";
import fantasyRouter from "./routes/fantasy.js";
import chatRouter from "./routes/chat.js";
import { MOCK } from "./lib/mock.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mock: MOCK,
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    model: process.env.ROTOBOT_MODEL || "claude-opus-5",
  });
});

app.use("/api/accounts", accountsRouter);
app.use("/api/fantasy", fantasyRouter);
app.use("/api/chat", chatRouter);

app.use(express.static(path.join(here, "../public")));

// SPA fallback for non-API routes.
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(here, "../public/index.html"));
});

app.use((err, req, res, next) => {
  console.error(`${req.method} ${req.path} ->`, err.message);
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({ error: err.userMessage || err.message || "Server error" });
});

app.listen(PORT, () => {
  console.log(`RotoBot replica running at http://localhost:${PORT}${MOCK ? "  [MOCK DATA MODE]" : ""}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log("  Note: ANTHROPIC_API_KEY is not set — the AI chat tab will return an auth error.");
  }
});
