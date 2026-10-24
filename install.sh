#!/bin/sh
# Installs the native host for the current user (no root needed).
#   ./install.sh            install or update
#   ./install.sh --remove   uninstall
set -eu

NOMBRE=zen_mpris_tabs
DESTINO="${XDG_DATA_HOME:-$HOME/.local/share}/zen-mpris-tabs"
IDS='"zen-mpris-tabs@afesant.github.io"'
# Firefox reads ~/.mozilla; Zen and LibreWolf each have their own folder.
CARPETAS="$HOME/.mozilla/native-messaging-hosts $HOME/.zen/native-messaging-hosts $HOME/.librewolf/native-messaging-hosts"

if [ "${1:-}" = "--remove" ]; then
    for c in $CARPETAS; do rm -f "$c/$NOMBRE.json"; done
    rm -f "$DESTINO/host.py"
    rmdir "$DESTINO" 2>/dev/null || true
    echo "Native host removed."
    exit 0
fi

if ! python3 -c 'import dbus_fast' 2>/dev/null; then
    echo "Missing Python module dbus_fast:" >&2
    echo "  Arch:          sudo pacman -S python-dbus-fast" >&2
    echo "  Debian/Ubuntu: sudo apt install python3-dbus-fast" >&2
    echo "  Fedora:        sudo dnf install python3-dbus-fast" >&2
    echo "  Other:         pip install --user dbus-fast" >&2
    exit 1
fi

mkdir -p "$DESTINO"
install -m 755 "$(dirname "$0")/host.py" "$DESTINO/host.py"

for c in $CARPETAS; do
    mkdir -p "$c"
    cat > "$c/$NOMBRE.json" <<FIN
{
  "name": "$NOMBRE",
  "description": "One MPRIS player per browser tab",
  "path": "$DESTINO/host.py",
  "type": "stdio",
  "allowed_extensions": [$IDS]
}
FIN
done
echo "Native host installed in $DESTINO."
echo "Now install the extension and reload any tabs that were already open."
