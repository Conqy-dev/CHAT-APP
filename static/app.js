// ==========================================
// CONQCHAT - FRONTEND (real-time over WebSocket)
// ==========================================

// ---------- State ----------
const STORAGE_KEY = "conqchat_active_conversation";
let currentUser = null;
let activeConversationId = null;
let conversations = [];
let isRegistering = false;
let websocket = null;
let reconnectTimeout = null;
let shouldReconnect = false;
let searchTimeout = null;

// ---------- Elements ----------
const $ = (id) => document.getElementById(id);
const authScreen = $("auth-screen"), chatScreen = $("chat-screen");
const authForm = $("auth-form"), authError = $("auth-error"), authSubmit = $("auth-submit");
const loginTab = $("login-tab"), registerTab = $("register-tab");
const usernameInput = $("username"), passwordInput = $("password");
const currentUsername = $("current-username"), logoutButton = $("logout-button");
const userSearch = $("user-search"), searchResults = $("search-results");
const conversationList = $("conversation-list");
const welcomeScreen = $("welcome-screen"), activeChat = $("active-chat");
const chatUsername = $("chat-username"), chatAvatar = $("chat-avatar"), chatStatus = $("chat-status");
const messagesContainer = $("messages-container");
const messageForm = $("message-form"), messageInput = $("message-input");
const backButton = $("back-button");

// ---------- Small helpers ----------
const sameId = (a, b) => Number(a) === Number(b);
const initial = (name) => name.charAt(0).toUpperCase();
const formatTime = (date) => new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const nearBottom = () =>
    messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 100;
const scrollToBottom = () => (messagesContainer.scrollTop = messagesContainer.scrollHeight);

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text; // textContent: never interpreted as HTML
    return node;
}

// Remember the open conversation so a page refresh reopens it.
// localStorage can throw (e.g. private mode), so failures are only logged.
function storage(action, value) {
    try {
        if (action === "set") localStorage.setItem(STORAGE_KEY, String(value));
        if (action === "get") return localStorage.getItem(STORAGE_KEY);
        if (action === "remove") localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
        console.error("Could not access remembered conversation:", error);
    }
    return null;
}

// ---------- API ----------
async function apiRequest(endpoint, options = {}) {
    const response = await fetch(endpoint, {
        ...options,
        credentials: "same-origin",
        headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    if (response.status === 401) throw new Error("Your session has expired. Please log in again.");
    // Validation errors (422) arrive as a list; show the first one's text
    const detail = Array.isArray(data.detail) ? data.detail[0]?.msg?.replace("Value error, ", "") : data.detail;
    throw new Error(detail || "Something went wrong.");
}

// ---------- Login / register ----------
function setAuthMode(registering) {
    isRegistering = registering;
    loginTab.classList.toggle("active", !registering);
    registerTab.classList.toggle("active", registering);
    authSubmit.textContent = registering ? "Create account" : "Login";
    passwordInput.minLength = registering ? 8 : 1;
    passwordInput.autocomplete = registering ? "new-password" : "current-password";
    authError.textContent = "";
}

loginTab.addEventListener("click", () => setAuthMode(false));
registerTab.addEventListener("click", () => setAuthMode(true));

authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    authError.textContent = "";
    authSubmit.disabled = true;
    authSubmit.textContent = "Please wait...";
    try {
        const data = await apiRequest(isRegistering ? "/api/register" : "/api/login", {
            method: "POST",
            body: JSON.stringify({ username: usernameInput.value.trim(), password: passwordInput.value }),
        });
        currentUser = data.user;
        await showChatApplication();
    } catch (error) {
        authError.textContent = error.message;
    } finally {
        authSubmit.disabled = false;
        authSubmit.textContent = isRegistering ? "Create account" : "Login";
    }
});

async function showChatApplication() {
    authScreen.classList.add("hidden");
    chatScreen.classList.remove("hidden");
    currentUsername.textContent = "Logged in as " + currentUser.username;
    connectWebSocket();
    await loadConversations();
    await restoreLastConversation();
}

async function restoreLastConversation() {
    const rememberedId = storage("get");
    const conversation = rememberedId && conversations.find((c) => sameId(c.id, rememberedId));
    if (conversation) return openConversation(conversation.id, conversation.other_user);
    if (rememberedId) storage("remove"); // it no longer exists or isn't ours
    showWelcomeScreen();
}

function showWelcomeScreen() {
    activeConversationId = null;
    activeChat.classList.add("hidden");
    welcomeScreen.classList.remove("hidden");
    chatScreen.classList.remove("mobile-chat-open");
    messagesContainer.innerHTML = "";
    renderConversations();
}

logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    closeWebSocket();
    storage("remove");
    try {
        await apiRequest("/api/logout", { method: "POST" });
    } catch (error) {
        console.error("Logout error:", error);
    }
    currentUser = null;
    conversations = [];
    usernameInput.value = passwordInput.value = userSearch.value = "";
    conversationList.innerHTML = searchResults.innerHTML = "";
    showWelcomeScreen();
    chatScreen.classList.add("hidden");
    authScreen.classList.remove("hidden");
    setAuthMode(false);
    logoutButton.disabled = false;
});

