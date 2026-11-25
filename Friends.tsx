/*
 * Custom friends page. Drawn over Discord's own Friends page (which stays underneath,
 * hidden), with its own layout: an "active now" strip, then friends as a grid of cards.
 */

import { openPrivateChannel, openUserProfile } from "@utils/discord";
import {
    Alerts,
    IconUtils,
    PresenceStore,
    RelationshipStore,
    RestAPI,
    showToast,
    UserStore,
    useState
} from "@webpack/common";

import { I, Icon, matches, safe, useStores } from "./Hub";

type Tab = "online" | "all" | "pending" | "blocked";

const FRIEND = 1, BLOCKED = 2, INCOMING = 3, OUTGOING = 4;
const STATUS_ORDER: Record<string, number> = { online: 0, streaming: 0, idle: 1, dnd: 2, offline: 3, invisible: 3 };
const STATUS_TEXT: Record<string, string> = {
    online: "Online", streaming: "Streaming", idle: "Idle", dnd: "Do Not Disturb", offline: "Offline", invisible: "Offline"
};
const VERBS = ["Playing", "Streaming", "Listening to", "Watching", "", "Competing in"];

interface Person { id: string; user: any; type: number; status: string; line: string; busy: string; act: any; }

function describe(id: string, status: string): { line: string; busy: string; act: any; } {
    const acts: any[] = safe(() => PresenceStore.getActivities(id) as any[], []);
    const custom = acts.find(a => a.type === 4);
    const other = acts.find(a => a.type !== 4) ?? null;
    const busy = other ? `${VERBS[other.type] ?? ""} ${other.name}`.trim() : "";
    return { line: busy || custom?.state || STATUS_TEXT[status] || "Offline", busy, act: other };
}

/** Artwork for an activity: game art, album cover or stream preview, when it has one. */
function artOf(act: any): string | null {
    const image: string | undefined = act?.assets?.large_image ?? act?.assets?.small_image;
    if (!image) return null;
    if (image.startsWith("mp:")) return "https://media.discordapp.net/" + image.slice(3);
    if (image.startsWith("spotify:")) return "https://i.scdn.co/image/" + image.slice(8);
    if (image.startsWith("youtube:")) return `https://i.ytimg.com/vi/${image.slice(8)}/hqdefault.jpg`;
    if (image.startsWith("twitch:")) return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${image.slice(7)}-108x60.jpg`;
    if (act.application_id && /^\d+$/.test(image)) return `https://cdn.discordapp.com/app-assets/${act.application_id}/${image}.png?size=160`;
    return null;
}

