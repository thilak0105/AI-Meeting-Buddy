<div align="center">

<br/>

```
 █████╗ ██╗    ███╗   ███╗███████╗███████╗████████╗██╗███╗   ██╗ ██████╗
██╔══██╗██║    ████╗ ████║██╔════╝██╔════╝╚══██╔══╝██║████╗  ██║██╔════╝
███████║██║    ██╔████╔██║█████╗  █████╗     ██║   ██║██╔██╗ ██║██║  ███╗
██╔══██║██║    ██║╚██╔╝██║██╔══╝  ██╔══╝     ██║   ██║██║╚██╗██║██║   ██║
██║  ██║██║    ██║ ╚═╝ ██║███████╗███████╗   ██║   ██║██║ ╚████║╚██████╔╝
╚═╝  ╚═╝╚═╝    ╚═╝     ╚═╝╚══════╝╚══════╝   ╚═╝   ╚═╝╚═╝  ╚═══╝ ╚═════╝
                              B U D D Y
```

### AI-powered video meetings · Live transcription · Smart summaries · Task extraction

<br/>

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-8.20-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://mongodb.com)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-010101?style=for-the-badge&logo=socket.io&logoColor=white)](https://socket.io)
[![Groq](https://img.shields.io/badge/Groq-LLaMA_3.3_70B-F55036?style=for-the-badge&logo=meta&logoColor=white)](https://groq.com)
[![WebRTC](https://img.shields.io/badge/WebRTC-P2P_Video-333333?style=for-the-badge&logo=webrtc&logoColor=white)](https://webrtc.org)
[![License](https://img.shields.io/badge/License-ISC-0ea5e9?style=for-the-badge)](./LICENSE)

</div>

---

## What is AI Meeting Buddy?

**AI Meeting Buddy** is a self-hosted, full-stack web application that merges browser-native video conferencing with an AI intelligence layer. Teams hold meetings, capture live audio transcripts, and instantly convert them into structured summaries and Kanban-style project tasks — all without leaving the browser, and without depending on any third-party meeting platform.

<br/>

## ✦ Features

<table>
<tr>
<td width="50%" valign="top">

**🎥 Real-Time Video & Audio**
Browser-native WebRTC with peer-to-peer connections. No plugins, no downloads.

**🔐 Role-Based Access Control**
Managers create and control meetings. Employees join via a shareable link. Every route is JWT-protected.

**🚪 Lobby & Admission**
Participants wait in a lobby — the host reviews and admits or denies each person individually.

**🎙️ Live Transcription**
Audio chunks stream to the server and are transcribed in real-time using Groq's Whisper API.

</td>
<td width="50%" valign="top">

**🤖 AI Summaries**
LLaMA 3.3 70B processes transcripts into rich, structured HTML meeting summaries.

**✅ Kanban Task Extraction**
AI extracts actionable tasks from transcripts and organises them into a to-do / in-progress / done board.

**📊 Project Intelligence**
Summaries across multiple meetings are merged into a single per-project view with an objectives tracker.

**🎛️ Host Controls**
Mute all, camera off all, per-participant controls, screen-share coordination, and live host transfer.

</td>
</tr>
</table>

<br/>

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         Browser Client                        │
│                                                              │
│   index.html        meeting.html          dashboard.html     │
│   (Login)           (Video + Chat +       (History, Tasks,   │
│                      Transcription)        Summaries)        │
└─────────────────────────┬────────────────────────────────────┘
                          │  HTTP REST  +  WebSocket (Socket.IO)
┌─────────────────────────▼────────────────────────────────────┐
│                    server.js  (Express)                       │
│                                                              │
│   ┌──────────────┐   ┌──────────────┐   ┌────────────────┐  │
│   │   REST API   │   │  Socket.IO   │   │  AI Pipeline   │  │
│   │  /api/...    │   │  Signalling  │   │ Whisper+LLaMA  │  │
│   └──────┬───────┘   └──────┬───────┘   └───────┬────────┘  │
│          │                  │                    │           │
│   ┌──────▼──────────────────▼────────────────────▼────────┐  │
│   │                 Mongoose ODM                           │  │
│   │   Users · Meetings · Transcripts · Summaries · Tasks  │  │
│   └───────────────────────────────────────────────────────┘  │
└─────────────────────────┬────────────────────────────────────┘
                          │  Groq API
         ┌────────────────┴──────────────┐
         ▼                               ▼
   Groq Whisper                    Groq LLaMA 3.3 70B
   (Transcription)                 (Summarisation + Tasks)
```

<br/>

## 🛠️ Tech Stack

| Layer | Technology | Role |
|---|---|---|
| Runtime | Node.js 18+ | Server-side JavaScript |
| Framework | Express 4 | HTTP routing & middleware |
| Real-time | Socket.IO 4 | WebRTC signalling & live events |
| Database | MongoDB + Mongoose 8 | Persistence & ODM |
| Frontend | HTML5 / CSS3 / Vanilla JS | Zero-dependency browser UI |
| AI — Audio | Groq Whisper | Real-time speech-to-text |
| AI — Text | Groq LLaMA 3.3 70B | Summarisation & task extraction |
| Video | WebRTC (browser-native) | Peer-to-peer video & audio |
| Auth | JWT + bcryptjs | httpOnly cookie sessions |

<br/>

## 📁 Project Structure

```
ai-meeting-buddy/
│
├── server.js                      ← Express app, Socket.IO, all API routes, AI logic
│
├── index.html                     ← Login / landing page
├── meeting.html                   ← In-meeting UI (video grid, chat, transcript, controls)
├── script.js                      ← Meeting client (WebRTC, Socket.IO, audio streaming)
│
├── dashboard.html                 ← Dashboard (history, summaries, tasks, objectives)
├── dashboard.js                   ← Dashboard client logic
│
├── models/                        ← face-api.js model weights
│   ├── tiny_face_detector_model-*
│   └── face_landmark_68_tiny_model-*
│
├── seed-users.js                  ← Seed test manager & employee accounts
├── create-mongo-user.js           ← Helper to create a MongoDB auth user
├── fix-mongodb-auth.js            ← Repair MongoDB auth config
├── verify-transcript-*.js         ← Transcript storage verification scripts
│
├── MONGODB_SETUP.md               ← MongoDB authentication setup guide
└── package.json
```

<br/>

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+
- **MongoDB** running locally or on [Atlas](https://www.mongodb.com/atlas)
- A **[Groq API key](https://console.groq.com/)** — free tier available

---

### 1 · Clone the repository

```bash
git clone -b feature/my-changes https://github.com/thilak0105/AI-Meeting-Buddy.git
cd AI-Meeting-Buddy
```

### 2 · Install dependencies

```bash
npm install
```

### 3 · Create your `.env` file

```env
# ── Database ──────────────────────────────────────────────────────
MONGO_URI=mongodb://localhost:27017/Meeting

# ── Auth ──────────────────────────────────────────────────────────
JWT_SECRET=replace-me-with-a-long-random-string

# ── Groq AI ───────────────────────────────────────────────────────
# Option A: single key (simpler)
GROQ_API_KEY=gsk_...

# Option B: split keys for higher throughput (recommended)
GROQ_AUDIO_API_KEY=gsk_...        # used by Whisper for transcription
GROQ_SUMMARY_API_KEY=gsk_...      # used by LLaMA for summarisation

# Optional
GROQ_TEXT_MODEL=llama-3.3-70b-versatile
KEEP_AUDIO_FILES=false

# ── Server ────────────────────────────────────────────────────────
PORT=5000
```

> [!TIP]
> Using two separate Groq API keys (`GROQ_AUDIO_API_KEY` and `GROQ_SUMMARY_API_KEY`) splits the transcription and summarisation workloads across independent rate-limit buckets. This prevents throttling during active meetings where both features run simultaneously.

> [!WARNING]
> **Always** replace `JWT_SECRET` before deploying. The default value `dev-secret-change-me` is intentionally insecure and must never be used in production.

### 4 · Configure MongoDB

If your MongoDB instance requires authentication, follow the step-by-step guide in [MONGODB_SETUP.md](./MONGODB_SETUP.md).

### 5 · Seed test accounts *(optional but recommended)*

```bash
node seed-users.js
```

### 6 · Start the server

```bash
npm start
# → App running at http://localhost:5000
```

<br/>

## 👥 Default Test Accounts

After running `seed-users.js` you can log in immediately with:

| Role | Email | Password |
|---|---|---|
| 👔 Manager | `manager1@company.com` | `Manager@123` |
| 👔 Manager | `manager2@company.com` | `Manager@123` |
| 🧑‍💻 Employee | `employee1@company.com` | `Employee@123` |
| 🧑‍💻 Employee | `employee2@company.com` | `Employee@123` |
| 🧑‍💻 Employee | `employee3@company.com` | `Employee@123` |

<br/>

## 📡 API Reference

All endpoints are prefixed with `/api`. Protected routes require a valid `authToken` httpOnly cookie.

<details>
<summary><b>🔑 Authentication</b></summary>
<br/>

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Login and receive JWT cookie |
| `POST` | `/api/auth/logout` | Auth | Clear auth cookie |
| `GET` | `/api/auth/me` | Auth | Get current user info |
| `POST` | `/api/auth/users` | Manager | Create a new user account |

</details>

<details>
<summary><b>📅 Meetings</b></summary>
<br/>

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/meetings` | Manager | Create a new meeting |
| `GET` | `/api/meetings/history` | Auth | List meetings for the current user |
| `GET` | `/api/meetings/:meetingId` | Auth | Get meeting details |
| `POST` | `/api/meetings/:meetingId/transcript` | Manager | Save / overwrite full transcript |
| `POST` | `/api/meetings/:meetingId/save-transcript` | Auth | Persist live transcript chunks |
| `POST` | `/api/meetings/:meetingId/reprocess-audio` | Manager | Re-run Whisper on stored audio |

</details>

<details>
<summary><b>🤖 Summaries</b></summary>
<br/>

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/generate-summary` | Auth | Generate AI summary from transcript |
| `GET` | `/api/summaries/:meetingId` | Auth | Get summary for a meeting |
| `GET` | `/api/meeting-summaries` | Manager | List all meeting summaries |
| `POST` | `/api/participants` | Auth | Record a participant join event |
| `GET` | `/api/participants/:meetingId` | Auth | List participants for a meeting |

</details>

<details>
<summary><b>📊 Projects, Tasks & Objectives</b></summary>
<br/>

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/project-summary/process` | Auth | Merge transcripts → project summary + tasks |
| `GET` | `/api/project-summary/:projectName` | Auth | Get project-level summary |
| `GET` | `/api/project-summaries` | Manager | List all project summaries |
| `GET` | `/api/project-tasks` | Manager | List all tasks across projects |
| `GET` | `/api/project-tasks/:projectName` | Auth | Get tasks for a project |
| `POST` | `/api/project-tasks` | Manager | Create a task manually |
| `PATCH` | `/api/project-tasks/:taskId` | Manager | Update task status or details |
| `DELETE` | `/api/project-tasks/:taskId` | Manager | Delete a task |
| `GET` | `/api/objectives/current` | Manager | Get current objectives board |
| `POST` | `/api/objectives/refresh` | Manager | Rebuild objectives from recent transcripts |
| `PUT` | `/api/objectives/current` | Manager | Edit objectives manually |

</details>
<br/>

## 🗄️ Data Models

| Model | Description |
|---|---|
| `User` | Manager and employee accounts with bcrypt-hashed passwords |
| `Meeting` | Metadata, status (`active` / `ended` / `dropped`), and consolidated transcript |
| `MeetingParticipant` | Per-participant join/leave timestamps and host flag |
| `TranscriptChunk` | Individual speaker utterances with millisecond-level timestamps |
| `MeetingSummary` | AI-generated HTML summary per meeting |
| `ProjectSummary` | Merged cross-meeting summary per project name |
| `ProjectTask` | Kanban tasks extracted from transcripts (`todo` · `in_progress` · `done`) |
| `ManagerObjective` | Per-manager to-start / ongoing objectives board |

<br/>

## 🔑 Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGO_URI` | No | `mongodb://localhost:27017/Meeting` | MongoDB connection string |
| `JWT_SECRET` | **Yes** | `dev-secret-change-me` | JWT signing secret — **must be changed** |
| `GROQ_API_KEY` | **Yes*** | — | Fallback Groq key for all AI calls |
| `GROQ_AUDIO_API_KEY` | No | → `GROQ_API_KEY` | Dedicated key for Whisper transcription |
| `GROQ_SUMMARY_API_KEY` | No | → `GROQ_API_KEY` | Dedicated key for LLM summarisation |
| `GROQ_TEXT_MODEL` | No | `llama-3.3-70b-versatile` | Groq model for summaries and tasks |
| `KEEP_AUDIO_FILES` | No | `false` | Retain raw audio chunks after transcription |
| `PORT` | No | `5000` | HTTP server port |

*`GROQ_API_KEY` is required unless both `GROQ_AUDIO_API_KEY` and `GROQ_SUMMARY_API_KEY` are explicitly set.

<br/>

---
---

## Contributors

| Name | GitHub |
|---|---|
| Thilak L | [@thilak0105](https://github.com/thilak0105) |
| Loganand S | [@loganand612](https://github.com/loganand612) |
| Subramanian G | [@Demoncyborg07](https://github.com/Demoncyborg07) |
| Raghul A R | [@a-steel-heart](https://github.com/a-steel-heart) |

---

<div align="center">

Built with ♥ using &nbsp;**Node.js** · **Socket.IO** · **MongoDB** · **Groq AI** · **WebRTC**

</div>
