import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://hvshnjgxfxuqshqpjguj.supabase.co";
const SUPABASE_KEY = "sb_publishable_FO3GI9v4QdOjp3Xgjk1EWQ_ppk-Ut6J";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    lock: async (_name, _timeout, fn) => fn(),
  },
});

const state = {
  session: null,
  profile: null,
  friends: [],
  pendingIn: [],
  pendingOut: [],
  use24h: true,
};

const views = {
  loading: document.getElementById("view-loading"),
  auth: document.getElementById("view-auth"),
  onboarding: document.getElementById("view-onboarding"),
  main: document.getElementById("view-main"),
};

function showView(name) {
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
}

function toast(msg, kind = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast " + kind;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2400);
}

/* ---------- Boot ---------- */

init();

async function init() {
  bindAuthUI();

  let firstHandled = false;
  let applyChain = Promise.resolve();
  const queueApply = (session) => {
    applyChain = applyChain
      .then(() => applySession(session))
      .catch((err) => console.error("[app] applySession failed", err));
    return applyChain;
  };

  supabase.auth.onAuthStateChange((event, session) => {
    console.log("[app] auth event:", event);
    firstHandled = true;
    queueApply(session);
  });

  setTimeout(async () => {
    if (firstHandled) return;
    console.warn("[app] onAuthStateChange did not fire, falling back to getSession");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      firstHandled = true;
      queueApply(session);
    } catch (err) {
      console.error("[app] getSession failed", err);
      toast("加载失败，请刷新重试", "error");
      showView("auth");
    }
  }, 3000);

  setTimeout(() => {
    if (!views.loading.hidden) {
      console.warn("[app] still on loading view after 10s, forcing auth");
      showView("auth");
    }
  }, 10000);
}


async function applySession(session) {
  state.session = session;
  if (!session) {
    state.profile = null;
    state.friends = [];
    state.pendingIn = [];
    state.pendingOut = [];
    showView("auth");
    return;
  }
  showView("loading");
  try {
    await loadProfile();
    if (needsOnboarding(state.profile)) {
      showOnboarding();
      return;
    }
    await loadFriends();
    renderMain();
    showView("main");
  } catch (err) {
    console.error(err);
    toast("加载失败：" + (err.message || err), "error");
    showView("auth");
  }
}

function needsOnboarding(profile) {
  if (!profile) return true;
  if (localStorage.getItem("onboarded_" + profile.id) === "1") return false;
  return true;
}
function markOnboarded() {
  if (state.profile) localStorage.setItem("onboarded_" + state.profile.id, "1");
}

/* ---------- Auth UI ---------- */

function bindAuthUI() {
  document.querySelectorAll(".tab").forEach(t => {
    t.addEventListener("click", () => switchTab(t.dataset.tab));
  });
  document.getElementById("loginForm").addEventListener("submit", onLogin);
  document.getElementById("registerForm").addEventListener("submit", onRegister);
  document.getElementById("logout").addEventListener("click", onLogout);
  document.getElementById("openSettings").addEventListener("click", openSettings);
  document.getElementById("closeSettings").addEventListener("click", closeSettings);
  document.getElementById("settingsForm").addEventListener("submit", onSaveSettings);
  document.getElementById("onboardingForm").addEventListener("submit", onOnboardingSave);
  document.getElementById("addFriendForm").addEventListener("submit", onAddFriend);
  document.getElementById("meCodePill").addEventListener("click", copyMyCode);
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.getElementById("loginForm").hidden = name !== "login";
  document.getElementById("registerForm").hidden = name !== "register";
  document.getElementById("authError").hidden = true;
}

async function onLogin(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const { error } = await supabase.auth.signInWithPassword({
    email: fd.get("email"),
    password: fd.get("password"),
  });
  if (error) showAuthError(translateAuthError(error));
}

async function onRegister(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const username = fd.get("username").trim();
  const { error } = await supabase.auth.signUp({
    email: fd.get("email"),
    password: fd.get("password"),
    options: { data: { username } },
  });
  if (error) { showAuthError(translateAuthError(error)); return; }
  toast("注册成功", "success");
}

async function onLogout() {
  await supabase.auth.signOut();
}

function showAuthError(msg) {
  const el = document.getElementById("authError");
  el.textContent = msg;
  el.hidden = false;
}

