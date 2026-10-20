/*
 * ListenAlongFix - Vencord plugin (main process side)
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Serves the current Listen Along state on a localhost-only HTTP endpoint
 * so the companion Spicetify extension can pick it up.
 */

import { createServer, IncomingMessage, Server, ServerResponse } from "http";

// Keep in sync with BRIDGE_URL in spicetify/listenAlongFix.js
const PORT = 32145;
const ALLOWED_ORIGIN = "https://xpui.app.spotify.com";

export interface ListenAlongState {
    /** true while Discord says we're listening along with someone */
    active: boolean;
    /** changes every time a new Listen Along session starts */
    sessionId: string | null;
    /** Spotify track id (no "spotify:track:" prefix) */
    trackId: string | null;
    /** epoch ms when the host started the current track */
    startTime: number | null;
    /** whether the host currently shows a Spotify activity for that track */
    hostPlaying: boolean;
    /** epoch ms when this state was produced */
    updatedAt: number;
}

let state: ListenAlongState = {
    active: false,
    sessionId: null,
    trackId: null,
    startTime: null,
    hostPlaying: false,
    updatedAt: Date.now()
};

let server: Server | null = null;

function handle(req: IncomingMessage, res: ServerResponse) {
    const { origin } = req.headers;
    if (origin === ALLOWED_ORIGIN) {
        res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
        res.setHeader("Access-Control-Allow-Private-Network", "true");
        res.setHeader("Vary", "Origin");
    }

    if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET");
        res.writeHead(204).end();
        return;
    }

    if (req.method === "GET" && req.url === "/state") {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        // Report "now" so the client can correct for clock skew
        res.writeHead(200).end(JSON.stringify({ ...state, now: Date.now() }));
        return;
    }

    res.writeHead(404).end();
}

export function startServer() {
    if (server) return;
    server = createServer(handle);
    server.on("error", err => console.error("[ListenAlongFix] server error:", err));
    server.listen(PORT, "127.0.0.1");
}

export function stopServer() {
    server?.close();
    server = null;
}

export function setState(_: unknown, next: ListenAlongState) {
    state = next;
}
