// Connect to Socket.IO server (works with both localhost and ngrok)
let userId = localStorage.getItem("userId");

if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem("userId", userId);
}

const socket = io(window.location.origin, {
    query: { userId: userId }
});

let isMeetingHost = false;
let meetingActive = false;
let currentUser = null;
const localVideo = document.getElementById("localVideo");
const localVideoContainer = document.getElementById("local-video-container");
const remoteVideosContainer = document.getElementById('remote-videos');
const engagementDiv = document.getElementById("engagementScore");
const leaveBtn = document.getElementById("leaveBtn");
const statsDiv = document.getElementById("stats");
const muteBtn = document.getElementById("muteBtn");
const cameraBtn = document.getElementById("cameraBtn");
const summaryBox = document.getElementById("summary-box");
const cameraLoading = document.getElementById("camera-loading");
const notesInput = document.getElementById("notesInput");
const generateSummaryBtn = document.getElementById("generateSummaryBtn");
let shareOriginCache = null;

// --- Control Bar Auto-Hide Logic ---
let hideControlBarTimeout;
const controlBar = document.getElementById("controlBar");

function resetControlBarTimer() {
    if (!controlBar) return;
    controlBar.classList.remove("opacity-0", "translate-y-4", "pointer-events-none");
    clearTimeout(hideControlBarTimeout);

    hideControlBarTimeout = setTimeout(() => {
        // Don't hide if the emoji picker is open
        if (emojiDropdown && emojiDropdown.style.display === 'flex') {
            resetControlBarTimer();
            return;
        }
        controlBar.classList.add("opacity-0", "translate-y-4", "pointer-events-none");
    }, 2000);
}

document.addEventListener("mousemove", resetControlBarTimer);
document.addEventListener("keydown", resetControlBarTimer);
document.addEventListener("click", resetControlBarTimer);
resetControlBarTimer(); // Start the timer immediately

// Fix browser autoplay restriction
document.body.addEventListener("click", () => {
    document.querySelectorAll("video").forEach(v => {
        v.play().catch(() => { });
    });
}, { once: true });

// Shows a disappearing toast message
function showToast(message) {
    const toast = document.getElementById("toastNotification");
    const toastMsg = document.getElementById("toastMessage");
    toastMsg.innerText = message;

    // Slide in
    toast.classList.remove("opacity-0", "-translate-y-10");
    toast.classList.add("opacity-100", "translate-y-0");

    // Slide out after 3.5 seconds
    setTimeout(() => {
        toast.classList.remove("opacity-100", "translate-y-0");
        toast.classList.add("opacity-0", "-translate-y-10");
    }, 3500);
}

// Shows or hides host controls based on your current status
function updateHostUI() {
    document.querySelectorAll('.make-host-btn').forEach(btn => {
        if (isMeetingHost) {
            btn.classList.remove('hidden');
        } else {
            btn.classList.add('hidden');
        }
    });
}

function initializeMeetingId() {
    const params = new URLSearchParams(window.location.search);
    let meetingId = params.get("meetingId");

    if (!meetingId) {
        alert("Meeting ID is missing. Please start or join from dashboard.");
        window.location.href = "/dashboard";
        return null;
    }
    console.log("Joining existing meeting:", meetingId);
    return meetingId;
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


// Parse URL params to allow `meetingId`, `hostEmail`, and `meetingDate` to be passed
function parseAndApplyUrlParams() {
    try {
        const params = new URLSearchParams(window.location.search);
        const meetingId = params.get('meetingId');
        const hostEmail = params.get('hostEmail');
        const meetingDate = params.get('meetingDate');
        if (hostEmail && meetingDate) {
            const ctx = { email: hostEmail, meetingDate };
            window.sessionStorage.setItem('hostContext', JSON.stringify(ctx));
        } else if (hostEmail && !meetingDate) {
            // preserve existing meetingDate or use today
            const existing = JSON.parse(window.sessionStorage.getItem('hostContext') || '{}');
            const ctx = { email: hostEmail, meetingDate: existing.meetingDate || new Date().toISOString().slice(0, 10) };
            window.sessionStorage.setItem('hostContext', JSON.stringify(ctx));
        }
    } catch (err) {
        console.warn('Unable to parse URL params for meeting context', err);
    }
}

parseAndApplyUrlParams();

const hostContext = {
    email: "",
    meetingDate: new Date().toISOString().slice(0, 10)
};

const peerConnections = {};
const peerInfo = {}; // socketId -> { email }
const iceCandidateQueues = {};
let localStream;
let audioContext;
const speakingThreshold = -50; // dB

// AI summary generation: send notes to backend, display + store result
if (generateSummaryBtn) {
    generateSummaryBtn.addEventListener("click", async () => {
        const notes = (notesInput?.value || "").trim();
        const ctx = hostContext || getOrPromptHostContext();

        if (!notes) {
            alert("Please enter some meeting notes for the AI to summarize.");
            return;
        }

        generateSummaryBtn.disabled = true;
        const originalText = generateSummaryBtn.textContent;
        generateSummaryBtn.textContent = "Generating…";

        summaryBox.innerHTML = `<div class="loading-spinner"></div><p class="mt-2 text-xs text-slate-500">Generating AI summary…</p>`;

        try {
            const response = await fetch("/api/generate-summary", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    notes,
                    hostEmail: ctx?.email,
                    meetingDate: ctx?.meetingDate,
                }),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.ok || !data.summaryHtml) {
                console.error("AI summary error", data);
                alert("AI summary failed. Check server logs.");
                summaryBox.innerHTML =
                    '<p class="text-xs text-rose-500">AI summary failed. Please try again.</p>';
                return;
            }

            summaryBox.innerHTML = data.summaryHtml;
            saveSummaryToBackend(data.summaryHtml);
        } catch (err) {
            console.error("Error calling /api/generate-summary:", err);
            alert("Error contacting AI summary service. Check console/server.");
            summaryBox.innerHTML =
                '<p class="text-xs text-rose-500">Could not reach AI summary service.</p>';
        } finally {
            generateSummaryBtn.disabled = false;
            generateSummaryBtn.textContent = originalText || "Generate AI summary";
        }
    });
}

function getOrCreateMeetingId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("meetingId") || "";
}

async function saveSummaryToBackend(summaryHtml) {
    const meetingId = getOrCreateMeetingId();
    const { email: hostEmail, meetingDate } = hostContext;

    console.log("💾 Attempting to save summary to MongoDB...");
    console.log("   Meeting ID:", meetingId);
    console.log("   Host Email:", hostEmail);
    console.log("   Meeting Date:", meetingDate);
    console.log("   Summary length:", summaryHtml.length, "characters");

    try {
        const response = await fetch("/api/summaries", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ meetingId, summaryHtml, hostEmail, meetingDate })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
            console.error("❌ Failed to save summary:", data);
            alert("Failed to save summary to database. Check console for details.");
        } else {
            console.log("✅ Summary saved successfully!");
            console.log("   Document ID:", data.id);
            console.log("   Database: ai-meeting-buddy");
            console.log("   Collection: meetingsummaries");
            console.log("   You can view it in MongoDB Compass or via GET /api/summaries");
        }
    } catch (err) {
        console.error("❌ Error calling /api/summaries:", err);
        alert("Error connecting to server. Make sure the server is running.");
    }
}

function getOrPromptHostContext() {
    return hostContext;
}

function promptForHostContext() {
    return hostContext;
}

// Share this host's email with others once socket is connected
// socket.on("connect", () => {
//   const ctx = hostContext || getOrPromptHostContext();
//   const meetingId = getOrCreateMeetingId();
//   const meetingDate = ctx?.meetingDate || new Date().toISOString().slice(0, 10);

//   socket.emit("join-meeting", { meetingId });

//   if (ctx?.email) {
//     socket.emit("host-info", { 
//       email: ctx.email,
//       meetingId: meetingId,
//       meetingDate: meetingDate,
//       isHost: true
//     });
//   }
// });

// Receive other peers' email information
// Receive other peers' email/name information
socket.on("peer-info", (data) => {
    if (!data?.socketId || !data.email) return;
    // Save the real name from the DB!
    peerInfo[data.socketId] = { email: data.email, name: data.name || "Participant" };

    const label = document.getElementById(`peer-label-${data.socketId}`);
    if (label) {
        label.innerText = peerInfo[data.socketId].name; // Display name on video card
    }
    renderParticipantsList();
});

// Load face-api.js models
async function loadFaceAPI() {
    console.log("Loading face-api models...");
    await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
    console.log("Models loaded.");
}

// Get local media
async function initMedia() {
    console.log("Initializing media...");
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        setupVolumeMonitoring(localStream, localVideoContainer);
        if (cameraLoading) {
            cameraLoading.style.display = "none";
        }
    } catch (err) {
        console.error("Error accessing media devices:", err);
        alert(`Error accessing media devices: ${err.name} - ${err.message}`);
        if (cameraLoading) {
            cameraLoading.querySelector("p").textContent = "Camera error. Check permissions.";
        }
    }
}

// Face detection
async function detectFace() {
    if (!meetingActive) return;
    if (!localStream || !localVideo.srcObject || localVideo.paused || localVideo.ended || !faceapi.nets.tinyFaceDetector.params) {
        return;
    }
    const detections = await faceapi.detectAllFaces(localVideo, new faceapi.TinyFaceDetectorOptions());
    if (detections.length > 0 && detections[0].score) {
        const engagement = (detections[0].score * 100).toFixed(2);
        engagementDiv.innerText = `Engagement: ${engagement}%`;
    } else {
        engagementDiv.innerText = "Engagement: 0%";
    }
}

