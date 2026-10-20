// NAME: Listen Along Fix
// AUTHOR: mystic
// DESCRIPTION: Plays Discord Listen Along tracks through the local player. Requires the ListenAlongFix Vencord plugin.

(async function listenAlongFix() {
    // Keep in sync with PORT in vencord/listenAlongFix/native.ts
    const BRIDGE_URL = "http://127.0.0.1:32145/state";
    const POLL_MS = 1000;
    // Allowed difference between our position and the host's before we seek
    const DRIFT_MS = 2500;
    // Minimum time between two seeks, so a slow seek doesn't cause a loop
    const SEEK_COOLDOWN_MS = 4000;
    // Grace period after we change track before we judge what the user did
    const SETTLE_MS = 5000;

    while (!Spicetify?.Player?.playUri || !Spicetify?.Platform) {
        await new Promise(r => setTimeout(r, 300));
    }

    const log = (...args) => console.log("[ListenAlongFix]", ...args);

    const session = {
        id: null,
        overridden: false,
        commandedUri: null,
        commandedAt: 0,
        lastSeekAt: 0,
        pausedByUs: false,
        knownDuration: 0
    };

    function resetSession(id) {
        session.id = id;
        session.overridden = false;
        session.commandedUri = null;
        session.commandedAt = 0;
        session.lastSeekAt = 0;
        session.pausedByUs = false;
        session.knownDuration = 0;
    }

    function currentUri() {
        const data = Spicetify.Player.data;
        return data?.item?.uri ?? data?.track?.uri ?? null;
    }

    function giveUp(reason) {
        session.overridden = true;
        log(`stopped following this session: ${reason}`);
        Spicetify.showNotification?.("Listen Along paused: you took over playback");
    }

    async function fetchState() {
        try {
            const res = await fetch(BRIDGE_URL, { cache: "no-store", signal: AbortSignal.timeout(800) });
            if (!res.ok) return null;
            return await res.json();
        } catch {
            // Discord closed or plugin disabled
            return null;
        }
    }

    async function tick() {
        const state = await fetchState();

        if (!state?.active || !state.trackId || state.startTime == null) {
            if (session.id) log("listen along ended");
            if (session.id) resetSession(null);
            return;
        }

        if (state.sessionId !== session.id) {
            resetSession(state.sessionId);
            log("listen along started", state);
        }
        if (session.overridden) return;

        const expectedUri = `spotify:track:${state.trackId}`;
        const expectedPos = Math.max(0, Date.now() - state.startTime);
        const uri = currentUri();
        const settled = Date.now() - session.commandedAt > SETTLE_MS;

        // Host paused/stopped: their Spotify activity disappears from presence
        if (!state.hostPlaying) {
            if (uri === expectedUri && Spicetify.Player.isPlaying()) {
                Spicetify.Player.pause();
                session.pausedByUs = true;
                log("host paused");
            }
            return;
        }

        if (uri !== expectedUri) {
            const userSwitched =
                session.commandedUri === expectedUri &&
                uri != null &&
                settled &&
                // Our copy of the track may just have ended a bit before the host's presence updated
                !(session.knownDuration && expectedPos > session.knownDuration - 3000);

            if (userSwitched) return giveUp("track changed manually");

            if (session.commandedUri !== expectedUri || settled) {
                log("playing", expectedUri, "at", expectedPos);
                session.commandedUri = expectedUri;
                session.commandedAt = Date.now();
                session.pausedByUs = false;
                await Spicetify.Player.playUri(expectedUri);
            }
            return;
        }

        session.knownDuration = Spicetify.Player.getDuration?.() || session.knownDuration;

        if (!Spicetify.Player.isPlaying()) {
            if (session.pausedByUs || !settled) {
                session.pausedByUs = false;
                Spicetify.Player.play();
            } else {
                return giveUp("paused manually");
            }
        }

        const drift = Math.abs(Spicetify.Player.getProgress() - expectedPos);
        const inTrack = !session.knownDuration || expectedPos < session.knownDuration - 1000;
        if (drift > DRIFT_MS && inTrack && Date.now() - session.lastSeekAt > SEEK_COOLDOWN_MS) {
            session.lastSeekAt = Date.now();
            Spicetify.Player.seek(expectedPos);
            log(`resynced (${Math.round(drift)}ms off)`);
        }
    }

    let busy = false;
    setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
            await tick();
        } catch (e) {
            console.error("[ListenAlongFix]", e);
        } finally {
            busy = false;
        }
    }, POLL_MS);

    log("loaded, waiting for Discord Listen Along");
})();
