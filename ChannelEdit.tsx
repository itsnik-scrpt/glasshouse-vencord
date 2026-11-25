/*
 * Channel editor for the hub: create, rename, delete and reorder channels and categories,
 * and drag channels between categories. Every change goes to Discord straight away,
 * and delete asks first.
 */

import {
    Alerts,
    ChannelStore,
    GuildChannelStore,
    GuildStore,
    PermissionsBits,
    PermissionStore,
    RestAPI,
    showToast,
    useState
} from "@webpack/common";

import { I, Icon, safe, useStores } from "./Hub";

const isVoice = (c: any) => c.type === 2 || c.type === 13;
const iconFor = (c: any) => c.type === 2 ? I.voice : c.type === 13 ? I.stage : c.type === 5 ? I.announce : c.type === 15 ? I.forum : I.hash;

export function canEditChannels(guildId: string): boolean {
    const guild = GuildStore.getGuild(guildId);
    return !!guild && safe(() => PermissionStore.can(PermissionsBits.MANAGE_CHANNELS, guild as any), false);
}

export function ChannelEdit({ guildId, onDone }: { guildId: string; onDone(): void; }) {
    useStores([GuildChannelStore, ChannelStore], 250);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [adding, setAdding] = useState<{ parent: string | null; type: number; } | null>(null);
    const [newName, setNewName] = useState("");
    const [dragId, setDragId] = useState<string | null>(null);

    const data: any = safe<any>(() => GuildChannelStore.getChannels(guildId), {});
    const all: any[] = [...(data.SELECTABLE ?? []), ...(data.VOCAL ?? [])]
        .map((e: any) => e.channel)
        .filter((c: any) => c && c.type !== 4 && !c.isThread?.());
    const categories: any[] = (data[4] ?? [])
        .map((e: any) => e.channel)
        .filter((c: any) => c && c.id && c.id !== "null")
        .sort((a: any, b: any) => a.position - b.position);

    const byParent: Record<string, any[]> = {};
    for (const c of all) (byParent[c.parent_id ?? "none"] ??= []).push(c);
    for (const list of Object.values(byParent)) {
        list.sort((a, b) => (Number(isVoice(a)) - Number(isVoice(b))) || (a.position - b.position));
    }

    /* ── calls ── */

    const call = async (label: string, fn: () => Promise<any>) => {
        try {
            await fn();
            showToast({ text: label, variant: "success" });
        } catch (e: any) {
            showToast({ text: `Failed: ${e?.body?.message ?? e?.message ?? "unknown error"}`, variant: "critical" });
        }
    };

    const rename = (c: any) => {
        const next = name.trim();
        setRenaming(null);
        if (!next || next === c.name) return;
        call(`Renamed to ${next}`, () => RestAPI.patch({ url: `/channels/${c.id}`, body: { name: next } } as any));
    };

    const remove = (c: any) => {
        const isCategory = c.type === 4;
        Alerts.show({
            title: `Delete ${isCategory ? "category" : "channel"} “${c.name}”?`,
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
            body: { name: next, type, ...(parent && type !== 4 ? { parent_id: parent } : {}) }
        } as any));
    };

    /** Put a channel into a category (or none), before another channel or at the end. */
    const move = (id: string, parent: string | null, beforeId: string | null) => {
        const dragged = all.find(c => c.id === id);
        if (!dragged || id === beforeId) return;
        const siblings = (byParent[parent ?? "none"] ?? []).filter(c => isVoice(c) === isVoice(dragged) && c.id !== id);
        let index = beforeId ? siblings.findIndex(c => c.id === beforeId) : -1;
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
        : <span className="gh-channel-name" onDoubleClick={() => { setRenaming(c.id); setName(c.name); }}>{c.name}</span>;

    const rowTools = (c: any) => (
        <>
            <button className="gh-tool" aria-label="Rename" onClick={() => { setRenaming(c.id); setName(c.name); }}><Icon d={I.edit} size={14} /></button>
            <button className="gh-tool gh-danger" aria-label="Delete" onClick={() => remove(c)}><Icon d={I.trash} size={14} /></button>
        </>
    );

    const channelRow = (c: any, parent: string | null) => (
        <div key={c.id}
            className={"gh-ce-row" + (dragId === c.id ? " gh-dragging" : "")}
            draggable={renaming !== c.id}
            onDragStart={e => { e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; setDragId(c.id); }}
            onDragEnd={() => setDragId(null)}
            {...drop(parent, c.id)}>
            <Icon d={I.grip} size={14} />
            <Icon d={iconFor(c)} size={15} />
            {nameField(c)}
            {rowTools(c)}
        </div>
    );

    const addForm = (parent: string | null, type: number) =>
        adding && adding.parent === parent && (adding.type === 4) === (type === 4) ? (
            <div className="gh-ce-add">
                {type !== 4 && (
                    <div className="gh-segment">
                        <button className={adding.type === 0 ? "gh-on" : ""} onClick={() => setAdding({ parent, type: 0 })}>Text</button>
                        <button className={adding.type === 2 ? "gh-on" : ""} onClick={() => setAdding({ parent, type: 2 })}>Voice</button>
                    </div>
                )}
                <input autoFocus className="gh-ce-input" value={newName} maxLength={100}
                    placeholder={type === 4 ? "Category name" : "Channel name"}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") create(); if (e.key === "Escape") setAdding(null); }} />
                <button className="gh-tool gh-on" aria-label="Create" onClick={create}><Icon d={I.plus} size={16} /></button>
                <button className="gh-tool" aria-label="Cancel" onClick={() => setAdding(null)}><Icon d={I.x} size={14} /></button>
            </div>
        ) : null;

    const addButton = (parent: string | null) => (
        <button className="gh-ce-new" onClick={() => { setAdding({ parent, type: 0 }); setNewName(""); }}>
            <Icon d={I.plus} size={14} /> Add channel
        </button>
    );

    return (
        <div className="gh-channels gh-ce">
            <div className="gh-ce-bar">
                <strong>Editing channels</strong>
                <button className="gh-ce-done" onClick={onDone}>Done</button>
            </div>
            <p className="gh-hint">Drag to move. Double-click a name to rename. Changes apply to the server immediately.</p>

            <section className="gh-ce-cat" {...drop(null, null)}>
                <div className="gh-cat-head gh-static"><span>No category</span></div>
                {(byParent.none ?? []).map(c => channelRow(c, null))}
                {addForm(null, 0) ?? addButton(null)}
            </section>

            {categories.map((cat, index) => (
                <section key={cat.id} className="gh-ce-cat" {...drop(cat.id, null)}>
                    <div className="gh-ce-row gh-ce-head">
                        {renaming === cat.id
                            ? nameField(cat)
                            : <span className="gh-channel-name gh-ce-catname" onDoubleClick={() => { setRenaming(cat.id); setName(cat.name); }}>{cat.name}</span>}
                        <button className="gh-tool" disabled={index === 0} aria-label="Move category up" onClick={() => shiftCategory(cat.id, -1)}><Icon d={I.up} size={14} /></button>
                        <button className="gh-tool" disabled={index === categories.length - 1} aria-label="Move category down" onClick={() => shiftCategory(cat.id, 1)}><Icon d={I.chevron} size={14} /></button>
                        {rowTools(cat)}
                    </div>
                    {(byParent[cat.id] ?? []).map(c => channelRow(c, cat.id))}
                    {addForm(cat.id, 0) ?? addButton(cat.id)}
                </section>
            ))}

            {addForm(null, 4) ?? (
                <button className="gh-ce-new gh-ce-newcat" onClick={() => { setAdding({ parent: null, type: 4 }); setNewName(""); }}>
                    <Icon d={I.plus} size={14} /> Add category
                </button>
            )}
        </div>
    );
}