function createPeerConnection(socketId, isCaller) {
    const pc = new RTCPeerConnection({
        iceServers: [
            // Multiple Google STUN servers for better IP resolution
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },

            // TURN server on standard port 80
            {
                urls: "turn:openrelay.metered.ca:80",
                username: "openrelayproject",
                credential: "openrelayproject"
            },
            // TURN server on port 443 (Bypasses most strict firewalls!)
            {
                urls: "turn:openrelay.metered.ca:443",
                username: "openrelayproject",
                credential: "openrelayproject"
            },
            {
                urls: "turn:openrelay.metered.ca:443?transport=tcp",
                username: "openrelayproject",
                credential: "openrelayproject"
            }
        ]
    });

    // 🔍 DEBUG CONNECTION STATES
    pc.onconnectionstatechange = () => {
        console.log("Connection state with", socketId, ":", pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
        console.log("ICE state:", pc.iceConnectionState);
        if (pc.iceConnectionState === "failed") {
            console.log("ICE failed — restarting");
            pc.restartIce();
        }
    };

    pc.onicecandidate = event => {
        if (event.candidate) {
            socket.emit("ice-candidate", { candidate: event.candidate, socketId: socketId });
        }
    };

    pc.ontrack = event => {
        const stream = event.streams[0];
        let remoteVideo = document.getElementById(`video-${socketId}`);

        // If the primary camera card doesn't exist yet, build it!
        if (!remoteVideo) {
            remoteVideo = document.createElement('video');
            remoteVideo.id = `video-${socketId}`;
            remoteVideo.autoplay = true;
            remoteVideo.playsinline = true;
            remoteVideo.setAttribute('data-stream-id', stream.id); // Tag it so we remember which stream is the camera

            const videoContainer = document.createElement('div');
            videoContainer.id = `video-container-${socketId}`;
            videoContainer.classList.add('video-container', 'group');
            videoContainer.appendChild(remoteVideo);

            const nameOverlay = document.createElement('div');
            nameOverlay.id = `peer-label-${socketId}`;
            nameOverlay.classList.add(
                'absolute', 'bottom-3', 'left-3',
                'bg-black/50', 'backdrop-blur-md',
                'text-white', 'text-xs', 'font-medium',
                'px-3', 'py-1.5', 'rounded-md', 'shadow-sm'
            );
            const info = peerInfo[socketId];
            nameOverlay.innerText = info?.email || `Peer ${socketId.substring(0, 5)}`;
            videoContainer.appendChild(nameOverlay);

            const makeHostBtn = document.createElement('button');
            makeHostBtn.id = `make-host-${socketId}`;
            makeHostBtn.innerText = "Make Host";
            makeHostBtn.className = `make-host-btn absolute top-2 right-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-[10px] font-bold px-2 py-1 rounded-md shadow-md transition-all z-10 ${isMeetingHost ? '' : 'hidden'}`;
            makeHostBtn.onclick = () => {
                const targetEmail = peerInfo[socketId]?.email || 'this participant';
                if (confirm(`Transfer host role to ${targetEmail}? You will become a regular participant.`)) {
                    const meetingId = new URLSearchParams(window.location.search).get("meetingId");
                    socket.emit("manual-transfer-host", { targetSocketId: socketId, meetingId });
                    isMeetingHost = false;
                    updateHostUI();
                    showToast(`Host role transferred to ${targetEmail}`);
                }
            };
            videoContainer.appendChild(makeHostBtn);
            remoteVideosContainer.appendChild(videoContainer);

            console.log("Camera track received from", socketId);

        } else if (remoteVideo.getAttribute('data-stream-id') !== stream.id) {
            // A SECOND STREAM HAS ARRIVED! This is the screenshare!
            console.log("Secondary screen track received from", socketId);

            // Check if the massive screen card was already created by the socket event
            const massiveCard = document.getElementById(`remote-screen-${socketId}`);
            if (massiveCard) {
                const vid = massiveCard.querySelector('video');
                if (vid) vid.srcObject = stream;
            } else {
                // If the WebRTC stream arrived faster than the socket, hold it in a hidden tag
                const tempVid = document.createElement('video');
                tempVid.id = `temp-stream-${socketId}`;
                tempVid.className = 'hidden';
                tempVid.srcObject = stream;
                document.body.appendChild(tempVid);
            }
            return; // Stop here! Do NOT overwrite the camera video source!
        }

        // Apply stream to the primary camera card
        if (remoteVideo.srcObject !== stream) {
            remoteVideo.srcObject = stream;
        }

        remoteVideo.play().catch(err => console.warn("Autoplay blocked:", err));

        if (event.track.kind === 'audio') {
            const remoteStream = new MediaStream([event.track]);
            setupVolumeMonitoring(remoteStream, document.getElementById(`video-container-${socketId}`));
        }
    };
    peerConnections[socketId] = pc;

    // Add local tracks to the peer connection
    const addLocalTracks = () => {
        if (localStream) {
            localStream.getTracks().forEach(track => {
                const senders = pc.getSenders();
                const trackExists = senders.some(sender => sender.track === track);
                if (!trackExists) {
                    pc.addTrack(track, localStream);
                }
            });
        }
    };

    // Ensure tracks are added before creating offer
    addLocalTracks();

    if (isCaller) {
        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
                socket.emit("offer", {
                    offer: pc.localDescription,
                    socketId: socketId
                });
            })
            .catch(err => console.error("Error creating offer:", err));
    }

    return pc;
}

socket.on("new-peer", ({ socketId }) => {
    if (!localStream) return;

    if (!peerConnections[socketId]) {
        // EXISTING user should NOT create offer
        createPeerConnection(socketId, false);
    }
});


// Receive existing peers when joining and create connections to them
socket.on("existing-peers", ({ peerIds }) => {

    const connectPeers = () => {
        peerIds.forEach(socketId => {
            if (!peerConnections[socketId]) {
                createPeerConnection(socketId, true);
            }
        });
    };

    if (localStream) {
        connectPeers();
    } else {
        const interval = setInterval(() => {
            if (localStream) {
                clearInterval(interval);
                connectPeers();
            }
        }, 100);
    }
});


// --- NEW HELPER FUNCTION TO PROCESS QUEUED CANDIDATES ---
async function processIceQueue(socketId, pc) {
    if (iceCandidateQueues[socketId]) {
        for (const candidate of iceCandidateQueues[socketId]) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                console.error("Error adding queued ICE candidate:", err);
            }
        }
        delete iceCandidateQueues[socketId]; // Clear the queue after processing
    }
}

socket.on("offer", async data => {
    let pc = peerConnections[data.socketId];

    if (!pc) {
        pc = createPeerConnection(data.socketId, false);
    }

    try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

        // Process any ICE candidates that arrived before the offer
        await processIceQueue(data.socketId, pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("answer", {
            answer: pc.localDescription,
            socketId: data.socketId
        });
    } catch (err) {
        console.error("Error handling offer:", err);
    }
});

socket.on("answer", async data => {
    console.log("Received answer from:", data.socketId);
    const pc = peerConnections[data.socketId];
    if (pc) {
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));

            // Process any ICE candidates that arrived before the answer
            await processIceQueue(data.socketId, pc);
        } catch (err) {
            console.error("Error setting remote description for answer:", err);
        }
    }
});

socket.on("ice-candidate", async data => {
    console.log("Received ICE candidate from:", data.socketId);
    const pc = peerConnections[data.socketId];
    if (pc && data.candidate) {
        if (pc.remoteDescription) {
            // Connection is ready, add it immediately
            try {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (err) {
                console.error("Error adding ICE candidate:", err);
            }
        } else {
            // Connection is NOT ready, queue it up!
            if (!iceCandidateQueues[data.socketId]) {
                iceCandidateQueues[data.socketId] = [];
            }
            iceCandidateQueues[data.socketId].push(data.candidate);
        }
    }
});

socket.on("peer-disconnected", async data => {
    if (!meetingActive) return; // Already cleaned up
    console.log("Peer disconnected:", data.socketId);

    // Fix: Added meetingDate to prevent 400 Bad Request
    const meetingId = new URLSearchParams(window.location.search).get("meetingId");
    const ctx = hostContext || getOrPromptHostContext();
    const meetingDate = ctx?.meetingDate || new Date().toISOString().slice(0, 10);
    const peerEmail = peerInfo[data.socketId]?.email;

    if (peerEmail) {
        try {
            const response = await fetch("/api/participants", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    meetingId,
                    participantEmail: peerEmail,
                    socketId: data.socketId,
                    meetingDate: meetingDate, // <-- Missing field added here
                    action: "leave"
                })
            });
            const result = await response.json();
            if (result.ok) {
                console.log("✅ Peer leave saved:", peerEmail);
            }
        } catch (err) {
            console.error("Error saving peer leave:", err);
        }
    }

    const pc = peerConnections[data.socketId];
    if (pc) {
        pc.close();
        delete peerConnections[data.socketId];
    }
    delete peerInfo[data.socketId];
    delete iceCandidateQueues[data.socketId]; // Clean up queue memory

    const remoteVideoContainer = document.getElementById(`video-container-${data.socketId}`);
    if (remoteVideoContainer) {
        remoteVideoContainer.remove();
    }
    setTimeout(renderParticipantsList, 100);
});

// --- NEW LEAVE & HOST LOGIC ---

const leaveModal = document.getElementById("leaveModal");
const hostOptions = document.getElementById("hostOptions");
const guestOptions = document.getElementById("guestOptions");
const postCallScreen = document.getElementById("postCallScreen");
const rejoinBtn = document.getElementById("rejoinBtn");
const goHomeBtn = document.getElementById("goHomeBtn");

// 1. Show the warning modal when Leave is clicked
leaveBtn.onclick = () => {
    leaveModal.classList.remove("hidden");
    if (isMeetingHost) {
        hostOptions.classList.remove("hidden");
        hostOptions.classList.add("flex");
    } else {
        guestOptions.classList.remove("hidden");
        guestOptions.classList.add("flex");
    }
};

// 2. Cancel Leave
document.getElementById("cancelLeaveBtn").onclick = () => {
    leaveModal.classList.add("hidden");
    hostOptions.classList.add("hidden");
    guestOptions.classList.add("hidden");
};

// 3. Guest confirms leave
document.getElementById("confirmLeaveBtn").onclick = () => {
    executeLeave(false); // Guest just leaves
};

// 4. Host leaves but keeps meeting active
document.getElementById("leaveOnlyBtn").onclick = async () => {
    const meetingId = new URLSearchParams(window.location.search).get("meetingId");
    if (isMeetingHost) {
        await flushTranscriptChunkBeforeEnd();
    }
    socket.emit("transfer-host", { meetingId }); // Pass the baton
    executeLeave(false);
};

// 5. Host ENDS the call for everyone
document.getElementById("endCallBtn").onclick = async () => {
    const meetingId = new URLSearchParams(window.location.search).get("meetingId");
    if (isMeetingHost) {
        await flushTranscriptChunkBeforeEnd();
    }
    socket.emit("end-meeting", { meetingId });
    executeLeave(true);
};

// 6. Navigation Buttons on the Post-Call Screen
rejoinBtn.onclick = () => window.location.reload();
goHomeBtn.onclick = () => window.location.href = "/";

