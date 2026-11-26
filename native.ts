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
