(() => {
  const $ = (selector) => document.querySelector(selector);
  const messages = $("#messages");
  const welcome = $("#welcome");
  const input = $("#message-input");
  const sendButton = $("#send-button");
  const typing = $("#typing");
  const approval = $("#approval");
  const threadList = $("#thread-list");
  const attachment = $("#attachment");
  let threadId = localStorage.getItem("agentic-thread-id") || "";
  let selectedFile = null;
  let toastTimeout;

  function toast(text) {
    const node = $("#toast");
    node.textContent = text;
    node.classList.remove("hidden");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => node.classList.add("hidden"), 3200);
  }

  async function api(path, payload) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
    return result;
  }

  function addMessage(role, text, tools = []) {
    welcome.classList.add("hidden");
    const row = document.createElement("article");
    row.className = `message ${role}`;
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = role === "assistant" ? "✳" : "S";
    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = text;
    row.append(avatar, content);
    messages.append(row);
    if (tools.length) {
      const note = document.createElement("div");
      note.className = "tool-note";
      note.textContent = `Used ${tools.join(", ")}`;
      messages.append(note);
    }
    scrollToBottom();
  }

  function scrollToBottom() {
    const scroller = $("#chat-scroll");
    scroller.scrollTop = scroller.scrollHeight;
  }

  function setPendingApproval(pending) {
    approval.replaceChildren();
    if (!pending) {
      approval.classList.add("hidden");
      input.disabled = false;
      sendButton.disabled = false;
      return;
    }
    approval.classList.remove("hidden");
    input.disabled = true;
    sendButton.disabled = true;
    const text = document.createElement("p");
    text.textContent = `Human approval required: ${pending.prompt}`;
    const approve = document.createElement("button");
    approve.className = "approve";
    approve.textContent = "Approve";
    const reject = document.createElement("button");
    reject.className = "reject";
    reject.textContent = "Reject";
    approve.addEventListener("click", () => decide("yes"));
    reject.addEventListener("click", () => decide("no"));
    approval.append(text, approve, reject);
  }

  async function refreshThreads() {
    try {
      const response = await fetch("/api/threads", { cache: "no-store" });
      const result = await response.json();
      const threads = result.threads || [];
      threadList.replaceChildren();
      if (!threads.length) {
        const empty = document.createElement("div");
        empty.className = "thread-empty";
        empty.textContent = "Your conversations will show up here.";
        threadList.append(empty);
        return;
      }
      threads.reverse().forEach((id) => {
        const button = document.createElement("button");
        button.className = `thread-button${id === threadId ? " selected" : ""}`;
        button.textContent = `Conversation ${id.slice(0, 8)}`;
        button.title = id;
        button.addEventListener("click", () => loadConversation(id));
        threadList.append(button);
      });
    } catch {
      // Keep the chat usable when history storage is unavailable.
    }
  }

  async function loadConversation(id) {
    try {
      const result = await api("/api/conversation", { thread_id: id });
      threadId = result.thread_id;
      localStorage.setItem("agentic-thread-id", threadId);
      messages.replaceChildren();
      welcome.classList.toggle("hidden", result.messages.length > 0);
      result.messages.forEach((message) => addMessage(message.role, message.content));
      setPendingApproval(result.pending_approval);
      refreshThreads();
      $("#sidebar").classList.remove("open");
      $(".breadcrumbs strong").textContent = `Conversation ${threadId.slice(0, 8)}`;
    } catch (error) {
      toast(error.message);
    }
  }

  async function sendMessage(text) {
    const message = (text ?? input.value).trim();
    if ((!message && !selectedFile) || sendButton.disabled) return;
    if (message) addMessage("user", message);
    input.value = "";
    input.style.height = "auto";
    sendButton.disabled = true;
    input.disabled = true;
    typing.classList.remove("hidden");
    scrollToBottom();
    try {
      if (selectedFile) await uploadFile(selectedFile);
      if (!message) {
        toast("PDF added to the knowledge base.");
        return;
      }
      const result = await api("/api/chat", { thread_id: threadId, message });
      threadId = result.thread_id;
      localStorage.setItem("agentic-thread-id", threadId);
      if (result.reply) addMessage("assistant", result.reply, result.tools_used);
      setPendingApproval(result.pending_approval);
      $(".breadcrumbs strong").textContent = `Conversation ${threadId.slice(0, 8)}`;
      refreshThreads();
    } catch (error) {
      addMessage("assistant", `I couldn't complete that request. ${error.message}`);
    } finally {
      typing.classList.add("hidden");
      if (approval.classList.contains("hidden")) {
        input.disabled = false;
        sendButton.disabled = false;
        input.focus();
      }
      scrollToBottom();
    }
  }

  async function uploadFile(file) {
    if (!file || file.type !== "application/pdf") throw new Error("Choose a PDF file to upload.");
    if (file.size > 8 * 1024 * 1024) throw new Error("PDF must be smaller than 8 MB.");
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("Could not read the PDF."));
      reader.readAsDataURL(file);
    });
    await api("/api/upload", { filename: file.name, content_base64: base64 });
    selectedFile = null;
    attachment.classList.add("hidden");
    attachment.replaceChildren();
  }

  async function decide(decision) {
    setPendingApproval(null);
    typing.classList.remove("hidden");
    try {
      const result = await api("/api/approve", { thread_id: threadId, decision });
      if (result.reply) addMessage("assistant", result.reply, result.tools_used);
      setPendingApproval(result.pending_approval);
      refreshThreads();
    } catch (error) {
      addMessage("assistant", `The approval could not be processed. ${error.message}`);
    } finally {
      typing.classList.add("hidden");
      if (approval.classList.contains("hidden")) {
        input.disabled = false;
        sendButton.disabled = false;
      }
    }
  }

  function startNewChat() {
    threadId = "";
    localStorage.removeItem("agentic-thread-id");
    messages.replaceChildren();
    welcome.classList.remove("hidden");
    approval.classList.add("hidden");
    input.disabled = false;
    sendButton.disabled = false;
    $(".breadcrumbs strong").textContent = "New conversation";
    refreshThreads();
    input.focus();
  }

  sendButton.addEventListener("click", () => sendMessage());
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  $("#new-chat").addEventListener("click", startNewChat);
  $("#refresh-threads").addEventListener("click", refreshThreads);
  $("#mobile-menu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  document.querySelectorAll(".suggestion").forEach((button) => {
    button.addEventListener("click", () => sendMessage(button.dataset.prompt));
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      startNewChat();
    }
    if (event.key === "Escape") $("#sidebar").classList.remove("open");
  });
  [$("#pdf-input"), $("#rail-pdf-input")].forEach((picker) => {
    picker.addEventListener("change", () => {
      selectedFile = picker.files[0] || null;
      if (!selectedFile) return;
      attachment.replaceChildren();
      const label = document.createElement("span");
      label.textContent = `▤  ${selectedFile.name}`;
      const remove = document.createElement("button");
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        selectedFile = null;
        attachment.classList.add("hidden");
      });
      attachment.append(label, remove);
      attachment.classList.remove("hidden");
      if (picker.id === "rail-pdf-input") sendMessage("");
      picker.value = "";
    });
  });

  refreshThreads();
  if (threadId) loadConversation(threadId);
})();
