// Mock mode (ROTOBOT_MOCK=1): serves a realistic sample Sleeper league so the
// whole app - UI, roster views, matchups, AI context - can run without
// outbound network access. Live mode hits the real APIs.

export const MOCK = process.env.ROTOBOT_MOCK === "1";

export const mockState = { season: "2026", week: 1, season_type: "regular", league_season: "2026" };

export const mockUser = {
  user_id: "mock-user-1",
  username: "demo_manager",
  display_name: "Demo Manager",
  avatar: null,
};

export const mockLeague = {
  league_id: "mock-league-1",
  name: "Sunday Legends (Demo)",
  season: "2026",
  total_rosters: 10,
  status: "in_season",
  scoring_settings: { rec: 0.5, pass_td: 4, rush_td: 6, rec_td: 6, pass_yd: 0.04, rush_yd: 0.1, rec_yd: 0.1, fum_lost: -2, pass_int: -1 },
  roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "BN", "BN", "BN", "BN"],
  settings: { playoff_teams: 6, num_teams: 10 },
};

export const mockPlayers = {
  p1: { player_id: "p1", full_name: "Josh Allen", position: "QB", team: "BUF", status: "Active", injury_status: null, age: 30, years_exp: 8 },
  p2: { player_id: "p2", full_name: "Bijan Robinson", position: "RB", team: "ATL", status: "Active", injury_status: null, age: 24, years_exp: 3 },
  p3: { player_id: "p3", full_name: "Breece Hall", position: "RB", team: "NYJ", status: "Active", injury_status: "Questionable", age: 25, years_exp: 4 },
  p4: { player_id: "p4", full_name: "Justin Jefferson", position: "WR", team: "MIN", status: "Active", injury_status: null, age: 27, years_exp: 6 },
  p5: { player_id: "p5", full_name: "Marvin Harrison Jr.", position: "WR", team: "ARI", status: "Active", injury_status: null, age: 24, years_exp: 2 },
  p6: { player_id: "p6", full_name: "Sam LaPorta", position: "TE", team: "DET", status: "Active", injury_status: null, age: 25, years_exp: 3 },
  p7: { player_id: "p7", full_name: "James Cook", position: "RB", team: "BUF", status: "Active", injury_status: null, age: 26, years_exp: 4 },
  p8: { player_id: "p8", full_name: "Zay Flowers", position: "WR", team: "BAL", status: "Active", injury_status: null, age: 25, years_exp: 3 },
  p9: { player_id: "p9", full_name: "Jake Moody", position: "K", team: "SF", status: "Active", injury_status: null, age: 26, years_exp: 3 },
  p10: { player_id: "p10", full_name: "Cowboys D/ST", position: "DEF", team: "DAL", status: "Active", injury_status: null },
  p11: { player_id: "p11", full_name: "Jaylen Waddle", position: "WR", team: "MIA", status: "Active", injury_status: null, age: 27, years_exp: 5 },
  p12: { player_id: "p12", full_name: "Tony Pollard", position: "RB", team: "TEN", status: "Active", injury_status: null, age: 29, years_exp: 7 },
  p13: { player_id: "p13", full_name: "Jared Goff", position: "QB", team: "DET", status: "Active", injury_status: null, age: 31, years_exp: 10 },
  p14: { player_id: "p14", full_name: "Dalton Kincaid", position: "TE", team: "BUF", status: "Active", injury_status: "Doubtful", age: 26, years_exp: 3 },
  p15: { player_id: "p15", full_name: "Rashee Rice", position: "WR", team: "KC", status: "Active", injury_status: null, age: 26, years_exp: 3 },
  o1: { player_id: "o1", full_name: "Patrick Mahomes", position: "QB", team: "KC", status: "Active", injury_status: null },
  o2: { player_id: "o2", full_name: "Saquon Barkley", position: "RB", team: "PHI", status: "Active", injury_status: null },
  o3: { player_id: "o3", full_name: "Jahmyr Gibbs", position: "RB", team: "DET", status: "Active", injury_status: null },
  o4: { player_id: "o4", full_name: "CeeDee Lamb", position: "WR", team: "DAL", status: "Active", injury_status: null },
  o5: { player_id: "o5", full_name: "Nico Collins", position: "WR", team: "HOU", status: "Active", injury_status: null },
  o6: { player_id: "o6", full_name: "Trey McBride", position: "TE", team: "ARI", status: "Active", injury_status: null },
  o7: { player_id: "o7", full_name: "Kyren Williams", position: "RB", team: "LAR", status: "Active", injury_status: null },
  o8: { player_id: "o8", full_name: "Brandon Aubrey", position: "K", team: "DAL", status: "Active", injury_status: null },
  o9: { player_id: "o9", full_name: "Steelers D/ST", position: "DEF", team: "PIT", status: "Active", injury_status: null },
  t1: { player_id: "t1", full_name: "Jordan Mason", position: "RB", team: "MIN", status: "Active", injury_status: null },
  t2: { player_id: "t2", full_name: "Quentin Johnston", position: "WR", team: "LAC", status: "Active", injury_status: null },
  t3: { player_id: "t3", full_name: "Tyjae Spears", position: "RB", team: "TEN", status: "Active", injury_status: "Questionable" },
  t4: { player_id: "t4", full_name: "Cade Otton", position: "TE", team: "TB", status: "Active", injury_status: null },
};

export const mockRosters = [
  {
    roster_id: 1,
    owner_id: "mock-user-1",
    players: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12", "p13", "p14", "p15"],
    starters: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p9", "p10"],
    settings: { wins: 0, losses: 0, ties: 0, fpts: 0 },
  },
  {
    roster_id: 2,
    owner_id: "mock-user-2",
    players: ["o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8", "o9"],
    starters: ["o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8", "o9"],
    settings: { wins: 0, losses: 0, ties: 0, fpts: 0 },
  },
];

export const mockLeagueUsers = [
  { user_id: "mock-user-1", display_name: "Demo Manager", metadata: { team_name: "Gridiron Gurus" } },
  { user_id: "mock-user-2", display_name: "Rival Rick", metadata: { team_name: "Touchdown Titans" } },
];

export const mockMatchups = [
  { roster_id: 1, matchup_id: 1, points: 68.4, starters: mockRosters[0].starters, players_points: { p1: 22.1, p2: 14.3, p3: 6.2, p4: 11.8, p5: 4.0, p6: 3.5, p7: 2.5, p9: 4.0, p10: 0 } },
  { roster_id: 2, matchup_id: 1, points: 71.9, starters: mockRosters[1].starters, players_points: { o1: 25.4, o2: 18.2, o3: 9.1, o4: 8.7, o5: 3.2, o6: 2.3, o7: 1.0, o8: 4.0, o9: 0 } },
];

export const mockTrending = {
  add: [
    { player_id: "t1", count: 48213 },
    { player_id: "t2", count: 31877 },
    { player_id: "t3", count: 20114 },
    { player_id: "t4", count: 15920 },
  ],
  drop: [
    { player_id: "p12", count: 18220 },
    { player_id: "p14", count: 12034 },
  ],
};
