/*
 * Fullscreen server picker: an animated grid of servers and your own groups.
 * Groups are stored by the plugin (first import comes from Discord's folders) and can be
 * created, renamed, recoloured, reordered and deleted.
 */

import * as DataStore from "@api/DataStore";
import { openInviteModal } from "@utils/discord";
import {
    GuildReadStateStore,
    GuildStore,
    IconUtils,
    NavigationRouter,
    ReactDOM,
    SelectedGuildStore,
    SortedGuildStore,
    useEffect,
    useState
} from "@webpack/common";

import { acronym, Badge, I, Icon, matches, safe, useStores } from "./Hub";
import { guildContext } from "./context";
import { portalHost } from "./settings";

const GROUPS_KEY = "Glasshouse_groups";
const COLORS = ["#eb459e", "#f23f43", "#f0b232", "#23a55a", "#00a8fc", "#5865f2", "#9b59b6", "#80848e"];

interface Group { id: string; name: string; color: string | null; guildIds: string[]; pinned?: boolean; }

const newId = () => Math.random().toString(36).slice(2, 10);

const guildIcon = (g: any, size = 128) =>
    g?.icon ? IconUtils.getGuildIconURL({ id: g.id, icon: g.icon, size, canAnimate: false }) : null;

const allGuildIds = (): string[] => safe(() => SortedGuildStore.getFlattenedGuildIds(), []);

/** First run: start from Discord's own server folders. */
function importFolders(): Group[] {
    const folders: any[] = safe(() => SortedGuildStore.getGuildFolders(), []);
    return folders
        .filter(f => f.folderId != null && f.guildIds?.length)
        .map((f, i) => ({
            id: newId(),
            name: f.folderName || `Group ${i + 1}`,
            color: f.folderColor != null ? "#" + f.folderColor.toString(16).padStart(6, "0") : null,
            guildIds: [...f.guildIds]
        }));
}

function useGroups() {
    const [groups, setGroups] = useState<Group[] | null>(null);
    useEffect(() => {
        DataStore.get(GROUPS_KEY).then(v => setGroups(Array.isArray(v) ? v : importFolders()));
    }, []);
    const save = (next: Group[]) => {
        setGroups(next);
        DataStore.set(GROUPS_KEY, next);
    };
    return [groups ?? [], save] as const;
}