// 7. Core cleanup function
let leaveExecuted = false; // simple one-shot flag, never reset
function executeLeave(isMeetingEndedByHost) {
    if (leaveExecuted) return; // Prevent double-execution
    leaveExecuted = true;
    meetingActive = false; // Stop all background loops

    leaveModal.classList.add("hidden"); // Hide warning

    // Save participant leave time to DB
    const meetingId = new URLSearchParams(window.location.search).get("meetingId");
    const ctx = hostContext || getOrPromptHostContext();
    if (ctx?.email && socket.id) {
        fetch("/api/participants", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                meetingId, participantEmail: ctx.email, socketId: socket.id,
                meetingDate: ctx?.meetingDate || new Date().toISOString().slice(0, 10),
                action: "leave"
            })
        }).catch(err => console.error(err));
    }

    // Shut down camera and connections
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (audioContext) {
        try { audioContext.close(); } catch (e) { }
        audioContext = null;
    }
    for (const socketId in peerConnections) {
        if (peerConnections[socketId]) {
            peerConnections[socketId].close();
            delete peerConnections[socketId];
        }
    }
    const remoteVideosContainer = document.getElementById('remote-videos');
    if (remoteVideosContainer) remoteVideosContainer.innerHTML = '';

    const localVideo = document.getElementById("localVideo");
    if (localVideo) localVideo.srcObject = null;
    try { socket.disconnect(); } catch (e) { }

    // Show Post-Call Screen
    const postCallScreen = document.getElementById("postCallScreen");
    const rejoinBtn = document.getElementById("rejoinBtn");

    if (postCallScreen) postCallScreen.classList.remove("hidden");

    if (isMeetingEndedByHost) {
        document.getElementById("postCallTitle").innerText = "Meeting Ended";
        document.getElementById("postCallSubtitle").innerText = "The host has ended this meeting for everyone.";
        if (rejoinBtn) rejoinBtn.classList.add("hidden"); // No rejoining allowed
    } else {
        document.getElementById("postCallTitle").innerText = "You left the meeting";
        document.getElementById("postCallSubtitle").innerText = "The meeting is still ongoing.";
        if (rejoinBtn) rejoinBtn.classList.remove("hidden"); // Rejoin is allowed
    }
}

// 8. Listeners for host actions happening to US
socket.on("meeting-force-ended", () => {
    // If we receive this, the host killed the call. Force us out.
    executeLeave(true);
});

socket.on("you-are-new-host", () => {
    isMeetingHost = true;
    showToast("You are now the meeting host.");
    updateHostUI(); // Reveals the "Make Host" buttons on your screen
    setTimeout(() => {
        startAutoTranscript();
    }, 500);
});




muteBtn.onclick = () => {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        localVideoContainer.classList.toggle('is-muted', !audioTrack.enabled);

        // --> ADD THIS: Tell others we muted/unmuted
        const meetingId = new URLSearchParams(window.location.search).get("meetingId");
        socket.emit('media-state', { meetingId, video: localStream.getVideoTracks()[0]?.enabled, audio: audioTrack.enabled });

        muteBtn.innerHTML = audioTrack.enabled
            ? `<svg class="size-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14q.825 0 1.413-.588T14 12V6q0-.825-.588-1.413T12 4q-.825 0-1.413.588T10 6v6q0 .825.588 1.413T12 14Zm-1 7v-3.075q-2.6-.35-4.3-2.325T5 11H7q0 2.075 1.463 3.538T12 16q2.075 0 3.538-1.463T17 11h2q0 2.5-1.7 4.475T13 17.925V21h-2Zm1-6q.425 0 .713-.288T13 12V6q0-.425-.288-.713T12 5q-.425 0-.713.288T11 6v6q0 .425.288.713T12 8Z"/></svg>`
            : `<svg class="size-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="m14.825 16.25-2.1-2.1q.275-.275.425-.625t.15-.725V6q0-.825-.588-1.413T12 4q-.825 0-1.413.588T10 6v4.175l-1.8-1.8H7q0 2.5 1.7 4.475T13 17.925V21h-2v-3.075q-.525-.075-1.025-.25t-.975-.425l-1.425 1.425q1.15.8 2.425 1.287T12 20q2.925 0 5.213-1.763T19 13.15V11h-2v.15q0 .825-.363 1.563t-.987 1.287ZM21.9 21.9 20.5 23.3l-4.5-4.5q-1.05.7-2.25 1.05T11.5 20.5v-2.05q.4-.05.775-.175t.725-.325L12 16.5l-2.625-2.625L3.5 18.05l-1.4-1.4L7.95 10.8l-3.1-3.1L3.45 6.3 2.05 4.9 3.45 3.5l18.45 18.4Z"/></svg>`;
    }
};

cameraBtn.onclick = () => {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        localVideoContainer.classList.toggle('camera-off', !videoTrack.enabled);

        // --> ADD THIS: Tell others we turned camera on/off
        const meetingId = new URLSearchParams(window.location.search).get("meetingId");
        socket.emit('media-state', { meetingId, video: videoTrack.enabled, audio: localStream.getAudioTracks()[0]?.enabled });

        cameraBtn.innerHTML = videoTrack.enabled
            ? `<svg class="size-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l2.29 2.29c.63.63 1.71.18 1.71-.71V8.91c0-.89-1.08-1.34-1.71-.71L17 10.5zM15 16H5V8h10v8z"/></svg>`
            : `<svg class="size-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l2.29 2.29c.63.63 1.71.18 1.71-.71V8.91c0-.89-1.08-1.34-1.71-.71L17 10.5zM15 16H5V8h10v8zM2 2.27L4.28 4.55l-1.73 1.73L1 7.83V19c0 .55.45 1 1 1h13.17l2.55 2.55L18.27 24l-16-16L2.27 2z"/></svg>`;
    }
};

function setupVolumeMonitoring(stream, targetElement) {
    if (!audioContext) {
        audioContext = new AudioContext();
    }
    if (stream.getAudioTracks().length === 0) return;

    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.minDecibels = -100;
    analyser.maxDecibels = 0;
    analyser.smoothingTimeConstant = 0.85;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function getVolume() {
        if (!meetingActive) return;
        try {
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            dataArray.forEach(value => sum += value);
            const avg = sum / dataArray.length;
            const volume = 20 * Math.log10(avg / 255);

            if (targetElement && targetElement.isConnected) {
                if (volume > speakingThreshold) {
                    targetElement.classList.add('is-speaking');
                } else {
                    targetElement.classList.remove('is-speaking');
                }
            }
        } catch (e) {
            return; // Audio node destroyed, stop loop
        }
        if (meetingActive) requestAnimationFrame(getVolume);
    }
    getVolume();
}

// ═══════════════════════════════════════════════════════════
// SETTINGS SYSTEM — CLIENT SIDE
// ═══════════════════════════════════════════════════════════

const settingsMenuBtn    = document.getElementById("settingsMenuBtn");
const admitToggleBtn     = document.getElementById("admitToggleBtn");
const admitToggleThumb   = document.getElementById("admitToggleThumb");
const admitStatusDot     = document.getElementById("admitStatusDot");
const admitStatusLabel   = document.getElementById("admitStatusLabel");

// Local mirror of the meeting settings (updated by server broadcast)
let meetingSettings = { lobbyEnabled: true };

// Apply settings state to the toggle UI
function applySettingsUI(settings) {
    meetingSettings = { ...meetingSettings, ...settings };
    const on = !!meetingSettings.lobbyEnabled;

    if (admitToggleBtn) {
        admitToggleBtn.setAttribute("aria-checked", String(on));
        // Toggle colour: blue when ON, grey when OFF
        admitToggleBtn.classList.toggle("bg-[#8ab4f8]", on);
        admitToggleBtn.classList.toggle("bg-[#3c4043]", !on);
    }
    if (admitToggleThumb) {
        // Slide right when ON, left when OFF
        admitToggleThumb.classList.toggle("translate-x-5", on);
        admitToggleThumb.classList.toggle("translate-x-0", !on);
    }
    if (admitStatusDot) {
        admitStatusDot.classList.toggle("bg-emerald-400", on);
        admitStatusDot.classList.toggle("animate-pulse", on);
        admitStatusDot.classList.toggle("bg-slate-500", !on);
    }
    if (admitStatusLabel) {
        admitStatusLabel.innerHTML = on
            ? `Lobby <strong class="text-emerald-400">enabled</strong> — participants must be admitted`
            : `Lobby <strong class="text-rose-400">disabled</strong> — anyone can join directly`;
    }
}

// Host toggles the switch
if (admitToggleBtn) {
    admitToggleBtn.addEventListener("click", () => {
        if (!isMeetingHost) return;
        const meetingId = new URLSearchParams(window.location.search).get("meetingId");
        const newValue = !meetingSettings.lobbyEnabled;
        socket.emit("update-meeting-settings", { meetingId, settings: { lobbyEnabled: newValue } });
        // Optimistic update (server will confirm / broadcast)
        applySettingsUI({ lobbyEnabled: newValue });
        showToast(newValue ? "Lobby enabled — users must be admitted" : "Lobby disabled — anyone can join");
    });
}

// Server broadcasts settings (on join or after host changes them)
socket.on("meeting-settings", (settings) => {
    applySettingsUI(settings);
});

// ═══════════════════════════════════════════════════════════
// LOBBY SYSTEM — CLIENT SIDE
// ═══════════════════════════════════════════════════════════

// Lobby state (host side)
const lobbyQueue = new Map(); // socketId -> { name, email }
let currentKnockSocketId = null;
let currentKnockMeetingId = null;

// DOM references for lobby
const lobbyWaitingScreen  = document.getElementById("lobbyWaitingScreen");
const lobbyMeetingNameTxt = document.getElementById("lobbyMeetingNameText");
const lobbyStatusText     = document.getElementById("lobbyStatusText");
const leaveLobbyBtn       = document.getElementById("leaveLobbyBtn");
const knockNotification   = document.getElementById("knockNotification");
const knockPersonName     = document.getElementById("knockPersonName");
const knockPersonEmail    = document.getElementById("knockPersonEmail");
const knockAdmitBtn       = document.getElementById("knockAdmitBtn");
const knockDenyBtn        = document.getElementById("knockDenyBtn");
const knockDismissBtn     = document.getElementById("knockDismissBtn");
const viewAllWaitingBtn   = document.getElementById("viewAllWaitingBtn");
const lobbyMenuBtn        = document.getElementById("lobbyMenuBtn");
const lobbyBadge          = document.getElementById("lobbyBadge");
const lobbyList           = document.getElementById("lobbyList");
const lobbyEmptyState     = document.getElementById("lobbyEmptyState");
const admitAllWrapper     = document.getElementById("admitAllWrapper");
const admitAllBtn         = document.getElementById("admitAllBtn");

// Show the knock notification popup (host)
function showKnockPopup(socketId, name, email, meetingId) {
    currentKnockSocketId = socketId;
    currentKnockMeetingId = meetingId;
    if (knockPersonName)  knockPersonName.innerText  = name;
    if (knockPersonEmail) knockPersonEmail.innerText = email;
    if (knockNotification) {
        knockNotification.classList.remove("hidden");
        requestAnimationFrame(() => {
            knockNotification.classList.remove("translate-y-4", "opacity-0");
            knockNotification.classList.add("translate-y-0", "opacity-100");
        });
    }
}

