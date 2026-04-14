#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');

// ── Paths ──────────────────────────────────────────────────────────────────
const ROOT          = path.join(__dirname, '..');
const CONFIG_PATH   = path.join(ROOT, 'dashboard.config.json');
const COVERAGE_PATH = path.join(ROOT, 'coverage', 'coverage-summary.json');
const E2E_PATH      = path.join(ROOT, 'e2e-tests', 'reports', 'cucumber-report.json');
const OUTPUT_DIR    = path.join(ROOT, 'build', 'dashboard');
const OUTPUT_PATH   = path.join(OUTPUT_DIR, 'index.html');
const HISTORY_PATH  = path.join(ROOT, 'build', 'history.json');

// ── Config ─────────────────────────────────────────────────────────────────
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// ── Coverage ───────────────────────────────────────────────────────────────
function readCoverage() {
  try {
    const raw = JSON.parse(fs.readFileSync(COVERAGE_PATH, 'utf8'));
    return {
      statements: raw.total.statements.pct,
      branches:   raw.total.branches.pct,
      functions:  raw.total.functions.pct,
      lines:      raw.total.lines.pct,
      available:  true,
    };
  } catch {
    return { statements: 0, branches: 0, functions: 0, lines: 0, available: false };
  }
}

// ── E2E Results ────────────────────────────────────────────────────────────
function getScenarioStatus(scenario) {
  const steps = scenario.steps || [];
  if (steps.length === 0) return 'skipped';
  for (const step of steps) {
    if (step.result && step.result.status === 'failed') return 'failed';
  }
  for (const step of steps) {
    if (step.result && (step.result.status === 'pending' || step.result.status === 'undefined')) return 'pending';
  }
  for (const step of steps) {
    if (step.result && step.result.status === 'skipped') return 'skipped';
  }
  return 'passed';
}

function readE2E() {
  try {
    const raw = JSON.parse(fs.readFileSync(E2E_PATH, 'utf8'));
    const scenarios   = [];
    const allStepText = [];

    for (const feature of raw) {
      if (!feature.elements) continue;
      for (const element of feature.elements) {
        if (element.type !== 'scenario') continue;
        const status   = getScenarioStatus(element);
        const stepText = (element.steps || []).map(s => s.name || '').join(' ');
        allStepText.push(stepText);
        scenarios.push({ name: element.name, feature: feature.name, status, stepText });
      }
    }

    const passed  = scenarios.filter(s => s.status === 'passed').length;
    const failed  = scenarios.filter(s => s.status === 'failed').length;
    const skipped = scenarios.filter(s => ['skipped', 'pending'].includes(s.status)).length;

    return { total: scenarios.length, passed, failed, skipped, scenarios, allStepText: allStepText.join(' '), available: true };
  } catch {
    return { total: 0, passed: 0, failed: 0, skipped: 0, scenarios: [], allStepText: '', available: false };
  }
}

// ── History ────────────────────────────────────────────────────────────────
function fetchHistory(repo) {
  const [owner, repoName] = repo.split('/');
  const url = `https://${owner.toLowerCase()}.github.io/${repoName.toLowerCase()}/history.json`;
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve([]); }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve([]); } });
    }).on('error', () => resolve([]));
    req.setTimeout(10000, () => { req.destroy(); resolve([]); });
  });
}

// ── Health Score ───────────────────────────────────────────────────────────
function calculateHealthScore(coverage, e2e, history) {
  const { weights } = config.healthScore;

  const unitScore = coverage.available
    ? (coverage.statements + coverage.branches + coverage.functions + coverage.lines) / 4
    : 0;

  const e2eScore = e2e.total > 0 ? (e2e.passed / e2e.total) * 100 : 0;

  const recent = history.slice(-5);
  const stabilityScore = recent.length > 0
    ? (recent.filter(r => r.conclusion === 'success').length / recent.length) * 100
    : 100;

  return Math.round(
    unitScore      * weights.unitCoverage +
    e2eScore       * weights.e2ePassRate +
    stabilityScore * weights.recentStability
  );
}

// ── Improvement Suggestions ────────────────────────────────────────────────
const KNOWN_USER_TYPES     = ['standard_user', 'locked_out_user', 'problem_user', 'performance_glitch_user', 'error_user', 'visual_user'];
const EXPECTED_FEATURES    = ['Login', 'Inventory', 'Cart', 'Checkout'];

