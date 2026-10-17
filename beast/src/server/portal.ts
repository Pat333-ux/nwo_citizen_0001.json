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
  <section id="caseworker" hidden><h2>Onboard a member</h2>
    <p class="note">Step 1: create the identity. Step 2: verify it after checking the person's documents. Step 3: create their Google-only member account.</p>
    <form id="idn-form"><label>Full name <input id="i-name" maxlength="256" required></label>
    <label>Address <input id="i-addr" maxlength="512" required></label>
    <label>Email (their Google account) <input id="i-email" type="email" maxlength="254" required></label>
    <label>Jurisdiction <input id="i-jur" value="IN" maxlength="64" required></label>
    <button type="submit">1. Create identity</button></form>
    <p>Identity ID: <code id="i-id"></code></p>
    <button id="verify-btn" type="button" disabled>2. Mark identity verified</button>
    <form id="mem-form"><label>Member username <input id="m-user" pattern="[a-z0-9._-]{3,64}" maxlength="64" required></label>
    <button id="mem-btn" type="submit" disabled>3. Create member account</button></form>
    <p id="cw-msg" role="status"></p></section>
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
        $("caseworker").hidden = me.role !== "caseworker";
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
  let newIdentity = null;
  const cw = (t) => { $("cw-msg").textContent = t; };
  $("idn-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/v1/identities", { method: "POST", body: JSON.stringify({ type: "citizen", jurisdiction: $("i-jur").value, name: $("i-name").value, address: $("i-addr").value, email: $("i-email").value }) });
      newIdentity = r.id; $("i-id").textContent = r.id; $("verify-btn").disabled = false; $("mem-btn").disabled = true; cw("Identity created. Verify it once documents are checked.");
    } catch (err) { cw(err.message); }
  });
  $("verify-btn").addEventListener("click", async () => {
    if (!newIdentity) return;
    try { await api("/v1/identities/" + encodeURIComponent(newIdentity) + "/verify", { method: "POST", body: "{}" }); $("verify-btn").disabled = true; $("mem-btn").disabled = false; cw("Identity verified."); }
    catch (err) { cw(err.message); }
  });
  $("mem-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/v1/members", { method: "POST", body: JSON.stringify({ username: $("m-user").value, email: $("i-email").value, identityId: newIdentity }) });
      cw("Member account created. They can now sign in with Google."); $("mem-btn").disabled = true; $("idn-form").reset(); $("i-id").textContent = ""; newIdentity = null;
    } catch (err) { cw(err.message); }
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
