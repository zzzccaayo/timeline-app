const STORAGE_KEY = "friends_timeline_v1";
const SETTINGS_KEY = "friends_timeline_settings_v1";

const state = {
  friends: loadFriends(),
  viewerTz: loadSettings().viewerTz || Intl.DateTimeFormat().resolvedOptions().timeZone,
  use24h: loadSettings().use24h ?? true,
  editingId: null,
};

const els = {
  viewerTz: document.getElementById("viewerTz"),
  use24h: document.getElementById("use24h"),
  form: document.getElementById("friendForm"),
  fName: document.getElementById("fName"),
  fTz: document.getElementById("fTz"),
  fColor: document.getElementById("fColor"),
  fStart: document.getElementById("fStart"),
  fEnd: document.getElementById("fEnd"),
  submitBtn: document.getElementById("submitBtn"),
  cancelEdit: document.getElementById("cancelEdit"),
  list: document.getElementById("friendList"),
  emptyHint: document.getElementById("emptyHint"),
  timeline: document.getElementById("timeline"),
  overlapList: document.getElementById("overlapList"),
};

init();

function init() {
  const zones = getTimezones();
  fillTzSelect(els.viewerTz, zones, state.viewerTz);
  fillTzSelect(els.fTz, zones, state.viewerTz);
  els.use24h.checked = state.use24h;

  els.viewerTz.addEventListener("change", () => {
    state.viewerTz = els.viewerTz.value;
    saveSettings();
    render();
  });
  els.use24h.addEventListener("change", () => {
    state.use24h = els.use24h.checked;
    saveSettings();
    render();
  });
  els.form.addEventListener("submit", onSubmit);
  els.cancelEdit.addEventListener("click", cancelEdit);

  render();
  setInterval(render, 60 * 1000);
}

function getTimezones() {
  if (typeof Intl.supportedValuesOf === "function") {
    try { return Intl.supportedValuesOf("timeZone"); } catch {}
  }
  return [
    "UTC","Asia/Shanghai","Asia/Tokyo","Asia/Seoul","Asia/Singapore","Asia/Bangkok",
    "Asia/Kolkata","Asia/Dubai","Europe/London","Europe/Paris","Europe/Berlin",
    "Europe/Moscow","Africa/Cairo","Africa/Johannesburg","Australia/Sydney",
    "Pacific/Auckland","America/New_York","America/Chicago","America/Denver",
    "America/Los_Angeles","America/Toronto","America/Sao_Paulo","America/Mexico_City",
  ];
}

function fillTzSelect(sel, zones, current) {
  sel.innerHTML = "";
  for (const z of zones) {
    const opt = document.createElement("option");
    opt.value = z;
    const offset = formatOffset(tzOffsetMinutes(z, new Date()));
    opt.textContent = `${z} (UTC${offset})`;
    if (z === current) opt.selected = true;
    sel.appendChild(opt);
  }
}

function onSubmit(e) {
  e.preventDefault();
  const friend = {
    id: state.editingId || crypto.randomUUID(),
    name: els.fName.value.trim(),
    tz: els.fTz.value,
    color: els.fColor.value,
    start: els.fStart.value,
    end: els.fEnd.value,
  };
  if (!friend.name || !friend.start || !friend.end) return;

  if (state.editingId) {
    const i = state.friends.findIndex(f => f.id === state.editingId);
    if (i >= 0) state.friends[i] = friend;
  } else {
    state.friends.push(friend);
  }
  saveFriends();
  resetForm();
  render();
}

function resetForm() {
  state.editingId = null;
  els.form.reset();
  els.fStart.value = "19:00";
  els.fEnd.value = "23:30";
  els.fColor.value = randomColor();
  els.fTz.value = state.viewerTz;
  els.submitBtn.textContent = "添加";
  els.cancelEdit.hidden = true;
}

function cancelEdit() { resetForm(); }

