#!/usr/bin/env python3
"""Host nativo de la extensión "MPRIS por pestaña" para Zen.

Zen (como Firefox) expone un solo reproductor MPRIS para todo el navegador.
La extensión manda aquí el estado de cada pestaña con audio/vídeo y este
programa registra un reproductor org.mpris.MediaPlayer2.<navegador>.tab<ID> por
cada una, con su propia conexión al bus (cada nombre necesita su propio
/org/mpris/MediaPlayer2).

Protocolo: native messaging de Firefox (uint32 nativo + JSON) por stdin/stdout.
"""
import asyncio
import json
import os
import re
import struct
import sys
import time

from dbus_fast import BusType, PropertyAccess, Variant
from dbus_fast.aio import MessageBus
from dbus_fast.service import ServiceInterface, dbus_property, method, signal

RUTA = "/org/mpris/MediaPlayer2"
LOG = os.path.expanduser("~/.cache/zen-mpris-tabs.log")


def navegador():
    """Nombre del navegador que nos lanzó (zen, firefox, librewolf...), para el
    nombre en el bus y el DesktopEntry."""
    try:
        with open(f"/proc/{os.getppid()}/comm") as f:
            nombre = f.read().strip()
    except OSError:
        return "firefox"
    nombre = re.sub(r"-bin$", "", nombre.lower())
    return re.sub(r"[^a-z0-9_]", "_", nombre) or "firefox"


NAVEGADOR = navegador()


def log(*a):
    try:
        with open(LOG, "a") as f:
            print(time.strftime("%F %T"), *a, file=f)
    except OSError:
        pass


salida = sys.stdout.buffer


def enviar(msg):
    datos = json.dumps(msg).encode()
    salida.write(struct.pack("@I", len(datos)) + datos)
    salida.flush()


class Raiz(ServiceInterface):
    def __init__(self, jugador):
        super().__init__("org.mpris.MediaPlayer2")
        self.j = jugador

    @method()
    def Raise(self):
        enviar({"id": self.j.id, "cmd": "raise"})

    @method()
    def Quit(self):
        pass

    @dbus_property(access=PropertyAccess.READ)
    def CanQuit(self) -> "b":
        return False

    @dbus_property(access=PropertyAccess.READ)
    def CanRaise(self) -> "b":
        return True

    @dbus_property(access=PropertyAccess.READ)
    def HasTrackList(self) -> "b":
        return False

    @dbus_property(access=PropertyAccess.READ)
    def Identity(self) -> "s":
        return self.j.identidad

    @dbus_property(access=PropertyAccess.READ)
    def DesktopEntry(self) -> "s":
        return NAVEGADOR

    @dbus_property(access=PropertyAccess.READ)
    def SupportedUriSchemes(self) -> "as":
        return []

    @dbus_property(access=PropertyAccess.READ)
    def SupportedMimeTypes(self) -> "as":
        return []


class Reproductor(ServiceInterface):
    def __init__(self, jugador):
        super().__init__("org.mpris.MediaPlayer2.Player")
        self.j = jugador

    def _orden(self, cmd, **extra):
        enviar({"id": self.j.id, "cmd": cmd, **extra})

    @method()
    def Next(self):
        self._orden("next")

    @method()
    def Previous(self):
        self._orden("prev")

    @method()
    def Pause(self):
        self._orden("pause")

    @method()
    def PlayPause(self):
        self._orden("playpause")

    @method()
    def Stop(self):
        self._orden("stop")

    @method()
    def Play(self):
        self._orden("play")

    @method()
    def Seek(self, offset: "x"):
        self._orden("seek", to=max(0.0, self.j.posicion() + offset / 1e6))

    @method()
    def SetPosition(self, track: "o", pos: "x"):
        if track == self.j.trackid() and pos >= 0:
            self._orden("seek", to=pos / 1e6)

    @method()
    def OpenUri(self, uri: "s"):
        pass

    @signal()
    def Seeked(self, pos) -> "x":
        return pos

    @dbus_property(access=PropertyAccess.READ)
    def PlaybackStatus(self) -> "s":
        return "Playing" if self.j.estado.get("playing") else "Paused"

    @dbus_property(access=PropertyAccess.READ)
    def Metadata(self) -> "a{sv}":
        return self.j.metadatos()

    @dbus_property(access=PropertyAccess.READ)
    def Position(self) -> "x":
        return int(self.j.posicion() * 1e6)

    @dbus_property()
    def Volume(self) -> "d":
        return 1.0

    @Volume.setter
    def Volume(self, v: "d"):
        pass

    @dbus_property(access=PropertyAccess.READ)
    def Rate(self) -> "d":
        return float(self.j.estado.get("rate") or 1.0)

    @dbus_property(access=PropertyAccess.READ)
    def MinimumRate(self) -> "d":
        return 0.25

    @dbus_property(access=PropertyAccess.READ)
    def MaximumRate(self) -> "d":
        return 4.0

    @dbus_property(access=PropertyAccess.READ)
    def CanGoNext(self) -> "b":
        return bool(self.j.estado.get("canNext"))

    @dbus_property(access=PropertyAccess.READ)
    def CanGoPrevious(self) -> "b":
        return bool(self.j.estado.get("canPrev"))

    @dbus_property(access=PropertyAccess.READ)
    def CanPlay(self) -> "b":
        return True

    @dbus_property(access=PropertyAccess.READ)
    def CanPause(self) -> "b":
        return True

    @dbus_property(access=PropertyAccess.READ)
    def CanSeek(self) -> "b":
        return bool(self.j.estado.get("canSeek"))

    @dbus_property(access=PropertyAccess.READ)
    def CanControl(self) -> "b":
        return True


