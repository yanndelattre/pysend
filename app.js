const config = window.PYSEND_CONFIG || {};
const { createClient } = window.supabase || {};

const authPanel = document.getElementById("auth-panel");
const appPanel = document.getElementById("app-panel");
const authForm = document.getElementById("auth-form");
const authMsg = document.getElementById("auth-msg");
const signinBtn = document.getElementById("signin-btn");
const signupBtn = document.getElementById("signup-btn");
const signoutBtn = document.getElementById("signout-btn");
const sessionEmail = document.getElementById("session-email");

const channelsList = document.getElementById("channels-list");
const friendsList = document.getElementById("friends-list");
const createChannelBtn = document.getElementById("create-channel-btn");
const newChannelBtn = document.getElementById("new-channel-btn");
const channelNameInput = document.getElementById("channel-name");
const friendEmailInput = document.getElementById("friend-email");
const addFriendBtn = document.getElementById("add-friend-btn");

const channelTitle = document.getElementById("channel-title");
const channelMeta = document.getElementById("channel-meta");
const messagesEl = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");

let supabase = null;
let currentUser = null;
let currentChannel = null;
let messageSubscription = null;

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
  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
}

function setSessionUI(user) {
  currentUser = user;
  if (user) {
    sessionEmail.textContent = user.email || "";
    signoutBtn.classList.remove("hidden");
    authPanel.classList.add("hidden");
    appPanel.classList.remove("hidden");
  } else {
    sessionEmail.textContent = "";
    signoutBtn.classList.add("hidden");
    authPanel.classList.remove("hidden");
    appPanel.classList.add("hidden");
  }
}

async function ensureProfile(user, displayName = "") {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    await supabase.from("profiles").insert({
      id: user.id,
      email: user.email,
      display_name: displayName || user.email?.split("@")[0] || "Pixel"
    });
  } else if (displayName && profile.display_name !== displayName) {
    await supabase.from("profiles").update({ display_name: displayName }).eq("id", user.id);
  }
}

function renderList(container, items, onClick) {
  container.innerHTML = "";
  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "list-item" + (item.active ? " active" : "");
    div.textContent = item.label;
    div.addEventListener("click", () => onClick(item));
    container.appendChild(div);
  });
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

