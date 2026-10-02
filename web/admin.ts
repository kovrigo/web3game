// Team page: review queue, appeals, score corrections, season numbers.
const out = document.getElementById("out")!;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
let key = sessionStorage.getItem("teamKey") ?? "";

async function api(path: string, data?: unknown) {
  const res = await fetch(path, {
    method: data === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

async function load() {
  try {
    const [m, q, a, w, season] = await Promise.all([api("/api/admin/metrics"), api("/api/admin/queue"), api("/api/admin/appeals"), api("/api/admin/winners"), fetch("/api/season").then((r) => r.json())]);
    out.innerHTML = `${seasonEnd(w, season)}
      <section class="panel"><h2 class="title">Season numbers</h2>
        <p class="small">Players in tables ${m.players} of ${m.accounts} accounts. Under review ${pct(m.underReviewShare)}.</p>
        <p class="small">Came by counted invite ${pct(m.invitedShare)}. Counted friends per 10 players ${m.invitesPer10.toFixed(1)}.</p>
        <p class="small">Back next day ${m.day1.returned} of ${m.day1.eligible}. Back on day 7 ${m.day7.returned} of ${m.day7.eligible}. Shared a card ${pct(m.sharedShare)}.</p>
      </section>
      <section><h2 class="title">Appeals</h2><div class="grid">${a.map((x: any) => `<div class="card">
        <b>#${x.id} ${esc(x.kind)} · ${esc(x.name)} · ${esc(x.status)}</b><span>${esc(x.email)}</span><p>${esc(x.text)}</p>${x.answer ? `<p class="muted">${esc(x.answer)}</p>` : ""}
        ${x.status === "open" ? `<form class="inline" data-appeal="${x.id}"><input class="input" name="answer" placeholder="Answer to the player" required>
          <button class="btn btn-primary" name="status" value="accepted">Accept</button><button class="btn btn-secondary" name="status" value="rejected">Reject</button></form>` : ""}
      </div>`).join("") || `<p class="small">No appeals.</p>`}</div></section>
      <section><h2 class="title">Accounts</h2><p class="small">Sorted: under review, open appeals, then most shared connections and devices.</p><div class="grid">${q.map((p: any) => `<div class="card">
        <b>#${p.id} ${esc(p.name ?? "(no name)")} · ${p.review === "review" ? "under review" : "in tables"}</b>
        <span class="mono">${esc(p.wallet ?? p.email ?? "test sign-in")}</span>
        <span>Shared connection with ${p.shared_ip} · shared device with ${p.shared_device} · invited ${p.invited}${p.referrer_id ? ` · invited by #${p.referrer_id}` : ""} · ${p.wave_points} wave pts</span>
        ${p.review_reason ? `<span class="muted">Reason shown: ${esc(p.review_reason)}</span>` : ""}
        <form class="inline" data-review="${p.id}">${p.review === "review"
          ? `<button class="btn btn-secondary" name="status" value="ok">Back to tables</button>`
          : `<input class="input" name="reason" placeholder="General reason the player sees"><button class="btn btn-secondary" name="status" value="review">Put under review</button>`}</form>
        <form class="inline" data-correct="${p.id}"><input class="input" name="delta" type="number" step="1" placeholder="± pts" required><input class="input" name="reason" placeholder="Reason, announced" required><button class="btn btn-secondary">Correct</button></form>
      </div>`).join("")}</div></section>`;
  } catch (e: any) {
    out.innerHTML = `<p class="field-error" role="alert">${esc(e.message)}</p>`;
  }
}

const day = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—");
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

// Season end: winners, checks, publication, payouts, letters, next season.
function seasonEnd(v: any, season: any) {
  const s = v.season;
  const dev = season.mockChain
    ? `<form class="inline" data-dev><span class="label">Test server only</span>
        ${s.snapshot_at ? "" : `<button class="btn btn-secondary" value="end-now">End season now</button>`}
        ${s.snapshot_at && !s.published_at ? `<button class="btn btn-secondary" value="prepare-test-winners">Confirm and check test players</button>` : ""}
        ${s.published_at && !s.paid_at ? `<button class="btn btn-secondary" value="close-objections">Close objections now</button><button class="btn btn-secondary" value="pay-all">Pay all on mock chain</button>` : ""}</form>`
    : "";
  if (!s.snapshot_at) return `<section class="panel stack"><h2 class="title">Season end</h2><p class="small">Season ${s.id} ends ${day(s.end)}. Winners appear here after the end.</p>${dev}</section>`;
  const active = v.winners.filter((x: any) => !x.replaced_at);
  const gone = v.winners.filter((x: any) => x.replaced_at);
  const card = (x: any) => `<div class="card">
    <b>${x.board} #${x.place} · ${esc(x.name)} · ${usd(x.prize_usd)}${s.eth_rate ? ` (${(x.prize_usd / s.eth_rate).toFixed(5)} ETH)` : ""}</b>
    <span>Confirm: ${x.confirm}${x.confirm === "waiting" ? ` by ${day(x.deadline)}` : ""} · Team: ${x.team} · Sanctions: ${x.sanctions_ok ? "checked" : "not checked"}${x.tx_hash ? " · paid" : ""}</span>
    <span class="mono">${esc(x.email ?? x.wallet ?? "test sign-in")}</span>
    ${x.address ? `<span>Country ${esc(x.country)} · payout <span class="mono">${esc(x.address)}</span></span><details><summary>Signed confirmation</summary><pre class="mono" style="white-space:pre-wrap">${esc(x.message)}\n\nSigned by ${esc(x.wallet)}\n${esc(x.signature)}</pre></details>` : ""}
    ${x.reason ? `<span class="muted">Reason shown: ${esc(x.reason)}</span>` : ""}
    ${x.replaced_at || x.tx_hash ? (x.tx_hash ? `<span class="mono">tx ${esc(x.tx_hash)}</span>` : "") : `<form class="inline" data-check="${x.id}"><input class="input" name="reason" placeholder="Reason if excluded"><button class="btn btn-secondary" name="team" value="ok">Checked ok</button><button class="btn btn-secondary" name="team" value="excluded">Exclude</button></form>
      ${x.address && !x.sanctions_ok ? `<form class="inline" data-sanctions="${x.id}"><button class="btn btn-secondary">Address passed sanctions check</button></form>` : ""}
      ${x.tx_hash ? `<span class="mono">tx ${esc(x.tx_hash)}</span>` : s.published_at ? `<form class="inline" data-payout="${x.id}"><input class="input mono" name="txHash" placeholder="0x… transaction hash" required><button class="btn btn-secondary">Record payout</button></form>` : ""}`}
  </div>`;
  return `<section class="panel stack"><h2 class="title">Season ${s.id} end</h2>
      <p class="small">Ended ${day(s.end)}. Published ${day(s.published_at)}. Objections until ${day(v.objectionsUntil)}. Pay by ${day(v.payBy)}. Paid ${day(s.paid_at)}.</p>
      <form class="inline" data-rate><input class="input" name="rate" type="number" step="0.01" min="0" placeholder="Dollars per 1 ETH on payout day" value="${s.eth_rate ?? ""}"><button class="btn btn-secondary">Set ETH rate</button></form>
      ${dev}
      ${s.published_at ? "" : `<form class="inline" data-publish><button class="btn btn-primary">Publish winners list</button></form>`}
      ${s.paid_at ? `<form class="inline" data-next><label class="field" style="flex:1"><span>Next season starts (UTC)</span><input class="input" name="start" type="datetime-local" required></label><button class="btn btn-primary">Start next season</button></form>` : ""}
    </section>
    <section><h2 class="title">Winners</h2><div class="grid">${active.map(card).join("") || `<p class="small">No winners.</p>`}</div>
      <p class="small">Reserve, points race: ${v.reserve.points.map(esc).join(", ") || "none"}. Reserve, invite race: ${v.reserve.invites.map(esc).join(", ") || "none"}.</p>
      ${gone.length ? `<details><summary>Off the list (${gone.length})</summary><div class="grid">${gone.map(card).join("")}</div></details>` : ""}</section>
    <section><h2 class="title">Letters to winners</h2><p class="small">No email service is chosen yet. Letters wait here until one is connected.</p>
      <div class="grid">${v.outbox.map((l: any) => `<div class="card"><b>${esc(l.to_email)} · ${esc(l.status)}</b><span>${esc(l.subject)}</span><pre style="white-space:pre-wrap;font:inherit">${esc(l.body)}</pre><button class="btn btn-secondary" disabled title="No email service yet">Send</button></div>`).join("") || `<p class="small">No letters. Only players who signed in by email get one.</p>`}</div></section>`;
}

document.addEventListener("submit", async (ev) => {
  const f = ev.target as HTMLFormElement;
  ev.preventDefault();
  const d = Object.fromEntries(new FormData(f)) as Record<string, string>;
  const status = ((ev as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
  try {
    if (f.id === "key") {
      key = d.key ?? "";
      sessionStorage.setItem("teamKey", key);
    } else if (f.dataset.appeal) await api("/api/admin/appeal", { id: Number(f.dataset.appeal), status, answer: d.answer });
    else if (f.dataset.review) await api("/api/admin/review", { playerId: Number(f.dataset.review), status, reason: d.reason ?? "" });
    else if (f.dataset.correct) await api("/api/admin/correction", { playerId: Number(f.dataset.correct), delta: Number(d.delta), reason: d.reason });
    else if (f.dataset.check) await api("/api/admin/winner-check", { id: Number(f.dataset.check), team: ((ev as SubmitEvent).submitter as HTMLButtonElement).value, reason: d.reason ?? "" });
    else if (f.dataset.sanctions) await api("/api/admin/sanctions", { id: Number(f.dataset.sanctions) });
    else if (f.dataset.rate !== undefined) await api("/api/admin/rate", { rate: Number(d.rate) });
    else if (f.dataset.publish !== undefined) await api("/api/admin/publish", {});
    else if (f.dataset.payout) {
      await api("/api/admin/payout", { id: Number(f.dataset.payout), txHash: d.txHash });
    } else if (f.dataset.dev !== undefined) await api("/api/admin/dev", { action: status }); else if (f.dataset.next !== undefined) await api("/api/admin/next-season", { start: `${d.start}:00Z` });
    await load();
  } catch (e: any) {
    alert(e.message);
  }
});

if (key) load();