class Jugador:
    def __init__(self, tab_id, identidad):
        self.id = tab_id
        self.identidad = identidad
        self.estado = {}
        self.t = time.monotonic()
        self.pista = 0
        self.bus = None
        self.raiz = Raiz(self)
        self.rep = Reproductor(self)

    async def conectar(self):
        self.bus = await MessageBus(bus_type=BusType.SESSION).connect()
        self.bus.export(RUTA, self.raiz)
        self.bus.export(RUTA, self.rep)
        await self.bus.request_name(f"org.mpris.MediaPlayer2.{NAVEGADOR}.tab{self.id}")

    def cerrar(self):
        if self.bus:
            self.bus.disconnect()
            self.bus = None

    def trackid(self):
        return f"/org/mpris/MediaPlayer2/{NAVEGADOR}/tab{self.id}/t{self.pista}"

    def posicion(self):
        e = self.estado
        pos = float(e.get("position") or 0)
        if e.get("playing"):
            pos += (time.monotonic() - self.t) * float(e.get("rate") or 1)
        dur = float(e.get("duration") or 0)
        return min(pos, dur) if dur > 0 else pos

    def metadatos(self):
        e = self.estado
        md = {
            "mpris:trackid": Variant("o", self.trackid()),
            "xesam:title": Variant("s", e.get("title") or self.identidad),
            "xesam:url": Variant("s", e.get("url") or ""),
        }
        artista = e.get("artist") or e.get("site") or ""
        if artista:
            md["xesam:artist"] = Variant("as", [artista])
        if e.get("album"):
            md["xesam:album"] = Variant("s", e["album"])
        if e.get("art"):
            md["mpris:artUrl"] = Variant("s", e["art"])
        dur = float(e.get("duration") or 0)
        if dur > 0:
            md["mpris:length"] = Variant("x", int(dur * 1e6))
        return md

    def actualizar(self, nuevo):
        viejo = self.estado
        if (viejo.get("title"), viejo.get("url")) != (nuevo.get("title"), nuevo.get("url")):
            self.pista += 1
        self.estado = nuevo
        self.t = time.monotonic()
        if not self.bus:
            return
        cambios = {}
        claves = {
            "PlaybackStatus": ("playing",),
            "Metadata": ("title", "artist", "album", "art", "duration", "url", "site"),
            "CanGoNext": ("canNext",),
            "CanGoPrevious": ("canPrev",),
            "CanSeek": ("canSeek",),
            "Rate": ("rate",),
        }
        for prop, ks in claves.items():
            if any(viejo.get(k) != nuevo.get(k) for k in ks):
                cambios[prop] = getattr(self.rep, prop)
        if cambios:
            self.rep.emit_properties_changed(cambios)
        if nuevo.get("seeked"):
            self.rep.Seeked(int(self.posicion() * 1e6))


jugadores = {}


def identidad_libre(sitio):
    base = sitio or NAVEGADOR.capitalize()
    usadas = {j.identidad for j in jugadores.values()}
    nombre, n = base, 2
    while nombre in usadas:
        nombre, n = f"{base} ({n})", n + 1
    return nombre


async def manejar(msg):
    tab = msg.get("id")
    if not isinstance(tab, int):
        return
    if msg.get("type") == "remove":
        j = jugadores.pop(tab, None)
        if j:
            j.cerrar()
        return
    if msg.get("type") != "update":
        return
    j = jugadores.get(tab)
    if not j:
        j = Jugador(tab, identidad_libre(msg.get("site")))
        log("nueva pestaña", tab, msg.get("site"), "mundo:", msg.get("world"))
        j.actualizar(msg)
        jugadores[tab] = j
        try:
            await j.conectar()
        except Exception as e:  # noqa: BLE001
            log("no se pudo registrar", tab, e)
            jugadores.pop(tab, None)
            j.cerrar()
        return
    j.actualizar(msg)


async def principal():
    bucle = asyncio.get_running_loop()
    lector = asyncio.StreamReader()
    await bucle.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(lector), sys.stdin.buffer)
    while True:
        try:
            cab = await lector.readexactly(4)
            datos = await lector.readexactly(struct.unpack("@I", cab)[0])
        except asyncio.IncompleteReadError:
            break  # Zen se cerró
        try:
            await manejar(json.loads(datos))
        except Exception as e:  # noqa: BLE001
            log("error", repr(e))
    for j in jugadores.values():
        j.cerrar()


if __name__ == "__main__":
    asyncio.run(principal())
