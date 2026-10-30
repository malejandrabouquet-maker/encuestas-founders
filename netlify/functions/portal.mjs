// PORTAL-ENCUESTAS-V1-0-0
// netlify/functions/portal.mjs
// Es el único servidor del portal de encuestas. La página nunca habla directo con Google ni con GHL.
//  - Pide la contraseña en el header x-password (variable DASHBOARD_PASSWORD).
//  - GET  /api/portal            lee el Excel de Mel + la planilla propia (por el script de Google) y GHL. Cachea 2 minutos.
//  - GET  /api/portal?fresh=1    se saltea la caché.
//  - POST /api/portal            escribe, pero solo a través de una lista cerrada de acciones.
// Variables de entorno en Netlify: DASHBOARD_PASSWORD, APPS_SCRIPT_URL, APPS_SCRIPT_KEY, GHL_TOKEN
// (opcionales: GHL_LOCATION_ID, GHL_PIPELINE_ID).

import crypto from "node:crypto";
import { construirModelo, normalizarOportunidades, PIPELINE, CALC_VERSION } from "../../calculo.mjs";

export const config = { path: ["/api/portal"] };

const CACHE_MS = 2 * 60 * 1000;
const limite = () => Number(process.env.PORTAL_LIMITE_MS) || 8500; // Netlify corta a los ~10 segundos: se corta antes con un mensaje claro
let cache = null; // { t, datos }