function hideKnockPopup() {
    if (!knockNotification) return;
    knockNotification.classList.add("translate-y-4", "opacity-0");
    knockNotification.classList.remove("translate-y-0", "opacity-100");
    setTimeout(() => knockNotification.classList.add("hidden"), 300);
    currentKnockSocketId = null;
}

function updateLobbyBadge() {
    if (!lobbyBadge) return;
    const count = lobbyQueue.size;
    lobbyBadge.textContent = count;
    if (count > 0) {
        lobbyBadge.classList.remove("hidden");
    } else {
        lobbyBadge.classList.add("hidden");
    }
}

function renderLobbyPanel() {
    if (!lobbyList) return;
    updateLobbyBadge();
    const hasPeople = lobbyQueue.size > 0;
    if (admitAllWrapper) admitAllWrapper.classList.toggle("hidden", !hasPeople);
    if (lobbyEmptyState)  lobbyEmptyState.classList.toggle("hidden", hasPeople);

    Array.from(lobbyList.children).forEach(child => {
        if (child.id !== "lobbyEmptyState") child.remove();
    });

    lobbyQueue.forEach((info, socketId) => {
        const card = document.createElement("div");
        card.id = `lobby-card-${socketId}`;
        card.className = "lobby-card-enter bg-[#28292c] border border-white/10 rounded-xl p-3.5 flex items-center gap-3";
        card.innerHTML = `
          <div class="shrink-0 size-9 rounded-full bg-[#8ab4f8]/10 border border-[#8ab4f8]/20 flex items-center justify-center">
            <svg class="size-4 text-[#8ab4f8]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-white truncate">${info.name}</p>
            <p class="text-xs text-slate-500 truncate">${info.email}</p>
          </div>
          <div class="flex gap-1.5 shrink-0">
            <button data-action="deny" data-id="${socketId}"
              class="px-3 py-1.5 rounded-lg bg-[#3c4043] hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 text-xs font-bold transition-all border border-white/5">
              Deny
            </button>
            <button data-action="admit" data-id="${socketId}"
              class="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-900 text-xs font-bold transition-colors shadow-sm">
              Admit
            </button>
          </div>`;

        card.querySelectorAll("button[data-action]").forEach(btn => {
            btn.addEventListener("click", () => {
                const action = btn.dataset.action;
                const id     = btn.dataset.id;
                const mid = new URLSearchParams(window.location.search).get("meetingId");
                if (action === "admit") {
                    socket.emit("admit-user", { targetSocketId: id, meetingId: mid });
                } else {
                    socket.emit("deny-user", { targetSocketId: id, meetingId: mid });
                }
            });
        });

        lobbyList.insertBefore(card, lobbyEmptyState || null);
    });
}

// HOST: someone joined the lobby
socket.on("lobby-user-waiting", ({ socketId, name, email }) => {
    const meetingId = new URLSearchParams(window.location.search).get("meetingId");
    lobbyQueue.set(socketId, { name, email });
    renderLobbyPanel();
    if (lobbyMenuBtn) lobbyMenuBtn.classList.remove("hidden");
    showKnockPopup(socketId, name, email, meetingId);
    showToast(`${name} is waiting to join`);
});

// HOST: someone left the lobby
socket.on("lobby-user-left", ({ socketId }) => {
    const info = lobbyQueue.get(socketId);
    lobbyQueue.delete(socketId);
    renderLobbyPanel();
    if (currentKnockSocketId === socketId) hideKnockPopup();
    if (info) showToast(`${info.name} left the lobby`);
    if (lobbyQueue.size === 0 && lobbyMenuBtn) lobbyMenuBtn.classList.add("hidden");
});

// HOST: knock popup buttons
if (knockAdmitBtn) {
    knockAdmitBtn.onclick = () => {
        const meetingId = new URLSearchParams(window.location.search).get("meetingId");
        if (currentKnockSocketId) {
            socket.emit("admit-user", { targetSocketId: currentKnockSocketId, meetingId });
            hideKnockPopup();
        }
    };
}
if (knockDenyBtn) {
    knockDenyBtn.onclick = () => {
        const meetingId = new URLSearchParams(window.location.search).get("meetingId");
        if (currentKnockSocketId) {
            socket.emit("deny-user", { targetSocketId: currentKnockSocketId, meetingId });
            hideKnockPopup();
        }
    };
}
if (knockDismissBtn) { knockDismissBtn.onclick = hideKnockPopup; }
if (viewAllWaitingBtn) {
    viewAllWaitingBtn.onclick = () => {
        hideKnockPopup();
        document.querySelectorAll(".menu-tab-btn[data-target='panelLobby']").forEach(b => b.click());
    };
}

// HOST: admit all
if (admitAllBtn) {
    admitAllBtn.onclick = () => {
        const meetingId = new URLSearchParams(window.location.search).get("meetingId");
        lobbyQueue.forEach((_, socketId) => {
            socket.emit("admit-user", { targetSocketId: socketId, meetingId });
        });
        lobbyQueue.clear();
        hideKnockPopup();
        renderLobbyPanel();
    };
}

// HOST: after admitting, clean up local queue
socket.on("participant-admitted", ({ name }) => {
    showToast(`${name} joined the meeting`);
    for (const [sid, info] of lobbyQueue.entries()) {
        if (info.name === name) { lobbyQueue.delete(sid); break; }
    }
    renderLobbyPanel();
    if (lobbyQueue.size === 0 && lobbyMenuBtn) lobbyMenuBtn.classList.add("hidden");
});

// PARTICIPANT: placed in lobby by server
socket.on("placed-in-lobby", ({ reason, meetingName }) => {
    if (lobbyWaitingScreen) lobbyWaitingScreen.classList.remove("hidden");
    if (lobbyMeetingNameTxt) {
        lobbyMeetingNameTxt.innerText = meetingName
            ? `Waiting to join "${meetingName}"`
            : "The host will let you in soon.";
    }
    if (lobbyStatusText) {
        lobbyStatusText.innerText = reason === "no-host"
            ? "Waiting for the host to join…"
            : "Waiting for host to admit you…";
    }
});

// PARTICIPANT: admitted into meeting
socket.on("admitted-to-meeting", () => {
    if (lobbyWaitingScreen) lobbyWaitingScreen.classList.add("hidden");
    showToast("You've been admitted to the meeting!");
    meetingActive = true;
    setInterval(detectFace, 1000);
});

// PARTICIPANT: denied by host
socket.on("denied-from-meeting", () => {
    if (lobbyWaitingScreen) lobbyWaitingScreen.classList.add("hidden");
    const pcs = document.getElementById("postCallScreen");
    const pct = document.getElementById("postCallTitle");
    const pcsub = document.getElementById("postCallSubtitle");
    const rej = document.getElementById("rejoinBtn");
    if (pct)   pct.innerText  = "Access Denied";
    if (pcsub) pcsub.innerText = "The host did not admit you to this meeting.";
    if (rej)   rej.classList.add("hidden");
    if (pcs)   pcs.classList.remove("hidden");
});

// PARTICIPANT: leave lobby button
if (leaveLobbyBtn) {
    leaveLobbyBtn.onclick = () => {
        if (lobbyWaitingScreen) lobbyWaitingScreen.classList.add("hidden");
        socket.disconnect();
        const pcs  = document.getElementById("postCallScreen");
        const pct  = document.getElementById("postCallTitle");
        const pcsub = document.getElementById("postCallSubtitle");
        const rej  = document.getElementById("rejoinBtn");
        if (pct)   pct.innerText  = "You left the lobby";
        if (pcsub) pcsub.innerText = "You chose to leave before being admitted.";
        if (rej)   rej.classList.remove("hidden");
        if (pcs)   pcs.classList.remove("hidden");
    };
}

