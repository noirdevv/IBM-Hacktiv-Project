/* ====================================================
   Spotify Analyzer Dashboard — script.js
   ====================================================
   Architecture:
     1.  Palette & constants
     2.  Global state
     3.  Utility helpers
     4.  Data loading
     5.  Filter population
     6.  Filter event listeners
     7.  KPI rendering
     8.  Chart builders (7 charts)
     9.  Summary table
     10. Full dashboard refresh
     11. Sidebar toggle
     12. Init
   ==================================================== */

'use strict';

// ── 1. PALETTE & CONSTANTS ───────────────────────────────────────────────────

const DATA_URL = 'spotify_data.json';

/** Light-theme vibrant palette */
const C = {
  pink:   '#E91E63',
  pinkL:  '#FF5B8A',
  green:  '#1DB954',
  greenL: '#43D47A',
  purple: '#6C5CE7',
  purpleL:'#9B8FF0',
  cyan:   '#00CEC9',
  orange: '#F39C12',
  muted:  '#8A94A6',
  text:   '#1A2035',
  grid:   '#E8ECF0',
  white:  '#FFFFFF',
};

/** 10-step gradient from pink → green for bar / sequence charts */
const SEQ_COLORS = [
  '#E91E63','#D4267A','#BE2E90','#A836A3','#8B46B4',
  '#6C5CE7','#4E81CF','#2F9FB5','#1DBFA0','#1DB954',
];

/** Chart.js global defaults — light theme */
Chart.defaults.color          = C.muted;
Chart.defaults.borderColor    = C.grid;
Chart.defaults.font.family    = '"Inter", system-ui, sans-serif';
Chart.defaults.font.size      = 11;

// ── 2. GLOBAL STATE ──────────────────────────────────────────────────────────

let rawData      = [];
let filteredData = [];
let charts       = {};

// ── 3. UTILITY HELPERS ───────────────────────────────────────────────────────

const toFloat = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const toInt   = (v) => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };
const round2  = (n) => Math.round(n * 100) / 100;
const getYear = (d) => (d ? d.substring(0, 4) : 'Unknown');

function fmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function splitGenres(g) {
  if (!g || g.trim() === 'N/A' || g.trim() === '') return [];
  return g.split(',').map(s => s.trim()).filter(Boolean);
}

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/** Convert hex+alpha → rgba string */
function rgba(hex, a) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** Interpolate n colours between two hex values */
function gradientPalette(n, from = '#E91E63', to = '#1DB954') {
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const hf = [parseInt(from.slice(1,3),16), parseInt(from.slice(3,5),16), parseInt(from.slice(5,7),16)];
  const ht = [parseInt(to.slice(1,3),16),   parseInt(to.slice(3,5),16),   parseInt(to.slice(5,7),16)];
  return Array.from({length: n}, (_, i) => {
    const t = n <= 1 ? 0 : i / (n - 1);
    return `#${lerp(hf[0],ht[0],t).toString(16).padStart(2,'0')}${lerp(hf[1],ht[1],t).toString(16).padStart(2,'0')}${lerp(hf[2],ht[2],t).toString(16).padStart(2,'0')}`;
  });
}

// ── 4. DATA LOADING ──────────────────────────────────────────────────────────

async function loadData() {
  try {
    const res  = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rawData = await res.json();
    filteredData = [...rawData];

    // Update header status badge
    const dot = document.getElementById('loadingDot');
    if (dot) dot.style.background = C.green;
    setText('loadingText', `${fmtNum(rawData.length)} tracks`);

    populateFilters();
    refreshDashboard();
  } catch (err) {
    console.error('Failed to load data:', err);
    const dot = document.getElementById('loadingDot');
    if (dot) dot.style.background = '#e74c3c';
    setText('loadingText', 'Error loading data');
  }
}

// ── 5. FILTER POPULATION ─────────────────────────────────────────────────────

function populateFilters() {
  const years = new Set(), genres = new Set(),
        artists = new Set(), albumTypes = new Set();

  rawData.forEach(r => {
    years.add(getYear(r.album_release_date));
    artists.add(r.artist_name);
    albumTypes.add((r.album_type || 'unknown').toLowerCase());
    splitGenres(r.artist_genres).forEach(g => genres.add(g));
  });

  fillSelect('filterYear',
    [...years].filter(y => y !== 'Unknown').sort((a,b) => b - a));
  fillSelect('filterGenre',   [...genres].sort());
  fillSelect('filterArtist',  [...artists].sort());
  fillSelect('filterAlbumType', [...albumTypes].sort());
}

function fillSelect(id, values) {
  const sel = document.getElementById(id);
  if (!sel) return;
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    sel.appendChild(opt);
  });
}

