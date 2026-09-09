// Yahoo Fantasy integration via OAuth2. Yahoo requires you to register your own
// (free) app at https://developer.yahoo.com/apps/create/ to get a client ID and
// secret - there is no way for a third-party app to skip this. The client
// ID/secret are stored locally and used for the standard authorization-code flow.
import { fetchJson, HttpError } from "../lib/http.js";
import { getAccount, setAccount } from "../lib/store.js";

const AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
const API = "https://fantasysports.yahooapis.com/fantasy/v2";

// Credentials can come from the environment (set once, then login is one click)
// or from the Settings form as a fallback.
export function configuredCredentials() {
  const clientId = process.env.YAHOO_CLIENT_ID;
  const clientSecret = process.env.YAHOO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// Env credentials win, so a configured deployment ignores stale stored ones.
export function resolveCredentials(account = {}) {
  const env = configuredCredentials();
  return {
    clientId: env?.clientId || account.clientId,
    clientSecret: env?.clientSecret || account.clientSecret,
    redirectUri: account.redirectUri || process.env.YAHOO_REDIRECT_URI,
  };
}

export function buildAuthUrl({ clientId, redirectUri }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    language: "en-us",
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(account, body) {
  const { clientId, clientSecret } = resolveCredentials(account);
  if (!clientId || !clientSecret) {
    throw new HttpError(400, "Yahoo credentials are not configured.");
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  return fetchJson(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
}

export async function exchangeCode(account, code) {
  const tokens = await tokenRequest(account, {
    grant_type: "authorization_code",
    code,
    redirect_uri: account.redirectUri,
  });
  return storeTokens(account, tokens);
}

async function refresh(account) {
  const tokens = await tokenRequest(account, {
    grant_type: "refresh_token",
    refresh_token: account.refreshToken,
    redirect_uri: account.redirectUri,
  });
  return storeTokens(account, tokens);
}

function storeTokens(account, tokens) {
  const updated = {
    ...account,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || account.refreshToken,
    expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
  };
  setAccount("yahoo", updated);
  return updated;
}

async function apiGet(path) {
  let account = getAccount("yahoo");
  if (!account?.accessToken) {
    throw new HttpError(401, "Yahoo account is not linked yet");
  }
  if (Date.now() > (account.expiresAt || 0) - 60000) {
    account = await refresh(account);
  }
  const url = `${API}${path}${path.includes("?") ? "&" : "?"}format=json`;
  try {
    return await fetchJson(url, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      account = await refresh(account);
      return fetchJson(url, {
        headers: { Authorization: `Bearer ${account.accessToken}` },
      });
    }
    throw err;
  }
}

// Yahoo's JSON wraps everything in arrays of single-key objects; flatten them.
function flat(node) {
  if (!Array.isArray(node)) return node || {};
  return node.reduce((acc, part) => {
    if (part && typeof part === "object") Object.assign(acc, part);
    return acc;
  }, {});
}

function collection(node, key) {
  // { "0": { league: [...] }, "1": {...}, count: 2 } -> [entry, entry]
  const out = [];
  if (!node) return out;
  for (const k of Object.keys(node)) {
    if (k === "count") continue;
    const entry = node[k]?.[key];
    if (entry) out.push(entry);
  }
  return out;
}

export async function getLeagues() {
  const data = await apiGet("/users;use_login=1/games;game_keys=nfl/leagues");
  const user = flat(data?.fantasy_content?.users?.["0"]?.user);
  const games = collection(user.games, "game");
  const leagues = [];
  for (const game of games) {
    const g = flat(game);
    for (const league of collection(g.leagues, "league")) {
      const l = flat(league);
      leagues.push({
        id: l.league_key,
        name: l.name,
        season: String(l.season || ""),
        size: Number(l.num_teams || 0),
        scoring: l.scoring_type === "headpoint" ? "Points" : l.scoring_type || "",
        week: Number(l.current_week || 1),
      });
    }
  }
  return leagues;
}

export async function getMyTeams() {
  const data = await apiGet("/users;use_login=1/games;game_keys=nfl/teams");
  const user = flat(data?.fantasy_content?.users?.["0"]?.user);
  const games = collection(user.games, "game");
  const teams = [];
  for (const game of games) {
    const g = flat(game);
    for (const team of collection(g.teams, "team")) {
      // A team is [ [meta parts], ... ]
      const meta = flat(Array.isArray(team) ? team[0] : team);
      teams.push({
        teamKey: meta.team_key,
        name: meta.name,
        leagueKey: (meta.team_key || "").split(".t.")[0],
      });
    }
  }
  return teams;
}

export async function getRoster(teamKey) {
  const data = await apiGet(`/team/${teamKey}/roster/players`);
  const team = data?.fantasy_content?.team;
  const rosterNode = Array.isArray(team) ? team[1]?.roster : null;
  const playersNode = rosterNode?.["0"]?.players;
  const result = [];
  for (const player of collection(playersNode, "player")) {
    const meta = flat(Array.isArray(player) ? player[0] : player);
    const selected = flat(Array.isArray(player) ? player[1]?.selected_position : null);
    result.push({
      id: meta.player_key,
      name: meta.name?.full || "Unknown",
      position: meta.display_position || "?",
      team: meta.editorial_team_abbr?.toUpperCase() || "FA",
      injury: meta.status_full || meta.status || null,
      slot: selected.position || "BN",
    });
  }
  return result;
}

export async function getLeagueOverview(leagueKey) {
  const [leagues, teams] = await Promise.all([getLeagues(), getMyTeams()]);
  const league = leagues.find((l) => l.id === leagueKey) || leagues[0];
  if (!league) throw new HttpError(404, "No Yahoo leagues found for this account");
  const myTeam = teams.find((t) => t.leagueKey === league.id);
  const roster = myTeam ? await getRoster(myTeam.teamKey) : [];
  const starters = roster.filter((p) => !["BN", "IR"].includes(p.slot));
  const bench = roster.filter((p) => ["BN", "IR"].includes(p.slot));
  return {
    provider: "yahoo",
    league: {
      id: league.id,
      name: league.name,
      season: league.season,
      size: league.size,
      rosterPositions: [],
      scoring: league.scoring,
      scoringSettings: {},
    },
    week: league.week,
    teams: [],
    my: myTeam ? { rosterId: myTeam.teamKey, starters, bench } : null,
    matchup: null,
  };
}
