// RotoBot replica — frontend. No build step: plain ES modules-free script.

const state = {
  leagues: [],
  active: null,        // { provider, id, name }
  overview: null,
  messages: [],        // { role, content }
  streaming: false,
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ============================ Tabs ============================ */

document.querySelectorAll("nav.tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(`#panel-${btn.dataset.tab}`).classList.add("active");
    if (["team", "matchup", "league"].includes(btn.dataset.tab)) renderOverviewPanels();
    if (btn.dataset.tab === "waivers") loadWaivers();
  });
});

/* ============================ Leagues ============================ */

async function loadLeagues() {
  const select = $("#league-select");
  try {
    const { leagues } = await api("/api/fantasy/leagues");
    state.leagues = leagues;
    select.innerHTML = "";
    if (!leagues.length) {
      select.appendChild(el("option", null, "No league linked"));
      select.disabled = true;
      state.active = null;
      renderOverviewPanels();
      return;
    }
    select.disabled = false;
    const savedKey = localStorage.getItem("rotobot.league");
    leagues.forEach((l) => {
      const opt = el("option", null, `${l.name} · ${l.provider}`);
      opt.value = `${l.provider}:${l.id}`;
      select.appendChild(opt);
    });
    const match = leagues.find((l) => `${l.provider}:${l.id}` === savedKey) || leagues[0];
    select.value = `${match.provider}:${match.id}`;
    state.active = { provider: match.provider, id: match.id, name: match.name };
    await loadOverview();
  } catch (err) {
    select.innerHTML = "";
    select.appendChild(el("option", null, "Error loading leagues"));
  }
}

$("#league-select").addEventListener("change", async (e) => {
  const [provider, id] = e.target.value.split(":");
  const league = state.leagues.find((l) => l.provider === provider && String(l.id) === id);
  state.active = { provider, id, name: league?.name || "" };
  localStorage.setItem("rotobot.league", e.target.value);
  await loadOverview();
});

async function loadOverview() {
  if (!state.active) return;
  state.overview = null;
  renderOverviewPanels(true);
  try {
    state.overview = await api(
      `/api/fantasy/overview?provider=${encodeURIComponent(state.active.provider)}&leagueId=${encodeURIComponent(state.active.id)}`
    );
  } catch (err) {
    state.overview = { error: err.message };
  }
  renderOverviewPanels();
}

/* ============================ Rendering ============================ */

function emptyState(icon, title, body) {
  const wrap = el("div", "empty");
  wrap.appendChild(el("div", "big", icon));
  wrap.appendChild(el("div", null, title));
  if (body) {
    const p = el("p", "sub", body);
    p.style.marginTop = "8px";
    wrap.appendChild(p);
  }
  return wrap;
}

function playerRow(p, slot) {
  const row = el("div", "player-row");
  row.appendChild(el("div", `slot ${slot || p.position}`, slot || p.position));
  const info = el("div");
  const nameLine = el("div", "player-name");
  nameLine.textContent = p.name;
  if (p.injury) {
    const tag = el("span", `injury ${/out|ir/i.test(p.injury) ? "out" : ""}`, ` ${p.injury}`);
    nameLine.appendChild(tag);
  }
  info.appendChild(nameLine);
  info.appendChild(el("div", "player-meta", `${p.position} · ${p.team}`));
  row.appendChild(info);
  if (typeof p.points === "number") {
    row.appendChild(el("div", "player-pts", p.points.toFixed(1)));
  } else if (typeof p.count === "number") {
    row.appendChild(el("div", "player-pts", p.count.toLocaleString()));
  }
  return row;
}

