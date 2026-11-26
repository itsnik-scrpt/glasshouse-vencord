/*
 * Letting the assistant speak in a server channel, through a webhook.
 *
 * A webhook is Discord's own way for something that is not a person to post, so the
 * message appears under the assistant's name with an APP tag, separate from you.
 * The assistant only drafts the message. It is sent when you press Send on its card.
 */

import * as DataStore from "@api/DataStore";
import { ChannelStore, GuildStore, PermissionsBits, PermissionStore, RestAPI, UserStore } from "@webpack/common";

export interface Post {
    channelId: string;
    /** "#general", written here from the real channel. */
    label: string;
    serverName: string;
    content: string;
    state?: "sent" | "failed" | "dismissed";
    error?: string;
}

const KEY = "Glasshouse_webhooks";
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{5,25}$/.test(v);
const THREADS = [10, 11, 12];
const POSTABLE = [0, 2, 5, 13, ...THREADS];

let hooks: Record<string, { id: string; token: string; }> | null = null;
async function load() {
    if (!hooks) hooks = (await DataStore.get(KEY).catch(() => null)) ?? {};
    return hooks!;
}

/** The channel a webhook lives in: a thread uses its parent channel's. */
const home = (channel: any): string => THREADS.includes(channel.type) ? channel.parent_id : channel.id;

/** Check a drafted message against the real channel. Throws with a message for the assistant. */
export function checkPost(input: any): Post {
    if (!isId(input?.channel_id)) throw new Error("channel_id is not a valid id");
    const channel: any = ChannelStore.getChannel(input.channel_id);
    if (!channel) throw new Error("the user cannot see a channel with that id");
    if (!channel.guild_id) throw new Error("that is a direct message. Messages can only be posted in server channels, because Discord has no webhooks in DMs");
    if (!POSTABLE.includes(channel.type)) throw new Error("messages cannot be posted in that kind of channel (forums and categories are not supported)");
    const parent: any = ChannelStore.getChannel(home(channel));
    let can = false;
    try { can = !!parent && PermissionStore.can(PermissionsBits.MANAGE_WEBHOOKS, parent); } catch { /* treated as not allowed */ }
    if (!can) throw new Error(`the user does not have the Manage Webhooks permission in #${channel.name}, so nothing can be posted there`);
    const content = String(input.content ?? "").trim();
    if (!content) throw new Error("content is empty");
    if (content.length > 2000) throw new Error(`content is ${content.length} characters; a Discord message can be at most 2000`);
    return {
        channelId: channel.id,
        label: "#" + channel.name,
        serverName: (GuildStore.getGuild(channel.guild_id) as any)?.name ?? "Server",
        content
    };
}

/** The orb as a picture, for the webhook's avatar. */
function orbPicture(hue: number): string | null {
    try {
        const size = 256, c = size / 2;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        ctx.beginPath();
        ctx.arc(c, c, c, 0, Math.PI * 2);
        ctx.clip();
        const ring = ctx.createConicGradient((200 * Math.PI) / 180 - Math.PI / 2, c, c);
        ring.addColorStop(0, `hsl(${hue} 92% 62%)`);
        ring.addColorStop(0.33, `hsl(${hue + 55} 90% 60%)`);
        ring.addColorStop(0.66, `hsl(${hue - 75} 88% 58%)`);
        ring.addColorStop(1, `hsl(${hue} 92% 62%)`);
        ctx.fillStyle = ring;
        ctx.fillRect(0, 0, size, size);
        const shade = ctx.createRadialGradient(size * 0.7, size * 0.82, 0, size * 0.7, size * 0.82, size * 0.55);
        shade.addColorStop(0, "rgba(0,0,0,0.28)");
        shade.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = shade;
        ctx.fillRect(0, 0, size, size);
        const shine = ctx.createRadialGradient(size * 0.32, size * 0.26, 0, size * 0.32, size * 0.26, size * 0.34);
        shine.addColorStop(0, "rgba(255,255,255,0.85)");
        shine.addColorStop(0.15, "rgba(255,255,255,0.7)");
        shine.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = shine;
        ctx.fillRect(0, 0, size, size);
        return canvas.toDataURL("image/png");
    } catch {
        return null;
    }
}

/**
 * Post the message. Uses the assistant's webhook in that channel, creating it the first
 * time. Mentions in the text never ping anyone. Throws if Discord refuses.
 */
export async function sendPost(post: Post, name: string, hue: number, pictureUrl: string): Promise<void> {
    const channel: any = ChannelStore.getChannel(post.channelId);
    if (!channel?.guild_id) throw new Error("That channel is gone.");
    const content = post.content.trim();
    if (!content || content.length > 2000) throw new Error("A message needs 1 to 2000 characters.");
    const parent = home(channel);
    const store = await load();
    const me: any = UserStore.getCurrentUser();

    const find = async () => {
        if (store[parent]) return store[parent];
        const list: any = await RestAPI.get({ url: `/channels/${parent}/webhooks` } as any);
        const mine = (list.body ?? []).find((w: any) => w.token && w.name === name && w.user?.id === me?.id);
        let hook = mine ? { id: mine.id as string, token: mine.token as string } : null;
        if (!hook) {
            const made: any = await RestAPI.post({ url: `/channels/${parent}/webhooks`, body: { name, avatar: orbPicture(hue) } } as any);
            hook = { id: made.body.id, token: made.body.token };
        }
        store[parent] = hook;
        void DataStore.set(KEY, store);
        return hook;
    };
    const run = async (hook: { id: string; token: string; }) => RestAPI.post({
        url: `/webhooks/${hook.id}/${hook.token}`,
        query: { wait: true, ...(parent !== channel.id ? { thread_id: channel.id } : {}) },
        body: {
            content,
            username: name,
            ...(/^https:\/\//i.test(pictureUrl) ? { avatar_url: pictureUrl } : {}),
            // Nobody is pinged, whatever the text says: no @everyone, no role or user pings.
            allowed_mentions: { parse: [] }
        }
    } as any);

    try {
        await run(await find());
    } catch (e: any) {
        // The webhook was deleted in the server's settings: forget it and make a new one, once.
        if (e?.status !== 404 && e?.body?.code !== 10015) throw e;
        delete store[parent];
        await run(await find());
    }
}
