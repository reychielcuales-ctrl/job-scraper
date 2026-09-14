// Combines the Node scraper's output (docs/output/node_jobs.json) and JobSpy's output
// (docs/output/jobspy_jobs.json) into the single file the CRM actually reads:
// docs/output/all_jobs.json. Either source file may be missing (e.g. JobSpy got blocked
// and never wrote one) — that's not an error, we just publish whatever exists.

const fs = require('fs');
const path = require('path');

const DOCS_OUTPUT = path.join(__dirname, 'docs', 'output');
const FINAL_PATH = path.join(DOCS_OUTPUT, 'all_jobs.json');

function readJobs(filename) {
  const filePath = path.join(DOCS_OUTPUT, filename);
  if (!fs.existsSync(filePath)) {
    console.log(`${filename} not found, skipping`);
    return [];
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(data) ? data : (Array.isArray(data.jobs) ? data.jobs : []);
}

function main() {
  const nodeJobs = readJobs('node_jobs.json');
  const jobspyJobs = readJobs('jobspy_jobs.json');

  const seen = new Set();
  const merged = [...nodeJobs, ...jobspyJobs].filter((j) => {
    if (!j.url || seen.has(j.url)) return false;
    seen.add(j.url);
    return true;
  });

  const output = {
    generatedAt: new Date().toISOString(),
    count: merged.length,
    sources: { node: nodeJobs.length, jobspy: jobspyJobs.length },
    jobs: merged
  };

  fs.writeFileSync(FINAL_PATH, JSON.stringify(output, null, 2));
  console.log(`Merged ${merged.length} jobs (${nodeJobs.length} node + ${jobspyJobs.length} jobspy, deduped) -> ${FINAL_PATH}`);
}

main();