function renderOverviewPanels(loading = false) {
  const team = $("#panel-team");
  const matchup = $("#panel-matchup");
  const league = $("#panel-league");
  [team, matchup, league].forEach((p) => (p.innerHTML = ""));

  if (loading) {
    [team, matchup, league].forEach((p) => p.appendChild(emptyState("⏳", "Loading league data…")));
    return;
  }
  if (!state.active) {
    [team, matchup, league].forEach((p) =>
      p.appendChild(emptyState("🔗", "No league linked", "Head to Settings to connect Sleeper, ESPN, or Yahoo."))
    );
    return;
  }
  const o = state.overview;
  if (!o) return;
  if (o.error) {
    [team, matchup, league].forEach((p) => p.appendChild(emptyState("⚠️", "Couldn't load league", o.error)));
    return;
  }

  // --- My Team ---
  if (o.my) {
    const card = el("div", "card");
    card.appendChild(el("h2", null, o.league.name));
    card.appendChild(el("p", "sub", `${o.league.size}-team · ${o.league.scoring} · Week ${o.week}`));
    card.appendChild(el("h3", null, "Starters"));
    const slots = (o.league.rosterPositions || []).filter((s) => s !== "BN" && s !== "IR");
    o.my.starters.forEach((p, i) => card.appendChild(playerRow(p, p.slot || slots[i])));
    card.appendChild(el("h3", null, `Bench (${o.my.bench.length})`));
    o.my.bench.forEach((p) => card.appendChild(playerRow(p, "BN")));
    team.appendChild(card);
  } else {
    team.appendChild(emptyState("🏈", "No roster found", "We couldn't match a team in this league to your account."));
  }

  // --- Matchup ---
  if (o.matchup) {
    const m = o.matchup;
    const card = el("div", "card");
    card.appendChild(el("h2", null, `Week ${m.week} Matchup`));
    const line = el("div", "score-line");
    const left = el("div", "score-side");
    left.appendChild(el("div", "score-name", "You"));
    left.appendChild(el("div", `score-val ${m.oppPoints != null && m.myPoints > m.oppPoints ? "win" : ""}`, m.myPoints.toFixed(1)));
    const right = el("div", "score-side right");
    right.appendChild(el("div", "score-name", m.oppName));
    right.appendChild(el("div", `score-val ${m.oppPoints != null && m.oppPoints > m.myPoints ? "win" : ""}`, m.oppPoints != null ? m.oppPoints.toFixed(1) : "—"));
    line.append(left, right);
    card.appendChild(line);

    if (m.myStarters?.length) {
      card.appendChild(el("h3", null, "Your starters"));
      m.myStarters.forEach((p) => card.appendChild(playerRow(p)));
    }
    if (m.oppStarters?.length) {
      card.appendChild(el("h3", null, `${m.oppName}'s starters`));
      m.oppStarters.forEach((p) => card.appendChild(playerRow(p)));
    }
    matchup.appendChild(card);
  } else {
    matchup.appendChild(emptyState("📅", "No active matchup", "Nothing scheduled for the current week."));
  }

  // --- League ---
  if (o.teams?.length) {
    const card = el("div", "card");
    card.appendChild(el("h2", null, "Standings"));
    const table = el("table", "standings");
    table.innerHTML = `<thead><tr><th>#</th><th>Team</th><th class="num">W-L</th><th class="num">PF</th></tr></thead>`;
    const tbody = el("tbody");
    o.teams.forEach((t, i) => {
      const tr = el("tr", t.isMine ? "mine" : "");
      tr.innerHTML = `<td>${i + 1}</td><td>${escapeHtml(t.teamName)}</td>` +
        `<td class="num">${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}</td>` +
        `<td class="num">${t.pointsFor.toFixed(1)}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card.appendChild(table);
    league.appendChild(card);
  } else {
    league.appendChild(emptyState("📊", "Standings unavailable", "This provider doesn't expose standings for the linked league."));
  }
}

async function loadWaivers() {
  const panel = $("#panel-waivers");
  if (panel.dataset.loaded === "1") return;
  panel.innerHTML = "";
  panel.appendChild(emptyState("⏳", "Loading trending players…"));
  try {
    const { add, drop } = await api("/api/fantasy/trending");
    panel.innerHTML = "";
    const addCard = el("div", "card");
    addCard.appendChild(el("h2", null, "🔥 Most added"));
    addCard.appendChild(el("p", "sub", "Across all Sleeper leagues in the last 24 hours."));
    addCard.appendChild(el("h3", null, "Adds"));
    add.slice(0, 20).forEach((p) => addCard.appendChild(playerRow(p)));
    panel.appendChild(addCard);

    const dropCard = el("div", "card");
    dropCard.appendChild(el("h2", null, "❄️ Most dropped"));
    dropCard.appendChild(el("h3", null, "Drops"));
    drop.slice(0, 15).forEach((p) => dropCard.appendChild(playerRow(p)));
    panel.appendChild(dropCard);
    panel.dataset.loaded = "1";
  } catch (err) {
    panel.innerHTML = "";
    panel.appendChild(emptyState("⚠️", "Couldn't load trending players", err.message));
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============================ Chat ============================ */

// Minimal markdown: bold, inline code, bullet/numbered lists, paragraphs.
function renderMarkdown(text) {
  const inline = (s) =>
    escapeHtml(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  const blocks = [];
  let list = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const tag = bullet ? "ul" : "ol";
      if (!list || list.tag !== tag) {
        if (list) blocks.push(`<${list.tag}>${list.items.join("")}</${list.tag}>`);
        list = { tag, items: [] };
      }
      list.items.push(`<li>${inline((bullet || numbered)[1])}</li>`);
      continue;
    }
    if (list) {
      blocks.push(`<${list.tag}>${list.items.join("")}</${list.tag}>`);
      list = null;
    }
    if (line.trim()) blocks.push(`<p>${inline(line)}</p>`);
  }
  if (list) blocks.push(`<${list.tag}>${list.items.join("")}</${list.tag}>`);
  return blocks.join("");
}

function addMessage(role, content) {
  const wrap = el("div", `msg ${role === "user" ? "user" : "bot"}`);
  wrap.appendChild(el("div", "avatar", role === "user" ? "🧑" : "🤖"));
  const bubble = el("div", "bubble");
  if (role === "user") {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = renderMarkdown(content || "");
  }
  wrap.appendChild(bubble);
  $("#messages").appendChild(wrap);
  scrollChat();
  return bubble;
}

function scrollChat() {
  const m = $("#messages");
  m.scrollTop = m.scrollHeight;
}

const SUGGESTIONS = [
  "Who should I start this week?",
  "Any waiver wire pickups I should grab?",
  "How do I win my matchup this week?",
  "Which of my players should I trade away?",
  "Is my roster weak anywhere?",
];

function renderSuggestions() {
  const bar = $("#suggestions");
  bar.innerHTML = "";
  SUGGESTIONS.forEach((s) => {
    const btn = el("button", null, s);
    btn.type = "button";
    btn.addEventListener("click", () => {
      $("#input").value = s;
      $("#composer").dispatchEvent(new Event("submit", { cancelable: true }));
    });
    bar.appendChild(btn);
  });
}

function greet() {
  addMessage(
    "assistant",
    "**I'm RotoBot** — your AI fantasy football manager.\n\nLink a league in **Settings**, then ask me anything: lineup calls, waiver targets, trade evaluations, or a read on your matchup. I'll use your real roster and scoring settings."
  );
}

$("#composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.streaming) return;
  const input = $("#input");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  input.style.height = "auto";
  addMessage("user", text);
  state.messages.push({ role: "user", content: text });

  state.streaming = true;
  $("#send").disabled = true;

  // Stable child nodes so streaming updates to one never detach the other.
  const bubble = addMessage("assistant", "");
  const thinkingBox = el("div", "thinking-note");
  thinkingBox.hidden = true;
  const answerBox = el("div");
  const cursor = el("span", "cursor");
  bubble.append(thinkingBox, answerBox, cursor);
  let answer = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: state.messages,
        provider: state.active?.provider,
        leagueId: state.active?.id,
      }),
    });
    if (!res.ok || !res.body) throw new Error(`Chat request failed (${res.status})`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";
      for (const chunk of chunks) {
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (event.type === "thinking") {
          thinkingBox.hidden = false;
          thinkingBox.textContent += event.text;
          scrollChat();
        } else if (event.type === "text") {
          answer += event.text;
          answerBox.innerHTML = renderMarkdown(answer);
          scrollChat();
        } else if (event.type === "error") {
          answer += `\n\n⚠️ ${event.message}`;
        }
      }
    }
  } catch (err) {
    answer += `\n\n⚠️ ${err.message}`;
  } finally {
    cursor.remove();
    thinkingBox.remove();
    answerBox.innerHTML = renderMarkdown(answer || "⚠️ No response received.");
    if (answer) state.messages.push({ role: "assistant", content: answer });
    state.streaming = false;
    $("#send").disabled = false;
    scrollChat();
  }
});

$("#input").addEventListener("input", (e) => {
  e.target.style.height = "auto";
  e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
});

$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#composer").dispatchEvent(new Event("submit", { cancelable: true }));
  }
});

/* ============================ Settings ============================ */

function setStatus(id, message, ok) {
  const node = $(id);
  node.textContent = message;
  node.className = `status-msg ${ok ? "ok" : "err"}`;
}

async function loadAccounts() {
  try {
    const { accounts, mock, capabilities } = await api("/api/accounts");
    if (capabilities) {
      // Yahoo configured in .env means the setup fields aren't needed at all.
      $("#yahoo-setup").hidden = capabilities.yahooConfigured;
      $("#yahoo-hint").textContent = capabilities.yahooConfigured
        ? "Sends you to Yahoo's own sign-in page. Your password is never entered here."
        : "Yahoo needs one-time app credentials before you can log in — see below.";

      // Hosted: the ESPN handoff would open a window on the server, not here.
      if (!capabilities.espnBrowserLogin) {
        $("#espn-login").hidden = true;
        $("#espn-login-hint").textContent =
          "This app is hosted, so the browser login can't run here. Paste your ESPN cookies below instead.";
        const details = document.querySelector("#espn-body details.fallback");
        if (details) details.open = true;
      }
    }
    if (mock && !document.querySelector(".banner")) {
      const banner = el("div", "banner", "Mock data mode — showing a sample league. Restart without ROTOBOT_MOCK=1 to use live data.");
      $("main").prepend(banner);
    }
    for (const acct of accounts) {
      const pill = $(`#pill-${acct.provider}`);
      if (!pill) continue;
      const linked = acct.provider === "yahoo" ? acct.authorized : acct.linked;
      pill.textContent = linked ? "Linked" : "Not linked";
      pill.className = `pill ${linked ? "on" : ""}`;

      if (linked) {
        const body = $(`#${acct.provider}-body`);
        if (body && !body.querySelector(".unlink")) {
          const btn = el("button", "btn ghost unlink", "Disconnect");
          btn.style.marginTop = "10px";
          btn.addEventListener("click", async () => {
            await api(`/api/accounts/${acct.provider}`, { method: "DELETE" });
            location.reload();
          });
          body.appendChild(btn);
        }
      }
      if (acct.provider === "sleeper" && acct.linked) {
        setStatus("#sleeper-status", `Linked as ${acct.displayName || acct.username} · ${acct.leagues.length} league(s)`, true);
        $("#sleeper-username").value = acct.username || "";
      }
      if (acct.provider === "espn" && acct.linked) {
        setStatus(
          "#espn-status",
          `Linked${acct.teamName ? ` · ${acct.teamName}` : ""}${acct.leagues.length ? ` · ${acct.leagues.length} league(s)` : ""}`,
          true
        );
        $("#espn-league").value = acct.leagueId || "";
        $("#espn-season").value = acct.season || "";
        renderEspnLeaguePicker(acct.leagues, acct.leagueId);
      }
      if (acct.provider === "yahoo") {
        if (acct.authorized) {
          setStatus("#yahoo-status", `Logged in · ${acct.leagues.length} league(s)`, true);
        } else if (!acct.hasCredentials) {
          setStatus("#yahoo-status", "Add app credentials below before logging in.", false);
        } else {
          setStatus("#yahoo-status", "", true);
        }
        if (acct.redirectUri) $("#yahoo-redirect").value = acct.redirectUri;
      }
    }
  } catch (err) {
    console.error(err);
  }
}

$("#sleeper-link").addEventListener("click", async () => {
  const username = $("#sleeper-username").value.trim();
  if (!username) return setStatus("#sleeper-status", "Enter your Sleeper username.", false);
  setStatus("#sleeper-status", "Linking…", true);
  try {
    const { account } = await api("/api/accounts/sleeper", {
      method: "POST",
      body: JSON.stringify({ username }),
    });
    setStatus("#sleeper-status", `Linked as ${account.displayName} · ${account.leagues.length} league(s) found`, true);
    await loadLeagues();
    await loadAccounts();
  } catch (err) {
    setStatus("#sleeper-status", err.message, false);
  }
});

// --- ESPN browser handoff ---
let espnPollTimer = null;

function renderEspnLeaguePicker(leagues, activeId) {
  const wrap = $("#espn-league-pick");
  const select = $("#espn-league-select");
  if (!leagues?.length) {
    wrap.hidden = true;
    return;
  }
  select.innerHTML = "";
  leagues.forEach((l) => {
    const opt = el("option", null, `${l.name}${l.season ? ` · ${l.season}` : ""}`);
    opt.value = l.id;
    select.appendChild(opt);
  });
  if (activeId) select.value = String(activeId);
  wrap.hidden = false;
}

$("#espn-league-select").addEventListener("change", async (e) => {
  try {
    await api("/api/accounts/espn/select", {
      method: "POST",
      body: JSON.stringify({ leagueId: e.target.value }),
    });
    await loadLeagues();
    setStatus("#espn-status", "Active ESPN league updated.", true);
  } catch (err) {
    setStatus("#espn-status", err.message, false);
  }
});

async function pollEspnLogin() {
  try {
    const s = await api("/api/accounts/espn/login/status");
    if (s.status === "waiting" || s.status === "launching" || s.status === "capturing") {
      setStatus("#espn-status", s.message, true);
      return;
    }
    clearInterval(espnPollTimer);
    espnPollTimer = null;
    $("#espn-login").disabled = false;
    if (s.status === "done") {
      const count = s.leagues?.length || 0;
      setStatus(
        "#espn-status",
        count ? `Logged in · ${count} league(s) found` : "Logged in, but no football leagues were found on this account.",
        true
      );
      renderEspnLeaguePicker(s.leagues, s.leagues?.[0]?.id);
      await loadLeagues();
      await loadAccounts();
    } else if (s.status === "error") {
      setStatus("#espn-status", s.message, false);
    }
  } catch (err) {
    clearInterval(espnPollTimer);
    espnPollTimer = null;
    $("#espn-login").disabled = false;
    setStatus("#espn-status", err.message, false);
  }
}

$("#espn-login").addEventListener("click", async () => {
  $("#espn-login").disabled = true;
  setStatus("#espn-status", "Opening a browser window…", true);
  try {
    await api("/api/accounts/espn/login", { method: "POST" });
    if (espnPollTimer) clearInterval(espnPollTimer);
    espnPollTimer = setInterval(pollEspnLogin, 1500);
    pollEspnLogin();
  } catch (err) {
    $("#espn-login").disabled = false;
    setStatus("#espn-status", err.message, false);
  }
});

$("#espn-link").addEventListener("click", async () => {
  const leagueId = $("#espn-league").value.trim();
  const season = $("#espn-season").value.trim() || String(new Date().getFullYear());
  if (!leagueId) return setStatus("#espn-status", "Enter your ESPN league ID.", false);
  setStatus("#espn-status", "Linking…", true);
  try {
    const { account } = await api("/api/accounts/espn", {
      method: "POST",
      body: JSON.stringify({
        leagueId,
        season,
        espnS2: $("#espn-s2").value.trim(),
        swid: $("#espn-swid").value.trim(),
      }),
    });
    setStatus("#espn-status", `Linked${account.teamName ? ` · ${account.teamName}` : ""}`, true);
    await loadLeagues();
    await loadAccounts();
  } catch (err) {
    setStatus("#espn-status", err.message, false);
  }
});

$("#yahoo-login").addEventListener("click", async () => {
  // With credentials in .env this sends no input at all; the fields below are
  // only used when Yahoo hasn't been configured yet.
  const body = {
    clientId: $("#yahoo-id").value.trim(),
    clientSecret: $("#yahoo-secret").value.trim(),
    redirectUri: $("#yahoo-redirect").value.trim(),
  };
  try {
    const { authUrl } = await api("/api/accounts/yahoo/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
    window.location.href = authUrl;
  } catch (err) {
    setStatus("#yahoo-status", err.message, false);
    $("#yahoo-setup").open = true;
  }
});

/* ============================ Boot ============================ */

(async function init() {
  $("#yahoo-redirect").value = `${location.origin}/api/accounts/yahoo/callback`;
  renderSuggestions();
  greet();

  try {
    const health = await api("/api/health");
    $("#ai-status").textContent = health.aiConfigured
      ? `Connected · model ${health.model}`
      : "No API key detected — set ANTHROPIC_API_KEY and restart.";
  } catch {
    $("#ai-status").textContent = "Server unreachable.";
  }

  await loadAccounts();
  await loadLeagues();

  if (new URLSearchParams(location.search).get("linked") === "yahoo") {
    setStatus("#yahoo-status", "Yahoo authorized successfully.", true);
    history.replaceState({}, "", "/");
  }
})();
