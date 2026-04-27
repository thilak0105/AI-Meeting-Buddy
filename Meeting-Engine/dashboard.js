let currentUser = null;
let upcomingHostedMeetings = []; 
let notificationInterval = null;
let notifiedMeetingIds = new Set(); 
let shareOriginCache = null;

// --- Helpers ---
async function api(path, options = {}) {
    const response = await fetch(path, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Request failed");
    }
    return data;
}

function extractMeetingId(input) {
    const raw = String(input || "").trim();
    if (!raw) return "";
    try {
        const parsed = new URL(raw);
        const id = new URLSearchParams(parsed.search).get("meetingId");
        return id || raw;
    } catch {
        return raw;
    }
}

async function getPreferredShareOrigin() {
    if (shareOriginCache) return shareOriginCache;

    try {
        const fromNgrokDomain = /ngrok/i.test(window.location.hostname);
        if (fromNgrokDomain) {
            shareOriginCache = window.location.origin;
            return shareOriginCache;
        }

        const response = await fetch("/api/ngrok");
        const data = await response.json().catch(() => ({}));
        if (response.ok && data?.ok && typeof data.url === "string" && data.url.startsWith("http")) {
            shareOriginCache = data.url.replace(/\/+$/, "");
            return shareOriginCache;
        }
    } catch {
    }

    shareOriginCache = window.location.origin;
    return shareOriginCache;
}

window.copyMeetingLink = async function(meetingId, btnElement) {
    const origin = await getPreferredShareOrigin();
    const link = origin + "/meeting?meetingId=" + meetingId;
    await navigator.clipboard.writeText(link);
    const originalText = btnElement.innerText;
    btnElement.innerText = "Copied!";
    btnElement.classList.add("text-green-400");
    setTimeout(() => {
        btnElement.innerText = originalText;
        btnElement.classList.remove("text-green-400");
    }, 2000);
}

// --- Notification Engine ---
function checkUpcomingMeetings() {
    const now = new Date();
    
    upcomingHostedMeetings.forEach(meeting => {
        if (!meeting.startsAt) return;
        
        const startTime = new Date(meeting.startsAt);
        const diffMs = startTime - now;
        const diffMins = diffMs / 60000;
        
        if (diffMins > 0 && diffMins <= 5 && !notifiedMeetingIds.has(meeting.meetingId)) {
            showNotification(meeting);
            notifiedMeetingIds.add(meeting.meetingId);
        }
    });
}

