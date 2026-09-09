// RotoBot's brain: builds a live fantasy context (roster, matchup, standings,
// trending players) and streams Claude's analysis back over SSE.
import Anthropic from "@anthropic-ai/sdk";
import * as sleeper from "./sleeper.js";
import * as espn from "./espn.js";
import * as yahoo from "./yahoo.js";
import { getAccount } from "../lib/store.js";

const MODEL = process.env.ROTOBOT_MODEL || "claude-opus-5";

let client = null;
function getClient() {
  // Checked explicitly: the SDK's own missing-credential error names five
  // internal options and reads as a bug rather than "you forgot your key".
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    const err = new Error("No Claude API key configured.");
    err.code = "NO_API_KEY";
    throw err;
  }
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY / auth profile from env
  return client;
}

const PERSONA = `You are RotoBot, an elite fantasy football analyst and the user's personal team manager. You combine sharp statistical reasoning with the plain-spoken confidence of a veteran beat writer.

Rules:
- Give decisive recommendations. When asked "who should I start", pick one and say why in 2-3 crisp reasons. Hedging is allowed only when the call is genuinely a coin flip, and say so explicitly.
- Ground every take in the LEAGUE CONTEXT below: the user's actual roster, scoring format, current matchup, and trending player data. Refer to their players by name.
- Factor in injury designations (Questionable/Doubtful/Out), bye weeks, and scoring format (PPR vs standard changes WR/RB value).
- Keep answers tight: lead with the verdict, then the reasoning. Use short paragraphs or compact bullet lists, not walls of text.
- For trades, evaluate both sides for THIS user's roster construction and league format, and give a clear accept/decline/counter.
- For waivers, prioritize the trending-adds data in context and the user's positional needs; suggest who to drop.
- If the context lacks the data needed (e.g. no linked league), say what's missing and how to link it in Settings, then answer as well as you can from general knowledge.
- Your knowledge of games and stats has a cutoff; the LEAGUE CONTEXT block is live data and always wins on conflicts. Don't fabricate this week's game results or exact projections - reason from roles, matchups, and the live data you have.`;

async function buildLeagueContext(provider, leagueId) {
  try {
    if (provider === "sleeper") {
      const account = getAccount("sleeper");
      if (!account) return null;
      return await sleeper.getLeagueOverview(leagueId, account.userId);
    }
    if (provider === "espn") {
      const account = getAccount("espn");
      if (!account) return null;
      return await espn.getLeagueOverview(account);
    }
    if (provider === "yahoo") {
      return await yahoo.getLeagueOverview(leagueId);
    }
  } catch (err) {
    console.error(`Context build failed for ${provider}/${leagueId}:`, err.message);
  }
  return null;
}

function fmtPlayer(p) {
  const bits = [p.name, `${p.position} ${p.team}`];
  if (p.injury) bits.push(`⚠ ${p.injury}`);
  if (typeof p.points === "number" && p.points > 0) bits.push(`${p.points} pts`);
  return bits.join(" | ");
}

export async function buildContextText(provider, leagueId) {
  const parts = [];
  const overview = provider && leagueId ? await buildLeagueContext(provider, leagueId) : null;

  if (overview) {
    const { league, week, my, matchup, teams } = overview;
    parts.push(
      `LEAGUE: ${league.name} (${overview.provider}) — ${league.size} teams, season ${league.season}, scoring: ${league.scoring}. Current NFL week: ${week}.`
    );
    if (league.rosterPositions?.length) {
      parts.push(`LINEUP SLOTS: ${league.rosterPositions.filter((r) => r !== "BN").join(", ")}`);
    }
    if (my) {
      parts.push(`USER'S STARTERS:\n${my.starters.map((p) => `- ${fmtPlayer(p)}`).join("\n")}`);
      parts.push(`USER'S BENCH:\n${my.bench.map((p) => `- ${fmtPlayer(p)}`).join("\n")}`);
    }
    if (matchup) {
      parts.push(
        `WEEK ${matchup.week} MATCHUP: User ${matchup.myPoints} pts vs ${matchup.oppName} ${matchup.oppPoints ?? "?"} pts.` +
          (matchup.oppStarters?.length
            ? `\nOPPONENT STARTERS:\n${matchup.oppStarters.map((p) => `- ${fmtPlayer(p)}`).join("\n")}`
            : "")
      );
    }
    if (teams?.length) {
      parts.push(
        `STANDINGS:\n${teams
          .map((t, i) => `${i + 1}. ${t.teamName} (${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}, ${t.pointsFor} PF)${t.isMine ? " ← USER" : ""}`)
          .join("\n")}`
      );
    }
  } else {
    parts.push("No league is linked/selected yet. The user can link Sleeper, ESPN, or Yahoo in Settings.");
  }

  // Trending market data comes from Sleeper's public feed and is useful for any league.
  try {
    const trending = await sleeper.getTrendingDetailed();
    parts.push(
      `TRENDING ADDS (last 24h across all Sleeper leagues):\n${trending.add
        .slice(0, 15)
        .map((p) => `- ${fmtPlayer(p)} (${p.count.toLocaleString()} adds)`)
        .join("\n")}`
    );
    parts.push(
      `TRENDING DROPS:\n${trending.drop
        .slice(0, 10)
        .map((p) => `- ${fmtPlayer(p)} (${p.count.toLocaleString()} drops)`)
        .join("\n")}`
    );
  } catch (err) {
    console.error("Trending fetch failed:", err.message);
  }

  return parts.join("\n\n");
}

// Streams a chat completion. `history` is [{role: "user"|"assistant", content}]
// and onEvent receives {type: "thinking"|"text"|"done"|"error", ...}.
export async function streamChat({ history, provider, leagueId }, onEvent) {
  const context = await buildContextText(provider, leagueId);
  const today = new Date().toISOString().slice(0, 10);

  const stream = getClient().messages.stream({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive", display: "summarized" },
    system: [
      { type: "text", text: PERSONA, cache_control: { type: "ephemeral" } },
      { type: "text", text: `Today's date: ${today}\n\n=== LEAGUE CONTEXT (live) ===\n${context}` },
    ],
    messages: history,
  });

  stream.on("streamEvent", (event) => {
    if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        onEvent({ type: "text", text: event.delta.text });
      } else if (event.delta.type === "thinking_delta" && event.delta.thinking) {
        onEvent({ type: "thinking", text: event.delta.thinking });
      }
    }
  });

  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    onEvent({
      type: "error",
      message: final.stop_details?.explanation || "The assistant declined to answer that request.",
    });
  }
  onEvent({ type: "done" });
  return final;
}
