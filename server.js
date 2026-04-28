require("dotenv").config();
const express = require("express");
const http = require("http");
const url = require("url");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");
const socketIo = require("socket.io");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Groq = require("groq-sdk");
// Add this near your other imports at the top
const fs = require("fs");
const os = require("os");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const KEEP_AUDIO_FILES = process.env.KEEP_AUDIO_FILES === "true" || process.env.KEEP_AUDIO_FILES === "1";
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_COOKIE = "authToken";
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/Meeting";
const PORT = Number(process.env.PORT) || 5000;

// --- DUAL-KEY ARCHITECTURE ---
const groqAudio = new Groq({
    apiKey: process.env.GROQ_AUDIO_API_KEY || process.env.GROQ_API_KEY,
});

const groqSummary = new Groq({
    apiKey: process.env.GROQ_SUMMARY_API_KEY || process.env.GROQ_API_KEY,
});

const hasGroqSummaryKey = () => Boolean(process.env.GROQ_SUMMARY_API_KEY || process.env.GROQ_API_KEY);
// Groq model names change over time; keep centralized.
const GROQ_TEXT_MODEL = process.env.GROQ_TEXT_MODEL || "llama-3.3-70b-versatile";

mongoose
    .connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => {
        console.log("✅ Connected to MongoDB successfully");
    })
    .catch((err) => {
        console.error("❌ MongoDB connection error:", err.message);
    });

const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 120 },
        email: { type: String, required: true, unique: true, trim: true, lowercase: true },
        passwordHash: { type: String, required: true },
        role: { type: String, enum: ["manager", "employee"], required: true },
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
);

const meetingSchema = new mongoose.Schema(
    {
        meetingId: { type: String, required: true, unique: true, index: true },
        meetingName: { type: String, required: true, trim: true, maxlength: 120 },
        description: { type: String, default: null, maxlength: 500 },
        transcript: { type: String, default: null, maxlength: 50000 },
        transcriptVersion: { type: Number, default: 0 },
        status: { type: String, enum: ["scheduled", "active", "ended", "finished", "dropped"], default: "active", index: true },
        startsAt: { type: Date, default: null },
        endsAt: { type: Date, default: null },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        createdByEmail: { type: String, required: true },
    },
    { timestamps: true }
);

const meetingSummarySchema = new mongoose.Schema(
    {
        meetingId: { type: String, required: true, index: true },
        summaryHtml: { type: String, required: true },
        hostEmail: { type: String, required: true },
        meetingDate: { type: String, required: true },
    },
    { timestamps: true }
);

const meetingParticipantSchema = new mongoose.Schema(
    {
        meetingId: { type: String, required: true, index: true },
        participantId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        participantEmail: { type: String, required: true },
        participantName: { type: String, default: "" },
        socketId: { type: String, required: true },
        joinTime: { type: Date, default: Date.now },
        leaveTime: { type: Date },
        isHost: { type: Boolean, default: false },
        meetingDate: { type: String, required: true },
    },
    { timestamps: true }
);

const objectiveItemSchema = new mongoose.Schema(
    {
        text: { type: String, required: true, trim: true, maxlength: 250 },
        sourceMeetingId: { type: String, default: null },
        edited: { type: Boolean, default: false },
    },
    { _id: false }
);

const managerObjectiveSchema = new mongoose.Schema(
    {
        managerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", unique: true, index: true },
        sourceMeetingIds: [{ type: String }],
        toStart: [objectiveItemSchema],
        ongoing: [objectiveItemSchema],
        message: { type: String, default: "" },
        missingTranscriptCount: { type: Number, default: 0 },
        refreshedAt: { type: Date, default: Date.now },
    },
    { timestamps: true }
);

const transcriptChunkSchema = new mongoose.Schema(
    {
        meetingId: { type: String, required: true, index: true },
        speaker: { type: String, required: true },
        text: { type: String, required: true },
        ts: { type: String, required: true },
        timestamp: { type: Date, default: Date.now, index: true } // Used for perfect chronological sorting
    }
);
const TranscriptChunk = mongoose.model("TranscriptChunk", transcriptChunkSchema);

// ─── NEW: Project-level summary (keyed by meeting name = project title) ───
const projectSummarySchema = new mongoose.Schema(
    {
        projectName: { type: String, required: true, unique: true, trim: true, index: true },
        summaryText: { type: String, required: true },          // plain-text merged summary
        summaryHtml: { type: String, required: true },          // rich HTML version
        meetingIds: [{ type: String }],                         // all meetings that fed this summary
        managerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        lastUpdated: { type: Date, default: Date.now },
    },
    { timestamps: true }
);

// ─── NEW: Per-project task (Notion-style) ─────────────────────────────────
const projectTaskSchema = new mongoose.Schema(
    {
        projectName: { type: String, required: true, trim: true, index: true },
        managerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        title: { type: String, required: true, trim: true, maxlength: 300 },
        description: { type: String, default: "", maxlength: 1000 },
        status: { type: String, enum: ["todo", "in_progress", "done"], default: "todo", index: true },
        priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
        sourceMeetingId: { type: String, default: null },
        addedManually: { type: Boolean, default: false },
        order: { type: Number, default: 0 },
    },
    { timestamps: true }
);

const User = mongoose.model("User", userSchema);
const Meeting = mongoose.model("Meeting", meetingSchema);
const MeetingSummary = mongoose.model("MeetingSummary", meetingSummarySchema);
const MeetingParticipant = mongoose.model("MeetingParticipant", meetingParticipantSchema);
const ManagerObjective = mongoose.model("ManagerObjective", managerObjectiveSchema);
const ProjectSummary = mongoose.model("ProjectSummary", projectSummarySchema);
const ProjectTask = mongoose.model("ProjectTask", projectTaskSchema);

app.use(cookieParser());
app.use(express.json());

function createToken(user) {
    return jwt.sign(
        {
            id: user._id.toString(),
            email: user.email,
            role: user.role,
            name: user.name,
        },
        JWT_SECRET,
        { expiresIn: "7d" }
    );
}

function parseCookieHeader(cookieHeader = "") {
    return cookieHeader.split(";").reduce((acc, pair) => {
        const idx = pair.indexOf("=");
        if (idx < 0) return acc;
        const key = pair.slice(0, idx).trim();
        const val = decodeURIComponent(pair.slice(idx + 1).trim());
        acc[key] = val;
        return acc;
    }, {});
}

function getTokenFromRequest(req) {
    const bearer = req.headers.authorization || "";
    if (bearer.startsWith("Bearer ")) return bearer.slice(7);
    if (req.cookies && req.cookies[TOKEN_COOKIE]) return req.cookies[TOKEN_COOKIE];
    return null;
}

function authRequired(req, res, next) {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ ok: false, error: "Authentication required" });

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        return next();
    } catch {
        return res.status(401).json({ ok: false, error: "Invalid or expired session" });
    }
}

function pageAuthRequired(req, res, next) {
    const token = getTokenFromRequest(req);
    if (!token) return res.redirect("/");

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        return next();
    } catch {
        return res.redirect("/");
    }
}

function roleRequired(role) {
    return (req, res, next) => {
        if (!req.user || req.user.role !== role) {
            return res.status(403).json({ ok: false, error: "Forbidden" });
        }
        return next();
    };
}

function userPayload(user) {
    return {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
    };
}

function toIsoDate(date = new Date()) {
    return new Date(date).toISOString().slice(0, 10);
}

function parseTranscriptLine(line) {
    const raw = String(line || "").trim();
    if (!raw) return null;

    const structured = raw.match(/^\[([^\]]+)\]\s*([^:]+):\s*(.+)$/);
    if (structured) {
        const [, ts, speaker, text] = structured;
        return {
            ts: String(ts || "").trim() || "--:--:--",
            speaker: String(speaker || "Participant").trim() || "Participant",
            text: String(text || "").trim(),
        };
    }

    const simple = raw.match(/^([^:]{1,120}):\s*(.+)$/);
    if (simple) {
        const [, speaker, text] = simple;
        return {
            ts: "--:--:--",
            speaker: String(speaker || "Participant").trim() || "Participant",
            text: String(text || "").trim(),
        };
    }

    return {
        ts: "--:--:--",
        speaker: "Participant",
        text: raw,
    };
}

