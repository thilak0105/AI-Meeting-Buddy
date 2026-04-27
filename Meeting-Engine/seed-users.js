require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/Meeting";

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

const User = mongoose.models.User || mongoose.model("User", userSchema);

const usersToSeed = [
    { name: "Priya Manager", email: "manager1@company.com", password: "Manager@123", role: "manager" },
    { name: "Arun Manager", email: "manager2@company.com", password: "Manager@123", role: "manager" },
    { name: "Kavin Employee", email: "employee1@company.com", password: "Employee@123", role: "employee" },
    { name: "Meena Employee", email: "employee2@company.com", password: "Employee@123", role: "employee" },
    { name: "Ravi Employee", email: "employee3@company.com", password: "Employee@123", role: "employee" },
];

async function seedUsers() {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });

    const results = [];

    for (const seedUser of usersToSeed) {
        const existing = await User.findOne({ email: seedUser.email.toLowerCase() });
        if (existing) {
            results.push({ email: seedUser.email, role: seedUser.role, status: "already-exists" });
            continue;
        }

        const passwordHash = await bcrypt.hash(seedUser.password, 10);
        await User.create({
            name: seedUser.name,
            email: seedUser.email.toLowerCase(),
            passwordHash,
            role: seedUser.role,
            isActive: true,
        });

        results.push({ email: seedUser.email, role: seedUser.role, status: "created" });
    }

    console.table(results);
    console.log("\nLogin credentials seeded:");
    console.log("Managers -> password: Manager@123");
    console.log("Employees -> password: Employee@123");

    await mongoose.disconnect();
}

seedUsers()
    .then(() => {
        console.log("\n✅ User seeding completed.");
        process.exit(0);
    })
    .catch(async (err) => {
        console.error("\n❌ User seeding failed:", err.message);
        try {
            await mongoose.disconnect();
        } catch { }
        process.exit(1);
    });
