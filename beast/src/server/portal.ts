export const PORTAL_CSP = [
  "default-src 'none'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' https://accounts.google.com/gsi/style",
  "frame-src https://accounts.google.com/gsi/",
  "connect-src 'self' https://accounts.google.com/gsi/",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export const PORTAL_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Beast System 3 Portal</title><link rel="stylesheet" href="/portal/app.css"></head>
<body><main>
<h1>Beast System 3</h1>
<section id="signin">
  <h2>Sign in</h2>
  <div id="g-btn"></div>
  <form id="pw-form"><label>Username <input id="u" autocomplete="username" maxlength="128"></label>
  <label>Password <input id="p" type="password" autocomplete="current-password" maxlength="256"></label>
  <button type="submit">Sign in</button></form>
  <p id="signin-msg" role="status"></p>
</section>
<section id="app" hidden>
  <p>Signed in. <button id="signout" type="button">Sign out</button></p>
  <section id="staff" hidden><h2>Dashboard</h2><pre id="kpis">Loading...</pre></section>
  <section id="member" hidden><h2>My applications</h2><ul id="apps"></ul><p id="apps-msg"></p></section>
  <section id="consent" hidden><h2>Notice and consent</h2>
    <p>The guidance assistant sends the text you type to Google Gemini to generate an answer. Do not enter names, SSNs, addresses or case numbers. Your messages are not stored by this service. Answers are general guidance, not legal advice.</p>
    <button id="consent-btn" type="button">I understand and agree</button></section>
  <section id="assistant"><h2>Guidance assistant</h2>
  <p class="note">Do not enter names, SSNs, addresses or case numbers. This is general guidance, not legal advice.</p>
  <form id="ask-form"><textarea id="q" maxlength="1000" rows="3" required></textarea><button type="submit">Ask</button></form>
  <pre id="answer"></pre></section>
  <h2>Resource locator</h2>
  <form id="res-form"><input id="near" placeholder="City or ZIP" maxlength="100" required>
  <select id="cat"><option>food</option><option>housing</option><option>healthcare</option><option>childcare</option><option>energy</option><option>employment</option><option>legal</option></select>
  <button type="submit">Search</button></form>
  <ul id="results"></ul>
</section>
</main><script src="/portal/app.js"></script></body></html>`;

export const PORTAL_CSS = `body{font-family:system-ui,sans-serif;margin:0;background:#f5f6f8;color:#111}
main{max-width:720px;margin:0 auto;padding:1rem}label{display:block;margin:.5rem 0}
input,select,textarea,button{font:inherit;padding:.4rem;margin:.2rem 0}textarea{width:100%;box-sizing:border-box}
pre{white-space:pre-wrap;background:#fff;padding:.6rem;border:1px solid #ddd}.note{font-size:.85rem;color:#555}`;

export const PORTAL_JS = `(() => {
  const $ = (id) => document.getElementById(id);
  let token = null;
  const api = async (path, opts = {}) => {
    const r = await fetch(path, { ...opts, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || "Request failed (" + r.status + ")");
    return body;
  };
  const show = (t) => {
    token = t; $("signin").hidden = !!t; $("app").hidden = !t;
    if (t) {
      setTimeout(() => show(null), 14 * 60 * 1000);
      api("/v1/me").then((me) => {
        const isMember = me.role === "member";
        $("member").hidden = !isMember; $("staff").hidden = isMember;
        $("consent").hidden = !isMember || me.consentAccepted;
        $("assistant").hidden = isMember && !me.consentAccepted;
        if (isMember) {
          api("/v1/me/applications").then((list) => {
            const ul = $("apps"); ul.replaceChildren();
            if (!list.length) $("apps-msg").textContent = "No applications yet. Your caseworker will help you start one.";
            for (const a of list) ul.append(Object.assign(document.createElement("li"), { textContent: "Application " + a.familyId.slice(0, 8) + ": " + a.status }));
          }).catch((e) => { $("apps-msg").textContent = e.message; });
        } else {
          api("/v1/kpis").then((k) => { $("kpis").textContent = JSON.stringify(k, null, 2); }).catch((e) => { $("kpis").textContent = e.message; });
        }
      }).catch(() => show(null));
    }
  };
  $("pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { show((await api("/v1/auth/login", { method: "POST", body: JSON.stringify({ username: $("u").value, password: $("p").value }) })).token); $("p").value = ""; }
    catch (err) { $("signin-msg").textContent = err.message; }
  });
  $("consent-btn").addEventListener("click", async () => {
    try { await api("/v1/me/consent", { method: "POST", body: "{}" }); $("consent").hidden = true; $("assistant").hidden = false; }
    catch (err) { $("apps-msg").textContent = err.message; }
  });
  $("signout").addEventListener("click", () => show(null));
  $("ask-form").addEventListener("submit", async (e) => {
    e.preventDefault(); $("answer").textContent = "Thinking...";
    try { $("answer").textContent = (await api("/v1/assistant", { method: "POST", body: JSON.stringify({ message: $("q").value }) })).reply; }
    catch (err) { $("answer").textContent = err.message; }
  });
  $("res-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const ul = $("results"); ul.replaceChildren();
    try {
      const list = await api("/v1/resources?near=" + encodeURIComponent($("near").value) + "&category=" + encodeURIComponent($("cat").value));
      if (!list.length) ul.append(Object.assign(document.createElement("li"), { textContent: "No results." }));
      for (const r of list) ul.append(Object.assign(document.createElement("li"), { textContent: [r.name, r.address, r.phone].filter(Boolean).join(" - ") }));
    } catch (err) { ul.append(Object.assign(document.createElement("li"), { textContent: err.message })); }
  });
  fetch("/portal/config").then((r) => r.json()).then((c) => {
    if (!c.googleClientId) return;
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => {
      google.accounts.id.initialize({ client_id: c.googleClientId, callback: async (resp) => {
        try { show((await api("/v1/auth/google", { method: "POST", body: JSON.stringify({ idToken: resp.credential }) })).token); }
        catch (err) { $("signin-msg").textContent = err.message; }
      } });
      google.accounts.id.renderButton($("g-btn"), { theme: "outline", size: "large" });
    };
    document.head.append(s);
  }).catch(() => {});
})();`;
