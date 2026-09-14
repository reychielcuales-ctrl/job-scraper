"""Second job source: searches LinkedIn/Indeed/ZipRecruiter/Google Jobs directly by keyword
via the JobSpy library (https://github.com/speedyapply/JobSpy).

Runs alongside scrape.js (RemoteOK/Jobicy/We Work Remotely). Kept as a *separate* source
rather than merged into scrape.js because these boards actively rate-limit/block datacenter
IPs (GitHub Actions runners included) — a failure here must not take down the Node scraper's
output. Each search term/site failure is caught and logged; whatever succeeds still ships.
"""

import json
import math
import sys
from pathlib import Path

from jobspy import scrape_jobs


def clean(value, default=""):
    """pandas represents a missing cell as NaN (a float), which json.dumps writes as a
    bareword `NaN` — not valid JSON, and merge.js's JSON.parse chokes on it. Normalize any
    NaN/None to a plain default so the output is always strictly valid JSON."""
    if value is None:
        return default
    if isinstance(value, float) and math.isnan(value):
        return default
    return value

SEARCH_TERMS = [
    "virtual assistant",
    "executive assistant",
    "property management",
    "insurance operations",
    "AI automation specialist",
    "workflow automation",
]

SITES = ["indeed", "linkedin", "zip_recruiter", "google"]

OUTPUT_PATH = Path(__file__).parent / "docs" / "output" / "jobspy_jobs.json"


def run_search(term):
    try:
        df = scrape_jobs(
            site_name=SITES,
            search_term=term,
            google_search_term=f"{term} remote jobs",
            location="Remote",
            is_remote=True,
            results_wanted=15,
            hours_old=168,  # last 7 days
        )
    except Exception as err:  # a blocked/rate-limited site should not kill the whole run
        print(f"[jobspy] search '{term}' failed: {err}", file=sys.stderr)
        return []

    if df is None or df.empty:
        return []

    jobs = []
    for _, row in df.iterrows():
        title = clean(row.get("title"))
        url = clean(row.get("job_url"))
        if not title or not url:
            continue
        jobs.append({
            "title": title,
            "company": clean(row.get("company")),
            "url": url,
            "source": f"JobSpy/{clean(row.get('site'), 'unknown')}",
            "date": str(clean(row.get("date_posted"))),
            "tags": [],
        })
    return jobs


def main():
    all_jobs = []
    for term in SEARCH_TERMS:
        found = run_search(term)
        print(f"[jobspy] '{term}' -> {len(found)} jobs")
        all_jobs.extend(found)

    # De-dupe by URL
    seen = set()
    deduped = []
    for j in all_jobs:
        if j["url"] in seen:
            continue
        seen.add(j["url"])
        deduped.append(j)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(deduped, indent=2))
    print(f"[jobspy] wrote {len(deduped)} jobs to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
