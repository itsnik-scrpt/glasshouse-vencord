/*
 * Quick settings drawer: layout, colour, backdrop, glass, chat and motion options.
 */

import { ReactDOM } from "@webpack/common";

import { I, Icon } from "./Hub";
import { apply, BACKDROPS, LAYOUTS, MOTIONS, portalHost, settings } from "./settings";

const LAYOUT_NAMES: Record<string, string> = { left: "Left", right: "Right", top: "Top bar" };

// name, hue, saturation, lightness
const ACCENTS: [string, number, number, number][] = [
    ["Magenta", 325, 78, 52],
    ["Rose", 346, 84, 58],
    ["Violet", 265, 72, 60],
    ["Blue", 216, 86, 56],
    ["Teal", 176, 72, 38],
    ["Green", 146, 60, 40],
    ["Amber", 32, 92, 50],
    ["Graphite", 220, 10, 38]
];

const title = (s: string) => s[0].toUpperCase() + s.slice(1);

export function QuickSettings({ onClose }: { onClose(): void; }) {
    const s: any = settings.use();
    const set = (key: string, value: any) => {
        (settings.store as any)[key] = value;
        apply();
    };

    const range = (key: string, label: string, min: number, max: number, unit = "") => (
        <label className="gh-range">
            <span>{label}<b>{Math.round(s[key])}{unit}</b></span>
            <input type="range" min={min} max={max} value={s[key]} onChange={e => set(key, Number(e.target.value))} />
        </label>
    );
    const check = (key: string, label: string) => (
        <label className="gh-check">
            <input type="checkbox" checked={!!s[key]} onChange={e => set(key, e.target.checked)} />
            <span>{label}</span>
        </label>
    );
    const segment = (key: string, values: readonly string[], names?: Record<string, string>) => (
        <div className="gh-segment">
            {values.map(v => (
                <button key={v} className={s[key] === v ? "gh-on" : ""} onClick={() => set(key, v)}>
                    {names?.[v] ?? title(v)}
                </button>
            ))}
        </div>
    );

    return ReactDOM.createPortal(
        <aside className="gh-drawer gh-prefs">
            <header className="gh-drawer-head">
                <Icon d={I.sliders} size={18} />
                <strong>Glasshouse</strong>
                <button className="gh-tool" onClick={onClose} aria-label="Close"><Icon d={I.x} /></button>
            </header>

            <div className="gh-prefs-scroll">
                <h4>Layout</h4>
                <div className="gh-layouts">
                    {LAYOUTS.map(l => (
                        <button key={l} className={"gh-layout-pick" + (s.layout === l ? " gh-on" : "")} onClick={() => set("layout", l)}>
                            <span className={"gh-mini gh-mini-" + l}><i /><i /></span>
                            {LAYOUT_NAMES[l]}
                        </button>
                    ))}
                </div>
                {check("compact", "Compact density")}
                {check("hideChannelIcons", "Hide channel type icons")}
                {check("useHub", "Use this hub (off = Discord's own sidebar)")}

                <h4>Accent</h4>
                <div className="gh-swatches">
                    {ACCENTS.map(([name, h, sat, l]) => (
                        <button
                            key={name}
                            aria-label={name}
                            className={"gh-swatch" + (Math.round(s.accentHue) === h && Math.round(s.accentSaturation) === sat ? " gh-on" : "")}
                            style={{ background: `hsl(${h} ${sat}% ${l}%)` }}
                            onClick={() => {
                                settings.store.accentHue = h;
                                settings.store.accentSaturation = sat;
                                settings.store.accentLightness = l;
                                apply();
                            }}
                        />
                    ))}
                </div>
                <div className="gh-hue">{range("accentHue", "Hue", 0, 360)}</div>
                {range("accentSaturation", "Strength", 0, 100, "%")}
                {range("accentLightness", "Brightness", 30, 80, "%")}

                <h4>Backdrop</h4>
                <div className="gh-swatches">
                    {BACKDROPS.map(b => (
                        <button
                            key={b}
                            aria-label={title(b)}
                            className={"gh-swatch gh-swatch-wide gh-chip-" + b + (s.backdropPreset === b && !s.backdropUrl ? " gh-on" : "")}
                            onClick={() => {
                                settings.store.backdropUrl = "";
                                set("backdropPreset", b);
                            }}
                        />
                    ))}
                </div>
                <label className="gh-search gh-reason">
                    <input value={s.backdropUrl} onChange={e => set("backdropUrl", e.target.value)}
                        placeholder="Or an image URL (https)" spellCheck={false} />
                </label>
                {!!s.backdropUrl && range("blur", "Frost on the image", 0, 40, "px")}

                <h4>Panels</h4>
                {range("panelOpacity", "Opacity", 0, 100, "%")}
                {range("gap", "Gap", 0, 24, "px")}
                {range("radius", "Corner rounding", 0, 32, "px")}

                <h4>Chat</h4>
                {check("bubbles", "Message bubbles")}
                {check("readingWidth", "Centred reading column")}
                {check("bigAvatars", "Larger avatars")}
                {check("cleanInput", "Hide gift, sticker and app buttons")}
                {check("hideMembers", "Hide members pane")}

                <h4>Friends</h4>
                {check("customFriends", "Glasshouse friends page (off = Discord's own)")}

                <h4>Members</h4>
                {check("glasshouseMembers", "Glasshouse member list (off = Discord's own)")}
                {check("showActivity", "Show status text and activity")}
                {range("membersWidth", "Width", 220, 380, "px")}

                <h4>Motion</h4>
                {segment("motion", MOTIONS)}
            </div>
        </aside>,
        portalHost()
    );
}
