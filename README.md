# RotoBot — AI Fantasy Football Manager

A self-hosted replica of RotoBot AI: link your fantasy football accounts and get an AI
assistant that answers lineup, waiver, and trade questions using your *actual* roster,
scoring settings, and current matchup.

![tabs: Assistant, My Team, Matchup, Waivers, League, Settings](https://img.shields.io/badge/stack-Node%20%2B%20Express%20%2B%20Claude-14e07a)

## What it does

- **Assistant** — streaming chat with Claude, grounded in your live league data. Ask
  "who should I start?", "any waiver pickups?", "is this trade fair?"
- **My Team** — starters and bench with positions, NFL teams, and injury designations.
- **Matchup** — current-week head-to-head score with per-player points.
- **Waivers** — most-added and most-dropped players across all Sleeper leagues (last 24h).
- **League** — standings with your team highlighted.
- **Settings** — link and disconnect Sleeper, ESPN, and Yahoo.

## Setup

```bash
npm install
cp .env.example .env      # add your ANTHROPIC_API_KEY
npm start                 # http://localhost:3000
```

Get an API key at [console.anthropic.com](https://console.anthropic.com/). Everything
runs locally; credentials live in `data/store.json` (gitignored) and are never sent
anywhere except the provider they belong to.

### Try it without linking anything

```bash
npm run mock
```

Serves a full sample league so you can click through every tab. The AI chat still needs
a real API key.

## Linking your accounts

### Sleeper — easiest
Just your username. Sleeper's API is public and read-only, so there's no password or
OAuth step. Enter it in Settings and your leagues appear immediately.

### ESPN
Needs your **league ID** (the `leagueId=` number in your ESPN fantasy URL) and the
**season**. Public leagues work with just those two.

Private leagues also need two cookies. Sign in at fantasy.espn.com, open DevTools →
Application → Cookies → `espn.com`, and copy `espn_s2` and `SWID`. ESPN offers no public
OAuth for third-party apps, so this is the standard approach for every ESPN fantasy tool.
The cookies are stored only on your machine and sent only to ESPN.

### Yahoo
Yahoo requires each app to register its own credentials — there's no way around this.

1. Create an app at [developer.yahoo.com/apps/create](https://developer.yahoo.com/apps/create/)
2. Give it **Fantasy Sports → Read** permission
3. Paste the Redirect URI shown in Settings into the Yahoo app config
4. Copy the Client ID and Secret back into Settings, then click Authorize

Yahoo requires HTTPS redirect URIs, so local development needs a tunnel such as
[ngrok](https://ngrok.com/). Tokens refresh automatically once authorized.

## How the AI stays grounded

Every chat request rebuilds a live context block — your starters and bench with injury
tags, the current matchup and scores, league standings, scoring format, and trending
adds/drops — and sends it as a system prompt alongside your question. The assistant is
told the live block always wins over its training data, so it won't invent this week's
stats. The persona prompt is cached (`cache_control: ephemeral`) so repeat questions in a
session are cheaper.

Preview exactly what the model sees:

```bash
curl "localhost:3000/api/chat/context?provider=sleeper&leagueId=YOUR_LEAGUE_ID"
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required for the assistant |
| `PORT` | `3000` | HTTP port |
| `ROTOBOT_MODEL` | `claude-opus-5` | Model used for chat |
| `ROTOBOT_MOCK` | unset | `1` serves sample data instead of live APIs |

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Server status, mock mode, whether a key is configured |
| `GET /api/accounts` | Linked accounts (secrets redacted) |
| `POST /api/accounts/sleeper` | Link by username |
| `POST /api/accounts/espn` | Link by league ID + optional cookies |
| `POST /api/accounts/yahoo/credentials` | Save OAuth app creds, returns auth URL |
| `DELETE /api/accounts/:provider` | Disconnect |
| `GET /api/fantasy/leagues` | All leagues across linked providers |
| `GET /api/fantasy/overview` | Roster, matchup, standings for one league |
| `GET /api/fantasy/trending` | Trending adds/drops |
| `POST /api/chat` | Streaming chat (SSE) |
| `GET /api/chat/context` | Debug: the context block sent to the model |

## Layout

```
server/
  index.js              Express app, static hosting, error handling
  routes/               accounts, fantasy, chat (SSE)
  services/             sleeper, espn, yahoo, ai (Claude)
  lib/                  store (JSON persistence), http, mock data
public/                 index.html, app.js, styles.css — no build step
```

## Notes and limits

- **Read-only.** It advises; it doesn't submit lineups or waiver claims. Setting a lineup
  requires write scopes that Sleeper and ESPN don't expose publicly.
- **Projections.** There's no free public projection feed, so the assistant reasons from
  roles, matchups, injury designations, and the trending-player market rather than quoting
  projected point totals.
- **Single user.** Credentials sit in a local JSON file with no auth layer in front. Don't
  deploy this to a public host as-is — add authentication and encrypt the store first.