// ── 6. FILTER EVENT LISTENERS ────────────────────────────────────────────────

function attachFilterListeners() {
  const ids = ['filterYear','filterGenre','filterArtist','filterAlbumType','filterFollowers'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', applyFilters);
  });

  const btnReset = document.getElementById('btnReset');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      applyFilters();
    });
  }
}

function applyFilters() {
  const year      = document.getElementById('filterYear')?.value      || '';
  const genre     = document.getElementById('filterGenre')?.value     || '';
  const artist    = document.getElementById('filterArtist')?.value    || '';
  const albumType = document.getElementById('filterAlbumType')?.value || '';
  const followerT = document.getElementById('filterFollowers')?.value || '';

  filteredData = rawData.filter(row => {
    if (year      && getYear(row.album_release_date) !== year) return false;
    if (genre     && !splitGenres(row.artist_genres).includes(genre)) return false;
    if (artist    && row.artist_name !== artist) return false;
    if (albumType && (row.album_type || '').toLowerCase() !== albumType) return false;
    if (followerT) {
      const f = toInt(row.artist_followers);
      if (followerT === 'micro' && !(f < 100_000)) return false;
      if (followerT === 'mid'   && !(f >= 100_000 && f < 1_000_000)) return false;
      if (followerT === 'macro' && !(f >= 1_000_000 && f < 10_000_000)) return false;
      if (followerT === 'mega'  && !(f >= 10_000_000)) return false;
    }
    return true;
  });

  refreshDashboard();
}

// ── 7. KPI RENDERING ─────────────────────────────────────────────────────────

function renderKPIs() {
  const n = filteredData.length;

  setText('kpiTotalTracks',    fmtNum(n));
  setText('kpiTotalTracksSub', `of ${fmtNum(rawData.length)} total`);

  const uniqueArtists = new Set(filteredData.map(r => r.artist_name)).size;
  setText('kpiTotalArtists',    fmtNum(uniqueArtists));
  setText('kpiTotalArtistsSub', 'unique artists');

  const avgPop = n > 0
    ? round2(filteredData.reduce((s,r) => s + toInt(r.track_popularity), 0) / n)
    : 0;
  setText('kpiAvgPopularity',    avgPop.toFixed(1));
  setText('kpiAvgPopularitySub', 'out of 100');

  const artistMap = {};
  filteredData.forEach(r => {
    if (!artistMap[r.artist_name]) artistMap[r.artist_name] = toInt(r.artist_followers);
  });
  const followerVals = Object.values(artistMap);
  const avgFollowers = followerVals.length
    ? Math.round(followerVals.reduce((a,b)=>a+b,0) / followerVals.length) : 0;
  setText('kpiAvgFollowers',    fmtNum(avgFollowers));
  setText('kpiAvgFollowersSub', 'per artist');

  const avgDur = n > 0
    ? round2(filteredData.reduce((s,r) => s + toFloat(r.track_duration_min), 0) / n)
    : 0;
  setText('kpiAvgDuration',    avgDur.toFixed(2) + ' min');
  setText('kpiAvgDurationSub', 'per track');
}

// ── 8. CHART BUILDERS ────────────────────────────────────────────────────────

/* Shared scale opts for light theme */
const lightScales = (xLabel='', yLabel='') => ({
  x: {
    grid: { color: C.grid },
    ticks: { color: C.muted },
    ...(xLabel ? { title: { display: true, text: xLabel, color: C.muted } } : {}),
  },
  y: {
    grid: { color: C.grid },
    ticks: { color: C.muted },
    ...(yLabel ? { title: { display: true, text: yLabel, color: C.muted } } : {}),
  },
});

/* ── 8-A. Top 10 Most Popular Tracks ── */
function buildTopTracksChart() {
  destroyChart('chartTopTracks');
  const top10 = [...filteredData]
    .sort((a,b) => toInt(b.track_popularity) - toInt(a.track_popularity))
    .slice(0,10);

  const ctx = document.getElementById('chartTopTracks')?.getContext('2d');
  if (!ctx) return;

  charts['chartTopTracks'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top10.map(r => truncate(r.track_name, 26)),
      datasets: [{
        label: 'Popularity',
        data:  top10.map(r => toInt(r.track_popularity)),
        backgroundColor: SEQ_COLORS,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => top10[items[0].dataIndex].track_name,
            afterTitle: items => `Artist: ${top10[items[0].dataIndex].artist_name}`,
          },
        },
      },
      scales: lightScales('Popularity Score', ''),
    },
  });
}

