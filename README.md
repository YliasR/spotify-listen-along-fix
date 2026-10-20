# spotify-listen-along-fix

Makes Discord's **Spotify Listen Along** work again with the Spotify **desktop app**. Works on Windows, macOS and Linux.

## The problem

When you click *Listen Along*, Discord asks Spotify's Web API to play your friend's track on your desktop client. The API reports success, but the desktop app never starts playing. The web player still works, which is why "use Spotify in the browser" is the usual workaround.

## How this fixes it

Instead of relying on the remote command, the track is played through Spotify's local player:

```
Discord (Listen Along state) ──► Vencord plugin ──► http://127.0.0.1:32145/state ──► Spicetify extension ──► local player
```

- **`vencord/listenAlongFix`**: a Vencord userplugin. It reads Discord's own Listen Along state (`SpotifyStore.getSyncingWith()`) plus the host's presence, and serves it on a localhost-only HTTP endpoint. Only `https://xpui.app.spotify.com` (the Spotify client) gets CORS access.
- **`spicetify/listenAlongFix.js`**: a Spicetify extension. It polls that endpoint every second, plays the host's track, keeps you within ~2.5 s of the host, and pauses when the host does.

If you change the track or pause manually, the extension stops following until the next Listen Along session. Nothing leaves your machine.

If the host stops playing for a moment, Discord ends Listen Along on its own. The plugin keeps following the host for a grace period (default 20 s) and picks them back up when they play again. To change how long the session stays alive, open **Discord Settings → Vencord → Plugins → ListenAlongFix → Settings** and adjust the **graceSeconds** slider. Discord's UI won't show you as listening along during that time, so to stop following, pause or skip in Spotify.

## Requirements

- Discord desktop with [Vencord](https://vencord.dev) installed (official installer)
- Spotify desktop with [Spicetify](https://spicetify.app)
- Spotify Premium (Discord requires it for Listen Along)
- [git](https://git-scm.com) and [Node.js](https://nodejs.org) 22+

Only the person clicking *Listen Along* needs this. The friend you listen along with doesn't.

## Install

```sh
git clone https://github.com/YliasR/spotify-listen-along-fix
cd spotify-listen-along-fix
node install.mjs
```

Don't use `sudo`. The script:

1. Clones Vencord into `.vencord-src` and builds it with the plugin (Vencord userplugins must be built from source)
2. Closes Discord, backs up Vencord's `dist` folder to `dist.backup-<timestamp>`, and installs the new build
3. Enables `ListenAlongFix` in Vencord's `settings.json` (backup saved as `settings.json.bak`)
4. Installs and enables the Spicetify extension, then runs `spicetify backup apply`

Use `--skip-vencord` or `--skip-spicetify` to redo only one half.

### Platform notes

| | Vencord folder | Notes |
|---|---|---|
| Windows | `%APPDATA%\Vencord` | |
| macOS | `~/Library/Application Support/Vencord` | |
| Linux | `~/.config/Vencord` | Flatpak Discord (`~/.var/app/com.discordapp.Discord/config/Vencord`) is detected too. Spotify from Snap isn't supported by Spicetify; use Flatpak, AUR or the .deb. Discord isn't restarted automatically if `discord` isn't on your PATH. |

If your Vencord lives somewhere else, point the script at it:

```sh
VENCORD_USER_DATA_DIR=/path/to/Vencord node install.mjs
```

Vesktop isn't supported, since it ships its own Vencord build.

### Re-run after updates

- **Vencord update**: the in-app updater installs the official build, which doesn't include the plugin. Re-run `node install.mjs`.
- **Spotify update**: if Spicetify got wiped, run `node install.mjs --skip-vencord`.
- Discord updates are fine, since Vencord re-patches itself.

## What can break it

Every failure mode is graceful: Listen Along just stops working, nothing else is affected.

| Cause | Likelihood | Symptom / fix |
|---|---|---|
| Spotify update breaks Spicetify | Most common | Wait for a Spicetify update, then `node install.mjs --skip-vencord` |
| Discord renames `SpotifyStore.getSyncingWith()` or changes Spotify activity data | Low (stable for years, Discord's own Listen Along uses it) | `/state` never shows `active: true`; plugin needs updating |
| Vencord changes its plugin API | Low | The install fails at build time, before touching your installed Vencord |
| Spotify fixes the original bug | - | Harmless (both paths play the same track); uninstall if you like |

To see which side broke, open `http://127.0.0.1:32145/state` during Listen Along:

- If it doesn't load, or `active` stays `false`, the Discord/Vencord side broke.
- If `active` is `true` but nothing plays, the Spotify/Spicetify side broke.

## Uninstall

1. Click **Update** in Vencord's Updater tab, or reinstall Vencord with the official installer. You can also restore a `dist.backup-*` folder over `dist`.
2. Run `spicetify config extensions listenAlongFix.js-` then `spicetify apply`.

## Troubleshooting

- **Spotify DevTools** (`spicetify enable-devtools`, then Ctrl/Cmd+Shift+I): look for `[ListenAlongFix]` logs.
- **Discord console** (Ctrl/Cmd+Shift+I): errors are prefixed with `[ListenAlongFix]`.
- **Port 32145 in use**: change `PORT` in `vencord/listenAlongFix/native.ts` and `BRIDGE_URL` in `spicetify/listenAlongFix.js`, then re-run the installer.

## License

GPL-3.0-or-later, same as Vencord.
