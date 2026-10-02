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
    const [m, q, a] = await Promise.all([api("/api/admin/metrics"), api("/api/admin/queue"), api("/api/admin/appeals")]);
    out.innerHTML = `
      <section class="panel"><h2 class="title">Season numbers</h2>
        <p class="small">Players in tables ${m.players} of ${m.accounts} accounts. Under review ${pct(m.underReviewShare)}.</p>
        <p class="small">Came by counted invite ${pct(m.invitedShare)}. Counted friends per 10 players ${m.invitesPer10.toFixed(1)}.</p>
        <p class="small">Back next day ${m.day1.returned} of ${m.day1.eligible}. Back on day 7 ${m.day7.returned} of ${m.day7.eligible}. Shared a card ${pct(m.sharedShare)}.</p>
      </section>
      <section><h2 class="title">Appeals</h2><div class="grid">${a.map((x: any) => `<div class="card">
        <b>#${x.id} ${esc(x.name)} · ${esc(x.status)}</b><span>${esc(x.email)}</span><p>${esc(x.text)}</p>${x.answer ? `<p class="muted">${esc(x.answer)}</p>` : ""}
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
    await load();
  } catch (e: any) {
    alert(e.message);
  }
});

if (key) load();