function translateAuthError(error) {
  const m = (error.message || "").toLowerCase();
  if (m.includes("invalid login")) return "邮箱或密码错误";
  if (m.includes("already registered") || m.includes("user already")) return "该邮箱已注册";
  if (m.includes("password should")) return "密码至少 6 位";
  if (m.includes("email")) return "邮箱格式不正确";
  return error.message || "出错了，请重试";
}

/* ---------- Profile ---------- */

async function loadProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", state.session.user.id)
    .single();
  if (error) throw error;
  state.profile = data;
}

async function updateProfile(updates) {
  const { data, error } = await supabase
    .from("profiles")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", state.session.user.id)
    .select()
    .single();
  if (error) throw error;
  state.profile = data;
  return data;
}

/* ---------- Onboarding ---------- */

function showOnboarding() {
  const form = document.getElementById("onboardingForm");
  document.getElementById("obUsername").textContent = state.profile.username;
  document.getElementById("obFriendCode").textContent = state.profile.friend_code;
  fillTimezoneSelect(form.timezone, state.profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  form.username.value = state.profile.username;
  form.active_start.value = state.profile.active_start || "19:00";
  form.active_end.value = state.profile.active_end || "23:00";
  form.color.value = state.profile.color || "#4f8cff";
  showView("onboarding");
}

async function onOnboardingSave(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const err = document.getElementById("onboardingError");
  err.hidden = true;
  try {
    await updateProfile({
      username: fd.get("username").trim(),
      timezone: fd.get("timezone"),
      active_start: fd.get("active_start"),
      active_end: fd.get("active_end"),
      color: fd.get("color"),
    });
    markOnboarded();
    await loadFriends();
    renderMain();
    showView("main");
    toast("欢迎！你的好友代码已准备好分享", "success");
  } catch (e) {
    err.textContent = e.message || "保存失败";
    err.hidden = false;
  }
}

/* ---------- Settings ---------- */

function openSettings() {
  const form = document.getElementById("settingsForm");
  fillTimezoneSelect(form.timezone, state.profile.timezone);
  form.username.value = state.profile.username;
  form.active_start.value = state.profile.active_start;
  form.active_end.value = state.profile.active_end;
  form.color.value = state.profile.color;
  document.getElementById("settingsError").hidden = true;
  document.getElementById("settingsModal").hidden = false;
}
function closeSettings() {
  document.getElementById("settingsModal").hidden = true;
}

async function onSaveSettings(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const err = document.getElementById("settingsError");
  err.hidden = true;
  try {
    await updateProfile({
      username: fd.get("username").trim(),
      timezone: fd.get("timezone"),
      active_start: fd.get("active_start"),
      active_end: fd.get("active_end"),
      color: fd.get("color"),
    });
    closeSettings();
    renderMain();
    toast("已保存", "success");
  } catch (e) {
    err.textContent = e.message || "保存失败";
    err.hidden = false;
  }
}

/* ---------- Friends ---------- */

async function loadFriends() {
  const me = state.session.user.id;
  const { data: rels, error } = await supabase
    .from("friendships")
    .select("*")
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`);
  if (error) throw error;

  const accepted = rels.filter(r => r.status === "accepted");
  const pendingIn = rels.filter(r => r.status === "pending" && r.addressee_id === me);
  const pendingOut = rels.filter(r => r.status === "pending" && r.requester_id === me);

  const otherIds = new Set();
  for (const r of rels) {
    otherIds.add(r.requester_id === me ? r.addressee_id : r.requester_id);
  }

  let profilesById = {};
  if (otherIds.size > 0) {
    const { data: profs, error: pErr } = await supabase
      .from("profiles")
      .select("id, username, friend_code, timezone, active_start, active_end, color")
      .in("id", [...otherIds]);
    if (pErr) throw pErr;
    for (const p of profs) profilesById[p.id] = p;
  }

  state.friends = accepted.map(r => {
    const otherId = r.requester_id === me ? r.addressee_id : r.requester_id;
    return { friendship: r, profile: profilesById[otherId] };
  }).filter(f => f.profile);

  state.pendingIn = pendingIn.map(r => ({ friendship: r, profile: profilesById[r.requester_id] }));
  state.pendingOut = pendingOut.map(r => ({ friendship: r, profile: profilesById[r.addressee_id] }));
}

async function onAddFriend(e) {
  e.preventDefault();
  const input = document.getElementById("friendCodeInput");
  const code = input.value.trim().toUpperCase();
  const msg = document.getElementById("addFriendMsg");
  msg.hidden = true;

  if (code.length !== 6) {
    msg.textContent = "请输入 6 位好友代码";
    msg.hidden = false;
    return;
  }

  try {
    const { data, error } = await supabase.rpc("send_friend_request", { code });
    if (error) throw error;
    input.value = "";
    await loadFriends();
    renderMain();
    if (data && data.status === "accepted") toast("已成为好友", "success");
    else toast("请求已发送", "success");
  } catch (err) {
    const m = (err.message || "").toLowerCase();
    if (m.includes("friend_code_not_found")) msg.textContent = "没找到这个好友代码";
    else if (m.includes("cannot_add_self")) msg.textContent = "不能添加自己";
    else msg.textContent = "添加失败：" + err.message;
    msg.hidden = false;
  }
}

async function acceptRequest(id) {
  const { error } = await supabase.from("friendships").update({ status: "accepted" }).eq("id", id);
  if (error) return toast("操作失败：" + error.message, "error");
  await loadFriends();
  renderMain();
  toast("已接受", "success");
}

async function rejectRequest(id) {
  const { error } = await supabase.from("friendships").delete().eq("id", id);
  if (error) return toast("操作失败：" + error.message, "error");
  await loadFriends();
  renderMain();
}

async function removeFriend(friendProfileId) {
  if (!confirm("删除这位好友？")) return;
  const me = state.session.user.id;
  const { error } = await supabase.from("friendships").delete()
    .or(`and(requester_id.eq.${me},addressee_id.eq.${friendProfileId}),and(requester_id.eq.${friendProfileId},addressee_id.eq.${me})`);
  if (error) return toast("删除失败：" + error.message, "error");
  await loadFriends();
  renderMain();
}

function copyMyCode() {
  if (!state.profile) return;
  navigator.clipboard.writeText(state.profile.friend_code).then(() => toast("已复制好友代码", "success"));
}

/* ---------- Main view render ---------- */

function renderMain() {
  document.getElementById("meName").textContent = state.profile.username;
  document.getElementById("meCode").textContent = state.profile.friend_code;

  const offset = formatOffset(tzOffsetMinutes(state.profile.timezone, new Date()));
  const nowLocal = formatTimeIn(state.profile.timezone, new Date(), state.use24h);
  document.getElementById("selfMeta").textContent =
    `${tzLabel(state.profile.timezone)} (UTC${offset}) · 当地现在 ${nowLocal} · 活跃 ${state.profile.active_start}–${state.profile.active_end}`;

  renderTimeline();
  renderFriendList();
  renderPending();
}

function renderFriendList() {
  const ul = document.getElementById("friendList");
  ul.innerHTML = "";
  const empty = document.getElementById("friendEmpty");
  empty.hidden = state.friends.length > 0;

  for (const f of state.friends) {
    const p = f.profile;
    const li = document.createElement("li");
    li.className = "friend-row";
    const offset = formatOffset(tzOffsetMinutes(p.timezone, new Date()));
    const now = formatTimeIn(p.timezone, new Date(), state.use24h);
    li.innerHTML = `
      <span class="swatch" style="background:${escapeAttr(p.color)}"></span>
      <div>
        <div class="name">${escapeHtml(p.username)}</div>
        <div class="meta">${escapeHtml(tzLabel(p.timezone))} (UTC${offset}) · 当地现在 ${now} · 活跃 ${escapeHtml(p.active_start)}–${escapeHtml(p.active_end)}</div>
      </div>
      <span class="spacer"></span>
      <button class="ghost small" data-act="del">删除</button>
    `;
    li.querySelector('[data-act="del"]').addEventListener("click", () => removeFriend(p.id));
    ul.appendChild(li);
  }
}

function renderPending() {
  const inEl = document.getElementById("pendingIn");
  const outEl = document.getElementById("pendingOut");
  inEl.innerHTML = "";
  outEl.innerHTML = "";

  for (const r of state.pendingIn) {
    const item = document.createElement("div");
    item.className = "pending-item";
    const name = r.profile ? escapeHtml(r.profile.username) : "(未知用户)";
    item.innerHTML = `
      <div class="who">${name} <span class="tag">想加你为好友</span></div>
      <button class="success small" data-act="yes">接受</button>
      <button class="ghost small" data-act="no">拒绝</button>
    `;
    item.querySelector('[data-act="yes"]').addEventListener("click", () => acceptRequest(r.friendship.id));
    item.querySelector('[data-act="no"]').addEventListener("click", () => rejectRequest(r.friendship.id));
    inEl.appendChild(item);
  }

  for (const r of state.pendingOut) {
    const item = document.createElement("div");
    item.className = "pending-item";
    const name = r.profile ? escapeHtml(r.profile.username) : "(未知用户)";
    item.innerHTML = `
      <div class="who">${name} <span class="tag out">请求已发送，等待对方接受</span></div>
      <button class="ghost small" data-act="cancel">撤回</button>
    `;
    item.querySelector('[data-act="cancel"]').addEventListener("click", () => rejectRequest(r.friendship.id));
    outEl.appendChild(item);
  }
}

/* ---------- Timeline ---------- */

function renderTimeline() {
  const timeline = document.getElementById("timeline");
  timeline.innerHTML = "";

  const viewerTz = state.profile.timezone;
  const anchor = startOfDayInTz(new Date(), viewerTz);
  const totalMinutes = 24 * 60;

  // Hour header
  const header = document.createElement("div");
  header.className = "tl-header";
  const headerLabel = document.createElement("div");
  headerLabel.className = "tl-label";
  headerLabel.textContent = tzLabel(viewerTz);
  const hours = document.createElement("div");
  hours.className = "tl-hours";
  for (let h = 0; h <= 24; h += 2) {
    const pct = (h / 24) * 100;
    const hourEl = document.createElement("div");
    hourEl.className = "hour";
    hourEl.style.left = pct + "%";
    hourEl.textContent = state.use24h ? pad(h % 24) : hourLabel12(h);
    hours.appendChild(hourEl);
    const tick = document.createElement("div");
    tick.className = "tick";
    tick.style.left = pct + "%";
    hours.appendChild(tick);
  }
  header.appendChild(headerLabel);
  header.appendChild(hours);
  timeline.appendChild(header);

  // Self row (thick)
  const selfIntervals = computeIntervalsInViewer(state.profile, anchor);
  timeline.appendChild(makeTimelineRow({
    label: state.profile.username + " (我)",
    color: state.profile.color,
    intervals: selfIntervals,
    anchor,
    variant: "main",
    rowClass: "self",
  }));

  // Friend rows (thin)
  const allIntervals = [selfIntervals];
  for (const f of state.friends) {
    const p = f.profile;
    const intervals = computeIntervalsInViewer(p, anchor);
    allIntervals.push(intervals);
    timeline.appendChild(makeTimelineRow({
      label: p.username,
      color: p.color,
      intervals,
      anchor,
      variant: "friend",
    }));
  }

  // Overlap row
  const overlaps = computeOverlap(allIntervals);
  if (state.friends.length >= 1) {
    const spacer = document.createElement("div");
    spacer.className = "tl-row spacer-row";
    timeline.appendChild(spacer);
    timeline.appendChild(makeTimelineRow({
      label: "共同在线",
      color: "var(--overlap)",
      intervals: overlaps,
      anchor,
      variant: "overlap-track",
      rowClass: "overlap-row",
    }));
  }

  renderOverlapList(overlaps);
}

function makeTimelineRow({ label, color, intervals, anchor, variant, rowClass = "" }) {
  const row = document.createElement("div");
  row.className = "tl-row " + rowClass;

  const labelEl = document.createElement("div");
  labelEl.className = "tl-label";
  labelEl.innerHTML = `<span class="dot-color" style="background:${escapeAttr(color)}"></span><span>${escapeHtml(label)}</span>`;

  const track = document.createElement("div");
  track.className = "tl-track " + variant;

  const totalMinutes = 24 * 60;
  for (const [s, e] of intervals) {
    const block = document.createElement("div");
    block.className = "tl-block";
    block.style.left = ((s / totalMinutes) * 100) + "%";
    block.style.width = (((e - s) / totalMinutes) * 100) + "%";
    if (variant !== "overlap-track") block.style.background = color;
    block.title = `${minutesToLabel(s)} – ${minutesToLabel(e)}`;
    track.appendChild(block);
  }
  addNowMarker(track, anchor, variant === "main");

  row.appendChild(labelEl);
  row.appendChild(track);
  return row;
}

function renderOverlapList(overlaps) {
  const el = document.getElementById("overlapList");
  el.innerHTML = "";
  if (state.friends.length < 1) {
    el.innerHTML = '<div class="overlap-chip empty">添加好友后这里会显示共同在线的时段。</div>';
    return;
  }
  if (overlaps.length === 0) {
    el.innerHTML = '<div class="overlap-chip empty">今天你和好友们没有完全重合的时段 😅</div>';
    return;
  }
  for (const [s, e] of overlaps) {
    const chip = document.createElement("div");
    chip.className = "overlap-chip";
    chip.textContent = `${minutesToLabel(s)} – ${minutesToLabel(e)} · ${formatDuration(e - s)}`;
    el.appendChild(chip);
  }
}

function addNowMarker(track, anchor, isMain) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const rel = now - anchor.getTime();
  if (rel < 0 || rel > dayMs) return;
  const el = document.createElement("div");
  el.className = "tl-now" + (isMain ? " main-now" : "");
  el.style.left = ((rel / dayMs) * 100) + "%";
  track.appendChild(el);
}

function computeIntervalsInViewer(person, anchor) {
  const anchorMs = anchor.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const [sh, sm] = person.active_start.split(":").map(Number);
  const [eh, em] = person.active_end.split(":").map(Number);
  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;

  const out = [];
  for (const dayOffset of [-1, 0, 1]) {
    const refMs = anchorMs + dayOffset * dayMs;
    const localMidnight = localMidnightMsForTz(refMs, person.timezone);
    const absStart = localMidnight + startMin * 60000;
    const absEnd = localMidnight + endMin * 60000;
    const s = Math.max(absStart, anchorMs);
    const e = Math.min(absEnd, anchorMs + dayMs);
    if (e > s) out.push([(s - anchorMs) / 60000, (e - anchorMs) / 60000]);
  }
  return mergeIntervals(out);
}

function localMidnightMsForTz(refMs, tz) {
  const y = Number(formatInTz(refMs, tz, { year: "numeric" }));
  const m = Number(formatInTz(refMs, tz, { month: "2-digit" }));
  const d = Number(formatInTz(refMs, tz, { day: "2-digit" }));
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset = tzOffsetMinutes(tz, new Date(guess));
  return guess - offset * 60000;
}

function startOfDayInTz(date, tz) {
  const y = Number(formatInTz(date.getTime(), tz, { year: "numeric" }));
  const m = Number(formatInTz(date.getTime(), tz, { month: "2-digit" }));
  const d = Number(formatInTz(date.getTime(), tz, { day: "2-digit" }));
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset = tzOffsetMinutes(tz, new Date(guess));
  return new Date(guess - offset * 60000);
}

function tzOffsetMinutes(tz, date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
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

function computeOverlap(lists) {
  if (lists.length === 0) return [];
  let acc = lists[0].map(i => i.slice());
  for (let i = 1; i < lists.length; i++) {
    acc = intersectIntervals(acc, lists[i]);
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

/* ---------- Formatting ---------- */

const TIMEZONES = [
  { value: "Asia/Shanghai", label: "中国 · 北京" },
  { value: "Asia/Tokyo", label: "日本 · 东京" },
  { value: "America/Phoenix", label: "美国 · 凤凰城" },
  { value: "America/Los_Angeles", label: "美国 · 旧金山" },
  { value: "America/New_York", label: "美国 · 纽约" },
  { value: "America/Toronto", label: "加拿大 · 多伦多" },
];

function fillTimezoneSelect(sel, current) {
  sel.innerHTML = "";
  const list = [...TIMEZONES];
  if (current && !list.some(tz => tz.value === current)) {
    list.push({ value: current, label: current });
  }
  for (const tz of list) {
    const opt = document.createElement("option");
    opt.value = tz.value;
    const off = formatOffset(tzOffsetMinutes(tz.value, new Date()));
    opt.textContent = `${tz.label} (UTC${off})`;
    if (tz.value === current) opt.selected = true;
    sel.appendChild(opt);
  }
}

function tzLabel(value) {
  const found = TIMEZONES.find(t => t.value === value);
  return found ? found.label : value;
}

function minutesToLabel(min) {
  const total = Math.round(min);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return state.use24h ? `${pad(h)}:${pad(m)}` : to12(h, m);
}
function to12(h, m) {
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${pad(m)} ${ap}`;
}
function hourLabel12(h) {
  const ap = h >= 12 && h < 24 ? "P" : "A";
  return `${((h + 11) % 12) + 1}${ap}`;
}
function formatTimeIn(tz, date, use24) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: !use24 }).format(date);
}
function formatOffset(min) {
  const sign = min >= 0 ? "+" : "-";
  const abs = Math.abs(min);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
function formatDuration(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h && m) return `${h} 小时 ${m} 分`;
  if (h) return `${h} 小时`;
  return `${m} 分钟`;
}
function pad(n) { return String(n).padStart(2, "0"); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

setInterval(() => { if (!views.main.hidden) renderMain(); }, 60 * 1000);
