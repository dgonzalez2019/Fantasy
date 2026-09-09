// Access gate for hosted deployments.
//
// Set ROTOBOT_ACCESS_CODE and every route requires a session cookie. Without it
// the app is wide open, which is fine on localhost and dangerous anywhere else -
// an unprotected public URL hands strangers the linked fantasy accounts and an
// unmetered chat endpoint spending the owner's API credits.
import crypto from "crypto";

const CODE = process.env.ROTOBOT_ACCESS_CODE || "";
export const authEnabled = Boolean(CODE);

const COOKIE = "rotobot_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const sessions = new Map(); // token -> expiry

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

// Constant-time compare so the code can't be recovered by timing the response.
function codeMatches(supplied) {
  const a = Buffer.from(String(supplied));
  const b = Buffer.from(CODE);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isValid(token) {
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function createSession(res, secure) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_MS);
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}` +
      (secure ? "; Secure" : "")
  );
}

// Paths reachable before signing in.
const OPEN = new Set(["/login", "/api/auth/login", "/api/auth/status", "/styles.css", "/favicon.ico"]);

export function gate(req, res, next) {
  if (!authEnabled) return next();
  if (OPEN.has(req.path)) return next();

  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token && isValid(token)) return next();

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Not signed in." });
  }
  // Real assets were already served upstream, so anything file-shaped reaching
  // here doesn't exist. Let it fall through to a genuine 404 - redirecting it
  // to the login page would hand the browser HTML in place of CSS or JS, which
  // fails silently and looks like a broken app rather than a missing file.
  if (/\.[a-zA-Z0-9]{1,8}$/.test(req.path)) return next();
  return res.redirect("/login");
}

export function handleLogin(req, res) {
  if (!authEnabled) return res.json({ ok: true, authRequired: false });
  if (!codeMatches(req.body?.code || "")) {
    return res.status(401).json({ error: "Incorrect access code." });
  }
  // Behind a proxy (Render, Fly, Vercel) the TLS terminates upstream.
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  createSession(res, secure);
  res.json({ ok: true });
}