function editFriend(id) {
  const f = state.friends.find(x => x.id === id);
  if (!f) return;
  state.editingId = id;
  els.fName.value = f.name;
  els.fTz.value = f.tz;
  els.fColor.value = f.color;
  els.fStart.value = f.start;
  els.fEnd.value = f.end;
  els.submitBtn.textContent = "保存";
  els.cancelEdit.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function deleteFriend(id) {
  if (!confirm("删除这位朋友？")) return;
  state.friends = state.friends.filter(f => f.id !== id);
  saveFriends();
  if (state.editingId === id) resetForm();
  render();
}

function render() {
  renderList();
  renderTimeline();
}

function renderList() {
  els.list.innerHTML = "";
  els.emptyHint.hidden = state.friends.length > 0;
  for (const f of state.friends) {
    const li = document.createElement("li");
    li.className = "friend";
    const offset = formatOffset(tzOffsetMinutes(f.tz, new Date()));
    const localNow = formatTimeIn(f.tz, new Date(), state.use24h);
    li.innerHTML = `
      <span class="swatch" style="background:${escapeAttr(f.color)}"></span>
      <div>
        <div class="name">${escapeHtml(f.name)}</div>
        <div class="meta">${escapeHtml(f.tz)} (UTC${offset}) · 当地现在 ${localNow} · 活跃 ${escapeHtml(f.start)}–${escapeHtml(f.end)}</div>
      </div>
      <span class="spacer"></span>
      <span class="actions">
        <button data-act="edit">编辑</button>
        <button data-act="del">删除</button>
      </span>
    `;
    li.querySelector('[data-act="edit"]').addEventListener("click", () => editFriend(f.id));
    li.querySelector('[data-act="del"]').addEventListener("click", () => deleteFriend(f.id));
    els.list.appendChild(li);
  }
}

function renderTimeline() {
  els.timeline.innerHTML = "";

  const anchor = startOfDayInTz(new Date(), state.viewerTz);
  const totalMinutes = 24 * 60;

  const header = document.createElement("div");
  header.className = "tl-header";
  const headerLabel = document.createElement("div");
  headerLabel.className = "tl-label";
  headerLabel.textContent = `基准：${state.viewerTz}`;
  const hours = document.createElement("div");
  hours.className = "tl-hours";
  for (let h = 0; h <= 24; h += 3) {
    const pct = (h / 24) * 100;
    const hourEl = document.createElement("div");
    hourEl.className = "hour";
    hourEl.style.left = pct + "%";
    hourEl.textContent = formatHourLabel(h, state.use24h);
    hours.appendChild(hourEl);
    const tick = document.createElement("div");
    tick.className = "tick";
    tick.style.left = pct + "%";
    hours.appendChild(tick);
  }
  header.appendChild(headerLabel);
  header.appendChild(hours);
  els.timeline.appendChild(header);

  const friendIntervals = [];
  for (const f of state.friends) {
    const intervals = computeIntervalsInViewer(f, anchor);
    friendIntervals.push({ friend: f, intervals });

    const row = document.createElement("div");
    row.className = "tl-row";
    const label = document.createElement("div");
    label.className = "tl-label";
    label.textContent = f.name;
    label.title = `${f.name} · ${f.tz}`;
    const track = document.createElement("div");
    track.className = "tl-track";

    for (const [s, e] of intervals) {
      const left = (s / totalMinutes) * 100;
      const width = ((e - s) / totalMinutes) * 100;
      const block = document.createElement("div");
      block.className = "tl-block";
      block.style.left = left + "%";
      block.style.width = width + "%";
      block.style.background = f.color;
      block.title = `${f.name}: ${minutesToLabel(s)} – ${minutesToLabel(e)}`;
      track.appendChild(block);
    }
    addNowMarker(track, anchor);
    row.appendChild(label);
    row.appendChild(track);
    els.timeline.appendChild(row);
  }

  const overlaps = computeOverlap(friendIntervals.map(x => x.intervals));
  if (state.friends.length >= 2) {
    const row = document.createElement("div");
    row.className = "tl-row";
    const label = document.createElement("div");
    label.className = "tl-label";
    label.textContent = "共同在线";
    const track = document.createElement("div");
    track.className = "tl-track";
    for (const [s, e] of overlaps) {
      const left = (s / totalMinutes) * 100;
      const width = ((e - s) / totalMinutes) * 100;
      const block = document.createElement("div");
      block.className = "tl-block overlap";
      block.style.left = left + "%";
      block.style.width = width + "%";
      block.title = `共同在线: ${minutesToLabel(s)} – ${minutesToLabel(e)}`;
      track.appendChild(block);
    }
    addNowMarker(track, anchor);
    row.appendChild(label);
    row.appendChild(track);
    els.timeline.appendChild(row);
  }

  renderOverlapList(overlaps);
}

function renderOverlapList(overlaps) {
  els.overlapList.innerHTML = "";
  if (state.friends.length < 2) {
    const c = document.createElement("div");
    c.className = "overlap-chip empty";
    c.textContent = "至少添加 2 位朋友才能计算交叉时段。";
    els.overlapList.appendChild(c);
    return;
  }
  if (overlaps.length === 0) {
    const c = document.createElement("div");
    c.className = "overlap-chip empty";
    c.textContent = "今天没有共同在线时段。";
    els.overlapList.appendChild(c);
    return;
  }
  for (const [s, e] of overlaps) {
    const c = document.createElement("div");
    c.className = "overlap-chip";
    const dur = e - s;
    c.textContent = `${minutesToLabel(s)} – ${minutesToLabel(e)} · ${formatDuration(dur)}`;
    els.overlapList.appendChild(c);
  }
}

function addNowMarker(track, anchor) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const rel = now - anchor.getTime();
  if (rel < 0 || rel > dayMs) return;
  const pct = (rel / dayMs) * 100;
  const el = document.createElement("div");
  el.className = "tl-now";
  el.style.left = pct + "%";
  track.appendChild(el);
}

