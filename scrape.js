// Job scraper for freelance AI/automation + ops/VA roles.
// Pulls from public JSON/RSS job feeds, filters by keyword, writes docs/output/all_jobs.json.
// Runs on Node 20+ (built-in fetch), no npm dependencies required.

const fs = require('fs');
const path = require('path');

const KEYWORDS = [
  // AI / automation — the actual freelance niche
  'ai automation', 'automation specialist', 'automation engineer', 'workflow automation',
  'process automation', 'n8n', 'zapier', 'make.com', 'ai agent', 'ai workflow',
  'no-code automation', 'low-code automation', 'prompt engineer', 'rpa',
  // Virtual/executive assistant roles
  'virtual assistant', 'executive assistant', 'administrative virtual assistant',
  'admin virtual assistant', 'remote executive assistant',
  // Property management (matches Richelle's actual background)
  'property manager', 'property management', 'leasing assistant', 'tenant coordinator',
  'appfolio', 'doorloop', 'ownerrez', 'hoa management', 'real estate virtual assistant',
  // Insurance operations
  'insurance assistant', 'insurance operations', 'insurance agency', 'p&c agent',
  'policy processing', 'claims processing', 'ezlynx', 'hawksoft', 'insurance account manager'
];

// Writes this source's own file — jobspy_scrape.py writes a sibling file, and merge.js
// combines both into docs/output/all_jobs.json (the one the CRM actually points at).
const OUTPUT_PATH = path.join(__dirname, 'docs', 'output', 'node_jobs.json');

// Word-boundary regexes, not plain substring checks — a loose .includes() match lets a
// short/generic keyword hit inside unrelated words (e.g. 'ea to' inside "idea together").
const KEYWORD_PATTERNS = KEYWORDS.map(
  (kw) => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
);

function matchesKeywords(text) {
  const lower = (text || '').toLowerCase();
  return KEYWORD_PATTERNS.some((re) => re.test(lower));
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'job-scraper-bot', ...headers } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'job-scraper-bot' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

// --- Source 1: RemoteOK (public JSON API) ---
async function scrapeRemoteOk() {
  const data = await fetchJson('https://remoteok.com/api');
  const jobs = Array.isArray(data) ? data.slice(1) : []; // first entry is metadata
  return jobs
    .filter((j) => j.position || j.title)
    .map((j) => ({
      title: j.position || j.title,
      company: j.company || '',
      url: j.url || j.apply_url || '',
      source: 'RemoteOK',
      date: j.date || '',
      tags: Array.isArray(j.tags) ? j.tags : [],
      // Deliberately excludes j.tags — RemoteOK slaps generic boilerplate tags (e.g.
      // "virtual assistant") on many unrelated postings, so tags alone are unreliable signal.
      searchText: `${j.position || ''} ${j.description || ''}`
    }))
    .filter((j) => matchesKeywords(j.searchText))
    .map(({ searchText, ...rest }) => rest);
}

// --- Source 2: Jobicy (public JSON API) ---
async function scrapeJobicy() {
  const data = await fetchJson('https://jobicy.com/api/v2/remote-jobs?count=100');
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  return jobs
    .map((j) => ({
      title: j.jobTitle || '',
      company: j.companyName || '',
      url: j.url || '',
      source: 'Jobicy',
      date: j.pubDate || '',
      tags: Array.isArray(j.jobIndustry) ? j.jobIndustry : [],
      searchText: `${j.jobTitle || ''} ${j.jobExcerpt || ''} ${(j.jobIndustry || []).join(' ')} ${(j.jobType || []).join(' ')}`
    }))
    .filter((j) => matchesKeywords(j.searchText))
    .map(({ searchText, ...rest }) => rest);
}

