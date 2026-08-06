/**
 * The control-center page's markup, as a plain string constant — not read from disk at
 * startup. This sidesteps the "does `public/` survive the tsup bundle + get shipped next to
 * `dist/index.js`" question entirely: the HTML is inlined into the compiled JS by tsup the
 * same way any other string literal would be, so `GET /` works identically whether module-sim
 * is run via `tsx src/index.ts` (dev) or `node dist/index.js` (build output) regardless of
 * the process's cwd. Self-contained by design (inline `<style>`/`<script>`, no external
 * network/CDN calls other than same-origin `fetch("/catalog")` / `fetch("/emit")`) per the
 * task brief — no Vue, no Tailwind, no build step for the page itself.
 *
 * The three panels below are hand-rolled `<form>`s rather than the project-wide JSON-driven
 * `<FormRenderer>` (see `json-form-conventions`) — a deliberate, scoped exception: module-sim
 * is explicitly a Vue-free, build-step-free Fastify dev tool (that's the whole point of this
 * file), so pulling in `<FormRenderer>` would mean giving this package a Vue runtime it's
 * designed not to have. This does not set a precedent for `frontend/`.
 */
import { MAX_BURST } from "./routes/emit";

export const CONTROL_CENTER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>module-sim Control Center</title>
<style>
  :root {
    --bg: #14171c;
    --surface: #1b1f26;
    --surface-raised: #20242c;
    --line: #2c313b;
    --line-strong: #3a4150;
    --text: #e8eaed;
    --text-muted: #9aa1ac;
    --text-faint: #6b7280;
    --accent: #5fb3a3;
    --accent-ink: #08211d;
    --danger: #e0645a;
    --warning: #d6a94a;
    --focus: #7fd4c2;
    --radius-sm: 6px;
    --radius-md: 9px;
    --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-body);
    font-size: 14px;
    line-height: 1.5;
  }

  header {
    padding: 24px 32px 16px;
    border-bottom: 1px solid var(--line);
  }

  header h1 {
    margin: 0 0 4px;
    font-size: 22px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }

  header p {
    margin: 0;
    color: var(--text-muted);
    font-size: 13px;
  }

  main {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 24px;
    padding: 24px 32px 48px;
    max-width: 1200px;
  }

  section.panel {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  section.panel > h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  section.panel > h2 .eyebrow {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  section.panel > p.hint {
    margin: -8px 0 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 4px;
  }

  .field { display: flex; flex-direction: column; }
  .field + .field { margin-top: 12px; }
  .field .hint {
    margin: 4px 0 0;
    color: var(--text-faint);
    font-size: 11px;
  }
  .field[hidden] { display: none; }

  select,
  input[type="text"],
  input[type="number"],
  textarea {
    width: 100%;
    background: var(--surface-raised);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    color: var(--text);
    padding: 8px 10px;
    font-family: inherit;
    font-size: 13px;
  }

  textarea { resize: vertical; min-height: 56px; }

  select:focus-visible,
  input:focus-visible,
  textarea:focus-visible,
  button:focus-visible,
  input[type="checkbox"]:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  fieldset {
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    margin: 0;
  }

  fieldset legend {
    padding: 0 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
  }

  fieldset p.empty {
    margin: 0;
    color: var(--text-faint);
    font-size: 12px;
  }

  .action-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
  }

  .action-row label {
    margin: 0;
    font-weight: 500;
    color: var(--text);
    font-size: 13px;
  }

  .action-row .method {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    padding: 1px 4px;
  }

  button.submit {
    align-self: flex-start;
    background: var(--accent);
    color: var(--accent-ink);
    border: none;
    border-radius: var(--radius-sm);
    padding: 9px 16px;
    font-weight: 650;
    font-size: 13px;
    cursor: pointer;
  }

  button.submit:hover { filter: brightness(1.08); }
  button.submit:disabled { opacity: 0.55; cursor: not-allowed; }

  .result {
    font-family: var(--font-mono);
    font-size: 12px;
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    border: 1px solid var(--line-strong);
    background: var(--surface-raised);
    color: var(--text-muted);
    white-space: pre-wrap;
    word-break: break-word;
    min-height: 1.4em;
  }

  .result[data-state="ok"] { color: var(--accent); border-color: var(--accent); }
  .result[data-state="error"] { color: var(--danger); border-color: var(--danger); }
  .result:empty::before { content: "No requests sent yet."; color: var(--text-faint); }

  .priority-high, .priority-critical { color: var(--warning); }
</style>
</head>
<body>
<header>
  <h1>module-sim Control Center</h1>
  <p>Publish simulated, actionable notifications to the hub for local/dev/QA use. Every request goes to this service's own <code>/emit</code> endpoint.</p>
</header>

<main>
  <section class="panel" aria-labelledby="custom-heading">
    <h2 id="custom-heading"><span class="eyebrow">Custom</span> Build one notification</h2>
    <p class="hint">Pick a module and at least one of its real dispatch actions.</p>
    <form id="custom-form" novalidate>
      <div class="field">
        <label for="custom-module">Module</label>
        <select id="custom-module" name="module" required></select>
      </div>
      <div class="field">
        <label for="custom-title">Title</label>
        <input id="custom-title" name="title" type="text" required maxlength="200" value="Custom alert" />
      </div>
      <div class="field">
        <label for="custom-description">Description</label>
        <textarea id="custom-description" name="description" required maxlength="2000">Hand-built for QA</textarea>
      </div>
      <div class="field">
        <label for="custom-priority">Priority</label>
        <select id="custom-priority" name="priority" required>
          <option value="low">Low</option>
          <option value="normal" selected>Normal</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>
      <div class="field">
        <label for="custom-audience-scope">Audience</label>
        <select id="custom-audience-scope" name="audienceScope" required>
          <option value="global" selected>Everyone (global)</option>
          <option value="team">Team</option>
          <option value="role">Role</option>
          <option value="user">User</option>
        </select>
      </div>
      <div class="field" id="custom-audience-id-field" hidden>
        <label for="custom-audience-id">Audience ID</label>
        <input id="custom-audience-id" name="audienceId" type="text" maxlength="200" list="custom-audience-id-list" autocomplete="off" aria-describedby="custom-audience-hint" />
        <datalist id="custom-audience-id-list"></datalist>
        <p class="hint" id="custom-audience-hint"></p>
      </div>
      <div class="field">
        <fieldset id="custom-actions-fieldset">
          <legend>Actions</legend>
          <p class="empty">Select a module to see its actions.</p>
        </fieldset>
      </div>
      <div class="field">
        <label for="custom-count">Send how many</label>
        <input id="custom-count" name="count" type="number" min="1" max="${MAX_BURST}" value="1" required aria-describedby="custom-count-hint" />
        <p class="hint" id="custom-count-hint">Publishes this many copies (each a distinct notification). Max ${MAX_BURST}.</p>
      </div>
      <button class="submit" type="submit">Emit custom notification</button>
      <div class="result" id="custom-result" role="status" aria-live="polite"></div>
    </form>
  </section>

  <section class="panel" aria-labelledby="preset-heading">
    <h2 id="preset-heading"><span class="eyebrow">Preset</span> Start from a scenario</h2>
    <p class="hint">Pick a named scenario, load it into the Custom panel, then tweak and emit.</p>
    <form id="preset-form" novalidate>
      <div class="field">
        <label for="preset-select">Preset</label>
        <select id="preset-select" name="preset" required></select>
      </div>
      <button class="submit" type="submit">Load into Custom form</button>
      <div class="result" id="preset-result" role="status" aria-live="polite"></div>
    </form>
  </section>

  <section class="panel" aria-labelledby="burst-heading">
    <h2 id="burst-heading"><span class="eyebrow">Burst</span> Load-gen</h2>
    <p class="hint">Random notifications spread across all modules. Max ${MAX_BURST} per request.</p>
    <form id="burst-form" novalidate>
      <div class="field">
        <label for="burst-count">Count</label>
        <input id="burst-count" name="count" type="number" min="1" max="${MAX_BURST}" value="5" required />
      </div>
      <div class="field">
        <label for="burst-seed">Seed (optional)</label>
        <input id="burst-seed" name="seed" type="number" inputmode="numeric" placeholder="e.g. 42" aria-describedby="burst-seed-hint" />
        <p class="hint" id="burst-seed-hint">Same seed + count reproduces the same batch — set one for a repeatable demo. Leave blank for random.</p>
      </div>
      <button class="submit" type="submit">Emit burst</button>
      <div class="result" id="burst-result" role="status" aria-live="polite"></div>
    </form>
  </section>

  <section class="panel" aria-labelledby="thread-heading">
    <h2 id="thread-heading"><span class="eyebrow">Thread</span> One subject, many updates</h2>
    <p class="hint">A sequence of related DSR updates sharing one <code>#id</code> — the feed collapses them into a single group. Use it to demo grouping.</p>
    <form id="thread-form" novalidate>
      <div class="field">
        <label for="thread-count">Updates</label>
        <input id="thread-count" name="count" type="number" min="1" max="${MAX_BURST}" value="4" required />
      </div>
      <div class="field">
        <label for="thread-seed">Seed (optional)</label>
        <input id="thread-seed" name="seed" type="number" inputmode="numeric" placeholder="e.g. 7" aria-describedby="thread-seed-hint" />
        <p class="hint" id="thread-seed-hint">Fixes which <code>#id</code> the thread uses, for a repeatable demo. Leave blank for random.</p>
      </div>
      <button class="submit" type="submit">Emit thread</button>
      <div class="result" id="thread-result" role="status" aria-live="polite"></div>
    </form>
  </section>
</main>

<script>
(function () {
  "use strict";

  /** @type {{ modules: { key: string, actions: { name: string, label: string, method: string }[] }[], presets: { id: string, label: string, module: string, title: string, description: string, priority: string, category?: string, actionNames: string[], audienceScope: string }[] } | null} */
  var catalogData = null;

  function el(id) { return document.getElementById(id); }

  function showResult(node, state, text) {
    node.setAttribute("data-state", state);
    node.textContent = text;
  }

  function renderModuleOptions() {
    var select = el("custom-module");
    select.innerHTML = "";
    catalogData.modules.forEach(function (mod) {
      var opt = document.createElement("option");
      opt.value = mod.key;
      opt.textContent = mod.key;
      select.appendChild(opt);
    });
  }

  function renderPresetOptions() {
    var select = el("preset-select");
    select.innerHTML = "";
    catalogData.presets.forEach(function (preset) {
      var opt = document.createElement("option");
      opt.value = preset.id;
      opt.textContent = preset.label;
      select.appendChild(opt);
    });
  }

  // Prefills the Custom panel from a preset summary (client-side only — no /emit call). The
  // operator then edits any field and emits from the Custom form. Returns the preset's label
  // for the status line, or null if the id isn't in the catalog.
  function loadPresetIntoCustom(id) {
    var preset = catalogData.presets.find(function (p) { return p.id === id; });
    if (!preset) return null;

    el("custom-module").value = preset.module;
    renderActionsForModule(preset.module);
    el("custom-title").value = preset.title;
    el("custom-description").value = preset.description;
    el("custom-priority").value = preset.priority;
    el("custom-count").value = "1";

    el("custom-audience-scope").value = preset.audienceScope;
    renderAudienceScope(preset.audienceScope);

    // Check exactly the actions the preset names (renderActionsForModule just rebuilt them).
    var wanted = preset.actionNames || [];
    Array.prototype.slice
      .call(document.querySelectorAll('#custom-actions-fieldset input[name="action"]'))
      .forEach(function (input) { input.checked = wanted.indexOf(input.value) !== -1; });

    return preset.label;
  }

  function renderActionsForModule(moduleKey) {
    var fieldset = el("custom-actions-fieldset");
    var legend = fieldset.querySelector("legend");
    fieldset.innerHTML = "";
    fieldset.appendChild(legend);

    var mod = catalogData.modules.find(function (m) { return m.key === moduleKey; });
    if (!mod || mod.actions.length === 0) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "This module has no actions.";
      fieldset.appendChild(empty);
      return;
    }

    mod.actions.forEach(function (action, index) {
      var row = document.createElement("div");
      row.className = "action-row";

      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "action";
      checkbox.value = action.name;
      checkbox.id = "action-" + moduleKey + "-" + index;

      var label = document.createElement("label");
      label.setAttribute("for", checkbox.id);
      label.textContent = action.label + " (" + action.name + ")";

      var method = document.createElement("span");
      method.className = "method";
      method.textContent = action.method;

      row.appendChild(checkbox);
      row.appendChild(label);
      row.appendChild(method);
      fieldset.appendChild(row);
    });
  }

  // Autocomplete hints for the audience ID field, keyed by scope. These mirror the seeded
  // identity fixtures (backend/src/auth/seed.ts) so a dev/QA picks an id that actually resolves;
  // the field stays free text, so any value is still allowed. Note the seeded "admin" login is
  // role "admin" with no team, so role:admin or user:admin are the ones it will actually receive.
  var AUDIENCE_SUGGESTIONS = {
    team: ["privacy-ops", "security"],
    role: ["admin", "privacy-analyst", "security-reviewer", "access-approver"],
    user: ["admin", "priya", "sam", "alex", "jordan"],
  };

  function renderAudienceScope(scope) {
    var field = el("custom-audience-id-field");
    var input = el("custom-audience-id");
    var list = el("custom-audience-id-list");
    var hint = el("custom-audience-hint");

    if (scope === "global") {
      field.hidden = true;
      input.value = "";
      return;
    }

    field.hidden = false;
    var suggestions = AUDIENCE_SUGGESTIONS[scope] || [];
    list.innerHTML = "";
    suggestions.forEach(function (id) {
      var opt = document.createElement("option");
      opt.value = id;
      list.appendChild(opt);
    });
    input.placeholder = suggestions.length ? "e.g. " + suggestions[0] : scope + " id";
    hint.textContent =
      "Which " + scope + " should receive this. Seeded " + scope + "s: " + suggestions.join(", ") + ".";
    // On each scope change, prefill a sensible default: role/user default to "admin" (the seeded
    // login you test with will actually receive it); team has no admin member, so default to the
    // first seeded team. Overwriting on change avoids leaving a stale id from the previous scope.
    input.value = scope === "team" ? suggestions[0] : "admin";
  }

  function loadCatalog() {
    return fetch("/catalog")
      .then(function (res) {
        if (!res.ok) throw new Error("catalog request failed (" + res.status + ")");
        return res.json();
      })
      .then(function (data) {
        catalogData = data;
        renderModuleOptions();
        renderPresetOptions();
        if (catalogData.modules.length > 0) {
          renderActionsForModule(catalogData.modules[0].key);
        }
      })
      .catch(function (err) {
        showResult(el("custom-result"), "error", "Couldn't load /catalog: " + err.message);
      });
  }

  function postEmit(payload) {
    return fetch("/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (res) {
      return res.json().then(function (body) {
        return { ok: res.ok, status: res.status, body: body };
      });
    });
  }

  el("custom-module").addEventListener("change", function (event) {
    renderActionsForModule(event.target.value);
  });

  el("custom-audience-scope").addEventListener("change", function (event) {
    renderAudienceScope(event.target.value);
  });

  el("custom-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var resultNode = el("custom-result");
    var actions = Array.prototype.slice
      .call(document.querySelectorAll('#custom-actions-fieldset input[name="action"]:checked'))
      .map(function (input) { return input.value; });

    if (actions.length === 0) {
      showResult(resultNode, "error", "Select at least one action.");
      return;
    }
    if (actions.length > 5) {
      showResult(resultNode, "error", "Select at most 5 actions.");
      return;
    }

    var scope = el("custom-audience-scope").value;
    var audience = { scope: scope };
    if (scope !== "global") {
      var audienceId = el("custom-audience-id").value.trim();
      if (!audienceId) {
        showResult(resultNode, "error", "Enter an audience ID for the " + scope + " scope.");
        return;
      }
      audience.id = audienceId;
    }

    var count = parseInt(el("custom-count").value, 10);
    if (!Number.isInteger(count) || count < 1) {
      showResult(resultNode, "error", "Send count must be a positive integer.");
      return;
    }
    if (count > ${MAX_BURST}) {
      showResult(resultNode, "error", "Send count cannot exceed " + ${MAX_BURST} + ".");
      return;
    }

    var payload = {
      mode: "custom",
      module: el("custom-module").value,
      title: el("custom-title").value,
      description: el("custom-description").value,
      priority: el("custom-priority").value,
      actions: actions,
      count: count,
      audience: audience,
    };

    postEmit(payload).then(function (result) {
      if (result.ok) {
        showResult(resultNode, "ok", JSON.stringify(result.body));
      } else {
        showResult(resultNode, "error", "Error " + result.status + ": " + JSON.stringify(result.body));
      }
    }).catch(function (err) {
      showResult(resultNode, "error", "Request failed: " + err.message);
    });
  });

  el("preset-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var resultNode = el("preset-result");
    var label = loadPresetIntoCustom(el("preset-select").value);
    if (label === null) {
      showResult(resultNode, "error", "Unknown preset.");
      return;
    }
    showResult(resultNode, "ok", 'Loaded "' + label + '" into the Custom panel — edit and emit there.');
  });

  el("burst-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var resultNode = el("burst-result");
    var count = parseInt(el("burst-count").value, 10);
    var maxBurst = ${MAX_BURST};
    if (!Number.isInteger(count) || count < 1) {
      showResult(resultNode, "error", "Count must be a positive integer.");
      return;
    }
    if (count > maxBurst) {
      showResult(resultNode, "error", "Count exceeds max burst of " + maxBurst + ".");
      return;
    }
    var payload = { mode: "burst", count: count };
    var seedField = el("burst-seed").value.trim();
    if (seedField !== "") {
      var seed = parseInt(seedField, 10);
      if (!Number.isInteger(seed)) {
        showResult(resultNode, "error", "Seed must be an integer (or blank).");
        return;
      }
      payload.seed = seed;
    }

    postEmit(payload).then(function (result) {
      if (result.ok) {
        showResult(resultNode, "ok", JSON.stringify(result.body));
      } else {
        showResult(resultNode, "error", "Error " + result.status + ": " + JSON.stringify(result.body));
      }
    }).catch(function (err) {
      showResult(resultNode, "error", "Request failed: " + err.message);
    });
  });

  el("thread-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var resultNode = el("thread-result");
    var count = parseInt(el("thread-count").value, 10);
    var maxBurst = ${MAX_BURST};
    if (!Number.isInteger(count) || count < 1) {
      showResult(resultNode, "error", "Updates must be a positive integer.");
      return;
    }
    if (count > maxBurst) {
      showResult(resultNode, "error", "Updates cannot exceed " + maxBurst + ".");
      return;
    }
    var payload = { mode: "subject", count: count };
    var seedField = el("thread-seed").value.trim();
    if (seedField !== "") {
      var seed = parseInt(seedField, 10);
      if (!Number.isInteger(seed)) {
        showResult(resultNode, "error", "Seed must be an integer (or blank).");
        return;
      }
      payload.seed = seed;
    }

    postEmit(payload).then(function (result) {
      if (result.ok) {
        showResult(resultNode, "ok", JSON.stringify(result.body));
      } else {
        showResult(resultNode, "error", "Error " + result.status + ": " + JSON.stringify(result.body));
      }
    }).catch(function (err) {
      showResult(resultNode, "error", "Request failed: " + err.message);
    });
  });

  loadCatalog();
})();
</script>
</body>
</html>
`;
