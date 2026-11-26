/*
 * Server changes the assistant may propose. The assistant only describes what it wants;
 * this file checks every part of that against the real server, writes the wording the
 * user sees from the checked values (never from the assistant's own words), and works
 * out the exact request. Nothing here sends anything: a change runs only when the user
 * approves it on its card.
 */

import { ChannelStore, GuildRoleStore, GuildStore, PermissionsBits, PermissionStore } from "@webpack/common";

export interface Change {
    /** What the user reads. Built here from the checked values. */
    label: string;
    /** Destructive or sensitive: approved one at a time, with its own confirmation. */
    danger?: string;
    needs: "channels" | "server" | "roles";
    method: "post" | "patch" | "del";
    url: string;
    body?: any;
    state?: "done" | "failed";
    error?: string;
}

export interface Proposal {
    serverId: string;
    serverName: string;
    summary: string;
    changes: Change[];
    closed?: boolean;
}

const MAX_CHANGES = 15;
const CHANNEL_TYPES: Record<string, [number, string]> = {
    text: [0, "text channel"], voice: [2, "voice channel"], category: [4, "category"],
    announcement: [5, "announcement channel"], stage: [13, "stage channel"], forum: [15, "forum channel"]
};
// Permissions that let a role take over or damage a server. Granting one is flagged.
const POWERFUL = ["ADMINISTRATOR", "MANAGE_GUILD", "MANAGE_ROLES", "MANAGE_CHANNELS", "KICK_MEMBERS", "BAN_MEMBERS", "MANAGE_WEBHOOKS", "MENTION_EVERYONE", "MODERATE_MEMBERS", "MANAGE_MESSAGES"];

const isId = (v: unknown): v is string => typeof v === "string" && /^\d{5,25}$/.test(v);
const clip = (text: string, max: number) => text.length > max ? text.slice(0, max) + "…" : text;
const words = (permission: string) => permission.toLowerCase().replace(/_/g, " ");

export const ACTIONS = ["create_channel", "edit_channel", "delete_channel", "edit_server", "create_role", "edit_role", "delete_role"];

/** Whether you hold the permission a change needs in that server. */
export function allowed(serverId: string, needs: Change["needs"]): boolean {
    const guild = GuildStore.getGuild(serverId);
    if (!guild) return false;
    const bit = needs === "channels" ? PermissionsBits.MANAGE_CHANNELS : needs === "roles" ? PermissionsBits.MANAGE_ROLES : PermissionsBits.MANAGE_GUILD;
    try { return PermissionStore.can(bit, guild as any); } catch { return false; }
}

