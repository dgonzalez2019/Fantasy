import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import accountsRouter from "./routes/accounts.js";
import fantasyRouter from "./routes/fantasy.js";
import chatRouter from "./routes/chat.js";
import fs from "fs";
import { MOCK } from "./lib/mock.js";
import { gate, handleLogin, authEnabled } from "./lib/auth.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "../public");
const app = express();
const PORT = process.env.PORT || 3000;
const HOSTED = process.env.ROTOBOT_HOSTED === "1";

// Needed so req.secure and rate-limit style checks see the real protocol
// behind Render / Fly / Railway proxies.
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

app.post("/api/auth/login", handleLogin);
app.get("/api/auth/status", (req, res) => res.json({ authRequired: authEnabled }));
app.get("/login", (req, res) => res.sendFile(path.join(here, "../public/login.html")));

// Liveness probe for hosting platforms. Deliberately public and deliberately
// empty of detail - the gated /api/health below carries the real status, and a
// health check that 401s would fail every deploy.
app.get("/api/ping", (req, res) => res.json({ ok: true }));

// Static assets are served BEFORE the gate, deliberately. They hold no data -
// app.js is client code and styles.css is styling; every byte of real content
// comes from the gated APIs below. Gating them instead means a missing or
// expired session turns each asset request into a redirect to /login, so the
// browser silently receives HTML where it expected CSS or JavaScript and the
// page renders as unstyled, inert text. `index: false` keeps "/" itself gated
// so a signed-out visitor still lands on the login screen.
app.use(express.static(PUBLIC_DIR, { index: false }));

// Everything below this line requires a session when ROTOBOT_ACCESS_CODE is set.
app.use(gate);

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mock: MOCK,
    hosted: HOSTED,
    authEnabled,
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    model: process.env.ROTOBOT_MODEL || "claude-opus-5",
  });
});

app.use("/api/accounts", accountsRouter);
app.use("/api/fantasy", fantasyRouter);
app.use("/api/chat", chatRouter);

// SPA fallback. Excludes anything ending in a file extension so a missing asset
// returns a real 404 instead of being masked as a 200 of index.html, which is
// invisible to the browser and shows up only as a mysteriously broken page.
app.get(/^(?!\/api\/)(?!.*\.[a-zA-Z0-9]{1,8}$).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((err, req, res, next) => {
  console.error(`${req.method} ${req.path} ->`, err.message);
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({ error: err.userMessage || err.message || "Server error" });
});

app.listen(PORT, () => {
  console.log(`RotoBot running at http://localhost:${PORT}${MOCK ? "  [MOCK DATA MODE]" : ""}`);
  // A missing public/ shows up in the browser as a blank or text-only page with
  // no error, so say it plainly in the logs instead.
  for (const asset of ["index.html", "app.js", "styles.css"]) {
    if (!fs.existsSync(path.join(PUBLIC_DIR, asset))) {
      console.error(`  ERROR: public/${asset} is missing — the page will not render correctly.`);
    }
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log("  Note: ANTHROPIC_API_KEY is not set — the AI chat tab will return an auth error.");
  }
  if (authEnabled) {
    console.log("  Access code required (ROTOBOT_ACCESS_CODE is set).");
  } else {
    console.log(
      "  WARNING: no access code set. Fine on your own machine, but do NOT expose this\n" +
      "  to the internet as-is — set ROTOBOT_ACCESS_CODE before deploying."
    );
  }
});
