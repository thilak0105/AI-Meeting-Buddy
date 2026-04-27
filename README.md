# AI-Meeting-Buddy

AI-Meeting-Buddy is a full-stack meeting platform focused on live collaboration and post-meeting intelligence.
The core app lives in the `Meeting-Engine` folder and combines real-time meeting flow, MongoDB-backed persistence, and AI-powered transcript processing/summarization.

## What This Project Includes

- Real-time meeting room experience
- Role-based user model (manager and employee)
- MongoDB-backed meeting, participant, and transcript storage
- AI-assisted transcript handling and summary generation
- Project-oriented summary and task tracking models

## Repository Structure

```text
AI-Meeting-Buddy/
├─ README.md
└─ Meeting-Engine/
	├─ server.js
	├─ package.json
	├─ dashboard.html
	├─ meeting.html
	├─ index.html
	├─ models/
	└─ ...
```

## Tech Stack

- Node.js + Express
- Socket.IO
- MongoDB + Mongoose
- JWT authentication
- Groq/OpenAI SDK integrations
- HTML/CSS/JavaScript frontend

## Prerequisites

- Node.js 18+ (recommended)
- npm 9+
- MongoDB instance (local or cloud)
- API keys for AI features (if enabled)

## Quick Start

1. Clone the repository.
2. Move into the app folder:

	```bash
	cd Meeting-Engine
	```

3. Install dependencies:

	```bash
	npm install
	```

4. Create a `.env` file in `Meeting-Engine` (see environment variables below).

5. Start the server:

	```bash
	npm run start
	```

6. Open the app in your browser:

	```text
	http://localhost:5000
	```

## Environment Variables

Set these in `Meeting-Engine/.env`:

- `PORT` (default: `5000`)
- `MONGO_URI` (default: `mongodb://localhost:27017/Meeting`)
- `JWT_SECRET` (required for secure auth)
- `GROQ_API_KEY` (base key for Groq usage)
- `GROQ_AUDIO_API_KEY` (optional override for audio/transcription)
- `GROQ_SUMMARY_API_KEY` (optional override for summaries)
- `GROQ_TEXT_MODEL` (optional, default in code)
- `KEEP_AUDIO_FILES` (`true/false`, optional)

## NPM Scripts

From `Meeting-Engine`:

- `npm run start` -> starts the server (`node server.js`)
- `npm run start-server` -> starts the server (`node server.js`)

## Notes

- `node_modules` and runtime upload artifacts are intentionally git-ignored.
- If you use ngrok, update `ngrok_url.txt` as needed.

## License

ISC

