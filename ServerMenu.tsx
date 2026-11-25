/*
 * Custom server menu. It lists the same actions as Discord's own server menu (including
 * ones other plugins add) and runs them through it: Discord's menu is opened invisibly,
 * read, and the chosen entry is pressed there. That keeps every action and permission
 * check Discord's own, while the menu itself is ours.
 */

import { useEffect, useState } from "@webpack/common";

import { I, Icon } from "./Hub";

interface Entry { id: string; label: string; danger: boolean; checked: boolean | null; }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const stockHeader = () => document.querySelector<HTMLElement>(
    '[class*="sidebarList_"] [class*="guildDropdown_"], [class*="sidebarList_"] header [role="button"]'
);

const stockMenu = () => document.querySelector<HTMLElement>(
    '#guild-header-popout, [class*="layerContainer_"] [role="menu"]'
);

async function openStock(): Promise<HTMLElement | null> {
    const header = stockHeader();
    if (!header) return null;
    document.body.classList.add("gh-proxy");
    if (!stockMenu()) header.click();
    for (let i = 0; i < 25; i++) {
        await sleep(30);
        const menu = stockMenu();
        if (menu) return menu;
    }
    return null;
}

async function closeStock() {
    const menu = stockMenu();
    if (menu) {
        menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true } as any));
        await sleep(80);
        if (stockMenu()) stockHeader()?.click();
    }
    setTimeout(() => document.body.classList.remove("gh-proxy"), 200);
}

function readEntries(menu: HTMLElement): Entry[] {
    return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]'))
        .filter(el => el.id && el.getAttribute("aria-haspopup") == null && el.getAttribute("aria-expanded") == null)
        .map(el => ({
            id: el.id,
            label: (el.querySelector('[class*="label_"]')?.textContent || el.textContent || "").trim(),
            danger: /danger/i.test(el.className),
            checked: el.getAttribute("role") === "menuitemcheckbox" ? el.getAttribute("aria-checked") === "true" : null
        }))
        .filter(e => e.label);
}

// The four everyday actions get large buttons; everything else is a list.
const featuredList = (): [string, string, string][] => [
    ["invite-people", I.friends, "Invite"],
    ["settings", I.sliders, "Settings"],
    ["notifications", I.bell, "Alerts"],
    ["create-channel", I.plus, "Channel"]
];

export function ServerMenu({ canEditChannels, onEditChannels, onClose }: {
    canEditChannels: boolean;
    onEditChannels(): void;
    onClose(): void;
}) {
    const [entries, setEntries] = useState<Entry[] | null>(null);

    useEffect(() => {
        let alive = true;
        (async () => {
            await sleep(90); // let the click that opened us finish first
            const menu = await openStock();
            const found = menu ? readEntries(menu) : [];
            await closeStock();
            if (alive) setEntries(found);
        })();
        return () => { alive = false; };
    }, []);

    const run = async (entry: Entry) => {
        await sleep(90);
        const menu = await openStock();
        const target = menu && document.getElementById(entry.id);
        if (!target) {
            await closeStock();
            return onClose();
        }
        target.click();
        if (entry.checked !== null) {
            // A checkbox keeps Discord's menu open: close it and reflect the new state here.
            await closeStock();
            setEntries(list => list!.map(e => e.id === entry.id ? { ...e, checked: !e.checked } : e));
        } else {
            setTimeout(() => document.body.classList.remove("gh-proxy"), 250);
            onClose();
        }
    };

    if (!entries) return <div className="gh-smenu"><div className="gh-empty">Loading…</div></div>;

    const featured = featuredList()
        .map(([suffix, icon, short]) => ({ entry: entries.find(e => e.id.endsWith("-" + suffix)), icon, short }))
        .filter(f => f.entry) as { entry: Entry; icon: string; short: string; }[];
    const featuredIds = new Set(featured.map(f => f.entry.id));
    const rest = entries.filter(e => !featuredIds.has(e.id) && !e.danger);
    const danger = entries.filter(e => e.danger);

    return (
        <div className="gh-smenu">
            {featured.length > 0 && (
                <div className="gh-smenu-tiles">
                    {featured.map(({ entry, icon, short }) => (
                        <button key={entry.id} className="gh-page" onClick={() => run(entry)} aria-label={entry.label}>
                            <Icon d={icon} size={20} />
                            <span>{short}</span>
                        </button>
                    ))}
                </div>
            )}
            {canEditChannels && (
                <button className="gh-smenu-row gh-accent" onClick={() => { onEditChannels(); onClose(); }}>
                    <Icon d={I.edit} size={16} />
                    <span>Edit channels and categories</span>
                </button>
            )}
            <div className="gh-smenu-list">
                {rest.map(e => (
                    <button key={e.id} className="gh-smenu-row" onClick={() => run(e)}>
                        <span>{e.label}</span>
                        {e.checked !== null && <i className={"gh-switch" + (e.checked ? " gh-on" : "")} />}
                    </button>
                ))}
                {danger.map(e => (
                    <button key={e.id} className="gh-smenu-row gh-danger" onClick={() => run(e)}>
                        <span>{e.label}</span>
                    </button>
                ))}
                {!entries.length && <div className="gh-empty">Discord's menu could not be read. Turn the hub off in settings to use it directly.</div>}
            </div>
        </div>
    );
}
