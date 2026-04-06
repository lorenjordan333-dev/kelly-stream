const WebSocket = require("ws");
const http = require("http");
const express = require("express");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "5382867739";

async function sendTelegram(message) {
  try {
    console.log("Sending to Telegram:", message);
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Telegram error:", response.status, errorData);
      return false;
    }

    console.log("Telegram sent successfully");
    return true;
  } catch (err) {
    console.error("Telegram fetch error:", err.message);
    return false;
  }
}

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/voice", (req, res) => {
  res.send("OK");
});

app.post("/voice", (req, res) => {
  console.log("VOICE HIT");
  const host = req.headers["x-forwarded-host"] || req.headers.host || "kelly-stream-production.up.railway.app";
  const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://' + host + '/stream" /></Connect></Response>';
  res.set("Content-Type", "text/xml");
  res.status(200).send(twiml);
});

app.post("/voice-test", (req, res) => {
  console.log("voice-test hit");
  res.send("ok");
});

const server = http.createServer(app);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY;

const KELLY_INSTRUCTIONS = `You are Kelly, a professional locksmith dispatcher.

GREETING:
You always begin the call first by saying exactly:
"Locksmith services, hi, this is Kelly, how can I help?"

PHONE COLLECTION:
After the customer explains the problem, you must ask:
"Can I please get your phone number in case we get disconnected?"

Do not ask for the address before getting the phone number.
Always collect the phone number first.

PHONE CONFIRMATION:
When the customer gives a phone number, you must repeat it back clearly to confirm.
Always repeat the number exactly as the customer said it.

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
- Speak like a real human on the phone, not like reading a script
- Be friendly, relaxed, and easy to talk to
- Use natural conversational fillers like "yeah", "sure", "no worries", "okay"
- Do not jump straight into a formal answer
- Start responses in a natural way before giving the information
- Vary your wording and sentence structure
- Keep it simple, clear, and human
- Sound like you are helping, not explaining

ETA:
Only if the customer asks how long, say:
"About 20 to 25 minutes."`;

async function sendToElevenLabs(text, ws, streamSid, onDone) {
  console.log("Sending to Eleven Labs:", text);
  const voiceId = "ljX1ZrXuDIIRVcmiVSyR";

  try {
    const response = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + voiceId + "?output_format=ulaw_8000", {
      method: "POST",
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8,
          style: 0.6,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      console.error("Eleven Labs error:", response.status);
      if (onDone) onDone();
      return;
    }

    const audioBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString("base64");

    ws.send(JSON.stringify({
      event: "media",
      streamSid: streamSid,
      media: { payload: base64Audio }
    }));

    const durationMs = Math.max(1500, (text.split(" ").length / 3) * 1000);
    setTimeout(() => {
      if (onDone) onDone();
    }, durationMs);

  } catch (err) {
    console.error("Eleven Labs error:", err.message);
    if (onDone) onDone();
  }
}

async function sendToElevenLabsWeb(text, ws, onDone) {
  console.log("WEB - Sending to Eleven Labs:", text);
  const voiceId = "ljX1ZrXuDIIRVcmiVSyR";

  try {
    const response = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + voiceId + "?output_format=mp3_44100_128", {
      method: "POST",
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8,
          style: 0.6,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      console.error("Eleven Labs web error:", response.status);
      if (onDone) onDone();
      return;
    }

    const audioBuffer = await response.arrayBuffer();
    ws.send(audioBuffer);

    const durationMs = Math.max(1500, (text.split(" ").length / 3) * 1000);
    setTimeout(() => {
      if (onDone) onDone();
    }, durationMs);

  } catch (err) {
    console.error("Eleven Labs web error:", err.message);
    if (onDone) onDone();
  }
}

