const config = window.PYSEND_CONFIG || {};
const { createClient } = window.supabase || {};

const authPanel = document.getElementById("auth-panel");
const appPanel = document.getElementById("app-panel");
const authForm = document.getElementById("auth-form");
const authMsg = document.getElementById("auth-msg");
const signupBtn = document.getElementById("signup-btn");
const signoutBtn = document.getElementById("signout-btn");
const sessionEmail = document.getElementById("session-email");
const notificationsBtn = document.getElementById("notifications-btn");
const profileBtn = document.getElementById("profile-btn");
const anonymousBtn = document.getElementById("anonymous-btn");

const channelsList = document.getElementById("channels-list");
const friendsList = document.getElementById("friends-list");
const createChannelBtn = document.getElementById("create-channel-btn");
const newChannelBtn = document.getElementById("new-channel-btn");
const channelNameInput = document.getElementById("channel-name");
const channelIconInput = document.getElementById("channel-icon");
const channelDescInput = document.getElementById("channel-desc");
const channelRulesInput = document.getElementById("channel-rules");
const channelSearchInput = document.getElementById("channel-search");
const friendSearchInput = document.getElementById("friend-search");
const friendEmailInput = document.getElementById("friend-email");
const addFriendBtn = document.getElementById("add-friend-btn");

const channelTitle = document.getElementById("channel-title");
const channelMeta = document.getElementById("channel-meta");
const channelDescView = document.getElementById("channel-desc-view");
const channelRulesView = document.getElementById("channel-rules-view");
const favoriteBtn = document.getElementById("favorite-btn");
const messagesEl = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const typingIndicator = document.getElementById("typing-indicator");
const toastContainer = document.getElementById("toast-container");

const profileModal = document.getElementById("profile-modal");
const profileClose = document.getElementById("profile-close");
const profileAvatar = document.getElementById("profile-avatar");
const profileAvatarUrl = document.getElementById("profile-avatar-url");
const profileDisplayName = document.getElementById("profile-display-name");
const profileBio = document.getElementById("profile-bio");
const profileSave = document.getElementById("profile-save");
const profileFriends = document.getElementById("profile-friends");
const profileRequests = document.getElementById("profile-requests");
const profileFavorites = document.getElementById("profile-favorites");
const profileAction = document.getElementById("profile-action");

let supabaseClient = null;
let currentUser = null;
let currentProfile = null;
let currentChannel = null;
let messageSubscription = null;
let inboxSubscription = null;
let typingSubscription = null;
let presenceInterval = null;
let messagePollInterval = null;
let allChannels = [];
let allFriends = [];
let favorites = new Set();
let onlineCounts = {};
let isAnonymous = false;
const messageIds = new Set();
const typingUsers = new Map();
let typingCleanupInterval = null;
let lastTypingBroadcastAt = 0;
const unreadByChannel = new Map();
const baseTitle = document.title;
let browserNotificationsEnabled = false;
let audioCtx = null;
let wasHidden = false;
let currentChannelRoles = new Map();

function showMessage(text, isError = false) {
  authMsg.textContent = text;
  authMsg.classList.remove("hidden");
  authMsg.style.borderColor = isError ? "#b63a1a" : "#3a2d2d";
}

function clearMessage() {
  authMsg.classList.add("hidden");
}

function ensureSupabase() {
  if (!config.supabaseUrl || !config.supabaseAnonKey || !createClient) {
    showMessage("Config Supabase manquante. Remplis config.js.", true);
    throw new Error("Missing Supabase config");
  }
  supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey);
}

function updateDocumentTitle() {
  const totalUnread = Array.from(unreadByChannel.values()).reduce((acc, n) => acc + n, 0);
  document.title = totalUnread > 0 ? `(${totalUnread}) ${baseTitle}` : baseTitle;
}

function initAudioContext() {
  if (!audioCtx && "AudioContext" in window) {
    audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
}

function playBeep(kind = "incoming") {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "square";
  osc.frequency.value = kind === "sent" ? 760 : 520;
  gain.gain.value = 0.0001;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  osc.start(now);
  osc.stop(now + 0.17);
}

function clearUnread(channelId) {
  unreadByChannel.delete(channelId);
  updateDocumentTitle();
}

function incrementUnread(channelId) {
  unreadByChannel.set(channelId, (unreadByChannel.get(channelId) || 0) + 1);
  updateDocumentTitle();
}

function showToast(title, body) {
  if (!toastContainer) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  const t = document.createElement("div");
  t.className = "toast-title";
  t.textContent = title;
  const b = document.createElement("div");
  b.className = "toast-body";
  b.textContent = body;
  toast.appendChild(t);
  toast.appendChild(b);
  toastContainer.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 4500);
}

async function enableBrowserNotifications() {
  if (!("Notification" in window)) {
    showToast("Notifications", "Navigateur non compatible.");
    return;
  }
  if (Notification.permission === "granted") {
    browserNotificationsEnabled = true;
    if (notificationsBtn) notificationsBtn.textContent = "Notif: ON";
    showToast("Notifications", "Notifications navigateur actives.");
    return;
  }
  const permission = await Notification.requestPermission();
  browserNotificationsEnabled = permission === "granted";
  if (notificationsBtn) {
    notificationsBtn.textContent = browserNotificationsEnabled ? "Notif: ON" : "Notif: OFF";
  }
  showToast(
    "Notifications",
    browserNotificationsEnabled ? "Permission accordee." : "Permission refusee."
  );
}

function setSessionUI(user) {
  currentUser = user;
  isAnonymous = Boolean(user?.is_anonymous);
  if (user) {
    sessionEmail.textContent = user.email || (isAnonymous ? "Anonyme" : "");
    signoutBtn.classList.remove("hidden");
    if (notificationsBtn) notificationsBtn.classList.remove("hidden");
    profileBtn.classList.remove("hidden");
    authPanel.classList.add("hidden");
    appPanel.classList.remove("hidden");
  } else {
    sessionEmail.textContent = "";
    signoutBtn.classList.add("hidden");
    if (notificationsBtn) notificationsBtn.classList.add("hidden");
    profileBtn.classList.add("hidden");
    favoriteBtn.classList.add("hidden");
    authPanel.classList.remove("hidden");
    appPanel.classList.add("hidden");
  }
  updateAnonymousUI();
}

