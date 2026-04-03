const WebSocket = require("ws");
const http = require("http");

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

wss.on("connection", (ws) => {
  console.log("📞 Twilio connected");

  let streamSid = null;
  let openaiReady = false;
  let greetingSent = false;

  const openaiWs = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  function trySendGreeting() {
    if (!openaiReady || !streamSid || greetingSent) return;

    greetingSent = true;

    openaiWs.send(
      JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["audio"],
          instructions:
            "Say exactly: Locksmith services, hi, this is Kelly, how can I help?",
        },
      })
    );
  }

  openaiWs.on("open", () => {
    console.log("🤖 OpenAI connected");

    openaiWs.send(
      JSON.stringify({
        type: "session.update",
        session: {
          turn_detection: {
  type: "server_vad",
  silence_duration_ms: 800
},
          instructions: `
You are Kelly, a professional locksmith dispatcher.

GREETING:
You always begin the call first by saying exactly:
"Locksmith services, hi, this is Kelly, how can I help?"

After that, wait for the customer to speak.

Do not interrupt the customer.
Always let the customer finish speaking before responding.

Your job is to:
1. Identify the job (lockout or lock change)
2. Ask for the full address (street, city, postal code)

Do not continue without full address.

Once you have the full address:
Say the technician will be on the way and will call shortly.

LANGUAGE:

Speak in the same language as the customer.
If the customer speaks French, respond in French.
If the customer speaks English, respond in English.

---

PRICING:

If the customer asks for the price:

First response:
"The technician will let you know on site depending on the lock. He will explain everything before starting anything."

If the customer insists:
"The service call is 45, and then it depends on the work. The technician will confirm everything with you before starting."



STYLE:
- Calm
- Natural
- Human
- Short sentences
- Friendly but in control



ETA:
Only if the customer asks how long:
"About 20 to 25 minutes."


`,
          turn_detection: { type: "server_vad" },
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          voice: "alloy",
        },
      })
    );
  });

  // 👉 FROM TWILIO → OPENAI
  ws.on("message", (message) => {
    let data;

    try {
      data = JSON.parse(message.toString());
    } catch (e) {
      return;
    }

    if (data.event === "start") {
      streamSid = data.start.streamSid;
      console.log("▶️ Stream started:", streamSid);
      trySendGreeting();
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
  });

  // 👉 FROM OPENAI → TWILIO
  openaiWs.on("message", (message) => {
    let data;

    try {
      data = JSON.parse(message.toString());
    } catch (e) {
      return;
    }

    if (data.type === "session.created") {
      console.log("✅ session ready");
      openaiReady = true;
      trySendGreeting();
      return;
    }

    if (data.type === "response.audio.delta" && data.delta && streamSid) {
      ws.send(
        JSON.stringify({
          event: "media",
          streamSid: streamSid,
          media: {
            payload: data.delta,
          },
        })
      );
    }
  });

  ws.on("close", () => {
    console.log("❌ Twilio disconnected");
    openaiWs.close();
  });

  openaiWs.on("close", () => {
    console.log("❌ OpenAI disconnected");
  });

  openaiWs.on("error", (err) => {
    console.error("OpenAI error:", err.message);
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log("voice-stream running on port " + PORT);
});
