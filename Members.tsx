/*
 * Custom member list (replaces Discord's right-hand list in servers) and the
 * moderation actions shared with the member finder drawer.
 *
 * Discord's own list stays mounted but hidden underneath: it is what asks the server
 * for more members as you scroll, so this list mirrors its scroll position onto it.
 */

import * as DataStore from "@api/DataStore";
import { copyWithToast, openPrivateChannel, openUserProfile } from "@utils/discord";
import {
    Alerts,
    ChannelMemberStore,
    FluxDispatcher,
    GuildMemberStore,
    GuildStore,
    IconUtils,
    PermissionsBits,
    PermissionStore,
    PresenceStore,
    RestAPI,
    SelectedChannelStore,
    SelectedGuildStore,
    showToast,
    useEffect,
    useRef,
    UserStore,
    useState
} from "@webpack/common";

import { memberContext } from "./context";
import { I, Icon, matches, safe, useStores } from "./Hub";
import { settings } from "./settings";

const TIMEOUTS: [string, number][] = [["10m", 600], ["1h", 3600], ["1d", 86400], ["1w", 604800]];
const COLLAPSED_ROLES_KEY = "Glasshouse_collapsedRoles";
const ROW = 44;

/* ───────────── moderation actions ───────────── */

export function MemberActions({ guildId, user, member, reason }: { guildId: string; user: any; member: any; reason: string; }) {
    const guild: any = GuildStore.getGuild(guildId);
    const can = (perm: bigint) => safe(() => PermissionStore.canManageUser(perm, user.id, guild), false);
    const canTimeout = can(PermissionsBits.MODERATE_MEMBERS);
    const canKick = can(PermissionsBits.KICK_MEMBERS);
    const canBan = can(PermissionsBits.BAN_MEMBERS);
    const timedOut = member?.communicationDisabledUntil && new Date(member.communicationDisabledUntil).getTime() > Date.now();

    const headers = () => reason.trim() ? { "X-Audit-Log-Reason": encodeURIComponent(reason.trim()) } : undefined;

    const run = async (label: string, fn: () => Promise<any>) => {
        try {
            await fn();
            showToast({ text: label + " done", variant: "success" });
        } catch (e: any) {
            showToast({ text: `${label} failed: ${e?.body?.message ?? e?.message ?? "unknown error"}`, variant: "critical" });
        }
    };

    const timeout = (seconds: number | null, label: string) => run(
        seconds ? `Timeout ${user.username} (${label})` : `Remove timeout for ${user.username}`,
        () => RestAPI.patch({
            url: `/guilds/${guildId}/members/${user.id}`,
            body: { communication_disabled_until: seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null },
            headers: headers()
        } as any)
    );

    const confirm = (title: string, body: string, confirmText: string, action: () => void) =>
        Alerts.show({ title, body, confirmText, cancelText: "Cancel", onConfirm: action } as any);

    const kick = () => confirm(
        `Kick ${user.username}?`,
        `They are removed from ${guild?.name} and can rejoin with an invite.`,
        "Kick",
        () => run(`Kick ${user.username}`, () => RestAPI.del({ url: `/guilds/${guildId}/members/${user.id}`, headers: headers() } as any))
    );

    const ban = () => confirm(
        `Ban ${user.username}?`,
        `They are removed from ${guild?.name} and cannot rejoin until unbanned. No messages are deleted.`,
        "Ban",
        () => run(`Ban ${user.username}`, () => RestAPI.put({
            url: `/guilds/${guildId}/bans/${user.id}`,
            body: { delete_message_seconds: 0 },
            headers: headers()
        } as any))
    );

    return (
        <div className="gh-actions">
            <button onClick={() => openUserProfile(user.id)}>Profile</button>
            {!user.bot && <button onClick={() => openPrivateChannel(user.id)}>Message</button>}
            <button onClick={() => copyWithToast(user.id, "User ID copied")}>Copy ID</button>
            {canTimeout && TIMEOUTS.map(([label, secs]) => (
                <button key={label} onClick={() => timeout(secs, label)}>Timeout {label}</button>
            ))}
            {canTimeout && timedOut && <button onClick={() => timeout(null, "")}>Remove timeout</button>}
            {canKick && <button className="gh-danger" onClick={kick}>Kick</button>}
            {canBan && <button className="gh-danger" onClick={ban}>Ban</button>}
        </div>
    );
}

/* ───────────── member list ───────────── */

type Item =
    | { kind: "group"; id: string; title: string; count: number; index: number; }
    | { kind: "member"; row: any; index: number; }
    | { kind: "blank"; index: number; };

function activityText(row: any): string {
    const acts: any[] = row.activities ?? [];
    const custom = acts.find(a => a.type === 4);
    if (custom?.state) return custom.state;
    const other = acts.find(a => a.type !== 4);
    if (!other) return "";
    const verb = ["Playing", "Streaming", "Listening to", "Watching", "", "Competing in"][other.type] ?? "";
    return `${verb} ${other.name}`.trim();
}