function showNotification(meeting) {
    const popup = document.getElementById("upcomingNotification");
    if (!popup) return;
    
    const text = document.getElementById("notificationText");
    const joinBtn = document.getElementById("notificationJoinBtn");
    const closeBtn = document.getElementById("notificationCloseBtn");
    
    const timeString = new Date(meeting.startsAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    if (text) text.innerText = `"${meeting.meetingName}" starts at ${timeString}.`;
    
    if (joinBtn) joinBtn.onclick = () => window.location.href = `/meeting?meetingId=${meeting.meetingId}`;
    if (closeBtn) closeBtn.onclick = () => hideNotification();

    popup.classList.remove("translate-x-[150%]", "opacity-0");
    popup.classList.add("translate-x-0", "opacity-100");
}

function hideNotification() {
    const popup = document.getElementById("upcomingNotification");
    if (!popup) return;
    popup.classList.remove("translate-x-0", "opacity-100");
    popup.classList.add("translate-x-[150%]", "opacity-0");
}

// --- Rendering ---
function renderMeetingCards(meetings, containerId, isUpcomingList = false) {
    const list = document.getElementById(containerId);
    if (!list) return;
    
    if (!meetings.length) {
        list.innerHTML = `
            <div class="bg-[#28292c] border border-white/5 rounded-2xl p-6 text-center text-slate-500 text-sm">
                <p>No ${isUpcomingList ? 'upcoming' : 'past'} meetings found.</p>
            </div>`;
        return;
    }

    list.innerHTML = meetings.map((meeting) => {
        const isHost = meeting.participationRole.includes("hosted");
        const roleBadge = isHost 
            ? '<span class="text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-[#8ab4f8]/10 text-[#8ab4f8] border border-[#8ab4f8]/20">Host</span>'
            : '<span class="text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-slate-700/50 text-slate-300 border border-white/5">Participant</span>';
        
        let statusColor = 'text-slate-500';
        if (meeting.status === 'active') statusColor = 'text-green-400';
        if (meeting.status === 'scheduled') statusColor = 'text-blue-400';
        if (meeting.status === 'finished') statusColor = 'text-emerald-500'; 
        if (meeting.status === 'dropped') statusColor = 'text-rose-500';

        const showJoinBtn = meeting.status === 'active' || meeting.status === 'scheduled';
        
        let dateHtml = "";
        if (isUpcomingList && meeting.startsAt) {
            const dateObj = new Date(meeting.startsAt);
            const month = dateObj.toLocaleString('default', { month: 'short' }).toUpperCase();
            const day = dateObj.getDate();
            const time = dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            dateHtml = `
                <div class="flex flex-col items-center justify-center bg-[#202124] border border-white/5 rounded-xl px-4 py-2 shrink-0 w-20">
                    <span class="text-[10px] font-bold text-slate-400">${month}</span>
                    <span class="text-xl font-bold text-white leading-tight">${day}</span>
                    <span class="text-[10px] font-medium text-slate-500 mt-1">${time}</span>
                </div>
            `;
        }

        return `
        <div class="bg-[#28292c] border border-white/5 hover:border-white/10 transition-colors rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group">
            <div class="flex items-center gap-4">
                ${dateHtml}
                <div>
                    <div class="flex items-center gap-3 mb-1">
                        <h3 class="font-bold text-white text-base">${meeting.meetingName}</h3>
                        ${roleBadge}
                    </div>
                    <div class="flex items-center gap-3 text-xs font-medium text-slate-400 mb-2">
                        <span class="${statusColor} flex items-center gap-1">
                            <span class="size-1.5 rounded-full ${meeting.status === 'active' ? 'bg-green-400 animate-pulse' : 'bg-current'}"></span>
                            ${meeting.status.charAt(0).toUpperCase() + meeting.status.slice(1)}
                        </span>
                        <span>•</span>
                        <span class="font-mono text-[10px] tracking-wider bg-[#202124] px-1.5 py-0.5 rounded border border-white/5">${meeting.meetingId}</span>
                    </div>
                    ${meeting.description ? `<p class="text-sm text-slate-400 line-clamp-1">${meeting.description}</p>` : ""}
                </div>
            </div>
            
            <div class="flex items-center gap-2 shrink-0 mt-3 sm:mt-0">
                <button onclick="copyMeetingLink('${meeting.meetingId}', this)" class="text-xs font-bold text-slate-400 hover:text-white px-3 py-2 rounded-lg hover:bg-white/5 transition-colors">Copy Link</button>
                ${showJoinBtn ? `<a href="/meeting?meetingId=${meeting.meetingId}" class="text-xs font-bold bg-[#3c4043] hover:bg-[#4a4d51] text-white px-4 py-2 rounded-lg transition-colors border border-white/5">${meeting.status === 'scheduled' ? 'Join when ready' : 'Enter Room'}</a>` : ''}
            </div>
        </div>`;
    }).join("");
}

// --- Data Loading ---
async function loadDashboard() {
    try {
        const me = await api("/api/auth/me");
        currentUser = me.user;
    } catch {
        window.location.href = "/";
        return;
    }

    document.getElementById("userMeta").textContent = `${currentUser.name} • ${currentUser.email} • ${currentUser.role}`;

    const isManager = currentUser.role === "manager";
    const createCard = document.getElementById("managerCreateCard");
    const userCard = document.getElementById("managerUserCard");
    
    if (createCard) createCard.classList.toggle("hidden", !isManager);
    if (userCard) userCard.classList.toggle("hidden", !isManager);

    const taskCard = document.getElementById("taskBoardCard");
    const summariesSection = document.getElementById("projectSummariesSection");
    if (taskCard) taskCard.classList.toggle("hidden", !isManager);
    if (summariesSection) summariesSection.classList.toggle("hidden", !isManager);

    const history = await api("/api/meetings/history");
    const allMeetings = history.meetings || [];
    
    const upcoming = [];
    const past = [];

    allMeetings.forEach(m => {
        if (m.status === 'scheduled' || m.status === 'active') {
            upcoming.push(m);
        } else {
            past.push(m);
        }
    });

    upcoming.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));

    renderMeetingCards(upcoming, "upcomingList", true);
    renderMeetingCards(past, "historyList", false);

    upcomingHostedMeetings = upcoming.filter(m => m.participationRole.includes('hosted'));

    if (notificationInterval) clearInterval(notificationInterval);
    notificationInterval = setInterval(checkUpcomingMeetings, 30000);
    checkUpcomingMeetings(); 

    if (isManager) {
        await loadProjectSummaries();
        await loadAllProjectTasks();
    }
}

