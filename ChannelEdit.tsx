/*
 * Channel editor for the hub: create, rename, delete and reorder channels and categories,
 * drag channels between categories, and change a channel's details (kind, topic, slow mode,
 * voice limits). Right-click any row for every action on it. Each change goes to Discord
 * straight away, and delete asks first.
 */

import { copyWithToast } from "@utils/discord";
import {
    Alerts,
    ChannelStore,
    GuildChannelStore,
    GuildStore,
    PermissionsBits,
    PermissionStore,
    ReactDOM,
    RestAPI,
    showToast,
    useEffect,
    useLayoutEffect,
    useRef,
    useState
} from "@webpack/common";

import { I, Icon, safe, useStores } from "./Hub";
import { portalHost } from "./settings";

const TEXT = 0, VOICE = 2, CATEGORY = 4, NEWS = 5, STAGE = 13, FORUM = 15, MEDIA = 16;
const VIEW = 1n << 10n;

const isVoice = (c: any) => c.type === VOICE || c.type === STAGE;
const iconFor = (type: number) => type === VOICE ? I.voice : type === STAGE ? I.stage : type === NEWS ? I.announce : type === FORUM || type === MEDIA ? I.forum : I.hash;
const kindName = (type: number) => type === CATEGORY ? "category" : "channel";

/** What can be made with the add form. The last three only exist in Community servers. */
const KINDS: [number, string, boolean][] = [
    [TEXT, "Text", false],
    [VOICE, "Voice", false],
    [FORUM, "Forum", true],
    [NEWS, "Announcement", true],
    [STAGE, "Stage", true]
];

const SLOW: [number, string][] = [
    [0, "Off"], [5, "5 seconds"], [10, "10 seconds"], [15, "15 seconds"], [30, "30 seconds"],
    [60, "1 minute"], [120, "2 minutes"], [300, "5 minutes"], [600, "10 minutes"], [900, "15 minutes"],
    [1800, "30 minutes"], [3600, "1 hour"], [7200, "2 hours"], [21600, "6 hours"]
];
const ARCHIVE: [number, string][] = [[60, "1 hour"], [1440, "1 day"], [4320, "3 days"], [10080, "1 week"]];

/** Discord keeps some fields in camelCase and some as the API sends them. */
const field = (c: any, camel: string, snake: string, fallback: any) => c?.[camel] ?? c?.[snake] ?? fallback;

const overwrites = (c: any) => Object.values(c?.permissionOverwrites ?? {}).map((o: any) => ({
    id: o.id, type: o.type, allow: String(o.allow ?? 0), deny: String(o.deny ?? 0)
}));

const big = (v: any) => safe(() => BigInt(v ?? 0), 0n);
const isPrivate = (c: any, guildId: string) => (big(c?.permissionOverwrites?.[guildId]?.deny) & VIEW) === VIEW;

function hasFeature(guildId: string, name: string): boolean {
    const features: any = (GuildStore.getGuild(guildId) as any)?.features;
    return !!features && safe(() => features.has ? features.has(name) : features.includes(name), false);
}

function maxBitrate(guildId: string, type: number): number {
    if (type === STAGE) return 64;
    if (hasFeature(guildId, "VIP_REGIONS")) return 384;
    return [96, 128, 256, 384][(GuildStore.getGuild(guildId) as any)?.premiumTier ?? 0] ?? 96;
}

export function canEditChannels(guildId: string): boolean {
    const guild = GuildStore.getGuild(guildId);
    return !!guild && safe(() => PermissionStore.can(PermissionsBits.MANAGE_CHANNELS, guild as any), false);
}

/* ───────────── right-click menu ───────────── */

export type Entry = { label: string; icon?: string; danger?: boolean; on?: boolean; keep?: boolean; run(): void; } | "line";