const wssTwilio = new WebSocket.Server({ noServer: true });
const wssWeb = new WebSocket.Server({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const pathname = request.url;
  console.log("WebSocket upgrade request:", pathname);

  if (pathname === "/stream") {
    wssTwilio.handleUpgrade(request, socket, head, (ws) => {
      wssTwilio.emit("connection", ws, request);
    });
  } else if (pathname === "/web-stream") {
    wssWeb.handleUpgrade(request, socket, head, (ws) => {
      wssWeb.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

// TWILIO
wssTwilio.on("connection", (ws) => {
  console.log("Twilio connected");

  let streamSid = null;
  let kellySpeaking = false;
  let callData = {
    phoneNumber: null,
    address: null,
    source: "PHONE"
  };

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
    console.log("OpenAI connected (Twilio)");

    openaiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        instructions: KELLY_INSTRUCTIONS,
        modalities: ["text"],
        input_audio_format: "g711_ulaw",
        turn_detection: {
          type: "server_vad",
          threshold: 0.6,
          prefix_padding_ms: 500,
          silence_duration_ms: 650,
        },
      },
    }));

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
      if (kellySpeaking) return;
      if (openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: data.media.payload,
        }));
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
        console.log("AI Response (Twilio):", content.text);

        const phoneRegex = /\d[\d\s.-]*\d/;
        const phoneMatch = content.text.match(phoneRegex);
        if (phoneMatch && !callData.phoneNumber) {
          callData.phoneNumber = phoneMatch[0].trim();
          console.log("Phone captured:", callData.phoneNumber);
          await sendTelegram("📞 PHONE CAPTURED (PHONE):\n" + callData.phoneNumber);
        }

        const addressRegex = /(\d+\s+[\w\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|circle|cir|park|place|pl|way)[\w\s]*)/i;
        const addressMatch = content.text.match(addressRegex);
        if (addressMatch && !callData.address) {
          callData.address = addressMatch[0].trim();
          console.log("Address captured:", callData.address);
        }

        if (callData.phoneNumber && callData.address) {
          await sendTelegram("🚨 COMPLETE LEAD (PHONE):\n\n📞 " + callData.phoneNumber + "\n📍 " + callData.address);
        }

        kellySpeaking = true;
        await sendToElevenLabs(content.text, ws, streamSid, () => {
          kellySpeaking = false;
          console.log("Kelly done speaking (Twilio)");
        });
      }
    }
  });

  ws.on("close", () => {
    console.log("Twilio disconnected");
    if (callData.phoneNumber) {
      sendTelegram("⚠️ CALL ENDED (PHONE):\n" + callData.phoneNumber);
    }
    openaiWs.close();
  });

  openaiWs.on("close", () => console.log("OpenAI disconnected (Twilio)"));
  openaiWs.on("error", (err) => console.error("OpenAI error (Twilio):", err.message));
});

// WEB BROWSER
wssWeb.on("connection", (ws) => {
  console.log("Web browser connected");
  sendTelegram("🔴 NEW VISITOR STARTED KELLY (WEB)");

  let kellySpeaking = false;
  let callData = {
    phoneNumber: null,
    address: null,
    source: "WEB"
  };

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
    console.log("OpenAI connected (Web)");

    openaiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        instructions: KELLY_INSTRUCTIONS,
        modalities: ["text"],
        input_audio_format: "pcm16",
        turn_detection: {
          type: "server_vad",
          threshold: 0.6,
          prefix_padding_ms: 500,
          silence_duration_ms: 650,
        },
      },
    }));

    openaiWs.send(JSON.stringify({ type: "response.create" }));
  });

  ws.on("message", (message) => {
    if (kellySpeaking) return;

    if (openaiWs.readyState === WebSocket.OPEN) {
      if (Buffer.isBuffer(message)) {
        const base64Audio = message.toString("base64");
        openaiWs.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: base64Audio,
        }));
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
      if (content && content.type === "text" && content.text) {
        console.log("AI Response (Web):", content.text);

        const phoneRegex = /\d[\d\s.-]*\d/;
        const phoneMatch = content.text.match(phoneRegex);
        if (phoneMatch && !callData.phoneNumber) {
          callData.phoneNumber = phoneMatch[0].trim();
          console.log("Phone captured:", callData.phoneNumber);
          await sendTelegram("📞 PHONE CAPTURED (WEB):\n" + callData.phoneNumber);
        }

        const addressRegex = /(\d+\s+[\w\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|circle|cir|park|place|pl|way)[\w\s]*)/i;
        const addressMatch = content.text.match(addressRegex);
        if (addressMatch && !callData.address) {
          callData.address = addressMatch[0].trim();
          console.log("Address captured:", callData.address);
        }

        if (callData.phoneNumber && callData.address) {
          await sendTelegram("🚨 COMPLETE LEAD (WEB):\n\n📞 " + callData.phoneNumber + "\n📍 " + callData.address);
        }

        kellySpeaking = true;
        await sendToElevenLabsWeb(content.text, ws, () => {
          kellySpeaking = false;
          console.log("Kelly done speaking (Web)");
        });
      }
    }
  });

  ws.on("close", () => {
    console.log("Web browser disconnected");
    if (callData.phoneNumber) {
      sendTelegram("⚠️ CALL ENDED (WEB):\n" + callData.phoneNumber);
    }
    openaiWs.close();
  });

  openaiWs.on("close", () => console.log("OpenAI disconnected (Web)"));
  openaiWs.on("error", (err) => console.error("OpenAI error (Web):", err.message));
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log("voice-stream running on port " + PORT);
  sendTelegram("✅ Kelly service started");
});
