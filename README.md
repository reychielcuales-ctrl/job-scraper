# Job Scraper

Scrapes job listings for AI/automation and operations/VA roles from two sources, then
publishes the merged results as JSON via GitHub Pages so the GitHub Scraper connector
in your CRM can pull real data.

- **scrape.js** (Node, no dependencies) — RemoteOK, Jobicy, We Work Remotely. Uses public
  JSON/RSS feeds, so it's reliable on a schedule.
- **jobspy_scrape.py** (Python, via [JobSpy](https://github.com/speedyapply/JobSpy)) —
  searches LinkedIn, Indeed, ZipRecruiter, and Google Jobs directly by keyword. Wider
  reach, but these boards sometimes rate-limit/block GitHub Actions' IPs — when that
  happens this step just produces fewer (or zero) results instead of failing the run.
- **merge.js** combines both into `docs/output/all_jobs.json`, deduped by URL.

Runs on a schedule via GitHub Actions — no server needed.

## Setup

1. Create a new **public** GitHub repo (Pages needs public, or a Pro/Team account for private Pages).
2. Push this folder's contents to it (see commands below).
3. In the repo: **Settings → Pages** → Source: `Deploy from a branch` → Branch: `main` / folder: `/docs` → Save.
4. Wait ~1 minute, then your JSON will be live at:
   `https://<your-username>.github.io/<repo-name>/output/all_jobs.json`
5. Paste that URL into the CRM's **GitHub Scraper → Scraper Output URL (JSON)** field and click **Test Connection**.
6. The workflow (`.github/workflows/scrape.yml`) runs every 6 hours automatically, and can
   also be triggered manually from the repo's **Actions** tab (**Run workflow**).

## Editing keywords

- Edit the `KEYWORDS` array in `scrape.js` to change what the RemoteOK/Jobicy/WWR source matches.
- Edit `SEARCH_TERMS` in `jobspy_scrape.py` to change what LinkedIn/Indeed/ZipRecruiter/Google Jobs search for.