function updateAnonymousUI() {
  const disabled = isAnonymous;
  friendEmailInput.disabled = disabled;
  addFriendBtn.disabled = disabled;
  if (disabled) {
    friendsList.innerHTML = '<div class="list-item">Mode anonyme : amis désactivés</div>';
  }
}

async function ensureProfile(user, displayName = "") {
  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("id, display_name, avatar_url, bio, is_anonymous, email, global_role")
    .eq("id", user.id)
    .maybeSingle();

  const defaultName = displayName || user.email?.split("@")[0] || "Anonyme";
  const creatorEmail = (config.creatorEmail || "").toLowerCase();
  const shouldBeCreator = creatorEmail && user.email && user.email.toLowerCase() === creatorEmail;
  if (!profile) {
    await supabaseClient.from("profiles").insert({
      id: user.id,
      email: user.email,
      display_name: defaultName,
      is_anonymous: Boolean(user.is_anonymous),
      global_role: shouldBeCreator ? "creator" : "user"
    });
    currentProfile = {
      id: user.id,
      email: user.email,
      display_name: defaultName,
      is_anonymous: Boolean(user.is_anonymous),
      global_role: shouldBeCreator ? "creator" : "user"
    };
  } else if (displayName && profile.display_name !== displayName) {
    const updates = { display_name: displayName };
    if (shouldBeCreator && profile.global_role !== "creator") updates.global_role = "creator";
    await supabaseClient.from("profiles").update(updates).eq("id", user.id);
    currentProfile = { ...profile, ...updates };
  } else {
    if (shouldBeCreator && profile.global_role !== "creator") {
      await supabaseClient.from("profiles").update({ global_role: "creator" }).eq("id", user.id);
      profile.global_role = "creator";
    }
    currentProfile = profile;
  }
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function sanitizeRole(role) {
  if (role === "creator" || role === "admin" || role === "guardian") return role;
  return "user";
}

function getEffectiveRoleForUser(userId, channel, globalRole = "user") {
  if (globalRole === "creator") return "creator";
  if (channel?.created_by === userId) return "admin";
  return sanitizeRole(currentChannelRoles.get(userId));
}

function getMyRoleInCurrentChannel() {
  return getEffectiveRoleForUser(currentUser?.id, currentChannel, currentProfile?.global_role || "user");
}

async function loadChannelRoles(channelId) {
  const { data, error } = await supabaseClient
    .from("channel_roles")
    .select("user_id,role")
    .eq("channel_id", channelId);
  if (error) {
    console.error(error);
    return new Map();
  }
  const map = new Map();
  (data || []).forEach((row) => map.set(row.user_id, sanitizeRole(row.role)));
  return map;
}

async function countGuardians(channelId) {
  const { count, error } = await supabaseClient
    .from("channel_roles")
    .select("user_id", { count: "exact", head: true })
    .eq("channel_id", channelId)
    .eq("role", "guardian");
  if (error) return 0;
  return count || 0;
}

async function checkChannelBan(channelId, userId) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseClient
    .from("channel_bans")
    .select("id,banned_until,reason")
    .eq("channel_id", channelId)
    .eq("user_id", userId)
    .gt("banned_until", nowIso)
    .order("banned_until", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(error);
    return null;
  }
  return data || null;
}

async function checkPlatformBan(userId) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseClient
    .from("platform_bans")
    .select("id,banned_until,reason")
    .eq("user_id", userId)
    .gt("banned_until", nowIso)
    .order("banned_until", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(error);
    return null;
  }
  return data || null;
}

async function enforcePlatformBanIfAny(user) {
  const ban = await checkPlatformBan(user.id);
  if (!ban) return false;
  await supabaseClient.auth.signOut();
  setSessionUI(null);
  showMessage(`Compte temporairement banni jusqu'au ${formatDate(ban.banned_until)}.`, true);
  return true;
}

