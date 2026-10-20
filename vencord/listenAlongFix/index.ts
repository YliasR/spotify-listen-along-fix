/*
 * ListenAlongFix - Vencord plugin (renderer side)
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Discord's Listen Along tells Spotify's Web API to play the host's track on
 * your desktop client. The API reports success but the desktop app ignores it.
 * This plugin reads Discord's own Listen Along state and exposes it locally so
 * the companion Spicetify extension can play the track through the local player.
 */

import definePlugin, { PluginNative } from "@utils/types";
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

const POLL_MS = 1000;

let interval: ReturnType<typeof setInterval> | null = null;
let currentSession: string | null = null;
let lastPayload = "";

function findHostActivity(userId: string) {
    return PresenceStore.getActivities(userId)
        ?.find(a => a.sync_id != null && a.party?.id?.startsWith("spotify:"));
}

function buildState(): ListenAlongState {
    const sync = SpotifyStore.getSyncingWith?.();

    if (!sync) {
        currentSession = null;
        return {
            active: false,
            sessionId: null,
            trackId: null,
            startTime: null,
            hostPlaying: false,
            updatedAt: Date.now()
        };
    }

    // New session whenever we start following someone (or switch party)
    const key = `${sync.userId}:${sync.partyId}`;
    if (!currentSession?.startsWith(key + ":"))
        currentSession = `${key}:${Date.now()}`;

    // Presence is usually fresher than Discord's cached sync info
    const host = findHostActivity(sync.userId);

    return {
        active: true,
        sessionId: currentSession,
        trackId: host?.sync_id ?? sync.trackId,
        startTime: host?.timestamps?.start != null ? Number(host.timestamps.start) : sync.startTime,
        hostPlaying: host != null,
        updatedAt: Date.now()
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

    start() {
        Native.startServer();
        lastPayload = "";
        tick();
        interval = setInterval(tick, POLL_MS);
    },

    stop() {
        if (interval) clearInterval(interval);
        interval = null;
        Native.setState({
            active: false,
            sessionId: null,
            trackId: null,
            startTime: null,
            hostPlaying: false,
            updatedAt: Date.now()
        });
        Native.stopServer();
    }
});
