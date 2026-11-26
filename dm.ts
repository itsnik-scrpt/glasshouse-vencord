/*
 * Opening a direct message with one person.
 *
 * This used to go through Discord's own "open private channel" action, but Discord
 * changed what that action expects, and given a single user it started creating an
 * empty group DM instead. So the plugin now finds the existing DM itself, or asks
 * Discord for one with exactly that person, and navigates there.
 */

import { ChannelStore, NavigationRouter, RestAPI, showToast } from "@webpack/common";

export async function openDM(userId: string) {
    try {
        let channelId: string | undefined = ChannelStore.getDMFromUserId(userId);
        if (!channelId) {
            const res: any = await RestAPI.post({ url: "/users/@me/channels", body: { recipients: [userId] } } as any);
            channelId = res.body?.id;
            // Discord announces the new conversation a moment after creating it.
            for (let i = 0; channelId && !ChannelStore.getChannel(channelId) && i < 20; i++) await new Promise(r => setTimeout(r, 100));
        }
        if (!channelId) throw new Error("no conversation came back");
        NavigationRouter.transitionTo(`/channels/@me/${channelId}`);
    } catch (e: any) {
        showToast({ text: `Could not open that conversation: ${e?.body?.message ?? e?.message ?? "unknown error"}`, variant: "critical" });
    }
}