const ACCIONES = {
  marcarAviso: ["clave", "cliente", "email", "enc", "aviso", "fecha", "usuario", "nota"],
  deshacerAviso: ["clave", "cliente", "enc", "aviso", "usuario"],
  marcarRecibida: ["clave", "cliente", "email", "enc", "consultor", "fecha", "debia", "etapa", "usuario"],
  deshacerRecibida: ["clave", "cliente", "enc", "usuario"],
  guardarNota: ["clave", "cliente", "enc", "nota", "usuario"],
  fijarDuracion: ["clave", "cliente", "email", "dias", "usuario"],
  registrarDetectadas: [],
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function autorizado(req) {
  const real = process.env.DASHBOARD_PASSWORD || "";
  if (!real) return { ok: false, falta: true };
  const dado = Buffer.from(req.headers.get("x-password") || "");
  const esperado = Buffer.from(real);
  return { ok: dado.length === esperado.length && crypto.timingSafeEqual(dado, esperado) };
}
function limpiarSecretos(texto) {
  let t = String(texto || "");
  [process.env.APPS_SCRIPT_KEY, process.env.GHL_TOKEN, process.env.DASHBOARD_PASSWORD].forEach((s) => {
    if (s && s.length > 5) t = t.split(s).join("***");
  });
  return t;
}
// Resume lo que contestó Google cuando no es JSON: sin etiquetas ni claves.
function resumirTexto(txt) {
  return limpiarSecretos(
    String(txt || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220)
  );
}
async function fetchConTiempo(url, opciones, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opciones, signal: ac.signal });
  } catch (err) {
    if (err && err.name === "AbortError") {
      const e = new Error("tardó demasiado en contestar");
      e.demora = true;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

// ---------- script de Google ----------
function urlScript() {
  const base = process.env.APPS_SCRIPT_URL;
  if (!base) throw new Error("Falta la variable APPS_SCRIPT_URL en Netlify.");
  if (!process.env.APPS_SCRIPT_KEY) throw new Error("Falta la variable APPS_SCRIPT_KEY en Netlify.");
  return base;
}
async function parsearScript(r) {
  const txt = await r.text();
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error(`Google no contestó con datos (HTTP ${r.status}). Dijo: ${resumirTexto(txt) || "(nada)"}`);
  }
}
async function scriptLeer(ms) {
  const u = new URL(urlScript());
  u.searchParams.set("key", process.env.APPS_SCRIPT_KEY);
  u.searchParams.set("accion", "leer");
  const r = await fetchConTiempo(u.toString(), { redirect: "follow" }, ms);
  const j = await parsearScript(r);
  if (!j.ok) throw new Error(`El script de Google contestó: ${j.error || "error sin detalle"}`);
  return j;
}
async function scriptEscribir(cuerpo, ms) {
  const r = await fetchConTiempo(urlScript(), { method: "POST", redirect: "follow", headers: { "content-type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...cuerpo, key: process.env.APPS_SCRIPT_KEY }) }, ms);
  return parsearScript(r);
}

// ---------- GHL ----------
async function ghlLeer(ms) {
  const token = process.env.GHL_TOKEN;
  if (!token) throw new Error("Falta la variable GHL_TOKEN en Netlify.");
  const loc = process.env.GHL_LOCATION_ID || PIPELINE.locationId;
  const pipe = process.env.GHL_PIPELINE_ID || PIPELINE.id;
  const t0 = Date.now();
  const cab = { Authorization: "Bearer " + token, Version: "2021-07-28", Accept: "application/json" };
  const estilos = [
    { location_id: loc, pipeline_id: pipe },
    { locationId: loc, pipelineId: pipe },
  ];
  let ultimoError = "";
  for (let e = 0; e < estilos.length; e++) {
    const todas = [];
    let startAfter = "", startAfterId = "";
    let fallo = false;
    for (let pag = 0; pag < 8; pag++) {
      const u = new URL("https://services.leadconnectorhq.com/opportunities/search");
      Object.entries(estilos[e]).forEach(([k, v]) => u.searchParams.set(k, v));
      u.searchParams.set("status", "all");
      u.searchParams.set("limit", "100");
      if (startAfter) {
        u.searchParams.set("startAfter", startAfter);
        u.searchParams.set("startAfterId", startAfterId);
      }
      const resto = ms - (Date.now() - t0);
      if (resto < 400) throw new Error("GHL tardó demasiado en contestar");
      const r = await fetchConTiempo(u.toString(), { headers: cab }, resto);
      if (!r.ok) {
        const txt = await r.text();
        ultimoError = `GHL contestó ${r.status}: ${resumirTexto(txt) || "(sin detalle)"}`;
        if (r.status === 401 || r.status === 403) throw new Error(ultimoError + " Revisá el token y sus permisos (View Opportunities).");
        fallo = true;
        break;
      }
      const j = await r.json();
      const lista = j.opportunities || [];
      todas.push(...lista);
      const meta = j.meta || {};
      if (!lista.length || (meta.total && todas.length >= meta.total) || !meta.startAfter) break;
      startAfter = String(meta.startAfter);
      startAfterId = String(meta.startAfterId || "");
    }
    if (!fallo) return { lista: todas, parametros: e === 0 ? "location_id" : "locationId" };
  }
  throw new Error(ultimoError || "GHL no contestó");
}

// ---------- lectura ----------
async function obtener(fresh) {
  if (!fresh && cache && Date.now() - cache.t < CACHE_MS) return { ...cache.datos, fuentes: { ...cache.datos.fuentes, cache: true } };
  const [rScript, rGhl] = await Promise.allSettled([scriptLeer(limite() - 300), ghlLeer(limite() - 300)]);
  if (rScript.status === "rejected") {
    const e = rScript.reason;
    throw new Error(e && e.demora ? "El script de Google tardó demasiado en contestar. Probá de nuevo en unos segundos." : limpiarSecretos(e && e.message));
  }
  const s = rScript.value;
  const fuentes = {
    leidoEn: new Date().toISOString(),
    cache: false,
    mel: { ok: true, hoja: s.mel.hoja, filas: s.mel.filas.length },
    planilla: { ok: true, url: s.planillaUrl, zona: s.zona },
    script: { version: s.version },
    ghl: { ok: false, total: 0, error: "", parametros: "" },
  };
  let oportunidades = [];
  let ghlOk = false;
  if (rGhl.status === "fulfilled") {
    oportunidades = normalizarOportunidades(rGhl.value.lista);
    ghlOk = true;
    fuentes.ghl = { ok: true, total: oportunidades.length, error: "", parametros: rGhl.value.parametros };
    const desconocidas = oportunidades.filter((o) => !o.etapa).length;
    if (desconocidas) fuentes.ghl.aviso = `${desconocidas} oportunidad(es) en una etapa que el portal no conoce.`;
  } else {
    const e = rGhl.reason;
    fuentes.ghl = { ok: false, total: 0, error: limpiarSecretos(e && e.demora ? "GHL tardó demasiado en contestar" : e && e.message), parametros: "" };
  }
  const datos = {
    ok: true,
    calcVersion: CALC_VERSION,
    fuentes,
    entrada: {
      hoy: s.hoy,
      config: s.config,
      clientes: s.mel.filas,
      fichas: s.fichas,
      avisos: s.avisos,
      recibidas: s.recibidas,
      notas: s.notas,
      oportunidades,
      ghlOk,
    },
    planillaUrl: s.planillaUrl,
    historial: s.historial,
  };
  cache = { t: Date.now(), datos };
  return datos;
}

// ---------- escritura ----------
function limpiarCuerpo(accion, cuerpo) {
  const out = { accion };
  ACCIONES[accion].forEach((k) => {
    if (cuerpo[k] !== undefined && cuerpo[k] !== null) out[k] = cuerpo[k];
  });
  return out;
}
async function escribir(cuerpo) {
  const accion = cuerpo && cuerpo.accion;
  if (!accion || !Object.prototype.hasOwnProperty.call(ACCIONES, accion)) return json(400, { ok: false, error: "Acción no permitida." });
  const inicio = Date.now();
  let pedido;
  if (accion === "registrarDetectadas") {
    // la lista la arma el servidor, no la página
    let datos;
    try {
      datos = cache && Date.now() - cache.t < CACHE_MS ? cache.datos : await obtener(true);
    } catch (e) {
      return json(502, { ok: false, error: limpiarSecretos(e.message) });
    }
    const modelo = construirModelo(datos.entrada);
    if (!modelo.detectadas.length) return json(200, { ok: true, registradas: 0 });
    if (Date.now() - inicio > limite() - 3500) return json(200, { ok: true, registradas: 0, omitido: true });
    pedido = { accion, items: modelo.detectadas };
  } else {
    pedido = limpiarCuerpo(accion, cuerpo);
  }
  try {
    const j = await scriptEscribir(pedido, Math.max(2000, limite() - (Date.now() - inicio)));
    cache = null;
    if (!j.ok) return json(400, { ok: false, error: limpiarSecretos(j.error) });
    return json(200, j);
  } catch (e) {
    cache = null;
    if (e && e.demora) return json(202, { ok: true, pendiente: true, mensaje: "Google está tardando. Se va a verificar solo si se guardó." });
    return json(502, { ok: false, error: limpiarSecretos(e && e.message) });
  }
}

export default async (req) => {
  const auth = autorizado(req);
  if (auth.falta) return json(500, { ok: false, error: "Falta la variable DASHBOARD_PASSWORD en Netlify." });
  if (!auth.ok) return json(401, { ok: false, error: "Contraseña incorrecta." });
  try {
    if (req.method === "GET") {
      const fresh = new URL(req.url).searchParams.get("fresh") === "1";
      return json(200, await obtener(fresh));
    }
    if (req.method === "POST") {
      let cuerpo;
      try {
        cuerpo = await req.json();
      } catch {
        return json(400, { ok: false, error: "El pedido no llegó como JSON." });
      }
      return await escribir(cuerpo);
    }
    return json(405, { ok: false, error: "Método no permitido." });
  } catch (e) {
    return json(502, { ok: false, error: limpiarSecretos(e && e.message) });
  }
};

// solo para las pruebas
export function _vaciarCache() {
  cache = null;
}