function renderMessages(messages) {
  messagesEl.innerHTML = "";
  messages.forEach((msg) => appendMessage(msg));
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendMessage(msg) {
  const row = document.createElement("div");
  row.className = "message-row";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = `${msg.author || "?"} · ${formatDate(msg.created_at)}`;
  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = msg.body;
  row.appendChild(meta);
  row.appendChild(body);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function loadChannels() {
  const { data, error } = await supabase
    .from("channels")
    .select("id,name,is_dm,created_at")
    .order("created_at", { ascending: false });
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
}

async function loadFriends() {
  const { data: rels } = await supabase
    .from("friendships")
    .select("friend_id")
    .eq("user_id", currentUser.id);

  const friendIds = (rels || []).map((r) => r.friend_id).filter(Boolean);
  if (friendIds.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id,display_name,email")
    .in("id", friendIds);

  return (profiles || []).map((p) => ({
    id: p.id,
    label: p.display_name || p.email
  }));
}

async function refreshSidebar() {
  const [channels, friends] = await Promise.all([loadChannels(), loadFriends()]);
  renderList(
    channelsList,
    channels.map((c) => ({
      id: c.id,
      label: c.name,
      active: currentChannel && currentChannel.id === c.id,
      raw: c
    })),
    async (item) => {
      await selectChannel(item.raw);
      refreshSidebar();
    }
  );
  renderList(
    friendsList,
    friends.map((f) => ({ id: f.id, label: f.label })),
    async (item) => {
      await openDirectMessage(item.id, item.label);
      refreshSidebar();
    }
  );
}

async function selectChannel(channel) {
  currentChannel = channel;
  channelTitle.textContent = channel.name;
  channelMeta.textContent = channel.is_dm ? "Salon privé" : "Salon public";

  await ensureMembership(channel.id, currentUser.id);

  const { data: messages, error } = await supabase
    .from("messages")
    .select("id,body,created_at,user_id,profiles(display_name,email)")
    .eq("channel_id", channel.id)
    .order("created_at", { ascending: true })
    .limit(50);
  if (!error) {
    const mapped = (messages || []).map((m) => ({
      id: m.id,
      body: m.body,
      created_at: m.created_at,
      author: m.profiles?.display_name || m.profiles?.email || "Anonyme"
    }));
    renderMessages(mapped);
  }
  subscribeToMessages(channel.id);
}

function subscribeToMessages(channelId) {
  if (messageSubscription) {
    supabase.removeChannel(messageSubscription);
  }
  messageSubscription = supabase
    .channel(`messages:channel:${channelId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` },
      async (payload) => {
        const msg = payload.new;
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name,email")
          .eq("id", msg.user_id)
          .maybeSingle();
        appendMessage({
          id: msg.id,
          body: msg.body,
          created_at: msg.created_at,
          author: profile?.display_name || profile?.email || "Anonyme"
        });
      }
    )
    .subscribe();
}

async function ensureMembership(channelId, userId) {
  await supabase.from("channel_members").upsert(
    {
      channel_id: channelId,
      user_id: userId
    },
    { onConflict: "channel_id,user_id" }
  );
}

async function openDirectMessage(friendId, friendLabel) {
  const pair = [currentUser.id, friendId].sort().join("|");
  const { data: existing } = await supabase
    .from("channels")
    .select("id,name,is_dm")
    .eq("dm_pair", pair)
    .maybeSingle();

  let channel = existing;
  if (!channel) {
    const { data: inserted, error } = await supabase
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

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    showMessage("Connexion impossible. Vérifie tes identifiants.", true);
    return;
  }
  await ensureProfile(data.user, displayName);
  setSessionUI(data.user);
  await refreshSidebar();
}

async function handleSignUp() {
  clearMessage();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const displayName = document.getElementById("display-name").value.trim();

  const { data, error } = await supabase.auth.signUp({ email, password });
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
  if (!name) return;
  const { data, error } = await supabase
    .from("channels")
    .insert({ name, created_by: currentUser.id })
    .select()
    .single();
  if (error) {
    console.error(error);
    return;
  }
  channelNameInput.value = "";
  await ensureMembership(data.id, currentUser.id);
  await selectChannel(data);
  refreshSidebar();
}

async function handleAddFriend() {
  const email = friendEmailInput.value.trim().toLowerCase();
  if (!email) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id,display_name,email")
    .eq("email", email)
    .maybeSingle();

  if (!profile) {
    alert("Aucun compte trouvé avec cet email.");
    return;
  }
  if (profile.id === currentUser.id) {
    alert("Tu es déjà ton propre ami.");
    return;
  }

  const { error } = await supabase.from("friendships").upsert(
    {
      user_id: currentUser.id,
      friend_id: profile.id,
      status: "accepted"
    },
    { onConflict: "user_id,friend_id" }
  );
  if (error) {
    console.error(error);
    return;
  }
  friendEmailInput.value = "";
  refreshSidebar();
}

async function handleSendMessage(evt) {
  evt.preventDefault();
  const body = messageInput.value.trim();
  if (!body || !currentChannel) return;

  const { error } = await supabase.from("messages").insert({
    channel_id: currentChannel.id,
    user_id: currentUser.id,
    body
  });
  if (!error) messageInput.value = "";
}

async function init() {
  ensureSupabase();

  authForm.addEventListener("submit", handleAuthSubmit);
  signupBtn.addEventListener("click", handleSignUp);
  signoutBtn.addEventListener("click", async () => {
    await supabase.auth.signOut();
    setSessionUI(null);
  });
  createChannelBtn.addEventListener("click", handleCreateChannel);
  newChannelBtn.addEventListener("click", () => channelNameInput.focus());
  addFriendBtn.addEventListener("click", handleAddFriend);
  messageForm.addEventListener("submit", handleSendMessage);

  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user || null;
  setSessionUI(user);
  if (user) {
    await ensureProfile(user);
    await refreshSidebar();
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    const user = session?.user || null;
    setSessionUI(user);
    if (user) {
      await ensureProfile(user);
      await refreshSidebar();
    }
  });
}

init();