async function main() {
    try {
        const meRes = await fetch("/api/auth/me");
        const meData = await meRes.json().catch(() => ({}));
        if (!meRes.ok || !meData.ok || !meData.user) {
            window.location.href = "/";
            return;
        }
        currentUser = meData.user;
        hostContext.email = currentUser.email;
        hostContext.meetingDate = new Date().toISOString().slice(0, 10);
    } catch {
        window.location.href = "/";
        return;
    }

    await loadFaceAPI();
    await initMedia();

    const meetingId = initializeMeetingId();
    if (!meetingId) return;

    let meetingInfo = null;
    try {
        const meetingRes = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}`);
        const meetingData = await meetingRes.json().catch(() => ({}));
        if (!meetingRes.ok || !meetingData.ok) {
            alert(meetingData.error || "Meeting not found or inaccessible.");
            window.location.href = "/dashboard";
            return;
        }
        meetingInfo = meetingData;
        isMeetingHost = !!meetingData.isHost;
        updateHostUI();

        // Show lobby panel and settings menu item immediately for the host
        if (isMeetingHost && lobbyMenuBtn) {
            lobbyMenuBtn.classList.remove("hidden");
        }
        if (isMeetingHost && settingsMenuBtn) {
            settingsMenuBtn.classList.remove("hidden");
        }
    } catch {
        alert("Unable to load meeting details.");
        window.location.href = "/dashboard";
        return;
    }

    const ctx = hostContext;
    const meetingDate = ctx?.meetingDate || new Date().toISOString().slice(0, 10);

    socket.emit("join-meeting", { meetingId });

    if (ctx?.email) {
        socket.emit("host-info", {
            email: ctx.email,
            meetingId,
            meetingDate,
            isHost: isMeetingHost
        });
    }

    // Hosts enter the meeting immediately; participants wait for admitted-to-meeting
    if (isMeetingHost) {
        meetingActive = true;
        setInterval(detectFace, 1000);
    }

    // --- Populate Meeting Details Tab & Local Labels ---
    const localLabel = document.getElementById("local-user-label");
    if (localLabel && currentUser) {
        localLabel.innerText = currentUser.name + " (You)";
    }
    renderParticipantsList();

    if (meetingInfo) {
        const meetingNameEl = document.getElementById("detailsMeetingName");
        const meetingDescEl = document.getElementById("detailsMeetingDesc");
        const meetingIdEl   = document.getElementById("detailsMeetingId");
        const joinLinkEl    = document.getElementById("detailsJoinLink");
        const copyLinkBtn   = document.getElementById("copyLinkBtn");

        if (meetingNameEl) meetingNameEl.innerText = meetingInfo.meeting.meetingName || "Meeting";
        if (meetingDescEl) meetingDescEl.innerText = meetingInfo.meeting.description || "No description provided.";
        if (meetingIdEl)   meetingIdEl.innerText   = meetingId;

        if (joinLinkEl) {
            const shareOrigin = await getPreferredShareOrigin();
            joinLinkEl.value = shareOrigin + "/meeting?meetingId=" + meetingId;
        }

        if (copyLinkBtn && joinLinkEl) {
            copyLinkBtn.onclick = async () => {
                await navigator.clipboard.writeText(joinLinkEl.value);
                copyLinkBtn.innerText = "Copied!";
                copyLinkBtn.classList.replace("bg-[#8ab4f8]", "bg-green-500");
                copyLinkBtn.classList.replace("text-slate-900", "text-white");
                setTimeout(() => {
                    copyLinkBtn.innerText = "Copy Meeting Link";
                    copyLinkBtn.classList.replace("bg-green-500", "bg-[#8ab4f8]");
                    copyLinkBtn.classList.replace("text-white", "text-slate-900");
                }, 2000);
            };
        }
    }

    // Start automatic transcript capture for host
    if (canCaptureTranscriptAudio()) {
        setTimeout(() => {
            startAutoTranscript();
        }, 2000);
    }
}




main();

// -------------------------
// Stats (per-peer, non-intrusive)
// -------------------------
const prevSnapshots = {}; // { socketId: { timestamp, audio:{bytesReceived,packetsReceived,packetsLost}, video:{bytesReceived,packetsReceived,packetsLost,framesDecoded} } }

function toKbps(bytesDelta, msDelta) {
    if (msDelta <= 0) return 0;
    return Math.round((bytesDelta * 8) / msDelta);
}

async function collectPeerStats(socketId, pc) {
    const now = Date.now();
    const snapshot = prevSnapshots[socketId] || { timestamp: 0, audio: { bytesReceived: 0, packetsReceived: 0, packetsLost: 0 }, video: { bytesReceived: 0, packetsReceived: 0, packetsLost: 0, framesDecoded: 0 } };

    const reports = await pc.getStats();
    let inboundAudio;
    let inboundVideo;
    let remoteInboundAudio; // how peer perceives our outbound audio
    let remoteInboundVideo; // how peer perceives our outbound video
    let rttMs = null;
    let outKbps = null;
    let inKbps = null;

    reports.forEach(report => {
        if (report.type === 'inbound-rtp') {
            if (report.kind === 'audio') inboundAudio = report;
            if (report.kind === 'video') inboundVideo = report;
        }
        if (report.type === 'remote-inbound-rtp') {
            if (report.kind === 'audio') remoteInboundAudio = report;
            if (report.kind === 'video') remoteInboundVideo = report;
        }
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
            if (typeof report.currentRoundTripTime === 'number') rttMs = Math.round(report.currentRoundTripTime * 1000);
            if (typeof report.availableOutgoingBitrate === 'number') outKbps = Math.round(report.availableOutgoingBitrate / 1000);
            if (typeof report.availableIncomingBitrate === 'number') inKbps = Math.round(report.availableIncomingBitrate / 1000);
        }
    });

    const msDelta = snapshot.timestamp ? (now - snapshot.timestamp) : 1000;

    // Audio deltas
    const aBytes = inboundAudio?.bytesReceived || 0;
    const aPkts = inboundAudio?.packetsReceived || 0;
    const aLost = inboundAudio?.packetsLost || 0;
    const aJitterMs = typeof inboundAudio?.jitter === 'number' ? Math.round(inboundAudio.jitter * 1000) : null;
    const aBytesDelta = Math.max(0, aBytes - snapshot.audio.bytesReceived);
    const aPktsDelta = Math.max(0, aPkts - snapshot.audio.packetsReceived);
    const aLostDelta = Math.max(0, aLost - snapshot.audio.packetsLost);
    const aBitrate = toKbps(aBytesDelta, msDelta);
    const aLossPct = (aLostDelta + aPktsDelta) > 0 ? Math.round((aLostDelta / (aLostDelta + aPktsDelta)) * 1000) / 10 : 0;

    // Video deltas
    const vBytes = inboundVideo?.bytesReceived || 0;
    const vPkts = inboundVideo?.packetsReceived || 0;
    const vLost = inboundVideo?.packetsLost || 0;
    const vJitterMs = typeof inboundVideo?.jitter === 'number' ? Math.round(inboundVideo.jitter * 1000) : null;
    const framesDecoded = inboundVideo?.framesDecoded || 0;
    const vBytesDelta = Math.max(0, vBytes - snapshot.video.bytesReceived);
    const vPktsDelta = Math.max(0, vPkts - snapshot.video.packetsReceived);
    const vLostDelta = Math.max(0, vLost - snapshot.video.packetsLost);
    const vBitrate = toKbps(vBytesDelta, msDelta);
    const vLossPct = (vLostDelta + vPktsDelta) > 0 ? Math.round((vLostDelta / (vLostDelta + vPktsDelta)) * 1000) / 10 : 0;
    const fps = snapshot.video.framesDecoded ? Math.max(0, Math.round((framesDecoded - snapshot.video.framesDecoded) * (1000 / msDelta))) : null;

    // Outbound as seen by peer
    const outAudioRttMs = typeof remoteInboundAudio?.roundTripTime === 'number' ? Math.round(remoteInboundAudio.roundTripTime * 1000) : null;
    const outAudioLossPct = typeof remoteInboundAudio?.fractionLost === 'number' ? Math.round(Math.max(0, Math.min(1, remoteInboundAudio.fractionLost)) * 100) : null;
    const outVideoRttMs = typeof remoteInboundVideo?.roundTripTime === 'number' ? Math.round(remoteInboundVideo.roundTripTime * 1000) : null;
    const outVideoLossPct = typeof remoteInboundVideo?.fractionLost === 'number' ? Math.round(Math.max(0, Math.min(1, remoteInboundVideo.fractionLost)) * 100) : null;

    // Resolution from the element
    const remoteEl = document.getElementById(`video-${socketId}`);
    const remoteWidth = remoteEl?.videoWidth || 0;
    const remoteHeight = remoteEl?.videoHeight || 0;

    // Save snapshot
    prevSnapshots[socketId] = {
        timestamp: now,
        audio: { bytesReceived: aBytes, packetsReceived: aPkts, packetsLost: aLost },
        video: { bytesReceived: vBytes, packetsReceived: vPkts, packetsLost: vLost, framesDecoded }
    };

    return { socketId, rttMs, outKbps, inKbps, aBitrate, aJitterMs, aLossPct, vBitrate, vJitterMs, vLossPct, fps, remoteWidth, remoteHeight, outAudioRttMs, outAudioLossPct, outVideoRttMs, outVideoLossPct };
}

setInterval(async () => {
    if (!statsDiv || !meetingActive) return;
    const ids = Object.keys(peerConnections);
    if (ids.length === 0) { statsDiv.innerHTML = ''; return; }
    const results = (await Promise.allSettled(ids.map(id => {
        const pc = peerConnections[id];
        if (!pc || pc.connectionState === 'closed') return null;
        return collectPeerStats(id, pc);
    }))).filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
    const lines = [];
    results.forEach(r => {
        const peerName = peerInfo[r.socketId]?.email || `Peer ${r.socketId.substring(0, 5)}`;
        lines.push(`<strong>${peerName}</strong>`);
        if (r.rttMs !== null) lines.push(`RTT: ${r.rttMs} ms`);
        if (r.outKbps !== null) lines.push(`Avail Out: ${r.outKbps} kbps`);
        if (r.inKbps !== null) lines.push(`Avail In: ${r.inKbps} kbps`);
        lines.push(`Audio: ${r.aBitrate} kbps${r.aJitterMs !== null ? `, jitter ${r.aJitterMs} ms` : ''}, loss ${r.aLossPct}%`);
        lines.push(`Video: ${r.vBitrate} kbps${r.vJitterMs !== null ? `, jitter ${r.vJitterMs} ms` : ''}, loss ${r.vLossPct}%${r.fps !== null ? `, FPS ${r.fps}` : ''}, res ${r.remoteWidth}x${r.remoteHeight}`);
        if (r.outAudioLossPct !== null || r.outAudioRttMs !== null || r.outVideoLossPct !== null || r.outVideoRttMs !== null) {
            lines.push(`Outbound (peer view): audio loss ${r.outAudioLossPct ?? '-'}%, rtt ${r.outAudioRttMs ?? '-'} ms; video loss ${r.outVideoLossPct ?? '-'}%, rtt ${r.outVideoRttMs ?? '-'} ms`);
        }
        lines.push('<br>');
    });
    statsDiv.innerHTML = lines.join('<br>');
}, 1000);

// ==========================================
// SMART GRID & ENGAGEMENT SHUFFLING LOGIC
// ==========================================

// Listen for peer media state changes
socket.on('peer-media-state', (data) => {
    if (!peerInfo[data.socketId]) peerInfo[data.socketId] = {};
    peerInfo[data.socketId].videoOn = data.video;
    peerInfo[data.socketId].audioOn = data.audio;
    updateGridLayout(); // Immediately apply sort
});

function getPeerScore(id) {
    let score = 0;
    const container = document.getElementById(`video-container-${id}`);

    // 1. Highest priority: Speaking right now
    if (container && container.classList.contains('is-speaking')) score += 1000;
    // 2. Medium priority: Video is ON
    if (peerInfo[id]?.videoOn !== false) score += 500;
    // 3. Low priority: Mic is unmuted (even if not speaking)
    if (peerInfo[id]?.audioOn !== false) score += 200;

    return score;
}

function updateGridLayout() {
    if (!remoteVideosContainer) return;
    const remoteContainers = Array.from(remoteVideosContainer.children);
    if (remoteContainers.length === 0) return;

    // Sort remote containers based on engagement score
    remoteContainers.sort((a, b) => {
        const idA = a.id.replace('video-container-', '');
        const idB = b.id.replace('video-container-', '');
        return getPeerScore(idB) - getPeerScore(idA); // Descending order
    });

    const MAX_VISIBLE_REMOTES = 2; // Local + 2 Remotes = 3 Total Visible Cards

    remoteContainers.forEach((container, index) => {
        // Clean up old overlay badges
        const oldOverlay = container.querySelector('.plus-n-overlay');
        if (oldOverlay) oldOverlay.remove();

        if (index < MAX_VISIBLE_REMOTES) {
            container.style.display = ''; // Show
            remoteVideosContainer.appendChild(container); // Reorder DOM based on sort!

            // If it's the 3rd total slot and there are hidden peers, add the badge
            if (index === MAX_VISIBLE_REMOTES - 1 && remoteContainers.length > MAX_VISIBLE_REMOTES) {
                const hiddenCount = remoteContainers.length - MAX_VISIBLE_REMOTES;
                const badge = document.createElement('div');
                badge.className = 'plus-n-overlay absolute bottom-3 right-3 bg-slate-900/80 px-3 py-1.5 rounded-md text-white text-sm font-bold backdrop-blur-md z-20 shadow-lg border border-white/10';
                badge.innerText = `+${hiddenCount} others`;
                badge.title = "Hidden participants will move to the front when they speak.";
                container.appendChild(badge);
            }
        } else {
            container.style.display = 'none'; // Hide overflow peers
            remoteVideosContainer.appendChild(container); // Keep them in sorted order in the DOM
        }
    });
}

// Run the shuffler constantly to react to volume changes
setInterval(() => { if (meetingActive) updateGridLayout(); }, 1500);

// Initial emit of our media state once connected
setTimeout(() => {
    const meetingId = new URLSearchParams(window.location.search).get("meetingId");
    if (localStream && meetingId) {
        socket.emit('media-state', {
            meetingId: meetingId,
            video: localStream.getVideoTracks()[0]?.enabled ?? true,
            audio: localStream.getAudioTracks()[0]?.enabled ?? true
        });
    }
}, 2000);



// ==========================================
// 3-DOT MENU & SIDEBAR TAB LOGIC
// ==========================================
const moreOptionsBtn = document.getElementById("moreOptionsBtn");
const moreOptionsMenu = document.getElementById("moreOptionsMenu");
const rightSidebar = document.getElementById("rightSidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");
const closeSidebarBtn = document.getElementById("closeSidebarBtn");
const sidebarTitle = document.getElementById("sidebarTitle");

const panels = {
    panelAi: document.getElementById("panelAi"),
    panelChat: document.getElementById("panelChat"),
    panelParticipants: document.getElementById("panelParticipants"),
    panelDetails: document.getElementById("panelDetails"),
    panelLobby: document.getElementById("panelLobby"),
    panelSettings: document.getElementById("panelSettings"),
};

// 1. Toggle the 3-Dot Menu
moreOptionsBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    moreOptionsMenu.classList.toggle("hidden");
    moreOptionsMenu.classList.toggle("flex");
});

// 2. Close menu when clicking outside of it
document.addEventListener("click", (e) => {
    if (moreOptionsMenu && !moreOptionsMenu.classList.contains("hidden") && !moreOptionsMenu.contains(e.target) && !moreOptionsBtn.contains(e.target)) {
        moreOptionsMenu.classList.add("hidden");
        moreOptionsMenu.classList.remove("flex");
    }
});

// 3. Handle clicking an option inside the popup menu
document.querySelectorAll(".menu-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-target");
        const newTitle = btn.getAttribute("data-title");

        // Update the header title
        if (sidebarTitle) sidebarTitle.innerText = newTitle;

        // Hide all panels, show the selected one
        Object.values(panels).forEach(panel => {
            if (panel) {
                panel.classList.add("hidden");
                panel.classList.remove("flex");
            }
        });
        const activePanel = panels[targetId];
        if (activePanel) {
            activePanel.classList.remove("hidden");
            if (targetId === "panelChat") activePanel.classList.add("flex");
        }

        // AUTO-OPEN THE SIDEBAR
        if (window.innerWidth < 768) {
            // Mobile
            if (rightSidebar) rightSidebar.classList.remove('translate-x-full');
            if (sidebarOverlay) {
                sidebarOverlay.classList.remove('hidden');
                setTimeout(() => sidebarOverlay.classList.remove('opacity-0'), 10);
            }
        } else {
            // Desktop
            if (rightSidebar) rightSidebar.classList.remove('sidebar-desktop-closed');
        }

        // Close the popup menu
        moreOptionsMenu.classList.add("hidden");
        moreOptionsMenu.classList.remove("flex");
    });
});

// 4. Close Sidebar Button Logic
closeSidebarBtn?.addEventListener("click", () => {
    if (window.innerWidth < 768) {
        // Mobile
        if (rightSidebar) rightSidebar.classList.add('translate-x-full');
        if (sidebarOverlay) {
            sidebarOverlay.classList.add('opacity-0');
            setTimeout(() => sidebarOverlay.classList.add('hidden'), 300);
        }
    } else {
        // Desktop
        if (rightSidebar) rightSidebar.classList.add('sidebar-desktop-closed');
    }
});

// Allow clicking the dark overlay on mobile to close the sidebar
sidebarOverlay?.addEventListener("click", () => closeSidebarBtn?.click());

// Render the Participants List dynamically
function renderParticipantsList() {
    const participantsList = document.getElementById("participantsList");
    if (!participantsList) return;
    participantsList.innerHTML = "";

    // Show host controls block only for the host
    const hostControls = document.getElementById("hostParticipantControls");
    if (hostControls) {
        if (isMeetingHost) {
            hostControls.classList.remove("hidden");
            hostControls.classList.add("flex");
        } else {
            hostControls.classList.add("hidden");
            hostControls.classList.remove("flex");
        }
    }

    // 1. Add Local User (You)
    const meItem = document.createElement("div");
    meItem.className = "flex items-center justify-between p-2 hover:bg-white/5 rounded-lg transition-colors";
    meItem.innerHTML = `
        <div class="flex items-center gap-3">
            <div class="size-8 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold text-white shadow-inner">
                ${(currentUser?.name || "Y")[0].toUpperCase()}
            </div>
            <div>
                <div class="text-sm font-medium text-white">${currentUser?.name || "You"} (You)</div>
                <div class="text-[10px] text-slate-400">${isMeetingHost ? "Meeting Host" : "Participant"}</div>
            </div>
        </div>
    `;
    participantsList.appendChild(meItem);

    // 2. Add Remote Peers (with per-peer host controls)
    Object.keys(peerInfo).forEach(socketId => {
        const info = peerInfo[socketId];
        const meetingId = new URLSearchParams(window.location.search).get("meetingId");
        const peerItem = document.createElement("div");
        peerItem.className = "flex items-center justify-between p-2 hover:bg-white/5 rounded-lg transition-colors gap-2";
        const initial = (info.name || info.email || "P")[0].toUpperCase();

        const nameBlock = `
            <div class="flex items-center gap-3 flex-1 min-w-0">
                <div class="size-8 rounded-full bg-[#3c4043] flex items-center justify-center text-sm font-bold text-white shadow-inner shrink-0">
                    ${initial}
                </div>
                <div class="min-w-0">
                    <div class="text-sm font-medium text-white truncate">${info.name || "Participant"}</div>
                    <div class="text-[10px] text-slate-400 truncate">${info.email || ""}</div>
                </div>
            </div>`;

        const hostBtns = isMeetingHost ? `
            <div class="flex gap-1 shrink-0">
                <button data-action="mute-peer" data-sid="${socketId}"
                    title="Mute this participant"
                    class="p-1.5 rounded-lg bg-[#3c4043] hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 transition-all border border-white/5">
                    <svg class="size-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z"/>
                    </svg>
                </button>
                <button data-action="cam-off-peer" data-sid="${socketId}"
                    title="Turn off camera"
                    class="p-1.5 rounded-lg bg-[#3c4043] hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 transition-all border border-white/5">
                    <svg class="size-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 0 1-2.25-2.25V9m12.841 9.091L16.5 19.5m-1.409-1.409c.407-.407.659-.97.659-1.591v-9a2.25 2.25 0 0 0-2.25-2.25h-9c-.621 0-1.184.252-1.591.659m12.182 12.182L2.909 5.909M1.5 4.5l1.409 1.409"/>
                    </svg>
                </button>
            </div>` : "";

        peerItem.innerHTML = nameBlock + hostBtns;

        // Wire per-peer buttons
        peerItem.querySelectorAll("button[data-action]").forEach(btn => {
            btn.addEventListener("click", () => {
                const action = btn.dataset.action;
                const sid    = btn.dataset.sid;
                if (action === "mute-peer") {
                    socket.emit("host-mute-participant", { targetSocketId: sid });
                    showToast(`Muted ${peerInfo[sid]?.name || "participant"}`);
                } else if (action === "cam-off-peer") {
                    socket.emit("host-camera-off-participant", { targetSocketId: sid });
                    showToast(`Camera turned off for ${peerInfo[sid]?.name || "participant"}`);
                }
            });
        });

        participantsList.appendChild(peerItem);
    });
}

// ── HOST: Mute All button ────────────────────────────────────────────────────
const muteAllBtn = document.getElementById("muteAllBtn");
if (muteAllBtn) {
    muteAllBtn.addEventListener("click", () => {
        const meetingId = new URLSearchParams(window.location.search).get("meetingId");
        socket.emit("host-mute-all", { meetingId });
        showToast("🔇 All participants muted");
    });
}

// ── HOST: Camera Off for All button ─────────────────────────────────────────
const cameraOffAllBtn = document.getElementById("cameraOffAllBtn");
if (cameraOffAllBtn) {
    cameraOffAllBtn.addEventListener("click", () => {
        const meetingId = new URLSearchParams(window.location.search).get("meetingId");
        socket.emit("host-camera-off-all", { meetingId });
        showToast("📵 All cameras turned off");
    });
}

// ── PARTICIPANT: Receive force-mute from host ────────────────────────────────
socket.on("force-mute", () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = false;
    // Update the mute button visual state
    localVideoContainer.classList.add("is-muted");
    // Sync the button icon to the muted state
    if (muteBtn) {
        muteBtn.innerHTML = `<svg class="size-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="m14.825 16.25-2.1-2.1q.275-.275.425-.625t.15-.725V6q0-.825-.588-1.413T12 4q-.825 0-1.413.588T10 6v4.175l-1.8-1.8H7q0 2.5 1.7 4.475T13 17.925V21h-2v-3.075q-.525-.075-1.025-.25t-.975-.425l-1.425 1.425q1.15.8 2.425 1.287T12 20q2.925 0 5.213-1.763T19 13.15V11h-2v.15q0 .825-.363 1.563t-.987 1.287ZM21.9 21.9 20.5 23.3l-4.5-4.5q-1.05.7-2.25 1.05T11.5 20.5v-2.05q.4-.05.775-.175t.725-.325L12 16.5l-2.625-2.625L3.5 18.05l-1.4-1.4L7.95 10.8l-3.1-3.1L3.45 6.3 2.05 4.9 3.45 3.5l18.45 18.4Z"/></svg>`;
    }
    // Broadcast updated state
    const meetingId = new URLSearchParams(window.location.search).get("meetingId");
    if (meetingId) socket.emit("media-state", { meetingId, video: localStream.getVideoTracks()[0]?.enabled ?? true, audio: false });
    showToast("🔇 The host muted your microphone");
});

