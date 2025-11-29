const mongoose = require("mongoose");
const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, lowercase: true, required: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["client", "astrologer"], default: "client" },
  createdAt: { type: Date, default: Date.now },
});
module.exports = mongoose.model("User", UserSchema);
