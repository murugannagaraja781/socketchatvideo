// server.js — complete, corrected
require("dotenv").config();

const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("socket.io");

// require routes/models (make sure these files exist)
const authRoutes = require("./routes/auth"); // path must be correct
const Message = require("./models/Message"); // path must be correct

// --- CREATE EXPRESS APP (must be BEFORE app.use)
const app = express();

// --- MIDDLEWARE
app.use(express.json());
app.use(
  cors({
    origin: "*", // open for debugging; restrict in production
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// --- REST routes
app.use("/api/auth", authRoutes);

// --- CONNECT MONGODB
mongoose
  .connect(process.env.MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Mongo connected"))
  .catch((err) => {
    console.error("Mongo connection error", err);
    process.exit(1);
  });

// --- CREATE HTTP SERVER + SOCKET.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// --- SOCKET.IO JWT AUTH (handshake)
const jwt = require("jsonwebtoken");
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("no token"));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = payload; // { id, email, role }
    next();
  } catch (err) {
    next(new Error("invalid token"));
  }
});

// --- SOCKET HANDLERS
io.on("connection", (socket) => {
  console.log(
    "socket connected",
    socket.id,
    socket.user?.email || socket.user?.id
  );

  socket.on("join-room", ({ roomId }) => {
    socket.join(roomId);
    socket
      .to(roomId)
      .emit("user-joined", { socketId: socket.id, user: socket.user });
  });

  socket.on("leave-room", ({ roomId }) => {
    socket.leave(roomId);
    socket
      .to(roomId)
      .emit("user-left", { socketId: socket.id, user: socket.user });
  });

  socket.on("signal", ({ to, data }) => {
    if (to) {
      io.to(to).emit("signal", { from: socket.id, data });
    } else if (data && data.roomId) {
      // forward to everyone in room except sender
      socket.to(data.roomId).emit("signal", { from: socket.id, data });
    }
  });

  socket.on("chat-message", async ({ roomId, text }) => {
    try {
      const msg = await Message.create({
        roomId,
        sender: socket.user.id,
        text,
      });
      io.to(roomId).emit("chat-message", {
        _id: msg._id,
        roomId,
        sender: socket.user.id,
        text: msg.text,
        createdAt: msg.createdAt,
      });
    } catch (err) {
      console.error("msg save err", err);
    }
  });

  socket.on("get-history", async ({ roomId, limit = 50 }) => {
    try {
      const msgs = await Message.find({ roomId })
        .sort({ createdAt: 1 })
        .limit(limit)
        .populate("sender", "name email");
      socket.emit("history", msgs);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("disconnect", () => {
    console.log("socket disconnected", socket.id);
  });
});

// --- START SERVER (use process.env.PORT on Railway)
const PORT = process.env.PORT || 9011;
server.listen(PORT, () => console.log("Server listening on", PORT));
