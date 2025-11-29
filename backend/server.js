require("dotenv").config();
// REST routes
app.use("/api/auth", authRoutes);

// connect mongodb
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

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN } });

// simple socket.io JWT auth via handshake
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

io.on("connection", (socket) => {
  console.log("socket connected", socket.id, socket.user.email);

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
    io.to(to).emit("signal", { from: socket.id, data });
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

const PORT = process.env.PORT || 9011;
server.listen(PORT, () => console.log("Server listening on", PORT));
