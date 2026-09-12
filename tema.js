// Tema Catppuccin: sigue al sistema (Latte claro / Mocha oscuro) salvo que se elija uno con el botón .tema.
// Va sin defer en <head> para aplicar el tema guardado antes del primer pintado.
(function () {
  const raiz = document.documentElement;
  const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } },
               set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
               del: k => { try { localStorage.removeItem(k); } catch {} } };
  const oscuro = () => matchMedia("(prefers-color-scheme: dark)").matches;
  const efectivo = () => raiz.dataset.tema || (oscuro() ? "mocha" : "latte");

  function aplicar(tema) {
    if (tema === "latte" || tema === "mocha") { raiz.dataset.tema = tema; ls.set("mudanza.tema", tema); }
    else { delete raiz.dataset.tema; ls.del("mudanza.tema"); }
    document.querySelectorAll(".tema").forEach(b => {
      const t = efectivo();
      const otro = t === "mocha" ? "Latte" : "Mocha";
      b.textContent = t === "mocha" ? "☀" : "☾";
      b.title = "Cambiar a " + otro + " (actual: " + t + (raiz.dataset.tema ? ")" : ", según el sistema)");
      b.setAttribute("aria-label", "Cambiar a tema " + otro);
    });
  }
  aplicar(ls.get("mudanza.tema"));
  document.addEventListener("DOMContentLoaded", () => aplicar(raiz.dataset.tema));
  document.addEventListener("click", e => {
    const b = e.target.closest(".tema");
    if (b) aplicar(efectivo() === "mocha" ? "latte" : "mocha");
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => aplicar(raiz.dataset.tema));
})();
