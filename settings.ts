/*
 * Glasshouse settings: shared by the plugin entry and the hub UI.
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

/*
 * The variables live in our own <style> element. They used to be set inline on <html>,
 * but Discord rewrites that element's style attribute, which wiped them and made the
 * colours fall back to the theme's defaults at random.
 */
const vars = new Map<string, string>();

function flushVars() {
    let el = document.getElementById("gh-vars") as HTMLStyleElement | null;
    if (!vars.size) return void el?.remove();
    if (!el) {
        el = document.createElement("style");
        el.id = "gh-vars";
        document.head.appendChild(el);
    }
    const body = Array.from(vars, ([k, v]) => `${k}: ${v};`).join(" ");
    // Repeated :root raises specificity above the theme's own :root / .theme-* / body.gh-bg-* rules.
    const css = `:root:root:root, :root:root:root body { ${body} }`;
    if (el.textContent !== css) el.textContent = css;
}

function setVar(name: string, value: string | null) {
    if (value === null || value === "") vars.delete(name);
    else vars.set(name, value);
    flushVars();
}

export const LAYOUTS = ["left", "right", "top"] as const;
export const MOTIONS = ["off", "subtle", "full"] as const;
export const BACKDROPS = ["blossom", "aurora", "sunset", "ocean", "mono"] as const;

const TOGGLE_CLASSES: Record<string, string> = {
    useHub: "gh-hub",
    compact: "gh-compact",
    hideMembers: "gh-no-members",
    focusMode: "gh-focus",
    readingWidth: "gh-reading",
    bubbles: "gh-bubbles",
    cleanInput: "gh-clean",
    bigAvatars: "gh-big-avatars",
    hideChannelIcons: "gh-no-channel-icons"
};

/** Swap the one class of a group (gh-layout-*, gh-motion-*, gh-bg-*). */
function setGroup(prefix: string, value: string) {
    const b = document.body.classList;
    for (const c of Array.from(b)) if (c.startsWith(prefix)) b.remove(c);
    b.add(prefix + value);
}

