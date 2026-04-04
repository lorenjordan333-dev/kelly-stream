const WebSocket = require("ws");
const http = require("http");
const express = require("express");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/voice", (req, res) => {
  res.send("OK");
});

app.post("/voice", (req, res) => {
  console.log("VOICE HIT");
  const host = req.headers["x-forwarded-host"] || req.headers.host || "voice-project-production-3574.up.railway.app";
  const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://' + host + '/stream" /></Connect></Response>';
  res.set("Content-Type", "text/xml");
  res.status(200).send(twiml);
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/stream" });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

wss.on("connection", (ws) => {
  console.log("Twilio connected");

  let streamSid = null;
  let greetingSent = false;

  const openaiWs = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
    {
      headers: {
        Authorization: "Bearer " + OPENAI_API_KEY,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  openaiWs.on("open", () => {
    console.log("OpenAI connected");

    openaiWs.send(
      JSON.stringify({
        type: "session.update",
        session: {
          instructions: "You are Kelly, a professional locksmith dispatcher. Always greet with: Locksmith services, hi, this is Kelly, how can I help? Be natural, calm, and human. Speak in short sentences. Listen more than you talk. Never interrupt the customer. Always let the customer finish speaking completely before responding. If the customer speaks French, switch fully to French. Ask for the service type and full address. Once you have both, say the technician will be on the way. If asked about price: The service call is 45 dollars, and the technician will confirm exact price on site depending on the lock. If asked about ETA: About 20 to 25 minutes.",
          voice: "alloy",
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          turn_detection: {
            type: "server_vad",
            threshold: 0.6,
            prefix_padding_ms: 500,
            silence_duration_ms: 1200,
          },
        },
      })
    );

    if (!greetingSent) {
      greetingSent = true;
      console.log("Greeting fired");
      openaiWs.send(JSON.stringify({ type: "response.create" }));
    }
  });

  ws.on("message", (message) => {
    let data;

    try {
      data = JSON.parse(message.toString());
    } catch (e) {
      console.error("JSON parse error:", e.message);
      return;
    }

    if (data.event === "start") {
      streamSid = data.start.streamSid;
      console.log("Stream started:", streamSid);
      return;
    }

    if (data.event === "media") {
      if (openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: data.media.payload,
          })
        );
      }
    }

    if (data.event === "stop") {
      console.log("Stream stopped");
    }
  });

  openaiWs.on("message", (message) => {
    let data;

    try {
      data = JSON.parse(message.toString());
    } catch (e) {
      console.error("OpenAI JSON parse error:", e.message);
      return;
    }

    if (data.type === "response.audio.delta" && data.delta && streamSid) {
      ws.send(
        JSON.stringify({
          event: "media",
          streamSid: streamSid,
          media: { payload: data.delta },
        })
      );
    }

    if (data.type === "conversation.item.input_audio_transcription.completed") {
      const text = data.transcript;
      if (text) {
        console.log("USER:", text);
      }
    }
  });

  ws.on("close", () => {
    console.log("Twilio disconnected");
    openaiWs.close();
  });

  openaiWs.on("close", () => {
    console.log("OpenAI disconnected");
  });

  openaiWs.on("error", (err) => {
    console.error("OpenAI error:", err.message);
  });

  ws.on("error", (err) => {
    console.error("Twilio error:", err.message);
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log("voice-stream running on port " + PORT);
});