async function syncTranscriptChunks(meetingId, transcriptText) {
    await TranscriptChunk.deleteMany({ meetingId });

    const lines = String(transcriptText || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (!lines.length) return 0;

    const baseTime = Date.now();
    const docs = lines
        .map((line, index) => {
            const parsed = parseTranscriptLine(line);
            if (!parsed || !parsed.text) return null;
            return {
                meetingId,
                speaker: parsed.speaker,
                text: parsed.text,
                ts: parsed.ts,
                timestamp: new Date(baseTime + index),
            };
        })
        .filter(Boolean);

    if (!docs.length) return 0;

    await TranscriptChunk.insertMany(docs, { ordered: true });
    return docs.length;
}

function getMeetingAudioFiles(meetingId) {
    if (!meetingId) return [];
    return fs
        .readdirSync(UPLOADS_DIR)
        .filter((file) => file.startsWith(`${meetingId}_`) && /\.(webm|ogg)$/i.test(file))
        .sort();
}

async function processMeetingAudioToTranscript(meetingId, meetingDoc) {
    if (!meetingId || !meetingDoc) {
        return { ok: false, reason: "missing-input", filesFound: 0, transcriptVersion: meetingDoc?.transcriptVersion || 0 };
    }

    let files = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
        if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        files = getMeetingAudioFiles(meetingId);
        if (files.length > 0) break;
    }

    let assembledTranscript = "";
    const transcriptChunks = [];

    if (files.length === 0) {
        console.log(`⚠️ No audio files found to transcribe for meeting ${meetingId}.`);
        return { ok: false, reason: "no-audio-files", filesFound: 0, transcriptVersion: meetingDoc.transcriptVersion || 0 };
    }

    for (const file of files) {
        const filePath = path.join(UPLOADS_DIR, file);
        const speakerFromFile = file
            .replace(new RegExp(`^${meetingId}_\\d+_`), "")
            .replace(/\.(webm|ogg)$/i, "")
            .trim();
        const speakerName = speakerFromFile || "Participant";

        try {
            const transcription = await groqAudio.audio.transcriptions.create({
                file: fs.createReadStream(filePath),
                model: "whisper-large-v3",
                language: "en",
            });

            if (transcription.text && transcription.text.length > 2) {
                const chunkTimestamp = new Date();
                const chunkTsLabel = chunkTimestamp.toLocaleTimeString();
                const chunkText = transcription.text.trim();

                assembledTranscript += `[${chunkTsLabel}] ${speakerName}: ${chunkText}\n`;
                transcriptChunks.push({
                    meetingId,
                    speaker: speakerName,
                    text: chunkText,
                    ts: chunkTsLabel,
                    timestamp: chunkTimestamp,
                });
            }
        } catch (aiErr) {
            console.error(`Failed to transcribe chunk ${file}:`, aiErr.message);
        }

        if (!KEEP_AUDIO_FILES) {
            fs.unlinkSync(filePath);
        } else {
            console.log(`🔒 Kept audio for verification: ${filePath}`);
        }
    }

    const normalizedTranscript = assembledTranscript.trim();
    if (!normalizedTranscript) {
        return {
            ok: false,
            reason: "transcription-empty",
            filesFound: files.length,
            transcriptVersion: meetingDoc.transcriptVersion || 0,
        };
    }

    meetingDoc.transcript = normalizedTranscript.slice(0, 50000);
    meetingDoc.transcriptVersion = (meetingDoc.transcriptVersion || 0) + 1;
    await TranscriptChunk.deleteMany({ meetingId });
    if (transcriptChunks.length) {
        await TranscriptChunk.insertMany(transcriptChunks, { ordered: true });
    }
    await meetingDoc.save();

    return {
        ok: true,
        reason: "transcript-updated",
        filesFound: files.length,
        chunksSaved: transcriptChunks.length,
        transcriptVersion: meetingDoc.transcriptVersion,
    };
}

function extractTasksFromTranscript(transcript, meetingId) {
    const lines = String(transcript || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 200);

    const toStart = [];
    const ongoing = [];

    for (const line of lines) {
        const clean = line.replace(/^[-*•\d.\s]+/, "").trim();
        if (!clean) continue;

        if (/(ongoing|in progress|wip|continuing|continue|working on)/i.test(clean)) {
            ongoing.push({ text: clean, sourceMeetingId: meetingId, edited: false });
            continue;
        }

        if (/(todo|to do|action|next step|pending|start|follow up)/i.test(clean)) {
            toStart.push({ text: clean, sourceMeetingId: meetingId, edited: false });
        }
    }

    return { toStart, ongoing };
}

function dedupeObjectiveItems(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const key = item.text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out.slice(0, 40);
}

app.get("/", (req, res) => {
    const token = getTokenFromRequest(req);
    if (!token) return res.sendFile(path.join(__dirname, "index.html"));

    try {
        jwt.verify(token, JWT_SECRET);
        return res.redirect("/dashboard");
    } catch {
        return res.sendFile(path.join(__dirname, "index.html"));
    }
});

app.get("/dashboard", pageAuthRequired, (req, res) => {
    res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.get("/meeting", pageAuthRequired, (req, res) => {
    res.sendFile(path.join(__dirname, "meeting.html"));
});

app.get("/logout", (req, res) => {
    res.clearCookie(TOKEN_COOKIE);
    res.redirect("/");
});

app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ ok: false, error: "Email and password are required" });
        }

        const user = await User.findOne({ email: String(email).toLowerCase() });
        if (!user || !user.isActive) {
            return res.status(401).json({ ok: false, error: "Invalid credentials" });
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
            return res.status(401).json({ ok: false, error: "Invalid credentials" });
        }

        const token = createToken(user);
        res.cookie(TOKEN_COOKIE, token, {
            httpOnly: true,
            sameSite: "lax",
            secure: false,
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        return res.json({ ok: true, user: userPayload(user) });
    } catch (err) {
        return res.status(500).json({ ok: false, error: "Login failed", details: err.message });
    }
});

app.post("/api/auth/logout", (req, res) => {
    res.clearCookie(TOKEN_COOKIE);
    return res.json({ ok: true });
});

app.get("/api/auth/me", authRequired, async (req, res) => {
    const user = await User.findById(req.user.id).select("name email role isActive");
    if (!user || !user.isActive) return res.status(401).json({ ok: false, error: "User not active" });
    return res.json({ ok: true, user: userPayload(user) });
});

app.post("/api/auth/users", authRequired, roleRequired("manager"), async (req, res) => {
    try {
        const { name, email, password, role } = req.body || {};
        if (!name || !email || !password || !role) {
            return res.status(400).json({ ok: false, error: "name, email, password, role are required" });
        }
        if (!["manager", "employee"].includes(role)) {
            return res.status(400).json({ ok: false, error: "Invalid role" });
        }
        if (String(password).length < 8) {
            return res.status(400).json({ ok: false, error: "Password must be at least 8 characters" });
        }

        const existing = await User.findOne({ email: String(email).toLowerCase() });
        if (existing) return res.status(409).json({ ok: false, error: "Email already exists" });

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await User.create({
            name: String(name).trim(),
            email: String(email).toLowerCase(),
            passwordHash,
            role,
        });

        return res.json({ ok: true, user: userPayload(user) });
    } catch (err) {
        return res.status(500).json({ ok: false, error: "User creation failed", details: err.message });
    }
});

app.get("/api/test", (req, res) => {
    return res.json({ ok: true, message: "API routes are working", timestamp: new Date().toISOString() });
});

app.get("/api/check-connection", (req, res) => {
    const connectionState = mongoose.connection.readyState;
    const states = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
    return res.json({ ok: connectionState === 1, connectionState: states[connectionState], uri: MONGO_URI });
});