export function MemberList() {
    useStores([ChannelMemberStore, SelectedChannelStore, SelectedGuildStore, GuildMemberStore], 500);
    const s = settings.use(["showActivity"]);
    const [query, setQuery] = useState("");
    const [reason, setReason] = useState("");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [picked, setPicked] = useState<string | null>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const scroller = useRef<HTMLDivElement>(null);
    const frame = useRef(0);

    const guildId = SelectedGuildStore.getGuildId();
    const channelId = SelectedChannelStore.getChannelId();
    const q = query.trim().toLowerCase();

    useEffect(() => {
        DataStore.get(COLLAPSED_ROLES_KEY).then(v => v && setCollapsed(v));
    }, []);

    // New channel: back to the top, nothing selected.
    useEffect(() => {
        setPicked(null);
        setScrollTop(0);
        if (scroller.current) scroller.current.scrollTop = 0;
    }, [guildId, channelId]);

    // Searching also asks Discord for matching members that are not loaded yet.
    useEffect(() => {
        if (!guildId || q.length < 2) return;
        const t = setTimeout(() => {
            safe(() => FluxDispatcher.dispatch({
                type: "GUILD_MEMBERS_REQUEST", guildIds: [guildId], query: q, limit: 30, presences: true
            } as any), null);
        }, 300);
        return () => clearTimeout(t);
    }, [q, guildId]);

    if (!guildId) return null;

    const props: any = safe<any>(() => ChannelMemberStore.getProps(guildId, channelId), null);
    const rows: any[] = props?.rows ?? [];
    const total = (props?.groups ?? []).reduce((sum: number, g: any) => sum + (g.count ?? 0), 0);

    const groupCounts: Record<string, number> = {};
    for (const g of props?.groups ?? []) groupCounts[String(g.id)] = g.count ?? 0;

    /* Flatten Discord's rows into what is visible here. */
    const items: Item[] = [];
    const shown = new Set<string>();
    let groupId = "";
    let groupItem: Item | null = null;
    let groupHasMatch = false;
    for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        if (row?.type === "GROUP") {
            if (q && groupItem && !groupHasMatch) items.pop(); // drop headers with no match
            groupId = String(row.id);
            groupItem = { kind: "group", id: groupId, title: row.title || "Members", count: row.count ?? groupCounts[groupId] ?? 0, index };
            groupHasMatch = false;
            items.push(groupItem);
        } else if (row?.type === "MEMBER" && row.user) {
            if (!q && collapsed[groupId]) continue;
            if (q && !(matches(row.nick, q) || matches(row.user.username, q) || matches(row.user.globalName, q) || row.user.id === q)) continue;
            groupHasMatch = true;
            shown.add(row.user.id);
            items.push({ kind: "member", row, index });
        } else if (!q && !collapsed[groupId]) {
            items.push({ kind: "blank", index }); // not loaded yet
        }
    }
    if (q && groupItem && !groupHasMatch) items.pop();

    // Matches from the whole server that the list has not loaded.
    if (q.length >= 2) {
        const extra = safe(() => GuildMemberStore.getMembers(guildId), [] as any[])
            .map((m: any) => ({ ...m, user: UserStore.getUser(m.userId), status: safe(() => PresenceStore.getStatus(m.userId), "offline") }))
            .filter((m: any) => m.user && !shown.has(m.user.id)
                && (matches(m.nick, q) || matches(m.user.username, q) || matches(m.user.globalName, q) || m.user.id === q))
            .slice(0, 30);
        if (extra.length) {
            items.push({ kind: "group", id: "__more", title: "More matches", count: extra.length, index: -1 });
            for (const row of extra) items.push({ kind: "member", row, index: -1 });
        }
    }

    /* Windowing: only the rows near the viewport are in the DOM. */
    const viewport = scroller.current?.clientHeight || window.innerHeight;
    const first = Math.max(0, Math.floor(scrollTop / ROW) - 6);
    const last = Math.min(items.length, first + Math.ceil(viewport / ROW) + 12);

    const onScroll = (e: any) => {
        const top = e.currentTarget.scrollTop;
        const host = e.currentTarget as HTMLElement;
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
            setScrollTop(top);
            // Mirror the position onto Discord's hidden list so it loads that range.
            const anchor = items[Math.min(items.length - 1, Math.floor(top / ROW))];
            const stock = host.closest('[class*="membersWrap_"]')?.querySelector<HTMLElement>('[class*="members_"]');
            if (stock && anchor && anchor.index >= 0 && rows.length) {
                stock.scrollTop = (anchor.index / rows.length) * stock.scrollHeight;
            }
        });
    };

    const toggleGroup = (id: string) => {
        if (id === "__more") return;
        const next = { ...collapsed, [id]: !collapsed[id] };
        if (!next[id]) delete next[id];
        setCollapsed(next);
        DataStore.set(COLLAPSED_ROLES_KEY, next);
    };

    const pickedRow = picked
        ? (items.find(i => i.kind === "member" && i.row.user.id === picked) as any)?.row
            ?? (() => {
                const user = UserStore.getUser(picked);
                const member = safe(() => GuildMemberStore.getMember(guildId, picked), null as any);
                return user ? { ...member, user, status: safe(() => PresenceStore.getStatus(picked), "offline") } : null;
            })()
        : null;

    const avatar = (row: any, size = 64) =>
        safe(() => (row.avatar && IconUtils.getGuildMemberAvatarURLSimple({ guildId, userId: row.user.id, avatar: row.avatar, size }))
            || IconUtils.getUserAvatarURL(row.user, false, size), "");

    return (
        <div className="gh-mlist">
            <div className="gh-mlist-top">
                <label className="gh-search">
                    <Icon d={I.search} />
                    <input value={query} onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === "Escape" && setQuery("")}
                        placeholder={total ? `Search ${total.toLocaleString()} members` : "Search members"} spellCheck={false} />
                    {query && <button className="gh-tool" onClick={() => setQuery("")} aria-label="Clear"><Icon d={I.x} size={14} /></button>}
                </label>
            </div>

            <div className="gh-mlist-scroll" ref={scroller} onScroll={onScroll}>
                <div style={{ height: items.length * ROW, position: "relative" }}>
                    {items.slice(first, last).map((item, k) => {
                        const style = { transform: `translateY(${(first + k) * ROW}px)` };
                        if (item.kind === "group") {
                            return (
                                <button key={"g" + item.id} style={style}
                                    className={"gh-mrow gh-mgroup" + (collapsed[item.id] && !q ? " gh-collapsed" : "")}
                                    onClick={() => toggleGroup(item.id)}>
                                    {item.id !== "__more" && <Icon d={I.chevron} size={12} />}
                                    <span>{item.title}</span>
                                    <small>{item.count.toLocaleString()}</small>
                                </button>
                            );
                        }
                        if (item.kind === "blank") {
                            return <div key={"b" + item.index} style={style} className="gh-mrow gh-mblank"><i /><b /></div>;
                        }
                        const { row } = item;
                        const sub = s.showActivity ? activityText(row) : "";
                        const status = row.status ?? "offline";
                        return (
                            <button key={"m" + row.user.id} style={style}
                                className={"gh-mrow gh-mmember" + (picked === row.user.id ? " gh-on" : "") + (status === "offline" ? " gh-off" : "")}
                                onClick={() => setPicked(picked === row.user.id ? null : row.user.id)}
                                onDoubleClick={() => openUserProfile(row.user.id)}
                                onContextMenu={e => memberContext(e, row.user.id)}
                                aria-label="Click for actions, double-click for the profile">
                                <span className="gh-avatar">
                                    <img src={avatar(row)} alt="" loading="lazy" decoding="async" draggable={false} />
                                    <i className={"gh-status gh-" + status} />
                                </span>
                                <span className="gh-member-names">
                                    <span style={row.colorString ? { color: row.colorString } : undefined}>
                                        {row.nick || row.user.globalName || row.user.username}
                                        {row.isOwner && <em>owner</em>}
                                        {row.user.bot && <em>app</em>}
                                    </span>
                                    {sub && <small>{sub}</small>}
                                </span>
                            </button>
                        );
                    })}
                </div>
                {!items.length && (
                    <div className="gh-empty">{q ? `Nobody matches “${query}”.` : "No members to show here."}</div>
                )}
            </div>

            {pickedRow && (
                <div className="gh-mcard">
                    <div className="gh-mcard-head">
                        <span className="gh-avatar gh-avatar-lg">
                            <img src={avatar(pickedRow, 128)} alt="" draggable={false} />
                            <i className={"gh-status gh-" + (pickedRow.status ?? "offline")} />
                        </span>
                        <span className="gh-member-names">
                            <span style={pickedRow.colorString ? { color: pickedRow.colorString } : undefined}>
                                {pickedRow.nick || pickedRow.user.globalName || pickedRow.user.username}
                            </span>
                            <small>@{pickedRow.user.username}</small>
                        </span>
                        <button className="gh-tool" onClick={() => setPicked(null)} aria-label="Close"><Icon d={I.x} /></button>
                    </div>
                    <label className="gh-search gh-reason">
                        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for the audit log (optional)" />
                    </label>
                    <MemberActions guildId={guildId} user={pickedRow.user} member={pickedRow} reason={reason} />
                </div>
            )}
        </div>
    );
}
