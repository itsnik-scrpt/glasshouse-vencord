/*
 * Glasshouse hub: custom server list, channel list, DM list, member finder with
 * moderation actions, and a quick settings panel. Rendered by index.tsx inside
 * Discord's sidebar element, replacing the stock server rail and channel list.
 */

import * as DataStore from "@api/DataStore";
import { copyWithToast, openUserProfile } from "@utils/discord";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import {
    ActiveJoinedThreadsStore,
    Alerts,
    ChannelStore,
    FluxDispatcher,
    GuildChannelStore,
    GuildMemberCountStore,
    GuildMemberStore,
    GuildReadStateStore,
    GuildStore,
    IconUtils,
    NavigationRouter,
    PermissionsBits,
    PermissionStore,
    PresenceStore,
    React,
    ReactDOM,
    ReadStateStore,
    RestAPI,
    SelectedChannelStore,
    SelectedGuildStore,
    showToast,
    SortedGuildStore,
    useEffect,
    UserGuildSettingsStore,
    useRef,
    UserStore,
    useState,
    VoiceStateStore
} from "@webpack/common";

import { canEditChannels, ChannelEdit } from "./ChannelEdit";
import { channelContext, guildContext, voiceUserContext } from "./context";
import { MemberActions } from "./Members";
import { ServerMenu } from "./ServerMenu";
import { QuickSettings } from "./QuickSettings";
import { ServerGrid } from "./ServerGrid";
import { apply, portalHost, setBanner, settings } from "./settings";

const PrivateChannelSortStore = findStoreLazy("PrivateChannelSortStore");
const VoiceActions = findByPropsLazy("selectVoiceChannel", "selectChannel");

const COLLAPSED_KEY = "Glasshouse_collapsedCategories";

/* ───────────── helpers ───────────── */

/** Re-render when any of the stores change, at most once per ~120ms. */
export function useStores(stores: any[], ms = 350) {
    const [, tick] = useState(0);
    useEffect(() => {
        let timer: any = null;
        const onChange = () => {
            if (timer) return;
            timer = setTimeout(() => {
                timer = null;
                tick(n => n + 1);
            }, ms);
        };
        for (const s of stores) s?.addChangeListener?.(onChange);
        return () => {
            clearTimeout(timer);
            for (const s of stores) s?.removeChangeListener?.(onChange);
        };
    }, []);
}

export const safe = <T,>(fn: () => T, fallback: T): T => {
    try {
        const v = fn();
        return v ?? fallback;
    } catch {
        return fallback;
    }
};

