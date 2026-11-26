/*
 * Emoji, sticker and GIF picker for the assistant's chat: your servers' emojis and
 * stickers, and Discord's own GIF search. Also the helpers that turn :name: into a
 * server emoji and draw it in a message.
 */

import { EmojiStore, GuildStore, LocaleStore, RestAPI, SortedGuildStore, StickersStore, useEffect, useRef, useState } from "@webpack/common";

import { I, Icon, matches, safe } from "./Hub";

export interface Media { kind: "gif" | "sticker"; url: string; still: string; name: string; video?: boolean; }
export type Tab = "emoji" | "sticker" | "gif";

const STANDARD = [..."😀😄😂🤣😊😉😍😘😎🤔😅😭😢😡🥺😴🙄😳🤯🥳😇🤝👍👎👏🙏💪👀🔥✨💯❤️💔🎉🎮🎵📌✅❌⚠️❓💡🕐🚀🌙☀️🍕☕"]
    .filter(ch => ch !== "️");
const LOTTIE = 3, GIF = 4;

interface ServerEmoji { id: string; name: string; animated?: boolean; }

export const emojiUrl = (e: { id: string; animated?: boolean; }, size = 48) =>
    `https://cdn.discordapp.com/emojis/${e.id}.webp?size=${size}${e.animated ? "&animated=true" : ""}`;
const stickerUrl = (s: any, size = 160) =>
    `https://media.discordapp.net/stickers/${s.id}.${s.format_type === GIF ? "gif" : "png"}?size=${size}`;

/** Every server's emojis and stickers, in your server order. */
function servers() {
    const ids: string[] = safe(() => SortedGuildStore.getFlattenedGuildIds(), []);
    const stickers: Map<string, any[]> = safe(() => StickersStore.getAllGuildStickers() as any, new Map());
    return ids.map(id => ({
        id,
        name: (GuildStore.getGuild(id) as any)?.name ?? "Server",
        emojis: safe(() => EmojiStore.getGuildEmoji(id) as any[], []).filter(e => e?.id && e.available !== false) as ServerEmoji[],
        stickers: (stickers.get(id) ?? []).filter(s => s?.id && s.format_type !== LOTTIE)
    }));
}

/* ───────────── emoji in message text ───────────── */

const TOKEN = /<(a?):(\w+):(\d+)>/g;

/** ":name:" as typed becomes a server emoji token, when a server of yours has an emoji by that name. */
export function resolveEmoji(text: string, picked: Record<string, ServerEmoji>): string {
    if (!text.includes(":")) return text;
    let index: Map<string, ServerEmoji> | null = null;
    return text.replace(/:(\w{2,32}):/g, (whole, name: string) => {
        let found: ServerEmoji | undefined = picked[name];
        if (!found) {
            if (!index) {
                index = new Map();
                for (const server of servers()) for (const e of server.emojis) if (!index.has(e.name)) index.set(e.name, e);
            }
            found = index.get(name);
        }
        return found ? `<${found.animated ? "a" : ""}:${found.name}:${found.id}>` : whole;
    });
}

/** Tokens back to ":name:", for editing and for what the assistant is told. */
export const plainEmoji = (text: string) => text.replace(TOKEN, ":$2:");

/** Message text with its server emojis drawn. A message of only emojis shows them large. */
export function withEmoji(text: string) {
    const parts = text.split(/(<a?:\w+:\d+>)/g);
    const only = parts.every(p => !p.trim() || /^<a?:\w+:\d+>$/.test(p));
    return parts.map((part, i) => {
        const m = /^<(a?):(\w+):(\d+)>$/.exec(part);
        if (!m) return part;
        return <img key={i} className={"gh-emoji" + (only ? " gh-jumbo" : "")} src={emojiUrl({ id: m[3], animated: !!m[1] }, only ? 96 : 48)}
            alt={`:${m[2]}:`} draggable={false} />;
    });
}

/* ───────────── the picker ───────────── */

interface Props {
    tab: Tab;
    setTab(tab: Tab): void;
    onText(text: string): void;
    onEmoji(emoji: ServerEmoji): void;
    onMedia(media: Media): void;
}

const MAX_SHOWN = 700;