// --- Tab Logic ---
const tabInstant = document.getElementById("tabInstant");
const tabSchedule = document.getElementById("tabSchedule");
const instantForm = document.getElementById("instantMeetingForm");
const scheduleForm = document.getElementById("scheduleMeetingForm");

if (tabInstant && tabSchedule) {
    tabInstant.onclick = () => {
        tabInstant.classList.replace("border-transparent", "border-[#8ab4f8]");
        tabInstant.classList.replace("text-slate-500", "text-[#8ab4f8]");
        tabSchedule.classList.replace("border-[#8ab4f8]", "border-transparent");
        tabSchedule.classList.replace("text-[#8ab4f8]", "text-slate-500");
        instantForm.classList.remove("hidden");
        scheduleForm.classList.add("hidden");
    };

    tabSchedule.onclick = () => {
        tabSchedule.classList.replace("border-transparent", "border-[#8ab4f8]");
        tabSchedule.classList.replace("text-slate-500", "text-[#8ab4f8]");
        tabInstant.classList.replace("border-[#8ab4f8]", "border-transparent");
        tabInstant.classList.replace("text-[#8ab4f8]", "text-slate-500");
        scheduleForm.classList.remove("hidden");
        instantForm.classList.add("hidden");

        const localNow = new Date();
        localNow.setMinutes(localNow.getMinutes() + 15);
        setScheduleStartAndAutoEnd(localNow);
    };
}

// Converts a Date to the YYYY-MM-DDTHH:MM format datetime-local inputs expect (in local time)
function toLocalInputValue(date) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

// Sets start input and auto-calculates end time as start + 40 minutes
function setScheduleStartAndAutoEnd(startDate) {
    const startsAtInput = document.getElementById("scheduleStartsAt");
    const endsAtInput = document.getElementById("scheduleEndsAt");
    if (!startsAtInput || !endsAtInput) return;

    startsAtInput.value = toLocalInputValue(startDate);

    const endDate = new Date(startDate);
    endDate.setMinutes(endDate.getMinutes() + 40);
    endsAtInput.value = toLocalInputValue(endDate);
}

// Dynamically update end time whenever start time changes
const scheduleStartsAtInput = document.getElementById("scheduleStartsAt");
if (scheduleStartsAtInput) {
    scheduleStartsAtInput.addEventListener("change", () => {
        const newStart = new Date(scheduleStartsAtInput.value);
        if (isNaN(newStart.getTime())) return;
        const endsAtInput = document.getElementById("scheduleEndsAt");
        if (!endsAtInput) return;
        const endDate = new Date(newStart);
        endDate.setMinutes(endDate.getMinutes() + 40);
        endsAtInput.value = toLocalInputValue(endDate);
    });
}


// --- Form Handlers ---
document.getElementById("logoutBtn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
});

document.getElementById("joinMeetingForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const meetingId = extractMeetingId(document.getElementById("joinMeetingId").value);
    if (!meetingId) return;
    window.location.href = `/meeting?meetingId=${encodeURIComponent(meetingId)}`;
});

if (instantForm) {
    instantForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            const data = await api("/api/meetings", {
                method: "POST",
                body: JSON.stringify({
                    meetingName: document.getElementById("instantMeetingName").value.trim(),
                    description: document.getElementById("instantMeetingDescription").value.trim() || null,
                    startsAt: null,
                    endsAt: null,
                }),
            });
            window.location.href = `/meeting?meetingId=${encodeURIComponent(data.meeting.meetingId)}`;
        } catch (err) {
            alert(err.message);
        }
    });
}

if (scheduleForm) {
    scheduleForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            const rawStart = document.getElementById("scheduleStartsAt").value;
            const rawEnd = document.getElementById("scheduleEndsAt").value;
            
            const isoStart = rawStart ? new Date(rawStart).toISOString() : null;
            const isoEnd = rawEnd ? new Date(rawEnd).toISOString() : null;

            await api("/api/meetings", {
                method: "POST",
                body: JSON.stringify({
                    meetingName: document.getElementById("scheduleMeetingName").value.trim(),
                    description: document.getElementById("scheduleMeetingDescription").value.trim() || null,
                    startsAt: isoStart,
                    endsAt: isoEnd,
                }),
            });
            
            scheduleForm.reset();
            tabInstant.click();
            loadDashboard();
            alert("Meeting successfully scheduled!");
        } catch (err) {
            alert(err.message);
        }
    });
}

const createUserForm = document.getElementById("createUserForm");
if (createUserForm) {
    createUserForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            await api("/api/auth/users", {
                method: "POST",
                body: JSON.stringify({
                    name: document.getElementById("newUserName").value.trim(),
                    email: document.getElementById("newUserEmail").value.trim(),
                    password: document.getElementById("newUserPassword").value,
                    role: document.getElementById("newUserRole").value,
                }),
            });
            createUserForm.reset();
            alert("User created successfully");
        } catch (err) {
            alert(err.message);
        }
    });
}