// ── PARTICIPANT: Receive force-camera-off from host ──────────────────────────
socket.on("force-camera-off", () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;
    videoTrack.enabled = false;
    // Update camera button visual state
    localVideoContainer.classList.add("camera-off");
    if (cameraBtn) {
        cameraBtn.innerHTML = `<svg class="size-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l2.29 2.29c.63.63 1.71.18 1.71-.71V8.91c0-.89-1.08-1.34-1.71-.71L17 10.5zM15 16H5V8h10v8zM2 2.27L4.28 4.55l-1.73 1.73L1 7.83V19c0 .55.45 1 1 1h13.17l2.55 2.55L18.27 24l-16-16L2.27 2z"/></svg>`;
    }
    // Broadcast updated state
    const meetingId = new URLSearchParams(window.location.search).get("meetingId");
    if (meetingId) socket.emit("media-state", { meetingId, video: false, audio: localStream.getAudioTracks()[0]?.enabled ?? true });
    showToast("📵 The host turned off your camera");
});


// Function to draw chat bubbles on the screen
function appendChatMessage(sender, text, isSelf) {
    const chatMessages = document.getElementById("chatMessages");
    if (!chatMessages) return;

    const msgDiv = document.createElement("div");
    msgDiv.className = `flex flex-col ${isSelf ? 'items-end' : 'items-start'} mb-4`;

    const senderName = document.createElement("span");
    senderName.className = "text-[10px] text-slate-400 font-semibold mb-1 tracking-wider";
    senderName.innerText = sender;

    const bubble = document.createElement("div");
    bubble.className = `px-4 py-2.5 rounded-2xl text-sm max-w-[85%] shadow-sm ${isSelf
        ? 'bg-[#8ab4f8] text-slate-900 rounded-br-sm'
        : 'bg-[#3c4043] text-white rounded-bl-sm border border-white/5'
        }`;
    bubble.innerText = text;

    msgDiv.appendChild(senderName);
    msgDiv.appendChild(bubble);
    chatMessages.appendChild(msgDiv);

    // Auto-scroll to the newest message
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChat() {
    const text = chatInput.value.trim();
    if (text) {
        const meetingId = new URLSearchParams(window.location.search).get("meetingId");
        const ctx = hostContext || getOrPromptHostContext();

        socket.emit("chat-message", {
            meetingId: meetingId,
            message: text,
            sender: ctx?.email || "Participant"
        });

        appendChatMessage("You", text, true);
        chatInput.value = "";
    }
}

sendChatBtn.onclick = sendChat;
chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendChat();
});

