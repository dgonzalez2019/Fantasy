// ESPN Fantasy integration. ESPN has no public OAuth for third parties; the
// standard approach (used by every ESPN fantasy tool) is the read API plus the
// user's own espn_s2 + SWID cookies for private leagues.
import { fetchJson } from "../lib/http.js";

const BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

const POSITIONS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF" };
const LINEUP_SLOTS = {
  0: "QB", 2: "RB", 3: "RB/WR", 4: "WR", 5: "WR/TE", 6: "TE", 7: "OP",
  16: "DEF", 17: "K", 20: "BN", 21: "IR", 23: "FLEX",
};
const PRO_TEAMS = {
  0: "FA", 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
  8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR",
  15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI",
  22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH",
  29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};
const INJURY = { ACTIVE: null, QUESTIONABLE: "Questionable", DOUBTFUL: "Doubtful", OUT: "Out", INJURY_RESERVE: "IR", SUSPENSION: "Suspended" };

function headers(account) {
  const h = {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (rotobot-replica)",
    "x-fantasy-platform": "kona-PROD",
    "x-fantasy-source": "kona",
  };
  if (account.espnS2 && account.swid) {
    h.Cookie = `espn_s2=${account.espnS2}; SWID=${account.swid}`;
  }
  return h;
}

export async function fetchLeague(account, views = ["mTeam", "mRoster", "mMatchupScore", "mSettings"]) {
  const { leagueId, season } = account;
  const qs = views.map((v) => `view=${v}`).join("&");
  const url = `${BASE}/seasons/${season}/segments/0/leagues/${leagueId}?${qs}`;
  return fetchJson(url, { headers: headers(account) });
}

// Verifies credentials and figures out which team belongs to the linked user (by SWID).
export async function verifyAndDescribe(account) {
  const data = await fetchLeague(account, ["mTeam", "mSettings"]);
  const swid = (account.swid || "").toUpperCase();
  const me = (data.members || []).find((m) => (m.id || "").toUpperCase() === swid);
  const myTeam = me
    ? (data.teams || []).find((t) => (t.owners || []).map((o) => o.toUpperCase()).includes(swid))
    : null;
  return {
    leagueName: data.settings?.name || `ESPN League ${account.leagueId}`,
    seasonId: data.seasonId,
    teamCount: (data.teams || []).length,
    myTeamId: myTeam?.id ?? null,
    myTeamName: myTeam ? teamName(myTeam) : null,
  };
}

function teamName(t) {
  return t.name || `${t.location || ""} ${t.nickname || ""}`.trim() || `Team ${t.id}`;
}

function playerFromEntry(entry) {
  const p = entry.playerPoolEntry?.player || entry.player || {};
  return {
    id: String(p.id ?? ""),
    name: p.fullName || "Unknown",
    position: POSITIONS[p.defaultPositionId] || "?",
    team: PRO_TEAMS[p.proTeamId] ?? "FA",
    injury: INJURY[p.injuryStatus] ?? (p.injuryStatus || null),
    status: null,
    slot: LINEUP_SLOTS[entry.lineupSlotId] || "BN",
    points: null,
  };
}

export async function getLeagueOverview(account) {
  const data = await fetchLeague(account);
  const week = data.scoringPeriodId || 1;
  const swid = (account.swid || "").toUpperCase();
  const teams = (data.teams || []).map((t) => ({
    rosterId: t.id,
    ownerName: teamName(t),
    teamName: teamName(t),
    wins: t.record?.overall?.wins ?? 0,
    losses: t.record?.overall?.losses ?? 0,
    ties: t.record?.overall?.ties ?? 0,
    pointsFor: Math.round((t.record?.overall?.pointsFor ?? 0) * 100) / 100,
    isMine: (t.owners || []).map((o) => (o || "").toUpperCase()).includes(swid),
  }));

  const myTeam = (data.teams || []).find((t) =>
    (t.owners || []).map((o) => (o || "").toUpperCase()).includes(swid)
  ) || (data.teams || [])[0];

  let my = null;
  if (myTeam) {
    const entries = myTeam.roster?.entries || [];
    const starters = entries.filter((e) => ![20, 21].includes(e.lineupSlotId)).map(playerFromEntry);
    const bench = entries.filter((e) => [20, 21].includes(e.lineupSlotId)).map(playerFromEntry);
    my = { rosterId: myTeam.id, starters, bench };
  }

  // Current-week matchup from the schedule.
  let matchup = null;
  const game = (data.schedule || []).find(
    (g) =>
      g.matchupPeriodId === (data.status?.currentMatchupPeriod || week) &&
      (g.home?.teamId === myTeam?.id || g.away?.teamId === myTeam?.id)
  );
  if (game && myTeam) {
    const mineSide = game.home?.teamId === myTeam.id ? game.home : game.away;
    const oppSide = game.home?.teamId === myTeam.id ? game.away : game.home;
    const oppTeam = (data.teams || []).find((t) => t.id === oppSide?.teamId);
    matchup = {
      week,
      myPoints: mineSide?.totalPoints ?? 0,
      myStarters: my?.starters || [],
      oppPoints: oppSide?.totalPoints ?? null,
      oppName: oppTeam ? teamName(oppTeam) : "Opponent",
      oppStarters: [],
    };
  }

  const scoringType = data.settings?.scoringSettings?.scoringType;
  return {
    provider: "espn",
    league: {
      id: String(data.id),
      name: data.settings?.name || `ESPN League ${account.leagueId}`,
      season: String(data.seasonId),
      size: teams.length,
      rosterPositions: [],
      scoring: scoringType === "PPR" ? "PPR" : scoringType || "ESPN scoring",
      scoringSettings: {},
    },
    week,
    teams: teams.sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor),
    my,
    matchup,
  };
}
