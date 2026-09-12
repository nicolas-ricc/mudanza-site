// Mapa del AMBA: coropleta por zona (barrios de CABA, partidos del GBA) con cantidad de avisos o USD/m² mediano.
// Los polígonos vienen en #geo (refdata/amba.geojson) y los avisos en #datos; todo se calcula en el navegador.
// Estado en la query string: metrica, tipo, puntos, zona. Los colores son clases CSS (q1..q5), así siguen al tema.
(function () {
  const geo = JSON.parse(document.getElementById("geo").textContent);
  const datos = JSON.parse(document.getElementById("datos").textContent);
  const form = document.getElementById("controles");
  const panel = document.getElementById("panel");
  const resumen = document.getElementById("resumen");
  const leyenda = document.getElementById("leyenda");
  const barra = document.querySelector(".barra");
  const CLASES = 5;
  const MAX_FILAS = 12;

  const medirBarra = () => document.documentElement.style.setProperty("--barra-alto", barra.offsetHeight + "px");
  medirBarra(); window.addEventListener("resize", medirBarra);

  // --- formato
  const miles = v => v == null ? "?" : Math.round(v).toLocaleString("es-AR");
  const mediana = xs => {
    if (!xs.length) return null;
    const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // Enlace a la lista: un partido entero va como ?partido=, una localidad o barrio como ?zona=
  const esPartido = nombre => geo.features.some(x => x.properties.nivel === "partido" && x.properties.partido === nombre);
  const enlaceLista = (nombre, tipo, partido = false) => "index.html?" + new URLSearchParams(Object.assign(partido ? { partido: nombre } : { zona: nombre }, tipo ? { tipo } : {})).toString();

  // --- estado
  function leer() {
    const d = new FormData(form);
    return { metrica: d.get("metrica") || "avisos", tipo: d.get("tipo") || "", puntos: d.get("puntos") === "on", zona: seleccion };
  }
  function escribir(f) {
    for (const r of form.elements.metrica) r.checked = r.value === f.metrica;
    for (const r of form.elements.tipo) r.checked = r.value === f.tipo;
    form.elements.puntos.checked = f.puntos;
  }
  function empujar(f) {
    const p = new URLSearchParams();
    if (f.metrica !== "avisos") p.set("metrica", f.metrica);
    if (f.tipo) p.set("tipo", f.tipo);
    if (f.puntos) p.set("puntos", "1");
    if (f.zona) p.set("zona", f.zona);
    const q = p.toString();
    history.replaceState(null, "", q ? "?" + q : location.pathname);
  }
  let seleccion = null;       // nombre de zona (barrio o localidad) o de partido

  // --- estadísticas por zona y por partido para el tipo elegido
  function estadisticas(tipo) {
    const zonas = {}, partidos = {};
    const nuevo = () => ({ n: 0, precios: [], um2s: [], minutos: [], avisos: [] });
    for (const a of datos.puntos) {
      if (tipo && a.t !== tipo) continue;
      if (!a.z) continue;
      const partido = datos.partidos[a.z] || "Otros";
      for (const e of [zonas[a.z] ||= nuevo(), partidos[partido] ||= nuevo()]) {
        e.n++; e.avisos.push(a);
        if (a.p) e.precios.push(a.p);
        if (a.um2) e.um2s.push(a.um2);
        if (a.min != null) e.minutos.push(a.min);
      }
    }
    const cerrar = e => Object.assign(e, { um2: mediana(e.um2s), precio: mediana(e.precios),
      desde: e.precios.length ? Math.min(...e.precios) : null, min: e.minutos.length ? Math.min(...e.minutos) : null });
    for (const e of Object.values(zonas)) cerrar(e);
    for (const e of Object.values(partidos)) cerrar(e);
    return { zonas, partidos };
  }
  const valorDe = (e, metrica) => !e ? null : metrica === "avisos" ? e.n : e.um2;
  function cortes(valores) {              // quintiles sobre las zonas con dato; devuelve CLASES-1 umbrales crecientes
    const s = valores.filter(v => v != null).sort((a, b) => a - b);
    if (!s.length) return [];
    const out = [];
    for (let i = 1; i < CLASES; i++) out.push(s[Math.min(s.length - 1, Math.floor(s.length * i / CLASES))]);
    return out;
  }
  const clase = (v, umbrales) => { if (v == null) return 0; let q = 1; for (const u of umbrales) if (v > u) q++; return Math.min(q, CLASES); };

  // --- mapa
  const mapa = L.map("mapa", { zoomControl: true, attributionControl: true, keyboard: true, zoomSnap: 0.5 });
  mapa.attributionControl.setPrefix(false);
  const atribucion = 'Fondo: <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · barrios: <a href="https://data.buenosaires.gob.ar/dataset/barrios">BA Data</a> · partidos: <a href="https://datos.gob.ar/dataset/jgm-servicio-normalizacion-direcciones-unidades-territoriales-argentina">IGN/Georef</a>';
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_{estilo}_Gray_{capa}/MapServer/tile/{z}/{y}/{x}";
  mapa.createPane("etiquetas").style.zIndex = 650;
  mapa.getPane("etiquetas").style.pointerEvents = "none";
  let fondo = null, etiquetas = null, estiloFondo = null;
  function pintarFondo() {
    const oscuro = (document.documentElement.dataset.tema || (matchMedia("(prefers-color-scheme: dark)").matches ? "mocha" : "latte")) === "mocha";
    const estilo = oscuro ? "Dark" : "Light";
    if (estilo === estiloFondo) return;
    estiloFondo = estilo;
    if (fondo) { mapa.removeLayer(fondo); mapa.removeLayer(etiquetas); }
    fondo = L.tileLayer(ESRI, { estilo, capa: "Base", maxNativeZoom: 16, maxZoom: 18, attribution: atribucion }).addTo(mapa);
    etiquetas = L.tileLayer(ESRI, { estilo, capa: "Reference", maxNativeZoom: 16, maxZoom: 18, pane: "etiquetas" }).addTo(mapa);
  }
  pintarFondo();
  L.Control.Leyenda = L.Control.extend({ onAdd: () => leyenda });   // dentro del mapa, así en el celular no tapa el panel
  const controlLeyenda = new L.Control.Leyenda({ position: "bottomleft" }).addTo(mapa);
  L.DomEvent.disableClickPropagation(leyenda);
  const angosto = matchMedia("(max-width: 860px)");       // en el celular la atribución ocupa todo el borde inferior
  const ubicarLeyenda = () => controlLeyenda.setPosition(angosto.matches ? "topright" : "bottomleft");
  ubicarLeyenda(); angosto.addEventListener("change", ubicarLeyenda);
  new MutationObserver(pintarFondo).observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", pintarFondo);

  const nombreDe = f => f.properties.nivel === "barrio" ? f.properties.zona : f.properties.partido;
  const capaZonas = L.geoJSON(geo, {
    style: { className: "zona", weight: 1, fillOpacity: 1 },
    onEachFeature(f, capa) {
      const nombre = nombreDe(f);
      capa.bindTooltip(() => textoTooltip(f), { sticky: true, direction: "top", className: "pista", opacity: 1 });
      capa.on("click", () => seleccionar(seleccion === nombre ? null : nombre));
      capa.on("mouseover", () => capa.getElement()?.classList.add("sobre"));
      capa.on("mouseout", () => capa.getElement()?.classList.remove("sobre"));
      capa.on("add", () => {
        const el = capa.getElement();
        if (!el) return;
        el.setAttribute("tabindex", "0");
        el.setAttribute("role", "button");
        el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); seleccionar(seleccion === nombre ? null : nombre); } });
        el.addEventListener("focus", () => capa.openTooltip(capa.getBounds().getCenter()));
        el.addEventListener("blur", () => capa.closeTooltip());
      });
    },
  }).addTo(mapa);
  const caba = L.latLngBounds([]);
  capaZonas.eachLayer(capa => { if (capa.feature.properties.nivel === "barrio") caba.extend(capa.getBounds()); });
  mapa.fitBounds(caba.pad(0.9));                 // CABA y el primer cordón; Pilar o Escobar quedan a un zoom de distancia
  mapa.setMaxBounds(capaZonas.getBounds().pad(0.6));
  mapa.options.minZoom = mapa.getZoom() - 2;

  const capaPuntos = L.layerGroup();
  function pintarPuntos(f) {
    capaPuntos.clearLayers();
    if (!f.puntos) { mapa.removeLayer(capaPuntos); return; }
    for (const a of datos.puntos) {
      if (!a.ll || (f.tipo && a.t !== f.tipo)) continue;
      const m = L.circleMarker(a.ll, { radius: 3.5, weight: 1, className: "punto punto-" + (a.t || "otro"), pane: "markerPane" });
      m.bindPopup(() => `<a href="${esc(a.u)}" target="_blank" rel="noopener noreferrer">${esc(a.ti)}</a>
        <div class="pop-datos"><b>USD ${miles(a.p)}${a.e ? "~" : ""}</b> · ${a.m2 ? Math.round(a.m2) + " m²" : "? m²"} · ${a.um2 ? miles(a.um2) + " USD/m²" : ""}<br>${esc(a.z || "?")} · ${a.t || "?"}${a.min != null ? " · " + a.min + " min" : ""}</div>`,
        { className: "pop", closeButton: false, maxWidth: 260 });
      capaPuntos.addLayer(m);
    }
    capaPuntos.addTo(mapa);
  }

  // --- pintar según estado
  let est = estadisticas(""), umbrales = [], metricaActual = "avisos";
  function entradaDe(f) {           // estadística del feature: zona para barrios, partido para el GBA
    return f.properties.nivel === "barrio" ? est.zonas[f.properties.zona] : est.partidos[f.properties.partido];
  }
  function textoTooltip(f) {
    const e = entradaDe(f), nombre = nombreDe(f);
    const sub = f.properties.nivel === "barrio" ? "CABA" : "partido";
    if (!e) return `<b>${esc(nombre)}</b> <small>${sub}</small><br>sin avisos`;
    return `<b>${esc(nombre)}</b> <small>${sub}</small><br>${e.n} aviso${e.n === 1 ? "" : "s"} · ${e.um2 ? miles(e.um2) + " USD/m²" : "sin m²"}<br>desde USD ${miles(e.desde)}`;
  }
  function pintar(f) {
    est = estadisticas(f.tipo);
    metricaActual = f.metrica;
    const valores = geo.features.map(x => valorDe(entradaDe(x), f.metrica));
    umbrales = cortes(valores);
    capaZonas.eachLayer(capa => {
      const el = capa.getElement();
      if (!el) return;
      const nombre = nombreDe(capa.feature);
      const q = clase(valorDe(entradaDe(capa.feature), f.metrica), umbrales);
      el.className.baseVal = `zona q${q}` + (nombre === seleccion ? " elegida" : "");
      const e = entradaDe(capa.feature);
      el.setAttribute("aria-label", `${nombre}: ${e ? e.n + " avisos" + (e.um2 ? ", " + miles(e.um2) + " USD por metro cuadrado" : "") : "sin avisos"}`);
    });
    pintarLeyenda(f.metrica, f.puntos);
    pintarPanel(f);
    pintarPuntos(f);
    empujar(f);
  }
  function pintarLeyenda(metrica, conPuntos) {
    const titulo = metrica === "avisos" ? "Avisos por zona" : "USD/m² mediano";
    const fmt = v => metrica === "avisos" ? String(v) : miles(v);
    const filas = [];
    for (let q = 1; q <= CLASES; q++) {
      const desde = q === 1 ? null : umbrales[q - 2], hasta = q === CLASES ? null : umbrales[q - 1];
      let etiqueta;
      if (!umbrales.length) etiqueta = "";
      else if (desde == null) etiqueta = "≤ " + fmt(hasta);
      else if (hasta == null) etiqueta = "> " + fmt(desde);
      else if (metrica === "avisos") etiqueta = desde + 1 >= hasta ? fmt(hasta) : `${fmt(desde + 1)} – ${fmt(hasta)}`;
      else etiqueta = desde === hasta ? fmt(hasta) : `${fmt(desde)} – ${fmt(hasta)}`;
      filas.push(`<div class="ley-fila"><span class="ley-caja q${q}"></span>${etiqueta}</div>`);
    }
    filas.push(`<div class="ley-fila"><span class="ley-caja q0"></span>sin avisos</div>`);
    if (conPuntos) filas.push(`<div class="ley-fila ley-sep"><span class="ley-punto"></span>casa <span class="ley-punto ph"></span>PH</div>`);
    leyenda.innerHTML = `<h2>${titulo}</h2>${filas.join("")}`;
  }

  // --- panel lateral
  function filasAvisos(avisos, tipo) {
    const lista = avisos.slice().sort((a, b) => (a.p || 1e12) - (b.p || 1e12)).slice(0, MAX_FILAS);
    return `<ol class="mini">${lista.map(a => `<li>
        <span class="mini-precio">${miles(a.p)}${a.e ? "~" : ""}</span>
        <span class="mini-m2">${a.m2 ? Math.round(a.m2) + " m²" : ""}</span>
        <a href="${esc(a.u)}" target="_blank" rel="noopener noreferrer" title="${esc(a.ti)}">${esc(a.ti)}</a>
        <small>${esc(a.t || "?")}${a.z ? " · " + esc(a.z) : ""}</small></li>`).join("")}</ol>`;
  }
  const datosDl = e => `<dl class="cifras">
      <div><dt>Avisos</dt><dd>${e.n}</dd></div>
      <div><dt>USD/m² mediano</dt><dd>${miles(e.um2)}</dd></div>
      <div><dt>Precio mediano</dt><dd>${miles(e.precio)}</dd></div>
      <div><dt>Desde</dt><dd>${miles(e.desde)}</dd></div>
      <div><dt>A Palermo</dt><dd>${e.min == null ? "?" : e.min + " min"}</dd></div>
    </dl>`;
  function pintarPanel(f) {
    const feature = seleccion && geo.features.find(x => nombreDe(x) === seleccion);
    const esLocalidad = seleccion && !feature && est.zonas[seleccion];
    const zonaLista = f.zona;
    if (!seleccion || (!feature && !esLocalidad)) {
      const total = datos.puntos.filter(a => !f.tipo || a.t === f.tipo);
      const conZona = Object.keys(est.zonas).length;
      const um2 = mediana(total.map(a => a.um2).filter(Boolean));
      resumen.innerHTML = `<h2>AMBA</h2>
        <dl class="cifras">
          <div><dt>Avisos</dt><dd>${total.length}</dd></div>
          <div><dt>Zonas con avisos</dt><dd>${conZona}</dd></div>
          <div><dt>USD/m² mediano</dt><dd>${miles(um2)}</dd></div>
        </dl>
        <p class="ayuda-panel">Tocá un barrio o partido para ver sus avisos. El color muestra ${f.metrica === "avisos" ? "cuántos avisos aprobados hay" : "el USD/m² mediano"} en cada zona; a más color, más.</p>
        <p class="ayuda-panel"><a href="index.html${f.tipo ? "?tipo=" + f.tipo : ""}">Ver la lista completa</a></p>`;
      return;
    }
    const nivel = feature ? feature.properties.nivel : "zona";
    const e = nivel === "partido" ? est.partidos[seleccion] : est.zonas[seleccion];
    const sub = nivel === "barrio" ? "barrio · CABA" : nivel === "partido" ? "partido" : "localidad · " + esc(datos.partidos[seleccion] || "");
    let cuerpo;
    if (!e) {
      cuerpo = `<p class="ayuda-panel">Ningún aviso aprobado${f.tipo ? " de tipo " + f.tipo : ""} en esta zona.</p>`;
    } else if (nivel === "partido") {
      const locs = Object.entries(est.zonas).filter(([z]) => datos.partidos[z] === seleccion).sort((a, b) => b[1].n - a[1].n);
      cuerpo = datosDl(e) + `<h3>Localidades</h3>
        <table class="locs"><thead><tr><th>Localidad</th><th>Avisos</th><th>USD/m²</th><th>Desde</th></tr></thead><tbody>
        ${locs.map(([z, s]) => `<tr><td><a href="${enlaceLista(z, f.tipo)}">${esc(z)}</a></td><td>${s.n}</td><td>${miles(s.um2)}</td><td>${miles(s.desde)}</td></tr>`).join("")}
        </tbody></table>`;
    } else {
      cuerpo = datosDl(e) + `<h3>Más baratos</h3>` + filasAvisos(e.avisos, f.tipo) +
        (e.n > MAX_FILAS ? `<p class="ayuda-panel">${e.n - MAX_FILAS} más en la lista.</p>` : "");
    }
    const enlace = `<p class="ir"><a href="${enlaceLista(seleccion, f.tipo, nivel === "partido")}">Ver ${e ? e.n : 0} aviso${e && e.n === 1 ? "" : "s"} en la lista</a></p>`;
    resumen.innerHTML = `<div class="panel-cabeza"><h2>${esc(seleccion)} <small>${sub}</small></h2>
        <button type="button" class="cerrar" aria-label="Quitar selección" title="Quitar selección (Esc)">×</button></div>
      ${cuerpo}${enlace}`;
  }
  function seleccionar(nombre) {
    seleccion = nombre;
    const f = leer();
    capaZonas.eachLayer(capa => capa.getElement()?.classList.toggle("elegida", nombreDe(capa.feature) === nombre));
    pintarPanel(f);
    empujar(f);
    const feature = nombre && geo.features.find(x => nombreDe(x) === nombre);
    if (feature && !mapa.getBounds().contains(L.geoJSON(feature).getBounds())) mapa.fitBounds(L.geoJSON(feature).getBounds(), { padding: [40, 40], maxZoom: 13 });
    panel.scrollTop = 0;
  }
  panel.addEventListener("click", e => { if (e.target.closest(".cerrar")) seleccionar(null); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && seleccion && !e.target.closest("input, select")) seleccionar(null);
    if (e.key === "l" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.target.closest("input, select, a")) location.href = seleccion ? enlaceLista(seleccion, leer().tipo, esPartido(seleccion)) : "index.html";
  });

  // --- arranque
  const q = new URLSearchParams(location.search);
  escribir({ metrica: q.get("metrica") === "usd_m2" ? "usd_m2" : "avisos", tipo: ["casa", "ph"].includes(q.get("tipo")) ? q.get("tipo") : "", puntos: q.get("puntos") === "1" });
  seleccion = q.get("zona") || null;
  form.addEventListener("change", () => pintar(leer()));
  form.addEventListener("submit", e => e.preventDefault());
  mapa.whenReady(() => { pintar(leer()); if (seleccion) seleccionar(seleccion); });
})();
