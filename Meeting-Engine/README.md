# Combined AI Meeting Buddy

A comprehensive video conferencing application that combines the best features from both the original hackathon-meet project and the SE project.

## 🎯 Combined Features

### From Original Project (hackathon-meet):
- ✅ **ngrok Integration** - Public URL support for external access
- ✅ **Enhanced WebRTC Handling** - Better peer connection management with existing-peers support
- ✅ **URL Parameter Parsing** - Support for meetingId, hostEmail, and meetingDate in URLs
- ✅ **Join Meeting Modal** - User-friendly interface to join existing meetings
- ✅ **Better Peer Info Broadcasting** - Improved peer information sharing

### From SE Project:
- ✅ **MongoDB Authentication Support** - Robust database connection with authentication
- ✅ **Participant Tracking** - Track join/leave times for all participants
- ✅ **Comprehensive API Endpoints** - GET /api/summaries, GET /api/participants/:meetingId
- ✅ **Enhanced Error Handling** - Better logging and error messages
- ✅ **MongoDB Setup Utilities** - Helper scripts for database setup
- ✅ **Modern UI Design** - Beautiful glass-morphism design with gradient backgrounds

### Core Features (Both Projects):
- 🎥 **Multi-peer Video Conferencing** - WebRTC peer-to-peer connections
- 🤖 **AI-Powered Summaries** - OpenAI integration for meeting summaries
- 📊 **Real-time Engagement Tracking** - Face detection for engagement scores
- 📈 **Connection Quality Monitoring** - Detailed stats for audio/video quality
- 🔊 **Speaking Detection** - Visual indicators when participants are speaking
- 💾 **Meeting Data Persistence** - MongoDB storage for summaries and participants

## 🚀 Getting Started

### Prerequisites
- Node.js (v14 or higher)
- MongoDB (running locally or remote)
- OpenAI API key (for AI summaries)

### Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Set up environment variables:**
Create a `.env` file in the root directory:
```
OPENAI_API_KEY=your_openai_api_key_here
MONGO_URI=mongodb://meetinguser:meeting123@localhost:27017/ai-meeting-buddy?authSource=admin
```

3. **Set up MongoDB:**
   - Option A: Run the setup script:
     ```bash
     node create-mongo-user.js
     ```
   - Option B: Follow instructions in `MONGODB_SETUP.md`

4. **Start the server:**
```bash
npm run start-server
```

5. **Access the application:**
   - Home page: http://localhost:5000
   - Meeting page: http://localhost:5000/meeting

## 📁 Project Structure

```
combined-meet/
├── server.js              # Main server with all combined features
├── script.js              # Client-side WebRTC and UI logic
├── index.html             # Home page with join meeting functionality
├── meeting.html           # Meeting interface with modern UI
├── package.json           # Dependencies
├── create-mongo-user.js   # MongoDB user creation utility
├── fix-mongodb-auth.js    # MongoDB authentication checker
├── MONGODB_SETUP.md       # MongoDB setup instructions
└── README.md              # This file
```

## 🔌 API Endpoints

### Meeting Summaries
- `POST /api/summaries` - Save a meeting summary
- `GET /api/summaries` - Get all summaries (limit 50)
- `GET /api/summaries/:meetingId` - Get summaries for a specific meeting

### Participants
- `POST /api/participants` - Track participant join/leave
- `GET /api/participants/:meetingId` - Get all participants for a meeting

### AI Features
- `POST /api/generate-summary` - Generate AI summary from notes

### Utilities
- `GET /api/test` - Test API connectivity
- `GET /api/check-connection` - Check MongoDB connection status
- `GET /api/test-db` - Test database write access
- `GET /api/ngrok` - Get ngrok public URL (if ngrok is running)

## 🎨 Features Explained

### 1. Multi-Peer Video Conferencing
- Uses WebRTC for peer-to-peer connections
- Supports multiple participants simultaneously
- Automatic reconnection handling

### 2. Participant Tracking
- Tracks when participants join and leave
- Stores participant email, socket ID, and timestamps
- Identifies host vs regular participants

### 3. AI Summaries
- Enter meeting notes during the call
- Generate structured HTML summaries using OpenAI
- Automatically saved to MongoDB

### 4. Engagement Tracking
- Real-time face detection using face-api.js
- Calculates engagement score based on face detection confidence
- Updates every second

### 5. Connection Quality Stats
- Real-time audio/video bitrate monitoring
- Packet loss tracking
- Jitter and RTT measurements
- Frame rate (FPS) for video

### 6. ngrok Support
- Automatically detects ngrok tunnels
- Generates public URLs for sharing meetings
- Works seamlessly with the join meeting feature

## 🔧 Configuration

### MongoDB Connection
Default connection string in `server.js`:
```javascript
const MONGO_URI = process.env.MONGO_URI || "mongodb://meetinguser:meeting123@localhost:27017/ai-meeting-buddy?authSource=admin";
```

You can override this by setting `MONGO_URI` in your `.env` file.

### Server Port
Default port is 5000. To change it, modify the `PORT` constant in `server.js`.

## 📝 Usage Examples

### Starting a New Meeting
1. Go to http://localhost:5000
2. Click "Start Meeting"
3. Enter your email when prompted
4. Share the meeting link with others

### Joining an Existing Meeting
1. Go to http://localhost:5000
2. Click "Join Meeting"
3. Enter the meeting ID or full URL
4. Enter your email when prompted

### Using ngrok for Public Access
1. Start ngrok: `ngrok http 5000`
2. In the create meeting page, click "Use ngrok public URL"
3. Share the generated public URL

## 🐛 Troubleshooting

### MongoDB Connection Issues
- Run `node fix-mongodb-auth.js` to diagnose authentication issues
- Check `MONGODB_SETUP.md` for detailed setup instructions
- Ensure MongoDB is running: `mongosh` or check MongoDB Compass

### WebRTC Connection Issues
- Check browser console for errors
- Ensure camera/microphone permissions are granted
- Try using headphones to avoid echo
- Check firewall settings for WebRTC ports

### AI Summary Generation Issues
- Verify `OPENAI_API_KEY` is set in `.env`
- Check server logs for API errors
- Ensure you have OpenAI API credits

## 🎯 Best Practices

1. **Use headphones** to avoid echo in multi-participant calls
2. **Allow camera/microphone permissions** when prompted
3. **Test with multiple tabs/devices** to verify multi-peer functionality
4. **Keep MongoDB running** for data persistence
5. **Use ngrok** for external access during development

## 📄 License

ISC

## 🙏 Credits

Combined from:
- Original hackathon-meet project
- SE project enhancements