/** "12m", "2h 05m": how long the activity has been running. */
function elapsed(act: any): string {
    const start = Number(act?.timestamps?.start);
    if (!start) return "";
    const mins = Math.max(0, Math.floor((Date.now() - start) / 60000));
    return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

export function Friends() {
    useStores([RelationshipStore, PresenceStore, UserStore], 1200);
    const [tab, setTab] = useState<Tab>("online");
    const [query, setQuery] = useState("");
    const [adding, setAdding] = useState(false);
    const [username, setUsername] = useState("");
    const q = query.trim().toLowerCase();

    const relations: [string, number][] = safe(() => Array.from(RelationshipStore.getMutableRelationships().entries()) as any, []);
    const people: Person[] = relations
        .map(([id, type]) => {
            const user: any = UserStore.getUser(id);
            if (!user) return null;
            const status = type === FRIEND ? safe(() => PresenceStore.getStatus(id) as string, "offline") : "offline";
            return { id, user, type, status, ...describe(id, status) };
        })
        .filter(Boolean) as Person[];

    const friends = people.filter(p => p.type === FRIEND);
    const online = friends.filter(p => STATUS_ORDER[p.status] < 3);
    const pending = people.filter(p => p.type === INCOMING || p.type === OUTGOING);
    const blocked = people.filter(p => p.type === BLOCKED);
    const active = online.filter(p => p.busy);

    const nameOf = (p: Person) => safe(() => RelationshipStore.getNickname(p.id), undefined) || p.user.globalName || p.user.username;
    const list = (tab === "online" ? online : tab === "all" ? friends : tab === "pending" ? pending : blocked)
        .filter(p => matches(nameOf(p), q) || matches(p.user.username, q))
        .sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || nameOf(a).localeCompare(nameOf(b)));

    /* ── actions ── */

    const call = async (done: string, fn: () => Promise<any>) => {
        try {
            await fn();
            showToast({ text: done, variant: "success" });
        } catch (e: any) {
            showToast({ text: `Failed: ${e?.body?.message ?? e?.message ?? "unknown error"}`, variant: "critical" });
        }
    };
    const accept = (p: Person) => call(`You and ${nameOf(p)} are now friends`,
        () => RestAPI.put({ url: `/users/@me/relationships/${p.id}`, body: {} } as any));
    const drop = (p: Person, done: string) => call(done,
        () => RestAPI.del({ url: `/users/@me/relationships/${p.id}` } as any));
    const unfriend = (p: Person) => Alerts.show({
        title: `Remove ${nameOf(p)}?`,
        body: "They are removed from your friends list. You can add them again later.",
        confirmText: "Remove friend",
        cancelText: "Cancel",
        onConfirm: () => drop(p, `Removed ${nameOf(p)}`)
    } as any);
    const sendRequest = () => {
        const name = username.trim().replace(/^@/, "");
        if (!name) return;
        setUsername("");
        call(`Friend request sent to ${name}`, () => RestAPI.post({
            url: "/users/@me/relationships", body: { username: name, discriminator: null }
        } as any));
    };

    /* ── pieces ── */

    const avatar = (p: Person, size: number) => (
        <span className="gh-avatar" style={{ width: size, height: size }}>
            <img src={safe(() => IconUtils.getUserAvatarURL(p.user, false, size * 2), "")} alt="" loading="lazy" draggable={false} />
            {p.type === FRIEND && <i className={"gh-status gh-" + p.status} />}
        </span>
    );

    const tabButton = (id: Tab, label: string, count: number) => (
        <button className={"gh-fr-tab" + (tab === id ? " gh-on" : "")} onClick={() => setTab(id)}>
            {label}{count > 0 && <b>{count}</b>}
        </button>
    );

    const card = (p: Person, i: number) => (
        <div key={p.id} className={"gh-fr-card" + (STATUS_ORDER[p.status] === 3 && p.type === FRIEND ? " gh-off" : "")} style={{ "--i": i } as any}>
            <button className="gh-fr-main" aria-label="Open conversation"
                onClick={() => p.type === BLOCKED ? openUserProfile(p.id) : openPrivateChannel(p.id)}>
                {avatar(p, 44)}
                <span className="gh-member-names">
                    <span>{nameOf(p)}</span>
                    <small>{p.type === INCOMING ? "Wants to be friends" : p.type === OUTGOING ? "Request sent" : p.type === BLOCKED ? "Blocked" : p.line}</small>
                </span>
            </button>
            <div className="gh-fr-tools">
                {p.type === INCOMING && <button className="gh-fr-pill gh-on" onClick={() => accept(p)}>Accept</button>}
                {p.type === INCOMING && <button className="gh-fr-pill" onClick={() => drop(p, "Request ignored")}>Ignore</button>}
                {p.type === OUTGOING && <button className="gh-fr-pill" onClick={() => drop(p, "Request cancelled")}>Cancel</button>}
                {p.type === BLOCKED && <button className="gh-fr-pill" onClick={() => drop(p, `Unblocked ${nameOf(p)}`)}>Unblock</button>}
                {p.type === FRIEND && <>
                    <button className="gh-tool" aria-label="Profile" onClick={() => openUserProfile(p.id)}><Icon d={I.users} /></button>
                    <button className="gh-tool gh-danger" aria-label="Remove friend" onClick={() => unfriend(p)}><Icon d={I.x} /></button>
                </>}
            </div>
        </div>
    );

    return (
        <div className="gh-fr">
            <header className="gh-fr-head">
                <h1>Friends</h1>
                <nav className="gh-fr-tabs">
                    {tabButton("online", "Online", online.length)}
                    {tabButton("all", "All", friends.length)}
                    {tabButton("pending", "Pending", pending.length)}
                    {tabButton("blocked", "Blocked", 0)}
                </nav>
                <label className="gh-search gh-fr-search">
                    <Icon d={I.search} />
                    <input value={query} onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === "Escape" && setQuery("")} placeholder="Search friends" spellCheck={false} />
                </label>
                <button className={"gh-fr-pill" + (adding ? "" : " gh-on")} onClick={() => setAdding(v => !v)}>
                    <Icon d={adding ? I.x : I.plus} size={15} /> {adding ? "Close" : "Add friend"}
                </button>
            </header>

            {adding && (
                <div className="gh-fr-add">
                    <label className="gh-search">
                        <Icon d={I.friends} />
                        <input autoFocus value={username} onChange={e => setUsername(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && sendRequest()} placeholder="Their username" spellCheck={false} />
                    </label>
                    <button className="gh-fr-pill gh-on" disabled={!username.trim()} onClick={sendRequest}>Send request</button>
                </div>
            )}

            <div className="gh-fr-body">
            <div className="gh-fr-scroll">
                <h2>{tab === "online" ? "Online" : tab === "all" ? "All friends" : tab === "pending" ? "Pending" : "Blocked"} · {list.length}</h2>
                <div className="gh-fr-grid" key={tab}>{list.map(card)}</div>
                {!list.length && (
                    <div className="gh-empty">
                        {q ? `Nobody matches “${query}”.`
                            : tab === "online" ? "Nobody is online right now."
                                : tab === "pending" ? "No pending requests."
                                    : tab === "blocked" ? "You have not blocked anyone." : "No friends yet."}
                    </div>
                )}
            </div>

            <aside className="gh-fr-side">
                <h2>Active now</h2>
                {active.map((p, i) => {
                    const art = artOf(p.act);
                    const time = elapsed(p.act);
                    return (
                        <button key={p.id} className="gh-fr-now" style={{ "--i": i } as any} onClick={() => openPrivateChannel(p.id)}>
                            <span className="gh-fr-now-head">
                                {avatar(p, 36)}
                                <span className="gh-member-names">
                                    <span>{nameOf(p)}</span>
                                    <small>{VERBS[p.act.type] || "Active"}{time && ` · ${time}`}</small>
                                </span>
                            </span>
                            <span className="gh-fr-now-body">
                                {art
                                    ? <img className="gh-fr-art" src={art} alt="" loading="lazy" draggable={false} />
                                    : <span className="gh-fr-art gh-fr-art-blank">{(p.act.name ?? "?").slice(0, 1)}</span>}
                                <span className="gh-member-names">
                                    <span>{p.act.name}</span>
                                    {p.act.details && <small>{p.act.details}</small>}
                                    {p.act.state && <small>{p.act.state}</small>}
                                </span>
                            </span>
                        </button>
                    );
                })}
                {!active.length && (
                    <div className="gh-fr-quiet">
                        <strong>It's quiet for now</strong>
                        <small>When a friend starts a game, a stream or a song, it shows up here.</small>
                    </div>
                )}
            </aside>
            </div>
        </div>
    );
}
