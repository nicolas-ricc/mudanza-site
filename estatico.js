// Filtros y orden en el navegador para el sitio horneado. El estado de filtros vive en la query string
// y se recuerda en localStorage (mudanza.filtros): al entrar sin query se vuelve a los últimos filtros usados.
// Rangos: ?precio_min= ?precio_max= (USD) y ?m2_min= ?m2_max=; un aviso sin dato queda afuera si hay cota.
// Zona: dropdown de selección múltiple (#zonas) con partidos enteros (?partido=) y localidades sueltas (?zona=), repetibles.
// Votos: se hornean en #votos-iniciales, se refrescan desde el worker y se escriben con PUT /votos/<clave>.
(function () {
  const form = document.getElementById("filtros");
  const lista = document.getElementById("avisos");
  const filas = Array.from(lista.children);
  const total = filas.length;
  const conteo = document.getElementById("conteo");
  const vacio = document.getElementById("vacio");
  const quitar = document.getElementById("quitar");
  const votosUrl = document.body.dataset.votosUrl;
  let votos = {};
  try { votos = JSON.parse(document.getElementById("votos-iniciales").textContent) || {}; } catch { votos = {}; }

  // --- identidad: #yo=Nombre&token=xxx una vez, después queda en localStorage
  const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } },
               set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  // Debounce: la función corre ESPERA_TIPEO ms después del último llamado (así tipear no rehace la lista en cada tecla).
  const ESPERA_TIPEO = 400;
  function demorar(fn, ms = ESPERA_TIPEO) {
    let t;
    const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    d.cancelar = () => clearTimeout(t);
    return d;
  }
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("yo")) ls.set("mudanza.yo", hash.get("yo").trim());
  if (hash.get("token")) ls.set("mudanza.token", hash.get("token").trim());
  if (hash.get("yo") || hash.get("token")) history.replaceState(null, "", location.pathname + location.search);
  const yo = () => ls.get("mudanza.yo") || "";
  const token = () => ls.get("mudanza.token") || "";

  function identificarse() {
    if (yo() && token()) return true;
    const n = prompt("¿Cómo te llamás? (para firmar tus votos)", yo());
    if (!n) return false;
    const t = prompt("Token compartido para votar", token());
    if (!t) return false;
    ls.set("mudanza.yo", n.trim()); ls.set("mudanza.token", t.trim());
    return true;
  }

  // --- votos
  const clase = { si: "voto-si", no: "voto-no" };
  function pintarVotos(li) {
    const caja = li.querySelector(".votos");
    if (!caja) return;
    const v = votos[caja.dataset.clave] || {};
    const mio = v[yo()];
    for (const b of caja.querySelectorAll("button")) b.classList.toggle("activo", b.dataset.voto === mio);
    const quienes = caja.querySelector(".quienes");
    quienes.textContent = Object.entries(v).map(([q, r]) => `${q}: ${r === "si" ? "sí" : "no"}`).join(" · ");
    li.classList.remove("voto-si", "voto-no", "match");
    const rs = Object.values(v);
    if (rs.length && rs.every(r => r === "si")) li.classList.add(clase.si);
    if (rs.some(r => r === "no")) li.classList.add(clase.no);
    if (esMatch(v)) li.classList.add("match");
    let insignia = caja.querySelector(".insignia-match");
    if (esMatch(v) && !insignia) {
      insignia = document.createElement("span");
      insignia.className = "insignia-match";
      insignia.append(corazon(), "Match");
      caja.insertBefore(insignia, quienes);
    } else if (!esMatch(v) && insignia) insignia.remove();
  }

  // --- match: los dos dijeron que sí. Se avisa al producirlo votando y, al cargar, por los que aparecieron desde la última visita.
  const esMatch = v => { const rs = Object.values(v); return rs.length >= 2 && rs.every(r => r === "si"); };
  function corazon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "corazon"); svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#corazon");
    svg.append(use);
    return svg;
  }
  const filaDe = clave => filas.find(li => li.querySelector(".votos")?.dataset.clave === clave);
  const tituloDe = clave => filaDe(clave)?.querySelector(".aviso a")?.textContent.trim() || "un aviso";
  const vistos = { leer: () => { try { return JSON.parse(ls.get("mudanza.matches")) || null; } catch { return null; } },
                   guardar: c => ls.set("mudanza.matches", JSON.stringify(c)) };
  const matchesActuales = () => Object.keys(votos).filter(k => esMatch(votos[k]));
  const avisos = document.getElementById("matches");
  function avisarMatch(clave, detalle) {
    const li = filaDe(clave);
    if (li) { li.classList.remove("match-nuevo"); void li.offsetWidth; li.classList.add("match-nuevo"); }
    const aviso = document.createElement("div");
    aviso.className = "match-aviso";
    const texto = document.createElement("span"); texto.className = "texto";
    const b = document.createElement("b"); b.textContent = "¡Match!";
    const a = document.createElement("a"); a.href = "?votos=ambos"; a.textContent = "Ver todos los matches";
    a.addEventListener("click", e => { e.preventDefault(); escribir({ ...leer(), votos: "ambos" }); aplicar(leer(), true); cerrar(); });
    texto.append(b, detalle, document.createElement("br"), a);
    const x = document.createElement("button"); x.type = "button"; x.className = "cerrar"; x.textContent = "×"; x.setAttribute("aria-label", "Cerrar");
    let timer;
    const cerrar = () => { clearTimeout(timer); aviso.classList.add("saliendo"); setTimeout(() => aviso.remove(), 300); };
    x.addEventListener("click", cerrar);
    aviso.append(corazon(), texto, x);
    avisos.append(aviso);
    timer = setTimeout(cerrar, 8000);
  }
  // Avisa los matches que no estaban en la última visita. La primera vez sólo memoriza, para no inundar la pantalla.
  function anunciarMatchesNuevos() {
    const antes = vistos.leer();
    const ahora = matchesActuales();
    if (antes) for (const k of ahora) if (!antes.includes(k)) avisarMatch(k, tituloDe(k));
    vistos.guardar(ahora);
  }
  function estadoVoto(li, f) {
    const v = votos[li.querySelector(".votos").dataset.clave] || {};
    const rs = Object.values(v);
    switch (f.votos) {
      case "sin_mi_voto": return !v[yo()];
      case "me_gusta": return v[yo()] === "si";
      case "le_gusto_al_otro": return Object.entries(v).some(([q, r]) => q !== yo() && r === "si");
      case "ambos": return rs.length >= 2 && rs.every(r => r === "si");
      case "algun_no": return rs.some(r => r === "no");
      default: return true;
    }
  }
  async function api(metodo, ruta, body) {
    const r = await fetch(votosUrl.replace(/\/$/, "") + ruta, {
      method: metodo, headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 401) { ls.set("mudanza.token", ""); throw new Error("token inválido"); }
    if (!r.ok) throw new Error("error " + r.status);
    return r.json();
  }
  async function votar(caja, voto) {
    if (!votosUrl || !identificarse()) return;
    const clave = caja.dataset.clave;
    const actual = (votos[clave] || {})[yo()];
    const nuevo = actual === voto ? null : voto;     // tocar el mismo botón deshace el voto
    caja.classList.add("guardando");
    try {
      const habia = esMatch(votos[clave] || {});
      const res = await api("PUT", "/votos/" + encodeURIComponent(clave), { quien: yo(), voto: nuevo });
      votos[clave] = res[clave] || {};
      if (!Object.keys(votos[clave]).length) delete votos[clave];
      pintarVotos(caja.closest("li"));
      if (leer().votos) aplicar(leer(), false);
      if (!habia && esMatch(votos[clave])) {
        const otros = Object.keys(votos[clave]).filter(q => q !== yo()).join(" y ");
        avisarMatch(clave, `${otros} también dijo que sí a ${tituloDe(clave)}`);
      }
      vistos.guardar(matchesActuales());
    } catch (e) {
      alert("No se pudo guardar el voto: " + e.message);
    } finally {
      caja.classList.remove("guardando");
    }
  }
  async function refrescarVotos() {
    if (!votosUrl || !token()) return;
    try {
      votos = await api("GET", "/votos");
      for (const li of filas) pintarVotos(li);
      if (leer().votos) aplicar(leer(), false);
      anunciarMatchesNuevos();
    } catch { /* quedan los horneados */ }
  }
  lista.addEventListener("click", e => {
    const b = e.target.closest("button[data-voto]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();       // que no abra/cierre la ficha
    votar(b.closest(".votos"), b.dataset.voto);
  });

  // --- filtros y orden
  const num = (li, k) => { const v = li.dataset[k]; return v === "" ? null : Number(v); };
  const asc = (k) => (a, b) => {
    const x = num(a, k), y = num(b, k);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y;
  };
  const ORDENES = {
    precio: asc("precio"),
    usd_m2: asc("usd_m2"),
    m2: (a, b) => (num(b, "m2") || 0) - (num(a, "m2") || 0),
    minutos: asc("minutos"),
    nuevos: (a, b) => (b.dataset.nuevos || "").localeCompare(a.dataset.nuevos || ""),
  };
  const RANGOS = ["precio_min", "precio_max", "m2_min", "m2_max"];
  const CAMPOS = ["tipo", "votos", "orden", ...RANGOS];
  const VACIO = () => ({ zonas: [], partidos: [], tipo: "", votos: "", orden: "precio", precio_min: "", precio_max: "", m2_min: "", m2_max: "" });
  const limpio = v => { const n = Number(v); return v == null || String(v).trim() === "" || !Number.isFinite(n) || n < 0 ? "" : String(n); };
  const normalizar = f => {
    const o = { ...VACIO(), ...(f || {}) };
    o.zonas = Array.isArray(o.zonas) ? o.zonas.map(String) : []; o.partidos = Array.isArray(o.partidos) ? o.partidos.map(String) : [];
    o.tipo = String(o.tipo || ""); o.votos = String(o.votos || ""); o.orden = ORDENES[o.orden] ? o.orden : "precio";
    for (const k of RANGOS) o[k] = limpio(o[k]);
    return o;
  };
  // --- memoria: los últimos filtros usados, para retomarlos en la próxima visita
  const memoria = { leer: () => { try { return JSON.parse(ls.get("mudanza.filtros")); } catch { return null; } },
                    guardar: f => ls.set("mudanza.filtros", JSON.stringify(f)) };

  // --- zona: dropdown múltiple. Un partido tildado cubre todas sus localidades (que quedan tildadas y deshabilitadas).
  const multi = document.getElementById("zonas");
  const multiBoton = multi.querySelector(".multi-boton");
  const multiMenu = multi.querySelector(".multi-menu");
  const multiBuscar = multi.querySelector(".multi-buscar");
  const multiResumen = document.getElementById("zonas-resumen");
  const casillas = { partido: Array.from(multi.querySelectorAll("input[name=partido]")), zona: Array.from(multi.querySelectorAll("input[name=zona]")) };
  const hijasDe = c => Array.from(c.closest(".multi-grupo").querySelectorAll("input[name=zona]"));
  function cubrir(partido) {
    for (const z of hijasDe(partido)) { z.checked = partido.checked; z.disabled = partido.checked; }
  }
  function resumirZonas(f) {
    const nombres = [...f.partidos, ...f.zonas];
    multiResumen.textContent = !nombres.length ? "Todas" : nombres.length <= 2 ? nombres.join(", ") : `${nombres[0]} +${nombres.length - 1}`;
    multi.classList.toggle("con-valor", nombres.length > 0);
  }
  function abrirMenu(estado) {
    const abierto = estado === undefined ? multiMenu.hidden : estado;
    multiMenu.hidden = !abierto;
    multiBoton.setAttribute("aria-expanded", String(abierto));
    if (abierto) { multiBuscar.value = ""; buscarZona(""); multiBuscar.focus({ preventScroll: true }); }
  }
  function buscarZona(texto) {
    const t = texto.trim().toLocaleLowerCase();
    let alguna = false;
    for (const g of multi.querySelectorAll(".multi-grupo")) {
      const grupoCoincide = !t || g.dataset.nombre.toLocaleLowerCase().includes(t);
      let algunaHija = false;
      for (const li of g.querySelectorAll("li")) {
        const ok = grupoCoincide || li.dataset.nombre.toLocaleLowerCase().includes(t);
        li.hidden = !ok; algunaHija ||= ok;
      }
      g.hidden = !(grupoCoincide || algunaHija); alguna ||= !g.hidden;
    }
    multi.querySelector(".multi-vacio").hidden = alguna;
  }
  multiBoton.addEventListener("click", () => abrirMenu());
  multi.querySelector(".multi-cerrar").addEventListener("click", () => { abrirMenu(false); multiBoton.focus(); });
  multi.querySelector(".multi-limpiar").addEventListener("click", () => { escribir({ ...leer(), zonas: [], partidos: [] }); aplicar(leer(), true); multiBuscar.focus(); });
  multiBuscar.addEventListener("input", demorar(() => buscarZona(multiBuscar.value)));
  multi.addEventListener("change", e => { if (e.target.name === "partido") cubrir(e.target); });
  multi.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); abrirMenu(false); multiBoton.focus(); }
    if (e.key === "Enter" && e.target === multiBuscar) e.preventDefault();
  });
  document.addEventListener("click", e => { if (!multiMenu.hidden && !multi.contains(e.target)) abrirMenu(false); });
  multi.addEventListener("focusout", e => { if (!multiMenu.hidden && e.relatedTarget && !multi.contains(e.relatedTarget)) abrirMenu(false); });

  function leer() {
    const d = new FormData(form);
    const f = { zonas: d.getAll("zona"), partidos: d.getAll("partido"), tipo: d.get("tipo"), votos: d.get("votos"), orden: d.get("orden") };
    for (const k of RANGOS) f[k] = d.get(k);
    return normalizar(f);
  }
  function escribir(f) {
    f = normalizar(f);
    for (const c of casillas.partido) { c.checked = f.partidos.includes(c.value); cubrir(c); }
    for (const c of casillas.zona) if (!c.disabled) c.checked = f.zonas.includes(c.value);
    form.elements.votos.value = f.votos;
    form.elements.orden.value = f.orden;
    for (const r of form.elements.tipo) r.checked = r.value === f.tipo;
    for (const k of RANGOS) form.elements[k].value = f[k];
  }
  const enZona = (li, f) => (!f.zonas.length && !f.partidos.length) || f.zonas.includes(li.dataset.zona) || f.partidos.includes(li.dataset.partido);
  const enRango = (li, k, desde, hasta) => {
    if (desde === "" && hasta === "") return true;
    const v = num(li, k);
    return v !== null && (desde === "" || v >= Number(desde)) && (hasta === "" || v <= Number(hasta));
  };
  const hayRangos = f => RANGOS.some(k => f[k] !== "");
  function aUrl(f) {
    const p = new URLSearchParams();
    for (const z of f.partidos) p.append("partido", z);
    for (const z of f.zonas) p.append("zona", z);
    for (const k of CAMPOS) if (f[k] && !(k === "orden" && f[k] === "precio")) p.set(k, f[k]);
    const q = p.toString();
    return q ? "?" + q : location.pathname;
  }
  // Orden: el DOM queda siempre ordenado por el criterio elegido, con TODAS las filas (ocultas incluidas), así el filtro
  // solo alterna hidden. Se reordena únicamente cuando cambia el criterio, y de una sola vez: se drena la lista a un
  // fragmento y se vuelve a insertar entera. Mover filas de a una con appendChild sobre la lista colgada del documento
  // cuesta ~4 ms por fila en Chrome con 4.000 filas (y deja las filas movidas caras para siempre): eran 12-16 s de freeze.
  let ordenDom = null;
  function ordenar(orden) {
    if (orden === ordenDom) return;
    const todas = filas.slice();
    todas.sort(ORDENES.precio);                        // desempate: el más barato primero
    todas.sort(ORDENES[orden]);
    ordenDom = orden;
    if (todas.every((li, i) => li === lista.children[i])) return;   // ya está así (p. ej. el horneado)
    const foco = lista.contains(document.activeElement) ? document.activeElement : null;
    const fr = document.createDocumentFragment();
    while (lista.lastChild) fr.prepend(lista.lastChild);
    lista.append(...todas);
    if (foco) foco.focus({ preventScroll: true });
  }
  function aplicar(f, empujar) {
    f = normalizar(f);
    resumirZonas(f);
    for (const k of ["precio", "m2"]) form.querySelector(`.rango[data-campo=${k}]`).classList.toggle("con-valor", f[k + "_min"] !== "" || f[k + "_max"] !== "");
    ordenar(f.orden);
    let visibles = 0;
    for (const li of filas) {                          // filtrar es solo alternar hidden: nunca se mueven filas acá
      const ok = enZona(li, f) && (!f.tipo || li.dataset.tipo === f.tipo) && estadoVoto(li, f)
        && enRango(li, "precio", f.precio_min, f.precio_max) && enRango(li, "m2", f.m2_min, f.m2_max);
      li.hidden = !ok;
      if (ok) visibles++;
    }
    conteo.textContent = visibles === total ? `${total} avisos aprobados` : `${visibles} de ${total} avisos`;
    vacio.hidden = visibles > 0;
    quitar.hidden = !(f.zonas.length || f.partidos.length || f.tipo || f.votos || hayRangos(f));
    if (empujar) {
      memoria.guardar(f);
      const url = aUrl(f);
      if (url !== location.pathname + location.search) history.pushState(null, "", url);
    }
  }
  function desdeUrl() {
    const p = new URLSearchParams(location.search);
    const f = { zonas: p.getAll("zona"), partidos: p.getAll("partido"), tipo: p.get("tipo"), votos: p.get("votos"), orden: p.get("orden") };
    for (const k of RANGOS) f[k] = p.get(k);
    escribir(f);
    aplicar(leer(), false);
  }
  // Sin query en la URL, se retoman los filtros de la última visita y la URL pasa a reflejarlos (sin sumar historial).
  function arrancar() {
    const recordados = !location.search && memoria.leer();
    if (!recordados) return desdeUrl();
    escribir(recordados);
    const f = leer();
    aplicar(f, false);
    history.replaceState(null, "", aUrl(f));
  }

  form.addEventListener("change", e => { if (e.target.name && e.target.type !== "number") aplicar(leer(), true); });   // el buscador de zonas no tiene name
  const filtrarRango = demorar(() => aplicar(leer(), true));   // los rangos filtran recién cuando se deja de tipear
  form.addEventListener("input", e => { if (e.target.type === "number") filtrarRango(); });
  form.addEventListener("submit", e => { e.preventDefault(); filtrarRango.cancelar(); aplicar(leer(), true); });
  for (const a of [quitar, ...vacio.querySelectorAll(".quitar")]) {
    a.addEventListener("click", e => { e.preventDefault(); escribir({ ...VACIO(), orden: leer().orden }); aplicar(leer(), true); });
  }
  window.addEventListener("popstate", desdeUrl);
  if (!votosUrl) for (const c of document.querySelectorAll(".votos, [name=votos]")) c.closest("label, .votos").hidden = true;
  for (const li of filas) pintarVotos(li);
  arrancar();
  refrescarVotos();

  // --- teclado: un cursor de fila (li.actual) cuya <summary> tiene el foco, así Enter/Espacio abren la ficha nativamente.
  // j/k/↑/↓ mueven, s/n votan, o abre el aviso, / y 1-9 van a los filtros, ? muestra la ayuda.
  const ayuda = document.getElementById("ayuda");
  const barra = document.querySelector(".barra");
  const medirBarra = () => document.documentElement.style.setProperty("--barra-alto", barra.offsetHeight + "px");
  medirBarra(); window.addEventListener("resize", medirBarra);

  const visibles = () => Array.from(lista.children).filter(li => !li.hidden);   // en el orden de pantalla
  const actual = () => lista.querySelector("li.actual:not([hidden])");
  const detalles = li => li.querySelector("details");
  function irA(li, enfocar = true) {
    for (const o of lista.querySelectorAll("li.actual")) o.classList.remove("actual");
    if (!li) return;
    li.classList.add("actual");
    const sum = li.querySelector("summary");
    if (enfocar) sum.focus({ preventScroll: true });
    sum.scrollIntoView({ block: "nearest" });
  }
  function mover(paso) {
    const vs = visibles();
    if (!vs.length) return;
    const i = vs.indexOf(actual());
    irA(vs[i < 0 ? (paso > 0 ? 0 : vs.length - 1) : Math.min(vs.length - 1, Math.max(0, i + paso))]);
  }
  function abrir(li, estado) {
    if (!li) return;
    const d = detalles(li);
    d.open = estado === undefined ? !d.open : estado;
    if (d.open) requestAnimationFrame(() => li.querySelector("summary").scrollIntoView({ block: "nearest" }));
  }
  const enCampo = e => e.target.closest("input, select, textarea, [contenteditable]");
  const tipos = () => Array.from(form.elements.tipo);

  lista.addEventListener("focusin", e => {           // Tab también mueve el cursor
    const li = e.target.closest("li");
    if (li && !li.classList.contains("actual")) irA(li, false);
  });
  document.addEventListener("keydown", e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (ayuda && ayuda.open) { if (e.key === "Escape" || e.key === "?") { e.preventDefault(); ayuda.close(); } return; }
    if (enCampo(e)) {                                // Escape en un filtro: volver a la lista
      if (e.key === "Escape") { e.preventDefault(); e.target.blur(); irA(actual() || visibles()[0]); }
      return;
    }
    const li = actual();
    const teclas = {
      j: () => mover(1), ArrowDown: () => mover(1),
      k: () => mover(-1), ArrowUp: () => mover(-1),
      g: () => irA(visibles()[0]), Home: () => irA(visibles()[0]),
      G: () => irA(visibles().at(-1)), End: () => irA(visibles().at(-1)),
      l: () => abrir(li, true), ArrowRight: () => abrir(li, true),
      h: () => abrir(li, false), ArrowLeft: () => abrir(li, false),
      Escape: () => { if (li && detalles(li).open) abrir(li, false); else if (li) irA(null); },
      s: () => li && votar(li.querySelector(".votos"), "si"),
      n: () => li && votar(li.querySelector(".votos"), "no"),
      o: () => { const a = li && li.querySelector(".aviso a"); if (a) window.open(a.href, "_blank", "noopener"); },
      "/": () => abrirMenu(true),
      v: () => form.elements.votos.focus(),
      r: () => form.elements.orden.focus(),
      p: () => form.elements.precio_min.focus(),
      a: () => form.elements.m2_min.focus(),
      t: () => document.querySelector(".tema").click(),
      m: () => { location.href = "mapa.html" + location.search; },
      "?": () => ayuda && ayuda.showModal(),
    };
    if (/^[1-9]$/.test(e.key)) { const r = tipos()[Number(e.key) - 1]; if (r) { r.checked = true; aplicar(leer(), true); e.preventDefault(); } return; }
    if (e.key === "Enter" && li && !e.target.closest("summary")) { abrir(li); e.preventDefault(); return; }
    const f = teclas[e.key];
    if (!f) return;
    e.preventDefault();
    f();
  });
  if (ayuda) ayuda.addEventListener("click", e => { if (e.target === ayuda || e.target.closest("button")) ayuda.close(); });
})();
