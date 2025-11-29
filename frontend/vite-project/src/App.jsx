import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import { io } from "socket.io-client";

const API = import.meta.env.VITE_API_URL || "http://localhost:9011";

function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("client");

  const [socket, setSocket] = useState(null);

  // room / messaging
  const [roomId, setRoomId] = useState("room-1");
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");

  // WebRTC Refs
  const localRef = useRef();
  const remoteRef = useRef();
  const pcRef = useRef(null);

  // -------------------------------------------------------
  // Connect socket after login
  // -------------------------------------------------------
  useEffect(() => {
    if (!token) return;

    const s = io(API, { auth: { token } });
    setSocket(s);

    s.on("connect", () => console.log("socket connected", s.id));

    s.on("chat-message", (msg) => setMessages((prev) => [...prev, msg]));

    s.on("history", (msgs) => setMessages(msgs));

    // WebRTC signaling handler
    s.on("signal", async ({ from, data }) => {
      const pc = pcRef.current;
      if (!pc) return;

      // OFFER RECEIVED
      if (data.type === "offer") {
        console.log("Received Offer");
        await pc.setRemoteDescription(data.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // send back answer
        socket.emit("signal", {
          to: from,
          data: { type: "answer", sdp: answer },
        });
      }

      // ANSWER RECEIVED
      else if (data.type === "answer") {
        console.log("Received Answer");
        await pc.setRemoteDescription(data.sdp);
      }

      // ICE CANDIDATE
      else if (data.candidate) {
        console.log("Received ICE Candidate");
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          console.error("Error adding ICE candidate", err);
        }
      }
    });

    return () => s.disconnect();
  }, [token]);

  // -------------------------------------------------------
  // Auth
  // -------------------------------------------------------
  const signup = async () => {
    try {
      const res = await axios.post(API + "/api/auth/signup", {
        name,
        email,
        password,
        role,
      });

      setToken(res.data.token);
      setUser(res.data.user);
    } catch (err) {
      alert(err?.response?.data?.error || err.message);
    }
  };

  const login = async () => {
    try {
      const res = await axios.post(API + "/api/auth/login", {
        email,
        password,
      });

      setToken(res.data.token);
      setUser(res.data.user);
    } catch (err) {
      alert(err?.response?.data?.error || err.message);
    }
  };

  // -------------------------------------------------------
  // Join room & fetch message history
  // -------------------------------------------------------
  const joinRoom = () => {
    if (!socket) return alert("Socket not connected");
    socket.emit("join-room", { roomId });
    socket.emit("get-history", { roomId });
  };

  // -------------------------------------------------------
  // Send chat message
  // -------------------------------------------------------
  const sendMessage = () => {
    if (!socket) return;
    socket.emit("chat-message", { roomId, text });
    setText("");
  };

  // -------------------------------------------------------
  // Start WebRTC call
  // -------------------------------------------------------
  const startCall = async () => {
    if (!socket) return alert("Socket not connected");

    // Create Peer connection
    pcRef.current = new RTCPeerConnection({
      iceServers: [], // <— WARNING: No TURN server (local only)
    });

    const pc = pcRef.current;

    // Send ICE candidates to peer
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("signal", {
          to: null, // server will forward to room
          data: { candidate: e.candidate, roomId },
        });
      }
    };

    // Remote stream
    pc.ontrack = (e) => {
      remoteRef.current.srcObject = e.streams[0];
    };

    // Local camera
    const localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });

    localRef.current.srcObject = localStream;
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    // Create WebRTC Offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Send OFFER to all members of room
    socket.emit("signal", {
      to: null, // broadcast to room (basic version)
      data: { type: "offer", sdp: offer, roomId },
    });
  };

  return (
    <div style={{ padding: 20 }}>
      {!token ? (
        <div>
          <h3>Signup / Login</h3>
          <input
            placeholder="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />{" "}
          <br />
          <input
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />{" "}
          <br />
          <input
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />{" "}
          <br />
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="client">Client</option>
            <option value="astrologer">Astrologer</option>
          </select>
          <br />
          <button onClick={signup}>Signup</button>
          <button onClick={login}>Login</button>
        </div>
      ) : (
        <div>
          <h3>
            Welcome {user?.name} ({user?.role})
          </h3>

          <input value={roomId} onChange={(e) => setRoomId(e.target.value)} />
          <button onClick={joinRoom}>Join Room</button>
          <button onClick={startCall}>Start Call</button>

          <div style={{ display: "flex", gap: 20, marginTop: 20 }}>
            <div>
              <h4>Local</h4>
              <video
                ref={localRef}
                autoPlay
                muted
                style={{ width: 300, height: 200, background: "#000" }}
              ></video>
            </div>

            <div>
              <h4>Remote</h4>
              <video
                ref={remoteRef}
                autoPlay
                style={{ width: 300, height: 200, background: "#000" }}
              ></video>
            </div>
          </div>

          <hr />

          <h4>Chat</h4>
          <div
            style={{
              height: 200,
              overflow: "auto",
              border: "1px solid #ccc",
              padding: 10,
            }}
          >
            {messages.map((m, i) => (
              <div key={i}>
                <b>{m.sender?.name || m.sender}</b>: {m.text}
              </div>
            ))}
          </div>

          <input value={text} onChange={(e) => setText(e.target.value)} />
          <button onClick={sendMessage}>Send</button>
        </div>
      )}
    </div>
  );
}

export default App;
