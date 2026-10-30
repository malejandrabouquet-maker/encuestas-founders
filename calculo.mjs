// PORTAL-ENCUESTAS-V1-4-0
// calculo.mjs
// Toda la lógica de negocio del portal de encuestas. Es un módulo puro:
// no lee planillas, no llama a GHL y no toca la pantalla. Recibe datos y devuelve resultados.
// Lo usan dos lugares: la función de Netlify (servidor) y la página (index.html lleva una copia adentro).
// Las fechas son siempre texto "AAAA-MM-DD" para que la zona horaria nunca cambie un día.

export const CALC_VERSION = "1.3.0";
export const ZONA = "America/Argentina/Buenos_Aires";

// ---------- programas ----------
// "cortes" son los días, contados desde la fecha de ingreso, en que toca cada encuesta.
export const PROGRAMAS = {
  M1: { dias: 120, cortes: [30, 66, 102], etiqueta: "M1, 4 meses" },
  M2: { dias: 180, cortes: [45, 99, 153], etiqueta: "M2, 6 meses" },
  A1: { dias: 365, cortes: [91, 201, 310], etiqueta: "1 año" },
};

// ---------- pipeline "Encuestas de Satisfacción" de GHL ----------
export const PIPELINE = {
  id: "dyjiHN3N4GMJPrmf2Msb",
  locationId: "x7nYndpXUc1dmpunATsZ",
  etapas: {
    "ffc1f9f4-c9d1-4567-91f9-16ecf0cac449": "Inicio",
    "47381cbe-a6a6-49cc-830f-36a59a52288b": "Pendiente Encuesta 1",
    "ec9e0af0-0fda-4fb2-a006-6e87e3a79c80": "Recibida Encuesta 1",
    "a10da424-ad94-4cc9-8a84-10a1576d08a2": "Esperando Encuesta 2",
    "9a6981fd-d224-433c-b213-aae00b25ab53": "Recibida Encuesta 2",
    "d98e769e-8c0f-4c79-8991-cde388dd1cac": "Esperando Encuesta 3",
    "9a626b63-a50d-4447-8d21-ff60fbf8ff4f": "Recibida Encuesta 3",
    "89d1102b-d372-4c92-9cc2-5df83cd93da3": "Completado",
    "8d5c586d-049d-4279-a07b-7a0be99256d1": "Abandono",
    "bb04a5ec-7abd-485d-b79c-6b6e0e8ef53f": "Pausa por impago",
    "aef498cc-a65c-450b-8c0d-46add9f0e8db": "No respondió",
  },
};
// Etapas que decide Male a mano: el portal las respeta y nunca las marca como error.
export const ETAPAS_MANUALES = ["Completado", "Abandono", "Pausa por impago", "No respondió"];
// Etapas en las que no se mandan avisos.
export const ETAPAS_BLOQUEO = ["Pausa por impago", "No respondió", "Abandono"];

export const CONFIG_POR_DEFECTO = {
  arranque: "2026-10-30", // las encuestas anteriores a esta fecha no se exigen
  plazoAvisos: 2, // días entre un aviso y el siguiente
  diasSinRespuesta: 5, // días después del aviso 3 para sugerir "No respondió"
  diasTareasExtra: 120, // las tareas extra solo miran clientes que ingresaron hace menos de estos días
  feriados: [],
};