// ---------- WebSocket (one long-lived TCP connection to the server) ----------
function connectWebSocket() {
    // Don't open a second socket while one is CONNECTING (0) or OPEN (1)
    if (!currentUser || websocket?.readyState <= WebSocket.OPEN) return;
    clearTimeout(reconnectTimeout);

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    websocket = socket;
    shouldReconnect = true;
    chatStatus.textContent = "Connecting...";
    console.log("Connecting to ConqChat WebSocket...");

    socket.addEventListener("open", () => {
        console.log("ConqChat WebSocket connected.");
        if (!currentUser) return socket.close();
        chatStatus.textContent = "Connected";
    });

    socket.addEventListener("message", async (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log("WebSocket event:", data);
            if (data.type === "new_message") {
                appendMessage(data.message);
                await loadConversations(); // refresh previews and order
            } else if (data.type === "error") {
                console.error("WebSocket server error:", data.message);
                alert(data.message);
            }
        } catch (error) {
            console.error("Could not process WebSocket message:", error);
        }
    });

    // Connection lost: try again every 2 seconds until it comes back
    socket.addEventListener("close", () => {
        console.log("ConqChat WebSocket connection closed.");
        if (websocket === socket) websocket = null;
        if (currentUser) chatStatus.textContent = "Reconnecting...";
        if (shouldReconnect && currentUser) reconnectTimeout = setTimeout(connectWebSocket, 2000);
    });

    socket.addEventListener("error", (error) => {
        console.error("WebSocket connection error:", error);
        socket.close();
    });
}

function closeWebSocket() {
    shouldReconnect = false; // a deliberate close, so don't reconnect
    clearTimeout(reconnectTimeout);
    const socket = websocket;
    websocket = null;
    socket?.close();
}

messageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const content = messageInput.value.trim();
    if (!content || !activeConversationId) return;
    if (websocket?.readyState !== WebSocket.OPEN) {
        return alert("Your connection is not ready yet. Please wait a moment.");
    }
    try {
        websocket.send(JSON.stringify({ type: "send_message", conversation_id: activeConversationId, content }));
        messageInput.value = "";
        messageInput.focus();
    } catch (error) {
        console.error("Message sending error:", error);
        alert("Could not send your message. Please try again.");
    }
});

// ---------- Search ----------
userSearch.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    const query = userSearch.value.trim();
    if (!query) return (searchResults.innerHTML = "");

    // Wait until typing pauses for 300 ms before asking the server
    searchTimeout = setTimeout(async () => {
        try {
            searchResults.innerHTML = '<p class="search-message">Searching...</p>';
            const users = await apiRequest("/api/users?search=" + encodeURIComponent(query));
            searchResults.innerHTML = users.length ? "" : '<p class="search-message">No users found.</p>';
            for (const user of users) {
                const button = el("button", "search-result", user.username + " — Start conversation");
                button.type = "button";
                button.addEventListener("click", () => startConversation(user));
                searchResults.appendChild(button);
            }
        } catch (error) {
            searchResults.textContent = error.message;
        }
    }, 300);
});

async function startConversation(user) {
    try {
        const conversation = await apiRequest("/api/conversations/" + user.id, { method: "POST" });
        searchResults.innerHTML = userSearch.value = "";
        await loadConversations();
        await openConversation(conversation.id, conversation.other_user);
    } catch (error) {
        alert(error.message);
    }
}

// ---------- Conversations ----------
async function loadConversations() {
    try {
        conversations = await apiRequest("/api/conversations");
        renderConversations();
    } catch (error) {
        console.error("Conversation loading error:", error);
    }
}

function renderConversations() {
    conversationList.innerHTML = conversations.length ? "" : '<p class="empty-state">No conversations yet.</p>';
    for (const conversation of conversations) {
        const { username } = conversation.other_user;
        const button = el("button", "conversation-item");
        button.type = "button";
        button.classList.toggle("selected", sameId(conversation.id, activeConversationId));
        const info = el("div", "conversation-info");
        info.append(el("strong", "", username), el("span", "", conversation.last_message?.content || "Start chatting"));
        button.append(el("div", "avatar", initial(username)), info);
        button.addEventListener("click", () => openConversation(conversation.id, conversation.other_user));
        conversationList.appendChild(button);
    }
}

async function openConversation(id, otherUser) {
    activeConversationId = id;
    storage("set", id);
    chatUsername.textContent = otherUser.username;
    chatAvatar.textContent = initial(otherUser.username);
    welcomeScreen.classList.add("hidden");
    activeChat.classList.remove("hidden");
    chatScreen.classList.add("mobile-chat-open");
    messagesContainer.innerHTML = "";
    renderConversations();
    await loadMessages();
}

backButton.addEventListener("click", () => {
    storage("remove"); // user chose to leave this chat, so don't reopen it on refresh
    showWelcomeScreen();
});

// ---------- Messages ----------
async function loadMessages() {
    const conversationId = activeConversationId;
    if (!conversationId) return;
    try {
        const messages = await apiRequest(`/api/conversations/${conversationId}/messages`);
        if (!sameId(conversationId, activeConversationId)) return; // user switched chats meanwhile
        messagesContainer.innerHTML = "";
        messages.forEach((message) => appendMessage(message, false));
        scrollToBottom();
    } catch (error) {
        console.error("Message loading error:", error);
    }
}

function appendMessage(message, autoScroll = true) {
    if (!sameId(message.conversation_id, activeConversationId)) return; // belongs to another chat
    if (messagesContainer.querySelector(`[data-message-id="${message.id}"]`)) return; // already shown

    const wasNearBottom = nearBottom();
    const isSent = sameId(message.sender_id, currentUser.id);
    const bubble = el("div", "message " + (isSent ? "sent" : "received"));
    bubble.dataset.messageId = message.id;
    bubble.append(el("div", "", message.content), el("span", "message-time", formatTime(message.created_at)));
    messagesContainer.appendChild(bubble);
    if (autoScroll && wasNearBottom) scrollToBottom(); // don't yank the view if user scrolled up
}

// ---------- Start: reuse an existing login session if there is one ----------
(async function initializeApplication() {
    try {
        currentUser = await apiRequest("/api/me");
        await showChatApplication();
    } catch {
        currentUser = null;
        authScreen.classList.remove("hidden");
        chatScreen.classList.add("hidden");
    }
})();
