const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  createUser,
  authenticate,
  createSession,
  getUserBySession,
  deleteSession,
  SESSION_TTL_MS,
} = require("../dbPasos");

const router = express.Router();
const SESSION_COOKIE = "pasos_session";

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Demasiados intentos de acceso. Reintentá en un minuto.",
  },
});

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production";
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

async function requireAuth(req, res, next) {
  try {
    const cookies = parseCookies(req);
    const user = await getUserBySession(cookies[SESSION_COOKIE]);
    if (!user) {
      return res
        .status(401)
        .json({ ok: false, error: "Necesitás iniciar sesión." });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error("[auth]", err);
    res.status(500).json({ ok: false, error: "Error de autenticación." });
  }
}

router.post("/register", authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = await createUser(username, password);
    const { token } = await createSession(user.id);
    setSessionCookie(res, token);
    res.status(201).json({ ok: true, user: { username: user.username } });
  } catch (err) {
    res
      .status(400)
      .json({ ok: false, error: err.message || "No se pudo registrar." });
  }
});

router.post("/login", authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = await authenticate(username, password);
    if (!user) {
      return res
        .status(401)
        .json({ ok: false, error: "Usuario o contraseña incorrectos." });
    }
    const { token } = await createSession(user.id);
    setSessionCookie(res, token);
    res.json({ ok: true, user: { username: user.username } });
  } catch (err) {
    console.error("[login]", err);
    res.status(500).json({ ok: false, error: "Error al iniciar sesión." });
  }
});

router.post("/logout", async (req, res) => {
  try {
    const cookies = parseCookies(req);
    await deleteSession(cookies[SESSION_COOKIE]);
  } catch (err) {
    console.warn("[logout]", err.message);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", async (req, res) => {
  const cookies = parseCookies(req);
  const user = await getUserBySession(cookies[SESSION_COOKIE]);
  if (!user) return res.status(401).json({ ok: false });
  res.json({ ok: true, user: { username: user.username } });
});

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.SESSION_COOKIE = SESSION_COOKIE;