// ---------- fechas ----------
const MS = 86400000;
const p2 = (n) => String(n).padStart(2, "0");
function aMs(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function deMs(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}
export function sumarDias(iso, n) {
  return deMs(aMs(iso) + n * MS);
}
export function difDias(a, b) {
  return Math.round((aMs(a) - aMs(b)) / MS);
}
export function diaSemana(iso) {
  return new Date(aMs(iso)).getUTCDay(); // 0 domingo ... 6 sábado
}
function esFechaReal(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${p2(m)}-${p2(d)}`;
  return deMs(aMs(iso)) === iso ? iso : null;
}
// Acepta "29/9/2026", "29/09/26", "2026-09-29" y variantes con hora. Devuelve "AAAA-MM-DD" o null.
export function parseFecha(texto) {
  if (texto == null) return null;
  const s = String(texto).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return esFechaReal(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return esFechaReal(y, +m[2], +m[1]);
  }
  return null;
}
export function fmtFecha(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
// Sábado se adelanta al viernes, domingo pasa al lunes, feriado se adelanta al día hábil anterior.
export function diaHabil(iso, feriados = []) {
  const fer = new Set(feriados);
  let d = iso;
  const w = diaSemana(d);
  if (w === 6) d = sumarDias(d, -1);
  else if (w === 0) d = sumarDias(d, 1);
  let guarda = 0;
  while ((fer.has(d) || diaSemana(d) === 0 || diaSemana(d) === 6) && guarda++ < 14) d = sumarDias(d, -1);
  return d;
}
// "Hoy" en Argentina, sin importar la zona del servidor.
export function fechaAR(fecha) {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(fecha);
  return partes; // en-CA entrega AAAA-MM-DD
}
export function hoyAR() {
  return fechaAR(new Date());
}
export function isoAFechaAR(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : fechaAR(d);
}

// ---------- identificación de clientes ----------
export function normalizarEmail(raw) {
  if (!raw) return "";
  const s = String(raw).toLowerCase().replace(/mailto:/g, " ");
  const m = s.match(/[a-z0-9._%+\-']+@[a-z0-9\-]+(?:\.[a-z0-9\-]+)+/);
  return m ? m[0] : "";
}
export function normalizarNombre(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function claveCliente(email, nombre) {
  const e = normalizarEmail(email);
  return e ? e : "n:" + normalizarNombre(nombre);
}

// ---------- duración y fechas de las encuestas ----------
// Devuelve null si el programa no se reconoce y no hay una duración especial cargada.
export function cortesDe(programa, durEspecial) {
  const dur = Number(durEspecial) || 0;
  if (dur > 0) {
    for (const k of Object.keys(PROGRAMAS)) {
      if (PROGRAMAS[k].dias === dur) return { clave: k, dias: dur, cortes: PROGRAMAS[k].cortes.slice(), etiqueta: PROGRAMAS[k].etiqueta, especial: true };
    }
    return { clave: "X", dias: dur, cortes: [25, 55, 85].map((p) => Math.round((dur * p) / 100)), etiqueta: `${dur} días (proporcional)`, especial: true };
  }
  const k = String(programa || "").trim().toUpperCase().replace(/\s+/g, "");
  if (k === "M1" || k === "M2") return { clave: k, dias: PROGRAMAS[k].dias, cortes: PROGRAMAS[k].cortes.slice(), etiqueta: PROGRAMAS[k].etiqueta, especial: false };
  return null;
}

// Cuántas encuestas ya recibió un cliente según su etapa en GHL (null = no se sabe).
export function progresoGhl(etapa) {
  const m = {
    Inicio: 0,
    "Pendiente Encuesta 1": 0,
    "Recibida Encuesta 1": 1,
    "Esperando Encuesta 2": 1,
    "Recibida Encuesta 2": 2,
    "Esperando Encuesta 3": 2,
    "Recibida Encuesta 3": 3,
    Completado: 3,
  };
  return etapa in m ? m[etapa] : null;
}

// ---------- oportunidades de GHL ----------
export function normalizarOportunidades(lista) {
  return (lista || []).map((o) => {
    const c = o.contact || {};
    const rel = (o.relations && o.relations[0]) || {};
    const email = normalizarEmail(c.email || rel.email || "");
    const nombre = String(c.name || rel.fullName || o.name || "").trim();
    return {
      id: o.id,
      nombre,
      email,
      clave: claveCliente(email, nombre),
      etapaId: o.pipelineStageId || "",
      etapa: PIPELINE.etapas[o.pipelineStageId] || null,
      estado: o.status || "",
      cambioEtapa: isoAFechaAR(o.lastStageChangeAt),
      creada: isoAFechaAR(o.createdAt),
    };
  });
}

// ---------- estado de cada encuesta ----------
export function estadoEvento(ev, cliente) {
  if (ev.rec) return "rec";
  if (cliente.etapa === "Pausa por impago") return "pausa";
  return ev.avisos.some(Boolean) ? "proc" : "nuevo";
}
export const ESTADO_ROTULO = { nuevo: "Nueva", proc: "En proceso", rec: "Recibida", pausa: "Pausa por impago" };

function etapaEsperada(c, hoy) {
  if (!c.eventos.length || c.manual || !c.opp) return null;
  const prog = progresoGhl(c.etapa);
  // la última encuesta con actividad registrada: las anteriores sin confirmar se consideran salteadas
  const actividad = Math.max(0, ...c.eventos.filter((e) => e.rec || e.avisos.some(Boolean)).map((e) => e.n));
  let ultima = 0;
  for (const e of c.eventos) {
    if (e.rec) {
      ultima = e.n;
      continue;
    }
    if (e.historico) {
      if (prog != null && e.n <= prog) ultima = e.n; // GHL confirma que se recibió
      else if (e.n < actividad) ultima = e.n; // se salteó: hubo actividad en una posterior
      else return null; // anterior al arranque y sin confirmar: no se compara
    }
  }
  if (ultima === 3) return "Recibida Encuesta 3";
  const sig = c.eventos[ultima];
  const nn = ultima + 1;
  if (sig.avisos[0] && sig.shown <= hoy) return nn === 1 ? "Pendiente Encuesta 1" : `Esperando Encuesta ${nn}`;
  return ultima === 0 ? "Inicio" : `Recibida Encuesta ${ultima}`;
}

// ---------- el modelo completo ----------
// entrada = { hoy, config, clientes[], fichas[], avisos[], recibidas[], notas[], oportunidades[], ghlOk }
export function construirModelo(entrada) {
  const cfg = { ...CONFIG_POR_DEFECTO, ...(entrada.config || {}) };
  const hoy = entrada.hoy;
  const ghlOk = entrada.ghlOk !== false && Array.isArray(entrada.oportunidades);
  const alertas = [];

  // 1. clientes del Excel de Mel, sin repetidos
  const grupos = new Map();
  (entrada.clientes || []).forEach((f) => {
    const nombre = String(f.nombre || "").trim();
    const email = normalizarEmail(f.email);
    if (!nombre && !email) return;
    const clave = claveCliente(email, nombre);
    const reg = { fila: f.fila || 0, nombre: nombre || email, email, programa: String(f.programa || "").trim(), ingresoTxt: f.ingreso, ingreso: parseFecha(f.ingreso), consultor: String(f.consultor || "").trim(), clave };
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(reg);
  });
  const fichas = new Map();
  (entrada.fichas || []).forEach((f) => fichas.set(f.clave, f));

  const clientes = [];
  grupos.forEach((filas, clave) => {
    const ficha = fichas.get(clave) || null;
    let elegido = filas[0];
    if (filas.length > 1) {
      const buenas = filas.filter((r) => r.ingreso && cortesDe(r.programa, ficha && ficha.dias)).sort((a, b) => (a.ingreso < b.ingreso ? -1 : 1));
      if (buenas.length) elegido = buenas[0];
      alertas.push({ t: "dup", clave, txt: `Aparece ${filas.length} veces en el Excel de Mel (filas ${filas.map((r) => r.fila).join(", ")}). Se usa la fila ${elegido.fila}.` });
    }
    // el inicio del programa se puede ajustar a mano por cliente (ficha); si no, vale la fecha de ingreso del Excel
    const inicio = ficha && ficha.inicio ? parseFecha(ficha.inicio) : null;
    clientes.push({ ...elegido, ingresoExcel: elegido.ingreso, ingreso: inicio || elegido.ingreso, inicioEspecial: !!inicio, ficha, cortes: null, eventos: [], opp: null, etapa: "", manual: "", bloqueado: false, ghlIdDesconocido: false });
  });

  // 2. oportunidades de GHL
  const opps = ghlOk ? entrada.oportunidades : [];
  const porClave = new Map();
  const porNombre = new Map();
  opps.forEach((o) => {
    if (!porClave.has(o.clave)) porClave.set(o.clave, []);
    porClave.get(o.clave).push(o);
    const nk = "n:" + normalizarNombre(o.nombre);
    if (!porNombre.has(nk)) porNombre.set(nk, []);
    porNombre.get(nk).push(o);
  });
  const usadas = new Set();

  // 3. registros de la planilla propia
  const avisosV = (entrada.avisos || []).filter((a) => String(a.estado || "").toLowerCase() !== "deshecho");
  const recV = (entrada.recibidas || []).filter((a) => String(a.estado || "").toLowerCase() !== "deshecho");
  // recibidas que Male deshizo a propósito: GHL puede seguir diciendo "Recibida" pero no se vuelven a detectar
  const suprimidas = new Set((entrada.recibidas || []).filter((r) => String(r.estado || "").toLowerCase() === "deshecho" && r.origen === "Detectada por GHL").map((r) => r.clave + "#" + Number(r.enc)));
  const notasPor = new Map();
  (entrada.notas || []).forEach((n) => notasPor.set(n.clave + "#" + n.enc, n));

  const detectadas = [];
  clientes.forEach((c, i) => {
    c.i = i;
    const dur = c.ficha && c.ficha.dias ? c.ficha.dias : 0;
    c.cortes = cortesDe(c.programa, dur);
    const activo = c.ingreso ? difDias(hoy, c.ingreso) <= 365 : false;

    // GHL
    let cand = porClave.get(c.clave) || [];
    if (!cand.length) cand = porNombre.get("n:" + normalizarNombre(c.nombre)) || [];
    if (cand.length) {
      const orden = cand.slice().sort((a, b) => ((b.creada || "") < (a.creada || "") ? -1 : 1));
      c.opp = orden[0];
      cand.forEach((o) => usadas.add(o.id));
      if (cand.length > 1) alertas.push({ t: "dupGhl", ci: i, txt: `Tiene ${cand.length} oportunidades en el pipeline de GHL. Se usa la más nueva.` });
      c.etapa = c.opp.etapa || "";
      if (!c.opp.etapa) {
        c.ghlIdDesconocido = true;
        alertas.push({ t: "etapaDesc", ci: i, txt: "Está en una etapa de GHL que el portal no conoce. Avisale a quien mantiene el portal." });
      }
    }
    c.manual = ETAPAS_MANUALES.includes(c.etapa) ? c.etapa : "";
    c.bloqueado = ETAPAS_BLOQUEO.includes(c.etapa);

    // encuestas
    if (!c.ingreso) {
      if (c.programa) alertas.push({ t: "fecha", ci: i, txt: "No tiene fecha de ingreso en el Excel de Mel, por eso no se generan sus encuestas." });
      return;
    }
    if (!c.cortes) {
      if (activo) alertas.push({ t: "prog", ci: i, txt: `El programa “${c.programa || "(vacío)"}” no tiene duración definida, por eso no se generan sus encuestas. Fijale la duración.` });
      return;
    }
    c.cortes.cortes.forEach((dd, k) => {
      const n = k + 1;
      const calc = sumarDias(c.ingreso, dd);
      const ev = { id: `${i}-${n}`, i, n, clave: c.clave, dia: dd, calc, shown: diaHabil(calc, cfg.feriados), historico: false, avisos: [null, null, null], avisoInfo: [null, null, null], rec: null, nota: "", notaTs: "", notaUser: "" };
      avisosV.filter((a) => a.clave === c.clave && Number(a.enc) === n).forEach((a) => {
        const j = Number(a.aviso) - 1;
        if (j >= 0 && j < 3 && !ev.avisos[j]) {
          ev.avisos[j] = parseFecha(a.fecha) || hoy;
          ev.avisoInfo[j] = { usuario: a.usuario || "", ts: a.ts || "" };
        }
      });
      const r = recV.filter((x) => x.clave === c.clave && Number(x.enc) === n)[0];
      if (r) ev.rec = { fecha: parseFecha(r.fecha) || hoy, origen: r.origen || "Marcada a mano", usuario: r.usuario || "", detectada: false };
      const nt = notasPor.get(c.clave + "#" + n);
      if (nt && nt.nota) {
        ev.nota = nt.nota;
        ev.notaTs = nt.ts || "";
        ev.notaUser = nt.usuario || "";
      }
      ev.historico = ev.shown < cfg.arranque && !ev.avisos.some(Boolean) && !ev.rec;
      c.eventos.push(ev);
    });

    // encuestas recibidas que GHL ya movió y todavía no están en la planilla
    const m = /^Recibida Encuesta ([123])$/.exec(c.etapa || "");
    if (ghlOk && m) {
      const ev = c.eventos[Number(m[1]) - 1];
      if (ev && !ev.rec && !ev.historico && !suprimidas.has(c.clave + "#" + ev.n)) {
        const fecha = (c.opp && c.opp.cambioEtapa) || hoy;
        ev.rec = { fecha, origen: "Detectada por GHL", usuario: "", detectada: true };
        detectadas.push({ clave: c.clave, cliente: c.nombre, email: c.email, enc: ev.n, consultor: c.consultor, debia: ev.shown, fecha, etapa: c.etapa });
      }
    }
  });

  const eventos = [];
  clientes.forEach((c) => c.eventos.forEach((e) => eventos.push(e)));
  const vivos = eventos.filter((e) => !e.historico);

  // 4. alertas
  clientes.forEach((c) => {
    if (!c.eventos.length) return;
    const seguido = c.eventos.some((e) => !e.historico);
    if (!seguido) return;
    if (!c.manual && c.opp) {
      const esp = etapaEsperada(c, hoy);
      c.esperada = esp;
      if (esp && c.etapa && c.etapa !== esp) alertas.push({ t: "etapa", ci: c.i, txt: `En GHL está en “${c.etapa}” y debería estar en “${esp}”.` });
    } else c.esperada = null;
    if (!c.manual) {
      c.eventos.forEach((e) => {
        if (!e.historico && !e.rec && e.avisos[2]) {
          const d = difDias(hoy, e.avisos[2]);
          if (d >= cfg.diasSinRespuesta) alertas.push({ t: "nr", ci: c.i, txt: `Aviso 3 de la Encuesta ${e.n} enviado el ${fmtFecha(e.avisos[2]).slice(0, 5)}, hace ${d} días, sin respuesta. Si no responde, pasalo a “No respondió” en GHL.` });
        }
      });
    }
    if (!c.email) alertas.push({ t: "mail", ci: c.i, txt: "No tiene email en el Excel de Mel: no se puede cruzar con GHL, se identifica por nombre." });
    if (ghlOk && !c.opp) alertas.push({ t: "sinGhl", ci: c.i, txt: "No está en el pipeline Encuestas de Satisfacción de GHL." });
  });
  const soloGhl = ghlOk ? opps.filter((o) => !usadas.has(o.id)) : [];

  // 5. avisos pendientes de enviar (hoy o atrasados)
  const pendientes = [];
  vivos.forEach((ev) => {
    const c = clientes[ev.i];
    if (ev.rec || c.manual) return;
    const enviados = ev.avisos.filter(Boolean).length;
    if (enviados === 0) {
      if (ev.shown <= hoy) pendientes.push({ id: ev.id, k: 1, vence: ev.shown, dias: difDias(hoy, ev.shown) });
    } else if (enviados < 3) {
      const vence = diaHabil(sumarDias(ev.avisos[enviados - 1], cfg.plazoAvisos), cfg.feriados);
      if (vence <= hoy) pendientes.push({ id: ev.id, k: enviados + 1, vence, dias: difDias(hoy, vence) });
    }
  });
  pendientes.sort((a, b) => (a.vence < b.vence ? -1 : a.vence > b.vence ? 1 : 0));

  // 6. tareas extra: la última encuesta ya vencida (anterior al arranque) que nunca se envió
  const tareasExtra = [];
  clientes.forEach((c) => {
    if (!c.eventos.length || c.manual || !c.ingreso) return;
    if (difDias(hoy, c.ingreso) > cfg.diasTareasExtra) return;
    const hist = c.eventos.filter((e) => e.historico && e.shown < hoy);
    if (!hist.length) return;
    const ult = hist[hist.length - 1];
    if (c.eventos.some((e) => e.n > ult.n && (e.rec || e.avisos.some(Boolean)))) return; // ya se trabajó una posterior
    const prog = progresoGhl(c.etapa);
    if (prog != null && ult.n <= prog) return; // GHL dice que ya la recibió
    const yaEnviada = (c.etapa === "Pendiente Encuesta 1" && ult.n === 1) || (c.etapa === "Esperando Encuesta 2" && ult.n === 2) || (c.etapa === "Esperando Encuesta 3" && ult.n === 3);
    if (yaEnviada) return; // GHL dice que ya se le avisó
    const salteadas = hist.filter((e) => e.n < ult.n && !(prog != null && e.n <= prog)).map((e) => e.n);
    ult.extra = true;
    tareasExtra.push({ id: ult.id, n: ult.n, vence: ult.shown, dias: difDias(hoy, ult.shown), salteadas });
  });
  tareasExtra.sort((a, b) => a.dias - b.dias || (a.id < b.id ? -1 : 1));

  // listos para pasar a Completado: GHL ya los tiene en "Recibida Encuesta 3", o todas sus encuestas figuran recibidas
  const listos = clientes.filter((c) => !c.manual && c.eventos.length && (c.etapa === "Recibida Encuesta 3" || c.eventos.every((e) => e.rec)));

  return { version: CALC_VERSION, hoy, config: cfg, ghlOk, clientes, eventos, vivos, alertas, detectadas, soloGhl, pendientes, tareasExtra, listos };
}

// ---------- estadísticas ----------
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function lunesDe(iso) {
  return sumarDias(iso, -((diaSemana(iso) + 6) % 7));
}
export function estadisticas(modelo, modo) {
  const hoy = modelo.hoy;
  const grupos = new Map();
  modelo.vivos.forEach((ev) => {
    const c = modelo.clientes[ev.i];
    let k, l, o, ahora = false, futuro = false;
    if (modo === "mes") {
      const [y, m] = ev.shown.split("-").map(Number);
      k = y * 100 + m;
      o = k;
      l = `${MESES[m - 1].charAt(0).toUpperCase()}${MESES[m - 1].slice(1)} ${y}`;
      const [hy, hm] = hoy.split("-").map(Number);
      ahora = hy * 100 + hm === k;
      futuro = k > hy * 100 + hm;
    } else if (modo === "semana") {
      const lun = lunesDe(ev.shown);
      k = lun;
      o = aMs(lun);
      l = `${lun.slice(8, 10)}/${lun.slice(5, 7)} al ${sumarDias(lun, 4).slice(8, 10)}/${sumarDias(lun, 4).slice(5, 7)}`;
      ahora = lun === lunesDe(hoy);
      futuro = lun > lunesDe(hoy);
    } else if (modo === "consultor") {
      k = c.consultor || "Sin asignar";
      l = k;
      o = 0;
    } else {
      k = "E" + ev.n;
      l = "Encuesta " + ev.n;
      o = ev.n;
    }
    if (!grupos.has(k)) grupos.set(k, { l, o, d: 0, env: 0, rec: 0, sin: 0, pv: 0, blq: 0, ahora, futuro });
    const g = grupos.get(k);
    g.d++;
    if (ev.avisos[0]) g.env++;
    else if (c.bloqueado) g.blq++;
    else if (ev.shown > hoy) g.pv++;
    else g.sin++;
    if (ev.rec) g.rec++;
  });
  const arr = [...grupos.values()];
  if (modo === "consultor") arr.sort((a, b) => (a.l === "Sin asignar" ? 1 : b.l === "Sin asignar" ? -1 : b.d - a.d));
  else arr.sort((a, b) => a.o - b.o);
  return arr;
}
export function porcentaje(a, b) {
  return b > 0 ? Math.round((a * 100) / b) : null;
}