export function Picker({ tab, setTab, onText, onEmoji, onMedia }: Props) {
    const [query, setQuery] = useState("");
    const [gifs, setGifs] = useState<any[] | null>(null);
    const [gifState, setGifState] = useState<"idle" | "loading" | "failed">("idle");
    const input = useRef<HTMLInputElement>(null);
    const q = query.trim().toLowerCase();

    useEffect(() => { input.current?.focus(); }, [tab]);

    // GIFs come from Discord's own search, the same one its GIF picker uses.
    useEffect(() => {
        if (tab !== "gif") return;
        let cancelled = false;
        setGifState("loading");
        const timer = setTimeout(async () => {
            try {
                const locale = safe(() => (LocaleStore as any).locale as string, "en-US");
                const res: any = await RestAPI.get({
                    url: q ? "/gifs/search" : "/gifs/trending-gifs",
                    query: { ...(q ? { q } : {}), media_format: "mp4", provider: "tenor", locale, limit: 40 }
                } as any);
                if (cancelled) return;
                setGifs(Array.isArray(res.body) ? res.body : []);
                setGifState("idle");
            } catch {
                if (!cancelled) { setGifs([]); setGifState("failed"); }
            }
        }, q ? 350 : 0);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [tab, q]);

    const all = tab === "gif" ? [] : servers();
    let budget = MAX_SHOWN;
    const take = <T,>(list: T[]) => { const part = list.slice(0, Math.max(0, budget)); budget -= part.length; return part; };

    const emojiTab = () => {
        const standard = q ? [] : STANDARD;
        const groups = all
            .map(s => ({ ...s, list: take(s.emojis.filter(e => matches(e.name, q))) }))
            .filter(s => s.list.length);
        return (
            <>
                {standard.length > 0 && (
                    <section>
                        <h5>Standard</h5>
                        <div className="gh-pick-grid">
                            {standard.map(ch => <button key={ch} className="gh-pick-char" onClick={() => onText(ch)}>{ch}</button>)}
                        </div>
                    </section>
                )}
                {groups.map(s => (
                    <section key={s.id}>
                        <h5>{s.name}</h5>
                        <div className="gh-pick-grid">
                            {s.list.map(e => (
                                <button key={e.id} aria-label={`:${e.name}:`} onClick={() => onEmoji(e)}>
                                    <img src={emojiUrl(e)} alt="" loading="lazy" draggable={false} />
                                </button>
                            ))}
                        </div>
                    </section>
                ))}
                {!groups.length && !standard.length && <p className="gh-pick-empty">No emoji called “{query}”.</p>}
                {!groups.length && !q && <p className="gh-pick-empty">None of your servers have their own emojis.</p>}
            </>
        );
    };

    const stickerTab = () => {
        const groups = all
            .map(s => ({ ...s, list: take(s.stickers.filter(st => matches(st.name, q))) }))
            .filter(s => s.list.length);
        return (
            <>
                {groups.map(s => (
                    <section key={s.id}>
                        <h5>{s.name}</h5>
                        <div className="gh-pick-grid gh-pick-big">
                            {s.list.map(st => (
                                <button key={st.id} aria-label={st.name}
                                    onClick={() => onMedia({ kind: "sticker", url: stickerUrl(st, 320), still: stickerUrl(st, 160), name: st.name })}>
                                    <img src={stickerUrl(st, 160)} alt="" loading="lazy" draggable={false} />
                                </button>
                            ))}
                        </div>
                    </section>
                ))}
                {!groups.length && <p className="gh-pick-empty">{q ? `No sticker called “${query}”.` : "None of your servers have stickers."}</p>}
            </>
        );
    };

    const gifTab = () => (
        <>
            {!q && <h5>Trending</h5>}
            <div className="gh-pick-gifs">
                {(gifs ?? []).map((g, i) => {
                    const video = typeof g.src === "string" && /\.(mp4|webm)(\?|$)/i.test(g.src);
                    const url: string = video ? g.src : (g.gif_src || g.src);
                    if (!url) return null;
                    const still: string = g.preview || g.gif_src || url;
                    return (
                        <button key={g.id ?? i} aria-label={g.title || "GIF"}
                            onClick={() => onMedia({ kind: "gif", url, still, name: g.title || query.trim() || "GIF", video })}>
                            {video
                                ? <video src={url} poster={g.preview} muted loop playsInline preload="none"
                                    onMouseEnter={e => void e.currentTarget.play().catch(() => { })}
                                    onMouseLeave={e => e.currentTarget.pause()} />
                                : <img src={still} alt="" loading="lazy" draggable={false} />}
                        </button>
                    );
                })}
            </div>
            {gifState === "loading" && !gifs?.length && <p className="gh-pick-empty">Loading…</p>}
            {gifState === "failed" && <p className="gh-pick-empty">Discord's GIF search did not answer. Try again in a moment.</p>}
            {gifState === "idle" && gifs && !gifs.length && <p className="gh-pick-empty">{q ? `No GIFs for “${query}”.` : "Type to search for a GIF."}</p>}
        </>
    );

    const tabs: [Tab, string][] = [["gif", "GIFs"], ["sticker", "Stickers"], ["emoji", "Emoji"]];

    return (
        <div className="gh-pick">
            <div className="gh-pick-head">
                <nav>
                    {tabs.map(([id, label]) => (
                        <button key={id} className={tab === id ? "gh-on" : ""} onClick={() => { setTab(id); setQuery(""); }}>{label}</button>
                    ))}
                </nav>
                <label>
                    <Icon d={I.search} size={15} />
                    <input ref={input} value={query} spellCheck={false}
                        placeholder={tab === "gif" ? "Search GIFs" : tab === "sticker" ? "Search stickers" : "Search emoji"}
                        onChange={e => setQuery(e.target.value)} />
                </label>
            </div>
            <div className="gh-pick-body" key={tab}>
                {tab === "emoji" ? emojiTab() : tab === "sticker" ? stickerTab() : gifTab()}
            </div>
        </div>
    );
}
