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

// --- Source 4: Workable (public per-company widget API) ---
// Workable has no cross-company keyword search — its public API only exposes
// one company's board at a time: GET /api/v1/widget/accounts/{slug}. So this
// isn't a keyword search like the other sources; it's a curated watchlist of
// companies (their Workable board slug — the part after apply.workable.com/
// or jobs.workable.com/ for that employer) whose *own* postings we then
// filter by KEYWORDS, same as everywhere else.
//
// Add real companies you're targeting below. The ones here are just
// placeholders to prove the wiring works — replace them with employers you
// actually want to watch.
const WORKABLE_COMPANIES = [
  'zapier', 'buffer', 'doist', 'toggl', 'gorgias'
];
// Capped to the first 10 companies per run — this is a handful of plain GET
// requests to a public widget endpoint (the same one Workable's own embed
// widget calls on customers' career pages), so it's in no danger of
// triggering anything on its own; the cap is just to keep the list
// intentional rather than growing unbounded.
const WORKABLE_LIMIT = 10;

async function scrapeWorkable() {
  const slugs = WORKABLE_COMPANIES.slice(0, WORKABLE_LIMIT);
  const all = [];
  for (const slug of slugs) {
    try {
      const data = await fetchJson(`https://apply.workable.com/api/v1/widget/accounts/${slug}`);
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      for (const j of jobs) {
        const searchText = `${j.title || ''} ${j.department || ''} ${j.function || ''} ${j.industry || ''}`;
        if (!matchesKeywords(searchText)) continue;
        const location = [j.city, j.state, j.country].filter(Boolean).join(', ');
        all.push({
          title: j.title || '',
          company: data.name || slug,
          url: j.shortlink || j.url || '',
          source: 'Workable',
          date: j.published_on || j.created_at || '',
          tags: [j.employment_type, j.telecommuting ? 'Remote' : location].filter(Boolean)
        });
      }
    } catch (err) {
      // A 404 just means that slug doesn't exist / isn't on Workable — not worth failing the run over.
      console.error(`Workable company '${slug}' failed:`, err.message);
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