loadDashboard();

// ═══════════════════════════════════════════════════════════════════════════
// PROJECT SUMMARIES
// ═══════════════════════════════════════════════════════════════════════════
async function loadProjectSummaries() {
    const list = document.getElementById("projectSummariesList");
    if (!list) return;
    try {
        const data = await api("/api/meeting-summaries");
        const summaries = data.summaries || [];
        if (!summaries.length) {
            list.innerHTML = `<div class="bg-[#28292c] border border-white/5 rounded-2xl p-6 text-center text-slate-500 text-sm">No meeting summaries yet. Summaries are generated after meetings end.</div>`;
            return;
        }
        list.innerHTML = summaries.map(s => {
            const date = s.meetingDate
                ? new Date(s.meetingDate).toLocaleDateString("default", { month: "short", day: "numeric", year: "numeric" })
                : "Unknown date";
            const title = s.meetingName || s.meetingId;
            return `
            <div class="bg-[#28292c] border border-white/5 hover:border-[#8ab4f8]/30 transition-colors rounded-xl p-4 flex items-center justify-between gap-4 group">
                <div class="min-w-0">
                    <h3 class="font-bold text-white text-base mb-1 truncate">${title}</h3>
                    <div class="flex items-center gap-3 text-xs text-slate-500">
                        <span>${date}</span>
                        <span>•</span>
                        <span class="truncate">${s.hostEmail}</span>
                    </div>
                </div>
                <button onclick="openProjectSummary(${JSON.stringify(title)}, ${JSON.stringify(s.summaryHtml)})"
                    class="shrink-0 text-xs font-bold bg-[#3c4043] hover:bg-[#8ab4f8] hover:text-slate-900 text-white px-4 py-2 rounded-lg transition-colors border border-white/5">
                    View
                </button>
            </div>`;
        }).join("");
    } catch (err) {
        console.error("loadProjectSummaries error:", err);
    }
}

window.openProjectSummary = function(title, summaryHtml) {
    const modal = document.getElementById("projectSummaryModal");
    const nameEl = document.getElementById("modalProjectName");
    const contentEl = document.getElementById("modalSummaryContent");
    if (!modal) return;
    nameEl.textContent = title;
    contentEl.innerHTML = summaryHtml || "<p class=\'text-slate-400\'>No summary available.</p>";
    modal.classList.remove("hidden");
};

const closeModalBtn = document.getElementById("closeModalBtn");
if (closeModalBtn) {
    closeModalBtn.addEventListener("click", () => {
        document.getElementById("projectSummaryModal").classList.add("hidden");
    });
}
document.getElementById("projectSummaryModal")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden");
});

// ═══════════════════════════════════════════════════════════════════════════
// PERSONAL TO-DO LIST
// Simple flat task list — no project selection needed.
// Uses projectName = "__personal__" as a fixed internal key.
// ═══════════════════════════════════════════════════════════════════════════
const PERSONAL_PROJECT = "__personal__";
let myTasks = [];  // flat array of task objects

const PRIORITY_COLORS = {
    high:   "text-rose-400 bg-rose-400/10 border-rose-400/20",
    medium: "text-amber-400 bg-amber-400/10 border-amber-400/20",
    low:    "text-slate-400 bg-slate-400/10 border-slate-400/20",
};
const STATUS_NEXT  = { todo: "in_progress", in_progress: "done", done: "todo" };
const STATUS_LABEL = { todo: "To Do", in_progress: "In Progress", done: "Done" };

async function loadAllProjectTasks() {
    try {
        const data = await api(`/api/project-tasks/${encodeURIComponent(PERSONAL_PROJECT)}`);
        myTasks = data.tasks || [];
        renderTaskBoard(myTasks);
    } catch (err) {
        console.error("loadAllProjectTasks error:", err);
    }
}

