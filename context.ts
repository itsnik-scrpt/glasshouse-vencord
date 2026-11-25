/*
 * Right-click menus for the hub's own lists.
 *
 * Discord's server rail, channel list and member list are still in the page, only hidden.
 * A right-click on a hub item is passed on to the matching hidden Discord item, so Discord
 * opens its real context menu (with everything other plugins add to it) at the pointer.
 */

import { findStoreLazy } from "@webpack";
import { SortedGuildStore } from "@webpack/common";

const ExpandedGuildFolderStore = findStoreLazy("ExpandedGuildFolderStore");

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const one = (root: ParentNode | null | undefined, selector: string) =>
    root?.querySelector<HTMLElement>(selector) ?? null;

/** Discord only renders the rows near its scroll position: scroll its list until the row exists. */
async function findInList(scope: HTMLElement | null, selector: string): Promise<HTMLElement | null> {
    if (!scope) return null;
    let el = one(scope, selector);
    if (el) return el;

    const scroller = Array.from(scope.querySelectorAll<HTMLElement>('[class*="scroller_"]'))
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return null;

    const step = Math.max(200, scroller.clientHeight * 0.8);
    for (let top = 0, tries = 0; top <= scroller.scrollHeight && tries < 60; top += step, tries++) {
        scroller.scrollTop = top;
        await sleep(25);
        el = one(scope, selector);
        if (el) return el;
    }
    return null;
}

function fire(target: HTMLElement, x: number, y: number) {
    target.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, view: window, button: 2, buttons: 2, clientX: x, clientY: y
    }));
}

type Click = { preventDefault(): void; stopPropagation(): void; clientX: number; clientY: number; };

async function forward(e: Click, find: () => Promise<HTMLElement | null>) {
    e.preventDefault();
    e.stopPropagation();
    const { clientX, clientY } = e;
    const target = await find();
    if (target) fire(target, clientX, clientY);
}

const sidebarList = () => one(document, '[class*="sidebarList_"]');
const guildRail = () => one(document, 'nav[class*="guilds_"]');
const membersPane = () => one(document, '[class*="page_"] [class*="membersWrap_"]');

/** Channels, categories and voice channels in a server; DMs and group DMs on Home. */
export function channelContext(e: Click, channelId: string) {
    return forward(e, () => findInList(sidebarList(), `[data-list-item-id$="___${channelId}"]`));
}

/** A server anywhere in the hub or the server grid. */
export function guildContext(e: Click, guildId: string) {
    return forward(e, async () => {
        const selector = `[data-list-item-id="guildsnav___${guildId}"]`;
        let el = await findInList(guildRail(), selector);
        if (el) return el;

        // Servers inside a closed folder are not rendered: open the folder first.
        try {
            const folder = SortedGuildStore.getGuildFolders()
                .find((f: any) => f.folderId != null && f.guildIds?.includes(guildId)) as any;
            if (folder && !ExpandedGuildFolderStore.isFolderExpanded?.(folder.folderId)) {
                const head = await findInList(guildRail(), `[data-list-item-id="guildsnav___${folder.folderId}"]`);
                head?.click();
                await sleep(120);
                el = await findInList(guildRail(), selector);
            }
        } catch { /* fall through */ }
        return el;
    });
}

/** A member in the Glasshouse member list. */
export function memberContext(e: Click, userId: string) {
    return forward(e, () => findInList(membersPane(), `[class*="members_"] [data-list-item-id$="___${userId}"]`));
}

/** Someone listed under a voice channel. */
export function voiceUserContext(e: Click, userId: string) {
    return forward(e, async () => {
        const list = sidebarList();
        if (!list) return null;
        const rows = Array.from(list.querySelectorAll<HTMLElement>('[class*="voiceUser_"]'));
        return rows.find(r => r.innerHTML.includes(`/${userId}/`)) ?? null;
    });
}
