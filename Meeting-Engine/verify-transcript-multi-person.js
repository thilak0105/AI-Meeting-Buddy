require("dotenv").config();
const mongoose = require("mongoose");

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/Meeting";

const USERS = {
    manager: { email: "manager1@company.com", password: "Manager@123", name: "Priya Manager" },
    employee1: { email: "employee1@company.com", password: "Employee@123", name: "Kavin Employee" },
    employee2: { email: "employee2@company.com", password: "Employee@123", name: "Meena Employee" },
};

function parseCookieHeader(setCookieHeader) {
    if (!setCookieHeader) return "";
    const first = setCookieHeader.split(",").map((v) => v.trim())[0] || "";
    return first.split(";")[0] || "";
}

async function login(user) {
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, password: user.password }),
    });

    if (!response.ok) {
        throw new Error(`Login failed for ${user.email} (${response.status})`);
    }

    const cookie = parseCookieHeader(response.headers.get("set-cookie"));
    if (!cookie) throw new Error(`Missing cookie for ${user.email}`);
    return cookie;
}

async function createMeeting(managerCookie, title) {
    const response = await fetch(`${BASE_URL}/api/meetings`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Cookie: managerCookie,
        },
        body: JSON.stringify({ meetingName: title }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Meeting creation failed (${response.status}): ${text}`);
    }

    const body = await response.json();
    return body?.meeting?.meetingId;
}

async function markParticipantJoin(cookie, meetingId, socketId) {
    const response = await fetch(`${BASE_URL}/api/participants`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
        },
        body: JSON.stringify({ meetingId, socketId, action: "join" }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Participant join failed (${response.status}): ${text}`);
    }
}

async function saveTranscript(managerCookie, meetingId, transcript) {
    const response = await fetch(`${BASE_URL}/api/meetings/${meetingId}/transcript`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Cookie: managerCookie,
        },
        body: JSON.stringify({ transcript }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Transcript save failed (${response.status}): ${text}`);
    }

    return response.json();
}

async function verifyMeetingData(meetingId) {
    const chunks = await mongoose.connection.db
        .collection("transcriptchunks")
        .find({ meetingId })
        .sort({ timestamp: 1 })
        .toArray();

    const participants = await mongoose.connection.db
        .collection("meetingparticipants")
        .find({ meetingId })
        .toArray();

    const distinctSpeakers = [...new Set(chunks.map((chunk) => chunk.speaker))];
    return {
        chunkCount: chunks.length,
        participantCount: participants.length,
        distinctSpeakers,
    };
}

async function runCase({ label, users, transcriptLines }) {
    const managerCookie = await login(USERS.manager);
    const meetingId = await createMeeting(managerCookie, `${label} ${new Date().toISOString()}`);

    const cookies = { manager: managerCookie };
    if (users.includes("employee1")) cookies.employee1 = await login(USERS.employee1);
    if (users.includes("employee2")) cookies.employee2 = await login(USERS.employee2);

    await markParticipantJoin(cookies.manager, meetingId, `${label}-manager-socket`);
    if (cookies.employee1) await markParticipantJoin(cookies.employee1, meetingId, `${label}-employee1-socket`);
    if (cookies.employee2) await markParticipantJoin(cookies.employee2, meetingId, `${label}-employee2-socket`);

    const transcript = transcriptLines.join("\n");
    const saveResp = await saveTranscript(managerCookie, meetingId, transcript);
    const verify = await verifyMeetingData(meetingId);

    return {
        label,
        meetingId,
        transcriptVersion: saveResp.transcriptVersion,
        participantCount: verify.participantCount,
        chunkCount: verify.chunkCount,
        distinctSpeakers: verify.distinctSpeakers,
    };
}

async function main() {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });

    const case2 = await runCase({
        label: "VERIFY-2P",
        users: ["manager", "employee1"],
        transcriptLines: [
            "[11:00:01] Priya Manager: Sprint planning kickoff",
            "[11:00:11] Kavin Employee: Backend API tasks are in progress",
            "[11:00:19] Priya Manager: Finalize QA checklist by tomorrow",
        ],
    });

    const case3 = await runCase({
        label: "VERIFY-3P",
        users: ["manager", "employee1", "employee2"],
        transcriptLines: [
            "[12:00:01] Priya Manager: Release readiness review started",
            "[12:00:08] Kavin Employee: Login module changes are complete",
            "[12:00:14] Meena Employee: UI regression fixes are ongoing",
            "[12:00:22] Priya Manager: Production deployment planned for Friday",
        ],
    });

    console.log("VERIFY_CASE_2P=" + JSON.stringify(case2));
    console.log("VERIFY_CASE_3P=" + JSON.stringify(case3));

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error("VERIFY_ERROR=" + err.message);
    try {
        await mongoose.disconnect();
    } catch { }
    process.exit(1);
});
