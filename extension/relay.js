// Mundo aislado: puente entre page.js y el background de la extensión.
(() => {
  let port = null;

  function conectar() {
    port = browser.runtime.connect({ name: "medios" });
    port.onMessage.addListener((c) => {
      window.dispatchEvent(new CustomEvent("zen-mpris-cmd", { detail: JSON.stringify(c) }));
    });
    port.onDisconnect.addListener(() => { port = null; });
  }

  window.addEventListener("zen-mpris-state", (e) => {
    let estado;
    try { estado = JSON.parse(e.detail); } catch (_) { return; }
    // Marcos sin medios nunca abren puerto: miles de iframes de anuncios no cuentan.
    if (!estado.media && !port) return;
    if (!port) conectar();
    port.postMessage(estado);
  });
})();
