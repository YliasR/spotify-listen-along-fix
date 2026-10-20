# spotify-listen-along-fix

Makes Discord's **Spotify Listen Along** work again with the Spotify **desktop app**.

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

## Requirements

- Windows, Discord desktop with [Vencord](https://vencord.dev) installed
- Spotify desktop with [Spicetify](https://spicetify.app)
- Spotify Premium (Discord requires it for Listen Along)
- git and Node.js 20+

## Install

```powershell
git clone https://github.com/YliasR/spotify-listen-along-fix
cd spotify-listen-along-fix
pwsh ./install.ps1
```

The script:

1. Clones Vencord into `.vencord-src` and builds it with the plugin (Vencord userplugins must be built from source)
2. Closes Discord, backs up `%APPDATA%\Vencord\dist` to `dist.backup-<timestamp>`, and installs the new build
3. Enables `ListenAlongFix` in Vencord's `settings.json` (backup saved as `settings.json.bak`)
4. Installs and enables the Spicetify extension, then runs `spicetify backup apply`

Use `-SkipVencord` or `-SkipSpicetify` to redo only one half.

### Re-run after updates

- **Vencord update**: the official updater replaces the build and drops the plugin. Re-run `install.ps1`.
- **Spotify update**: if Spicetify got wiped, run `pwsh ./install.ps1 -SkipVencord`.
- Discord updates are fine, since Vencord re-patches itself.

## Uninstall

1. Restore a `dist.backup-*` folder over `%APPDATA%\Vencord\dist`, or reinstall Vencord with the official installer.
2. Run `spicetify config extensions listenAlongFix.js-` then `spicetify apply`.

## Troubleshooting

- **Spotify DevTools** (`spicetify enable-devtools`, then Ctrl+Shift+I): look for `[ListenAlongFix]` logs.
- **Endpoint check**: open `http://127.0.0.1:32145/state` in a browser while Discord is running. `active` should become `true` after clicking Listen Along.
- **Discord console** (Ctrl+Shift+I): errors are prefixed with `[ListenAlongFix]`.

## License

GPL-3.0-or-later, same as Vencord.
