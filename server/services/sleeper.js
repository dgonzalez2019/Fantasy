// Sleeper integration. Sleeper exposes a public read-only REST API, so linking
// only needs a username - no OAuth. https://docs.sleeper.com/
import { fetchJson } from "../lib/http.js";
import { readCache, writeCache } from "../lib/store.js";
import {
  MOCK, mockState, mockUser, mockLeague, mockRosters,
  mockLeagueUsers, mockMatchups, mockPlayers, mockTrending,
} from "../lib/mock.js";

const BASE = "https://api.sleeper.app/v1";
const PLAYERS_CACHE = "sleeper_players_nfl.json";
const PLAYERS_TTL_MS = 24 * 60 * 60 * 1000; // Sleeper asks for at most one fetch/day

export async function getNflState() {
  if (MOCK) return mockState;
  return fetchJson(`${BASE}/state/nfl`);
}

export async function getUser(username) {
  if (MOCK) return mockUser;
  return fetchJson(`${BASE}/user/${encodeURIComponent(username)}`);
}

export async function getUserLeagues(userId, season) {
  if (MOCK) return [mockLeague];
  return fetchJson(`${BASE}/user/${userId}/leagues/nfl/${season}`);
}

export async function getLeague(leagueId) {
  if (MOCK) return mockLeague;
  return fetchJson(`${BASE}/league/${leagueId}`);
}

export async function getRosters(leagueId) {
  if (MOCK) return mockRosters;
  return fetchJson(`${BASE}/league/${leagueId}/rosters`);
}

export async function getLeagueUsers(leagueId) {
  if (MOCK) return mockLeagueUsers;
  return fetchJson(`${BASE}/league/${leagueId}/users`);
}

export async function getMatchups(leagueId, week) {
  if (MOCK) return mockMatchups;
  return fetchJson(`${BASE}/league/${leagueId}/matchups/${week}`);
}

let playersMemo = null;
export async function getPlayers() {
  if (MOCK) return mockPlayers;
  if (playersMemo) return playersMemo;
  const cached = readCache(PLAYERS_CACHE, PLAYERS_TTL_MS);
  if (cached) {
    playersMemo = cached;
    return cached;
  }
  // ~5MB payload; cached to disk for 24h per Sleeper's guidance.
  const players = await fetchJson(`${BASE}/players/nfl`, { timeoutMs: 60000 });
  writeCache(PLAYERS_CACHE, players);
  playersMemo = players;
  return players;
}

export async function getTrending(type = "add", limit = 25) {
  if (MOCK) return mockTrending[type] || [];
  return fetchJson(`${BASE}/players/nfl/trending/${type}?lookback_hours=24&limit=${limit}`);
}

// ---- Normalized views used by the API routes and the AI context builder ----

export function playerSummary(players, id) {
  const p = players[id];
  if (!p) return { id, name: id, position: "?", team: "FA" };
  return {
    id,
    name: p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || id,
    position: p.position || "?",
    team: p.team || "FA",
    injury: p.injury_status || null,
    status: p.status || null,
    age: p.age ?? null,
    yearsExp: p.years_exp ?? null,
  };
}

export async function getLeagueOverview(leagueId, userId) {
  const [league, rosters, users, state] = await Promise.all([
    getLeague(leagueId),
    getRosters(leagueId),
    getLeagueUsers(leagueId),
    getNflState(),
  ]);
  const players = await getPlayers();
  const week = Math.max(1, state.week || 1);
  const matchups = await getMatchups(leagueId, week).catch(() => []);

  const userByOwner = Object.fromEntries(users.map((u) => [u.user_id, u]));
  const teams = rosters.map((r) => {
    const owner = userByOwner[r.owner_id] || {};
    return {
      rosterId: r.roster_id,
      ownerId: r.owner_id,
      ownerName: owner.display_name || "Unknown",
      teamName: owner.metadata?.team_name || owner.display_name || `Team ${r.roster_id}`,
      wins: r.settings?.wins ?? 0,
      losses: r.settings?.losses ?? 0,
      ties: r.settings?.ties ?? 0,
      pointsFor: round2((r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100),
      isMine: r.owner_id === userId,
    };
  });

  const myRoster = rosters.find((r) => r.owner_id === userId) || null;
  let my = null;
  let matchup = null;
  if (myRoster) {
    my = {
      rosterId: myRoster.roster_id,
      starters: (myRoster.starters || []).map((id) => playerSummary(players, id)),
      bench: (myRoster.players || [])
        .filter((id) => !(myRoster.starters || []).includes(id))
        .map((id) => playerSummary(players, id)),
    };

    const mine = matchups.find((m) => m.roster_id === myRoster.roster_id);
    if (mine) {
      const opp = matchups.find(
        (m) => m.matchup_id === mine.matchup_id && m.roster_id !== mine.roster_id
      );
      const oppTeam = opp ? teams.find((t) => t.rosterId === opp.roster_id) : null;
      matchup = {
        week,
        myPoints: round2(mine.points || 0),
        myStarters: (mine.starters || []).map((id) => ({
          ...playerSummary(players, id),
          points: round2(mine.players_points?.[id] ?? 0),
        })),
        oppPoints: opp ? round2(opp.points || 0) : null,
        oppName: oppTeam?.teamName || "Opponent",
        oppStarters: opp
          ? (opp.starters || []).map((id) => ({
              ...playerSummary(players, id),
              points: round2(opp.players_points?.[id] ?? 0),
            }))
          : [],
      };
    }
  }

  return {
    provider: "sleeper",
    league: {
      id: league.league_id,
      name: league.name,
      season: league.season,
      size: league.total_rosters,
      rosterPositions: league.roster_positions || [],
      scoring: describeScoring(league.scoring_settings || {}),
      scoringSettings: league.scoring_settings || {},
    },
    week,
    teams: teams.sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor),
    my,
    matchup,
  };
}

export async function getTrendingDetailed() {
  const players = await getPlayers();
  const [add, drop] = await Promise.all([getTrending("add"), getTrending("drop")]);
  const detail = (list) =>
    list.map((t) => ({ ...playerSummary(players, t.player_id), count: t.count }));
  return { add: detail(add), drop: detail(drop) };
}

export function describeScoring(s) {
  const rec = s.rec ?? 0;
  const fmt = rec === 1 ? "Full PPR" : rec === 0.5 ? "Half PPR" : rec === 0 ? "Standard" : `${rec} PPR`;
  return `${fmt} · ${s.pass_td ?? 4}pt pass TD`;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
