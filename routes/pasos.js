const express = require("express");
const {
  listPasos,
  createPaso,
  updatePaso,
  deletePaso,
} = require("../dbPasos");
const { requireAuth } = require("./auth");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const items = await listPasos(req.user.id);
    res.json({ ok: true, count: items.length, items });
  } catch (err) {
    console.error("[GET /api/pasos]", err);
    res
      .status(500)
      .json({ ok: false, error: err.message || "Error al listar pasos" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const item = await createPaso(req.user.id, req.body);
    res.status(201).json({ ok: true, item });
  } catch (err) {
    console.error("[POST /api/pasos]", err);
    res.status(400).json({
      ok: false,
      error: err.message || "No se pudo crear el registro",
    });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "ID inválido." });
  }
  try {
    const item = await updatePaso(id, req.user.id, req.body);
    if (!item) {
      return res.status(404).json({ ok: false, error: "Registro no encontrado." });
    }
    res.json({ ok: true, item });
  } catch (err) {
    console.error("[PUT /api/pasos]", err);
    res.status(400).json({
      ok: false,
      error: err.message || "No se pudo actualizar el registro",
    });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "ID inválido." });
  }
  try {
    const ok = await deletePaso(id, req.user.id);
    if (!ok) {
      return res.status(404).json({ ok: false, error: "Registro no encontrado." });
    }
    res.json({ ok: true, id });
  } catch (err) {
    console.error("[DELETE /api/pasos]", err);
    res.status(500).json({
      ok: false,
      error: err.message || "No se pudo eliminar el registro",
    });
  }
});

module.exports = router;
