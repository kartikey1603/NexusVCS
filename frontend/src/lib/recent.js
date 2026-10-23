const KEY = 'nexusvcs_recent_repos';
const MAX = 8;

export function trackRecentRepo(repo) {
  if (!repo?.slug) return;
  const owner = repo.ownerId?.username;
  if (!owner) return;
  try {
    const list = readRecentRepos().filter((r) => !(r.owner === owner && r.slug === repo.slug));
    list.unshift({ owner, slug: repo.slug, name: repo.name, visibility: repo.visibility, visitedAt: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch { /* localStorage unavailable — recents are a convenience, not critical */ }
}

export function readRecentRepos() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