socket.on("chat-message", (data) => {
    appendChatMessage(data.sender, data.message, false);

    // Optional: Show a subtle notification if they aren't looking at the chat tab
    if (panelChat.classList.contains("hidden") && typeof showToast === "function") {
        showToast(`New message from ${data.sender}`);
    }
});

socket.on("emoji-reaction", (data) => {
    showFloatingEmoji(`video-container-${data.socketId}`, data.emoji);
});

// ==========================================
// ADVANCED SCREENSHARE & SPOTLIGHT LOGIC
// ==========================================
let screenStream = null;
let isScreenSharing = false;
let isGlobalSharing = false;
let screenSenders = {}; // Tracks the secondary video pipe for screenshares
const screenShareBtn = document.getElementById("screenShareBtn");

// --- CUSTOM HOST APPROVAL MODAL (Bypasses Browser Blocks) ---
function showHostApprovalModal(requesterEmail, targetSocketId) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4';
    modal.innerHTML = `
        <div class="bg-[#28292c] border border-white/10 p-6 rounded-2xl max-w-sm w-full shadow-2xl text-center">
            <div class="mx-auto flex items-center justify-center size-14 rounded-full bg-[#3c4043] mb-4 shadow-inner">
                <svg class="size-7 text-[#8ab4f8]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25" /></svg>
            </div>
            <h3 class="text-xl font-bold text-white mb-2">Screen Share Request</h3>
            <p class="text-slate-300 text-sm mb-6"><span class="font-bold text-white">${requesterEmail}</span> wants to share their screen.</p>
            <div class="flex gap-3">
                <button id="deny-share" class="flex-1 bg-[#3c4043] hover:bg-[#4a4d51] text-white py-2.5 rounded-xl font-semibold transition-all">Deny</button>
                <button id="allow-share" class="flex-1 bg-[#8ab4f8] hover:bg-[#aecbfa] text-slate-900 py-2.5 rounded-xl font-semibold shadow-md transition-all">Allow</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('allow-share').onclick = () => {
        socket.emit("screenshare-response", { targetSocketId, approved: true });
        modal.remove();
    };
    document.getElementById('deny-share').onclick = () => {
        socket.emit("screenshare-response", { targetSocketId, approved: false });
        modal.remove();
    };
}

// 1. The Button Click
// 1. The Button Click
screenShareBtn.onclick = () => {
    // IRON-CLAD LOCK: If anyone else is sharing, block the button completely
    if (isGlobalSharing && !isScreenSharing) {
        showToast("Someone else is already sharing their screen.");
        return;
    }

    if (!isScreenSharing) {
        if (isMeetingHost) {
            executeScreenShare();
        } else {
            const meetingId = new URLSearchParams(window.location.search).get("meetingId");
            const ctx = hostContext || getOrPromptHostContext();
            socket.emit("request-screenshare", { meetingId, email: ctx?.email || "A participant" });
            showToast("Request sent to host. Waiting for approval...");
        }
    } else {
        stopScreenShare();
    }
};

// 2. Execute the Screen Share (DUAL STREAM METHOD)
async function executeScreenShare() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const screenTrack = screenStream.getVideoTracks()[0];

        // Instead of replacing the camera, we ADD a new track to send both simultaneously!
        for (const id in peerConnections) {
            const pc = peerConnections[id];
            screenSenders[id] = pc.addTrack(screenTrack, screenStream);

            // Force WebRTC to renegotiate and open the second pipe
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit("offer", { offer: pc.localDescription, socketId: id });
        }

        createLocalScreenCard(screenStream);
        isScreenSharing = true;

        screenShareBtn.classList.add("bg-[#8ab4f8]", "text-slate-900");
        screenShareBtn.classList.remove("bg-[#3c4043]", "text-white");

        const meetingId = new URLSearchParams(window.location.search).get("meetingId");
        socket.emit("screenshare-state", { meetingId, isSharing: true });

        screenTrack.onended = () => stopScreenShare();
    } catch (err) {
        console.error("Error sharing screen:", err);
    }
}

// 3. Helper to build the separate local card
function createLocalScreenCard(stream) {
    const grid = document.querySelector('.meet-grid');
    grid.classList.add('has-screenshare');

    const screenContainer = document.createElement('div');
    screenContainer.id = 'local-screen-container';
    screenContainer.className = 'video-container is-screenshare group';

    const screenVid = document.createElement('video');
    screenVid.autoplay = true;
    screenVid.playsinline = true;
    screenVid.muted = true;
    // object-fit:contain is applied via CSS (.video-container video) — no inline override needed
    screenVid.srcObject = stream;

    const badge = document.createElement('div');
    badge.className = 'absolute bottom-3 left-3 bg-[#8ab4f8] px-3 py-1.5 rounded-md text-xs font-bold text-slate-900 shadow-sm flex items-center gap-2 z-10';
    badge.innerHTML = `<svg class="size-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25" /></svg> You are presenting`;

    screenContainer.appendChild(screenVid);
    screenContainer.appendChild(badge);
    grid.prepend(screenContainer);
}

// 4. Stop Sharing
function stopScreenShare() {
    if (!isScreenSharing) return;

    // Remove the secondary screen track from the connection
    for (const id in peerConnections) {
        const pc = peerConnections[id];
        if (screenSenders[id]) {
            pc.removeTrack(screenSenders[id]);
            pc.createOffer().then(offer => {
                pc.setLocalDescription(offer);
                socket.emit("offer", { offer: pc.localDescription, socketId: id });
            });
        }
    }
    screenSenders = {};

    const screenContainer = document.getElementById('local-screen-container');
    if (screenContainer) screenContainer.remove();

    const grid = document.querySelector('.meet-grid');
    if (grid) grid.classList.remove('has-screenshare');

    if (screenStream) screenStream.getTracks().forEach(t => t.stop());

    isScreenSharing = false;
    screenShareBtn.classList.remove("bg-[#8ab4f8]", "text-slate-900");
    screenShareBtn.classList.add("bg-[#3c4043]", "text-white");

    const meetingId = new URLSearchParams(window.location.search).get("meetingId");
    socket.emit("screenshare-state", { meetingId, isSharing: false });
}

// 5. Socket Listeners for Permissions
socket.on("screenshare-requested", (data) => {
    if (isMeetingHost) {
        // IRON-CLAD LOCK: Auto-deny if the host is sharing OR if another participant is sharing
        if (isGlobalSharing || isScreenSharing) {
            socket.emit("screenshare-response", { targetSocketId: data.socketId, approved: false });
            // Optional: Tell the host that a request was automatically blocked
            showToast(`Auto-denied ${data.email} (screen already in use)`);
            return;
        }

        // If the screen is free, show the custom approval modal
        showHostApprovalModal(data.email, data.socketId);
    }
});

socket.on("screenshare-approved", (data) => {
    if (data.approved) {
        showToast("Host approved your request!");
        executeScreenShare();
    } else {
        // This will now trigger if the host clicked "Deny" OR if the auto-deny lock kicked in
        showToast("Screen share denied. The screen is in use or the host declined.");
    }
});

// 6. Layout Engine for Remote Screen Shares
socket.on("screenshare-state-changed", (data) => {
    isGlobalSharing = data.isSharing;
    applyRemoteSpotlight(data.socketId, data.isSharing);
});

function applyRemoteSpotlight(socketId, isSharing) {
    const grid = document.querySelector('.meet-grid');
    if (!grid) return;

    if (isSharing) {
        grid.classList.add('has-screenshare');

        const screenContainer = document.createElement('div');
        screenContainer.id = `remote-screen-${socketId}`;
        screenContainer.className = 'video-container is-screenshare group';

        const screenVid = document.createElement('video');
        screenVid.autoplay = true;
        screenVid.playsinline = true;
        // object-fit:contain is applied via CSS (.video-container video) — no inline override needed

        // Race condition handler: Check if the WebRTC stream already arrived
        const incomingStreamVid = document.getElementById(`temp-stream-${socketId}`);
        if (incomingStreamVid) {
            screenVid.srcObject = incomingStreamVid.srcObject;
        }

        const badge = document.createElement('div');
        badge.className = 'absolute bottom-3 left-3 bg-[#8ab4f8] px-3 py-1.5 rounded-md text-xs font-bold text-slate-900 shadow-sm z-10 flex items-center gap-2';
        badge.innerHTML = `<svg class="size-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25" /></svg> ${peerInfo[socketId]?.email || 'A participant'} is presenting`;

        screenContainer.appendChild(screenVid);
        screenContainer.appendChild(badge);
        grid.prepend(screenContainer);

        // NOTICE: We NO LONGER hide their original camera card or add a "Presenting..." text!
        // Their face will stay visible exactly where it is.

    } else {
        grid.classList.remove('has-screenshare');
        const screenContainer = document.getElementById(`remote-screen-${socketId}`);
        if (screenContainer) screenContainer.remove();

        const tempStreamVid = document.getElementById(`temp-stream-${socketId}`);
        if (tempStreamVid) tempStreamVid.remove();
    }
}

// ==========================================
// EMOJI SYSTEM
// ==========================================

// Inject keyframes once on load
(function() {
    const style = document.createElement('style');
    style.id = 'emoji-keyframes';
    style.innerHTML = `@keyframes float-up { 0% { transform: translate(-50%, 0) scale(0.5); opacity: 1; } 100% { transform: translate(-50%, -100px) scale(1.2); opacity: 0; } } .animate-float-up { animation: float-up 2.5s forwards; }`;
    document.head.appendChild(style);
})();

// Toggle the emoji picker open/closed
const emojiMenuBtn  = document.getElementById('emojiMenuBtn');
const emojiDropdown = document.getElementById('emojiDropdown');

function showEmojiDropdown(visible) {
    if (!emojiDropdown) return;
    emojiDropdown.style.display = visible ? 'flex' : 'none';
}

if (emojiMenuBtn && emojiDropdown) {
    emojiMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = emojiDropdown.style.display === 'flex';
        showEmojiDropdown(!isOpen);
    });

    // Close picker when clicking anywhere outside it
    document.addEventListener('click', (e) => {
        if (!emojiDropdown.contains(e.target) && e.target !== emojiMenuBtn) {
            showEmojiDropdown(false);
        }
    });
}

// Each emoji button: emit to server, show locally, close picker
document.querySelectorAll('.emoji-reaction').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const emoji = btn.getAttribute('data-emoji');
        const meetingId = new URLSearchParams(window.location.search).get("meetingId");
        socket.emit('emoji-reaction', { meetingId, emoji });
        showFloatingEmoji('local-video-container', emoji);
        showEmojiDropdown(false);
    });
});

// Receive emoji reactions from other participants
socket.on('emoji-reaction', (data) => {
    showFloatingEmoji(`video-container-${data.socketId}`, data.emoji);
});

function showFloatingEmoji(containerId, emoji) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const el = document.createElement('div');
    el.textContent = emoji;
    el.className = 'absolute bottom-10 left-1/2 -translate-x-1/2 text-5xl pointer-events-none z-50 animate-float-up';
    container.appendChild(el);
    setTimeout(() => el.remove(), 2500);
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTOMATIC AUDIO RECORDER (20-Second Batch Architecture)
//   NOTE: Only the meeting host records & uploads audio chunks. This avoids
//   duplicate/broken transcripts when multiple participants are present.
// ═══════════════════════════════════════════════════════════════════════════
const scrollArea = document.getElementById("transcriptScrollArea");
const statusText = document.getElementById("transcriptStatusText");
const statusDot = document.getElementById("transcriptStatusDot");
let audioRecorder = null;
let recordingCycleTimeout = null;
let transcriptStarted = false;
let pendingChunkUpload = Promise.resolve();

function canCaptureTranscriptAudio() {
    return isMeetingHost || currentUser?.role === "manager";
}

async function flushTranscriptChunkBeforeEnd() {
    const recorder = audioRecorder;
    if (!recorder || recorder.state !== "recording") return;

    await new Promise((resolve) => {
        let completed = false;
        const finish = () => {
            if (completed) return;
            completed = true;
            recorder.removeEventListener("stop", onStop);
            resolve();
        };
        const onStop = () => finish();

        recorder.addEventListener("stop", onStop, { once: true });
        setTimeout(finish, 4000);

        try {
            recorder.stop();
        } catch {
            finish();
        }
    });

    try {
        await pendingChunkUpload;
    } catch { }

    await new Promise((resolve) => setTimeout(resolve, 250));
}

function startAutoTranscript() {
    // Prefer host-driven capture, but allow manager fallback if host flag is missed.
    if (!canCaptureTranscriptAudio()) {
        return;
    }

    if (!localStream) {
        setTimeout(startAutoTranscript, 1000);
        return;
    }

    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) {
        if (statusDot) {
            statusDot.classList.remove("bg-red-500", "animate-pulse");
            statusDot.classList.add("bg-amber-500");
        }
        if (statusText) {
            statusText.textContent = "No microphone track detected";
            statusText.classList.remove("text-red-400");
            statusText.classList.add("text-amber-400");
        }
        setTimeout(startAutoTranscript, 3000);
        return;
    }

    if (statusDot) statusDot.classList.replace("bg-slate-500", "bg-red-500");
    if (statusDot) statusDot.classList.add("animate-pulse");
    if (statusText) {
        statusText.textContent = "Recording Audio...";
        statusText.classList.replace("text-slate-400", "text-red-400");
    }

    if (scrollArea) {
        scrollArea.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-70">
                <svg class="size-8 text-[#8ab4f8] animate-pulse" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" /></svg>
                <p class="text-sm text-slate-300">Audio is being securely recorded in 20-second batches.</p>
                <p class="text-xs text-slate-500">The high-accuracy transcript and summary will automatically generate when the host ends the call.</p>
            </div>
        `;
    }

    if (transcriptStarted) return;
    transcriptStarted = true;

    // Record true standalone 20s blobs (stop/restart) so each upload is a valid media file.
    recordAndSendCycle();
}

