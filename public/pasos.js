/**
 * Pasos / profundidades / alturas — multiusuario.
 * Auth por sesión (cookie httpOnly):
 *   POST /api/auth/register · /api/auth/login · /api/auth/logout · GET /api/auth/me
 * CRUD acotado al usuario:
 *   GET/POST /api/pasos · PUT/DELETE /api/pasos/:id
 */

function apiUrl(path) {
  return typeof resolveApiUrl !== "undefined" ? resolveApiUrl(path) : path;
}

function api(path, options) {
  return fetch(apiUrl(path), {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(options && options.headers) },
    ...options,
  });
}

const el = {
  statusPanel: document.getElementById("status-panel"),
  statusText: document.getElementById("status-text"),
  heroActions: document.getElementById("hero-actions"),
  userChip: document.getElementById("user-chip"),
  btnNew: document.getElementById("btn-new"),
  btnRefresh: document.getElementById("btn-refresh"),
  btnLogout: document.getElementById("btn-logout"),
  authCard: document.getElementById("auth-card"),
  authForm: document.getElementById("auth-form"),
  authError: document.getElementById("auth-error"),
  authSubmit: document.getElementById("auth-submit"),
  authUsername: document.getElementById("auth-username"),
  authPassword: document.getElementById("auth-password"),
  tabLogin: document.getElementById("tab-login"),
  tabRegister: document.getElementById("tab-register"),
  formCard: document.getElementById("form-card"),
  formTitle: document.getElementById("form-title"),
  form: document.getElementById("paso-form"),
  formError: document.getElementById("form-error"),
  btnSave: document.getElementById("btn-save"),
  btnCancel: document.getElementById("btn-cancel"),
  tableRoot: document.getElementById("table-root"),
  fields: {
    id: document.getElementById("field-id"),
    fecha: document.getElementById("field-fecha"),
    puerto: document.getElementById("field-puerto"),
    altura: document.getElementById("field-altura"),
    paso: document.getElementById("field-paso"),
    profundidad: document.getElementById("field-profundidad"),
    ancho: document.getElementById("field-ancho"),
  },
};

let items = [];
let authMode = "login"; // "login" | "register"

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function setStatus(msg, isError = false) {
  el.statusText.textContent = msg;
  el.statusPanel.classList.toggle("status--error", !!isError);
}

// ─── Vistas: autenticado vs invitado ──────────────────────────────────────────

function showAuthView() {
  el.authCard.hidden = false;
  el.heroActions.hidden = true;
  el.formCard.hidden = true;
  el.tableRoot.innerHTML = "";
  items = [];
}

function showAppView(username) {
  el.authCard.hidden = true;
  el.heroActions.hidden = false;
  el.userChip.textContent = `@${username}`;
}

function setAuthError(msg) {
  if (!msg) {
    el.authError.hidden = true;
    el.authError.textContent = "";
    return;
  }
  el.authError.hidden = false;
  el.authError.textContent = msg;
}

function setAuthMode(mode) {
  authMode = mode;
  const login = mode === "login";
  el.tabLogin.classList.toggle("auth-tab--current", login);
  el.tabRegister.classList.toggle("auth-tab--current", !login);
  el.authSubmit.textContent = login ? "Entrar" : "Crear cuenta";
  el.authPassword.autocomplete = login ? "current-password" : "new-password";
  setAuthError("");
}

async function submitAuth(event) {
  event.preventDefault();
  setAuthError("");
  const username = el.authUsername.value.trim();
  const password = el.authPassword.value;
  if (!username || !password) {
    return setAuthError("Completá usuario y contraseña.");
  }
  const path = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
  el.authSubmit.disabled = true;
  try {
    const res = await api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return setAuthError(data.error || `Error HTTP ${res.status}`);
    }
    el.authForm.reset();
    showAppView(data.user.username);
    await loadItems();
  } catch (e) {
    console.error(e);
    setAuthError("No se pudo conectar al servidor.");
  } finally {
    el.authSubmit.disabled = false;
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch (e) {
    console.error(e);
  }
  closeForm();
  showAuthView();
  setStatus("Sesión cerrada. Iniciá sesión para ver tus registros.");
}

// ─── Formulario CRUD ───────────────────────────────────────────────────────────

function showFormError(msg) {
  if (!msg) {
    el.formError.hidden = true;
    el.formError.textContent = "";
    return;
  }
  el.formError.hidden = false;
  el.formError.textContent = msg;
}

