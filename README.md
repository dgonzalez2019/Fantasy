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

## Logging in

**Your password is never typed into this app.** Each provider hands you off to its own
sign-in page. There is no password field anywhere in this UI, by design — a local app
rendering an ESPN or Yahoo password form is indistinguishable from a phishing page, and
it would put your credentials through code that has no business holding them.

### Sleeper
Just your username. Sleeper's API is public and read-only, so there's no login at all.

### ESPN — "Log in with ESPN"
ESPN publishes no OAuth for third-party apps. The only thing that opens a private league
is the session cookie ESPN issues to a logged-in browser, so this app gets one the honest
way: it opens a real browser window on ESPN's own login page, you sign in normally (2FA
included), and it reads the session back out once you're through. Your leagues are then
discovered automatically — no league ID to hunt down.

Needs a desktop session and a one-time `npx playwright install chromium`. On a headless
box, or if the window won't open, *Enter cookies manually instead* is still there:
DevTools → Application → Cookies → `espn.com`, copy `espn_s2` and `SWID`.

### Yahoo — "Log in with Yahoo"
Yahoo has real OAuth2, so login is one click. Yahoo does require every app to register
its own credentials, which is a one-time setup you do as the developer:

1. Create an app at [developer.yahoo.com/apps/create](https://developer.yahoo.com/apps/create/)
2. Give it **Fantasy Sports → Read** permission
3. Put the Client ID, Secret, and Redirect URI in `.env` (see `.env.example`)

After that the Settings tab is just a login button, and tokens refresh on their own.
Yahoo requires an HTTPS redirect URI, so local use needs a tunnel such as
[ngrok](https://ngrok.com/). You can also paste the credentials into Settings instead of
`.env` if you'd rather not restart the server.

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
| `YAHOO_CLIENT_ID` | — | Makes Yahoo a one-click login |
| `YAHOO_CLIENT_SECRET` | — | Paired with the above |
| `YAHOO_REDIRECT_URI` | — | Must match your Yahoo app config (HTTPS) |

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Server status, mock mode, whether a key is configured |
| `GET /api/accounts` | Linked accounts (secrets redacted) |
| `POST /api/accounts/sleeper` | Link by username |
| `POST /api/accounts/espn/login` | Open ESPN's login page in a browser |
| `GET /api/accounts/espn/login/status` | Poll the login handoff |
| `POST /api/accounts/espn/select` | Choose the active ESPN league |
| `POST /api/accounts/espn` | Link by league ID + cookies (fallback) |
| `POST /api/accounts/yahoo/login` | Begin Yahoo OAuth, returns auth URL |
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
- **ESPN sessions expire.** Cookies last a few weeks; when calls start failing, click
  *Log in with ESPN* again. Yahoo refreshes its own tokens and shouldn't need this.