function renderTaskBoard(tasks) {
    const todoList        = document.getElementById("todoList");
    const inProgressList  = document.getElementById("inProgressList");
    const doneList        = document.getElementById("doneList");
    const todoCount       = document.getElementById("todoCount");
    const inProgressCount = document.getElementById("inProgressCount");
    const doneCount       = document.getElementById("doneCount");

    const todo       = tasks.filter(t => t.status === "todo");
    const inProgress = tasks.filter(t => t.status === "in_progress");
    const done       = tasks.filter(t => t.status === "done");

    if (todoCount)       todoCount.textContent       = todo.length;
    if (inProgressCount) inProgressCount.textContent = inProgress.length;
    if (doneCount)       doneCount.textContent       = done.length;

    if (todoList)       todoList.innerHTML       = todo.length       ? todo.map(renderTaskCard).join("")       : emptyColumnHtml();
    if (inProgressList) inProgressList.innerHTML = inProgress.length ? inProgress.map(renderTaskCard).join("") : emptyColumnHtml();
    if (doneList)       doneList.innerHTML       = done.length       ? done.map(renderTaskCard).join("")       : emptyColumnHtml();
}

function emptyColumnHtml() {
    return `<div class="text-xs text-slate-600 italic py-3 text-center border border-dashed border-white/10 rounded-lg">Empty</div>`;
}

function renderTaskCard(task) {
    const pColor     = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium;
    const isDone     = task.status === "done";
    const nextStatus = STATUS_NEXT[task.status];
    const nextLabel  = STATUS_LABEL[nextStatus];

    return `
    <div class="bg-[#202124] border border-white/5 rounded-xl p-3 group hover:border-white/10 transition-colors ${isDone ? 'opacity-60' : ''}">
        <div class="flex items-start justify-between gap-2 mb-1.5">
            <div class="flex items-start gap-2 flex-1 min-w-0">
                <button onclick="cycleTaskStatus('${task._id}', '${nextStatus}')"
                    class="mt-0.5 shrink-0 size-4 rounded border-2 flex items-center justify-center transition-colors
                    ${isDone ? 'bg-emerald-500 border-emerald-500' : task.status === 'in_progress' ? 'border-amber-400' : 'border-slate-600 hover:border-slate-400'}"
                    title="Mark as ${nextLabel}">
                    ${isDone ? `<svg class="size-2.5 text-white" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>` : ''}
                    ${task.status === 'in_progress' ? `<div class="size-2 rounded-sm bg-amber-400"></div>` : ''}
                </button>
                <p class="text-sm font-medium text-white leading-snug ${isDone ? 'line-through text-slate-500' : ''}">${task.title}</p>
            </div>
            <button onclick="deleteTask('${task._id}')" class="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 transition-all">
                <svg class="size-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </div>
        ${task.description ? `<p class="text-xs text-slate-500 ml-6 mb-1.5 leading-snug">${task.description}</p>` : ''}
        <div class="ml-6">
            <span class="text-[9px] font-bold px-1.5 py-0.5 rounded border ${pColor}">${task.priority}</span>
        </div>
    </div>`;
}

window.cycleTaskStatus = async function(taskId, newStatus) {
    try {
        const data = await api(`/api/project-tasks/${taskId}`, {
            method: "PATCH",
            body: JSON.stringify({ status: newStatus }),
        });
        const idx = myTasks.findIndex(t => t._id === taskId);
        if (idx !== -1) { myTasks[idx] = data.task; renderTaskBoard(myTasks); }
    } catch (err) { alert(err.message); }
};

window.deleteTask = async function(taskId) {
    if (!confirm("Delete this task?")) return;
    try {
        await api(`/api/project-tasks/${taskId}`, { method: "DELETE" });
        myTasks = myTasks.filter(t => t._id !== taskId);
        renderTaskBoard(myTasks);
    } catch (err) { alert(err.message); }
};

// Add Task modal
const addTaskBtn            = document.getElementById("addTaskBtn");
const addTaskModal          = document.getElementById("addTaskModal");
const closeAddTaskModalBtn  = document.getElementById("closeAddTaskModalBtn");
const addTaskForm           = document.getElementById("addTaskForm");

if (addTaskBtn) {
    addTaskBtn.addEventListener("click", () => addTaskModal.classList.remove("hidden"));
}
if (closeAddTaskModalBtn) {
    closeAddTaskModalBtn.addEventListener("click", () => addTaskModal.classList.add("hidden"));
}
addTaskModal?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden");
});

if (addTaskForm) {
    addTaskForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            const data = await api("/api/project-tasks", {
                method: "POST",
                body: JSON.stringify({
                    projectName: PERSONAL_PROJECT,
                    title:       document.getElementById("addTaskTitle").value.trim(),
                    description: document.getElementById("addTaskDescription").value.trim(),
                    priority:    document.getElementById("addTaskPriority").value,
                    status:      document.getElementById("addTaskStatus").value,
                }),
            });
            addTaskModal.classList.add("hidden");
            addTaskForm.reset();
            myTasks.push(data.task);
            renderTaskBoard(myTasks);
        } catch (err) { alert(err.message); }
    });
}
