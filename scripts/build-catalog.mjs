#!/usr/bin/env node
/**
 * Build data/catalog.json from:
 *   1. GitHub Pages sites on this account
 *   2. data/extras.json (Cloudflare, custom domains, anything else live)
 *   3. data/overrides.json (titles, categories, hidden flags)
 *
 * Public repos are always scanned. Private repos with Pages are included
 * when HUB_TOKEN / GITHUB_TOKEN can see them (a classic PAT with `repo`).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = process.env.HUB_OWNER || "davidcasas82";
const HUB_REPO = `${OWNER}.github.io`;
const HUB_TOKEN = process.env.HUB_TOKEN || "";
const TOKEN = HUB_TOKEN || process.env.GITHUB_TOKEN || "";
const SCAN_PRIVATE = Boolean(HUB_TOKEN);

const extras = readJson("data/extras.json", []);
const overrides = readJson("data/overrides.json", {});

function readJson(rel, fallback) {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
  } catch {
    return fallback;
  }
}

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "project-hub-catalog",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${res.status} ${path}: ${body}`);
  }
  return res.json();
}

async function listOwnedRepos() {
  const repos = [];
  // Only a user PAT (HUB_TOKEN) can list private repos via /user/repos.
  // The default Actions token is repo-scoped, so fall back to public listing.
  const base = SCAN_PRIVATE
    ? `/user/repos?per_page=100&affiliation=owner&sort=updated`
    : `/users/${OWNER}/repos?per_page=100&type=owner&sort=updated`;

  for (let page = 1; page <= 10; page++) {
    const batch = await gh(`${base}&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.filter((r) => r.owner?.login === OWNER || !r.owner);
}

function prettyName(repoName) {
  return repoName
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function pagesEntry(repo) {
  if (repo.name === HUB_REPO) return null;

  const pages = await gh(`/repos/${OWNER}/${repo.name}/pages`);
  if (!pages?.html_url) return null;

  const over = overrides[repo.name] || {};
  if (over.hidden) return null;

  return {
    id: repo.name,
    name: over.name || prettyName(repo.name),
    tagline:
      over.tagline ||
      repo.description ||
      "Live on the web",
    url: over.url || pages.html_url,
    category: over.category || "Projects",
    source: "github-pages",
    repo: repo.html_url,
    private: Boolean(repo.private),
    updatedAt: repo.pushed_at || repo.updated_at,
  };
}

function extraEntries() {
  return extras
    .filter((e) => e && e.url && !e.hidden)
    .map((e) => ({
      id: e.id,
      name: e.name || prettyName(e.id),
      tagline: e.tagline || "Live on the web",
      url: e.url,
      category: e.category || "Projects",
      source: e.source || "custom",
      repo: e.repo || null,
      private: Boolean(e.private),
      updatedAt: e.updatedAt || null,
    }));
}

const repos = await listOwnedRepos();
const discovered = [];
for (const repo of repos) {
  if (!repo.has_pages && !overrides[repo.name]?.force) continue;
  try {
    const entry = await pagesEntry(repo);
    if (entry) discovered.push(entry);
  } catch (err) {
    console.warn(`skip ${repo.name}: ${err.message}`);
  }
}

const byId = new Map();
for (const entry of [...discovered, ...extraEntries()]) {
  byId.set(entry.id, { ...(byId.get(entry.id) || {}), ...entry });
}

const projects = [...byId.values()].sort((a, b) => {
  const cat = String(a.category).localeCompare(String(b.category));
  if (cat !== 0) return cat;
  return String(a.name).localeCompare(String(b.name));
});

const catalog = {
  generatedAt: new Date().toISOString(),
  owner: OWNER,
  hubUrl: `https://${HUB_REPO}/`,
  projects,
};

writeFileSync(
  join(ROOT, "data/catalog.json"),
  `${JSON.stringify(catalog, null, 2)}\n`,
);

console.log(
  `Wrote ${projects.length} project${projects.length === 1 ? "" : "s"} to data/catalog.json`,
);
for (const p of projects) {
  console.log(`  - ${p.name}  ${p.url}`);
}