export function Menu({ x, y, title, entries, onClose }: { x: number; y: number; title: string; entries: Entry[]; onClose(): void; }) {
    const ref = useRef<HTMLDivElement>(null);
    const [at, setAt] = useState({ left: x, top: y });

    // keep the whole menu on screen
    useLayoutEffect(() => {
        const box = ref.current?.getBoundingClientRect();
        if (!box) return;
        setAt({
            left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)),
            top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8))
        });
    }, [x, y, entries.length]);

    useEffect(() => {
        const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
        const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        document.addEventListener("mousedown", down, true);
        document.addEventListener("keydown", key, true);
        window.addEventListener("resize", onClose);
        window.addEventListener("blur", onClose);
        return () => {
            document.removeEventListener("mousedown", down, true);
            document.removeEventListener("keydown", key, true);
            window.removeEventListener("resize", onClose);
            window.removeEventListener("blur", onClose);
        };
    }, []);

    return ReactDOM.createPortal(
        <div ref={ref} className="gh-cmenu" style={at} onContextMenu={e => e.preventDefault()}>
            <header>{title}</header>
            {entries.map((e, i) => e === "line"
                ? <hr key={i} />
                : (
                    <button key={i} className={"gh-cmenu-row" + (e.danger ? " gh-danger" : "")}
                        onClick={() => { e.run(); if (!e.keep) onClose(); }}>
                        {e.icon && <Icon d={e.icon} size={15} />}
                        <span>{e.label}</span>
                        {e.on !== undefined && <i className={"gh-switch" + (e.on ? " gh-on" : "")} />}
                    </button>
                ))}
        </div>,
        portalHost()
    );
}

/* ───────────── details of one channel ───────────── */

function Details({ c, guildId, onSave, onClose }: { c: any; guildId: string; onSave(body: any): void; onClose(): void; }) {
    const start = {
        type: c.type as number,
        topic: field(c, "topic", "topic", "") as string,
        nsfw: !!field(c, "nsfw", "nsfw", false),
        slow: field(c, "rateLimitPerUser", "rate_limit_per_user", 0) as number,
        archive: field(c, "defaultAutoArchiveDuration", "default_auto_archive_duration", 4320) as number,
        limit: field(c, "userLimit", "user_limit", 0) as number,
        bitrate: Math.round(field(c, "bitrate", "bitrate", 64000) / 1000),
        video: field(c, "videoQualityMode", "video_quality_mode", 1) as number
    };
    const [v, setV] = useState(start);
    const set = (patch: Partial<typeof start>) => setV(old => ({ ...old, ...patch }));

    const written = c.type === TEXT || c.type === NEWS || c.type === FORUM || c.type === MEDIA;
    const canSwitch = (c.type === TEXT || c.type === NEWS) && (hasFeature(guildId, "COMMUNITY") || hasFeature(guildId, "NEWS"));
    const top = maxBitrate(guildId, c.type);
    const topicMax = c.type === FORUM || c.type === MEDIA ? 4096 : 1024;

    const save = () => {
        const body: any = {};
        if (v.type !== start.type) body.type = v.type;
        if (v.topic !== start.topic) body.topic = v.topic.trim();
        if (v.nsfw !== start.nsfw) body.nsfw = v.nsfw;
        if (v.slow !== start.slow) body.rate_limit_per_user = v.slow;
        if (v.archive !== start.archive) body.default_auto_archive_duration = v.archive;
        if (v.limit !== start.limit) body.user_limit = Math.max(0, Math.min(c.type === STAGE ? 10000 : 99, v.limit || 0));
        if (v.bitrate !== start.bitrate) body.bitrate = Math.max(8, Math.min(top, v.bitrate)) * 1000;
        if (v.video !== start.video) body.video_quality_mode = v.video;
        if (Object.keys(body).length) onSave(body);
        onClose();
    };

    const pick = (value: number, options: [number, string][], onPick: (n: number) => void) => (
        <select className="gh-ce-select" value={value} onChange={e => onPick(Number(e.target.value))}>
            {!options.some(o => o[0] === value) && <option value={value}>{value} seconds</option>}
            {options.map(([n, label]) => <option key={n} value={n}>{label}</option>)}
        </select>
    );

    return (
        <div className="gh-ce-details" onKeyDown={e => { if (e.key === "Escape") onClose(); }}>
            {canSwitch && (
                <div className="gh-ce-field">
                    <span>Kind</span>
                    <div className="gh-segment">
                        <button className={v.type === TEXT ? "gh-on" : ""} onClick={() => set({ type: TEXT })}>Text</button>
                        <button className={v.type === NEWS ? "gh-on" : ""} onClick={() => set({ type: NEWS })}>Announcement</button>
                    </div>
                </div>
            )}
            {written && (
                <div className="gh-ce-field gh-ce-tall">
                    <span>{c.type === FORUM || c.type === MEDIA ? "Guidelines" : "Topic"}</span>
                    <textarea value={v.topic} maxLength={topicMax} rows={2} placeholder="What this channel is for"
                        onChange={e => set({ topic: e.target.value })} />
                </div>
            )}
            {(c.type === TEXT || c.type === FORUM || c.type === MEDIA || c.type === VOICE) && v.type !== NEWS && (
                <div className="gh-ce-field"><span>Slow mode</span>{pick(v.slow, SLOW, slow => set({ slow }))}</div>
            )}
            {written && (
                <div className="gh-ce-field"><span>Hide quiet threads after</span>{pick(v.archive, ARCHIVE, archive => set({ archive }))}</div>
            )}
            {c.type === VOICE && (
                <div className="gh-ce-field">
                    <span>People limit</span>
                    <input className="gh-ce-input gh-ce-num" type="number" min={0} max={99} value={v.limit || ""} placeholder="None"
                        onChange={e => set({ limit: Number(e.target.value) || 0 })} />
                </div>
            )}
            {isVoice(c) && (
                <div className="gh-ce-field">
                    <span>Sound quality</span>
                    <input type="range" min={8} max={top} step={8} value={Math.min(top, v.bitrate)}
                        onChange={e => set({ bitrate: Number(e.target.value) })} />
                    <b>{Math.min(top, v.bitrate)} kbps</b>
                </div>
            )}
            {c.type === VOICE && (
                <div className="gh-ce-field">
                    <span>Video</span>
                    <div className="gh-segment">
                        <button className={v.video === 1 ? "gh-on" : ""} onClick={() => set({ video: 1 })}>Auto</button>
                        <button className={v.video === 2 ? "gh-on" : ""} onClick={() => set({ video: 2 })}>720p</button>
                    </div>
                </div>
            )}
            <button className="gh-ce-check" onClick={() => set({ nsfw: !v.nsfw })}>
                <span>Age-restricted</span>
                <i className={"gh-switch" + (v.nsfw ? " gh-on" : "")} />
            </button>
            <div className="gh-ce-actions">
                <button onClick={onClose}>Cancel</button>
                <button className="gh-on" onClick={save}>Save</button>
            </div>
        </div>
    );
}

