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
  chatGroups: [],
  currentGroup: null,
  use24h: true,
  hiddenFriends: loadHiddenFriends(),
};

function loadHiddenFriends() {
  try {
    const raw = localStorage.getItem("hiddenFriends");
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}
function saveHiddenFriends() {
  try {
    localStorage.setItem("hiddenFriends", JSON.stringify([...state.hiddenFriends]));
  } catch {}
}
function toggleFriendVisible(id, visible) {
  if (visible) state.hiddenFriends.delete(id);
  else state.hiddenFriends.add(id);
  saveHiddenFriends();
  renderTimeline();
}

const views = {
  loading: document.getElementById("view-loading"),
  auth: document.getElementById("view-auth"),
  onboarding: document.getElementById("view-onboarding"),
  main: document.getElementById("view-main"),
  chat: document.getElementById("view-chat"),
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
  teardownChat();
  if (!session) {
    state.profile = null;
    state.friends = [];
    state.pendingIn = [];
    state.pendingOut = [];
    state.chatGroups = [];
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
    await loadChatGroups();
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
  document.querySelectorAll(".add-period").forEach(btn => {
    btn.addEventListener("click", () => {
      const list = document.getElementById(btn.dataset.target);
      list.appendChild(makePeriodRow("19:00", "23:00"));
    });
  });

  document.getElementById("openCreateGroup").addEventListener("click", openCreateGroupModal);
  document.getElementById("closeCreateGroup").addEventListener("click", closeCreateGroupModal);
  document.getElementById("createGroupForm").addEventListener("submit", onCreateGroup);
  document.getElementById("chatBack").addEventListener("click", closeChatGroup);
  document.getElementById("chatLogout").addEventListener("click", onLogout);
  document.getElementById("chatForm").addEventListener("submit", onSendMessage);
  const chatInput = document.getElementById("chatInput");
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("chatForm").requestSubmit();
    }
  });
  chatInput.addEventListener("input", autosizeChatInput);

  document.getElementById("chatSettingsBtn").addEventListener("click", openChatGroupModal);
  document.getElementById("closeChatGroupModal").addEventListener("click", closeChatGroupModal);
  document.getElementById("saveChatGroupName").addEventListener("click", onRenameChatGroup);
  document.getElementById("addChatGroupMembersBtn").addEventListener("click", onAddChatGroupMembers);
  document.getElementById("leaveChatGroupBtn").addEventListener("click", onLeaveChatGroup);

  document.getElementById("openOverride").addEventListener("click", openOverrideModal);
  document.getElementById("closeOverride").addEventListener("click", closeOverrideModal);
  document.getElementById("saveOverrideBtn").addEventListener("click", onSaveOverride);
  document.getElementById("clearOverrideBtn").addEventListener("click", onClearOverride);
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
  renderPeriodInputs("obPeriodsList", getActivePeriods(state.profile));
  form.color.value = state.profile.color || "#4f8cff";
  showView("onboarding");
}