export const acronym = (name: string) =>
    (name || "?").replace(/'s /g, " ").split(/\s+/).map(w => w[0]).join("").slice(0, 3);

export const matches = (text: string | null | undefined, q: string) =>
    !q || (text ?? "").toLowerCase().includes(q);

/* Icons: plain strokes, drawn on their own. */
export const Icon = ({ d, size = 16 }: { d: string; size?: number; }) => (
    <svg className="gh-ico" width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={d} />
    </svg>
);
export const I = {
    search: "M21 21l-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z",
    hash: "M5 9h14M5 15h14M10 4L8 20M16 4l-2 16",
    voice: "M11 5L6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
    announce: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 8a5 5 0 0 1 0 8M7 14v5",
    forum: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
    stage: "M12 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 20a6 6 0 0 1 12 0M5 6a10 10 0 0 1 14 0",
    chevron: "M6 9l6 6 6-6",
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    rows: "M4 6h16M4 12h16M4 18h16",
    shield: "M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.500-8-9V6l8-3z",
    users: "M16 19a4 4 0 0 0-8 0M12 12a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7zM21 19a4 4 0 0 0-3-3.800M3 19a4 4 0 0 1 3-3.800",
    focus: "M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4",
    sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
    home: "M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1v-8z",
    x: "M6 6l12 12M18 6L6 18",
    thread: "M5 4v9a4 4 0 0 0 4 4h10M15 13l4 4-4 4",
    micOff: "M9 9v2a3 3 0 0 0 5 2.200M15 10V6a3 3 0 0 0-5.700-1.300M6 11a6 6 0 0 0 9.300 5M18 11a6 6 0 0 1-.500 2.400M12 17v4M4 4l16 16",
    deaf: "M5 14v-2a7 7 0 0 1 11.500-5.400M19 12v2M5 14a2 2 0 0 1 2-2h1v6H7a2 2 0 0 1-2-2v-2zM19 14v2a2 2 0 0 1-2 2h-1v-4M4 4l16 16",
    video: "M4 7h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM15 10.500l6-3v9l-6-3",
    bell: "M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7zM10 20a2 2 0 0 0 4 0",
    grip: "M9 6h.010M15 6h.010M9 12h.010M15 12h.010M9 18h.010M15 18h.010",
    quest: "M12 3l2.700 5.600 6.100.900-4.400 4.300 1 6.100L12 17l-5.400 2.900 1-6.100L3.200 9.500l6.100-.900L12 3z",
    shop: "M5 8h14l-1 12H6L5 8zM9 8V6a3 3 0 0 1 6 0v2",
    nitro: "M13 3L5 13h6l-1 8 8-10h-6l1-8z",
    compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.500 8.500l-2 5-5 2 2-5 5-2z",
    up: "M6 15l6-6 6 6",
    plus: "M12 5v14M5 12h14",
    pin: "M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7",
    link: "M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1",
    edit: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
    trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
    friends: "M9 11a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7zM2 20a7 7 0 0 1 14 0M17 11l2 2 4-4"
};

export const Badge = ({ n }: { n: number; }) => n > 0 ? <span className="gh-badge">{n > 99 ? "99+" : n}</span> : null;

/* ───────────── channels ───────────── */

function channelIcon(type: number) {
    switch (type) {
        case 2: return I.voice;
        case 13: return I.stage;
        case 5: return I.announce;
        case 15: case 16: return I.forum;
        default: return I.hash;
    }
}

function Channels({ guildId, query, top }: { guildId: string; query: string; top?: any; }) {
    useStores([GuildChannelStore, ChannelStore, ReadStateStore, SelectedChannelStore, VoiceStateStore, UserGuildSettingsStore, UserStore, ActiveJoinedThreadsStore], 400);
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    // Hovering a channel for a moment shows every active thread in it, joined or not.
    const [hover, setHover] = useState<{ id: string; x: number; y: number; flip: boolean; } | null>(null);
    const hoverTimer = useRef<any>(null);
    const threadsOf = (id: string): any[] => {
        const pick = (rec: Record<string, any>) => Object.values(rec).map((t: any) => t?.channel ?? t).filter((t: any) => t?.id);
        const joined = pick(safe(() => ActiveJoinedThreadsStore.getActiveJoinedThreadsForParent(guildId, id) as any, {}));
        const others = pick(safe(() => ActiveJoinedThreadsStore.getActiveUnjoinedThreadsForParent(guildId, id) as any, {}));
        const seen = new Set<string>();
        return [...joined, ...others]
            .filter(t => !seen.has(t.id) && (seen.add(t.id), true))
            .sort((a, b) => (b.lastMessageId ?? b.id).localeCompare(a.lastMessageId ?? a.id));
    };
    const enterRow = (e: any, id: string) => {
        const r = e.currentTarget.getBoundingClientRect();
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => {
            if (!threadsOf(id).length) return setHover(null);
            const flip = r.right + 300 > window.innerWidth;
            setHover({ id, x: flip ? r.left - 8 : r.right + 8, y: Math.max(8, Math.min(r.top - 8, window.innerHeight - 340)), flip });
        }, 320);
    };
    const leaveRow = () => {
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => setHover(null), 240);
    };
    useEffect(() => () => clearTimeout(hoverTimer.current), []);

    useEffect(() => {
        DataStore.get(COLLAPSED_KEY).then(v => v && setCollapsed(v));
    }, []);

    const toggleCat = (id: string) => {
        const next = { ...collapsed, [id]: !collapsed[id] };
        if (!next[id]) delete next[id];
        setCollapsed(next);
        DataStore.set(COLLAPSED_KEY, next);
    };

    const data: any = safe<any>(() => GuildChannelStore.getChannels(guildId), {});
    const selectedChannel = SelectedChannelStore.getChannelId();

    const all: any[] = [...(data.SELECTABLE ?? []), ...(data.VOCAL ?? [])]
        .map((e: any) => e.channel)
        .filter((c: any) => c && c.type !== 4 && !c.isThread?.());
    const categories: any[] = (data[4] ?? [])
        .map((e: any) => e.channel)
        .filter((c: any) => c && c.id && c.id !== "null");

    const byParent: Record<string, any[]> = {};
    for (const c of all) (byParent[c.parent_id ?? "none"] ??= []).push(c);
    const isVoice = (c: any) => c.type === 2 || c.type === 13;
    for (const list of Object.values(byParent)) {
        list.sort((a, b) => (Number(isVoice(a)) - Number(isVoice(b))) || (a.position - b.position));
    }

    const open = (c: any) => {
        if (isVoice(c)) safe(() => VoiceActions.selectVoiceChannel(c.id), null);
        else NavigationRouter.transitionToGuild(guildId, c.id);
    };

    const row = (c: any) => {
        const joined: Record<string, any> = safe(() => ActiveJoinedThreadsStore.getActiveJoinedRelevantThreadsForParent(guildId, c.id), {});
        const threads: any[] = Object.values(joined).map((t: any) => t.channel).filter(Boolean);
        const openThread: any = selectedChannel ? ChannelStore.getChannel(selectedChannel) : null;
        if (openThread?.parent_id === c.id && openThread.isThread?.() && !threads.some(t => t.id === openThread.id)) threads.push(openThread);
        threads.sort((a, b) => (b.lastMessageId ?? b.id).localeCompare(a.lastMessageId ?? a.id));
        const shownThreads = query ? threads.filter(t => matches(t.name, query)) : threads;
        if (!matches(c.name, query) && !shownThreads.length) return null;
        const threadOn = threads.some(t => t.id === selectedChannel);
        const unread = !isVoice(c) && safe(() => ReadStateStore.hasUnread(c.id), false);
        const mentions = safe(() => ReadStateStore.getMentionCount(c.id), 0);
        const muted = safe(() => UserGuildSettingsStore.isChannelMuted(guildId, c.id), false);
        const voiceStates: Record<string, any> = isVoice(c) ? safe(() => VoiceStateStore.getVoiceStatesForChannel(c.id), {}) : {};
        const voiceIds = Object.keys(voiceStates);
        const inVoice = voiceIds.length;
        const isOn = c.id === selectedChannel;
        // The wrapper carries gh-on / gh-unread too, so a collapsed category keeps showing
        // the open channel, unread ones, and voice channels with people in them.
        return (
            <div key={c.id} className={"gh-chwrap" + (isOn || inVoice || threadOn ? " gh-on" : "") + (unread && !muted ? " gh-unread" : "")}>
                <button
                    className={"gh-channel"
                        + (isOn ? " gh-on" : "")
                        + (unread && !muted ? " gh-unread" : "")
                        + (muted ? " gh-muted" : "")}
                    onClick={() => open(c)}
                    onContextMenu={e => channelContext(e, c.id)}
                    onMouseEnter={e => !isVoice(c) && enterRow(e, c.id)}
                    onMouseLeave={leaveRow}
                    aria-label={c.topic || c.name}
                >
                    <Icon d={channelIcon(c.type)} size={16} />
                    <span className="gh-channel-name">{c.name}</span>
                    {inVoice > 0 && <span className="gh-count">{inVoice}</span>}
                    <Badge n={mentions} />
                </button>
                {shownThreads.length > 0 && (
                    <div className="gh-threads">
                        {shownThreads.map(t => {
                            const tUnread = safe(() => ReadStateStore.hasUnread(t.id), false);
                            return (
                                <button key={t.id}
                                    className={"gh-channel gh-thread" + (t.id === selectedChannel ? " gh-on" : "") + (tUnread ? " gh-unread" : "")}
                                    onClick={() => NavigationRouter.transitionToGuild(guildId, t.id)}
                                    onContextMenu={e => channelContext(e, t.id)}>
                                    <Icon d={I.thread} size={14} />
                                    <span className="gh-channel-name">{t.name}</span>
                                    <Badge n={safe(() => ReadStateStore.getMentionCount(t.id), 0)} />
                                </button>
                            );
                        })}
                    </div>
                )}
                {inVoice > 0 && (
                    <div className="gh-voice-users">
                        {voiceIds.map(uid => {
                            const user: any = UserStore.getUser(uid);
                            if (!user) return null;
                            const vs = voiceStates[uid] ?? {};
                            const member: any = safe(() => GuildMemberStore.getMember(guildId, uid), null);
                            const muted = vs.mute || vs.selfMute;
                            const deaf = vs.deaf || vs.selfDeaf;
                            return (
                                <button key={uid} className="gh-voice-user" onClick={() => openUserProfile(uid)}
                                    onContextMenu={e => voiceUserContext(e, uid)}
                                    aria-label={(deaf ? "Deafened" : muted ? "Muted" : "In voice") + " · click for profile"}>
                                    <img src={safe(() => IconUtils.getUserAvatarURL(user, false, 48), "")} alt="" loading="lazy" draggable={false} />
                                    <span style={member?.colorString ? { color: member.colorString } : undefined}>
                                        {member?.nick || user.globalName || user.username}
                                    </span>
                                    {vs.selfStream && <em>Live</em>}
                                    {vs.selfVideo && <Icon d={I.video} size={13} />}
                                    {deaf ? <Icon d={I.deaf} size={13} /> : muted ? <Icon d={I.micOff} size={13} /> : null}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    };

    const loose = (byParent.none ?? []).map(row);
    const sections = categories
        .sort((a, b) => a.position - b.position)
        .map(cat => {
            const rows = (byParent[cat.id] ?? []).map(row).filter(Boolean);
            if (!rows.length) return null;
            const isCollapsed = !query && collapsed[cat.id];
            // A collapsed category still shows the open channel and anything unread.
            const visible = isCollapsed
                ? rows.filter((r: any) => /gh-on|gh-unread/.test(r.props.className))
                : rows;
            return (
                <section key={cat.id} className={"gh-cat" + (isCollapsed ? " gh-collapsed" : "")}>
                    <button className="gh-cat-head" onClick={() => toggleCat(cat.id)} onContextMenu={e => channelContext(e, cat.id)}>
                        <Icon d={I.chevron} size={12} />
                        <span>{cat.name}</span>
                    </button>
                    {visible}
                </section>
            );
        });

    const any = loose.some(Boolean) || sections.some(Boolean);

    const hoverChannel = hover ? all.find(c => c.id === hover.id) : null;
    const hoverThreads = hover ? threadsOf(hover.id) : [];
    const flyout = hover && hoverChannel && hoverThreads.length > 0 ? ReactDOM.createPortal(
        <div className={"gh-flyout" + (hover.flip ? " gh-flip" : "")} style={{ left: hover.x, top: hover.y }}
            onMouseEnter={() => clearTimeout(hoverTimer.current)} onMouseLeave={leaveRow}>
            <header>
                <Icon d={I.thread} size={14} />
                <strong>{hoverChannel.name}</strong>
                <small>{hoverThreads.length} {hoverThreads.length === 1 ? "thread" : "threads"}</small>
            </header>
            <div className="gh-flyout-list">
                {hoverThreads.map(t => (
                    <button key={t.id}
                        className={"gh-flyout-row" + (t.id === selectedChannel ? " gh-on" : "") + (safe(() => ReadStateStore.hasUnread(t.id), false) ? " gh-unread" : "")}
                        onClick={() => { NavigationRouter.transitionToGuild(guildId, t.id); setHover(null); }}
                        onContextMenu={e => channelContext(e, t.id)}>
                        <span>{t.name}</span>
                        <Badge n={safe(() => ReadStateStore.getMentionCount(t.id), 0)} />
                    </button>
                ))}
            </div>
        </div>,
        portalHost()
    ) : null;
    return (
        <div className="gh-channels" onWheel={e => { if (settings.store.layout === "top") e.currentTarget.scrollLeft += e.deltaY; }}>
            {top}
            {flyout}
            {loose}
            {sections}
            {!any && <div className="gh-empty">{query ? `No channel matches “${query}”.` : "No channels to show."}</div>}
        </div>
    );
}

/* ───────────── direct messages ───────────── */

function DirectMessages({ query, top }: { query: string; top?: any; }) {
    useStores([PrivateChannelSortStore, ChannelStore, ReadStateStore, SelectedChannelStore, PresenceStore, UserStore], 1500);
    const ids: string[] = safe(() => PrivateChannelSortStore.getPrivateChannelIds(), []);
    const selectedChannel = SelectedChannelStore.getChannelId();

    const rows = ids.map(id => {
        const c: any = ChannelStore.getChannel(id);
        if (!c) return null;
        const recipients: any[] = (c.recipients ?? []).map((u: string) => UserStore.getUser(u)).filter(Boolean);
        const name = c.name || recipients.map(u => u.globalName || u.username).join(", ") || "Unknown";
        if (!matches(name, query)) return null;
        const first = recipients[0];
        const avatar = c.type === 1 && first ? safe(() => IconUtils.getUserAvatarURL(first, false, 64), "") : "";
        const status = c.type === 1 && first ? safe(() => PresenceStore.getStatus(first.id), "offline") : null;
        const mentions = safe(() => ReadStateStore.getMentionCount(id), 0);
        return (
            <button
                key={id}
                className={"gh-channel gh-dm" + (id === selectedChannel ? " gh-on" : "") + (mentions ? " gh-unread" : "")}
                onClick={() => NavigationRouter.transitionTo(`/channels/@me/${id}`)}
                onContextMenu={e => channelContext(e, id)}
            >
                <span className="gh-avatar">
                    {avatar ? <img src={avatar} alt="" draggable={false} /> : <span className="gh-acronym">{acronym(name)}</span>}
                    {status && <i className={"gh-status gh-" + status} />}
                </span>
                <span className="gh-channel-name">{name}</span>
                <Badge n={mentions} />
            </button>
        );
    });

    return (
        <div className="gh-channels" onWheel={e => { if (settings.store.layout === "top") e.currentTarget.scrollLeft += e.deltaY; }}>
            {top}
            {!query && (
                <button className={"gh-channel" + (!selectedChannel ? " gh-on" : "")}
                    onClick={() => NavigationRouter.transitionTo("/channels/@me")}>
                    <Icon d={I.friends} size={16} />
                    <span className="gh-channel-name">Friends</span>
                </button>
            )}
            <div className="gh-cat-head gh-static"><span>Direct Messages</span></div>
            {rows}
            {!rows.some(Boolean) && <div className="gh-empty">{query ? `Nobody matches “${query}”.` : "No conversations yet."}</div>}
        </div>
    );
}

/* ───────────── member finder + moderation ───────────── */

function ModDrawer({ guildId, onClose }: { guildId: string; onClose(): void; }) {
    useStores([GuildMemberStore, PresenceStore, UserStore], 800);
    const [query, setQuery] = useState("");
    const [reason, setReason] = useState("");
    const [openId, setOpenId] = useState<string | null>(null);
    const guild: any = GuildStore.getGuild(guildId);
    const q = query.trim().toLowerCase();

    // Ask Discord for members matching the query; results arrive in GuildMemberStore.
    useEffect(() => {
        if (q.length < 2) return;
        const t = setTimeout(() => {
            safe(() => FluxDispatcher.dispatch({
                type: "GUILD_MEMBERS_REQUEST",
                guildIds: [guildId],
                query: q,
                limit: 30,
                presences: true
            } as any), null);
        }, 300);
        return () => clearTimeout(t);
    }, [q, guildId]);

    const members: any[] = safe(() => GuildMemberStore.getMembers(guildId), []);
    const found = members
        .map(m => ({ m, u: UserStore.getUser(m.userId) as any }))
        .filter(({ m, u }) => u && (
            !q || matches(m.nick, q) || matches(u.username, q) || matches(u.globalName, q) || u.id === q
        ))
        .slice(0, 60);

    return ReactDOM.createPortal(
        <aside className="gh-drawer">
            <header className="gh-drawer-head">
                <Icon d={I.shield} size={18} />
                <strong>Members · {guild?.name}</strong>
                <button className="gh-tool" onClick={onClose} aria-label="Close"><Icon d={I.x} /></button>
            </header>
            <label className="gh-search">
                <Icon d={I.search} />
                <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
                    placeholder="Find a member by name or ID" spellCheck={false} />
            </label>
            <label className="gh-search gh-reason">
                <input value={reason} onChange={e => setReason(e.target.value)}
                    placeholder="Reason for the audit log (optional)" />
            </label>
            <div className="gh-members">
                {found.map(({ m, u }, i) => {
                    const status = safe(() => PresenceStore.getStatus(u.id), "offline");
                    const timedOut = m.communicationDisabledUntil && new Date(m.communicationDisabledUntil).getTime() > Date.now();
                    const isOpen = openId === u.id;
                    return (
                        <div key={u.id} className={"gh-member" + (isOpen ? " gh-open" : "")} style={{ "--i": i } as any}>
                            <button className="gh-member-row" onClick={() => setOpenId(isOpen ? null : u.id)}>
                                <span className="gh-avatar">
                                    <img src={safe(() => IconUtils.getUserAvatarURL(u, false, 64), "")} alt="" draggable={false} />
                                    <i className={"gh-status gh-" + status} />
                                </span>
                                <span className="gh-member-names">
                                    <span style={m.colorString ? { color: m.colorString } : undefined}>
                                        {m.nick || u.globalName || u.username}
                                    </span>
                                    <small>@{u.username}{timedOut ? " · timed out" : ""}{u.bot ? " · app" : ""}</small>
                                </span>
                            </button>
                            {isOpen && <MemberActions guildId={guildId} user={u} member={m} reason={reason} />}
                        </div>
                    );
                })}
                {!found.length && (
                    <div className="gh-empty">
                        {q.length >= 2 ? "Searching… nothing found yet." : "Type at least two letters to search every member."}
                    </div>
                )}
            </div>
        </aside>,
        portalHost()
    );
}

/* ───────────── the hub ───────────── */

export function Hub() {
    useStores([SelectedGuildStore, SelectedChannelStore, GuildStore, GuildMemberCountStore, GuildReadStateStore, ReadStateStore]);
    const [, repaint] = useState(0);
    const s = settings.use(["focusMode", "hideMembers", "layout"]);
    const [query, setQuery] = useState("");
    const [mod, setMod] = useState(false);
    const [prefs, setPrefs] = useState(false);
    const [grid, setGrid] = useState(false);
    const [menu, setMenu] = useState(false);
    const [editing, setEditing] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!e.ctrlKey || !e.altKey || e.shiftKey) return;
            const k = e.key.toLowerCase();
            if (k === "s") inputRef.current?.focus();
            else if (k === "d") setMod(v => !v);
            else if (k === "g") setGrid(v => !v);
            else return;
            e.preventDefault();
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
    }, []);

    const guildId = SelectedGuildStore.getGuildId();
    const guild: any = guildId ? GuildStore.getGuild(guildId) : null;

    // The server's banner goes above the member list.
    const bannerHash: string | null = guild?.banner ?? null;
    useEffect(() => {
        if (!guildId || !bannerHash) return setBanner(null);
        const animated = bannerHash.startsWith("a_");
        const host = (window as any).GLOBAL_ENV?.CDN_HOST ?? "cdn.discordapp.com";
        // Animated banners (hash starts with a_) are requested as GIFs so they play.
        setBanner(`https://${host}/banners/${guildId}/${bannerHash}.${animated ? "gif" : "webp"}?size=1024`, guild?.name ?? "");
    }, [guildId, bannerHash, guild?.name]);

    // Leaving a server closes its menu and the channel editor.
    useEffect(() => { setMenu(false); setEditing(false); }, [guildId]);
    const q = query.trim().toLowerCase();
    const count = guildId ? safe(() => GuildMemberCountStore.getMemberCount(guildId), 0) : 0;

    const guildIconUrl = guild?.icon
        ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 96, canAnimate: false })
        : null;
    const otherMentions = Math.max(0,
        safe(() => GuildReadStateStore.getTotalMentionCount(), 0) - (guildId ? safe(() => GuildReadStateStore.getMentionCount(guildId), 0) : 0));

    const flip = (key: "focusMode" | "hideMembers") => {
        settings.store[key] = !settings.store[key];
        apply();
    };

    // Where the pings are: every DM and every server with a mention count, biggest first.
    const dmPings = safe(() => PrivateChannelSortStore.getPrivateChannelIds() as string[], [])
        .map(id => ({ id, n: safe(() => ReadStateStore.getMentionCount(id), 0) }))
        .filter(p => p.n > 0)
        .map(p => {
            const c: any = ChannelStore.getChannel(p.id);
            const users: any[] = (c?.recipients ?? []).map((u: string) => UserStore.getUser(u)).filter(Boolean);
            const name = c?.name || users.map(u => u.globalName || u.username).join(", ") || "Direct message";
            const icon = c?.type === 1 && users[0] ? safe(() => IconUtils.getUserAvatarURL(users[0], false, 64), "") : "";
            return { ...p, name, icon };
        });
    const serverPings = safe(() => SortedGuildStore.getFlattenedGuildIds(), [] as string[])
        .map(id => ({ id, n: safe(() => GuildReadStateStore.getMentionCount(id), 0) }))
        .filter(p => p.n > 0 && p.id !== guildId)
        .map(p => {
            const g: any = GuildStore.getGuild(p.id);
            const icon = g?.icon ? IconUtils.getGuildIconURL({ id: g.id, icon: g.icon, size: 64, canAnimate: false }) ?? "" : "";
            return { ...p, name: g?.name ?? "Server", icon };
        });
    const dmPingTotal = dmPings.reduce((sum, p) => sum + p.n, 0);
    const serverPingTotal = serverPings.reduce((sum, p) => sum + p.n, 0);

    // Discord's own pages, by their routes.
    const path = window.location.pathname;
    const pages: [string, string, string, boolean][] = [
        ["Home", I.home, "/channels/@me", !guildId && path.startsWith("/channels/@me")],
        ["Quests", I.quest, "/quest-home", path.startsWith("/quest-home")],
        ["Shop", I.shop, "/shop", path.startsWith("/shop")],
        ["Nitro", I.nitro, "/store", path.startsWith("/store")],
        ["Discover", I.compass, "/discovery/servers", path.startsWith("/discovery")]
    ];

    // Shown as the first thing inside the scrolling list, so it scrolls away with it
    // instead of staying pinned above your chats.
    const pingStrip = (dmPings.length > 0 || serverPings.length > 0) && (
                <div className="gh-pings">
                    <small>Pings</small>
                    {dmPings.map(p => (
                        <button key={p.id} className="gh-ping" aria-label={`${p.name} · ${p.n} unread`}
                            onClick={() => NavigationRouter.transitionTo(`/channels/@me/${p.id}`)}
                            onContextMenu={e => channelContext(e, p.id)}>
                            <span className="gh-server-icon gh-round">
                                {p.icon ? <img src={p.icon} alt="" draggable={false} /> : <span className="gh-acronym">{acronym(p.name)}</span>}
                                <Badge n={p.n} />
                            </span>
                        </button>
                    ))}
                    {serverPings.map(p => (
                        <button key={p.id} className="gh-ping" aria-label={`${p.name} · ${p.n} ${p.n === 1 ? "ping" : "pings"}`}
                            onClick={() => NavigationRouter.transitionToGuild(p.id)}
                            onContextMenu={e => guildContext(e, p.id)}>
                            <span className="gh-server-icon">
                                {p.icon ? <img src={p.icon} alt="" draggable={false} /> : <span className="gh-acronym">{acronym(p.name)}</span>}
                                <Badge n={p.n} />
                            </span>
                        </button>
                    ))}
                </div>
            );

    return (
        <div className="gh-hub-inner">
            <div className="gh-top">
                <label className="gh-search">
                    <Icon d={I.search} />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === "Escape" && (setQuery(""), e.currentTarget.blur())}
                        placeholder={guildId ? "Search channels" : "Search conversations"}
                        spellCheck={false}
                    />
                    {query && <button className="gh-tool" onClick={() => setQuery("")} aria-label="Clear"><Icon d={I.x} size={14} /></button>}
                </label>
                <nav className="gh-pages">
                    {pages.map(([label, icon, route, on]) => (
                        <button key={route} className={"gh-page" + (on ? " gh-on" : "")} aria-label={label}
                            onClick={() => { NavigationRouter.transitionTo(route); setTimeout(() => repaint(n => n + 1), 60); }}>
                            <span className="gh-page-ico">
                                <Icon d={icon} size={22} />
                                {label === "Home" && <Badge n={dmPingTotal} />}
                            </span>
                            <span>{label}</span>
                        </button>
                    ))}
                </nav>
                <div className="gh-tools">
                    <button className={"gh-tool" + (mod ? " gh-on" : "")} disabled={!guildId} onClick={() => { setPrefs(false); setMod(v => !v); }}
                        aria-label="Find and moderate members (Ctrl+Alt+D)">
                        <Icon d={I.shield} />
                    </button>
                    <button className={"gh-tool" + (!s.hideMembers ? " gh-on" : "")} onClick={() => flip("hideMembers")}
                        aria-label="Members pane (Ctrl+Alt+M)">
                        <Icon d={I.users} />
                    </button>
                    <button className="gh-tool" onClick={() => flip("focusMode")} aria-label="Focus on chat (Ctrl+Alt+F)">
                        <Icon d={I.focus} />
                    </button>
                    <button className={"gh-tool" + (prefs ? " gh-on" : "")} onClick={() => { setMod(false); setPrefs(v => !v); }} aria-label="Glasshouse settings">
                        <Icon d={I.sliders} />
                    </button>
                </div>
            </div>

            <button className="gh-guild-head gh-guild-btn" onClick={() => setGrid(true)}
                onContextMenu={e => guildId && guildContext(e, guildId)} aria-label="All servers (Ctrl+Alt+G)">
                <span className="gh-server-icon">
                    {guildIconUrl
                        ? <img src={guildIconUrl} alt="" draggable={false} />
                        : guild ? <span className="gh-acronym">{acronym(guild.name)}</span> : <Icon d={I.home} size={20} />}
                </span>
                <span className="gh-guild-text">
                    <strong>{guild ? guild.name : "Home"}</strong>
                    <small>{guild && count > 0 ? count.toLocaleString() + " members" : guild ? "Server" : "Direct Messages"}</small>
                </span>
                <Badge n={serverPingTotal} />
                <Icon d={I.grid} size={18} />
            </button>
            {guild && (
                <button className={"gh-guild-menu" + (menu ? " gh-on" : "")} aria-label="Server menu: settings, invites, notifications"
                    onClick={() => setMenu(v => !v)}>
                    <Icon d={I.sliders} size={16} />
                    <span>Server menu</span>
                    <Icon d={I.chevron} size={14} />
                </button>
            )}

            {menu && guildId && (
                <ServerMenu
                    canEditChannels={canEditChannels(guildId)}
                    onEditChannels={() => setEditing(true)}
                    onClose={() => setMenu(false)} />
            )}

            {guildId
                ? editing ? <ChannelEdit guildId={guildId} onDone={() => setEditing(false)} /> : <Channels guildId={guildId} query={q} top={pingStrip} />
                : <DirectMessages query={q} top={pingStrip} />}

            {prefs && <QuickSettings onClose={() => setPrefs(false)} />}
            {grid && <ServerGrid onClose={() => setGrid(false)} />}
            {s.focusMode && ReactDOM.createPortal(
                <button className="gh-focus-exit" onClick={() => flip("focusMode")} aria-label="Exit focus (Ctrl+Alt+F)">
                    <Icon d={I.x} size={14} />
                    <span>Exit focus</span>
                </button>,
                portalHost()
            )}
            {mod && guildId && <ModDrawer guildId={guildId} onClose={() => setMod(false)} />}
        </div>
    );
}