function generateSuggestions(coverage, e2e, repo, testRepo) {
  const gh         = 'https://github.com';
  const testBase   = `${gh}/${testRepo}`;
  const appBase    = `${gh}/${repo}`;
  const suggestions = [];

  // 1. Failed scenarios — HIGH
  const failed = e2e.scenarios.filter(s => s.status === 'failed');
  if (failed.length > 0) {
    suggestions.push({
      priority: 'high',
      title:    `${failed.length} failing scenario${failed.length > 1 ? 's' : ''}`,
      detail:   failed.map(s => s.name).join(', '),
      action:   'Investigate and fix failing tests before adding new ones',
      link:     `${appBase}/actions`,
    });
  }

  // 2. Untested user types — HIGH
  const untested = KNOWN_USER_TYPES.filter(u => !e2e.allStepText.includes(u));
  if (untested.length > 0) {
    suggestions.push({
      priority: 'high',
      title:    `${untested.length} user type${untested.length > 1 ? 's' : ''} with no E2E coverage`,
      detail:   untested.join(', '),
      action:   'Add scenarios for each user type to features/login.feature',
      link:     `${testBase}/blob/main/features/login.feature`,
    });
  }

  // 3. Missing application flows — MEDIUM
  const covered = [...new Set(e2e.scenarios.map(s => s.feature))];
  const missing = EXPECTED_FEATURES.filter(f =>
    !covered.some(c => c.toLowerCase().includes(f.toLowerCase()))
  );
  if (missing.length > 0) {
    suggestions.push({
      priority: 'medium',
      title:    `${missing.length} application flow${missing.length > 1 ? 's' : ''} not tested`,
      detail:   missing.join(', '),
      action:   'Create feature files and step definitions for these flows',
      link:     `${testBase}/tree/main/features`,
    });
  }

  // 4. Skipped / pending scenarios — MEDIUM
  const skipped = e2e.scenarios.filter(s => ['skipped', 'pending'].includes(s.status));
  if (skipped.length > 0) {
    suggestions.push({
      priority: 'medium',
      title:    `${skipped.length} scenario${skipped.length > 1 ? 's' : ''} skipped or pending`,
      detail:   skipped.map(s => s.name).join(', '),
      action:   'Implement pending step definitions or re-enable skipped scenarios',
      link:     `${testBase}/tree/main/features`,
    });
  }

  // 5. Coverage gaps — MEDIUM
  if (coverage.available) {
    const gaps = ['statements', 'branches', 'functions', 'lines']
      .filter(m => coverage[m] < config.coverage.thresholds.green);
    if (gaps.length > 0) {
      suggestions.push({
        priority: 'medium',
        title:    `Unit coverage below ${config.coverage.thresholds.green}% threshold`,
        detail:   gaps.map(m => `${m}: ${coverage[m]}%`).join(', '),
        action:   'Add unit tests to cover untested branches and functions',
        link:     `${appBase}/tree/main/src`,
      });
    }
  }

  return suggestions;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function coverageCls(pct) {
  if (pct >= config.coverage.thresholds.green)  return 'green';
  if (pct >= config.coverage.thresholds.yellow) return 'yellow';
  return 'red';
}

function healthInfo(score) {
  if (score >= config.healthScore.thresholds.green)  return { cls: 'green',  label: 'Excellent' };
  if (score >= config.healthScore.thresholds.yellow) return { cls: 'yellow', label: 'Needs Attention' };
  return { cls: 'red', label: 'Critical' };
}

// ── HTML ───────────────────────────────────────────────────────────────────
function renderHTML(coverage, e2e, history, healthScore, suggestions, repo) {
  const now = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
  });

  const { cls: hCls, label: hLabel } = healthInfo(healthScore);

  const coverageRows = coverage.available
    ? ['statements', 'branches', 'functions', 'lines'].map(m => {
        const pct = coverage[m];
        const cls = coverageCls(pct);
        const icon = cls === 'green' ? '🟢' : cls === 'yellow' ? '🟡' : '🔴';
        return `<tr>
          <td>${m.charAt(0).toUpperCase() + m.slice(1)}</td>
          <td><div class="bar"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div></td>
          <td class="${cls}">${pct}%</td>
          <td>${icon}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="4" class="muted">Coverage data unavailable</td></tr>';

  const scenarioRows = e2e.available
    ? e2e.scenarios.map(s => {
        const icon = s.status === 'passed' ? '✅' : s.status === 'failed' ? '❌' : '⚠️';
        return `<li class="scenario ${s.status}">${icon} ${escapeHtml(s.name)}</li>`;
      }).join('')
    : '<li class="muted">E2E data unavailable</li>';

  const historyRows = history.length > 0
    ? [...history].reverse().map(r => {
        const icon = r.conclusion === 'success' ? '✅ Pass' : '❌ Fail';
        const date = new Date(r.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        return `<tr>
          <td>${date}</td>
          <td>${icon}</td>
          <td>${r.healthScore}</td>
          <td>${r.e2ePassed}/${r.e2eTotal}</td>
          <td>${r.coverageAvg}%</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="5" class="muted">No history yet — this is the first run</td></tr>';

  const suggestionCards = suggestions.length > 0
    ? suggestions.map(s => {
        const icon = s.priority === 'high' ? '🔴' : '🟡';
        const card = `<div class="suggestion ${s.priority}${s.link ? ' clickable' : ''}">
          <div class="s-header">${icon} ${s.priority.toUpperCase()} — ${escapeHtml(s.title)}</div>
          <div class="s-detail">${escapeHtml(s.detail)}</div>
          <div class="s-action">→ ${escapeHtml(s.action)}${s.link ? ' <span class="s-link-icon">↗</span>' : ''}</div>
        </div>`;
        return s.link
          ? `<a href="${escapeHtml(s.link)}" target="_blank" rel="noopener" class="suggestion-link">${card}</a>`
          : card;
      }).join('')
    : '<div class="suggestion ok">✅ Test suite looks healthy — no improvements flagged</div>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="${config.dashboard.refreshIntervalSeconds}">
  <title>${config.dashboard.title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #e6edf3; min-height: 100vh; }

    /* Header */
    header { background: #161b22; border-bottom: 1px solid #30363d; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    .header-title h1 { font-size: 1.25rem; font-weight: 600; }
    .header-title p  { font-size: 0.78rem; color: #8b949e; margin-top: 2px; }
    .badge img { height: 22px; vertical-align: middle; }

    /* Layout */
    main { max-width: 1140px; margin: 0 auto; padding: 20px; display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
    .col-12 { grid-column: span 12; }
    .col-6  { grid-column: span 6; }
    .col-4  { grid-column: span 4; }
    @media (max-width: 700px) { .col-6, .col-4 { grid-column: span 12; } }

    /* Cards */
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 18px; }
    .card h2 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: #8b949e; margin-bottom: 14px; }

    /* Health Score */
    .score-value { font-size: 3.2rem; font-weight: 700; line-height: 1; }
    .score-label { font-size: 0.9rem; margin-top: 6px; }
    .green { color: #3fb950; } .yellow { color: #d29922; } .red { color: #f85149; }

    /* E2E summary */
    .e2e-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; text-align: center; }
    .e2e-stat { background: #21262d; border-radius: 6px; padding: 10px 6px; }
    .e2e-stat .n { font-size: 1.7rem; font-weight: 700; }
    .e2e-stat .l { font-size: 0.72rem; color: #8b949e; margin-top: 2px; }
    .e2e-stat.p .n { color: #3fb950; }
    .e2e-stat.f .n { color: #f85149; }
    ul.scenarios { list-style: none; font-size: 0.85rem; }
    ul.scenarios li { padding: 5px 0; border-bottom: 1px solid #21262d; }
    ul.scenarios li:last-child { border-bottom: none; }

    /* Coverage table */
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; padding: 7px 8px; color: #8b949e; font-weight: 500; border-bottom: 1px solid #30363d; }
    td { padding: 7px 8px; border-bottom: 1px solid #21262d; }
    tr:last-child td { border-bottom: none; }
    .bar { background: #21262d; border-radius: 4px; height: 7px; width: 110px; }
    .bar-fill { height: 100%; border-radius: 4px; }
    .bar-fill.green { background: #3fb950; } .bar-fill.yellow { background: #d29922; } .bar-fill.red { background: #f85149; }

    /* Pipeline jobs */
    .jobs { display: flex; gap: 12px; flex-wrap: wrap; }
    .job { background: #21262d; border-radius: 6px; padding: 10px 16px; min-width: 130px; font-size: 0.82rem; }
    .job .jname { color: #8b949e; margin-bottom: 4px; }
    .job .jstatus { font-weight: 600; }
    .job.success .jstatus { color: #3fb950; }
    .job.failure .jstatus { color: #f85149; }
    .job.in_progress .jstatus { color: #d29922; }
    .job.queued .jstatus { color: #8b949e; }

    /* Suggestions */
    .suggestion { border-radius: 6px; padding: 12px 14px; margin-bottom: 10px; border-left: 3px solid; transition: filter 0.15s, transform 0.15s; }
    .suggestion.high   { background: rgba(248,81,73,.1);  border-color: #f85149; }
    .suggestion.medium { background: rgba(210,153,34,.1); border-color: #d29922; }
    .suggestion.ok     { background: rgba(63,185,80,.1);  border-color: #3fb950; color: #3fb950; }
    .suggestion.clickable { cursor: pointer; }
    .suggestion-link { display: block; text-decoration: none; color: inherit; }
    .suggestion-link:hover .suggestion { filter: brightness(1.15); transform: translateX(3px); }
    .s-header { font-weight: 600; font-size: 0.85rem; margin-bottom: 5px; }
    .s-detail { color: #8b949e; font-size: 0.8rem; margin-bottom: 4px; }
    .s-action { font-size: 0.8rem; color: #58a6ff; }
    .s-link-icon { font-size: 0.75rem; opacity: 0.7; }

    .muted { color: #8b949e; font-style: italic; text-align: center; padding: 10px; }
  </style>
</head>
<body>

<header>
  <div class="header-title">
    <h1>🧪 ${escapeHtml(config.dashboard.title)}</h1>
    <p>Last updated: ${now} &nbsp;|&nbsp; Auto-refreshes every ${config.dashboard.refreshIntervalSeconds / 60} min</p>
  </div>
  <a href="https://github.com/${repo}/actions" target="_blank" rel="noopener" class="badge">
    <img src="https://github.com/${repo}/actions/workflows/pipeline.yml/badge.svg" alt="Pipeline status">
  </a>
</header>

<main>

  <!-- Pipeline Status -->
  <div class="card col-12">
    <h2>⚡ Pipeline Status</h2>
    <div class="jobs" id="pipeline-jobs">
      <div class="job queued"><div class="jname">unit-tests</div><div class="jstatus">Loading…</div></div>
      <div class="job queued"><div class="jname">e2e-tests</div><div class="jstatus">Loading…</div></div>
      <div class="job queued"><div class="jname">deploy</div><div class="jstatus">Loading…</div></div>
    </div>
  </div>

  <!-- Health Score -->
  <div class="card col-4">
    <h2>🏆 Test Health Score</h2>
    <div class="score-value ${hCls}">${healthScore}<span style="font-size:1.1rem;color:#8b949e"> / 100</span></div>
    <div class="score-label ${hCls}">${hLabel}</div>
  </div>

  <!-- E2E Summary -->
  <div class="card col-4">
    <h2>✅ E2E Results</h2>
    <div class="e2e-grid">
      <div class="e2e-stat">  <div class="n">${e2e.total}</div>  <div class="l">Total</div></div>
      <div class="e2e-stat p"><div class="n">${e2e.passed}</div> <div class="l">Passed</div></div>
      <div class="e2e-stat f"><div class="n">${e2e.failed}</div> <div class="l">Failed</div></div>
      <div class="e2e-stat">  <div class="n">${e2e.skipped}</div><div class="l">Skipped</div></div>
    </div>
  </div>

  <!-- Unit Test Coverage -->
  <div class="card col-4">
    <h2>📊 Unit Test Coverage</h2>
    <table>
      <thead><tr><th>Metric</th><th>Coverage</th><th>%</th><th></th></tr></thead>
      <tbody>${coverageRows}</tbody>
    </table>
  </div>

  <!-- E2E Scenarios -->
  <div class="card col-6">
    <h2>🧪 E2E Scenarios</h2>
    <ul class="scenarios">${scenarioRows}</ul>
  </div>

  <!-- Pipeline History -->
  <div class="card col-6">
    <h2>📅 Pipeline History (last ${config.dashboard.historyRunsToDisplay} runs)</h2>
    <table>
      <thead><tr><th>Date</th><th>Status</th><th>Score</th><th>E2E</th><th>Coverage</th></tr></thead>
      <tbody>${historyRows}</tbody>
    </table>
  </div>

  <!-- Improvement Suggestions -->
  <div class="card col-12">
    <h2>💡 Improvement Suggestions</h2>
    ${suggestionCards}
  </div>

</main>

<script>
  /* Live pipeline status — GitHub API (no auth needed for public repo) */
  const REPO = '${repo}';
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  async function updatePipelineStatus() {
    try {
      const runsRes  = await fetch('https://api.github.com/repos/' + REPO + '/actions/runs?per_page=1&branch=main', { headers: { Accept: 'application/vnd.github.v3+json' } });
      const runsData = await runsRes.json();
      if (!runsData.workflow_runs || !runsData.workflow_runs.length) return;

      const run     = runsData.workflow_runs[0];
      const jobsRes = await fetch('https://api.github.com/repos/' + REPO + '/actions/runs/' + run.id + '/jobs', { headers: { Accept: 'application/vnd.github.v3+json' } });
      const jobsData = await jobsRes.json();
      if (!jobsData.jobs) return;

      const container = document.getElementById('pipeline-jobs');
      container.innerHTML = jobsData.jobs.map(function(job) {
        var s;
        if (job.status === 'completed') {
          s = job.conclusion === 'success' ? { cls: 'success', text: '✅ Passed' }
            : job.conclusion === 'failure' ? { cls: 'failure', text: '❌ Failed' }
            : { cls: 'queued', text: job.conclusion };
        } else if (job.status === 'in_progress') {
          s = { cls: 'in_progress', text: '⏳ Running…' };
        } else {
          s = { cls: 'queued', text: '⏳ Queued' };
        }
        var dur = '';
        if (job.completed_at && job.started_at) {
          dur = ' <span style="color:#8b949e;font-weight:400">' + Math.round((new Date(job.completed_at) - new Date(job.started_at)) / 1000) + 's</span>';
        }
        return '<div class="job ' + s.cls + '"><div class="jname">' + esc(job.name) + '</div><div class="jstatus">' + s.text + dur + '</div></div>';
      }).join('');
    } catch (e) {
      console.warn('Pipeline status unavailable:', e.message);
    }
  }

  updatePipelineStatus();
  setInterval(updatePipelineStatus, 30000); /* refresh every 30 s */
</script>

</body>
</html>`;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const repo     = process.env.GITHUB_REPOSITORY || 'Cam-Sun/Private_Sauce_Labs';
  const testRepo = config.dashboard.testRepo || 'Cam-Sun/private_labs_test';
  console.log('📊 Generating test dashboard...');

  const coverage    = readCoverage();
  const e2e         = readE2E();
  const history     = await fetchHistory(repo);
  const suggestions = generateSuggestions(coverage, e2e, repo, testRepo);

  // Append current run before calculating health score so stability includes this run
  const coverageAvg = coverage.available
    ? Math.round((coverage.statements + coverage.branches + coverage.functions + coverage.lines) / 4 * 10) / 10
    : 0;

  history.push({
    runId:       process.env.GITHUB_RUN_ID || 'local',
    date:        new Date().toISOString(),
    conclusion:  e2e.failed > 0 ? 'failure' : 'success',
    healthScore: 0,
    e2ePassed:   e2e.passed,
    e2eTotal:    e2e.total,
    coverageAvg,
  });

  const healthScore = calculateHealthScore(coverage, e2e, history);
  history[history.length - 1].healthScore = healthScore;

  const trimmed = history.slice(-config.dashboard.historyRunsToDisplay);

  // Write history.json into build/ so it gets deployed to GitHub Pages
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(trimmed, null, 2));

  // Write dashboard HTML
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const html = renderHTML(coverage, e2e, trimmed, healthScore, suggestions, repo);
  fs.writeFileSync(OUTPUT_PATH, html);

  console.log(`✅ Dashboard  → ${OUTPUT_PATH}`);
  console.log(`✅ History    → ${HISTORY_PATH} (${trimmed.length} runs)`);
  console.log(`   Health Score : ${healthScore}/100`);
  console.log(`   E2E          : ${e2e.passed}/${e2e.total} passed`);
  console.log(`   Suggestions  : ${suggestions.length}`);
}

main().catch(err => {
  console.error('❌ Dashboard generation failed:', err.message);
  process.exit(1);
});
