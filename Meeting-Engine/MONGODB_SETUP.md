# MongoDB Setup Instructions

## Current Issue
Your MongoDB requires authentication to write data. You need to either:
1. Add credentials to the connection string
2. Create a MongoDB user with write permissions
3. Or disable authentication for local development

## Option 1: Add Credentials to Connection String

If you have MongoDB username and password, update `server.js`:

```javascript
const MONGO_URI = "mongodb://username:password@localhost:27017/ai-meeting-buddy?authSource=admin";
```

Or add to your `.env` file:
```
MONGO_URI=mongodb://username:password@localhost:27017/ai-meeting-buddy?authSource=admin
```

## Option 2: Create a MongoDB User

1. Open MongoDB Compass
2. Connect to your MongoDB instance
3. Go to the "admin" database
4. Create a new user with read/write permissions

Or via MongoDB shell:
```bash
mongosh
use admin
db.createUser({
  user: "meetingbuddy",
  pwd: "your-password",
  roles: [{ role: "readWrite", db: "ai-meeting-buddy" }]
})
```

Then update connection string:
```javascript
const MONGO_URI = "mongodb://meetingbuddy:your-password@localhost:27017/ai-meeting-buddy?authSource=admin";
```

## Option 3: Check MongoDB Compass Connection String

1. Open MongoDB Compass
2. Look at your connection string (it might already have credentials)
3. Copy that connection string and use it in `server.js`

## Option 4: Disable Authentication (Local Development Only)

If this is just for local development, you can disable authentication:

1. Find your MongoDB config file (usually `/usr/local/etc/mongod.conf` on Mac)
2. Comment out or remove the `security:` section
3. Restart MongoDB

**Warning:** Only do this for local development, never in production!