/* ───────────── the editor ───────────── */

export function ChannelEdit({ guildId, onDone }: { guildId: string; onDone(): void; }) {
    useStores([GuildChannelStore, ChannelStore, GuildStore], 250);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [adding, setAdding] = useState<{ parent: string | null; type: number; } | null>(null);
    const [newName, setNewName] = useState("");
    const [dragId, setDragId] = useState<string | null>(null);
    const [detail, setDetail] = useState<string | null>(null);
    const [menu, setMenu] = useState<{ id: string; x: number; y: number; moving?: boolean; } | null>(null);

    const data: any = safe<any>(() => GuildChannelStore.getChannels(guildId), {});
    const all: any[] = [...(data.SELECTABLE ?? []), ...(data.VOCAL ?? [])]
        .map((e: any) => e.channel)
        .filter((c: any) => c && c.type !== CATEGORY && !c.isThread?.());
    const categories: any[] = (data[CATEGORY] ?? [])
        .map((e: any) => e.channel)
        .filter((c: any) => c && c.id && c.id !== "null")
        .sort((a: any, b: any) => a.position - b.position);

    const byParent: Record<string, any[]> = {};
    for (const c of all) (byParent[c.parent_id ?? "none"] ??= []).push(c);
    for (const list of Object.values(byParent)) {
        list.sort((a, b) => (Number(isVoice(a)) - Number(isVoice(b))) || (a.position - b.position));
    }
    const community = hasFeature(guildId, "COMMUNITY");

    /* ── calls ── */

    const call = async (label: string, fn: () => Promise<any>) => {
        try {
            await fn();
            showToast({ text: label, variant: "success" });
        } catch (e: any) {
            showToast({ text: `Failed: ${e?.body?.message ?? e?.message ?? "unknown error"}`, variant: "critical" });
        }
    };

    const patch = (c: any, body: any, label: string) =>
        call(label, () => RestAPI.patch({ url: `/channels/${c.id}`, body } as any));

    const startRename = (c: any) => { setRenaming(c.id); setName(c.name); };

    const rename = (c: any) => {
        const next = name.trim();
        setRenaming(null);
        if (!next || next === c.name) return;
        patch(c, { name: next }, `Renamed to ${next}`);
    };

    const remove = (c: any) => {
        const isCategory = c.type === CATEGORY;
        Alerts.show({
            title: `Delete ${kindName(c.type)} “${c.name}”?`,
            body: isCategory
                ? "The channels inside it are kept and move out of the category. This cannot be undone."
                : "Its messages are deleted with it. This cannot be undone.",
            confirmText: "Delete",
            cancelText: "Cancel",
            onConfirm: () => call(`Deleted ${c.name}`, () => RestAPI.del({ url: `/channels/${c.id}` } as any))
        } as any);
    };

    const create = () => {
        const next = newName.trim();
        if (!adding || !next) return setAdding(null);
        const { parent, type } = adding;
        setAdding(null);
        setNewName("");
        call(`Created ${next}`, () => RestAPI.post({
            url: `/guilds/${guildId}/channels`,
            body: { name: next, type, ...(parent && type !== CATEGORY ? { parent_id: parent } : {}) }
        } as any));
    };

    /** A copy with the same settings and permissions, placed in the same category. */
    const duplicate = (c: any) => {
        const body: any = { name: c.name, type: c.type, permission_overwrites: overwrites(c) };
        if (c.parent_id) body.parent_id = c.parent_id;
        for (const [camel, snake] of [["topic", "topic"], ["nsfw", "nsfw"], ["rateLimitPerUser", "rate_limit_per_user"], ["bitrate", "bitrate"], ["userLimit", "user_limit"]]) {
            const value = field(c, camel, snake, null);
            if (value !== null && value !== "") body[snake] = value;
        }
        call(`Duplicated ${c.name}`, () => RestAPI.post({ url: `/guilds/${guildId}/channels`, body } as any));
    };

    /** Hide the channel from everyone without a role or name on its list, or show it again. */
    const setPrivate = (c: any, on: boolean) => {
        const now = c.permissionOverwrites?.[guildId];
        const allow = big(now?.allow) & ~VIEW;
        const deny = on ? big(now?.deny) | VIEW : big(now?.deny) & ~VIEW;
        call(on ? `${c.name} is now private` : `${c.name} is now open to everyone`, () => RestAPI.put({
            url: `/channels/${c.id}/permissions/${guildId}`,
            body: { type: 0, allow: String(allow), deny: String(deny) }
        } as any));
    };

    const syncWithCategory = (c: any) => {
        const parent = categories.find(cat => cat.id === c.parent_id);
        if (parent) patch(c, { permission_overwrites: overwrites(parent) }, `${c.name} now matches ${parent.name}`);
    };

    /** Put a channel into a category (or none), before another channel or at the end. */
    const move = (id: string, parent: string | null, beforeId: string | null, first = false) => {
        const dragged = all.find(c => c.id === id);
        if (!dragged || id === beforeId) return;
        const siblings = (byParent[parent ?? "none"] ?? []).filter(c => isVoice(c) === isVoice(dragged) && c.id !== id);
        let index = first ? 0 : beforeId ? siblings.findIndex(c => c.id === beforeId) : -1;
        if (index < 0) index = siblings.length;
        siblings.splice(index, 0, dragged);
        const body = siblings.map((c, position) => ({
            id: c.id,
            position,
            ...(c.id === id ? { parent_id: parent, lock_permissions: false } : {})
        }));
        call(`Moved ${dragged.name}`, () => RestAPI.patch({ url: `/guilds/${guildId}/channels`, body } as any));
    };

    const shiftCategory = (id: string, by: number) => {
        const i = categories.findIndex(c => c.id === id);
        const j = i + by;
        if (i < 0 || j < 0 || j >= categories.length) return;
        const order = [...categories];
        [order[i], order[j]] = [order[j], order[i]];
        const body = order.map((c, position) => ({ id: c.id, position }));
        call(`Moved ${categories[i].name}`, () => RestAPI.patch({ url: `/guilds/${guildId}/channels`, body } as any));
    };

    /* ── right-click ── */

    const openMenu = (e: any, c: any) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ id: c.id, x: e.clientX, y: e.clientY });
    };

    const menuEntries = (c: any, moving: boolean): Entry[] => {
        const hidden = isPrivate(c, guildId);
        if (c.type === CATEGORY) {
            const i = categories.findIndex(cat => cat.id === c.id);
            return [
                { label: "Rename", icon: I.edit, run: () => startRename(c) },
                { label: "Add a channel here", icon: I.plus, run: () => { setAdding({ parent: c.id, type: TEXT }); setNewName(""); } },
                "line",
                ...(i > 0 ? [{ label: "Move up", icon: I.up, run: () => shiftCategory(c.id, -1) }] : []),
                ...(i < categories.length - 1 ? [{ label: "Move down", icon: I.down, run: () => shiftCategory(c.id, 1) }] : []),
                { label: "Private", icon: I.lock, on: hidden, run: () => setPrivate(c, !hidden) },
                "line",
                { label: "Copy ID", icon: I.copy, run: () => copyWithToast(c.id, "Copied the ID") },
                { label: "Delete category", icon: I.trash, danger: true, run: () => remove(c) }
            ] as Entry[];
        }
        if (moving) {
            return [
                { label: "Back", icon: I.back, keep: true, run: () => setMenu(m => m && { ...m, moving: false }) },
                "line",
                ...[{ id: null, name: "No category" }, ...categories]
                    .filter(cat => cat.id !== (c.parent_id ?? null))
                    .map(cat => ({ label: cat.name, run: () => move(c.id, cat.id, null) }))
            ] as Entry[];
        }
        return [
            { label: "Edit details", icon: I.sliders, run: () => setDetail(c.id) },
            { label: "Rename", icon: I.edit, run: () => startRename(c) },
            { label: "Duplicate", icon: I.copy, run: () => duplicate(c) },
            "line",
            { label: "Move to a category", icon: I.rows, keep: true, run: () => setMenu(m => m && { ...m, moving: true }) },
            { label: "Move to the top", icon: I.up, run: () => move(c.id, c.parent_id ?? null, null, true) },
            { label: "Move to the bottom", icon: I.down, run: () => move(c.id, c.parent_id ?? null, null) },
            "line",
            { label: "Private", icon: I.lock, on: hidden, run: () => setPrivate(c, !hidden) },
            ...(c.parent_id ? [{ label: "Match the category's permissions", icon: I.retry, run: () => syncWithCategory(c) }] : []),
            "line",
            { label: "Copy link", icon: I.link, run: () => copyWithToast(`https://discord.com/channels/${guildId}/${c.id}`, "Copied the link") },
            { label: "Copy ID", icon: I.copy, run: () => copyWithToast(c.id, "Copied the ID") },
            { label: "Delete channel", icon: I.trash, danger: true, run: () => remove(c) }
        ] as Entry[];
    };

    const menuFor = menu ? all.find(c => c.id === menu.id) ?? categories.find(c => c.id === menu.id) : null;

    /* ── pieces ── */

    const drop = (parent: string | null, beforeId: string | null) => ({
        onDragOver: (e: any) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add("gh-drop"); },
        onDragLeave: (e: any) => e.currentTarget.classList.remove("gh-drop"),
        onDrop: (e: any) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.classList.remove("gh-drop");
            const id = e.dataTransfer.getData("text/plain");
            if (id) move(id, parent, beforeId);
        }
    });

    const nameField = (c: any) => renaming === c.id
        ? <input autoFocus className="gh-ce-input" value={name} maxLength={100}
            onChange={e => setName(e.target.value)}
            onBlur={() => rename(c)}
            onKeyDown={e => { if (e.key === "Enter") rename(c); if (e.key === "Escape") setRenaming(null); }} />
        : <span className={"gh-channel-name" + (c.type === CATEGORY ? " gh-ce-catname" : "")} onDoubleClick={() => startRename(c)}>{c.name}</span>;

    const channelRow = (c: any, parent: string | null) => (
        <div key={c.id}>
            <div
                className={"gh-ce-row" + (dragId === c.id ? " gh-dragging" : "") + (detail === c.id || menu?.id === c.id ? " gh-on" : "")}
                draggable={renaming !== c.id}
                onDragStart={e => { e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; setDragId(c.id); }}
                onDragEnd={() => setDragId(null)}
                onContextMenu={e => openMenu(e, c)}
                {...drop(parent, c.id)}>
                <Icon d={I.grip} size={14} />
                <Icon d={iconFor(c.type)} size={15} />
                {nameField(c)}
                {isPrivate(c, guildId) && <span className="gh-ce-lock"><Icon d={I.lock} size={12} /></span>}
                <button className={"gh-tool" + (detail === c.id ? " gh-on" : "")} aria-label="Edit details"
                    onClick={() => setDetail(detail === c.id ? null : c.id)}><Icon d={I.sliders} size={14} /></button>
                <button className="gh-tool gh-danger" aria-label="Delete" onClick={() => remove(c)}><Icon d={I.trash} size={14} /></button>
            </div>
            {detail === c.id && (
                <Details c={c} guildId={guildId} onClose={() => setDetail(null)}
                    onSave={body => patch(c, body, `Saved ${c.name}`)} />
            )}
        </div>
    );

    const addForm = (parent: string | null, type: number) =>
        adding && adding.parent === parent && (adding.type === CATEGORY) === (type === CATEGORY) ? (
            <div className="gh-ce-add">
                {type !== CATEGORY && (
                    <div className="gh-ce-kinds">
                        {KINDS.filter(k => community || !k[2]).map(([kind, label]) => (
                            <button key={kind} className={adding.type === kind ? "gh-on" : ""} onClick={() => setAdding({ parent, type: kind })}>
                                <Icon d={iconFor(kind)} size={13} />{label}
                            </button>
                        ))}
                    </div>
                )}
                <div className="gh-ce-addline">
                    <input autoFocus className="gh-ce-input" value={newName} maxLength={100}
                        placeholder={type === CATEGORY ? "Category name" : "Channel name"}
                        onChange={e => setNewName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") create(); if (e.key === "Escape") setAdding(null); }} />
                    <button className="gh-tool gh-on" aria-label="Create" onClick={create}><Icon d={I.check} size={15} /></button>
                    <button className="gh-tool" aria-label="Cancel" onClick={() => setAdding(null)}><Icon d={I.x} size={14} /></button>
                </div>
            </div>
        ) : null;

    const addButton = (parent: string | null) => (
        <button className="gh-ce-new" onClick={() => { setAdding({ parent, type: TEXT }); setNewName(""); }}>
            <Icon d={I.plus} size={14} /> Add channel
        </button>
    );

    return (
        <div className="gh-channels gh-ce">
            <div className="gh-ce-bar">
                <strong>Editing channels</strong>
                <button className="gh-ce-done" onClick={onDone}>Done</button>
            </div>
            <p className="gh-hint">Drag to move. Double-click a name to rename. Right-click for everything else. Changes apply to the server immediately.</p>

            <section className="gh-ce-cat" {...drop(null, null)}>
                <div className="gh-cat-head gh-static"><span>No category</span></div>
                {(byParent.none ?? []).map(c => channelRow(c, null))}
                {addForm(null, TEXT) ?? addButton(null)}
            </section>

            {categories.map((cat, index) => (
                <section key={cat.id} className="gh-ce-cat" {...drop(cat.id, null)}>
                    <div className={"gh-ce-row gh-ce-head" + (menu?.id === cat.id ? " gh-on" : "")} onContextMenu={e => openMenu(e, cat)}>
                        {nameField(cat)}
                        {isPrivate(cat, guildId) && <span className="gh-ce-lock"><Icon d={I.lock} size={12} /></span>}
                        <button className="gh-tool" disabled={index === 0} aria-label="Move category up" onClick={() => shiftCategory(cat.id, -1)}><Icon d={I.up} size={14} /></button>
                        <button className="gh-tool" disabled={index === categories.length - 1} aria-label="Move category down" onClick={() => shiftCategory(cat.id, 1)}><Icon d={I.down} size={14} /></button>
                        <button className="gh-tool gh-danger" aria-label="Delete" onClick={() => remove(cat)}><Icon d={I.trash} size={14} /></button>
                    </div>
                    {(byParent[cat.id] ?? []).map(c => channelRow(c, cat.id))}
                    {addForm(cat.id, TEXT) ?? addButton(cat.id)}
                </section>
            ))}

            {addForm(null, CATEGORY) ?? (
                <button className="gh-ce-new gh-ce-newcat" onClick={() => { setAdding({ parent: null, type: CATEGORY }); setNewName(""); }}>
                    <Icon d={I.plus} size={14} /> Add category
                </button>
            )}

            {menu && menuFor && (
                <Menu key={menu.id + (menu.moving ? "m" : "")} x={menu.x} y={menu.y} title={menuFor.name}
                    entries={menuEntries(menuFor, !!menu.moving)} onClose={() => setMenu(null)} />
            )}
        </div>
    );
}