/* ── 8-B. Scatter: Artist Popularity vs Followers ── */
function buildScatterChart() {
  destroyChart('chartScatter');
  const seen = new Set(), points = [];
  for (const r of filteredData) {
    if (!seen.has(r.artist_name)) {
      seen.add(r.artist_name);
      points.push({ x: toInt(r.artist_popularity), y: toInt(r.artist_followers), name: r.artist_name });
      if (points.length >= 300) break;
    }
  }

  const ctx = document.getElementById('chartScatter')?.getContext('2d');
  if (!ctx) return;

  charts['chartScatter'] = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Artists',
        data: points,
        backgroundColor: rgba(C.pink, 0.5),
        pointRadius: 4,
        pointHoverRadius: 7,
        pointBorderColor: C.pink,
        pointBorderWidth: 1,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.raw.name} — Pop: ${ctx.raw.x}, Followers: ${fmtNum(ctx.raw.y)}`,
          },
        },
      },
      scales: {
        x: { ...lightScales().x, title: { display: true, text: 'Artist Popularity', color: C.muted } },
        y: {
          ...lightScales().y,
          title: { display: true, text: 'Followers', color: C.muted },
          ticks: { color: C.muted, callback: v => fmtNum(v) },
        },
      },
    },
  });
}

/* ── 8-C. Popularity by Album Type (grouped bar: avg/max/min) ── */
function buildBoxPlotChart() {
  destroyChart('chartBoxPlot');
  const groups = {};
  filteredData.forEach(r => {
    const t = (r.album_type || 'unknown').toLowerCase();
    if (!groups[t]) groups[t] = [];
    groups[t].push(toInt(r.track_popularity));
  });
  const labels = Object.keys(groups).sort();
  const avgs = labels.map(k => round2(groups[k].reduce((a,b)=>a+b,0)/groups[k].length));
  const maxs = labels.map(k => Math.max(...groups[k]));
  const mins = labels.map(k => Math.min(...groups[k]));

  const ctx = document.getElementById('chartBoxPlot')?.getContext('2d');
  if (!ctx) return;

  charts['chartBoxPlot'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Avg', data: avgs, backgroundColor: C.pink,   borderRadius: 6, borderSkipped: false },
        { label: 'Max', data: maxs, backgroundColor: rgba(C.green,0.5), borderRadius: 4, borderSkipped: false },
        { label: 'Min', data: mins, backgroundColor: rgba(C.purple,0.35), borderRadius: 4, borderSkipped: false },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: C.muted, boxWidth: 10, padding: 10 } }, tooltip: { mode: 'index', intersect: false } },
      scales: lightScales('', 'Popularity Score'),
    },
  });
}

/* ── 8-D. Top Genres Donut ── */
function buildDonutChart() {
  destroyChart('chartDonut');
  const counts = {};
  filteredData.forEach(r => splitGenres(r.artist_genres).forEach(g => { counts[g] = (counts[g]||0)+1; }));
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  const top    = sorted.slice(0,10);
  const other  = sorted.slice(10).reduce((s,[,v])=>s+v,0);
  if (other > 0) top.push(['Other', other]);

  const ctx = document.getElementById('chartDonut')?.getContext('2d');
  if (!ctx) return;

  charts['chartDonut'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: top.map(([k])=>k),
      datasets: [{
        data: top.map(([,v])=>v),
        backgroundColor: gradientPalette(top.length),
        borderColor: C.white,
        borderWidth: 2,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { position: 'right', labels: { color: C.text, boxWidth: 10, padding: 10, font: { size: 10 } } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a,b)=>a+b,0);
              return ` ${ctx.label}: ${fmtNum(ctx.parsed)} (${((ctx.parsed/total)*100).toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });
}

/* ── 8-E. Release Trends Line Chart ── */
function buildLineChart() {
  destroyChart('chartLine');
  const counts = {};
  filteredData.forEach(r => {
    const y = getYear(r.album_release_date);
    if (y !== 'Unknown') counts[y] = (counts[y]||0)+1;
  });
  const labels = Object.keys(counts).sort();
  const values = labels.map(y => counts[y]);

  const ctx = document.getElementById('chartLine')?.getContext('2d');
  if (!ctx) return;

  // Pink gradient fill under line
  const grad = ctx.createLinearGradient(0, 0, 0, 220);
  grad.addColorStop(0,   rgba(C.pink, 0.3));
  grad.addColorStop(0.6, rgba(C.pink, 0.07));
  grad.addColorStop(1,   rgba(C.pink, 0.0));

  // Green gradient fill for second visual line (avg)
  const grad2 = ctx.createLinearGradient(0, 0, 0, 220);
  grad2.addColorStop(0,   rgba(C.green, 0.2));
  grad2.addColorStop(1,   rgba(C.green, 0.0));

  charts['chartLine'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Tracks Released',
          data: values,
          borderColor: C.pink,
          backgroundColor: grad,
          pointBackgroundColor: C.white,
          pointBorderColor: C.pink,
          pointRadius: 3,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.45,
          borderWidth: 2.5,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: C.muted } },
        y: {
          grid: { color: C.grid },
          ticks: { color: C.muted },
          title: { display: true, text: 'Track Count', color: C.muted },
        },
      },
    },
  });
}

