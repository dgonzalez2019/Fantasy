// Account linking: connect / inspect / disconnect Sleeper, ESPN, and Yahoo.
import express from "express";
import * as sleeper from "../services/sleeper.js";
import * as espn from "../services/espn.js";
import * as espnLogin from "../services/espn-login.js";
import * as yahoo from "../services/yahoo.js";
import { readStore, getAccount, setAccount, removeAccount } from "../lib/store.js";
import { MOCK } from "../lib/mock.js";

const router = express.Router();

// Never leak secrets (cookies, tokens, client secrets) back to the browser.
function publicView(provider, account) {
  if (!account) return { provider, linked: false };
  const base = { provider, linked: true, linkedAt: account.linkedAt, leagues: account.leagues || [] };
  if (provider === "sleeper") {
    return { ...base, username: account.username, displayName: account.displayName, userId: account.userId };
  }
  if (provider === "espn") {
    return {
      ...base,
      leagueId: account.leagueId,
      season: account.season,
      teamName: account.myTeamName,
      hasCookies: Boolean(account.espnS2 && account.swid),
    };
  }
  if (provider === "yahoo") {
    return {
      ...base,
      hasCredentials: Boolean(yahoo.configuredCredentials() || (account.clientId && account.clientSecret)),
      authorized: Boolean(account.accessToken),
      redirectUri: account.redirectUri,
    };
  }
  return base;
}

router.get("/", (req, res) => {
  const store = readStore();
  res.json({
    mock: MOCK,
    // Tells the UI whether it can offer one-click login buttons. The ESPN
    // handoff opens a window on the machine running the server, so it's
    // meaningless once this is hosted somewhere else.
    capabilities: {
      espnBrowserLogin: process.env.ROTOBOT_HOSTED !== "1",
      yahooConfigured: Boolean(yahoo.configuredCredentials()),
    },
    accounts: ["sleeper", "espn", "yahoo"].map((p) => publicView(p, store.accounts[p])),
  });
});

// ---- Sleeper: username only ----
router.post("/sleeper", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    if (!username) return res.status(400).json({ error: "A Sleeper username is required." });

    const user = await sleeper.getUser(username);
    if (!user?.user_id) {
      return res.status(404).json({ error: `No Sleeper user found named "${username}".` });
    }
    const state = await sleeper.getNflState();
    const season = state.league_season || state.season;
    const raw = (await sleeper.getUserLeagues(user.user_id, season)) || [];
    const leagues = raw.map((l) => ({
      id: l.league_id,
      name: l.name,
      season: l.season,
      size: l.total_rosters,
      scoring: sleeper.describeScoring(l.scoring_settings || {}),
    }));

    const account = setAccount("sleeper", {
      username: user.username,
      displayName: user.display_name,
      userId: user.user_id,
      leagues,
    });
    res.json({ ok: true, account: publicView("sleeper", account) });
  } catch (err) {
    next(err);
  }
});

// ---- ESPN: leagueId + season, plus cookies for private leagues ----
router.post("/espn", async (req, res, next) => {
  try {
    const leagueId = String(req.body.leagueId || "").trim();
    const season = String(req.body.season || new Date().getFullYear()).trim();
    const espnS2 = String(req.body.espnS2 || "").trim();
    const swid = String(req.body.swid || "").trim();
    if (!leagueId) return res.status(400).json({ error: "An ESPN league ID is required." });

    const candidate = { leagueId, season, espnS2, swid };
    const info = await espn.verifyAndDescribe(candidate);
    const account = setAccount("espn", {
      ...candidate,
      myTeamId: info.myTeamId,
      myTeamName: info.myTeamName,
      leagues: [{ id: leagueId, name: info.leagueName, season, size: info.teamCount, scoring: "ESPN" }],
    });
    res.json({ ok: true, account: publicView("espn", account) });
  } catch (err) {
    if (err.status === 401) {
      err.userMessage =
        "ESPN rejected the request. Private leagues need valid espn_s2 and SWID cookies from a browser where you're logged in.";
    }
    next(err);
  }
});