async function onOnboardingSave(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const err = document.getElementById("onboardingError");
  err.hidden = true;
  const periods = collectPeriods("obPeriodsList");
  if (periods.length === 0) {
    err.textContent = "请至少添加一个活跃时段";
    err.hidden = false;
    return;
  }
  try {
    await updateProfile({
      username: fd.get("username").trim(),
      timezone: fd.get("timezone"),
      active_periods: periods,
      active_start: periods[0].start,
      active_end: periods[0].end,
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
  renderPeriodInputs("settingsPeriodsList", getActivePeriods(state.profile));
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
  const periods = collectPeriods("settingsPeriodsList");
  if (periods.length === 0) {
    err.textContent = "请至少添加一个活跃时段";
    err.hidden = false;
    return;
  }
  try {
    await updateProfile({
      username: fd.get("username").trim(),
      timezone: fd.get("timezone"),
      active_periods: periods,
      active_start: periods[0].start,
      active_end: periods[0].end,
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
      .select("id, username, friend_code, timezone, active_start, active_end, active_periods, override_date, override_periods, color")
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

/* ---------- Chat groups ---------- */

async function loadChatGroups() {
  const { data: groups, error } = await supabase
    .from("chat_groups")
    .select("id, name, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;

  if (!groups || groups.length === 0) {
    state.chatGroups = [];
    return;
  }

  const gids = groups.map(g => g.id);
  const { data: mrows, error: mErr } = await supabase
    .from("chat_group_members")
    .select("group_id, user_id")
    .in("group_id", gids);
  if (mErr) throw mErr;

  const memberIds = [...new Set(mrows.map(m => m.user_id))];
  const profsById = {};
  if (memberIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles").select("id, username, color").in("id", memberIds);
    for (const p of (profs || [])) profsById[p.id] = p;
  }

  const byGroup = {};
  for (const r of mrows) {
    if (!byGroup[r.group_id]) byGroup[r.group_id] = [];
    if (profsById[r.user_id]) byGroup[r.group_id].push(profsById[r.user_id]);
  }

  state.chatGroups = groups.map(g => ({ ...g, members: byGroup[g.id] || [] }));
}

function renderGroupList() {
  const ul = document.getElementById("groupList");
  const empty = document.getElementById("groupEmpty");
  ul.innerHTML = "";
  empty.hidden = state.chatGroups.length > 0;
  for (const g of state.chatGroups) {
    const li = document.createElement("li");
    li.className = "group-row";
    const others = g.members.filter(m => m.id !== state.session.user.id);
    const names = others.length > 0
      ? others.map(m => m.username).join("、")
      : "只有你";
    const dots = g.members.slice(0, 5).map(m =>
      `<span class="member-dot" style="background:${escapeAttr(m.color)}"></span>`
    ).join("");
    li.innerHTML = `
      <div class="group-dots">${dots}</div>
      <div class="group-info">
        <div class="name">${escapeHtml(g.name)}</div>
        <div class="meta">${g.members.length} 人 · ${escapeHtml(names)}</div>
      </div>
      <span class="chevron">›</span>
    `;
    li.addEventListener("click", () => openChatGroup(g.id));
    ul.appendChild(li);
  }
}

function openCreateGroupModal() {
  const form = document.getElementById("createGroupForm");
  form.reset();
  const picker = document.getElementById("groupFriendPicker");
  const emptyEl = document.getElementById("groupFriendEmpty");
  picker.innerHTML = "";
  if (state.friends.length === 0) {
    emptyEl.hidden = false;
    picker.hidden = true;
  } else {
    emptyEl.hidden = true;
    picker.hidden = false;
    for (const f of state.friends) {
      const row = document.createElement("label");
      row.className = "friend-pick";
      row.innerHTML = `
        <input type="checkbox" value="${escapeAttr(f.profile.id)}" />
        <span class="swatch" style="background:${escapeAttr(f.profile.color)}"></span>
        <span class="pick-name">${escapeHtml(f.profile.username)}</span>
      `;
      picker.appendChild(row);
    }
  }
  document.getElementById("createGroupError").hidden = true;
  document.getElementById("createGroupModal").hidden = false;
}

function closeCreateGroupModal() {
  document.getElementById("createGroupModal").hidden = true;
}

async function onCreateGroup(e) {
  e.preventDefault();
  const form = e.target;
  const name = form.name.value.trim();
  const err = document.getElementById("createGroupError");
  err.hidden = true;
  const memberIds = Array.from(form.querySelectorAll(".friend-pick input:checked")).map(i => i.value);
  try {
    const { data: gid, error } = await supabase.rpc("create_chat_group", {
      p_name: name,
      p_member_ids: memberIds,
    });
    if (error) throw error;
    closeCreateGroupModal();
    await loadChatGroups();
    renderGroupList();
    toast("群已创建", "success");
    if (gid) await openChatGroup(gid);
  } catch (ex) {
    const m = (ex.message || "").toLowerCase();
    if (m.includes("not_friends")) err.textContent = "只能邀请已加好友的人";
    else if (m.includes("name_required")) err.textContent = "请输入群名";
    else err.textContent = ex.message || "创建失败";
    err.hidden = false;
  }
}

async function openChatGroup(gid) {
  teardownChat();
  showView("loading");
  try {
    const { data: group, error: gErr } = await supabase
      .from("chat_groups").select("id, name").eq("id", gid).single();
    if (gErr) throw gErr;

    const { data: mrows, error: mErr } = await supabase
      .from("chat_group_members").select("user_id").eq("group_id", gid);
    if (mErr) throw mErr;

    const memberIds = mrows.map(r => r.user_id);
    let members = [];
    if (memberIds.length > 0) {
      const { data: profs, error: pErr } = await supabase
        .from("profiles")
        .select("id, username, color, timezone, active_start, active_end, active_periods, override_date, override_periods")
        .in("id", memberIds);
      if (pErr) throw pErr;
      members = profs || [];
    }

    const { data: messages, error: msgErr } = await supabase
      .from("chat_messages")
      .select("id, group_id, user_id, content, created_at")
      .eq("group_id", gid)
      .order("created_at", { ascending: true })
      .limit(200);
    if (msgErr) throw msgErr;

    state.currentGroup = {
      id: gid,
      name: group.name,
      members,
      messages: messages || [],
      channel: null,
    };

    document.getElementById("chatTitle").textContent = group.name;
    document.getElementById("chatMemberCount").textContent = `· ${members.length} 人`;
    renderChatMembers();
    renderChatMessages();
    subscribeChat(gid);
    showView("chat");
    requestAnimationFrame(scrollChatToBottom);
  } catch (ex) {
    console.error(ex);
    toast("打开群失败：" + (ex.message || ex), "error");
    showView("main");
  }
}

function subscribeChat(gid) {
  const ch = supabase.channel(`chat-${gid}`)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "chat_messages",
      filter: `group_id=eq.${gid}`,
    }, (payload) => {
      if (!state.currentGroup || state.currentGroup.id !== gid) return;
      const m = payload.new;
      if (state.currentGroup.messages.some(x => x.id === m.id)) return;
      state.currentGroup.messages.push(m);
      appendMessage(m);
      scrollChatToBottom();
    })
    .subscribe();
  state.currentGroup.channel = ch;
}

function teardownChat() {
  if (state.currentGroup && state.currentGroup.channel) {
    supabase.removeChannel(state.currentGroup.channel);
  }
  state.currentGroup = null;
}

function closeChatGroup() {
  teardownChat();
  renderMain();
  showView("main");
}

async function onSendMessage(e) {
  e.preventDefault();
  const input = document.getElementById("chatInput");
  const content = input.value.trim();
  if (!content || !state.currentGroup) return;
  input.value = "";
  autosizeChatInput();
  const gid = state.currentGroup.id;
  const { data, error } = await supabase.from("chat_messages").insert({
    group_id: gid,
    user_id: state.session.user.id,
    content,
  }).select().single();
  if (error) {
    toast("发送失败：" + error.message, "error");
    input.value = content;
    autosizeChatInput();
    return;
  }
  if (data && state.currentGroup && state.currentGroup.id === gid) {
    if (!state.currentGroup.messages.some(x => x.id === data.id)) {
      state.currentGroup.messages.push(data);
      appendMessage(data);
      scrollChatToBottom();
    }
  }
}

function renderChatMembers() {
  const ul = document.getElementById("chatMemberList");
  ul.innerHTML = "";
  for (const m of state.currentGroup.members) {
    const li = document.createElement("li");
    li.className = "chat-member";
    const offset = formatOffset(tzOffsetMinutes(m.timezone, new Date()));
    const now = formatTimeIn(m.timezone, new Date(), state.use24h);
    const periods = formatPersonPeriods(m);
    const isMe = m.id === state.session.user.id;
    li.innerHTML = `
      <span class="swatch" style="background:${escapeAttr(m.color)}"></span>
      <div class="member-info">
        <div class="name">${escapeHtml(m.username)}${isMe ? ' <span class="me-tag">我</span>' : ''}</div>
        <div class="meta">${escapeHtml(tzLabel(m.timezone))} (UTC${offset}) · 当地 ${now} · 活跃 ${escapeHtml(periods)}</div>
      </div>
    `;
    ul.appendChild(li);
  }
}

function renderChatMessages() {
  const el = document.getElementById("chatMessages");
  el.innerHTML = "";
  if (state.currentGroup.messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "还没有消息，说点什么打破沉默 ✨";
    el.appendChild(empty);
    return;
  }
  for (const m of state.currentGroup.messages) appendMessage(m);
}

function appendMessage(m) {
  const el = document.getElementById("chatMessages");
  const emptyEl = el.querySelector(".chat-empty");
  if (emptyEl) emptyEl.remove();
  const author = state.currentGroup.members.find(p => p.id === m.user_id);
  const name = author ? author.username : "(未知)";
  const color = author ? author.color : "#888";
  const createdMs = new Date(m.created_at).getTime();
  const ts = new Date(createdMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const prev = el.lastElementChild;
  const prevUser = prev && prev.classList.contains("msg") ? prev.getAttribute("data-user-id") : null;
  const prevTime = prev && prev.classList.contains("msg") ? Number(prev.getAttribute("data-time")) : 0;
  const grouped = prevUser === m.user_id && createdMs - prevTime < 5 * 60 * 1000;

  const item = document.createElement("div");
  item.className = "msg" + (grouped ? " grouped" : "");
  item.setAttribute("data-user-id", m.user_id);
  item.setAttribute("data-time", String(createdMs));
  item.innerHTML = `
    <span class="msg-avatar" style="background:${escapeAttr(color)}">${escapeHtml(name.slice(0, 1))}</span>
    <div class="msg-body">
      <div class="msg-head"><span class="msg-name">${escapeHtml(name)}</span><span class="msg-time">${ts}</span></div>
      <div class="msg-text">${escapeHtml(m.content)}</div>
    </div>
  `;
  el.appendChild(item);
}

function scrollChatToBottom() {
  const el = document.getElementById("chatMessages");
  if (el) el.scrollTop = el.scrollHeight;
}

function autosizeChatInput() {
  const el = document.getElementById("chatInput");
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 140) + "px";
}

/* ---------- Chat group settings ---------- */

function openChatGroupModal() {
  if (!state.currentGroup) return;
  const g = state.currentGroup;
  document.getElementById("chatGroupNameInput").value = g.name;

  const picker = document.getElementById("chatGroupAddPicker");
  const emptyEl = document.getElementById("chatGroupAddEmpty");
  picker.innerHTML = "";
  const memberIds = new Set(g.members.map(m => m.id));
  const candidates = state.friends.filter(f => !memberIds.has(f.profile.id));
  if (candidates.length === 0) {
    emptyEl.hidden = false;
    picker.hidden = true;
  } else {
    emptyEl.hidden = true;
    picker.hidden = false;
    for (const f of candidates) {
      const row = document.createElement("label");
      row.className = "friend-pick";
      row.innerHTML = `
        <input type="checkbox" value="${escapeAttr(f.profile.id)}" />
        <span class="swatch" style="background:${escapeAttr(f.profile.color)}"></span>
        <span class="pick-name">${escapeHtml(f.profile.username)}</span>
      `;
      picker.appendChild(row);
    }
  }
  document.getElementById("chatGroupError").hidden = true;
  document.getElementById("chatGroupModal").hidden = false;
}

function closeChatGroupModal() {
  document.getElementById("chatGroupModal").hidden = true;
}

function showGroupErr(msg) {
  const err = document.getElementById("chatGroupError");
  err.textContent = msg;
  err.hidden = false;
}

async function onRenameChatGroup() {
  if (!state.currentGroup) return;
  const name = document.getElementById("chatGroupNameInput").value.trim();
  document.getElementById("chatGroupError").hidden = true;
  if (!name) { showGroupErr("请输入群名"); return; }
  const gid = state.currentGroup.id;
  const { error } = await supabase.rpc("rename_chat_group", { p_group_id: gid, p_name: name });
  if (error) {
    const m = (error.message || "").toLowerCase();
    if (m.includes("name_required")) showGroupErr("请输入群名");
    else if (m.includes("not_a_member")) showGroupErr("你已不在这个群里");
    else showGroupErr(error.message || "保存失败");
    return;
  }
  state.currentGroup.name = name;
  document.getElementById("chatTitle").textContent = name;
  const cached = state.chatGroups.find(g => g.id === gid);
  if (cached) cached.name = name;
  toast("群名已更新", "success");
}

async function onAddChatGroupMembers() {
  if (!state.currentGroup) return;
  const picker = document.getElementById("chatGroupAddPicker");
  const ids = Array.from(picker.querySelectorAll("input:checked")).map(i => i.value);
  document.getElementById("chatGroupError").hidden = true;
  if (ids.length === 0) { showGroupErr("请至少选择一位好友"); return; }
  const gid = state.currentGroup.id;
  try {
    for (const uid of ids) {
      const { error } = await supabase.rpc("add_chat_group_member", {
        p_group_id: gid, p_user_id: uid,
      });
      if (error) throw error;
    }
    await refreshChatMembers();
    await loadChatGroups();
    closeChatGroupModal();
    toast("已添加成员", "success");
  } catch (ex) {
    const m = (ex.message || "").toLowerCase();
    if (m.includes("not_friends")) showGroupErr("只能邀请已加好友的人");
    else if (m.includes("not_a_member")) showGroupErr("你已不在这个群里");
    else showGroupErr(ex.message || "添加失败");
  }
}

async function refreshChatMembers() {
  if (!state.currentGroup) return;
  const gid = state.currentGroup.id;
  const { data: mrows, error: mErr } = await supabase
    .from("chat_group_members").select("user_id").eq("group_id", gid);
  if (mErr) throw mErr;
  const memberIds = mrows.map(r => r.user_id);
  let members = [];
  if (memberIds.length > 0) {
    const { data: profs, error: pErr } = await supabase
      .from("profiles")
      .select("id, username, color, timezone, active_start, active_end, active_periods")
      .in("id", memberIds);
    if (pErr) throw pErr;
    members = profs || [];
  }
  state.currentGroup.members = members;
  document.getElementById("chatMemberCount").textContent = `· ${members.length} 人`;
  renderChatMembers();
  renderChatMessages();
}

/* ---------- Today override ---------- */

function openOverrideModal() {
  const tz = state.profile.timezone;
  const today = tzDateStr(Date.now(), tz);
  const weekday = new Intl.DateTimeFormat("zh-CN", { timeZone: tz, weekday: "long" })
    .format(new Date());
  document.getElementById("overrideDateLabel").textContent =
    `${tzLabel(tz)} · 今天是 ${today}（${weekday}）`;

  const initial = hasActiveOverride(state.profile)
    ? state.profile.override_periods
    : getActivePeriods(state.profile);
  renderPeriodInputs("overridePeriodsList", initial);
  document.getElementById("overrideError").hidden = true;
  document.getElementById("overrideModal").hidden = false;
}

function closeOverrideModal() {
  document.getElementById("overrideModal").hidden = true;
}

async function onSaveOverride() {
  const tz = state.profile.timezone;
  const today = tzDateStr(Date.now(), tz);
  const periods = collectPeriods("overridePeriodsList");
  const err = document.getElementById("overrideError");
  err.hidden = true;
  if (periods.length === 0) {
    err.textContent = "请至少添加一个时段（或点清除按钮）";
    err.hidden = false;
    return;
  }
  try {
    await updateProfile({ override_date: today, override_periods: periods });
    closeOverrideModal();
    renderMain();
    toast("已设置今天的临时时段", "success");
  } catch (ex) {
    err.textContent = ex.message || "保存失败";
    err.hidden = false;
  }
}

async function onClearOverride() {
  try {
    await updateProfile({ override_date: null, override_periods: [] });
    closeOverrideModal();
    renderMain();
    toast("已恢复默认时段", "success");
  } catch (ex) {
    const err = document.getElementById("overrideError");
    err.textContent = ex.message || "清除失败";
    err.hidden = false;
  }
}

async function onLeaveChatGroup() {
  if (!state.currentGroup) return;
  if (!confirm("确认退出这个群？离开后就看不到这里的消息了。")) return;
  const gid = state.currentGroup.id;
  const { error } = await supabase.rpc("leave_chat_group", { p_group_id: gid });
  if (error) {
    toast("退出失败：" + error.message, "error");
    return;
  }
  closeChatGroupModal();
  teardownChat();
  await loadChatGroups();
  renderMain();
  showView("main");
  toast("已退出群", "success");
}

/* ---------- Main view render ---------- */

function renderMain() {
  document.getElementById("meName").textContent = state.profile.username;
  document.getElementById("meCode").textContent = state.profile.friend_code;

  const offset = formatOffset(tzOffsetMinutes(state.profile.timezone, new Date()));
  const nowLocal = formatTimeIn(state.profile.timezone, new Date(), state.use24h);
  document.getElementById("selfMeta").textContent =
    `${tzLabel(state.profile.timezone)} (UTC${offset}) · 当地现在 ${nowLocal} · 活跃 ${formatPersonPeriods(state.profile)}`;

  renderTimeline();
  renderFriendList();
  renderPending();
  renderGroupList();
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
    const visible = !state.hiddenFriends.has(p.id);
    li.innerHTML = `
      <label class="friend-toggle" title="在时间轴上显示">
        <input type="checkbox" data-act="toggle" ${visible ? "checked" : ""} />
      </label>
      <span class="swatch" style="background:${escapeAttr(p.color)}"></span>
      <div>
        <div class="name">${escapeHtml(p.username)}</div>
        <div class="meta">${escapeHtml(tzLabel(p.timezone))} (UTC${offset}) · 当地现在 ${now} · 活跃 ${escapeHtml(formatPersonPeriods(p))}</div>
      </div>
      <span class="spacer"></span>
      <button class="ghost small" data-act="del">删除</button>
    `;
    li.querySelector('[data-act="del"]').addEventListener("click", () => removeFriend(p.id));
    li.querySelector('[data-act="toggle"]').addEventListener("change", (e) => toggleFriendVisible(p.id, e.target.checked));
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

  // Friend rows (thin) + per-friend pair overlap with self
  const friendData = [];
  const visibleFriends = state.friends.filter(f => !state.hiddenFriends.has(f.profile.id));
  for (const f of visibleFriends) {
    const p = f.profile;
    const intervals = computeIntervalsInViewer(p, anchor);
    const pair = intersectIntervals(selfIntervals, intervals);
    friendData.push({ profile: p, intervals, pair });
    timeline.appendChild(makeTimelineRow({
      label: p.username,
      color: p.color,
      intervals,
      anchor,
      variant: "friend",
    }));
  }

  // Union of pair overlaps = "你和任意好友都在线"
  const anyOverlap = mergeIntervals(friendData.flatMap(d => d.pair.map(i => i.slice())));
  // Everyone overlap (only meaningful with 2+ friends)
  const allOverlap = friendData.length >= 2
    ? computeOverlap([selfIntervals, ...friendData.map(d => d.intervals)])
    : null;

  if (friendData.length >= 1) {
    const spacer = document.createElement("div");
    spacer.className = "tl-row spacer-row";
    timeline.appendChild(spacer);
    timeline.appendChild(makeTimelineRow({
      label: "和好友重合",
      color: "var(--overlap)",
      intervals: anyOverlap,
      anchor,
      variant: "overlap-track",
      rowClass: "overlap-row",
    }));
  }

  renderOverlapList(friendData, allOverlap);
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

function renderOverlapList(friendData, allOverlap) {
  const el = document.getElementById("overlapList");
  el.innerHTML = "";
  if (friendData.length < 1) {
    el.innerHTML = '<div class="overlap-chip empty">添加好友后这里会显示共同在线的时段。</div>';
    return;
  }

  const anyPair = friendData.some(d => d.pair.length > 0);
  if (!anyPair) {
    el.innerHTML = '<div class="overlap-chip empty">今天你和好友们都错开了，明天再约 😅</div>';
    return;
  }

  if (allOverlap && allOverlap.length > 0) {
    const group = document.createElement("div");
    group.className = "overlap-group all";
    const head = document.createElement("div");
    head.className = "overlap-group-title";
    head.textContent = "所有人都在线";
    group.appendChild(head);
    const chips = document.createElement("div");
    chips.className = "overlap-chip-row";
    for (const [s, e] of allOverlap) {
      chips.appendChild(makeOverlapChip(s, e, "all"));
    }
    group.appendChild(chips);
    el.appendChild(group);
  }

  for (const d of friendData) {
    if (d.pair.length === 0) continue;
    const group = document.createElement("div");
    group.className = "overlap-group";
    const head = document.createElement("div");
    head.className = "overlap-group-title";
    head.innerHTML = `<span class="dot-color" style="background:${escapeAttr(d.profile.color)}"></span>和 ${escapeHtml(d.profile.username)}`;
    group.appendChild(head);
    const chips = document.createElement("div");
    chips.className = "overlap-chip-row";
    for (const [s, e] of d.pair) {
      chips.appendChild(makeOverlapChip(s, e));
    }
    group.appendChild(chips);
    el.appendChild(group);
  }
}

function makeOverlapChip(s, e, kind = "") {
  const chip = document.createElement("div");
  chip.className = "overlap-chip" + (kind ? " " + kind : "");
  chip.textContent = `${minutesToLabel(s)} – ${minutesToLabel(e)} · ${formatDuration(e - s)}`;
  return chip;
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
  const out = [];
  for (const dayOffset of [-1, 0, 1]) {
    const refMs = anchorMs + dayOffset * dayMs;
    const localMidnight = localMidnightMsForTz(refMs, person.timezone);
    const dateStr = tzDateStr(refMs, person.timezone);
    const periods = periodsForDate(person, dateStr);
    for (const period of periods) {
      const [sh, sm] = period.start.split(":").map(Number);
      const [eh, em] = period.end.split(":").map(Number);
      const startMin = sh * 60 + sm;
      let endMin = eh * 60 + em;
      if (endMin <= startMin) endMin += 24 * 60;
      const absStart = localMidnight + startMin * 60000;
      const absEnd = localMidnight + endMin * 60000;
      const s = Math.max(absStart, anchorMs);
      const e = Math.min(absEnd, anchorMs + dayMs);
      if (e > s) out.push([(s - anchorMs) / 60000, (e - anchorMs) / 60000]);
    }
  }
  return mergeIntervals(out);
}

function tzDateStr(refMs, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(refMs));
  const m = {};
  for (const p of parts) if (p.type !== "literal") m[p.type] = p.value;
  return `${m.year}-${m.month}-${m.day}`;
}

function periodsForDate(person, dateStr) {
  if (
    person.override_date === dateStr &&
    Array.isArray(person.override_periods) &&
    person.override_periods.length > 0
  ) {
    return person.override_periods.map(p => ({
      start: normalizeTime(p.start),
      end: normalizeTime(p.end),
    }));
  }
  return getActivePeriods(person);
}

function hasActiveOverride(person) {
  if (!person || !person.timezone) return false;
  const today = tzDateStr(Date.now(), person.timezone);
  return person.override_date === today
    && Array.isArray(person.override_periods)
    && person.override_periods.length > 0;
}

function formatPersonPeriods(person) {
  if (hasActiveOverride(person)) {
    return `今天 ${formatPeriods(person.override_periods.map(p => ({
      start: normalizeTime(p.start), end: normalizeTime(p.end),
    })))}（临时）`;
  }
  return formatPeriods(getActivePeriods(person));
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

function normalizeTime(t) {
  if (!t) return t;
  return String(t).slice(0, 5);
}

function getActivePeriods(profile) {
  if (Array.isArray(profile.active_periods) && profile.active_periods.length > 0) {
    return profile.active_periods.map(p => ({
      start: normalizeTime(p.start),
      end: normalizeTime(p.end),
    }));
  }
  if (profile.active_start && profile.active_end) {
    return [{ start: normalizeTime(profile.active_start), end: normalizeTime(profile.active_end) }];
  }
  return [{ start: "19:00", end: "23:00" }];
}

function formatPeriods(periods) {
  return periods.map(p => `${p.start}–${p.end}`).join(" / ");
}

function makePeriodRow(start, end) {
  const row = document.createElement("div");
  row.className = "period-row";
  row.innerHTML = `
    <input type="time" class="p-start" value="${escapeAttr(normalizeTime(start) || "19:00")}" required />
    <span class="period-sep">–</span>
    <input type="time" class="p-end" value="${escapeAttr(normalizeTime(end) || "23:00")}" required />
    <button type="button" class="ghost icon remove-period" title="删除时段">✕</button>
  `;
  row.querySelector(".remove-period").addEventListener("click", () => {
    const list = row.parentElement;
    if (list.children.length > 1) row.remove();
    else toast("至少保留一个活跃时段", "error");
  });
  return row;
}

function renderPeriodInputs(containerId, periods) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  for (const p of periods) container.appendChild(makePeriodRow(p.start, p.end));
}

function collectPeriods(containerId) {
  const container = document.getElementById(containerId);
  const out = [];
  for (const row of container.querySelectorAll(".period-row")) {
    const start = row.querySelector(".p-start").value;
    const end = row.querySelector(".p-end").value;
    if (start && end) out.push({ start, end });
  }
  return out;
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