export function ServerGrid({ onClose }: { onClose(): void; }) {
    useStores([GuildStore, SortedGuildStore, GuildReadStateStore, SelectedGuildStore]);
    const [saved, save] = useGroups();
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [editing, setEditing] = useState(false);
    const [menuFor, setMenuFor] = useState<string | null>(null);
    const [dragging, setDragging] = useState<string | null>(null);
    const [join, setJoin] = useState(false);
    const [invite, setInvite] = useState("");
    const [joinError, setJoinError] = useState("");

    const groups = saved;
    const setGroups = save;
    const q = query.trim().toLowerCase();
    const selected = SelectedGuildStore.getGuildId();

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            if (menuFor) setMenuFor(null);
            else onClose();
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
    }, [menuFor]);

    /* ── data ── */

    const ids = allGuildIds();
    const exists = new Set(ids);
    const grouped = new Set<string>();
    const clean = groups.map(g => {
        const guildIds = g.guildIds.filter(id => exists.has(id) && !grouped.has(id) && (grouped.add(id), true));
        return { ...g, guildIds };
    });
    const ungrouped = ids.filter(id => !grouped.has(id));

    /* ── group operations ── */

    const moveGuild = (guildId: string, groupId: string | null) => {
        setGroups(clean.map(g => ({
            ...g,
            guildIds: g.id === groupId
                ? [...g.guildIds.filter(id => id !== guildId), guildId]
                : g.guildIds.filter(id => id !== guildId)
        })));
        setMenuFor(null);
    };
    const addGroup = () => {
        const g: Group = { id: newId(), name: "New group", color: COLORS[clean.length % COLORS.length], guildIds: [] };
        setGroups([...clean, g]);
    };
    const patchGroup = (id: string, patch: Partial<Group>) =>
        setGroups(clean.map(g => g.id === id ? { ...g, ...patch } : g));
    const deleteGroup = (id: string) => setGroups(clean.filter(g => g.id !== id));
    const shiftGroup = (id: string, by: number) => {
        const i = clean.findIndex(g => g.id === id);
        const j = i + by;
        if (i < 0 || j < 0 || j >= clean.length) return;
        const next = [...clean];
        [next[i], next[j]] = [next[j], next[i]];
        setGroups(next);
    };

    /* ── rendering ── */

    const go = (id: string | null) => {
        if (id) NavigationRouter.transitionToGuild(id);
        else NavigationRouter.transitionTo("/channels/@me");
        onClose();
    };
    const mentionsOf = (id: string) => safe(() => GuildReadStateStore.getMentionCount(id), 0);
    const unreadOf = (id: string) => safe(() => GuildReadStateStore.hasUnread(id), false);

    let n = 0; // running index for the staggered entrance
    const tile = (id: string, inGroup: string | null) => {
        const g: any = GuildStore.getGuild(id);
        if (!g) return null;
        const icon = guildIcon(g);
        return (
            <div key={id} className={"gh-tile-wrap" + (dragging === id ? " gh-dragging" : "")}>
                <button
                    className={"gh-tile" + (id === selected ? " gh-on" : "") + (unreadOf(id) ? " gh-unread" : "")}
                    style={{ "--i": n++ } as any}
                    draggable={editing}
                    onDragStart={e => {
                        e.dataTransfer.setData("text/plain", id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    onContextMenu={e => guildContext(e, id)}
                    onClick={() => editing ? setMenuFor(menuFor === id ? null : id) : go(id)}
                    aria-label={editing ? "Click to move, or drag onto a group" : g.name}
                >
                    <span className="gh-tile-icon">
                        {icon
                            ? <img src={icon} alt="" loading="lazy" decoding="async" draggable={false} />
                            : <span className="gh-acronym">{acronym(g.name)}</span>}
                        <Badge n={mentionsOf(id)} />
                    </span>
                    <span className="gh-tile-name">{g.name}</span>
                </button>
                {editing && menuFor === id && (
                    <div className="gh-move-menu">
                        <small>Move to</small>
                        {clean.filter(x => x.id !== inGroup).map(x => (
                            <button key={x.id} onClick={() => moveGuild(id, x.id)}>
                                <i style={{ background: x.color ?? "currentColor" }} />{x.name}
                            </button>
                        ))}
                        {inGroup && <button onClick={() => moveGuild(id, null)}>No group</button>}
                        {!clean.length && <span className="gh-move-empty">Make a group first.</span>}
                    </div>
                )}
            </div>
        );
    };

    const dropProps = (groupId: string | null) => editing ? {
        onDragOver: (e: any) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; e.currentTarget.classList.add("gh-drop"); },
        onDragLeave: (e: any) => e.currentTarget.classList.remove("gh-drop"),
        onDrop: (e: any) => {
            e.preventDefault();
            e.currentTarget.classList.remove("gh-drop");
            const id = e.dataTransfer.getData("text/plain");
            if (id) moveGuild(id, groupId);
        }
    } : {};

    const groupBlock = (g: Group, index: number) => {
        const isOpen = editing || open[g.id] || g.pinned;
        const togglePin = () => {
            // Unpinning leaves the group open, so it does not snap shut under the cursor.
            if (g.pinned) setOpen(o => ({ ...o, [g.id]: true }));
            patchGroup(g.id, { pinned: !g.pinned });
        };
        const pinButton = (
            <button className={"gh-tool" + (g.pinned ? " gh-on" : "")} onClick={togglePin}
                aria-label={g.pinned ? "Unpin (group can be closed again)" : "Pin: keep this group always open"}>
                <Icon d={I.pin} />
            </button>
        );
        const style = { "--gh-group": g.color ?? undefined, "--i": n } as any;

        if (!isOpen) {
            if (!g.guildIds.length) return null;
            const guilds = g.guildIds.map(id => GuildStore.getGuild(id)).filter(Boolean) as any[];
            const mentions = g.guildIds.reduce((sum, id) => sum + mentionsOf(id), 0);
            n++;
            return (
                <button
                    key={g.id}
                    className={"gh-tile gh-group"
                        + (g.guildIds.includes(selected ?? "") ? " gh-on" : "")
                        + (g.guildIds.some(unreadOf) ? " gh-unread" : "")}
                    style={style}
                    onClick={() => setOpen(o => ({ ...o, [g.id]: true }))}
                    aria-label={`${g.name} · ${guilds.length} servers`}
                >
                    <span className="gh-tile-icon gh-group-preview">
                        {guilds.slice(0, 4).map(x => {
                            const icon = guildIcon(x, 64);
                            return icon
                                ? <img key={x.id} src={icon} alt="" loading="lazy" decoding="async" draggable={false} />
                                : <span key={x.id} className="gh-acronym">{acronym(x.name).slice(0, 2)}</span>;
                        })}
                        <Badge n={mentions} />
                    </span>
                    <span className="gh-tile-name">{g.name}</span>
                    <small>{guilds.length} servers</small>
                </button>
            );
        }

        return (
            <section key={g.id} className="gh-group-open" style={style} {...dropProps(g.id)}>
                {editing ? (
                    <div className="gh-group-head gh-group-edit">
                        <input
                            value={g.name}
                            maxLength={40}
                            onChange={e => patchGroup(g.id, { name: e.target.value })}
                            placeholder="Group name"
                            spellCheck={false}
                        />
                        <span className="gh-swatches">
                            {COLORS.map(c => (
                                <button key={c} aria-label={c} className={"gh-swatch" + (g.color === c ? " gh-on" : "")}
                                    style={{ background: c }} onClick={() => patchGroup(g.id, { color: c })} />
                            ))}
                        </span>
                        {pinButton}
                        <button className="gh-tool" disabled={index === 0} onClick={() => shiftGroup(g.id, -1)} aria-label="Move group up">
                            <Icon d={I.up} />
                        </button>
                        <button className="gh-tool" disabled={index === clean.length - 1} onClick={() => shiftGroup(g.id, 1)} aria-label="Move group down">
                            <Icon d={I.chevron} />
                        </button>
                        <button className="gh-tool gh-danger" onClick={() => deleteGroup(g.id)} aria-label="Delete group (servers stay)">
                            <Icon d={I.trash} />
                        </button>
                    </div>
                ) : (
                    <div className="gh-group-bar">
                        <button className="gh-group-head" disabled={!!g.pinned}
                            onClick={() => setOpen(o => ({ ...o, [g.id]: false }))}>
                            {!g.pinned && <Icon d={I.chevron} size={14} />}
                            <strong>{g.name}</strong>
                            <small>{g.guildIds.length} servers</small>
                        </button>
                        {pinButton}
                    </div>
                )}
                <div className="gh-grid">
                    {g.guildIds.map(id => tile(id, g.id))}
                    {!g.guildIds.length && <div className="gh-empty gh-wide">Drag servers here, or click a server and choose this group.</div>}
                </div>
            </section>
        );
    };

    let content: any;
    if (q) {
        const hits = ids.filter(id => matches(GuildStore.getGuild(id)?.name, q));
        content = hits.length
            ? hits.map(id => tile(id, clean.find(g => g.guildIds.includes(id))?.id ?? null))
            : <div className="gh-empty gh-wide">No server matches “{query}”.</div>;
    } else {
        content = <>
            {!editing && (
                <button className={"gh-tile" + (!selected ? " gh-on" : "")} style={{ "--i": n++ } as any} onClick={() => go(null)}>
                    <span className="gh-tile-icon"><Icon d={I.home} size={30} /></span>
                    <span className="gh-tile-name">Direct Messages</span>
                </button>
            )}
            {clean.map(groupBlock)}
            {editing && (
                <button className="gh-new-group gh-wide" onClick={addGroup}>
                    <Icon d={I.plus} /> New group
                </button>
            )}
            {editing
                ? <section className="gh-group-open gh-ungrouped" {...dropProps(null)}>
                    <div className="gh-group-head"><strong>No group</strong><small>{ungrouped.length} servers</small></div>
                    <div className="gh-grid">{ungrouped.map(id => tile(id, null))}</div>
                </section>
                : ungrouped.map(id => tile(id, null))}
        </>;
    }

    /* ── joining ── */

    // Shows Discord's own invite screen for the code, where you confirm the join.
    const joinByInvite = async () => {
        const code = invite.trim().replace(/\/+$/, "").split("/").pop()!.split(/[?#]/)[0];
        if (!code) return;
        try {
            await openInviteModal(code);
            onClose();
        } catch {
            setJoinError("That invite is invalid or has expired.");
        }
    };

    // Opens Discord's own "Create or join a server" dialog through its hidden sidebar button.
    const createServer = () => {
        const stock = document.querySelector<HTMLElement>('[data-list-item-id="guildsnav___create-join-button"]');
        if (!stock) return setJoinError("Could not open Discord's dialog. Turn the hub off in settings and use the + in Discord's sidebar.");
        stock.click();
        onClose();
    };

    // A click on empty space never closes the grid; it only dismisses the move menu.
    const clickEmpty = () => setMenuFor(null);

    const firstHit = () => ids.find(id => matches(GuildStore.getGuild(id)?.name, q));

    return ReactDOM.createPortal(
        <div className={"gh-overlay" + (editing ? " gh-editing" : "")} onMouseDown={e => e.target === e.currentTarget && clickEmpty()}>
            <div className="gh-overlay-top">
                <label className="gh-search gh-search-big">
                    <Icon d={I.search} size={20} />
                    <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => {
                            const hit = e.key === "Enter" && q && !editing && firstHit();
                            if (hit) go(hit);
                        }}
                        placeholder="Search your servers" spellCheck={false} />
                </label>
                {!editing && (
                    <button className={"gh-pill" + (join ? " gh-on" : "")} onClick={() => setJoin(v => !v)}>
                        <Icon d={I.plus} /> Add server
                    </button>
                )}
                <button className={"gh-pill" + (editing ? " gh-on" : "")}
                    onClick={() => { setEditing(v => !v); setMenuFor(null); }}>
                    <Icon d={I.edit} /> {editing ? "Done" : "Edit groups"}
                </button>
                <button className="gh-tool" onClick={onClose} aria-label="Close (Esc)"><Icon d={I.x} size={20} /></button>
            </div>

            {join && !editing && (
                <div className="gh-overlay-bar">
                    <label className="gh-search gh-field">
                        <Icon d={I.link} size={18} />
                        <input autoFocus value={invite} onChange={e => { setInvite(e.target.value); setJoinError(""); }}
                            onKeyDown={e => e.key === "Enter" && joinByInvite()}
                            placeholder="Paste an invite link or code" spellCheck={false} />
                        <button className="gh-pill gh-on" disabled={!invite.trim()} onClick={joinByInvite}>Join</button>
                    </label>
                    <button className="gh-text-btn" onClick={createServer}>or create a server</button>
                    {joinError && <span className="gh-error">{joinError}</span>}
                </div>
            )}

            {editing && (
                <div className="gh-overlay-bar">
                    <button className="gh-pill" onClick={() => save(importFolders())} aria-label="Replace your groups with Discord's server folders">
                        Re-import Discord folders
                    </button>
                </div>
            )}

            <div className="gh-overlay-scroll" onMouseDown={e => e.target === e.currentTarget && clickEmpty()}>
                <div className="gh-grid" key={(q ? "search" : "all") + (editing ? "-edit" : "")}>{content}</div>
            </div>
        </div>,
        portalHost()
    );
}
