// Змейка из портфолио (src/site/Outro.jsx) → анимированный SVG для профиля GitHub.
// node snake/gen.mjs [outDir]   — без GITHUB_TOKEN рисует демо-данные.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOGIN = process.env.GH_LOGIN || 'lannettanastemi';
const OUT = process.argv[2] || 'dist';
const CELL = 11;
const GAP = 3;
const TOP = 20;
const PAD = 2;
const STEP = 85;
const LEN = 5;
const REGROW = 34;
const GROW = 12;
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const THEMES = {
    dark: { levels: ['rgba(255,255,255,0.055)', '#12306f', '#1c46c4', '#1854ff', '#7398ff'], text: '#5b5b60', head: '#f2f2f2', tail: '115,152,255' },
    light: { levels: ['#ebedf0', '#c3d1ff', '#7398ff', '#1854ff', '#12306f'], text: '#8c8c93', head: '#0b0b0d', tail: '24,84,255' },
};
const level = n => (!n ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 10 ? 3 : 4);

const QUERY = `query($login: String!) { user(login: $login) { contributionsCollection { contributionCalendar {
    weeks { contributionDays { date weekday contributionCount } } } } } }`;

async function fetchWeeks() {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return demo();
    const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'snake-gen' },
        body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
    });
    const json = await res.json();
    if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
    return json.data.user.contributionsCollection.contributionCalendar.weeks
        .map(w => w.contributionDays.map(d => ({ date: d.date, d: d.weekday, n: d.contributionCount })));
}

function demo() {
    const end = Date.now();
    const start = end - (52 * 7 + new Date(end).getUTCDay()) * 864e5;
    const weeks = [];
    for (let t = start; t <= end; t += 864e5) {
        const d = new Date(t).getUTCDay();
        if (d === 0) weeks.push([]);
        weeks[weeks.length - 1].push({ date: new Date(t).toISOString().slice(0, 10), d, n: Math.random() < 0.3 ? Math.ceil(Math.random() ** 2 * 14) : 0 });
    }
    return weeks;
}

function buildGrid(weeks) {
    const cells = [];
    const months = [];
    let lastMonth = -1;
    weeks.forEach((days, w) => {
        for (const day of days) cells.push({ w, d: day.d, n: day.n, lvl: level(day.n) });
        const m = Number(days[0].date.slice(5, 7)) - 1;
        if (m !== lastMonth) { if (lastMonth !== -1 || days[0].d === 0) months.push([w, MONTHS[m]]); lastMonth = m; }
    });
    return { cells, months };
}

function buildPath(cells, weeks) {
    const key = (w, d) => w * 7 + d;
    const ok = new Set(cells.map(c => key(c.w, c.d)));
    const food = new Set(cells.filter(c => c.n).map(c => key(c.w, c.d)));
    const path = [];
    for (let i = -LEN; i <= 0; i++) path.push([i, 3]);
    const eat = new Map();
    let [w, d] = path[path.length - 1];
    while (food.size) {
        const prev = new Map([[key(w, d), null]]);
        const queue = [[w, d]];
        let hit = null;
        while (queue.length && !hit) {
            const [cw, cd] = queue.shift();
            for (const [dw, dd] of [[1, 0], [0, 1], [0, -1], [-1, 0]]) {
                const nw = cw + dw;
                const nd = cd + dd;
                const k = key(nw, nd);
                if (nd < 0 || nd > 6 || !ok.has(k) || prev.has(k)) continue;
                prev.set(k, [cw, cd]);
                if (food.has(k)) { hit = [nw, nd]; break; }
                queue.push([nw, nd]);
            }
        }
        if (!hit) break;
        const steps = [];
        for (let p = hit; p && key(...p) !== key(w, d); p = prev.get(key(...p))) steps.unshift(p);
        path.push(...steps);
        food.delete(key(...hit));
        eat.set(key(...hit), path.length - 1);
        [w, d] = hit;
    }
    while (w < weeks + LEN) path.push([++w, d]);
    return { path, eat, key };
}

