// Corre en el mundo de la página: ve los <audio>/<video> y los manejadores de
// navigator.mediaSession que la web registra (siguiente/anterior de YouTube, etc.).
(() => {
  if (window.__zenMprisTabs) return;
  window.__zenMprisTabs = true;

  const ESTADO = "zen-mpris-state";
  const ORDEN = "zen-mpris-cmd";

  // Firefox puede ignorar "world": "MAIN" y cargarnos en el mundo aislado; entonces
  // los prototipos de la página solo se alcanzan por wrappedJSObject + exportFunction.
  const pagina = window.wrappedJSObject;
  const MUNDO = pagina ? "isolated" : "main";
  function enganchar(proto, nombre, envoltura) {
    const orig = proto[nombre];
    const f = function () { return envoltura.call(this, orig, arguments); };
    if (pagina) exportFunction(f, proto, { defineAs: nombre });
    else proto[nombre] = f;
  }
  const paraPagina = (obj) => (pagina ? cloneInto(obj, window) : obj);
  const global = pagina || window;

  const handlers = {};
  if ("mediaSession" in navigator) {
    enganchar(global.MediaSession.prototype, "setActionHandler", function (orig, args) {
      handlers[args[0]] = args[1] || null;
      programar();
      return orig.apply(this, args);
    });
  }

  const medios = new Set();
  // Solo cuenta como reproductor lo que ha sonado alguna vez: los vídeos de autoplay
  // mudos (feeds, anuncios) nunca entran, y silenciar algo a mitad no lo saca de la lista.
  const oidos = new WeakSet();
  let actual = null;

  function registrar(el) {
    if (!(el instanceof HTMLMediaElement)) return;
    if (!medios.has(el)) {
      medios.add(el);
      // Los eventos de medios no salen de un shadow root: escuchar en el propio elemento.
      for (const ev of EVENTOS) el.addEventListener(ev, onEvento, true);
    }
  }

  const EVENTOS = ["play", "playing", "pause", "ended", "emptied", "durationchange",
                   "loadedmetadata", "seeked", "ratechange", "timeupdate", "volumechange"];

  enganchar(global.HTMLMediaElement.prototype, "play", function (orig, args) {
    registrar(this);
    return orig.apply(this, args);
  });
  for (const ev of EVENTOS) document.addEventListener(ev, (e) => registrar(e.target), true);

  let ultimoTime = 0;
  function onEvento(e) {
    const el = e.target;
    if (!el.paused && !el.muted && el.volume > 0) oidos.add(el);
    if (!oidos.has(el)) return;
    if (e.type === "play" || e.type === "playing") actual = el;
    if (e.type === "timeupdate") {
      // La posición la interpola el host; solo resincronizar de vez en cuando.
      const ahora = Date.now();
      if (ahora - ultimoTime < 5000) return;
      ultimoTime = ahora;
    }
    programar(e.type === "seeked" && el === elegir());
  }

  function audible(el) {
    return oidos.has(el) && el.isConnected && !el.paused && !el.ended && el.readyState > 0;
  }

  function elegir() {
    for (const el of medios) if (!el.isConnected) medios.delete(el);
    if (actual && audible(actual)) return actual;
    for (const el of medios) if (audible(el)) return (actual = el);
    if (actual && oidos.has(actual) && actual.isConnected && actual.currentSrc) return actual;
    return null;
  }

  function metadatos() {
    const md = navigator.mediaSession && navigator.mediaSession.metadata;
    if (!md) return {};
    let art = "";
    let mejor = -1;
    for (const a of md.artwork || []) {
      const lado = parseInt(String(a.sizes || "0").split(/[x ]/)[0], 10) || 0;
      if (lado > mejor) { mejor = lado; art = a.src; }
    }
    return { title: md.title || "", artist: md.artist || "", album: md.album || "", art };
  }

  let pendiente = null;
  let seekPendiente = false;
  function programar(seek) {
    if (seek) seekPendiente = true;
    if (pendiente) return;
    pendiente = setTimeout(enviar, 150);
  }

  function enviar() {
    pendiente = null;
    const el = elegir();
    const md = metadatos();
    const dur = el && isFinite(el.duration) ? el.duration : 0;
    const estado = el ? {
      media: true,
      playing: !el.paused && !el.ended,
      position: el.currentTime || 0,
      duration: dur,
      rate: el.playbackRate || 1,
      title: md.title || "",
      artist: md.artist || "",
      album: md.album || "",
      art: md.art || "",
      canNext: !!handlers.nexttrack,
      canPrev: !!handlers.previoustrack,
      canSeek: dur > 0 || !!handlers.seekto,
      seeked: seekPendiente,
      world: MUNDO,
    } : { media: false };
    seekPendiente = false;
    window.dispatchEvent(new CustomEvent(ESTADO, { detail: JSON.stringify(estado) }));
  }

  function llamar(accion, detalles) {
    const h = handlers[accion];
    if (!h) return false;
    try { h(paraPagina(Object.assign({ action: accion }, detalles || {}))); } catch (_) {}
    return true;
  }

  window.addEventListener(ORDEN, (e) => {
    let c;
    try { c = JSON.parse(e.detail); } catch (_) { return; }
    const el = elegir() || actual;
    switch (c.cmd) {
      case "play":
        if (!llamar("play") && el) el.play().catch(() => {});
        break;
      case "pause":
        if (!llamar("pause") && el) el.pause();
        break;
      case "playpause":
        if (el && !el.paused) { if (!llamar("pause")) el.pause(); }
        else if (!llamar("play") && el) el.play().catch(() => {});
        break;
      case "stop":
        if (!llamar("stop") && el) el.pause();
        break;
      case "next":
        llamar("nexttrack");
        break;
      case "prev":
        llamar("previoustrack");
        break;
      case "seek":     // c.to en segundos, absoluto
        if (!el) break;
        if (!llamar("seekto", { seekTime: c.to, fastSeek: false })) {
          el.currentTime = Math.max(0, Math.min(c.to, el.duration || c.to));
        }
        programar(true);
        break;
      case "refresh":
        programar();
        break;
    }
  });

  // Si la página cambia los metadatos sin evento de medio (lista de reproducción).
  let mdPrevio = "";
  setInterval(() => {
    if (!medios.size) return;
    const md = JSON.stringify(metadatos());
    if (md !== mdPrevio) { mdPrevio = md; programar(); }
  }, 2000);
})();
