// ESPN "log in" flow.
//
// ESPN publishes no OAuth for third-party apps, so the only way to reach a
// private league is with the session cookies (espn_s2 + SWID) that ESPN issues
// to a logged-in browser. Instead of asking the user to dig those out of
// DevTools, we open a real browser window on ESPN's own login page, let them
// sign in there normally (2FA included), and then read the cookies back out of
// that browser profile.
//
// The user's password is only ever typed into ESPN's real page - this app never
// renders a password field and never sees the credentials.

const LOGIN_URL = "https://www.espn.com/fantasy/football/";
const COOKIE_TIMEOUT_MS = 5 * 60 * 1000; // how long we'll wait for the user to finish
const POLL_MS = 1000;

// Single in-flight login attempt; this is a local single-user app.
let session = { status: "idle", message: "", cookies: null, startedAt: null };
let browserRef = null;

export function getStatus() {
  const { status, message } = session;
  return { status, message };
}

function set(status, message) {
  session.status = status;
  session.message = message;
}

export async function cancel() {
  if (browserRef) {
    try {
      await browserRef.close();
    } catch { /* already gone */ }
    browserRef = null;
  }
  if (session.status === "waiting" || session.status === "launching") {
    set("idle", "Login cancelled.");
  }
}

// The three launch failures have completely different fixes, so name the right one.
function explainLaunchFailure(err) {
  const msg = err?.message || "";
  if (/Executable doesn't exist|playwright install/i.test(msg)) {
    return "The browser isn't downloaded yet. Run `npx playwright install chromium` in the project folder, then try again.";
  }
  if (/Missing X server|no display|DISPLAY|cannot open display/i.test(msg)) {
    return "No desktop session available, so a browser window can't be shown. Run this app on your own computer, or use the manual cookie option below.";
  }
  return `Couldn't open a browser window: ${msg.split("\n")[0]}`;
}

// Starts the browser handoff. Returns immediately; the caller polls getStatus().
export async function start(onSuccess) {
  if (session.status === "launching" || session.status === "waiting") {
    return getStatus();
  }
  session = { status: "launching", message: "Opening a browser window…", cookies: null, startedAt: Date.now() };

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    set(
      "error",
      "Playwright isn't installed. Run `npm install` then `npx playwright install chromium`, or use the manual cookie option below."
    );
    return getStatus();
  }

  // Run the rest in the background so the HTTP request returns right away.
  (async () => {
    let browser;
    try {
      browser = await chromium.launch({ headless: false });
      browserRef = browser;
    } catch (err) {
      set("error", explainLaunchFailure(err));
      browserRef = null;
      return;
    }

    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
      set("waiting", "Log in to ESPN in the browser window that just opened. This page will update automatically.");

      const deadline = Date.now() + COOKIE_TIMEOUT_MS;
      let captured = null;

      while (Date.now() < deadline) {
        if (!browserRef) return; // cancelled
        // If the user closed the window, stop waiting.
        if (!browser.isConnected()) {
          set("error", "The browser window was closed before login finished.");
          browserRef = null;
          return;
        }

        const cookies = await context.cookies().catch(() => []);
        const s2 = cookies.find((c) => c.name === "espn_s2");
        const swid = cookies.find((c) => c.name === "SWID");
        if (s2?.value && swid?.value) {
          captured = { espnS2: decodeURIComponent(s2.value), swid: swid.value };
          break;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }

      if (!captured) {
        set("error", "Timed out waiting for an ESPN login. Try again, or use the manual cookie option below.");
        return;
      }

      set("capturing", "Login detected — loading your leagues…");
      try {
        await onSuccess(captured);
        set("done", "Logged in to ESPN.");
      } catch (err) {
        set("error", `Signed in, but loading your leagues failed: ${err.message}`);
      }
    } catch (err) {
      set("error", err.message || "ESPN login failed.");
    } finally {
      try {
        await browser.close();
      } catch { /* ignore */ }
      browserRef = null;
    }
  })();

  return getStatus();
}
