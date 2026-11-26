/*
 * Glasshouse: companion plugin for Glasshouse.theme.css
 *
 *  - Replaces the server rail and channel list with a custom hub (Hub.tsx):
 *    searchable animated servers, own channel and DM lists, member finder with
 *    moderation actions, quick settings.
 *  - Drives the theme's --gh-* variables live.
 *  - Shortcuts: Ctrl+Alt+F focus, Ctrl+Alt+M members pane, Ctrl+Alt+S search, Ctrl+Alt+D member finder, Ctrl+Alt+C calculator, Ctrl+Alt+A assistant.
 */

import "./style.css";

import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { PluginNative } from "@utils/types";
import { createRoot, SelectedGuildStore } from "@webpack/common";

import { assistantPathCheck, AssistantPage, isAssistantOpen, onAssistantChange } from "./Assistant";
import { Friends } from "./Friends";
import { Hub } from "./Hub";
import { MemberList } from "./Members";
import { apply, clear, settings, stopKeys } from "./settings";

let host: HTMLDivElement | null = null;
let reactRoot: any = null;
let watcher: any = null;

/** Keep the hub attached to Discord's sidebar element, which React may recreate. */
function attach() {
    if (!settings.store.useHub) {
        host?.remove();
        return;
    }
    const sidebar = document.querySelector('[class*="sidebarList_"]')?.parentElement;
    if (!sidebar) return;

    if (!host) {
        host = document.createElement("div");
        host.id = "gh-hub";
        reactRoot = createRoot(host);
        // Discord refocuses the chat box on any keydown that reaches the document.
        host.addEventListener("keydown", stopKeys);
        reactRoot.render(<ErrorBoundary noop><Hub /></ErrorBoundary>);
    }
    if (host.parentElement !== sidebar) sidebar.appendChild(host);
}

let friendsHost: HTMLDivElement | null = null;
let friendsRoot: any = null;

/** The friends page is drawn over Discord's own, which stays underneath, hidden. */
function attachFriends() {
    const main = document.querySelector('[class*="page_"] [class*="peopleColumn_"]')?.closest("main") as HTMLElement | null;
    const on = !!main && settings.store.customFriends;
    // Any stale marker (page changed, or the setting was turned off) is cleared.
    document.querySelectorAll("main[data-gh-friends]").forEach(el => { if (!on || el !== main) el.removeAttribute("data-gh-friends"); });
    if (!on) {
        friendsHost?.remove();
        return;
    }
    if (!friendsHost) {
        friendsHost = document.createElement("div");
        friendsHost.id = "gh-friends";
        friendsRoot = createRoot(friendsHost);
        friendsHost.addEventListener("keydown", stopKeys);
        friendsRoot.render(<ErrorBoundary noop><Friends /></ErrorBoundary>);
    }
    if (friendsHost.parentElement !== main) main!.appendChild(friendsHost);
    main!.setAttribute("data-gh-friends", "");
}

let assistantHost: HTMLDivElement | null = null;
let assistantRoot: any = null;
let assistantUnsub: (() => void) | null = null;

/** The assistant's conversation is drawn over Discord's page while it is open. */
function attachAssistant() {
    assistantPathCheck();
    const page = document.querySelector('[class*="content_"] > [class*="page_"]') as HTMLElement | null;
    const on = !!page && isAssistantOpen();
    document.querySelectorAll("[data-gh-assistant]").forEach(el => { if (!on || el !== page) el.removeAttribute("data-gh-assistant"); });
    if (!on) {
        assistantHost?.remove();
        return;
    }
    if (!assistantHost) {
        assistantHost = document.createElement("div");
        assistantHost.id = "gh-assistant";
        assistantRoot = createRoot(assistantHost);
        assistantHost.addEventListener("keydown", stopKeys);
        assistantRoot.render(<ErrorBoundary noop><AssistantPage /></ErrorBoundary>);
    }
    if (assistantHost.parentElement !== page) page!.appendChild(assistantHost);
    page!.setAttribute("data-gh-assistant", "");
}

let membersHost: HTMLDivElement | null = null;
let membersRoot: any = null;

