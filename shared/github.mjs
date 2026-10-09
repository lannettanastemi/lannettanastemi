// Общая загрузка данных GitHub для snake/ и cards/.
// Закрытые коммиты видны только с личным токеном (secret PROFILE_TOKEN): fine-grained токенам
// GitHub не отдаёт закрытые контрибуции в календаре, поэтому коммиты собираем из истории репозиториев.

export async function gql(query, variables) {
    const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `bearer ${process.env.GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-gen' },
        body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
    return json.data;
}

const HISTORY = `history(first: 100, after: $after, since: $since, author: {id: $id}) {
    pageInfo { hasNextPage endCursor } nodes { oid authoredDate messageHeadline } }`;

const REPOS = `query($id: ID!, $since: GitTimestamp, $after: String) { viewer { repositories(first: 100, ownerAffiliations: [OWNER, ORGANIZATION_MEMBER, COLLABORATOR], orderBy: {field: PUSHED_AT, direction: DESC}) {
    nodes { id isPrivate isFork defaultBranchRef { target { ... on Commit { ${HISTORY} } } } } } } }`;

const MORE = `query($repo: ID!, $id: ID!, $since: GitTimestamp, $after: String) { node(id: $repo) { ... on Repository {
    defaultBranchRef { target { ... on Commit { ${HISTORY} } } } } } }`;

// Свои коммиты из всех доступных репозиториев (без форков) с `since`, новые сверху: { oid, date, msg, private }.
// null — токен не личный (GITHUB_TOKEN из Actions), закрытых данных не будет.
export async function ownCommits(login, since) {
    if (!process.env.GITHUB_TOKEN) return null;
    const { viewer } = await gql('{ viewer { id login } }').catch(() => ({ viewer: {} }));
    if (viewer.login !== login) return null;
    const vars = { id: viewer.id, since: since.toISOString(), after: null };
    const data = await gql(REPOS, vars);
    const seen = new Set();
    const commits = [];
    for (const repo of data.viewer.repositories.nodes) {
        if (repo.isFork) continue;
        let history = repo.defaultBranchRef?.target?.history;
        while (history) {
            for (const c of history.nodes) {
                if (seen.has(c.oid)) continue;
                seen.add(c.oid);
                commits.push({ oid: c.oid, date: new Date(c.authoredDate), msg: c.messageHeadline, private: repo.isPrivate });
            }
            if (!history.pageInfo.hasNextPage) break;
            const more = await gql(MORE, { ...vars, repo: repo.id, after: history.pageInfo.endCursor });
            history = more.node.defaultBranchRef.target.history;
        }
    }
    return commits.sort((a, b) => b.date - a.date);
}
