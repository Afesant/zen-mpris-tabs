// Junta el estado de los marcos de cada pestaña y se lo pasa al host nativo,
// que registra un reproductor MPRIS por pestaña.
const HOST = "zen_mpris_tabs";

// tabId -> { info: {title, url, favIconUrl, windowId}, frames: Map(frameId -> {port, estado, t}) }
const pestanas = new Map();
let nativo = null;
let espera = 2000;

function conectarNativo() {
  nativo = browser.runtime.connectNative(HOST);
  nativo.onMessage.addListener(onOrden);
  nativo.onDisconnect.addListener((p) => {
    console.warn("zen-mpris-tabs: host desconectado", p.error && p.error.message);
    nativo = null;
    setTimeout(conectarNativo, espera);
    espera = Math.min(espera * 2, 60000);
  });
  for (const id of pestanas.keys()) publicar(id);
}

function enviar(msg) {
  if (!nativo) return;
  try { nativo.postMessage(msg); espera = 2000; } catch (e) { console.warn(e); }
}

function marcoActivo(p) {
  let mejor = null;
  for (const [frameId, f] of p.frames) {
    if (!f.estado || !f.estado.media) continue;
    if (!mejor
        || (f.estado.playing && !mejor.f.estado.playing)
        || (f.estado.playing === mejor.f.estado.playing && f.t > mejor.f.t)) {
      mejor = { frameId, f };
    }
  }
  return mejor;
}

function sitio(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return ""; }
}

function publicar(tabId) {
  const p = pestanas.get(tabId);
  const m = p && marcoActivo(p);
  if (!m) {
    enviar({ type: "remove", id: tabId });
    return;
  }
  const e = m.f.estado;
  const info = p.info;
  enviar({
    type: "update",
    id: tabId,
    site: sitio(info.url),
    url: info.url || "",
    title: e.title || info.title || "",
    artist: e.artist || "",
    album: e.album || "",
    art: e.art || info.favIconUrl || "",
    playing: e.playing,
    position: e.position,
    duration: e.duration,
    rate: e.rate,
    canNext: e.canNext,
    canPrev: e.canPrev,
    canSeek: e.canSeek,
    seeked: !!e.seeked,
    world: e.world,
  });
  e.seeked = false;
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== "medios" || !port.sender.tab) return;
  const tab = port.sender.tab;
  const tabId = tab.id;
  const frameId = port.sender.frameId || 0;
  let p = pestanas.get(tabId);
  if (!p) {
    p = { info: {}, frames: new Map() };
    pestanas.set(tabId, p);
  }
  p.info = { title: tab.title, url: tab.url, favIconUrl: tab.favIconUrl, windowId: tab.windowId };
  const f = { port, estado: null, t: 0 };
  p.frames.set(frameId, f);

  port.onMessage.addListener((estado) => {
    f.estado = estado;
    f.t = Date.now();
    publicar(tabId);
  });
  port.onDisconnect.addListener(() => {
    // Navegó, recargó o cerró el marco.
    if (p.frames.get(frameId) === f) p.frames.delete(frameId);
    if (!p.frames.size) pestanas.delete(tabId);
    publicar(tabId);
  });
});

browser.tabs.onUpdated.addListener((tabId, cambio, tab) => {
  const p = pestanas.get(tabId);
  if (!p || !("title" in cambio || "favIconUrl" in cambio || "url" in cambio)) return;
  p.info = { title: tab.title, url: tab.url, favIconUrl: tab.favIconUrl, windowId: tab.windowId };
  publicar(tabId);
});

browser.tabs.onRemoved.addListener((tabId) => {
  pestanas.delete(tabId);
  enviar({ type: "remove", id: tabId });
});

function onOrden(msg) {
  const p = pestanas.get(msg.id);
  if (!p) {
    enviar({ type: "remove", id: msg.id });
    return;
  }
  if (msg.cmd === "raise") {
    browser.tabs.update(msg.id, { active: true });
    if (p.info.windowId !== undefined) browser.windows.update(p.info.windowId, { focused: true });
    return;
  }
  if (msg.cmd === "close") {
    browser.tabs.remove(msg.id);
    return;
  }
  const m = marcoActivo(p);
  if (m) m.f.port.postMessage({ cmd: msg.cmd, to: msg.to });
}

conectarNativo();