app.get("/api/test-db", authRequired, async (req, res) => {
    try {
        const testMeeting = await Meeting.create({
            meetingId: `db-test-${Date.now()}`,
            meetingName: "DB Test",
            description: "Temp",
            transcript: null,
            status: "ended",
            startsAt: null,
            endsAt: new Date(),
            createdBy: req.user.id,
            createdByEmail: req.user.email,
        });
        await Meeting.deleteOne({ _id: testMeeting._id });
        return res.json({ ok: true, message: "Database write test successful" });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

app.post("/api/meetings", authRequired, roleRequired("manager"), async (req, res) => {
    try {
        const { meetingName, description = null, startsAt = null, endsAt = null } = req.body || {};
        if (!meetingName || !String(meetingName).trim()) {
            return res.status(400).json({ ok: false, error: "meetingName is required" });
        }

        const meetingId = crypto.randomUUID();
        const now = new Date();
        const parsedStartsAt = startsAt ? new Date(startsAt) : null;
        const parsedEndsAt = endsAt ? new Date(endsAt) : null;
        const status = parsedStartsAt && parsedStartsAt > now ? "scheduled" : "active";

        const meeting = await Meeting.create({
            meetingId,
            meetingName: String(meetingName).trim(),
            description: description ? String(description).trim() : null,
            transcript: null,
            status,
            startsAt: parsedStartsAt,
            endsAt: parsedEndsAt,
            createdBy: req.user.id,
            createdByEmail: req.user.email,
        });

        return res.json({ ok: true, meeting });
    } catch (err) {
        return res.status(500).json({ ok: false, error: "Meeting creation failed", details: err.message });
    }
});

// ✅ IMPORTANT: /history must be defined BEFORE /:meetingId to prevent route shadowing
app.get("/api/meetings/history", authRequired, async (req, res) => {
    try {
        // --- NEW LOGIC: Auto-sweep to mark expired meetings as "Dropped" ---
        // If a meeting has an end time, the time has passed, and it isn't "finished", drop it.
        await Meeting.updateMany(
            {
                status: { $in: ["scheduled", "active"] },
                endsAt: { $lt: new Date(), $ne: null }
            },
            { $set: { status: "dropped" } }
        );

        const hostedMeetings = await Meeting.find({ createdBy: req.user.id }).lean();
        const participations = await MeetingParticipant.find({ participantId: req.user.id })
            .sort({ joinTime: -1 })
            .lean();

        // ... (Keep the rest of the history logic exactly the same)

        const participatedMeetingIds = [...new Set(participations.map((p) => p.meetingId))];
        const participatedMeetings = await Meeting.find({ meetingId: { $in: participatedMeetingIds } }).lean();

        const map = new Map();

        for (const meeting of hostedMeetings) {
            map.set(meeting.meetingId, {
                meetingId: meeting.meetingId,
                meetingName: meeting.meetingName,
                description: meeting.description,
                status: meeting.status,
                startsAt: meeting.startsAt,
                endsAt: meeting.endsAt,
                createdAt: meeting.createdAt,
                updatedAt: meeting.updatedAt,
                participationRole: "hosted",
            });
        }

        for (const meeting of participatedMeetings) {
            const existing = map.get(meeting.meetingId);
            if (existing) {
                existing.participationRole = "hosted+participated";
            } else {
                map.set(meeting.meetingId, {
                    meetingId: meeting.meetingId,
                    meetingName: meeting.meetingName,
                    description: meeting.description,
                    status: meeting.status,
                    startsAt: meeting.startsAt,
                    endsAt: meeting.endsAt,
                    createdAt: meeting.createdAt,
                    updatedAt: meeting.updatedAt,
                    participationRole: "participated",
                });
            }
        }

        const meetings = Array.from(map.values()).sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );

        return res.json({ ok: true, meetings });
    } catch (err) {
        return res.status(500).json({ ok: false, error: "Failed to fetch history", details: err.message });
    }
});

// ✅ These parameterized routes are now safely below /history
app.get("/api/meetings/:meetingId", authRequired, async (req, res) => {
    const meeting = await Meeting.findOne({ meetingId: req.params.meetingId });
    if (!meeting) return res.status(404).json({ ok: false, error: "Meeting not found" });

    return res.json({
        ok: true,
        meeting,
        isHost: String(meeting.createdBy) === String(req.user.id),
    });
});

app.post("/api/meetings/:meetingId/transcript", authRequired, roleRequired("manager"), async (req, res) => {
    try {
        const { transcript } = req.body || {};
        if (transcript !== null && transcript !== undefined && String(transcript).length > 50000) {
            return res.status(400).json({ ok: false, error: "Transcript exceeds 50000 character limit" });
        }

        const meeting = await Meeting.findOne({ meetingId: req.params.meetingId });
        if (!meeting) return res.status(404).json({ ok: false, error: "Meeting not found" });
        if (String(meeting.createdBy) !== String(req.user.id)) {
            return res.status(403).json({ ok: false, error: "Only host manager can update transcript" });
        }

        const normalizedTranscript = transcript ? String(transcript).slice(0, 50000).trim() : "";
        meeting.transcript = normalizedTranscript || null;
        meeting.transcriptVersion += 1;
        await syncTranscriptChunks(meeting.meetingId, meeting.transcript);
        await meeting.save();

        return res.json({ ok: true, meetingId: meeting.meetingId, transcriptVersion: meeting.transcriptVersion });
    } catch (err) {
        return res.status(500).json({ ok: false, error: "Transcript update failed", details: err.message });
    }
});

app.post("/api/meetings/:meetingId/reprocess-audio", authRequired, roleRequired("manager"), async (req, res) => {
    try {
        const meetingId = String(req.params.meetingId || "").trim();
        if (!meetingId) return res.status(400).json({ ok: false, error: "meetingId is required" });

        const meeting = await Meeting.findOne({ meetingId });
        if (!meeting) return res.status(404).json({ ok: false, error: "Meeting not found" });
        if (String(meeting.createdBy) !== String(req.user.id)) {
            return res.status(403).json({ ok: false, error: "Only host manager can reprocess audio" });
        }

        const result = await processMeetingAudioToTranscript(meetingId, meeting);
        if (!result.ok) {
            return res.status(400).json({
                ok: false,
                error: "Audio reprocess did not produce a transcript",
                reason: result.reason,
                filesFound: result.filesFound,
            });
        }

        processTranscriptInBackground(meetingId, meeting, meeting.createdBy).catch((bgErr) => {
            console.error(`Background transcript processing failed for ${meetingId}:`, bgErr.message);
        });

        return res.json({
            ok: true,
            meetingId,
            transcriptVersion: result.transcriptVersion,
            filesFound: result.filesFound,
            chunksSaved: result.chunksSaved,
        });
    } catch (err) {
        return res.status(500).json({ ok: false, error: "Audio reprocess failed", details: err.message });
    }
});

app.get("/api/objectives/current", authRequired, roleRequired("manager"), async (req, res) => {
    const objectives = await ManagerObjective.findOne({ managerId: req.user.id }).lean();
    return res.json({
        ok: true,
        objectives: objectives || {
            sourceMeetingIds: [],
            toStart: [],
            ongoing: [],
            message: "No objectives generated yet.",
            missingTranscriptCount: 0,
            refreshedAt: null,
        },
    });
});

app.post("/api/objectives/refresh", authRequired, roleRequired("manager"), async (req, res) => {
    try {
        const hostedMeetings = await Meeting.find({ createdBy: req.user.id }).lean();
        const participations = await MeetingParticipant.find({ participantId: req.user.id }).lean();
        const participatedIds = [...new Set(participations.map((p) => p.meetingId))];
        const participatedMeetings = await Meeting.find({ meetingId: { $in: participatedIds } }).lean();

        const combined = new Map();
        [...hostedMeetings, ...participatedMeetings].forEach((meeting) => {
            combined.set(meeting.meetingId, meeting);
        });

        const lastFive = Array.from(combined.values())
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
            .slice(0, 5);

        const transcriptMeetings = lastFive.filter((meeting) => meeting.transcript && meeting.transcript.trim());
        const missingTranscriptCount = Math.max(0, lastFive.length - transcriptMeetings.length);

        let toStart = [];
        let ongoing = [];

        for (const meeting of transcriptMeetings) {
            const extracted = extractTasksFromTranscript(meeting.transcript, meeting.meetingId);
            toStart = toStart.concat(extracted.toStart);
            ongoing = ongoing.concat(extracted.ongoing);
        }

        toStart = dedupeObjectiveItems(toStart);
        ongoing = dedupeObjectiveItems(ongoing);

        const message = `Processed ${transcriptMeetings.length}/${lastFive.length} transcripts (${missingTranscriptCount} missing).`;

        const doc = await ManagerObjective.findOneAndUpdate(
            { managerId: req.user.id },
            {
                managerId: req.user.id,
                sourceMeetingIds: lastFive.map((meeting) => meeting.meetingId),
                toStart,
                ongoing,
                message,
                missingTranscriptCount,
                refreshedAt: new Date(),
            },
            { upsert: true, new: true }
        );

        return res.json({ ok: true, objectives: doc });
    } catch (err) {
        return res.status(500).json({ ok: false, error: "Objective refresh failed", details: err.message });
    }
});

app.put("/api/objectives/current", authRequired, roleRequired("manager"), async (req, res) => {
    try {
        const { toStart = [], ongoing = [] } = req.body || {};

        const normalize = (items) =>
            (Array.isArray(items) ? items : [])
                .map((item) => ({
                    text: String(item.text || "").trim(),
                    sourceMeetingId: item.sourceMeetingId || null,
                    edited: true,
                }))
                .filter((item) => item.text)
                .slice(0, 40);

        const doc = await ManagerObjective.findOneAndUpdate(
            { managerId: req.user.id },
            {
                $set: {
                    toStart: normalize(toStart),
                    ongoing: normalize(ongoing),
                    refreshedAt: new Date(),
                },
            },
            { new: true, upsert: true }
        );

        return res.json({ ok: true, objectives: doc });
    } catch (err) {
        return res.status(500).json({ ok: false, error: "Objective update failed", details: err.message });
    }
});

app.post("/api/participants", authRequired, async (req, res) => {
    try {
        const { meetingId, socketId, action } = req.body || {};
        if (!meetingId || !socketId) {
            return res.status(400).json({ ok: false, error: "meetingId and socketId are required" });
        }

        const meetingDate = toIsoDate();

        if (action === "leave") {
            const updated = await MeetingParticipant.findOneAndUpdate(
                { meetingId, participantId: req.user.id },
                { leaveTime: new Date() },
                { new: true }
            );
            return res.json({ ok: true, action: "leave", id: updated?._id || null });
        }

        const doc = await MeetingParticipant.findOneAndUpdate(
            { meetingId, participantId: req.user.id },
            {
                meetingId,
                participantId: req.user.id,
                participantEmail: req.user.email,
                participantName: req.user.name,
                socketId,
                joinTime: new Date(),
                leaveTime: null,
                isHost: false,
                meetingDate,
            },
            { upsert: true, new: true }
        );

        return res.json({ ok: true, action: "join", id: doc._id });
    } catch (err) {
        return res.status(500).json({ ok: false, error: "Internal server error", details: err.message });
    }
});

app.get("/api/participants/:meetingId", authRequired, async (req, res) => {
    try {
        const participants = await MeetingParticipant.find({ meetingId: req.params.meetingId }).sort({ joinTime: -1 });
        return res.json({ ok: true, count: participants.length, participants });
    } catch {
        return res.status(500).json({ ok: false, error: "Internal server error" });
    }
});

app.post("/api/summaries", authRequired, async (req, res) => {
    try {
        const { meetingId, summaryHtml } = req.body || {};
        if (!meetingId || !summaryHtml) {
            return res.status(400).json({ ok: false, error: "meetingId and summaryHtml are required" });
        }

        const doc = await MeetingSummary.create({
            meetingId,
            summaryHtml,
            hostEmail: req.user.email,
            meetingDate: toIsoDate(),
        });

        // --- NEW LOGIC: Mark the meeting as "Finished" in the DB ---
        await Meeting.findOneAndUpdate(
            { meetingId: meetingId },
            { status: "finished" }
        );

        return res.json({ ok: true, id: doc._id });
    } catch (err) {
        return res.status(500).json({ ok: false, error: "Internal server error", details: err.message });
    }
});

app.get("/api/summaries", authRequired, async (req, res) => {
    try {
        const summaries = await MeetingSummary.find({ hostEmail: req.user.email }).sort({ createdAt: -1 }).limit(50);
        return res.json({ ok: true, count: summaries.length, summaries });
    } catch (err) {
        return res.status(500).json({ ok: false, error: "Internal server error", details: err.message });
    }
});

// GET all meeting summaries for the logged-in manager, joined with meeting name
app.get("/api/meeting-summaries", authRequired, roleRequired("manager"), async (req, res) => {
    try {
        // Fetch all summaries where hostEmail matches this manager
        const summaries = await MeetingSummary.find({ hostEmail: req.user.email })
            .sort({ createdAt: -1 });

        // Enrich each summary with the meeting name from the meetings collection
        const enriched = await Promise.all(summaries.map(async (s) => {
            const meeting = await Meeting.findOne({ meetingId: s.meetingId }).select("meetingName");
            return {
                _id: s._id,
                meetingId: s.meetingId,
                meetingName: meeting?.meetingName || s.meetingId,
                summaryHtml: s.summaryHtml,
                hostEmail: s.hostEmail,
                meetingDate: s.meetingDate,
                createdAt: s.createdAt,
            };
        }));

        return res.json({ ok: true, summaries: enriched });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

app.get("/api/summaries/:meetingId", authRequired, async (req, res) => {
    try {
        const summaries = await MeetingSummary.find({ meetingId: req.params.meetingId }).sort({ createdAt: -1 });
        return res.json({ ok: true, count: summaries.length, summaries });
    } catch {
        return res.status(500).json({ ok: false, error: "Internal server error" });
    }
});

app.post("/api/generate-summary", authRequired, async (req, res) => {
    try {
        if (!hasGroqSummaryKey()) {
            return res.status(500).json({ ok: false, error: "GROQ summary API key is not configured on server" });
        }

        const { notes, meetingDate } = req.body || {};
        if (!notes || !notes.trim()) {
            return res.status(400).json({ ok: false, error: "notes is required to generate a summary" });
        }

        const safeDate = meetingDate || toIsoDate();

        // Use Groq's LLaMA 3 model instead of OpenAI's GPT
        const completion = await groqSummary.chat.completions.create({
            model: GROQ_TEXT_MODEL,
            messages: [
                {
                    role: "system",
                    content:
                        "You are an assistant that turns raw meeting notes into a concise HTML summary with action items. Respond ONLY with HTML - paragraphs and <ul>/<li> lists, no surrounding <html> or <body> tags.",
                },
                {
                    role: "user",
                    content: `Host: ${req.user.email}\nDate: ${safeDate}\n\nMeeting notes:\n${notes}`,
                },
            ],
            temperature: 0.4,
        });

        const summaryHtml = completion.choices?.[0]?.message?.content?.trim() || "<p>No summary could be generated.</p>";
        return res.json({ ok: true, summaryHtml });
    } catch (err) {
        console.error("AI Summary Error:", err);
        return res.status(500).json({ ok: false, error: "AI summary generation failed" });
    }
});

app.get("/api/ngrok", async (req, res) => {
    try {
        const ngrokUrl = "http://127.0.0.1:4040/api/tunnels";
        const parsedUrl = url.parse(ngrokUrl);

        const data = await new Promise((resolve, reject) => {
            const requestOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port,
                path: parsedUrl.path,
                method: "GET",
            };

            const reqNgrok = http.request(requestOptions, (resp) => {
                let body = "";
                resp.on("data", (chunk) => {
                    body += chunk;
                });
                resp.on("end", () => {
                    if (resp.statusCode !== 200) return reject(new Error(`HTTP ${resp.statusCode}`));
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            reqNgrok.on("error", reject);
            reqNgrok.end();
        });

        const tunnels = data.tunnels || [];
        const tunnel = tunnels.find((t) => t.proto === "https") || tunnels[0];
        if (!tunnel || !tunnel.public_url) {
            return res.status(404).json({ ok: false, error: "no ngrok tunnels found" });
        }
        return res.json({ ok: true, url: tunnel.public_url });
    } catch {
        return res.status(500).json({ ok: false, error: "failed to query ngrok" });
    }
});

// ═══════════════════════════════════════════════════════════════════════
// DEBUG — list and download saved audio files (for verification via ngrok)
// ═══════════════════════════════════════════════════════════════════════
app.get("/api/debug/audio-files/:meetingId", (req, res) => {
    try {
        const { meetingId } = req.params;
        if (!meetingId || !/^[a-zA-Z0-9_-]+$/.test(meetingId)) {
            return res.status(400).json({ ok: false, error: "Invalid meetingId" });
        }
        const files = fs.readdirSync(UPLOADS_DIR)
            .filter((f) => f.startsWith(meetingId) && f.endsWith(".webm"))
            .map((f) => {
                const stat = fs.statSync(path.join(UPLOADS_DIR, f));
                return { name: f, size: stat.size, sizeKB: (stat.size / 1024).toFixed(2) };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
        return res.json({ ok: true, meetingId, files, uploadsPath: UPLOADS_DIR });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

app.get("/api/debug/audio-files/:meetingId/:filename", (req, res) => {
    try {
        const { meetingId, filename } = req.params;
        if (!meetingId || !filename || !/^[a-zA-Z0-9_-]+$/.test(meetingId)) {
            return res.status(400).json({ ok: false, error: "Invalid meetingId" });
        }
        if (!filename.startsWith(meetingId) || !filename.endsWith(".webm") || filename.includes("..")) {
            return res.status(400).json({ ok: false, error: "Invalid filename" });
        }
        const filePath = path.join(UPLOADS_DIR, filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ ok: false, error: "File not found" });
        }
        res.setHeader("Content-Type", "audio/webm");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.sendFile(path.resolve(filePath));
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

app.get("/api/debug/audio-health/:meetingId", authRequired, async (req, res) => {
    try {
        const meetingId = String(req.params.meetingId || "").trim();
        if (!meetingId) return res.status(400).json({ ok: false, error: "meetingId is required" });

        const meeting = await Meeting.findOne({ meetingId }).lean();
        const files = getMeetingAudioFiles(meetingId);
        const fileStats = files.slice(-5).map((file) => {
            const filePath = path.join(UPLOADS_DIR, file);
            const st = fs.statSync(filePath);
            return {
                file,
                bytes: st.size,
                lastModified: st.mtime,
            };
        });

        const runtime = audioDebugMap.get(meetingId) || {
            chunksReceived: 0,
            bytesReceived: 0,
            lastChunkAt: null,
            lastFileName: null,
            lastMimeType: null,
            lastError: null,
        };

        return res.json({
            ok: true,
            meetingId,
            meeting: meeting
                ? {
                    status: meeting.status,
                    transcriptVersion: meeting.transcriptVersion,
                    hasTranscript: Boolean(meeting.transcript && String(meeting.transcript).trim()),
                    createdAt: meeting.createdAt,
                    updatedAt: meeting.updatedAt,
                    endsAt: meeting.endsAt,
                }
                : null,
            runtime,
            filesFound: files.length,
            latestFiles: fileStats,
        });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════
// TRANSCRIPT — save raw transcript for a meeting (host only)
// ═══════════════════════════════════════════════════════════════════════
app.post("/api/meetings/:meetingId/save-transcript", authRequired, async (req, res) => {
    try {
        const { transcript } = req.body || {};
        if (!transcript || !String(transcript).trim()) {
            return res.status(400).json({ ok: false, error: "transcript is required" });
        }
        const meeting = await Meeting.findOne({ meetingId: req.params.meetingId });
        if (!meeting) return res.status(404).json({ ok: false, error: "Meeting not found" });

        meeting.transcript = String(transcript).slice(0, 50000).trim();
        meeting.transcriptVersion += 1;
        await syncTranscriptChunks(meeting.meetingId, meeting.transcript);
        await meeting.save();

        return res.json({ ok: true, meetingId: meeting.meetingId, transcriptVersion: meeting.transcriptVersion });
    } catch (err) {
        return res.status(500).json({ ok: false, error: "Failed to save transcript", details: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════
// PROJECT SUMMARY — Groq summarise + merge into project-level doc
// POST /api/project-summary/process  { meetingId }
// ═══════════════════════════════════════════════════════════════════════
app.post("/api/project-summary/process", authRequired, async (req, res) => {
    try {
        if (!hasGroqSummaryKey()) {
            return res.status(500).json({ ok: false, error: "GROQ summary API key is not configured on server" });
        }

        const { meetingId } = req.body || {};
        if (!meetingId) return res.status(400).json({ ok: false, error: "meetingId is required" });

        const meeting = await Meeting.findOne({ meetingId });
        if (!meeting) return res.status(404).json({ ok: false, error: "Meeting not found" });

        // --- NEW LOGIC: Assemble the transcript from the database chunks ---
        const chunks = await TranscriptChunk.find({ meetingId }).sort({ timestamp: 1 });
        if (chunks.length > 0) {
            meeting.transcript = chunks.map(c => `[${c.ts}] ${c.speaker}: ${c.text}`).join("\n");
            await meeting.save();
        }

        if (!meeting.transcript || !meeting.transcript.trim()) {
            return res.status(400).json({ ok: false, error: "Meeting has no transcript to summarize" });
        }


        const projectName = meeting.meetingName.trim();
        const managerId = req.user.id;

        // --- Step 1: Generate summary for THIS meeting's transcript ---
        const newSummaryCompletion = await groqSummary.chat.completions.create({
            model: GROQ_TEXT_MODEL,
            messages: [
                {
                    role: "system",
                    content: `You are a technical project manager assistant for software engineering teams.
Summarize the provided meeting transcript into:
1. A brief overview paragraph (what was discussed)
2. Key decisions made
3. Progress updates

Return ONLY clean plain text with labeled sections. Be concise.`
                },
                {
                    role: "user",
                    content: `Meeting: "${projectName}"
Date: ${new Date().toISOString().slice(0, 10)}

Transcript:
${meeting.transcript.slice(0, 15000)}`
                }
            ],
            temperature: 0.3,
            max_tokens: 1024,
        });

        const newSummaryText = newSummaryCompletion.choices?.[0]?.message?.content?.trim() || "";

        // --- Step 2: Check if project doc exists; merge if so ---
        const existing = await ProjectSummary.findOne({ projectName, managerId });
        let finalSummaryText = newSummaryText;

        if (existing && existing.summaryText) {
            const mergeCompletion = await groqSummary.chat.completions.create({
                model: GROQ_TEXT_MODEL,
                messages: [
                    {
                        role: "system",
                        content: `You are a technical project manager assistant. 
You will receive two meeting summaries for the same project ("${projectName}"). 
Merge them into ONE unified project progress document. Do NOT just concatenate — intelligently combine, eliminate duplicates, update progress, and keep the latest status.
Structure your output as:
## Project Overview
## Key Decisions
## Progress & Updates
## Current Status

Return ONLY the merged document as plain text.`
                    },
                    {
                        role: "user",
                        content: `EXISTING PROJECT SUMMARY:
${existing.summaryText}

---

NEW MEETING SUMMARY:
${newSummaryText}`
                    }
                ],
                temperature: 0.2,
                max_tokens: 2048,
            });
            finalSummaryText = mergeCompletion.choices?.[0]?.message?.content?.trim() || newSummaryText;
        }

        // --- Step 3: Convert to HTML ---
        const htmlCompletion = await groqSummary.chat.completions.create({
            model: GROQ_TEXT_MODEL,
            messages: [
                {
                    role: "system",
                    content: "Convert the following plain-text project summary into clean, readable HTML using <h3>, <p>, <ul>, <li>, <strong> tags only. No <html>, <body>, or <head> tags. No markdown."
                },
                { role: "user", content: finalSummaryText }
            ],
            temperature: 0.1,
            max_tokens: 2048,
        });
        const finalSummaryHtml = htmlCompletion.choices?.[0]?.message?.content?.trim() || `<p>${finalSummaryText}</p>`;

        // --- Step 4: Upsert ProjectSummary ---
        const meetingIds = existing ? [...new Set([...existing.meetingIds, meetingId])] : [meetingId];
        const projectDoc = await ProjectSummary.findOneAndUpdate(
            { projectName, managerId },
            { projectName, summaryText: finalSummaryText, summaryHtml: finalSummaryHtml, meetingIds, managerId, lastUpdated: new Date() },
            { upsert: true, new: true }
        );

        // --- Step 5: Extract tasks from transcript via Groq ---
        const taskCompletion = await groqSummary.chat.completions.create({
            model: GROQ_TEXT_MODEL,
            messages: [
                {
                    role: "system",
                    content: `You are a task extractor for software engineering teams.
Extract ALL actionable tasks from the meeting transcript. For each task identify:
- title: short action title (max 80 chars)
- description: more detail if available (can be empty)
- priority: "high", "medium", or "low"
- status: "todo" (new tasks) or "in_progress" (mentioned as ongoing)

If the transcript mentions a task is COMPLETED/DONE/FINISHED, mark status as "done".

Respond ONLY with a valid JSON array, no other text:
[{"title":"...", "description":"...", "priority":"medium", "status":"todo"}, ...]`
                },
                {
                    role: "user",
                    content: `Project: "${projectName}"

Transcript:
${meeting.transcript.slice(0, 15000)}`
                }
            ],
            temperature: 0.1,
            max_tokens: 2048,
        });

        let extractedTasks = [];
        try {
            const raw = taskCompletion.choices?.[0]?.message?.content?.trim() || "[]";
            const cleaned = raw.replace(/```json|```/g, "").trim();
            extractedTasks = JSON.parse(cleaned);
        } catch {
            extractedTasks = [];
        }

        // --- Step 6: For each extracted task, check for duplicates then insert ---
        const existingTasks = await ProjectTask.find({ projectName, managerId });
        const existingTitles = existingTasks.map(t => t.title.toLowerCase().trim());

        let addedCount = 0;
        let updatedCount = 0;

        for (const task of extractedTasks) {
            if (!task.title || !task.title.trim()) continue;
            const titleKey = task.title.toLowerCase().trim();
            const dupIdx = existingTitles.indexOf(titleKey);

            if (dupIdx !== -1) {
                // If Groq says it's done now, update existing task status
                if (task.status === "done") {
                    await ProjectTask.findByIdAndUpdate(existingTasks[dupIdx]._id, { status: "done" });
                    updatedCount++;
                }
            } else {
                await ProjectTask.create({
                    projectName,
                    managerId,
                    title: task.title.trim().slice(0, 300),
                    description: (task.description || "").trim().slice(0, 1000),
                    priority: ["low", "medium", "high"].includes(task.priority) ? task.priority : "medium",
                    status: ["todo", "in_progress", "done"].includes(task.status) ? task.status : "todo",
                    sourceMeetingId: meetingId,
                    addedManually: false,
                });
                addedCount++;
            }
        }

        // Mark meeting as finished
        await Meeting.findOneAndUpdate({ meetingId }, { status: "finished" });

        return res.json({
            ok: true,
            projectName,
            isNewProject: !existing,
            tasksAdded: addedCount,
            tasksUpdated: updatedCount,
            summary: projectDoc,
        });
    } catch (err) {
        return res.status(500).json({ ok: false, error: "Project summary processing failed", details: err.message });
    }
});

// GET project summary by project name
app.get("/api/project-summary/:projectName", authRequired, async (req, res) => {
    try {
        const doc = await ProjectSummary.findOne({
            projectName: decodeURIComponent(req.params.projectName),
            managerId: req.user.id
        });
        if (!doc) return res.status(404).json({ ok: false, error: "No summary found for this project" });
        return res.json({ ok: true, summary: doc });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET all project summaries for this manager
app.get("/api/project-summaries", authRequired, roleRequired("manager"), async (req, res) => {
    try {
        const summaries = await ProjectSummary.find({ managerId: req.user.id }).sort({ lastUpdated: -1 });
        return res.json({ ok: true, summaries });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════
// PROJECT TASKS — full CRUD
// ═══════════════════════════════════════════════════════════════════════

// GET all tasks for a project
app.get("/api/project-tasks/:projectName", authRequired, async (req, res) => {
    try {
        const tasks = await ProjectTask.find({
            projectName: decodeURIComponent(req.params.projectName),
            managerId: req.user.id
        }).sort({ order: 1, createdAt: 1 });
        return res.json({ ok: true, tasks });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET all projects that have tasks (for manager overview)
app.get("/api/project-tasks", authRequired, roleRequired("manager"), async (req, res) => {
    try {
        const projects = await ProjectTask.distinct("projectName", { managerId: req.user.id });
        const result = [];
        for (const projectName of projects) {
            const tasks = await ProjectTask.find({ projectName, managerId: req.user.id }).sort({ order: 1, createdAt: 1 });
            result.push({ projectName, tasks });
        }
        return res.json({ ok: true, projects: result });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// POST create a task manually
app.post("/api/project-tasks", authRequired, roleRequired("manager"), async (req, res) => {
    try {
        const { projectName, title, description, priority, status } = req.body || {};
        if (!projectName || !title) return res.status(400).json({ ok: false, error: "projectName and title are required" });
        const task = await ProjectTask.create({
            projectName: String(projectName).trim(),
            managerId: req.user.id,
            title: String(title).trim().slice(0, 300),
            description: String(description || "").trim().slice(0, 1000),
            priority: ["low", "medium", "high"].includes(priority) ? priority : "medium",
            status: ["todo", "in_progress", "done"].includes(status) ? status : "todo",
            addedManually: true,
        });
        return res.json({ ok: true, task });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// PATCH update a task (status, title, description, priority)
app.patch("/api/project-tasks/:taskId", authRequired, roleRequired("manager"), async (req, res) => {
    try {
        const { title, description, priority, status } = req.body || {};
        const update = {};
        if (title !== undefined) update.title = String(title).trim().slice(0, 300);
        if (description !== undefined) update.description = String(description).trim().slice(0, 1000);
        if (priority && ["low", "medium", "high"].includes(priority)) update.priority = priority;
        if (status && ["todo", "in_progress", "done"].includes(status)) update.status = status;

        const task = await ProjectTask.findOneAndUpdate(
            { _id: req.params.taskId, managerId: req.user.id },
            update,
            { new: true }
        );
        if (!task) return res.status(404).json({ ok: false, error: "Task not found" });
        return res.json({ ok: true, task });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// DELETE a task
app.delete("/api/project-tasks/:taskId", authRequired, roleRequired("manager"), async (req, res) => {
    try {
        await ProjectTask.findOneAndDelete({ _id: req.params.taskId, managerId: req.user.id });
        return res.json({ ok: true });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

app.use(express.static(path.join(__dirname)));
app.use("/models", express.static(path.join(__dirname, "models")));

io.use((socket, next) => {
    try {
        const cookies = parseCookieHeader(socket.handshake.headers.cookie || "");
        const token = cookies[TOKEN_COOKIE];
        if (!token) return next(new Error("Unauthorized"));
        const payload = jwt.verify(token, JWT_SECRET);
        socket.user = payload;
        return next();
    } catch {
        return next(new Error("Unauthorized"));
    }
});

const socketMeetingMap = new Map();
const peerInfoMap = {};
const disconnectedUsers = {};
const audioDebugMap = new Map();
// lobbyMap: meetingId -> Map<socketId, { name, email, socket }>
const lobbyMap = new Map();
// meetingSettingsMap: meetingId -> { lobbyEnabled: boolean }
const meetingSettingsMap = new Map();

function getAudioDebugState(meetingId) {
    if (!audioDebugMap.has(meetingId)) {
        audioDebugMap.set(meetingId, {
            chunksReceived: 0,
            bytesReceived: 0,
            lastChunkAt: null,
            lastFileName: null,
            lastMimeType: null,
            lastError: null,
        });
    }
    return audioDebugMap.get(meetingId);
}

// ─── Background AI pipeline (called after transcript is assembled) ───────────
async function processTranscriptInBackground(meetingId, meeting, managerId) {
    if (!hasGroqSummaryKey()) return;
    try {
        const projectName = meeting.meetingName.trim();
        const transcript  = meeting.transcript;

        // Step 1: Summarise this meeting
        const sumRes = await groqSummary.chat.completions.create({
            model: GROQ_TEXT_MODEL,
            messages: [
                {
                    role: "system",
                    content: `You are a technical project manager for software engineering teams.
Summarize the meeting transcript into:
1. A brief overview paragraph
2. Key decisions made
3. Progress updates
Return ONLY clean plain text with labeled sections.`
                },
                {
                    role: "user",
                    content: `Meeting: "${projectName}"\nDate: ${new Date().toISOString().slice(0,10)}\n\nTranscript:\n${transcript.slice(0, 15000)}`
                }
            ],
            temperature: 0.3, max_tokens: 1024,
        });
        const newSummaryText = sumRes.choices?.[0]?.message?.content?.trim() || "";

        // Step 2: Merge with existing project summary if present
        const existing = await ProjectSummary.findOne({ projectName, managerId });
        let finalText = newSummaryText;
        if (existing?.summaryText) {
            const mergeRes = await groqSummary.chat.completions.create({
                model: GROQ_TEXT_MODEL,
                messages: [
                    { role: "system", content: `Merge two summaries for project "${projectName}" into ONE document. Structure: ## Project Overview, ## Key Decisions, ## Progress & Updates, ## Current Status. Return plain text only.` },
                    { role: "user", content: `EXISTING:\n${existing.summaryText}\n\n---\n\nNEW:\n${newSummaryText}` }
                ],
                temperature: 0.2, max_tokens: 2048,
            });
            finalText = mergeRes.choices?.[0]?.message?.content?.trim() || newSummaryText;
        }

        // Step 3: Convert to HTML
        const htmlRes = await groqSummary.chat.completions.create({
            model: GROQ_TEXT_MODEL,
            messages: [
                { role: "system", content: "Convert to HTML using only <h3>,<p>,<ul>,<li>,<strong>. No <html>/<body>/<head>. No markdown." },
                { role: "user", content: finalText }
            ],
            temperature: 0.1, max_tokens: 2048,
        });
        const finalHtml = htmlRes.choices?.[0]?.message?.content?.trim() || `<p>${finalText}</p>`;

        // Step 4: Upsert ProjectSummary
        const meetingIds = existing ? [...new Set([...existing.meetingIds, meetingId])] : [meetingId];
        await ProjectSummary.findOneAndUpdate(
            { projectName, managerId },
            { projectName, summaryText: finalText, summaryHtml: finalHtml, meetingIds, managerId, lastUpdated: new Date() },
            { upsert: true, new: true }
        );

        // Step 5: Extract tasks
        const taskRes = await groqSummary.chat.completions.create({
            model: GROQ_TEXT_MODEL,
            messages: [
                { role: "system", content: `Extract tasks from transcript. Return ONLY a JSON array:\n[{"title":"...","description":"...","priority":"medium","status":"todo"}]\nMark finished tasks as "done".` },
                { role: "user", content: `Project: "${projectName}"\n\n${transcript.slice(0, 15000)}` }
            ],
            temperature: 0.1, max_tokens: 2048,
        });
        let tasks = [];
        try {
            const raw = taskRes.choices?.[0]?.message?.content?.trim() || "[]";
            tasks = JSON.parse(raw.replace(/```json|```/g, "").trim());
        } catch { tasks = []; }

        const existingTasks  = await ProjectTask.find({ projectName, managerId });
        const existingTitles = existingTasks.map(t => t.title.toLowerCase().trim());
        let added = 0, updated = 0;
        for (const t of tasks) {
            if (!t.title?.trim()) continue;
            const key = t.title.toLowerCase().trim();
            const idx = existingTitles.indexOf(key);
            if (idx !== -1) {
                if (t.status === "done") { await ProjectTask.findByIdAndUpdate(existingTasks[idx]._id, { status: "done" }); updated++; }
            } else {
                await ProjectTask.create({
                    projectName, managerId,
                    title: t.title.trim().slice(0, 300),
                    description: (t.description || "").trim().slice(0, 1000),
                    priority: ["low","medium","high"].includes(t.priority) ? t.priority : "medium",
                    status: ["todo","in_progress","done"].includes(t.status) ? t.status : "todo",
                    sourceMeetingId: meetingId, addedManually: false,
                });
                added++;
            }
        }
        console.log(`✅ AI pipeline done for "${projectName}": ${added} tasks added, ${updated} updated`);
    } catch (err) {
        console.error(`❌ AI pipeline error for ${meetingId}:`, err.message);
    }
}

io.on("connection", (socket) => {
    const userId = socket.user.id;

    if (disconnectedUsers[userId]) {
        clearTimeout(disconnectedUsers[userId]);
        delete disconnectedUsers[userId];
    }

    socket.joinData = {
        socketId: socket.id,
        joinTime: new Date(),
        userId,
        email: socket.user.email,
        name: socket.user.name,
    };

    // ── Helper: fully admit a socket into the meeting room ─────────────────
    async function admitSocketIntoMeeting(targetSocket, meetingId, meeting) {
        targetSocket.join(meetingId);
        socketMeetingMap.set(targetSocket.id, meetingId);
        targetSocket.joinData.meetingId = meetingId;
        targetSocket.joinData.meetingDate = toIsoDate();

        await MeetingParticipant.findOneAndUpdate(
            { meetingId, participantId: targetSocket.user.id },
            {
                meetingId,
                participantId: targetSocket.user.id,
                participantEmail: targetSocket.user.email,
                participantName: targetSocket.user.name,
                socketId: targetSocket.id,
                isHost: targetSocket.joinData.isHost,
                joinTime: new Date(),
                leaveTime: null,
                meetingDate: toIsoDate(),
            },
            { upsert: true, new: true }
        );

        peerInfoMap[targetSocket.id] = { email: targetSocket.user.email };

        const peerIdsInMeeting = Array.from(io.sockets.adapter.rooms.get(meetingId) || []).filter((id) => id !== targetSocket.id);
        targetSocket.emit("existing-peers", { peerIds: peerIdsInMeeting });
        if (targetSocket.joinData.isHost) {
            targetSocket.emit("you-are-new-host");
        }
        targetSocket.to(meetingId).emit("new-peer", { socketId: targetSocket.id });
        targetSocket.to(meetingId).emit("peer-info", { socketId: targetSocket.id, email: targetSocket.user.email, name: targetSocket.user.name });
    }

    socket.on("join-meeting", async (data) => {
        const meetingId = (data?.meetingId || "").trim();
        if (!meetingId) return;

        const meeting = await Meeting.findOne({ meetingId });
        if (!meeting) {
            socket.emit("join-error", { error: "Meeting does not exist" });
            return;
        }

        socket.joinData.meetingId = meetingId;
        socket.joinData.meetingDate = toIsoDate();
        socket.joinData.isHost = String(meeting.createdBy) === String(userId);

        if (meeting.status === "scheduled") {
            meeting.status = "active";
            await meeting.save();
        }

        // ── HOST: bypass lobby, enter directly ─────────────────────────────
        if (socket.joinData.isHost) {
            await admitSocketIntoMeeting(socket, meetingId, meeting);

            // Seed default settings if first host join
            if (!meetingSettingsMap.has(meetingId)) {
                meetingSettingsMap.set(meetingId, { lobbyEnabled: true });
            }
            // Send current settings to the host
            socket.emit("meeting-settings", meetingSettingsMap.get(meetingId));

            // Notify host of anyone already waiting in the lobby
            const waiting = lobbyMap.get(meetingId);
            if (waiting && waiting.size > 0) {
                waiting.forEach((info) => {
                    socket.emit("lobby-user-waiting", {
                        socketId: info.socketId,
                        name: info.name,
                        email: info.email,
                    });
                });
            }
            return;
        }

        // ── NON-HOST: check if host is present in the room ─────────────────
        const roomSockets = Array.from(io.sockets.adapter.rooms.get(meetingId) || []);
        const hostPresent = roomSockets.some((sid) => {
            const s = io.sockets.sockets.get(sid);
            return s && s.joinData && s.joinData.isHost && s.joinData.meetingId === meetingId;
        });

        // If lobby is disabled, admit participant directly
        const settings = meetingSettingsMap.get(meetingId) || { lobbyEnabled: true };
        if (!settings.lobbyEnabled) {
            await admitSocketIntoMeeting(socket, meetingId, meeting);
            return;
        }

        if (!hostPresent) {
            // No host yet — put participant in lobby and wait
            if (!lobbyMap.has(meetingId)) lobbyMap.set(meetingId, new Map());
            lobbyMap.get(meetingId).set(socket.id, {
                socketId: socket.id,
                name: socket.user.name,
                email: socket.user.email,
                socket,
                meeting,
            });
            socket.emit("placed-in-lobby", { reason: "no-host", meetingName: meeting.meetingName });
            return;
        }

        // Host is present — place participant in lobby and notify host
        if (!lobbyMap.has(meetingId)) lobbyMap.set(meetingId, new Map());
        lobbyMap.get(meetingId).set(socket.id, {
            socketId: socket.id,
            name: socket.user.name,
            email: socket.user.email,
            socket,
            meeting,
        });

        socket.emit("placed-in-lobby", { reason: "waiting", meetingName: meeting.meetingName });

        // Find host socket(s) and tell them someone is knocking
        roomSockets.forEach((sid) => {
            const s = io.sockets.sockets.get(sid);
            if (s && s.joinData && s.joinData.isHost && s.joinData.meetingId === meetingId) {
                s.emit("lobby-user-waiting", {
                    socketId: socket.id,
                    name: socket.user.name,
                    email: socket.user.email,
                });
            }
        });
    });

    // ── Host admits a waiting participant ───────────────────────────────────
    socket.on("admit-user", async ({ targetSocketId, meetingId }) => {
        if (!socket.joinData?.isHost) return;
        const lobby = lobbyMap.get(meetingId);
        if (!lobby) return;
        const entry = lobby.get(targetSocketId);
        if (!entry) return;

        lobby.delete(targetSocketId);
        if (lobby.size === 0) lobbyMap.delete(meetingId);

        await admitSocketIntoMeeting(entry.socket, meetingId, entry.meeting);
        entry.socket.emit("admitted-to-meeting");

        // Tell existing participants (so they can greet)
        socket.to(meetingId).emit("participant-admitted", { name: entry.name, email: entry.email });
    });

    // ── Host denies a waiting participant ───────────────────────────────────
    socket.on("deny-user", ({ targetSocketId, meetingId }) => {
        if (!socket.joinData?.isHost) return;
        const lobby = lobbyMap.get(meetingId);
        if (!lobby) return;
        const entry = lobby.get(targetSocketId);
        if (!entry) return;

        lobby.delete(targetSocketId);
        if (lobby.size === 0) lobbyMap.delete(meetingId);

        entry.socket.emit("denied-from-meeting");
    });

    // ── Host updates meeting settings ───────────────────────────────────
    socket.on("update-meeting-settings", ({ meetingId, settings }) => {
        if (!socket.joinData?.isHost) return;
        if (!meetingId || !settings) return;

        const current = meetingSettingsMap.get(meetingId) || { lobbyEnabled: true };
        const updated = { ...current };

        // Only allow known boolean flags
        if (typeof settings.lobbyEnabled === "boolean") {
            updated.lobbyEnabled = settings.lobbyEnabled;
        }

        meetingSettingsMap.set(meetingId, updated);

        // Broadcast new settings to all room members so UI stays in sync
        io.in(meetingId).emit("meeting-settings", updated);

        // If lobby was just DISABLED, auto-admit everyone waiting in lobby
        if (!updated.lobbyEnabled) {
            const lobby = lobbyMap.get(meetingId);
            if (lobby && lobby.size > 0) {
                lobby.forEach(async (entry) => {
                    await admitSocketIntoMeeting(entry.socket, meetingId, entry.meeting);
                    entry.socket.emit("admitted-to-meeting");
                    socket.to(meetingId).emit("participant-admitted", { name: entry.name, email: entry.email });
                });
                lobbyMap.delete(meetingId);
            }
        }
    });

    // ── Host: mute ALL participants ─────────────────────────────────────────
    socket.on("host-mute-all", ({ meetingId }) => {
        if (!socket.joinData?.isHost) return;
        const effectiveMeetingId = meetingId || socket.joinData?.meetingId;
        if (!effectiveMeetingId) return;
        // Broadcast to everyone in the room EXCEPT the host
        socket.to(effectiveMeetingId).emit("force-mute");
        console.log(`🔇 Host muted all in meeting ${effectiveMeetingId}`);
    });

    // ── Host: camera off ALL participants ──────────────────────────────────
    socket.on("host-camera-off-all", ({ meetingId }) => {
        if (!socket.joinData?.isHost) return;
        const effectiveMeetingId = meetingId || socket.joinData?.meetingId;
        if (!effectiveMeetingId) return;
        socket.to(effectiveMeetingId).emit("force-camera-off");
        console.log(`📵 Host turned camera off for all in meeting ${effectiveMeetingId}`);
    });

    // ── Host: mute a specific participant ──────────────────────────────────
    socket.on("host-mute-participant", ({ targetSocketId }) => {
        if (!socket.joinData?.isHost) return;
        io.to(targetSocketId).emit("force-mute");
    });

    // ── Host: camera off a specific participant ────────────────────────────
    socket.on("host-camera-off-participant", ({ targetSocketId }) => {
        if (!socket.joinData?.isHost) return;
        io.to(targetSocketId).emit("force-camera-off");
    });

    socket.on("host-info", async () => {

        const meetingId = socket.joinData.meetingId;
        if (!meetingId) return;

        await MeetingParticipant.findOneAndUpdate(
            { meetingId, participantId: userId },
            {
                socketId: socket.id,
                participantEmail: socket.user.email,
                participantName: socket.user.name,
                isHost: !!socket.joinData.isHost,
                meetingDate: socket.joinData.meetingDate || toIsoDate(),
                joinTime: new Date(),
                leaveTime: null,
            },
            { upsert: true, new: true }
        );

        socket.to(meetingId).emit("peer-info", {
            socketId: socket.id,
            email: socket.user.email,
            name: socket.user.name
        });
    });

    socket.on("offer", (data) => {
        socket.to(data.socketId).emit("offer", { offer: data.offer, socketId: socket.id });
    });

    socket.on("answer", (data) => {
        socket.to(data.socketId).emit("answer", { answer: data.answer, socketId: socket.id });
    });

    socket.on("ice-candidate", (data) => {
        socket.to(data.socketId).emit("ice-candidate", { candidate: data.candidate, socketId: socket.id });
    });

    socket.on("media-state", (data) => {
        socket.to(data.meetingId).emit("peer-media-state", {
            socketId: socket.id,
            video: data.video,
            audio: data.audio,
        });
    });

    socket.on("chat-message", (data) => {
        socket.to(data.meetingId).emit("chat-message", {
            sender: socket.user.email,
            message: data.message,
            timestamp: new Date().toISOString(),
        });
    });

    socket.on("emoji-reaction", (data) => {
        if (!data.meetingId || !data.emoji) return;
        // Broadcast to everyone else in the room (sender already shows it locally)
        socket.to(data.meetingId).emit("emoji-reaction", {
            socketId: socket.id,
            emoji: data.emoji,
        });
    });


    socket.on("request-screenshare", (data) => {
        socket.to(data.meetingId).emit("screenshare-requested", {
            socketId: socket.id,
            email: socket.user.email,
        });
    });

// audio-chunk: (data, [binaryArg], [ack]) — binary can be 2nd arg, or data.audioBlob, or data.audioBase64
    socket.on("audio-chunk", (data, binaryArgOrAck, maybeAck) => {
        const ack = typeof binaryArgOrAck === "function"
            ? binaryArgOrAck
            : typeof maybeAck === "function"
                ? maybeAck
                : null;
        const binaryArg = typeof binaryArgOrAck === "function" ? null : binaryArgOrAck;

        const joinedMeetingId = socketMeetingMap.get(socket.id) || socket.joinData?.meetingId || null;
        const payloadMeetingId = (data?.meetingId || "").trim() || null;
        const effectiveMeetingId = joinedMeetingId || payloadMeetingId;

        if (!data || !effectiveMeetingId) {
            console.warn("⚠️ audio-chunk: missing data or meetingId");
            if (ack) ack({ ok: false, error: "missing meetingId" });
            return;
        }

        const debugState = getAudioDebugState(effectiveMeetingId);

        if (joinedMeetingId && payloadMeetingId && joinedMeetingId !== payloadMeetingId) {
            console.warn("⚠️ audio-chunk meetingId mismatch. Using joined meeting.", {
                socketId: socket.id,
                payloadMeetingId,
                joinedMeetingId,
            });
        }

        try {
            const mimeType = String(data.mimeType || "");
            let buffer = binaryArg || data.audioBlob || null;
            if (!buffer && data.audioBase64) {
                buffer = Buffer.from(data.audioBase64, "base64");
            }
            if (!buffer || (Buffer.isBuffer(buffer) && buffer.length === 0)) {
                console.warn("⚠️ audio-chunk: no audio data (binary/audioBlob/audioBase64)", {
                    meetingId: effectiveMeetingId,
                    hasBinaryArg: !!binaryArg,
                    hasAudioBlob: !!data.audioBlob,
                    hasAudioBase64: !!data.audioBase64,
                    mimeType
                });
                debugState.lastError = "empty audio buffer";
                if (ack) ack({ ok: false, error: "empty audio buffer" });
                return;
            }
            if (!Buffer.isBuffer(buffer)) {
                if (buffer instanceof ArrayBuffer) {
                    buffer = Buffer.from(buffer);
                } else if (buffer && buffer.type === "Buffer" && Array.isArray(buffer.data)) {
                    buffer = Buffer.from(buffer.data);
                } else {
                    buffer = Buffer.from(buffer);
                }
            }

            const ext =
                mimeType.includes("ogg") ? "ogg" :
                mimeType.includes("webm") ? "webm" :
                "webm";

            const fileName = `${effectiveMeetingId}_${Date.now()}_${(data.name || "Participant").replace(/[/\\?%*:|"<>]/g, "_")}.${ext}`;
            const filePath = path.join(UPLOADS_DIR, fileName);
            fs.writeFileSync(filePath, buffer);

            const stats = fs.statSync(filePath);
            const fileSizeInKB = (stats.size / 1024).toFixed(2);
            console.log(`💾 Saved audio chunk: ${fileName} | Size: ${fileSizeInKB} KB | mimeType: ${mimeType || "unknown"} | Path: ${filePath}`);
            debugState.chunksReceived += 1;
            debugState.bytesReceived += stats.size;
            debugState.lastChunkAt = new Date();
            debugState.lastFileName = fileName;
            debugState.lastMimeType = mimeType || null;
            debugState.lastError = null;
            if (ack) ack({ ok: true, fileName, bytes: stats.size });
        } catch (err) {
            console.error("Error saving audio chunk to disk:", err.message);
            debugState.lastError = err.message;
            if (ack) ack({ ok: false, error: err.message });
        }
    });
    socket.on("screenshare-response", (data) => {
        io.to(data.targetSocketId).emit("screenshare-approved", { approved: data.approved });
    });

    socket.on("screenshare-state", (data) => {
        socket.to(data.meetingId).emit("screenshare-state-changed", {
            socketId: socket.id,
            isSharing: data.isSharing,
        });
    });

    socket.on("end-meeting", async ({ meetingId }) => {
        const joinedMeetingId = socketMeetingMap.get(socket.id) || socket.joinData?.meetingId || null;
        const effectiveMeetingId = joinedMeetingId || (meetingId || "").trim();
        if (!effectiveMeetingId) return;

        if (joinedMeetingId && meetingId && joinedMeetingId !== meetingId) {
            console.warn("⚠️ end-meeting meetingId mismatch. Using joined meeting.", {
                socketId: socket.id,
                payloadMeetingId: meetingId,
                joinedMeetingId,
            });
        }

        const meeting = await Meeting.findOneAndUpdate(
            { meetingId: effectiveMeetingId },
            { status: "ended", endsAt: new Date() },
            { new: true }
        );
        io.in(effectiveMeetingId).emit("meeting-force-ended");
        if (!meeting) return;

        try {
            const result = await processMeetingAudioToTranscript(effectiveMeetingId, meeting);
            if (result.ok) {
                processTranscriptInBackground(effectiveMeetingId, meeting, meeting.createdBy)
                    .catch((bgErr) => {
                        console.error(`Background transcript processing failed for ${effectiveMeetingId}:`, bgErr.message);
                    });
            }
        } catch (err) {
            console.error("End-meeting processing error:", err.message);
        }
    });

    socket.on("transfer-host", ({ meetingId }) => {
        const room = io.sockets.adapter.rooms.get(meetingId);
        if (room) {
            const peers = Array.from(room).filter((id) => id !== socket.id);
            if (peers.length > 0) {
                const newHostId = peers[Math.floor(Math.random() * peers.length)];
                io.to(newHostId).emit("you-are-new-host");
            }
        }
    });

    socket.on("manual-transfer-host", ({ targetSocketId }) => {
        if (socket.joinData) socket.joinData.isHost = false;
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket && targetSocket.joinData) {
            targetSocket.joinData.isHost = true;
        }
        io.to(targetSocketId).emit("you-are-new-host");
    });

    socket.on("disconnect", () => {
        const meetingId = socketMeetingMap.get(socket.id);

        if (userId && socket.joinData?.email && meetingId) {
            disconnectedUsers[userId] = setTimeout(async () => {
                await MeetingParticipant.findOneAndUpdate(
                    { meetingId, participantId: userId },
                    { leaveTime: new Date() }
                );
                delete disconnectedUsers[userId];
            }, 10000);
        }

        delete peerInfoMap[socket.id];
        socketMeetingMap.delete(socket.id);

        // Clean up lobby if this person was waiting
        const lobbyMeetingId = socket.joinData?.meetingId;
        if (lobbyMeetingId) {
            const lobby = lobbyMap.get(lobbyMeetingId);
            if (lobby && lobby.has(socket.id)) {
                lobby.delete(socket.id);
                if (lobby.size === 0) lobbyMap.delete(lobbyMeetingId);
                // Notify host this person left the lobby
                const roomSockets = Array.from(io.sockets.adapter.rooms.get(lobbyMeetingId) || []);
                roomSockets.forEach((sid) => {
                    const s = io.sockets.sockets.get(sid);
                    if (s && s.joinData?.isHost && s.joinData.meetingId === lobbyMeetingId) {
                        s.emit("lobby-user-left", { socketId: socket.id });
                    }
                });
            }
        }

        if (meetingId) {
            socket.to(meetingId).emit("peer-disconnected", { socketId: socket.id });
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    if (KEEP_AUDIO_FILES) {
        console.log(`🔒 KEEP_AUDIO_FILES is ON — audio files will be kept in: ${UPLOADS_DIR}`);
        console.log(`   List files: GET /api/debug/audio-files/:meetingId`);
        console.log(`   Download:   GET /api/debug/audio-files/:meetingId/:filename`);
    }
});