/** Same idea for the member list: it lives inside Discord's members pane. */
function attachMembers() {
    const wrap = document.querySelector('[class*="page_"] [class*="membersWrap_"]');
    const on = !!wrap && settings.store.glasshouseMembers && !!SelectedGuildStore.getGuildId();
    document.body.classList.toggle("gh-members-on", on);
    if (!on) {
        membersHost?.remove();
        return;
    }
    if (!membersHost) {
        membersHost = document.createElement("div");
        membersHost.id = "gh-members";
        membersRoot = createRoot(membersHost);
        membersHost.addEventListener("keydown", stopKeys);
        membersRoot.render(<ErrorBoundary noop><MemberList /></ErrorBoundary>);
    }
    if (membersHost.parentElement !== wrap) wrap!.appendChild(membersHost);
}

function detach() {
    assistantUnsub?.();
    assistantUnsub = null;
    assistantRoot?.unmount();
    assistantRoot = null;
    assistantHost?.remove();
    assistantHost = null;
    document.querySelectorAll("[data-gh-assistant]").forEach(el => el.removeAttribute("data-gh-assistant"));
    friendsRoot?.unmount();
    friendsRoot = null;
    friendsHost?.remove();
    friendsHost = null;
    document.querySelectorAll("main[data-gh-friends]").forEach(el => el.removeAttribute("data-gh-friends"));
    membersRoot?.unmount();
    membersRoot = null;
    membersHost?.remove();
    membersHost = null;
    document.body.classList.remove("gh-members-on");
    document.getElementById("gh-portal")?.remove();
    clearInterval(watcher);
    watcher = null;
    reactRoot?.unmount();
    reactRoot = null;
    host?.remove();
    host = null;
}

/*
 * Theme helper: Ctrl+Alt+Shift+R copies a list of the large elements in the main page
 * that paint their own background (class names and colour). Paste it into a bug report
 * when part of a screen does not match the theme.
 */
function surfaceReport() {
    const page = document.querySelector('[class*="content_"] > [class*="page_"]');
    if (!page) return;
    const lines: string[] = [];
    for (const el of Array.from(page.querySelectorAll<HTMLElement>("*"))) {
        const box = el.getBoundingClientRect();
        if (box.width < 200 || box.height < 60) continue;
        const cs = getComputedStyle(el);
        const parts = cs.backgroundColor.replace(/[^0-9.,]/g, "").split(",");
        const alpha = parts.length === 4 ? Number(parts[3]) : 1;
        const image = cs.backgroundImage !== "none";
        if (alpha < 0.3 && !image) continue;
        const cls = typeof el.className === "string" ? el.className.split(" ").filter(Boolean).slice(0, 4).join(".") : "";
        lines.push(`${el.tagName.toLowerCase()}.${cls} | ${Math.round(box.width)}x${Math.round(box.height)} | ${cs.backgroundColor}${image ? " | image" : ""}`);
        if (lines.length >= 60) break;
    }
    navigator.clipboard.writeText(lines.join(String.fromCharCode(10)) || "nothing paints its own background here");
}

function onKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey && e.altKey && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        return surfaceReport();
    }
    if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey) return;

    const key = e.key.toLowerCase();
    if (key === "f") settings.store.focusMode = !settings.store.focusMode;
    else if (key === "m") settings.store.hideMembers = !settings.store.hideMembers;
    else return;

    e.preventDefault();
    e.stopPropagation();
    apply();
}

export default definePlugin({
    name: "Glasshouse",
    description: "Custom hub (servers, channels, member finder, quick settings) and live controls for the Glasshouse theme.",
    authors: [{ name: "itsnik-scrpt", id: 0n }],
    settings,

    start() {
        apply();
        // The theme ships inside the plugin; this refreshes the copy in the themes folder.
        if (settings.store.syncTheme) {
            const native = VencordNative.pluginHelpers.Glasshouse as PluginNative<typeof import("./native")> | undefined;
            void native?.syncTheme?.();
        }
        document.addEventListener("keydown", onKeyDown, true);
        attach();
        attachMembers();
        attachFriends();
        assistantUnsub = onAssistantChange(attachAssistant);
        watcher = setInterval(() => { attach(); attachMembers(); attachFriends(); attachAssistant(); }, 500);
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        detach();
        clear();
    }
});
