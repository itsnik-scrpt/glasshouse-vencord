/*
 * Calculator drawer. Type an expression or use the keys; the answer updates as you type.
 * It has its own small parser, so nothing typed here is ever run as code.
 */

import { copyWithToast } from "@utils/discord";
import { ReactDOM, useRef, useState } from "@webpack/common";

import { I, Icon } from "./Hub";
import { portalHost } from "./settings";

const FUNCS: Record<string, (x: number) => number> = {
    sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, ln: Math.log, log: Math.log10,
    abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/** Work out an expression such as "2(3+4)^2 / sqrt 9 + 15%". Throws with a readable message. */
export function evaluate(input: string, ans = 0): number {
    const s = input.toLowerCase()
        .replace(/\s+/g, "").replace(/,/g, "")
        .replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/π/g, "pi").replace(/√/g, "sqrt");
    let i = 0;
    const fail = (message: string): never => { throw new Error(message); };

    function expr(): number {
        let v = term();
        while (s[i] === "+" || s[i] === "-") {
            const op = s[i++];
            const r = term();
            v = op === "+" ? v + r : v - r;
        }
        return v;
    }
    function term(): number {
        let v = unary();
        for (; ;) {
            const c = s[i];
            if (c === "*" || c === "/") {
                i++;
                const r = unary();
                v = c === "*" ? v * r : v / r;
            } else if (c !== undefined && (c === "(" || /[a-z0-9.]/.test(c))) {
                v *= power(); // 2pi, 3(4+1)
            } else return v;
        }
    }
    function unary(): number {
        if (s[i] === "-") { i++; return -unary(); }
        if (s[i] === "+") { i++; return unary(); }
        return power();
    }
    function power(): number {
        const base = postfix();
        if (s[i] !== "^") return base;
        i++;
        return Math.pow(base, unary());
    }
    function postfix(): number {
        let v = atom();
        while (s[i] === "%") { i++; v /= 100; }
        return v;
    }
    function atom(): number {
        if (s[i] === "(") {
            i++;
            const v = expr();
            if (s[i] === ")") i++;
            else if (i < s.length) fail("Missing )");
            return v;
        }
        const rest = s.slice(i);
        const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(rest);
        if (num) { i += num[0].length; return Number(num[0]); }
        const word = /^[a-z]+/.exec(rest);
        if (word) {
            // Longest name that fits, so "pie" still reads as pi × e.
            const names = ["ans", ...Object.keys(FUNCS), ...Object.keys(CONSTS)].sort((a, b) => b.length - a.length);
            const name = names.find(n => word[0].startsWith(n)) ?? fail(`Unknown "${word[0]}"`);
            i += name.length;
            if (name === "ans") return ans;
            if (name in CONSTS) return CONSTS[name];
            return FUNCS[name](postfix());
        }
        return fail(i >= s.length ? "Incomplete" : `Unexpected "${s[i]}"`);
    }

    if (!s) return fail("Empty");
    const value = expr();
    if (i < s.length) fail(`Unexpected "${s[i]}"`);
    if (Number.isNaN(value)) fail("Not a number");
    if (!Number.isFinite(value)) fail("Cannot divide by zero");
    return value;
}

export function format(value: number): string {
    const n = Number(value.toPrecision(12));
    const size = Math.abs(n);
    if (size >= 1e15 || (n !== 0 && size < 1e-7)) return n.toExponential(6);
    return n.toLocaleString("en-US", { maximumFractionDigits: 10 });
}

// Kept while Discord stays open, so closing the drawer does not lose the tape.
const tape: { expr: string; value: string; }[] = [];
let lastAnswer = 0;
let draft = "";

const KEYS = [
    "C", "(", ")", "⌫",
    "√", "^", "%", "÷",
    "7", "8", "9", "×",
    "4", "5", "6", "−",
    "1", "2", "3", "+",
    "0", ".", "ans", "="
];
const OPERATORS = new Set(["÷", "×", "−", "+", "^", "%", "√", "(", ")"]);

export function Calculator({ onClose }: { onClose(): void; }) {
    const [expr, setExprState] = useState(draft);
    const [error, setError] = useState("");
    const [, repaint] = useState(0);
    const input = useRef<HTMLInputElement>(null);

    const setExpr = (next: string) => { draft = next; setExprState(next); setError(""); };

    let preview = "";
    try { if (expr.trim()) preview = format(evaluate(expr, lastAnswer)); } catch { /* still typing */ }

    const commit = () => {
        if (!expr.trim()) return;
        try {
            const value = evaluate(expr, lastAnswer);
            lastAnswer = value;
            tape.unshift({ expr: expr.trim(), value: format(value) });
            tape.length = Math.min(tape.length, 40);
            setExpr("");
        } catch (e: any) {
            setError(e?.message ?? "Cannot work that out");
        }
    };

    const press = (key: string) => {
        if (key === "=") commit();
        else if (key === "C") setExpr("");
        else if (key === "⌫") setExpr(expr.slice(0, -1));
        else setExpr(expr + key);
        input.current?.focus();
    };

    return ReactDOM.createPortal(
        <aside className="gh-drawer gh-calc">
            <header className="gh-drawer-head">
                <Icon d={I.calc} size={18} />
                <strong>Calculator</strong>
                <button className="gh-tool" onClick={onClose} aria-label="Close"><Icon d={I.x} /></button>
            </header>

            <div className={"gh-calc-screen" + (error ? " gh-err" : "")}>
                <input ref={input} autoFocus value={expr} spellCheck={false} placeholder="0"
                    onChange={e => setExpr(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === "Enter") commit();
                        else if (e.key === "Escape") expr ? setExpr("") : onClose();
                    }} />
                <output>{error || (preview ? "= " + preview : " ")}</output>
            </div>

            <div className="gh-calc-keys">
                {KEYS.map(key => (
                    <button key={key} onClick={() => press(key)}
                        className={key === "=" ? "gh-calc-equals" : OPERATORS.has(key) || key === "C" || key === "⌫" ? "gh-calc-op" : ""}>
                        {key}
                    </button>
                ))}
            </div>

            <div className="gh-calc-tape">
                {tape.length > 0 && (
                    <div className="gh-calc-tape-head">
                        <small>History</small>
                        <button onClick={() => { tape.length = 0; repaint(n => n + 1); }}>Clear</button>
                    </div>
                )}
                {tape.map((row, index) => (
                    <div key={tape.length - index} className="gh-calc-row">
                        <button className="gh-calc-row-main" aria-label="Use this answer" onClick={() => press(row.value)}>
                            <small>{row.expr}</small>
                            <span>{row.value}</span>
                        </button>
                        <button className="gh-tool" aria-label="Copy answer" onClick={() => copyWithToast(row.value.replace(/,/g, ""))}>
                            <Icon d={I.copy} size={14} />
                        </button>
                    </div>
                ))}
                {!tape.length && (
                    <p className="gh-hint">Type or tap. Works with brackets, ^, %, sqrt, sin, cos, tan, ln, log, pi, e and ans (the last answer). Enter saves the answer here.</p>
                )}
            </div>
        </aside>,
        portalHost()
    );
}
