// League data endpoints backing the Team, Matchup, League, and Waivers tabs.
import express from "express";
import * as sleeper from "../services/sleeper.js";
import * as espn from "../services/espn.js";
import * as yahoo from "../services/yahoo.js";
import { getAccount } from "../lib/store.js";

const router = express.Router();

router.get("/leagues", async (req, res, next) => {
  try {
    const out = [];
    const sleeperAcct = getAccount("sleeper");
    if (sleeperAcct) {
      for (const l of sleeperAcct.leagues || []) out.push({ ...l, provider: "sleeper" });
    }
    const espnAcct = getAccount("espn");
    if (espnAcct) {
      for (const l of espnAcct.leagues || []) out.push({ ...l, provider: "espn" });
    }
    const yahooAcct = getAccount("yahoo");
    if (yahooAcct?.accessToken) {
      for (const l of yahooAcct.leagues || []) out.push({ ...l, provider: "yahoo" });
    }
    res.json({ leagues: out });
  } catch (err) {
    next(err);
  }
});

router.get("/overview", async (req, res, next) => {
  try {
    const { provider, leagueId } = req.query;
    if (!provider || !leagueId) {
      return res.status(400).json({ error: "provider and leagueId query params are required." });
    }
    let overview;
    if (provider === "sleeper") {
      const account = getAccount("sleeper");
      if (!account) return res.status(400).json({ error: "Sleeper is not linked." });
      overview = await sleeper.getLeagueOverview(String(leagueId), account.userId);
    } else if (provider === "espn") {
      const account = getAccount("espn");
      if (!account) return res.status(400).json({ error: "ESPN is not linked." });
      overview = await espn.getLeagueOverview(account);
    } else if (provider === "yahoo") {
      overview = await yahoo.getLeagueOverview(String(leagueId));
    } else {
      return res.status(400).json({ error: `Unknown provider "${provider}".` });
    }
    res.json(overview);
  } catch (err) {
    next(err);
  }
});

router.get("/trending", async (req, res, next) => {
  try {
    res.json(await sleeper.getTrendingDetailed());
  } catch (err) {
    next(err);
  }
});

export default router;
