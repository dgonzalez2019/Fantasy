// Account linking: connect / inspect / disconnect Sleeper, ESPN, and Yahoo.
import express from "express";
import * as sleeper from "../services/sleeper.js";
import * as espn from "../services/espn.js";
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
      hasCredentials: Boolean(account.clientId && account.clientSecret),
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

// ---- Yahoo: OAuth2 (user supplies their own registered app credentials) ----
router.post("/yahoo/credentials", (req, res) => {
  const clientId = String(req.body.clientId || "").trim();
  const clientSecret = String(req.body.clientSecret || "").trim();
  const redirectUri = String(req.body.redirectUri || "").trim();
  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(400).json({ error: "clientId, clientSecret, and redirectUri are all required." });
  }
  const existing = getAccount("yahoo") || {};
  const account = setAccount("yahoo", { ...existing, clientId, clientSecret, redirectUri });
  res.json({
    ok: true,
    authUrl: yahoo.buildAuthUrl({ clientId, redirectUri }),
    account: publicView("yahoo", account),
  });
});

router.get("/yahoo/callback", async (req, res) => {
  const account = getAccount("yahoo");
  const code = req.query.code;
  if (!account?.clientId) return res.status(400).send("Yahoo credentials are not configured yet.");
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
