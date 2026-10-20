/*
 * ListenAlongFix - Vencord plugin (renderer side)
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Discord's Listen Along tells Spotify's Web API to play the host's track on
 * your desktop client. The API reports success but the desktop app ignores it.
 * This plugin reads Discord's own Listen Along state and exposes it locally so
 * the companion Spicetify extension can play the track through the local player.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { PresenceStore } from "@webpack/common";

import type { ListenAlongState } from "./native";

const Native = VencordNative.pluginHelpers.ListenAlongFix as PluginNative<typeof import("./native")>;

interface SyncingWith {
    userId: string;
    partyId: string;
    trackId: string;
    startTime: number;
}

const SpotifyStore = findStoreLazy("SpotifyStore") as {
    getSyncingWith(): SyncingWith | null | undefined;
};

const settings = definePluginSettings({
    graceSeconds: {
        type: OptionType.SLIDER,
        description: "How long to keep waiting for the host after their Spotify activity disappears (seconds)",
        default: 20,
        markers: [0, 5, 10, 20, 30, 45, 60, 90, 120],
        stickToMarkers: true
    }
});

const POLL_MS = 1000;

/** The session we're following, kept alive after Discord drops it. */
interface Session {
    id: string;
    userId: string;
    trackId: string;
    startTime: number;
    /** epoch ms when the host's activity disappeared, null while visible */
    hostLostAt: number | null;
    /** Discord stopped syncing because the host vanished; we keep following */
    detached: boolean;
}

let interval: ReturnType<typeof setInterval> | null = null;
let session: Session | null = null;
let lastPayload = "";

const INACTIVE = (): ListenAlongState => ({
    active: false,
    sessionId: null,
    trackId: null,
    startTime: null,
    hostPlaying: false,
    updatedAt: Date.now()
});

function findHostActivity(userId: string) {
    return PresenceStore.getActivities(userId)
        ?.find(a => a.sync_id != null && a.party?.id?.startsWith("spotify:"));
}

function buildState(): ListenAlongState {
    const sync = SpotifyStore.getSyncingWith?.();

    if (sync) {
        // New session whenever we start following someone else
        if (session?.userId !== sync.userId) {
            session = {
                id: `${sync.userId}:${Date.now()}`,
                userId: sync.userId,
                trackId: sync.trackId,
                startTime: sync.startTime,
                hostLostAt: null,
                detached: false
            };
        }
        session.detached = false;
    } else if (session && !session.detached) {
        // Discord ended Listen Along. If the host is still playing, the user
        // stopped it on purpose. If the host vanished, Discord gave up on its
        // own, so we keep following them ourselves.
        if (findHostActivity(session.userId)) session = null;
        else session.detached = true;
    }

    if (!session) return INACTIVE();

    // Presence is usually fresher than Discord's cached sync info
    const host = findHostActivity(session.userId);
    const now = Date.now();

    if (host?.sync_id) {
        session.hostLostAt = null;
        session.trackId = host.sync_id;
        session.startTime = host.timestamps?.start != null ? Number(host.timestamps.start) : session.startTime;
    } else if (sync) {
        session.trackId = sync.trackId;
        session.startTime = sync.startTime;
        session.hostLostAt ??= now;
    } else {
        session.hostLostAt ??= now;
        if (now - session.hostLostAt > settings.store.graceSeconds * 1000) {
            session = null;
            return INACTIVE();
        }
    }

    return {
        active: true,
        sessionId: session.id,
        trackId: session.trackId,
        startTime: session.startTime,
        hostPlaying: session.hostLostAt == null,
        updatedAt: now
    };
}

function tick() {
    try {
        const state = buildState();
        // Only cross IPC when something meaningful changed
        const { updatedAt, ...comparable } = state;
        const payload = JSON.stringify(comparable);
        if (payload === lastPayload) return;
        lastPayload = payload;
        Native.setState(state);
    } catch (e) {
        console.error("[ListenAlongFix]", e);
    }
}

export default definePlugin({
    name: "ListenAlongFix",
    description: "Makes Spotify Listen Along work with the desktop app (needs the ListenAlongFix Spicetify extension)",
    authors: [{ name: "mystic", id: 0n }],
    settings,

    start() {
        Native.startServer();
        session = null;
        lastPayload = "";
        tick();
        interval = setInterval(tick, POLL_MS);
    },

    stop() {
        if (interval) clearInterval(interval);
        interval = null;
        session = null;
        Native.setState(INACTIVE());
        Native.stopServer();
    }
});
