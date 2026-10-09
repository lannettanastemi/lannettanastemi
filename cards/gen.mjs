// Терминал с git log (закрытые коммиты зацензурены) и карта «когда я коммичу» для профиля GitHub.
// node cards/gen.mjs [outDir]   — без GITHUB_TOKEN рисует демо-данные.
// Чтобы видеть закрытые репозитории, нужен личный токен (secret PROFILE_TOKEN): с GITHUB_TOKEN Actions
// виден только этот репозиторий — тогда терминал собирается из календаря контрибуций.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOGIN = process.env.GH_LOGIN || 'lannettanastemi';
const OUT = process.argv[2] || 'dist';
const TZ = 'Asia/Qyzylorda';
const TZ_LABEL = 'UTC+5';
const W = 743;
const PAD = 16;
const FONT = "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const LINES = 8;
const CELL = 11;
const GAP = 3;
const DAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const THEMES = {
    dark: { levels: ['rgba(255,255,255,0.055)', '#12306f', '#1c46c4', '#1854ff', '#7398ff'], text: '#5b5b60', head: '#f2f2f2', accent: '#7398ff', bar: 'rgba(255,255,255,0.13)', border: 'rgba(255,255,255,0.09)' },
    light: { levels: ['#ebedf0', '#c3d1ff', '#7398ff', '#1854ff', '#12306f'], text: '#8c8c93', head: '#0b0b0d', accent: '#1854ff', bar: 'rgba(11,11,13,0.14)', border: 'rgba(11,11,13,0.1)' },
};

const esc = s => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

