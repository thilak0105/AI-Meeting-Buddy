require("dotenv").config();
const mongoose = require("mongoose");

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/Meeting";
const LOGIN_EMAIL = process.env.VERIFY_LOGIN_EMAIL || "manager1@company.com";
const LOGIN_PASSWORD = process.env.VERIFY_LOGIN_PASSWORD || "Manager@123";

function parseCookieHeader(setCookieHeader) {
    if (!setCookieHeader) return "";
    const first = setCookieHeader.split(",").map((v) => v.trim())[0] || "";
    return first.split(";")[0] || "";
}

async function main() {
    const loginResp = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
    });

    if (!loginResp.ok) {
        const text = await loginResp.text();
        throw new Error(`Login failed (${loginResp.status}): ${text}`);
    }

    const cookie = parseCookieHeader(loginResp.headers.get("set-cookie"));
    if (!cookie) {
        throw new Error("Login succeeded but auth cookie was not returned");
    }

    const meetingName = `Transcript Verify ${new Date().toISOString()}`;
    const createMeetingResp = await fetch(`${BASE_URL}/api/meetings`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
        },
        body: JSON.stringify({ meetingName }),
    });

    if (!createMeetingResp.ok) {
        const text = await createMeetingResp.text();
        throw new Error(`Meeting creation failed (${createMeetingResp.status}): ${text}`);
    }

    const createBody = await createMeetingResp.json();
    const meetingId = createBody?.meeting?.meetingId;
    if (!meetingId) {
        throw new Error("Meeting ID missing in create meeting response");
    }

    const transcript = [
        "[10:00:01] Alice: Kickoff update",
        "[10:00:20] Bob: We will deploy Friday",
        "Charlie: I will prepare QA report",
    ].join("\n");

    const saveTranscriptResp = await fetch(`${BASE_URL}/api/meetings/${meetingId}/transcript`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
        },
        body: JSON.stringify({ transcript }),
    });

    if (!saveTranscriptResp.ok) {
        const text = await saveTranscriptResp.text();
        throw new Error(`Transcript save failed (${saveTranscriptResp.status}): ${text}`);
    }

    const saveBody = await saveTranscriptResp.json();

    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    const rows = await mongoose.connection.db
        .collection("transcriptchunks")
        .find({ meetingId })
        .sort({ timestamp: 1 })
        .toArray();
    await mongoose.disconnect();

    console.log(`VERIFY_MEETING_ID=${meetingId}`);
    console.log(`VERIFY_TRANSCRIPT_VERSION=${saveBody.transcriptVersion}`);
    console.log(`VERIFY_CHUNK_COUNT=${rows.length}`);
    console.log(`VERIFY_SAMPLE=${JSON.stringify(rows.map((row) => ({ speaker: row.speaker, ts: row.ts, text: row.text })).slice(0, 3))}`);
}

main().catch(async (err) => {
    console.error(`VERIFY_ERROR=${err.message}`);
    try {
        await mongoose.disconnect();
    } catch { }
    process.exit(1);
});