/* ── 8-F. Explicit Content Pie ── */
function buildPieChart() {
  destroyChart('chartPie');
  let exp = 0, nonExp = 0;
  filteredData.forEach(r => {
    r.explicit?.toUpperCase() === 'TRUE' ? exp++ : nonExp++;
  });

  const ctx = document.getElementById('chartPie')?.getContext('2d');
  if (!ctx) return;

  charts['chartPie'] = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['Explicit', 'Non-Explicit'],
      datasets: [{
        data: [exp, nonExp],
        backgroundColor: [C.pink, C.green],
        borderColor: C.white,
        borderWidth: 3,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: C.text, boxWidth: 12, padding: 14, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a,b)=>a+b,0);
              return ` ${ctx.label}: ${fmtNum(ctx.parsed)} (${((ctx.parsed/total)*100).toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });
}

/* ── 8-G. Top 10 Artists by Total Tracks ── */
function buildTopArtistsChart() {
  destroyChart('chartTopArtists');
  const counts = {};
  filteredData.forEach(r => { counts[r.artist_name] = (counts[r.artist_name]||0)+1; });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10);

  const ctx = document.getElementById('chartTopArtists')?.getContext('2d');
  if (!ctx) return;

  charts['chartTopArtists'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(([k])=>truncate(k,20)),
      datasets: [{
        label: 'Track Count',
        data: sorted.map(([,v])=>v),
        backgroundColor: SEQ_COLORS,
        borderRadius: 7,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} tracks` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: C.muted, maxRotation: 30 } },
        y: { grid: { color: C.grid },  ticks: { color: C.muted } },
      },
    },
  });
}

// ── 9. SUMMARY TABLE ─────────────────────────────────────────────────────────

/**
 * Render the top-20 most popular tracks into the summary table.
 * Runs after each filter change.
 */
function renderSummaryTable() {
  const tbody = document.getElementById('summaryTableBody');
  if (!tbody) return;

  const top20 = [...filteredData]
    .sort((a,b) => toInt(b.track_popularity) - toInt(a.track_popularity))
    .slice(0, 20);

  if (top20.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-sp-muted py-4 text-xs">No data for current filters</td></tr>`;
    return;
  }

  tbody.innerHTML = top20.map((r, i) => {
    const typeClass = {
      album:  'type-album',
      single: 'type-single',
      compilation: 'type-compilation',
    }[(r.album_type || '').toLowerCase()] || 'type-single';

    return `<tr>
      <td class="text-sp-muted font-medium">${i + 1}</td>
      <td title="${r.track_name}">${truncate(r.track_name, 24)}</td>
      <td class="text-sp-muted" title="${r.artist_name}">${truncate(r.artist_name, 18)}</td>
      <td><span class="pop-badge">${r.track_popularity}</span></td>
      <td><span class="type-badge ${typeClass}">${r.album_type || '—'}</span></td>
    </tr>`;
  }).join('');
}

// ── 10. FULL DASHBOARD REFRESH ───────────────────────────────────────────────

/**
 * Re-render all KPIs, charts, and table from filteredData.
 * Called on initial load and every filter change.
 */
function refreshDashboard() {
  renderKPIs();
  buildTopTracksChart();
  buildScatterChart();
  buildBoxPlotChart();
  buildDonutChart();
  buildLineChart();
  buildPieChart();
  buildTopArtistsChart();
  renderSummaryTable();
}

// ── 11. SIDEBAR TOGGLE ───────────────────────────────────────────────────────

function initSidebar() {
  const sidebar    = document.getElementById('sidebar');
  const wrapper    = document.querySelector('.main-wrapper');
  const toggleBtn  = document.getElementById('btnToggleSidebar');

  // Create overlay for mobile
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  document.body.appendChild(overlay);

  if (!toggleBtn || !sidebar || !wrapper) return;

  toggleBtn.addEventListener('click', () => {
    const isMobile = window.innerWidth < 1024;
    if (isMobile) {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('active');
    } else {
      sidebar.classList.toggle('collapsed');
      wrapper.classList.toggle('expanded');
      // Allow charts to resize after transition
      setTimeout(() => {
        Object.values(charts).forEach(ch => ch.resize?.());
      }, 320);
    }
  });

  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
  });

}

// ── 12. INIT ─────────────────────────────────────────────────────────────────

(async function init() {
  initSidebar();
  attachFilterListeners();
  await loadData();
})();