async function gql(query, variables) {
    const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `bearer ${process.env.GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'cards-gen' },
        body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
    return json.data;
}

const REPOS = `query($id: ID!) { viewer { repositories(first: 100, ownerAffiliations: [OWNER, ORGANIZATION_MEMBER, COLLABORATOR], orderBy: {field: PUSHED_AT, direction: DESC}) {
    nodes { isPrivate isFork defaultBranchRef { target { ... on Commit { history(first: 100, author: {id: $id}) {
        nodes { oid authoredDate messageHeadline } } } } } } } } }`;

const CALENDAR = `query($login: String!) { user(login: $login) { contributionsCollection { contributionCalendar {
    weeks { contributionDays { date contributionCount } } } } } }`;

// Коммиты: { oid, date, msg, private }. С личным токеном — настоящие, иначе — из календаря (без часов).
async function fetchCommits() {
    if (!process.env.GITHUB_TOKEN) return { commits: demo(), hours: true };
    const { viewer } = await gql('{ viewer { id login } }').catch(() => ({ viewer: {} }));
    if (viewer.login === LOGIN) {
        const data = await gql(REPOS, { id: viewer.id });
        const seen = new Set();
        const commits = [];
        for (const repo of data.viewer.repositories.nodes) {
            if (repo.isFork) continue;
            for (const c of repo.defaultBranchRef?.target?.history?.nodes || []) {
                if (seen.has(c.oid)) continue;
                seen.add(c.oid);
                commits.push({ oid: c.oid, date: new Date(c.authoredDate), msg: c.messageHeadline, private: repo.isPrivate });
            }
        }
        return { commits: commits.sort((a, b) => b.date - a.date), hours: true };
    }
    const data = await gql(CALENDAR, { login: LOGIN });
    const days = data.user.contributionsCollection.contributionCalendar.weeks.flatMap(w => w.contributionDays).reverse();
    const commits = [];
    for (const day of days) {
        for (let i = 0; i < day.contributionCount && commits.length < LINES; i++) {
            const oid = createHash('sha1').update(`${LOGIN}/${day.date}/${i}`).digest('hex');
            commits.push({ oid, date: new Date(`${day.date}T12:00:00Z`), msg: 'x'.repeat(14 + (parseInt(oid.slice(8, 12), 16) % 40)), private: true, dayOnly: true });
        }
        if (commits.length >= LINES) break;
    }
    return { commits, hours: false };
}

function demo() {
    const commits = [];
    let t = Date.now() - 3600e3;
    for (let i = 0; i < 400; i++) {
        const oid = createHash('sha1').update(String(i)).digest('hex');
        const hour = [10, 14, 16, 20, 22, 23, 0, 1, 2][i % 9];
        const d = new Date(t);
        d.setUTCHours((hour - 5 + 24) % 24, i % 60);
        commits.push({ oid, date: d, msg: i % 5 ? 'x'.repeat(10 + (i * 7) % 45) : 'snake: перерисовать на кривых', private: i % 5 !== 0 });
        t -= (Math.random() * 30 + 2) * 3600e3;
    }
    return commits;
}

const local = date => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', hourCycle: 'h23', day: 'numeric', month: 'numeric' })
        .formatToParts(date).map(p => [p.type, p.value]));
    return { day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday), hour: Number(parts.hour) % 24, date: Number(parts.day), month: Number(parts.month) - 1 };
};

function ago(c, now) {
    const min = Math.floor((now - c.date) / 6e4);
    const days = Math.floor((now - c.date) / 864e5);
    if (c.dayOnly) return days < 1 ? 'сегодня' : days < 2 ? 'вчера' : days < 30 ? `${days} дн. назад` : `${local(c.date).date} ${MONTHS[local(c.date).month]}`;
    if (min < 60) return `${Math.max(1, min)} мин назад`;
    if (min < 1440) return `${Math.floor(min / 60)} ч назад`;
    if (days < 2) return 'вчера';
    if (days < 30) return `${days} дн. назад`;
    return `${local(c.date).date} ${MONTHS[local(c.date).month]}`;
}

function terminal(commits, theme) {
    const LH = 22;
    const CW = 7.22;
    const H = PAD * 2 + LH * (LINES + 2) - 6;
    const cmd = `git log --oneline -${LINES}`;
    const typeStart = 400;
    const typeStep = 55;
    const linesStart = typeStart + cmd.length * typeStep + 350;
    const lineStep = 110;
    const shown = commits.slice(0, LINES);
    const doneAt = linesStart + shown.length * lineStep + 200;
    const base = n => PAD + 13 + n * LH;
    const promptX = PAD + 4 * CW;

    const css = [
        `.k{opacity:0;animation:k 1ms linear forwards}`,
        `.l{opacity:0;animation:l .35s ease-out forwards}`,
        `.u{opacity:0;animation:k 1ms linear forwards,b 1.1s steps(1) ${doneAt}ms infinite}`,
        `@keyframes k{to{opacity:1}}`,
        `@keyframes l{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}`,
        `@keyframes b{50%{opacity:0}}`,
        `@media (prefers-reduced-motion:reduce){.k,.l,.u{animation:none;opacity:1}}`,
    ].join('');

    const prompt = (n, cls = '', delay = 0) => {
        const a = cls ? ` class="${cls}" style="animation-delay:${delay}ms"` : '';
        return `<text x="${PAD}" y="${base(n)}" fill="${theme.text}"${a}>~</text><text x="${PAD + 2 * CW}" y="${base(n)}" fill="${theme.accent}"${a}>$</text>`;
    };

    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
    out.push(`<title>${LOGIN}: git log</title><style>${css}</style>`);
    out.push(`<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="8" fill="none" stroke="${theme.border}"/>`);
    out.push(`<g font-family="${FONT}" font-size="12">`);
    out.push(prompt(0));
    [...cmd].forEach((ch, i) => {
        if (ch !== ' ') out.push(`<text class="k" x="${(promptX + i * CW).toFixed(2)}" y="${base(0)}" fill="${theme.head}" style="animation-delay:${typeStart + i * typeStep}ms">${esc(ch)}</text>`);
    });
    shown.forEach((c, i) => {
        const y = base(i + 1);
        const msgX = PAD + 9 * CW;
        const parts = [`<text x="${PAD}" y="${y}" fill="${theme.accent}">${c.oid.slice(0, 7)}</text>`];
        if (c.private) {
            const w = Math.min(Math.max(c.msg.length, 8), 60) * CW;
            parts.push(`<rect x="${msgX}" y="${y - 9}" width="${w.toFixed(1)}" height="11" rx="2" fill="${theme.bar}"/>`);
        } else {
            const msg = c.msg.length > 64 ? `${c.msg.slice(0, 63)}…` : c.msg;
            parts.push(`<text x="${msgX}" y="${y}" fill="${theme.head}">${esc(msg)}</text>`);
        }
        parts.push(`<text x="${W - PAD}" y="${y}" text-anchor="end" fill="${theme.text}">${c.private ? 'private · ' : ''}${ago(c, Date.now())}</text>`);
        out.push(`<g class="l" style="animation-delay:${linesStart + i * lineStep}ms">${parts.join('')}</g>`);
    });
    const last = shown.length + 1;
    out.push(prompt(last, 'k', doneAt));
    out.push(`<rect class="u" x="${promptX}" y="${base(last) - 10}" width="${CW.toFixed(2)}" height="13" fill="${theme.accent}" style="animation-delay:${doneAt}ms"/>`);
    out.push('</g></svg>');
    return out.join('\n');
}

function hours(commits, theme, hasHours) {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const c of hasHours ? commits : []) {
        const { day, hour } = local(c.date);
        grid[day][hour]++;
    }
    const max = Math.max(1, ...grid.flat());
    const lvl = n => (!n ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
    const total = grid.flat().reduce((a, b) => a + b, 0);
    const byHour = Array.from({ length: 24 }, (_, h) => grid.reduce((a, row) => a + row[h], 0));
    const peak = byHour.indexOf(Math.max(...byHour));
    const night = byHour.slice(0, 6).reduce((a, b) => a + b, 0);
    const weekend = grid[5].concat(grid[6]).reduce((a, b) => a + b, 0);
    const pct = n => `${Math.round((n / Math.max(1, total)) * 100)}%`;

    const TOP = 34;
    const gx = PAD + 24;
    const H = TOP + 7 * (CELL + GAP) - GAP + PAD;
    const r = +Math.max(1.2, CELL * 0.22).toFixed(2);
    const x = h => gx + h * (CELL + GAP);
    const y = d => TOP + d * (CELL + GAP);
    const sx = x(24) + 40;

    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
    out.push(`<title>${LOGIN}: когда я коммичу</title>`);
    out.push(`<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="8" fill="none" stroke="${theme.border}"/>`);
    out.push(`<g font-family="${FONT}" font-size="10" fill="${theme.text}">`);
    for (const h of [0, 6, 12, 18]) out.push(`<text x="${x(h)}" y="${TOP - 8}">${String(h).padStart(2, '0')}</text>`);
    DAYS.forEach((d, i) => { if (i % 2 === 0) out.push(`<text x="${PAD}" y="${y(i) + 9}">${d}</text>`); });
    out.push('</g>');
    grid.forEach((row, d) => row.forEach((n, h) => {
        out.push(`<rect x="${x(h)}" y="${y(d)}" width="${CELL}" height="${CELL}" rx="${r}" fill="${theme.levels[lvl(n)]}"><title>${DAYS[d]} ${String(h).padStart(2, '0')}:00 — ${n}</title></rect>`);
    }));
    out.push(`<g font-family="${FONT}" font-size="12">`);
    out.push(`<text x="${sx}" y="${TOP - 8}" font-size="10" fill="${theme.text}">когда я коммичу · ${TZ_LABEL}</text>`);
    const rows = hasHours && total
        ? [['пик', `${String(peak).padStart(2, '0')}:00–${String((peak + 1) % 24).padStart(2, '0')}:00`], ['ночью, 00–06', pct(night)], ['в выходные', pct(weekend)], ['коммитов', String(total)]]
        : [['нет данных', '']];
    rows.forEach(([k, v], i) => {
        const ry = TOP + 9 + i * 22;
        out.push(`<text x="${sx}" y="${ry}" fill="${theme.text}">${k}</text><text x="${W - PAD}" y="${ry}" text-anchor="end" fill="${i === 0 ? theme.accent : theme.head}">${v}</text>`);
    });
    out.push('</g></svg>');
    return out.join('\n');
}

const { commits, hours: hasHours } = await fetchCommits();
mkdirSync(OUT, { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) {
    writeFileSync(join(OUT, `log-${name}.svg`), terminal(commits, theme));
    writeFileSync(join(OUT, `hours-${name}.svg`), hours(commits, theme, hasHours));
}
console.log(`${process.env.GITHUB_TOKEN ? LOGIN : 'demo'}: ${commits.length} commits${hasHours ? '' : ' (calendar only)'} → ${OUT}/{log,hours}-{dark,light}.svg`);