function renderMessages(messages) {
  messagesEl.innerHTML = "";
  messageIds.clear();
  messages.forEach((msg) => appendMessage(msg));
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderTypingIndicator() {
  const names = Array.from(typingUsers.values())
    .map((entry) => entry.name)
    .slice(0, 2);
  if (names.length === 0) {
    typingIndicator.textContent = "";
    typingIndicator.classList.add("hidden");
    return;
  }
  typingIndicator.classList.remove("hidden");
  typingIndicator.textContent =
    names.length === 1 ? `${names[0]} est en train d'ecrire...` : `${names.join(", ")} ecrivent...`;
}

function appendMessage(msg) {
  if (messageIds.has(msg.id)) return;
  messageIds.add(msg.id);
  const row = document.createElement("div");
  row.className = "message-row";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  const roleSquare = document.createElement("span");
  roleSquare.className = `role-square role-${sanitizeRole(msg.role)}`;
  meta.appendChild(roleSquare);
  const author = document.createElement("span");
  author.className = "author";
  author.textContent = msg.author || "?";
  author.dataset.userId = msg.user_id || "";
  meta.appendChild(author);
  meta.append(` - ${formatDate(msg.created_at)}`);

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = msg.body;

  row.appendChild(meta);
  row.appendChild(body);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function loadChannels() {
  const { data: memberships, error: memberError } = await supabaseClient
    .from("channel_members")
    .select("channel_id")
    .eq("user_id", currentUser.id);
  if (memberError) {
    console.error(memberError);
    return [];
  }

  const memberIds = (memberships || []).map((m) => m.channel_id).filter(Boolean);
  let query = supabaseClient
    .from("channels")
    .select("id,name,description,rules,icon,created_by,is_dm,dm_pair,created_at")
    .eq("is_dm", false)
    .order("created_at", { ascending: false });

  if (memberIds.length > 0) {
    query = supabaseClient
      .from("channels")
      .select("id,name,description,rules,icon,created_by,is_dm,dm_pair,created_at")
      .or(`is_dm.eq.false,id.in.(${memberIds.join(",")})`)
      .order("created_at", { ascending: false });
  }

  const { data, error } = await query;
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
}

async function loadOnlineCounts(channelIds) {
  if (channelIds.length === 0) return {};
  const { data, error } = await supabaseClient
    .from("channel_members")
    .select("channel_id,last_seen")
    .in("channel_id", channelIds);
  if (error) {
    console.error(error);
    return {};
  }
  const now = Date.now();
  const counts = {};
  (data || []).forEach((row) => {
    const seen = row.last_seen ? new Date(row.last_seen).getTime() : 0;
    if (now - seen <= 5 * 60 * 1000) {
      counts[row.channel_id] = (counts[row.channel_id] || 0) + 1;
    }
  });
  return counts;
}

async function loadFavorites() {
  const { data } = await supabaseClient
    .from("favorites")
    .select("channel_id")
    .eq("user_id", currentUser.id);
  return new Set((data || []).map((r) => r.channel_id));
}

async function loadFriends() {
  if (isAnonymous) return [];
  const { data: rels } = await supabaseClient
    .from("friendships")
    .select("friend_id")
    .eq("user_id", currentUser.id)
    .eq("status", "accepted");

  const friendIds = (rels || []).map((r) => r.friend_id).filter(Boolean);
  if (friendIds.length === 0) return [];

  const { data: profiles } = await supabaseClient
    .from("profiles")
    .select("id,display_name,email")
    .in("id", friendIds);

  return (profiles || []).map((p) => ({
    id: p.id,
    label: p.display_name || p.email
  }));
}

function renderChannelsList(list, query) {
  const q = query.trim().toLowerCase();
  list.innerHTML = "";
  const filtered = allChannels.filter((c) => c.name.toLowerCase().includes(q));
  filtered.forEach((channel) => {
    const div = document.createElement("div");
    div.className = "list-item" + (currentChannel?.id === channel.id ? " active" : "");
    const left = document.createElement("span");
    const icon = channel.icon || "💬";
    left.textContent = `${icon} ${channel.name}`;
    const right = document.createElement("span");
    right.className = "channel-badge";
    const count = onlineCounts[channel.id] || 0;
    right.textContent = `${count} en ligne`;
    const unread = unreadByChannel.get(channel.id) || 0;
    const unreadBadge = document.createElement("span");
    unreadBadge.className = "unread-badge" + (unread > 0 ? "" : " hidden");
    unreadBadge.textContent = unread > 99 ? "99+" : String(unread || 0);
    const star = document.createElement("button");
    star.className = "btn small ghost";
    star.textContent = favorites.has(channel.id) ? "★" : "☆";
    star.addEventListener("click", async (evt) => {
      evt.stopPropagation();
      await toggleFavorite(channel.id);
      renderChannelsList(channelsList, channelSearchInput.value);
      renderProfileFavorites();
    });
    div.appendChild(left);
    div.appendChild(right);
    div.appendChild(unreadBadge);
    div.appendChild(star);
    div.addEventListener("click", async () => {
      await selectChannel(channel);
      renderChannelsList(channelsList, channelSearchInput.value);
    });
    list.appendChild(div);
  });
}

function renderFriendsList(list, query) {
  if (isAnonymous) return;
  const q = query.trim().toLowerCase();
  list.innerHTML = "";
  const filtered = allFriends.filter((f) => f.label.toLowerCase().includes(q));
  filtered.forEach((friend) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.textContent = friend.label;
    div.addEventListener("click", async () => {
      await openDirectMessage(friend.id, friend.label);
      renderChannelsList(channelsList, channelSearchInput.value);
    });
    list.appendChild(div);
  });
}

async function refreshSidebar() {
  const [channels, friends, favs] = await Promise.all([
    loadChannels(),
    loadFriends(),
    loadFavorites()
  ]);
  allChannels = channels;
  allFriends = friends;
  favorites = favs;
  onlineCounts = await loadOnlineCounts(allChannels.map((c) => c.id));
  renderChannelsList(channelsList, channelSearchInput.value || "");
  renderFriendsList(friendsList, friendSearchInput.value || "");
}

async function selectChannel(channel) {
  currentChannel = channel;
  clearUnread(channel.id);
  const activeBan = await checkChannelBan(channel.id, currentUser.id);
  if (activeBan) {
    channelTitle.textContent = `Acces refuse: ${channel.name}`;
    channelMeta.textContent = `Banni jusqu'au ${formatDate(activeBan.banned_until)}`;
    channelDescView.textContent = activeBan.reason ? `Raison: ${activeBan.reason}` : "";
    channelRulesView.textContent = "";
    messagesEl.innerHTML = "";
    messageInput.disabled = true;
    return;
  }
  messageInput.disabled = false;
  currentChannelRoles = await loadChannelRoles(channel.id);
  const creator = channel.created_by ? await getProfileById(channel.created_by) : null;
  const count = onlineCounts[channel.id] || 0;
  const icon = channel.icon || "💬";
  channelTitle.textContent = `${icon} ${channel.name}`;
  channelDescView.textContent = channel.description || "";
  channelRulesView.textContent = channel.rules ? `Regles: ${channel.rules}` : "";
  channelMeta.textContent = `${channel.is_dm ? "Salon privé" : "Salon public"} · Créé par ${
    creator?.display_name || creator?.email || "?"
  } · ${count} en ligne`;
  favoriteBtn.classList.remove("hidden");
  favoriteBtn.textContent = favorites.has(channel.id) ? "★ Favori" : "☆ Favori";

  if (!channel.is_dm) {
    await ensureMembership(channel.id, currentUser.id);
  }
  await touchPresence(channel.id);
  if (presenceInterval) clearInterval(presenceInterval);
  presenceInterval = setInterval(() => touchPresence(channel.id), 30000);

  const { data: messages, error } = await supabaseClient
    .from("messages")
    .select("id,body,created_at,user_id,profiles(display_name,email,global_role)")
    .eq("channel_id", channel.id)
    .order("created_at", { ascending: true })
    .limit(50);
  if (!error) {
    const mapped = (messages || []).map((m) => ({
      id: m.id,
      body: m.body,
      created_at: m.created_at,
      user_id: m.user_id,
      author: m.profiles?.display_name || m.profiles?.email || "Anonyme",
      role: getEffectiveRoleForUser(m.user_id, channel, m.profiles?.global_role || "user")
    }));
    renderMessages(mapped);
  }
  subscribeToMessages(channel.id);
  subscribeToTyping(channel.id);
  startMessagePolling(channel.id);
  await pollLatestMessages(channel.id);
}

function subscribeToMessages(channelId) {
  if (messageSubscription) {
    supabaseClient.removeChannel(messageSubscription);
  }
  messageSubscription = supabaseClient
    .channel(`messages:channel:${channelId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` },
      async (payload) => {
        const msg = payload.new;
        const { data: profile } = await supabaseClient
          .from("profiles")
          .select("display_name,email,global_role")
          .eq("id", msg.user_id)
          .maybeSingle();
        appendMessage({
          id: msg.id,
          body: msg.body,
          created_at: msg.created_at,
          user_id: msg.user_id,
          author: profile?.display_name || profile?.email || "Anonyme",
          role: getEffectiveRoleForUser(msg.user_id, currentChannel, profile?.global_role || "user")
        });
      }
    )
    .subscribe();
}

