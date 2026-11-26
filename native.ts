/*
 * Runs in Discord's main process, for the two things the page itself cannot do:
 * reach another site (the assistant's requests) and write a file (the theme).
 */

import { THEMES_DIR } from "@main/utils/constants";
import { IpcMainInvokeEvent } from "electron";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

import theme from "file://theme/Glasshouse.theme.css";

export async function askAssistant(_: IpcMainInvokeEvent, apiKey: string, payload: string) {
    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2026-10-21"
            },
            body: payload,
            signal: AbortSignal.timeout(300_000)
        });
        return { status: res.status, data: await res.text() };
    } catch (e) {
        return { status: -1, data: String(e) };
    }
}

/**
 * Posts a message through a webhook. Discord refuses webhook posts that come from its
 * own page ("Invalid request origin"), so this one request is sent from here instead.
 * The address is built from a checked id and token and always points at discord.com.
 */
export async function postWebhook(_: IpcMainInvokeEvent, id: string, token: string, threadId: string | null, payload: string) {
    try {
        if (!/^\d{5,25}$/.test(id) || !/^[\w-]{20,200}$/.test(token) || (threadId !== null && !/^\d{5,25}$/.test(threadId))) {
            return { status: 0, data: "The webhook details are not valid." };
        }
        const res = await fetch(`https://discord.com/api/v10/webhooks/${id}/${token}?wait=true${threadId ? `&thread_id=${threadId}` : ""}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            signal: AbortSignal.timeout(20_000)
        });
        return { status: res.status, data: await res.text() };
    } catch (e) {
        return { status: -1, data: String(e) };
    }
}

const IMAGE_HOSTS = [".discordapp.com", ".discordapp.net", ".tenor.com", ".giphy.com", ".klipy.com"];

/**
 * Downloads a sticker or a GIF's still frame so the assistant can be shown it.
 * Only picture hosts Discord itself uses are allowed, and only small pictures.
 */
export async function fetchImage(_: IpcMainInvokeEvent, url: string) {
    try {
        const target = new URL(url);
        if (target.protocol !== "https:" || !IMAGE_HOSTS.some(host => ("." + target.hostname).endsWith(host))) return null;
        const res = await fetch(target, { signal: AbortSignal.timeout(15_000) });
        const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
        if (!res.ok || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(type)) return null;
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length > 4.5 * 1024 * 1024) return null;
        return `data:${type};base64,${bytes.toString("base64")}`;
    } catch {
        return null;
    }
}

/**
 * Writes the theme that shipped with this build into Vencord's themes folder when the
 * copy there is different, so the theme updates together with the plugin.
 */
export async function syncTheme(_: IpcMainInvokeEvent) {
    try {
        const file = join(THEMES_DIR, "Glasshouse.theme.css");
        const clean = (text: string) => text.replace(/\r\n/g, "\n").trimEnd();
        const current = await readFile(file, "utf-8").catch(() => null);
        if (current !== null && clean(current) === clean(theme)) return false;
        await mkdir(THEMES_DIR, { recursive: true });
        await writeFile(file, theme);
        return true;
    } catch {
        return false;
    }
}
