/*
 * Glasshouse: companion plugin for Glasshouse.theme.css
 *
 *  - Replaces the server rail and channel list with a custom hub (Hub.tsx):
 *    searchable animated servers, own channel and DM lists, member finder with
 *    moderation actions, quick settings.
 *  - Drives the theme's --gh-* variables live.
 *  - Shortcuts: Ctrl+Alt+F focus, Ctrl+Alt+M members pane, Ctrl+Alt+S search, Ctrl+Alt+D member finder.
 */

import "./style.css";

import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { createRoot, SelectedGuildStore } from "@webpack/common";

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

function onKeyDown(e: KeyboardEvent) {
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
        document.addEventListener("keydown", onKeyDown, true);
        attach();
        attachMembers();
        attachFriends();
        watcher = setInterval(() => { attach(); attachMembers(); attachFriends(); }, 500);
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        detach();
        clear();
    }
});
