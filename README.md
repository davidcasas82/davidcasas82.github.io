# Project Hub

One page for every live project: **https://davidcasas82.github.io/**

Open that URL on a TV, phone, laptop, or car browser. Each card is a large tap target.

## How it stays current

A GitHub Action rebuilds the catalog and republishes the site when:

- something is pushed to this repo
- a project sends a `project-published` repository dispatch
- you click **Run workflow**
- the schedule fires (about every six hours)

It scans GitHub for Pages sites on this account and merges `data/extras.json` (Cloudflare, custom domains, anything that is not GitHub Pages).

Titles and categories live in `data/overrides.json` so a repo named `nohel-delgadillo-site` can show as **Nohel Delgadillo History**.

## Add a project

### GitHub Pages (automatic)

1. Enable GitHub Pages on the repo.
2. Optionally set a nicer title in `data/overrides.json`.
3. Wait for the next scan, or run **Update and publish hub**.

### Anywhere else (photography, Cloudflare, Vercel…)

Add a row to `data/extras.json`:

```json
{
  "id": "my-app",
  "name": "My App",
  "tagline": "What it is",
  "url": "https://example.com",
  "category": "Projects"
}
```

### Instant refresh after another repo deploys

Copy `examples/notify-hub.yml` into that repo and add a `HUB_DISPATCH_TOKEN` secret.

## Private Pages

Public Pages are always discovered. To include **private** repos that have Pages, add a classic PAT with the `repo` scope as the `HUB_TOKEN` secret on this repository.

## Local preview

```bash
cd project-hub
HUB_TOKEN="$(gh auth token)" node scripts/build-catalog.mjs
python3 -m http.server 4173
```

Open http://localhost:4173

## Short URL

The user site URL is the shortest GitHub Pages address for this account:

`https://davidcasas82.github.io/`

To go shorter later, point a custom domain (for example `hub.davidcasasphotography.com`) at this repo in **Settings → Pages → Custom domain**.