/** Check one requested change and turn it into a request plus its wording. Throws with a message for the assistant. */
function build(serverId: string, raw: any): Change {
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const channelOf = (id: unknown, what = "channel_id") => {
        if (!isId(id)) throw new Error(`${what} is not a valid id`);
        const channel: any = ChannelStore.getChannel(id);
        if (!channel || channel.guild_id !== serverId) throw new Error(`${what} ${id} is not a channel of this server`);
        return channel;
    };
    const roleOf = (id: unknown) => {
        if (!isId(id)) throw new Error("role_id is not a valid id");
        if (id === serverId) throw new Error("the @everyone role cannot be changed this way");
        const role: any = GuildRoleStore.getRole(serverId, id);
        if (!role) throw new Error(`role_id ${id} is not a role of this server`);
        return role;
    };
    const tag = (c: any) => (c.type === 4 ? "category " : "#") + c.name;

    switch (raw.action) {
        case "create_channel": {
            const kind = CHANNEL_TYPES[String(raw.type ?? "text")];
            if (!kind) throw new Error(`type must be one of ${Object.keys(CHANNEL_TYPES).join(", ")}`);
            if (!name || name.length > 100) throw new Error("name is required, up to 100 characters");
            const body: any = { name, type: kind[0] };
            let where = "";
            if (raw.category_id && raw.category_id !== "none" && kind[0] !== 4) {
                const category = channelOf(raw.category_id, "category_id");
                if (category.type !== 4) throw new Error("category_id is not a category");
                body.parent_id = category.id;
                where = ` in ${category.name}`;
            }
            if (typeof raw.topic === "string" && raw.topic.trim() && (kind[0] === 0 || kind[0] === 5 || kind[0] === 15)) body.topic = raw.topic.trim().slice(0, 1024);
            return {
                label: `Create ${kind[1]} ${kind[0] === 4 ? "" : "#"}${name}${where}${body.topic ? `, with the topic “${clip(body.topic, 80)}”` : ""}`,
                needs: "channels", method: "post", url: `/guilds/${serverId}/channels`, body
            };
        }
        case "edit_channel": {
            const channel = channelOf(raw.channel_id);
            const body: any = {};
            const parts: string[] = [];
            if (name && name !== channel.name) {
                if (name.length > 100) throw new Error("name can be up to 100 characters");
                body.name = name;
                parts.push(`rename it to ${channel.type === 4 ? "" : "#"}${name}`);
            }
            if (typeof raw.topic === "string") {
                body.topic = raw.topic.trim().slice(0, 1024);
                parts.push(body.topic ? `set its topic to “${clip(body.topic, 80)}”` : "clear its topic");
            }
            if (raw.slowmode_seconds !== undefined) {
                const seconds = Math.round(Number(raw.slowmode_seconds));
                if (!(seconds >= 0 && seconds <= 21600)) throw new Error("slowmode_seconds must be between 0 and 21600");
                body.rate_limit_per_user = seconds;
                parts.push(seconds ? `set slowmode to ${seconds} seconds` : "turn slowmode off");
            }
            if (typeof raw.nsfw === "boolean") {
                body.nsfw = raw.nsfw;
                parts.push(raw.nsfw ? "mark it age-restricted" : "remove its age restriction");
            }
            if (raw.category_id !== undefined && channel.type !== 4) {
                if (raw.category_id === "none" || raw.category_id === null) {
                    body.parent_id = null;
                    parts.push("move it out of its category");
                } else {
                    const category = channelOf(raw.category_id, "category_id");
                    if (category.type !== 4) throw new Error("category_id is not a category");
                    body.parent_id = category.id;
                    parts.push(`move it to ${category.name}`);
                }
            }
            if (!parts.length) throw new Error("edit_channel changes nothing");
            return { label: `${tag(channel)}: ${parts.join(", ")}`, needs: "channels", method: "patch", url: `/channels/${channel.id}`, body };
        }
        case "delete_channel": {
            const channel = channelOf(raw.channel_id);
            return {
                label: `Delete ${tag(channel)}`,
                danger: channel.type === 4 ? "The channels inside it are kept. This cannot be undone." : "Every message in it is deleted with it. This cannot be undone.",
                needs: "channels", method: "del", url: `/channels/${channel.id}`
            };
        }
        case "edit_server": {
            const body: any = {};
            const parts: string[] = [];
            if (name) {
                if (name.length < 2 || name.length > 100) throw new Error("a server name is 2 to 100 characters");
                body.name = name;
                parts.push(`rename the server to “${name}”`);
            }
            if (typeof raw.description === "string") {
                body.description = raw.description.trim().slice(0, 300);
                parts.push(body.description ? `set the server description to “${clip(body.description, 100)}”` : "clear the server description");
            }
            if (!parts.length) throw new Error("edit_server changes nothing");
            const label = parts.join(", ");
            return { label: label[0].toUpperCase() + label.slice(1), needs: "server", method: "patch", url: `/guilds/${serverId}`, body };
        }
        case "create_role":
        case "edit_role": {
            const role = raw.action === "edit_role" ? roleOf(raw.role_id) : null;
            const body: any = {};
            const parts: string[] = [];
            let danger: string | undefined;
            if (name && name !== role?.name) {
                if (name.length > 100) throw new Error("a role name can be up to 100 characters");
                body.name = name;
                if (role) parts.push(`rename it to “${name}”`);
            }
            if (!role && !name) throw new Error("name is required");
            if (typeof raw.color === "string") {
                const hex = /^#?([0-9a-f]{6})$/i.exec(raw.color.trim());
                if (!hex) throw new Error("color must look like #rrggbb");
                body.color = parseInt(hex[1], 16);
                parts.push(`colour #${hex[1].toLowerCase()}`);
            }
            if (typeof raw.hoist === "boolean") { body.hoist = raw.hoist; parts.push(raw.hoist ? "shown separately in the member list" : "not shown separately in the member list"); }
            if (typeof raw.mentionable === "boolean") { body.mentionable = raw.mentionable; parts.push(raw.mentionable ? "anyone can mention it" : "not mentionable by everyone"); }

            const add: string[] = Array.isArray(raw.permissions_add) ? raw.permissions_add.map(String) : [];
            const remove: string[] = Array.isArray(raw.permissions_remove) ? raw.permissions_remove.map(String) : [];
            if (add.length || remove.length) {
                for (const p of [...add, ...remove]) if (!(p in PermissionsBits)) throw new Error(`"${p}" is not a Discord permission name`);
                let bits = BigInt(role?.permissions ?? 0);
                for (const p of add) bits |= BigInt((PermissionsBits as any)[p]);
                for (const p of remove) bits &= ~BigInt((PermissionsBits as any)[p]);
                body.permissions = bits.toString();
                if (add.length) parts.push(`grant: ${add.map(words).join(", ")}`);
                if (remove.length) parts.push(`take away: ${remove.map(words).join(", ")}`);
                const strong = add.filter(p => POWERFUL.includes(p));
                if (strong.length) danger = `This gives the role powerful permissions (${strong.map(words).join(", ")}). Everyone with the role gets them.`;
            }
            if (role && !parts.length) throw new Error("edit_role changes nothing");
            return role
                ? { label: `Role ${role.name}: ${parts.join(", ")}`, danger, needs: "roles", method: "patch", url: `/guilds/${serverId}/roles/${role.id}`, body }
                : { label: `Create the role “${name}”${parts.length ? ` (${parts.join(", ")})` : ""}`, danger, needs: "roles", method: "post", url: `/guilds/${serverId}/roles`, body };
        }
        case "delete_role": {
            const role = roleOf(raw.role_id);
            return {
                label: `Delete the role ${role.name}`,
                danger: "Everyone who has it loses it. This cannot be undone.",
                needs: "roles", method: "del", url: `/guilds/${serverId}/roles/${role.id}`
            };
        }
    }
    throw new Error(`"${raw.action}" is not a change that can be proposed. Use one of: ${ACTIONS.join(", ")}`);
}

/** Turn what the assistant asked for into a proposal, or throw explaining what is wrong with it. */
export function buildProposal(input: any): Proposal {
    if (!isId(input?.server_id)) throw new Error("server_id is not a valid id");
    const guild: any = GuildStore.getGuild(input.server_id);
    if (!guild) throw new Error("the user is not in a server with that id");
    const list: any[] = Array.isArray(input.changes) ? input.changes : [];
    if (!list.length) throw new Error("changes is empty");
    if (list.length > MAX_CHANGES) throw new Error(`at most ${MAX_CHANGES} changes in one proposal`);
    const changes = list.map((raw, i) => {
        try { return build(guild.id, raw ?? {}); } catch (e: any) { throw new Error(`change ${i + 1}: ${e.message}`); }
    });
    return { serverId: guild.id, serverName: guild.name, summary: clip(String(input.summary ?? "").trim() || "Proposed changes", 140), changes };
}