async function handleIncomingMessage(msg) {
  if (!msg || !currentUser) return;
  if (msg.user_id === currentUser.id) return;

  const isCurrentChannel = currentChannel && currentChannel.id === msg.channel_id;
  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("display_name,email,global_role")
    .eq("id", msg.user_id)
    .maybeSingle();
  const authorName = profile?.display_name || profile?.email || "Anonyme";

  if (isCurrentChannel) {
    appendMessage({
      id: msg.id,
      body: msg.body,
      created_at: msg.created_at,
      user_id: msg.user_id,
      author: authorName,
      role: getEffectiveRoleForUser(msg.user_id, currentChannel, profile?.global_role || "user")
    });
    playBeep("incoming");
    return;
  }

  incrementUnread(msg.channel_id);
  const channel = allChannels.find((c) => c.id === msg.channel_id);
  const channelLabel = channel ? channel.name : `Salon #${msg.channel_id}`;
  showToast(channelLabel, `${authorName}: ${msg.body}`);
  playBeep("incoming");
  if (browserNotificationsEnabled && "Notification" in window && Notification.permission === "granted") {
    new Notification(channelLabel, { body: `${authorName}: ${msg.body}` });
  }
  renderChannelsList(channelsList, channelSearchInput.value || "");
}

async function recoverAfterFocus() {
  if (!supabaseClient) return;
  const { data } = await supabaseClient.auth.getSession();
  const user = data?.session?.user || null;
  if (!user) {
    setSessionUI(null);
    return;
  }
  if (await enforcePlatformBanIfAny(user)) {
    return;
  }
  setSessionUI(user);
  await ensureProfile(user);
  await refreshSidebar();
  if (currentChannel?.id) {
    const fresh = allChannels.find((c) => c.id === currentChannel.id);
    if (fresh) {
      await selectChannel(fresh);
    }
  }
  subscribeToInboxMessages();
  await showPendingNotices();
}

async function showPendingNotices() {
  const { data, error } = await supabaseClient
    .from("moderation_notices")
    .select("id,notice_type,reason,details,created_at")
    .eq("user_id", currentUser.id)
    .eq("seen", false)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error(error);
    return;
  }
  (data || []).forEach((n) => {
    const title = n.notice_type === "platform_ban" ? "Ban plateforme" : "Moderation";
    const body = n.details || n.reason || "Nouvelle notification";
    showToast(title, body);
  });
  if ((data || []).length > 0) {
    await supabaseClient.from("moderation_notices").update({ seen: true }).eq("user_id", currentUser.id).eq("seen", false);
  }
}

function subscribeToInboxMessages() {
  if (inboxSubscription) {
    supabaseClient.removeChannel(inboxSubscription);
  }
  inboxSubscription = supabaseClient
    .channel("messages:inbox")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async (payload) => {
      await handleIncomingMessage(payload.new);
    })
    .subscribe();
}

function subscribeToTyping(channelId) {
  if (typingSubscription) {
    supabaseClient.removeChannel(typingSubscription);
  }
  typingUsers.clear();
  renderTypingIndicator();
  typingSubscription = supabaseClient
    .channel(`typing:channel:${channelId}`)
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      if (!payload || payload.userId === currentUser?.id) return;
      if (payload.channelId !== channelId) return;
      if (payload.isTyping) {
        typingUsers.set(payload.userId, {
          name: payload.displayName || "Quelqu'un",
          updatedAt: Date.now()
        });
      } else {
        typingUsers.delete(payload.userId);
      }
      renderTypingIndicator();
    })
    .subscribe();
}

function startMessagePolling(channelId) {
  if (messagePollInterval) clearInterval(messagePollInterval);
  messagePollInterval = setInterval(async () => {
    if (!currentChannel || currentChannel.id !== channelId) return;
    await pollLatestMessages(channelId);
  }, 2500);
}

async function pollLatestMessages(channelId) {
  const { data, error } = await supabaseClient
    .from("messages")
    .select("id,body,created_at,user_id,profiles(display_name,email,global_role)")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: true })
    .limit(80);
  if (error) {
    console.error(error);
    return;
  }
  (data || []).forEach((m) => {
    appendMessage({
      id: m.id,
      body: m.body,
      created_at: m.created_at,
      user_id: m.user_id,
      author: m.profiles?.display_name || m.profiles?.email || "Anonyme",
      role: getEffectiveRoleForUser(m.user_id, currentChannel, m.profiles?.global_role || "user")
    });
  });
}