function openForm(record) {
  showFormError("");
  if (record) {
    el.formTitle.textContent = `Editar registro · ${record.puerto}`;
    el.fields.id.value = record.id;
    el.fields.fecha.value = record.fecha || "";
    el.fields.puerto.value = record.puerto || "";
    el.fields.altura.value = record.altura || "";
    el.fields.paso.value = record.paso || "";
    el.fields.profundidad.value = record.profundidad || "";
    el.fields.ancho.value = record.ancho || "";
  } else {
    el.formTitle.textContent = "Nuevo registro";
    el.form.reset();
    el.fields.id.value = "";
  }
  el.formCard.hidden = false;
  el.fields.fecha.focus();
  el.formCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function closeForm() {
  el.formCard.hidden = true;
  el.form.reset();
  el.fields.id.value = "";
  showFormError("");
}

function renderTable() {
  if (!items.length) {
    el.tableRoot.innerHTML =
      '<p class="empty">Aún no tenés registros. Tocá «Nuevo registro» para cargar el primero.</p>';
    return;
  }

  const head = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Puerto</th>
          <th>Altura</th>
          <th>Paso</th>
          <th>Profundidad</th>
          <th>Ancho</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>`;

  const body = items
    .map(
      (row) => `
        <tr>
          <td class="num">${escapeHtml(row.fecha)}</td>
          <td class="col-localidad">${escapeHtml(row.puerto)}</td>
          <td class="num">${escapeHtml(row.altura)}</td>
          <td>${escapeHtml(row.paso)}</td>
          <td class="num">${escapeHtml(row.profundidad)}</td>
          <td class="num">${escapeHtml(row.ancho)}</td>
          <td class="row-actions">
            <button type="button" class="btn-mini" data-action="edit" data-id="${row.id}">Editar</button>
            <button type="button" class="btn-mini btn-mini--danger" data-action="delete" data-id="${row.id}">Eliminar</button>
          </td>
        </tr>`
    )
    .join("");

  el.tableRoot.innerHTML = `<div class="table-scroll">${head}${body}</tbody></table></div>`;
}

/** Si la API responde 401, volvemos a la vista de login. */
function handleUnauthorized() {
  showAuthView();
  setStatus("Tu sesión expiró. Iniciá sesión de nuevo.", true);
}

async function loadItems() {
  setStatus("Cargando registros…");
  try {
    const res = await api("/api/pasos");
    if (res.status === 401) return handleUnauthorized();
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setStatus(data.error || `Error HTTP ${res.status}`, true);
      return;
    }
    items = Array.isArray(data.items) ? data.items : [];
    setStatus(
      items.length
        ? `${items.length} registro(s) tuyo(s) cargado(s).`
        : "No tenés registros todavía."
    );
    renderTable();
  } catch (e) {
    console.error(e);
    setStatus("No se pudo conectar al servidor local.", true);
  }
}

function collectForm() {
  return {
    fecha: el.fields.fecha.value.trim(),
    puerto: el.fields.puerto.value.trim(),
    altura: el.fields.altura.value.trim(),
    paso: el.fields.paso.value.trim(),
    profundidad: el.fields.profundidad.value.trim(),
    ancho: el.fields.ancho.value.trim(),
  };
}

async function submitForm(event) {
  event.preventDefault();
  showFormError("");

  const payload = collectForm();
  if (!payload.fecha) return showFormError("La fecha es obligatoria.");
  if (!payload.puerto) return showFormError("El puerto es obligatorio.");

  const id = el.fields.id.value.trim();
  const editing = !!id;

  el.btnSave.disabled = true;
  try {
    const res = await api(editing ? `/api/pasos/${id}` : "/api/pasos", {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) return handleUnauthorized();
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return showFormError(data.error || `Error HTTP ${res.status}`);
    }
    closeForm();
    await loadItems();
    setStatus(editing ? "Registro actualizado." : "Registro creado.");
  } catch (e) {
    console.error(e);
    showFormError("No se pudo guardar. ¿El servidor está activo?");
  } finally {
    el.btnSave.disabled = false;
  }
}

async function deleteItem(id) {
  const record = items.find((r) => String(r.id) === String(id));
  const label = record ? `${record.puerto} (${record.fecha})` : `#${id}`;
  if (!window.confirm(`¿Eliminar el registro de ${label}?`)) return;
  try {
    const res = await api(`/api/pasos/${id}`, { method: "DELETE" });
    if (res.status === 401) return handleUnauthorized();
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return setStatus(data.error || `Error HTTP ${res.status}`, true);
    }
    await loadItems();
    setStatus("Registro eliminado.");
  } catch (e) {
    console.error(e);
    setStatus("No se pudo eliminar. ¿El servidor está activo?", true);
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────────

el.tableRoot.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.getAttribute("data-id");
  const action = btn.getAttribute("data-action");
  if (action === "edit") {
    const record = items.find((r) => String(r.id) === String(id));
    if (record) openForm(record);
  } else if (action === "delete") {
    deleteItem(id);
  }
});

el.btnNew.addEventListener("click", () => openForm(null));
el.btnCancel.addEventListener("click", closeForm);
el.btnRefresh.addEventListener("click", loadItems);
el.btnLogout.addEventListener("click", logout);
el.form.addEventListener("submit", submitForm);
el.authForm.addEventListener("submit", submitAuth);
el.tabLogin.addEventListener("click", () => setAuthMode("login"));
el.tabRegister.addEventListener("click", () => setAuthMode("register"));

async function init() {
  setAuthMode("login");
  try {
    const res = await api("/api/auth/me");
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.ok && data.user) {
        showAppView(data.user.username);
        await loadItems();
        return;
      }
    }
  } catch (e) {
    console.error(e);
  }
  showAuthView();
  setStatus("Iniciá sesión o creá una cuenta para gestionar tus registros.");
}

document.addEventListener("DOMContentLoaded", init);