// --- Source 3: We Work Remotely RSS (customer support / mgmt-finance / hr categories) ---
async function scrapeWeWorkRemotely() {
  const feeds = [
    'https://weworkremotely.com/categories/remote-customer-support-jobs.rss',
    'https://weworkremotely.com/categories/remote-management-and-finance-jobs.rss',
    'https://weworkremotely.com/categories/remote-hr-jobs.rss'
  ];
  const all = [];
  for (const feedUrl of feeds) {
    try {
      const xml = await fetchText(feedUrl);
      const items = xml.split('<item>').slice(1);
      for (const item of items) {
        const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
        const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
        const descMatch = item.match(/<description>([\s\S]*?)<\/description>/);
        const dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
        const rawTitle = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
        const [company, ...titleParts] = rawTitle.split(':');
        const title = titleParts.length ? titleParts.join(':').trim() : rawTitle;
        const desc = stripHtml(descMatch ? descMatch[1] : '');
        const job = {
          title: title || rawTitle,
          company: titleParts.length ? company.trim() : '',
          url: linkMatch ? linkMatch[1].trim() : '',
          source: 'We Work Remotely',
          date: dateMatch ? dateMatch[1].trim() : '',
          tags: [],
          searchText: `${rawTitle} ${desc}`
        };
        if (matchesKeywords(job.searchText)) {
          const { searchText, ...rest } = job;
          all.push(rest);
        }
      }
    } catch (err) {
      console.error(`WWR feed failed (${feedUrl}):`, err.message);
    }
  }
  return all;
}

// --- Source 4: Workable (public cross-company job search) ---
// jobs.workable.com/search is Workable's own public jobs board, aggregating
// postings across every Workable-hosted employer. Its results page embeds a
// call to `GET https://jobs.workable.com/api/v1/jobs?query=...` — a plain,
// unauthenticated JSON endpoint (confirmed live: real title/company/url/
// location/employmentType/workplace fields, no key, no login) — so we call
// that directly instead of scraping the rendered page.
//
// One request per search term, first page only (~20 results each) — a
// handful of GETs to a public search API, well short of anything that would
// look like abuse. Each term's results still go through matchesKeywords()
// same as every other source, since Workable's own query matching is loose
// (e.g. "insurance operations" can surface unrelated "insurance"-adjacent
// engineering roles).
const WORKABLE_SEARCH_TERMS = [
  'virtual assistant', 'property management', 'insurance operations',
  'ai automation', 'automation specialist', 'workflow automation'
];

async function scrapeWorkable() {
  const all = [];
  for (const term of WORKABLE_SEARCH_TERMS) {
    try {
      const data = await fetchJson(`https://jobs.workable.com/api/v1/jobs?query=${encodeURIComponent(term)}`);
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      for (const j of jobs) {
        const searchText = `${j.title || ''} ${stripHtml(j.description || '')}`;
        if (!matchesKeywords(searchText)) continue;
        const loc = j.location || {};
        const location = [loc.city, loc.subregion, loc.countryName].filter(Boolean).join(', ');
        all.push({
          title: j.title || '',
          company: (j.company && j.company.title) || '',
          url: j.url || '',
          source: 'Workable',
          date: j.created || j.updated || '',
          tags: [j.employmentType, j.workplace === 'remote' ? 'Remote' : location].filter(Boolean)
        });
      }
    } catch (err) {
      console.error(`Workable search '${term}' failed:`, err.message);
    }
  }
  return all;
}

async function main() {
  const results = await Promise.allSettled([
    scrapeRemoteOk(),
    scrapeJobicy(),
    scrapeWeWorkRemotely(),
    scrapeWorkable()
  ]);

  const allJobs = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      allJobs.push(...r.value);
    } else {
      console.error(`Source ${i} failed:`, r.reason?.message || r.reason);
    }
  });

  // De-dupe by URL
  const seen = new Set();
  const deduped = allJobs.filter((j) => {
    if (!j.url || seen.has(j.url)) return false;
    seen.add(j.url);
    return true;
  });

  const output = {
    generatedAt: new Date().toISOString(),
    count: deduped.length,
    jobs: deduped
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${deduped.length} jobs to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