export function apply() {
    const s = settings.store;

    setVar("--gh-accent-h", String(Math.round(s.accentHue)));
    setVar("--gh-accent-s", `${Math.round(s.accentSaturation)}%`);
    setVar("--gh-accent-l", `${Math.round(s.accentLightness)}%`);
    setVar("--gh-panel-alpha", (s.panelOpacity / 100).toFixed(2));
    setVar("--gh-blur", `${Math.round(s.blur)}px`);
    setVar("--gh-gap", `${Math.round(s.gap)}px`);
    setVar("--gh-radius", `${Math.round(s.radius)}px`);
    setVar("--gh-members-width", `${Math.round(s.membersWidth)}px`);

    // Backdrop image: empty keeps the chosen gradient.
    const url = s.backdropUrl.trim();
    const hasImage = /^https?:\/\//i.test(url);
    if (hasImage) {
        const safe = url.replace(/["\\\n\r]/g, "");
        setVar("--gh-backdrop", `url("${safe}") center / cover no-repeat`);
    } else {
        setVar("--gh-backdrop", null);
    }

    const b = document.body.classList;
    for (const [key, cls] of Object.entries(TOGGLE_CLASSES)) b.toggle(cls, !!(s as any)[key]);
    // Frost is a single blurred copy of the image, not a live blur behind every panel.
    b.toggle("gh-frost", hasImage && s.blur > 0);

    // A layout that no longer exists (the old rail) falls back to Left.
    if (!(LAYOUTS as readonly string[]).includes(s.layout)) s.layout = "left";
    const { layout } = s;
    setGroup("gh-layout-", s.useHub ? layout : "left");
    setGroup("gh-motion-", s.motion);
    setGroup("gh-bg-", s.backdropPreset);
}

export function clear() {
    for (const v of [
        "--gh-accent-h", "--gh-accent-s", "--gh-accent-l", "--gh-panel-alpha",
        "--gh-blur", "--gh-gap", "--gh-radius", "--gh-backdrop", "--gh-hub-width", "--gh-members-width"
    ]) setVar(v, null);
    const b = document.body.classList;
    for (const c of Array.from(b)) if (c.startsWith("gh-")) b.remove(c);
}

const slider = (description: string, def: number, markers: number[]) => ({
    type: OptionType.SLIDER as const,
    description,
    default: def,
    markers,
    stickToMarkers: false,
    onChange: apply
});

const toggle = (description: string, def = false) => ({
    type: OptionType.BOOLEAN as const,
    description,
    default: def,
    onChange: apply
});

const select = (description: string, values: readonly string[], def: string) => ({
    type: OptionType.SELECT as const,
    description,
    options: values.map(v => ({ label: v[0].toUpperCase() + v.slice(1), value: v, default: v === def })),
    onChange: apply
});

export const settings = definePluginSettings({
    useHub: toggle("Replace the server rail and channel list with the Glasshouse hub", true),
    layout: select("Hub layout", LAYOUTS, "left"),
    motion: select("Animation level", MOTIONS, "subtle"),
    backdropPreset: select("Backdrop gradient", BACKDROPS, "blossom"),
    compact: toggle("Compact density"),
    accentHue: slider("Accent hue (325 = magenta)", 325, [0, 60, 120, 180, 240, 300, 360]),
    accentSaturation: slider("Accent saturation %", 78, [0, 25, 50, 75, 100]),
    accentLightness: slider("Accent lightness %", 52, [30, 40, 50, 60, 70, 80]),
    panelOpacity: slider("Panel opacity % (lower = clearer glass)", 52, [0, 20, 40, 60, 80, 100]),
    blur: slider("Frost on a backdrop image (px, 0 = sharp)", 26, [0, 10, 20, 30, 40]),
    gap: slider("Gap between panels (px)", 10, [0, 4, 8, 12, 16, 24]),
    radius: slider("Panel corner radius (px)", 18, [0, 6, 12, 18, 24, 32]),
    backdropUrl: {
        type: OptionType.STRING,
        description: "Backdrop image URL (https). Leave empty for the gradient.",
        default: "",
        onChange: apply
    },
    bubbles: toggle("Chat: message bubbles", true),
    readingWidth: toggle("Chat: keep messages in a centred reading column"),
    cleanInput: toggle("Chat: hide gift, sticker and app buttons in the message box"),
    bigAvatars: toggle("Chat: larger avatars"),
    hideChannelIcons: toggle("Hub: hide channel type icons"),
    glasshouseMembers: toggle("Replace the member list with the Glasshouse one (servers only)"),
    showActivity: toggle("Member list: show status text and activity", true),
    membersWidth: slider("Member list width (px)", 264, [220, 260, 300, 340, 380]),
    customFriends: toggle("Replace the Friends page with the Glasshouse one", true),
    hideMembers: toggle("Hide the members pane (Ctrl+Alt+M)"),
    focusMode: toggle("Focus mode: chat only (Ctrl+Alt+F)")
});

/** Server banner shown above the member list; null when the server has none. */
export function setBanner(url: string | null, name = "") {
    // The server name is drawn over the banner by the stylesheet, so it travels as a CSS string.
    setVar("--gh-banner-name", url && name ? JSON.stringify(name) : null);
    setVar("--gh-banner", url ? `url("${encodeURI(url)}")` : null);
    document.body.classList.toggle("gh-has-banner", !!url);
}

export const stopKeys = (e: Event) => e.stopPropagation();

/** Container for the hub's floating drawers, so typing in them stays in them. */
export function portalHost() {
    let el = document.getElementById("gh-portal");
    if (!el) {
        el = document.createElement("div");
        el.id = "gh-portal";
        el.addEventListener("keydown", stopKeys);
        document.body.appendChild(el);
    }
    return el;
}