async function ensureMembership(channelId, userId) {
  const { error } = await supabaseClient.from("channel_members").upsert(
    {
      channel_id: channelId,
      user_id: userId
    },
    { onConflict: "channel_id,user_id" }
  );
  if (error) {
    console.error("ensureMembership failed", error);
    return false;
  }
  return true;
}

async function touchPresence(channelId) {
  await supabaseClient
    .from("channel_members")
    .update({ last_seen: new Date().toISOString() })
    .eq("channel_id", channelId)
    .eq("user_id", currentUser.id);
}

async function openDirectMessage(friendId, friendLabel) {
  if (isAnonymous) {
    alert("Mode anonyme : amis désactivés.");
    return;
  }
  const pair = [currentUser.id, friendId].sort().join("|");
  const { data: existing } = await supabaseClient
    .from("channels")
    .select("id,name,is_dm,description,icon,created_by")
    .eq("dm_pair", pair)
    .maybeSingle();

  let channel = existing;
  if (!channel) {
    const { data: inserted, error } = await supabaseClient
      .from("channels")
      .insert({
        name: `DM: ${friendLabel}`,
        created_by: currentUser.id,
        is_dm: true,
        dm_pair: pair
      })
      .select()
      .single();
    if (error) {
      console.error(error);
      return;
    }
    channel = inserted;
  }

  await ensureMembership(channel.id, currentUser.id);
  await ensureMembership(channel.id, friendId);
  await selectChannel(channel);
}

async function handleAuthSubmit(evt) {
  evt.preventDefault();
  clearMessage();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const displayName = document.getElementById("display-name").value.trim();

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    showMessage(`Connexion impossible: ${error.message}`, true);
    return;
  }
  if (await enforcePlatformBanIfAny(data.user)) {
    return;
  }
  await ensureProfile(data.user, displayName);
  setSessionUI(data.user);
  await refreshSidebar();
}

async function handleAnonymous() {
  clearMessage();
  try {
    const { data, error } = await supabaseClient.auth.signInAnonymously();
    if (error) throw error;
    if (await enforcePlatformBanIfAny(data.user)) {
      return;
    }
    await ensureProfile(data.user, "");
    setSessionUI(data.user);
    await refreshSidebar();
  } catch (err) {
    console.error(err);
    showMessage("Connexion anonyme indisponible sur ce projet.", true);
  }
}

async function handleSignUp() {
  clearMessage();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const displayName = document.getElementById("display-name").value.trim();

  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) {
    showMessage("Inscription impossible. Utilise un autre email.", true);
    return;
  }
  if (data.user) {
    await ensureProfile(data.user, displayName);
  }
  showMessage("Compte créé. Vérifie ton email si confirmation activée.");
}

async function handleCreateChannel() {
  const name = channelNameInput.value.trim();
  const icon = channelIconInput.value.trim();
  const description = channelDescInput.value.trim();
  const rules = channelRulesInput.value.trim();
  if (!name) return;
  const { data, error } = await supabaseClient
    .from("channels")
    .insert({
      name,
      icon: icon || null,
      description: description || null,
      rules: rules || null,
      created_by: currentUser.id
    })
    .select()
    .single();
  if (error) {
    console.error(error);
    alert(`Impossible de creer le salon: ${error.message}`);
    return;
  }
  channelNameInput.value = "";
  channelIconInput.value = "";
  channelDescInput.value = "";
  channelRulesInput.value = "";
  await ensureMembership(data.id, currentUser.id);
  await supabaseClient.from("channel_roles").upsert(
    { channel_id: data.id, user_id: currentUser.id, role: "admin", granted_by: currentUser.id },
    { onConflict: "channel_id,user_id" }
  );
  await selectChannel(data);
  await refreshSidebar();
}

async function handleAddFriend() {
  if (isAnonymous) return;
  const pseudo = friendEmailInput.value.trim();
  if (!pseudo) return;

  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("id,display_name,email")
    .ilike("display_name", pseudo)
    .limit(1)
    .maybeSingle();

  if (!profile) {
    alert("Aucun compte trouve avec ce pseudo.");
    return;
  }
  if (profile.id === currentUser.id) {
    alert("Tu es déjà ton propre ami.");
    return;
  }

  await sendFriendRequest(profile.id);
  friendEmailInput.value = "";
  refreshSidebar();
}

async function handleSendMessage(evt) {
  evt.preventDefault();
  const body = messageInput.value.trim();
  if (!body || !currentChannel) return;
  const channelId = currentChannel.id;
  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (!sessionData?.session) {
    alert("Session expiree. Reconnecte-toi.");
    return;
  }

  if (!currentChannel.is_dm) {
    const ok = await ensureMembership(channelId, currentUser.id);
    if (!ok) {
      alert("Impossible d'envoyer: tu n'as pas acces a ce salon.");
      return;
    }
  }
  const activeBan = await checkChannelBan(channelId, currentUser.id);
  if (activeBan) {
    alert(`Tu es banni de ce salon jusqu'au ${formatDate(activeBan.banned_until)}.`);
    return;
  }

  const { data, error } = await supabaseClient
    .from("messages")
    .insert({
      channel_id: channelId,
      user_id: currentUser.id,
      body
    })
    .select()
    .single();
  if (error) {
    console.error("send message failed", error);
    alert(`Impossible d'envoyer le message: ${error.message}`);
    return;
  }
  appendMessage({
    id: data.id,
    body: data.body,
    created_at: data.created_at,
    user_id: data.user_id,
    author: currentProfile?.display_name || currentUser.email || "Anonyme",
    role: getMyRoleInCurrentChannel()
  });
  messageInput.value = "";
  broadcastTyping(false);
  playBeep("sent");
}