function render(weeks, theme) {
    const { cells, months } = buildGrid(weeks);
    const { path, eat, key } = buildPath(cells, weeks.length);
    const N = path.length;
    const T = N * STEP;
    const x = w => PAD + w * (CELL + GAP);
    const y = d => PAD + TOP + d * (CELL + GAP);
    const W = PAD * 2 + weeks.length * (CELL + GAP) - GAP;
    const H = PAD * 2 + TOP + 7 * (CELL + GAP) - GAP;
    const r = +Math.max(1.2, CELL * 0.22).toFixed(2);
    const pct = i => `${+((i / N) * 100).toFixed(4)}%`;
    const at = p => `{transform:translate(${x(p[0])}px,${y(p[1])}px)}`;

    // Ключевые кадры головы только на поворотах — между ними CSS сам ведёт по прямой.
    const turns = [0];
    for (let i = 1; i < N - 1; i++) {
        const a = path[i - 1], b = path[i], c = path[i + 1];
        if (b[0] - a[0] !== c[0] - b[0] || b[1] - a[1] !== c[1] - b[1]) turns.push(i);
    }
    turns.push(N - 1);
    const move = turns.map(i => `${pct(i)}${at(path[i])}`).join('') + `100%${at(path[N - 1])}`;

    const css = [
        `.c{transform-box:fill-box;transform-origin:center;animation:g ${T}ms linear infinite both}`,
        `.s{animation:m ${T}ms linear infinite backwards}`,
        `@keyframes g{0%,${pct(REGROW)}{transform:scale(0);opacity:0;animation-timing-function:cubic-bezier(.34,1.56,.64,1)}${pct(REGROW + GROW)},100%{transform:scale(1);opacity:1}}`,
        `@keyframes m{${move}}`,
        '@media (prefers-reduced-motion:reduce){.c{animation:none}.s{display:none}}',
    ].join('');

    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
    out.push(`<title>${LOGIN}: contributions</title><style>${css}</style>`);
    out.push(`<g fill="${theme.text}" font-family="'JetBrains Mono',ui-monospace,Consolas,monospace" font-size="10">`);
    for (const [w, t] of months) if (x(w) + 20 <= W) out.push(`<text x="${x(w)}" y="${PAD + 10}">${t}</text>`);
    out.push('</g>');
    for (const c of cells) out.push(`<rect x="${x(c.w)}" y="${y(c.d)}" width="${CELL}" height="${CELL}" rx="${r}" fill="${theme.levels[0]}"/>`);
    for (const c of cells) {
        if (!c.lvl) continue;
        const e = eat.get(key(c.w, c.d));
        const anim = e == null ? '' : ` class="c" style="animation-delay:${(e - N) * STEP}ms"`;
        out.push(`<rect x="${x(c.w)}" y="${y(c.d)}" width="${CELL}" height="${CELL}" rx="${r}" fill="${theme.levels[c.lvl]}"${anim}/>`);
    }
    for (let s = LEN - 1; s >= 0; s--) {
        const k = 1 - s / LEN;
        const size = +(CELL * (0.55 + 0.45 * k)).toFixed(2);
        const off = +((CELL - size) / 2).toFixed(2);
        const fill = s === 0 ? theme.head : `rgba(${theme.tail},${+(0.35 + 0.6 * k).toFixed(2)})`;
        out.push(`<rect class="s" x="${off}" y="${off}" width="${size}" height="${size}" rx="${+(size / 3).toFixed(2)}" fill="${fill}" style="animation-delay:${s * STEP}ms"/>`);
    }
    out.push('</svg>');
    return out.join('\n');
}

const weeks = await fetchWeeks();
mkdirSync(OUT, { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) writeFileSync(join(OUT, `snake-${name}.svg`), render(weeks, theme));
const total = weeks.flat().reduce((a, d) => a + d.n, 0);
console.log(`${process.env.GITHUB_TOKEN ? LOGIN : 'demo'}: ${total} contributions → ${OUT}/snake-{dark,light}.svg`);