function computeIntervalsInViewer(friend, anchor) {
  const anchorMs = anchor.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  const [sh, sm] = friend.start.split(":").map(Number);
  const [eh, em] = friend.end.split(":").map(Number);
  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;

  const candidates = [];
  for (const dayOffset of [-1, 0, 1]) {
    const refMs = anchorMs + dayOffset * dayMs;
    const localMidnight = localMidnightMsForViewerDate(refMs, friend.tz);
    const absStart = localMidnight + startMin * 60 * 1000;
    const absEnd = localMidnight + endMin * 60 * 1000;
    candidates.push([absStart, absEnd]);
  }

  const result = [];
  for (const [a, b] of candidates) {
    const s = Math.max(a, anchorMs);
    const e = Math.min(b, anchorMs + dayMs);
    if (e > s) {
      result.push([(s - anchorMs) / 60000, (e - anchorMs) / 60000]);
    }
  }
  return mergeIntervals(result);
}

function localMidnightMsForViewerDate(viewerRefMs, friendTz) {
  const y = Number(formatInTz(viewerRefMs, friendTz, { year: "numeric" }));
  const m = Number(formatInTz(viewerRefMs, friendTz, { month: "2-digit" }));
  const d = Number(formatInTz(viewerRefMs, friendTz, { day: "2-digit" }));
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset = tzOffsetMinutes(friendTz, new Date(utcGuess));
  return utcGuess - offset * 60 * 1000;
}

function tzOffsetMinutes(tz, date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return Math.round((asUTC - date.getTime()) / 60000);
}

function formatInTz(ms, tz, opts) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(new Date(ms));
}

function startOfDayInTz(date, tz) {
  const y = Number(formatInTz(date.getTime(), tz, { year: "numeric" }));
  const m = Number(formatInTz(date.getTime(), tz, { month: "2-digit" }));
  const d = Number(formatInTz(date.getTime(), tz, { day: "2-digit" }));
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset = tzOffsetMinutes(tz, new Date(utcGuess));
  return new Date(utcGuess - offset * 60 * 1000);
}

function mergeIntervals(arr) {
  if (arr.length === 0) return arr;
  arr.sort((a, b) => a[0] - b[0]);
  const out = [arr[0].slice()];
  for (let i = 1; i < arr.length; i++) {
    const last = out[out.length - 1];
    if (arr[i][0] <= last[1]) last[1] = Math.max(last[1], arr[i][1]);
    else out.push(arr[i].slice());
  }
  return out;
}

function computeOverlap(listOfIntervals) {
  if (listOfIntervals.length === 0) return [];
  let acc = listOfIntervals[0].map(i => i.slice());
  for (let i = 1; i < listOfIntervals.length; i++) {
    acc = intersectIntervals(acc, listOfIntervals[i]);
    if (acc.length === 0) break;
  }
  return acc;
}

function intersectIntervals(a, b) {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0], b[j][0]);
    const e = Math.min(a[i][1], b[j][1]);
    if (e > s) out.push([s, e]);
    if (a[i][1] < b[j][1]) i++; else j++;
  }
  return out;
}

function minutesToLabel(min) {
  const total = Math.round(min);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  if (state.use24h) return `${pad(h)}:${pad(m)}`;
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${pad(m)} ${ap}`;
}

function formatHourLabel(h, use24) {
  if (use24) return pad(h % 24);
  const ap = h >= 12 && h < 24 ? "P" : "A";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}${ap}`;
}

function formatTimeIn(tz, date, use24) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: !use24,
  }).format(date);
}

function formatOffset(min) {
  const sign = min >= 0 ? "+" : "-";
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${pad(h)}:${pad(m)}`;
}

function formatDuration(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h && m) return `${h} 小时 ${m} 分`;
  if (h) return `${h} 小时`;
  return `${m} 分钟`;
}

function pad(n) { return String(n).padStart(2, "0"); }

function randomColor() {
  const palette = ["#4f8cff", "#ff6b6b", "#8bd17c", "#c792ea", "#f5a623", "#2ec4b6", "#ff9ff3", "#ffd166"];
  return palette[Math.floor(Math.random() * palette.length)];
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function loadFriends() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveFriends() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.friends));
}
function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch { return {}; }
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    viewerTz: state.viewerTz, use24h: state.use24h,
  }));
}