function broadcastTyping(isTyping) {
  if (!typingSubscription || !currentChannel) return;
  typingSubscription.send({
    type: "broadcast",
    event: "typing",
    payload: {
      channelId: currentChannel.id,
      userId: currentUser.id,
      displayName: currentProfile?.display_name || currentUser.email || "Anonyme",
      isTyping
    }
  });
}

async function toggleFavorite(channelId) {
  if (favorites.has(channelId)) {
    await supabaseClient.from("favorites").delete().eq("channel_id", channelId);
    favorites.delete(channelId);
  } else {
    await supabaseClient.from("favorites").insert({ user_id: currentUser.id, channel_id: channelId });
    favorites.add(channelId);
  }
  favoriteBtn.textContent = favorites.has(channelId) ? "★ Favori" : "☆ Favori";
}

async function getProfileById(userId) {
  const { data } = await supabaseClient
    .from("profiles")
    .select("id,display_name,email,avatar_url,bio,global_role")
    .eq("id", userId)
    .maybeSingle();
  return data;
}

async function sendFriendRequest(targetId) {
  if (isAnonymous) {
    alert("Mode anonyme : amis désactivés.");
    return;
  }
  await supabaseClient.from("friendships").upsert(
    {
      user_id: currentUser.id,
      friend_id: targetId,
      status: "pending"
    },
    { onConflict: "user_id,friend_id" }
  );
}

async function getFriendStatus(targetId) {
  const { data } = await supabaseClient
    .from("friendships")
    .select("user_id,friend_id,status")
    .or(
      `and(user_id.eq.${currentUser.id},friend_id.eq.${targetId}),and(user_id.eq.${targetId},friend_id.eq.${currentUser.id})`
    );
  const rows = data || [];
  const accepted = rows.find((r) => r.status === "accepted");
  if (accepted) return "accepted";
  const outgoing = rows.find((r) => r.user_id === currentUser.id && r.status === "pending");
  if (outgoing) return "outgoing";
  const incoming = rows.find((r) => r.friend_id === currentUser.id && r.status === "pending");
  if (incoming) return "incoming";
  return "none";
}

async function acceptFriendRequest(requesterId) {
  await supabaseClient
    .from("friendships")
    .update({ status: "accepted" })
    .eq("user_id", requesterId)
    .eq("friend_id", currentUser.id);
  await supabaseClient.from("friendships").upsert(
    {
      user_id: currentUser.id,
      friend_id: requesterId,
      status: "accepted"
    },
    { onConflict: "user_id,friend_id" }
  );
}

async function rejectFriendRequest(requesterId) {
  await supabaseClient
    .from("friendships")
    .delete()
    .eq("user_id", requesterId)
    .eq("friend_id", currentUser.id);
}

function canManageChannelRoles() {
  const me = getMyRoleInCurrentChannel();
  return me === "admin" || me === "creator";
}

function canModerateChannel() {
  const me = getMyRoleInCurrentChannel();
  return me === "guardian" || me === "admin" || me === "creator";
}

async function warnUser(targetId) {
  const reason = prompt("Raison de la mise en garde :");
  if (!reason) return;
  await supabaseClient.from("moderation_notices").insert({
    user_id: targetId,
    issued_by: currentUser.id,
    channel_id: currentChannel?.id || null,
    notice_type: "warning",
    reason
  });
  alert("Mise en garde envoyee.");
}

async function tempBanUser(targetId) {
  const me = getMyRoleInCurrentChannel();
  const minAllowed = me === "guardian" ? 5 : 1;
  const maxAllowed = 24 * 60;
  const minutes = Number(prompt(`Duree du ban en minutes (${minAllowed}-${maxAllowed}) :`, "60"));
  if (!Number.isFinite(minutes) || minutes < minAllowed || minutes > maxAllowed) {
    alert("Duree invalide.");
    return;
  }
  const reason = prompt("Raison du ban :") || "";
  const until = new Date(Date.now() + minutes * 60000).toISOString();
  await supabaseClient.from("channel_bans").insert({
    channel_id: currentChannel.id,
    user_id: targetId,
    banned_by: currentUser.id,
    reason,
    banned_until: until
  });
  await supabaseClient.from("moderation_notices").insert({
    user_id: targetId,
    issued_by: currentUser.id,
    channel_id: currentChannel.id,
    notice_type: "channel_ban",
    reason,
    details: `Banni jusqu'au ${formatDate(until)}`
  });
  alert("Utilisateur banni temporairement.");
}

async function requestBanToAdmin(targetId) {
  const reason = prompt("Motif de la demande de bannissement :");
  if (!reason) return;
  await supabaseClient.from("moderation_requests").insert({
    channel_id: currentChannel.id,
    requester_id: currentUser.id,
    target_id: targetId,
    reason,
    status: "pending"
  });
  alert("Demande envoyee.");
}

async function promoteGuardian(targetId) {
  const count = await countGuardians(currentChannel.id);
  if (count >= 6) {
    alert("Maximum de 6 guardians par salon.");
    return;
  }
  await supabaseClient.from("channel_roles").upsert(
    {
      channel_id: currentChannel.id,
      user_id: targetId,
      role: "guardian",
      granted_by: currentUser.id
    },
    { onConflict: "channel_id,user_id" }
  );
  currentChannelRoles.set(targetId, "guardian");
  alert("Promotion en guardian effectuee.");
}

async function platformBanUser(targetId) {
  const me = getMyRoleInCurrentChannel();
  if (me !== "admin" && me !== "creator") return;
  const days = Number(prompt("Ban plateforme (jours, 7 a 60) :", "7"));
  if (!Number.isFinite(days) || days < 7 || days > 60) {
    alert("Duree invalide.");
    return;
  }
  const reason = prompt("Cause du bannissement plateforme :");
  if (!reason) return;
  const until = new Date(Date.now() + days * 86400000).toISOString();
  await supabaseClient.from("platform_bans").insert({
    user_id: targetId,
    banned_by: currentUser.id,
    reason,
    banned_until: until
  });
  await supabaseClient.from("moderation_notices").insert({
    user_id: targetId,
    issued_by: currentUser.id,
    channel_id: currentChannel?.id || null,
    notice_type: "platform_ban",
    reason,
    details: `Banni de la plateforme jusqu'au ${formatDate(until)}`
  });
  alert("Ban plateforme applique.");
}

