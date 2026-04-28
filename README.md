# AI Meeting Buddy

AI-Meeting-Buddy is a full-stack meeting platform focused on real-time collaboration with AI-powered transcript processing and post-meeting intelligence.

## Features

- 🎥 Real-time WebRTC video/audio conferencing
- 📝 Automatic transcript generation with Groq/OpenAI
- 👥 Participant tracking and engagement scoring
- 📊 Meeting summaries and task extraction
- 🔐 Role-based access (manager/employee)
- 🗄️ MongoDB-backed persistence
- 🔗 ngrok tunnel support for public URLs
- 🤖 Face detection for engagement metrics

## Tech Stack

- **Backend:** Node.js, Express, Socket.IO
- **Database:** MongoDB, Mongoose
- **Frontend:** HTML5, CSS3, JavaScript
- **AI:** Groq SDK, OpenAI API
- **WebRTC:** Peer-to-peer video/audio
- **Authentication:** JWT, bcryptjs

## Prerequisites

- Node.js 18+ (recommended)
- npm 9+
- MongoDB instance (local or cloud)
- Groq/OpenAI API keys (for AI features)

## Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd AI-Meeting-Buddy
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create `.env` file:**
   ```
   MONGO_URI=mongodb://username:password@localhost:27017/ai-meeting-buddy?authSource=admin
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
   PORT=5000
   GROQ_API_KEY=your-groq-api-key
   GROQ_SUMMARY_API_KEY=your-groq-summary-key
   KEEP_AUDIO_FILES=false
   ```

4. **Seed test users (optional):**
   ```bash
   node seed-users.js
   ```
   
   Default test credentials:
   - **Managers:** `manager1@company.com` / `Manager@123`
   - **Employees:** `employee1@company.com` / `Employee@123`

## Running the Application

1. **Start the server:**
   ```bash
   npm start
   ```

2. **Open in browser:**
   ```
   http://localhost:5000
   ```

## MongoDB Setup

### Option 1: Local MongoDB with Authentication

```bash
node create-mongo-user.js
```

This creates a user `meetinguser` with password `meeting123`.

### Option 2: MongoDB Atlas (Cloud)

Use your Atlas connection string in `.env`:
```
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/ai-meeting-buddy
```

### Option 3: Verify Connection

```bash
node fix-mongodb-auth.js
```

## API Endpoints

### Authentication
- `POST /api/auth/login` — User login
- `POST /api/auth/logout` — User logout

### Meetings
- `GET /api/meetings` — Get all meetings
- `POST /api/meetings` — Create new meeting
- `GET /api/meetings/:meetingId` — Get meeting details

### Participants
- `POST /api/participants` — Track participant join/leave
- `GET /api/participants/:meetingId` — Get meeting participants

### Summaries
- `POST /api/summaries` — Save meeting summary
- `GET /api/summaries` — Get all summaries
- `GET /api/summaries/:meetingId` — Get summary by meeting ID

### System
- `GET /api/test` — API connectivity test
- `GET /api/check-connection` — MongoDB connection status
- `GET /api/ngrok` — Get ngrok public URL

## Project Structure

```
├── server.js                    # Main Express server
├── package.json                 # Dependencies
├── index.html                   # Landing page
├── meeting.html                 # Meeting interface
├── dashboard.html               # Dashboard UI
├── script.js                    # Frontend JavaScript
├── dashboard.js                 # Dashboard logic
├── models/                      # ML models (face detection)
├── seed-users.js                # Test user seeding
├── create-mongo-user.js         # MongoDB user creation
├── fix-mongodb-auth.js          # MongoDB auth debugging
├── MONGODB_SETUP.md             # Database setup guide
└── verify-transcript-*.js       # Transcript verification scripts
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_URI` | Yes | `mongodb://localhost:27017/Meeting` | MongoDB connection string |
| `JWT_SECRET` | Yes | N/A | Secret key for JWT signing |
| `PORT` | No | `5000` | Server port |
| `GROQ_API_KEY` | No | N/A | Groq API key for audio/text |
| `GROQ_AUDIO_API_KEY` | No | Uses `GROQ_API_KEY` | Separate key for audio transcription |
| `GROQ_SUMMARY_API_KEY` | No | Uses `GROQ_API_KEY` | Separate key for summaries |
| `GROQ_TEXT_MODEL` | No | `llama-3.3-70b-versatile` | Groq model for text processing |
| `KEEP_AUDIO_FILES` | No | `false` | Keep audio files after processing |

## Development

### Adding New Features

1. Create new endpoints in `server.js`
2. Update corresponding MongoDB schemas if needed
3. Add frontend logic in `script.js` or `dashboard.js`
4. Test with Socket.IO events

### Running Verification Scripts

```bash
# Verify transcript storage
node verify-transcript-storage.js

# Verify multi-person transcripts
node verify-transcript-multi-person.js
```

## Troubleshooting

### MongoDB Authentication Error
```
Command find requires authentication
```
**Solution:** Ensure `MONGO_URI` includes credentials and `.env` file exists.

### Cannot Connect to MongoDB
```
MongoDB connection error
```
**Solution:** Verify MongoDB is running and check connection string in `.env`.

### ngrok URL Errors
Update `ngrok_url.txt` with your current ngrok tunnel:
```
https://your-ngrok-domain.ngrok.io
```

## License

ISC

## Support

For issues or questions, please open a GitHub issue or contact the development team.
