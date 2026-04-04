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
const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY;

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

  async function sendToElevenLabs(text, ws, streamSid) {
    console.log("Sending to Eleven Labs:", text);

    const voiceId = "EXAVITQu4vr4xnSDxMaL";

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=ulaw_8000`, {
        method: "POST",
        headers: {
          "xi-api-key": ELEVEN_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: text,
          model_id: "eleven_multilingual_v2"
        })
      });

      if (!response.ok) {
        console.error("Eleven Labs error:", response.status, response.statusText);
        return;
      }

      const audioBuffer = await response.arrayBuffer();
      const base64Audio = Buffer.from(audioBuffer).toString("base64");

      console.log("Audio received, sending to Twilio");

      ws.send(JSON.stringify({
        event: "media",
        streamSid: streamSid,
        media: { payload: base64Audio }
      }));
    } catch (err) {
      console.error("Eleven Labs fetch error:", err.message);
    }
  }

  openaiWs.on("open", () => {
    console.log("OpenAI connected");

    openaiWs.send(
      JSON.stringify({
        type: "session.update",
        session: {
          instructions: `You are Kelly, a professional locksmith dispatcher.

GREETING:
You always begin the call first by saying exactly:
"Locksmith services, hi, this is Kelly, how can I help?"

WAITING RULE:
After the greeting, wait for the customer to speak.
Do not interrupt the customer.
Always let the customer finish speaking completely before responding.
Never jump in while the customer is still talking.

JOB:
Your job is to:
1. Identify the job (lockout or lock change)
2. Ask for the full address

ADDRESS:
Ask naturally: "Can you please give me the address so I can send a technician?"
You must have: street name, street number, city, and postal code.
If any part is missing, ask only for what is missing.
Do not continue without a complete address.

AFTER ADDRESS:
Once you have the full address, say:
"The technician will be on the way and will call shortly."

LANGUAGE:
Speak in the same language as the customer.
If the customer speaks French, respond in French.
If the customer speaks English, respond in English.

PRICING:
If the customer asks for the price, first say:
"The technician will let you know on site depending on the lock. He will explain everything before starting anything."
If the customer insists, say:
"The service call is 45, and then it depends on the work. The technician will confirm everything with you before starting."

STYLE:
- Speak in a natural, human way
- Sound alive and engaged, not robotic
- Vary your wording and sentence structure
- Do not repeat the same phrasing each time
- Use a relaxed, conversational tone

ETA:
Only if the customer asks how long, say:
"About 20 to 25 minutes."`,
          modalities: ["text"],
          input_audio_format: "g711_ulaw",
          turn_detection: {
            type: "server_vad",
            threshold: 0.6,
            prefix_padding_ms: 500,
            silence_duration_ms: 850,
          },
        },
      })
    );

    openaiWs.send(JSON.stringify({ type: "response.create" }));
  });

  ws.on("message", (message) => {
    let data;

    try {
      data = JSON.parse(message.toString());
    } catch (e) {
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
  });

  openaiWs.on("message", async (message) => {
    let data;

    try {
      data = JSON.parse(message.toString());
    } catch (e) {
      return;
    }

    if (data.type === "response.done" && data.response) {
      const content = data.response.output?.[0]?.content?.[0];

      if (content && content.type === "text" && content.text && streamSid) {
        console.log("AI Response:", content.text);
        await sendToElevenLabs(content.text, ws, streamSid);
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
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log("voice-stream running on port " + PORT);
});