async function deleteCurrentChannel() {
  if (!currentChannel) return;
  const me = getMyRoleInCurrentChannel();
  if (me !== "admin" && me !== "creator") return;
  const ok = confirm(`Supprimer le salon ${currentChannel.name} ?`);
  if (!ok) return;
  await supabaseClient.from("channels").delete().eq("id", currentChannel.id);
  currentChannel = null;
  messagesEl.innerHTML = "";
  channelTitle.textContent = "Choisir un salon";
  channelMeta.textContent = "---";
  channelDescView.textContent = "";
  channelRulesView.textContent = "";
  await refreshSidebar();
}

async function loadFriendRequests() {
  if (isAnonymous) return [];
  const { data: incoming } = await supabaseClient
    .from("friendships")
    .select("user_id,status")
    .eq("friend_id", currentUser.id)
    .eq("status", "pending");

  const requesterIds = (incoming || []).map((r) => r.user_id);
  if (requesterIds.length === 0) return [];
  const { data: profiles } = await supabaseClient
    .from("profiles")
    .select("id,display_name,email")
    .in("id", requesterIds);
  return profiles || [];
}

function openModal() {
  profileModal.classList.remove("hidden");
}

function closeModal() {
  profileModal.classList.add("hidden");
}

function renderProfileFavorites() {
  profileFavorites.innerHTML = "";
  allChannels
    .filter((c) => favorites.has(c.id))
    .forEach((c) => {
      const div = document.createElement("div");
      div.className = "list-item";
      div.textContent = `${c.icon || "💬"} ${c.name}`;
      div.addEventListener("click", async () => {
        closeModal();
        await selectChannel(c);
        renderChannelsList(channelsList, channelSearchInput.value || "");
      });
      profileFavorites.appendChild(div);
    });
}

async function openProfile(userId) {
  if (!userId) return;
  const profile = await getProfileById(userId);
  if (!profile) return;
  const isSelf = userId === currentUser.id;
  profileAvatar.textContent = (profile.display_name || "P").slice(0, 1).toUpperCase();
  if (profile.avatar_url) profileAvatar.style.backgroundImage = `url(${profile.avatar_url})`;
  else profileAvatar.style.backgroundImage = "none";
  profileAvatarUrl.value = profile.avatar_url || "";
  profileDisplayName.value = profile.display_name || "";
  profileBio.value = profile.bio || "";

  profileAvatarUrl.disabled = !isSelf;
  profileDisplayName.disabled = !isSelf;
  profileBio.disabled = !isSelf;
  profileSave.classList.toggle("hidden", !isSelf);

  profileAction.innerHTML = "";
  const viewedRole = getEffectiveRoleForUser(
    userId,
    currentChannel,
    profile.global_role || "user"
  );
  const roleInfo = document.createElement("div");
  roleInfo.className = "list-item";
  roleInfo.innerHTML = `<span class="role-square role-${viewedRole}"></span><span>Role: ${viewedRole}</span>`;
  profileAction.appendChild(roleInfo);
  if (!isSelf && !isAnonymous) {
    const status = await getFriendStatus(userId);
    const btn = document.createElement("button");
    btn.className = "btn small";
    if (status === "accepted") {
      btn.textContent = "Déjà ami";
      btn.disabled = true;
    } else if (status === "outgoing") {
      btn.textContent = "Demande envoyée";
      btn.disabled = true;
    } else if (status === "incoming") {
      btn.textContent = "Accepter la demande";
      btn.addEventListener("click", async () => {
        await acceptFriendRequest(userId);
        btn.textContent = "Ami ajouté";
        btn.disabled = true;
      });
    } else {
      btn.textContent = "Ajouter en ami";
      btn.addEventListener("click", async () => {
        await sendFriendRequest(userId);
        btn.textContent = "Demande envoyée";
        btn.disabled = true;
      });
    }
    profileAction.appendChild(btn);

    if (currentChannel && canModerateChannel()) {
      const warnBtn = document.createElement("button");
      warnBtn.className = "btn small ghost";
      warnBtn.textContent = "Mise en garde";
      warnBtn.addEventListener("click", async () => warnUser(userId));
      profileAction.appendChild(warnBtn);

      const banBtn = document.createElement("button");
      banBtn.className = "btn small ghost";
      banBtn.textContent = "Ban temporaire";
      banBtn.addEventListener("click", async () => tempBanUser(userId));
      profileAction.appendChild(banBtn);

      if (getMyRoleInCurrentChannel() === "guardian") {
        const reqBtn = document.createElement("button");
        reqBtn.className = "btn small ghost";
        reqBtn.textContent = "Demander ban admin";
        reqBtn.addEventListener("click", async () => requestBanToAdmin(userId));
        profileAction.appendChild(reqBtn);
      }
    }

    if (currentChannel && canManageChannelRoles() && viewedRole === "user") {
      const promoteBtn = document.createElement("button");
      promoteBtn.className = "btn small ghost";
      promoteBtn.textContent = "Promouvoir guardian";
      promoteBtn.addEventListener("click", async () => promoteGuardian(userId));
      profileAction.appendChild(promoteBtn);
    }

    if (currentChannel && canManageChannelRoles()) {
      const pbanBtn = document.createElement("button");
      pbanBtn.className = "btn small ghost";
      pbanBtn.textContent = "Ban plateforme";
      pbanBtn.addEventListener("click", async () => platformBanUser(userId));
      profileAction.appendChild(pbanBtn);
    }
  }

  if (currentChannel && canManageChannelRoles()) {
    const delBtn = document.createElement("button");
    delBtn.className = "btn small";
    delBtn.textContent = "Supprimer ce salon";
    delBtn.addEventListener("click", async () => {
      await deleteCurrentChannel();
      closeModal();
    });
    profileAction.appendChild(delBtn);
  }

  if (isSelf) {
    await renderProfileData();
  } else {
    profileFriends.innerHTML = '<div class="list-item">---</div>';
    profileRequests.innerHTML = '<div class="list-item">---</div>';
    profileFavorites.innerHTML = '<div class="list-item">---</div>';
  }
  openModal();
}

