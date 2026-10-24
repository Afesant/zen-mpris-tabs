# MPRIS per tab

Firefox-based browsers (Firefox, Zen, LibreWolf) expose a single MPRIS player
for the whole browser, so your desktop's media controls only ever see one tab.
This extension makes **every tab that plays audio or video show up as its own
MPRIS player**: KDE Plasma's media controller, GNOME, PlasMusic Toolbar,
`playerctl`, etc. can then show and control each one separately.

- Play/pause, stop, seek, and next/previous when the site supports it
  (YouTube playlists, Spotify, SoundCloud... anything using the Media Session API).
- Title, artist and artwork from the page's Media Session metadata, falling back
  to the tab title and favicon.
- "Raise" focuses the tab.
- Muted autoplay videos (social feeds, ads) are ignored: a tab only becomes a
  player once something in it has actually played with sound.

Each player is named after the site (`youtube.com`, `youtube.com (2)`...) and
registered as `org.mpris.MediaPlayer2.<browser>.tab<id>`.

## How it works

```
page.js (page world)  ──►  relay.js (content script)  ──►  background.js  ──►  host.py  ──►  D-Bus
 <audio>/<video>,                                          one entry          one bus connection
 navigator.mediaSession                                    per tab            per tab
```

The browser can't talk to D-Bus by itself, so a small Python
[native messaging](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/Native_messaging)
host does it. Nothing leaves your machine.

## Install

1. Install the native host (needs Python 3 and `dbus-fast`):

   ```sh
   git clone https://github.com/Afesant/zen-mpris-tabs
   cd zen-mpris-tabs
   ./install.sh
   ```

   It copies `host.py` to `~/.local/share/zen-mpris-tabs/` and registers it for
   Firefox, Zen and LibreWolf. `./install.sh --remove` undoes it.

2. Install the extension, either from addons.mozilla.org or the `.xpi` in the
   [releases](https://github.com/Afesant/zen-mpris-tabs/releases).

3. Disable the browser's own MPRIS player so it doesn't show up as a duplicate:
   set `media.hardwaremediakeys.enabled` to `false` in `about:config`.

4. Reload tabs that were already open.

## Development

```sh
./build.sh                         # -> dist/zen-mpris-tabs-<version>.xpi
npx web-ext lint -s extension
npx web-ext run -s extension       # temporary install in a clean profile
```

The host logs new tabs and errors to `~/.cache/zen-mpris-tabs.log`.

## License

MIT
