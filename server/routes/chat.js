// Streaming chat endpoint (SSE) plus a context preview for debugging.
import express from "express";
import { streamChat, buildContextText } from "../services/ai.js";

const router = express.Router();

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

router.post("/", async (req, res) => {
  const { messages, provider, leagueId } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages[] is required." });
  }
  // Keep the last 20 turns; the API is stateless and history grows unbounded otherwise.
  const history = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  if (history.length === 0 || history[0].role !== "user") {
    return res.status(400).json({ error: "Conversation must start with a user message." });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  try {
    await streamChat({ history, provider, leagueId }, (event) => sse(res, event));
  } catch (err) {
    console.error("Chat stream failed:", err);
    // Where to put the key differs by deployment, so name the right place.
    const keyLocation =
      process.env.ROTOBOT_HOSTED === "1"
        ? "Add ANTHROPIC_API_KEY under Environment in your hosting dashboard; the service restarts on its own."
        : "Add ANTHROPIC_API_KEY to your .env file and restart the server.";
    const message =
      err?.code === "NO_API_KEY"
        ? `The assistant needs a Claude API key. ${keyLocation} Everything else in the app works without one.`
        : err?.status === 401
        ? `Claude rejected the API key. ${keyLocation}`
        : err?.status === 429
        ? "Rate limited by the Claude API. Wait a moment and try again."
        : err?.message || "The assistant hit an unexpected error.";
    sse(res, { type: "error", message });
    sse(res, { type: "done" });
  }
  res.end();
});

router.get("/context", async (req, res, next) => {
  try {
    const text = await buildContextText(req.query.provider, req.query.leagueId);
    res.type("text/plain").send(text);
  } catch (err) {
    next(err);
  }
});

export default router;