async function renderProfileData() {
  if (isAnonymous) {
    profileFriends.innerHTML = '<div class="list-item">Mode anonyme</div>';
    profileRequests.innerHTML = '<div class="list-item">Mode anonyme</div>';
    profileFavorites.innerHTML = '<div class="list-item">---</div>';
    return;
  }

  profileFriends.innerHTML = "";
  allFriends.forEach((f) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.textContent = f.label;
    profileFriends.appendChild(div);
  });

  profileRequests.innerHTML = "";
  const requests = await loadFriendRequests();
  requests.forEach((r) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.textContent = r.display_name || r.email;
    const accept = document.createElement("button");
    accept.className = "btn small";
    accept.textContent = "Accepter";
    accept.addEventListener("click", async () => {
      await acceptFriendRequest(r.id);
      await refreshSidebar();
      await renderProfileData();
    });
    const reject = document.createElement("button");
    reject.className = "btn small ghost";
    reject.textContent = "Refuser";
    reject.addEventListener("click", async () => {
      await rejectFriendRequest(r.id);
      await refreshSidebar();
      await renderProfileData();
    });
    div.appendChild(accept);
    div.appendChild(reject);
    profileRequests.appendChild(div);
  });

  renderProfileFavorites();
}

async function handleProfileSave() {
  await supabaseClient
    .from("profiles")
    .update({
      display_name: profileDisplayName.value.trim(),
      avatar_url: profileAvatarUrl.value.trim() || null,
      bio: profileBio.value.trim() || null
    })
    .eq("id", currentUser.id);
  await ensureProfile(currentUser);
}

async function init() {
  ensureSupabase();
  document.addEventListener("pointerdown", initAudioContext, { once: true });
  document.addEventListener("keydown", initAudioContext, { once: true });
  if (notificationsBtn) {
    notificationsBtn.textContent =
      "Notification" in window && Notification.permission === "granted" ? "Notif: ON" : "Notifications";
  }
  browserNotificationsEnabled = "Notification" in window && Notification.permission === "granted";

  authForm.addEventListener("submit", handleAuthSubmit);
  signupBtn.addEventListener("click", handleSignUp);
  anonymousBtn.addEventListener("click", handleAnonymous);
  signoutBtn.addEventListener("click", async () => {
    if (messagePollInterval) clearInterval(messagePollInterval);
    if (presenceInterval) clearInterval(presenceInterval);
    if (typingCleanupInterval) clearInterval(typingCleanupInterval);
    if (messageSubscription) supabaseClient.removeChannel(messageSubscription);
    if (inboxSubscription) supabaseClient.removeChannel(inboxSubscription);
    if (typingSubscription) supabaseClient.removeChannel(typingSubscription);
    await supabaseClient.auth.signOut();
    unreadByChannel.clear();
    updateDocumentTitle();
    setSessionUI(null);
  });
  if (notificationsBtn) {
    notificationsBtn.addEventListener("click", enableBrowserNotifications);
  }
  profileBtn.addEventListener("click", async () => {
    await openProfile(currentUser.id);
  });
  profileClose.addEventListener("click", closeModal);
  profileSave.addEventListener("click", handleProfileSave);

  createChannelBtn.addEventListener("click", handleCreateChannel);
  newChannelBtn.addEventListener("click", () => channelNameInput.focus());
  addFriendBtn.addEventListener("click", handleAddFriend);
  messageForm.addEventListener("submit", handleSendMessage);
  messageInput.addEventListener("input", () => {
    if (!currentChannel) return;
    const now = Date.now();
    const hasText = messageInput.value.trim().length > 0;
    if (!hasText) {
      broadcastTyping(false);
      return;
    }
    if (now - lastTypingBroadcastAt > 1200) {
      lastTypingBroadcastAt = now;
      broadcastTyping(true);
    }
  });
  messageInput.addEventListener("blur", () => broadcastTyping(false));
  favoriteBtn.addEventListener("click", async () => {
    if (currentChannel) await toggleFavorite(currentChannel.id);
  });

  messagesEl.addEventListener("click", async (evt) => {
    const target = evt.target;
    if (target.classList.contains("author")) {
      await openProfile(target.dataset.userId);
    }
  });

  channelSearchInput.addEventListener("input", () =>
    renderChannelsList(channelsList, channelSearchInput.value)
  );
  friendSearchInput.addEventListener("input", () =>
    renderFriendsList(friendsList, friendSearchInput.value)
  );

  const { data } = await supabaseClient.auth.getSession();
  const user = data?.session?.user || null;
  setSessionUI(user);
  if (user) {
    if (await enforcePlatformBanIfAny(user)) {
      return;
    }
    await ensureProfile(user);
    await refreshSidebar();
    subscribeToInboxMessages();
    await showPendingNotices();
  }

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    const nextUser = session?.user || null;
    setSessionUI(nextUser);
    if (nextUser) {
      if (await enforcePlatformBanIfAny(nextUser)) {
        return;
      }
      await ensureProfile(nextUser);
      await refreshSidebar();
      subscribeToInboxMessages();
      await showPendingNotices();
    }
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) {
      wasHidden = true;
      return;
    }
    if (wasHidden) {
      wasHidden = false;
      await recoverAfterFocus();
    }
  });
  window.addEventListener("focus", async () => {
    await recoverAfterFocus();
  });

  setInterval(async () => {
    if (currentUser) {
      await refreshSidebar();
    }
  }, 60000);

  typingCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of typingUsers.entries()) {
      if (now - value.updatedAt > 3500) typingUsers.delete(key);
    }
    renderTypingIndicator();
  }, 3000);
}

init();