// ---- ESPN: browser handoff login ----
// Opens ESPN's real login page in a browser window and captures the session
// cookies once the user signs in. No password ever passes through this app.
router.post("/espn/login", async (req, res, next) => {
  try {
    const status = await espnLogin.start(async ({ espnS2, swid }) => {
      const leagues = await espn.discoverLeagues({ espnS2, swid });
      const first = leagues[0];
      setAccount("espn", {
        espnS2,
        swid,
        leagueId: first?.id || "",
        season: first?.season || String(new Date().getFullYear()),
        myTeamName: first?.teamName || null,
        leagues,
      });
    });
    res.json(status);
  } catch (err) {
    next(err);
  }
});

router.get("/espn/login/status", (req, res) => {
  const status = espnLogin.getStatus();
  const account = getAccount("espn");
  res.json({ ...status, leagues: account?.leagues || [] });
});

router.post("/espn/login/cancel", async (req, res) => {
  await espnLogin.cancel();
  res.json({ ok: true });
});

// Switch which discovered ESPN league is the active one.
router.post("/espn/select", async (req, res, next) => {
  try {
    const account = getAccount("espn");
    if (!account) return res.status(400).json({ error: "ESPN is not linked." });
    const leagueId = String(req.body.leagueId || "").trim();
    const league = (account.leagues || []).find((l) => String(l.id) === leagueId);
    if (!league) return res.status(404).json({ error: "That league isn't in your ESPN account." });
    setAccount("espn", {
      ...account,
      leagueId: league.id,
      season: league.season,
      myTeamName: league.teamName || account.myTeamName,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Yahoo: OAuth2 ----
// Starts the OAuth flow. With YAHOO_CLIENT_ID/SECRET configured this needs no
// input at all, so the UI is a single "Log in with Yahoo" button.
router.post("/yahoo/login", (req, res) => {
  const existing = getAccount("yahoo") || {};
  const redirectUri =
    String(req.body.redirectUri || "").trim() || existing.redirectUri || process.env.YAHOO_REDIRECT_URI;
  const { clientId, clientSecret } = yahoo.resolveCredentials({
    ...existing,
    clientId: String(req.body.clientId || "").trim() || existing.clientId,
    clientSecret: String(req.body.clientSecret || "").trim() || existing.clientSecret,
  });

  if (!clientId || !clientSecret) {
    return res.status(400).json({
      error:
        "Yahoo needs app credentials. Set YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET in your .env file, or enter them below.",
    });
  }
  if (!redirectUri) {
    return res.status(400).json({ error: "A redirect URI is required." });
  }

  setAccount("yahoo", { ...existing, clientId, clientSecret, redirectUri });
  res.json({ ok: true, authUrl: yahoo.buildAuthUrl({ clientId, redirectUri }) });
});

router.get("/yahoo/callback", async (req, res) => {
  const account = getAccount("yahoo");
  const code = req.query.code;
  if (!yahoo.resolveCredentials(account || {}).clientId) {
    return res.status(400).send("Yahoo credentials are not configured yet.");
  }
  if (!code) return res.status(400).send(`Yahoo returned no authorization code. ${req.query.error || ""}`);
  try {
    await yahoo.exchangeCode(account, String(code));
    // Cache the league list so Settings can show it immediately.
    try {
      const leagues = await yahoo.getLeagues();
      setAccount("yahoo", { ...getAccount("yahoo"), leagues });
    } catch { /* league list is best-effort */ }
    res.redirect("/?linked=yahoo");
  } catch (err) {
    res.status(500).send(`Yahoo token exchange failed: ${err.message}`);
  }
});

router.delete("/:provider", (req, res) => {
  removeAccount(req.params.provider);
  res.json({ ok: true });
});

export default router;