function pickSupportedAudioMimeType() {
    const candidates = [
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "audio/webm;codecs=opus",
        "audio/webm",
    ];
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
        return "";
    }
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

async function blobToBase64(blob) {
    return await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || "").split(",")[1] || "");
        r.onerror = () => reject(new Error("FileReader failed"));
        r.readAsDataURL(blob);
    });
}

function recordAndSendCycle() {
    if (!meetingActive || !localStream || !canCaptureTranscriptAudio()) return;

    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) {
        if (statusDot) {
            statusDot.classList.remove("bg-red-500", "animate-pulse");
            statusDot.classList.add("bg-amber-500");
        }
        if (statusText) {
            statusText.textContent = "Mic unavailable, retrying...";
            statusText.classList.remove("text-red-400");
            statusText.classList.add("text-amber-400");
        }
        recordingCycleTimeout = setTimeout(recordAndSendCycle, 3000);
        return;
    }
    if (!audioTrack.enabled) {
        // If host mutes mic, pause transcript capture (prevents sending silent/empty blobs)
        if (statusDot) {
            statusDot.classList.remove("bg-red-500", "animate-pulse");
            statusDot.classList.add("bg-amber-500");
        }
        if (statusText) {
            statusText.textContent = "Mic is muted — transcript paused";
            statusText.classList.remove("text-red-400");
            statusText.classList.add("text-amber-400");
        }
        recordingCycleTimeout = setTimeout(recordAndSendCycle, 5000);
        return;
    }

    if (statusDot) {
        statusDot.classList.remove("bg-amber-500");
        statusDot.classList.add("bg-red-500", "animate-pulse");
    }
    if (statusText) {
        statusText.textContent = "Recording Audio...";
        statusText.classList.remove("text-amber-400");
        statusText.classList.add("text-red-400");
    }

    const audioStream = new MediaStream([audioTrack]);
    const mimeType = pickSupportedAudioMimeType();

    let localRecorder;
    try {
        localRecorder = mimeType ? new MediaRecorder(audioStream, { mimeType }) : new MediaRecorder(audioStream);
    } catch (err) {
        console.error("❌ MediaRecorder failed to start:", err);
        recordingCycleTimeout = setTimeout(recordAndSendCycle, 5000);
        return;
    }

    audioRecorder = localRecorder;

    const meetingId = new URLSearchParams(window.location.search).get("meetingId");
    const speakerLabel = currentUser?.name || "Participant";
    const recordedChunks = [];
    let recordedBytes = 0;

    localRecorder.onerror = (e) => console.error("❌ MediaRecorder error:", e?.error || e);
    localRecorder.onstart = () => console.log("✅ MediaRecorder started", { mimeType: localRecorder.mimeType });
    localRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
            recordedChunks.push(event.data);
            recordedBytes += event.data.size;
        }
    };

    localRecorder.onstop = async () => {
        pendingChunkUpload = (async () => {
            console.log("🛑 MediaRecorder stopped");
            if (!meetingActive || !meetingId) return;
            const recordedBlob = recordedChunks.length
                ? recordedChunks.reduce((largest, current) =>
                    (current && current.size > (largest?.size || 0) ? current : largest), null)
                : null;

            if (!recordedBlob || recordedBlob.size < 400) {
                console.warn("⚠️ Recorded blob too small/empty; retrying", {
                    size: recordedBlob?.size || 0,
                    chunks: recordedChunks.length,
                    bytes: recordedBytes,
                    chunkSizes: recordedChunks.map((chunk) => chunk.size),
                });
                recordingCycleTimeout = setTimeout(recordAndSendCycle, 1500);
                return;
            }

            const base64 = await blobToBase64(recordedBlob);
            if (!base64) {
                recordingCycleTimeout = setTimeout(recordAndSendCycle, 1500);
                return;
            }

            console.log(`🎙️ Sending audio chunk (${Math.round(recordedBlob.size / 1024)} KB) as base64`, { mimeType: localRecorder.mimeType });
            await new Promise((resolve) => {
                let settled = false;
                const finish = () => {
                    if (settled) return;
                    settled = true;
                    resolve();
                };

                const ackTimeout = setTimeout(() => {
                    console.warn("⚠️ audio-chunk ack timeout; continuing");
                    finish();
                }, 7000);

                socket.emit("audio-chunk", {
                    meetingId,
                    name: speakerLabel,
                    audioBase64: base64,
                    mimeType: localRecorder.mimeType || ""
                }, (ack) => {
                    clearTimeout(ackTimeout);
                    if (!ack?.ok) {
                        console.warn("⚠️ audio-chunk rejected by server:", ack?.error || "unknown error");
                    }
                    finish();
                });
            });
            await new Promise((resolve) => setTimeout(resolve, 150));
        })()
            .catch((err) => {
                console.error("❌ Failed to send audio chunk:", err);
            })
            .finally(() => {
                // Immediately start next cycle if meeting continues
                if (meetingActive) {
                    recordingCycleTimeout = setTimeout(recordAndSendCycle, 200);
                }
            });

        await pendingChunkUpload;
    };

    localRecorder.start();
    recordingCycleTimeout = setTimeout(() => {
        try {
            if (localRecorder.state === "recording") {
                localRecorder.stop();
            }
        } catch {}
    }, 20000);
}

// We no longer trigger AI from the client! The server handles it automatically on "end-meeting".
// Transcript recording is started from inside main() once we know if this user is the host.
window.forceSaveAndProcessTranscript = async () => {
    console.log("Waiting for server to transcribe and summarize audio batches...");
};