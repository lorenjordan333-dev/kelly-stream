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

app.post("/lead", async (req, res) => {
  const { phoneNumber, address } = req.body;
  console.log("Lead received:", phoneNumber, address);

  if (!phoneNumber && !address) {
    return res.status(400).json({ error: "No data received" });
  }

  let message = "🚨 NEW LEAD (WEB):\n\n";
  if (phoneNumber) message += "📞 " + phoneNumber + "\n";
  if (address) message += "📍 " + address;

  await sendTelegram(message);
  res.status(200).json({ success: true });
});

const server = http.createServer(app);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY;

const KELLY_INSTRUCTIONS = `You are Kelly, a dispatcher for a locksmith company. You talk like a real human on the phone - casual, warm, natural. You are allowed to be a little informal, use short sentences, vary your words every time. Never sound robotic or scripted.

GREETING:
Say this exact phrase every single time, word for word, no variation:
"Locksmith services, hi, this is Kelly, how can I help?"

LISTENING:
Let the customer finish talking completely. Never interrupt. Never assume what they need before they finish.

UNDERSTANDING:
Once they finish, naturally figure out what they need and whether it is car, home, or business - but say it like a real human. Mix it up every time. Examples:
"Sure, no problem - is that for your car or your house?"
"Okay yeah, what is it - car, home, something else?"
"Got it - and is this for the house or the car?"
"Alright, is it a home or a car?"
Never say the exact same thing twice. Keep it short and casual.

BOOKING:
Once you know the service and the type, move naturally into getting their info. Say something like:
"Perfect, no problem, I can send a technician. Can you type your phone number in the box that just appeared on your screen?"
Wait silently for them to type. When they confirm say something casual like "Got it" or "Perfect thanks."
Then ask for address casually: "And the address? Just drop it in the box on your screen."
Wait silently. When confirmed say something like "Got it, perfect."
Then wrap up: "Alright, the technician will be on his way and will call you shortly."

KEY RULES:
- Always vary your wording. Never repeat the same sentence twice.
- Be casual, friendly, a little loose - like a real dispatcher on the phone.
- Never assume the service type. Only move forward when the customer has clearly finished speaking and stated what they need.
- If unclear, just ask naturally: "Sorry, what do you need exactly - locked out or something else?"
- If they correct you, say sorry quickly and move on.
- Match their language - English or French.
- Never sound like you are reading a script.

PRICING (if asked): "The tech will let you know on site, he explains everything before starting." If they push: "Service call is 45, then depends on the work."
ETA (if asked): "About 20-25 minutes."`;

// State constants
const STATE_LISTENING = "LISTENING";
const STATE_THINKING = "THINKING";
const STATE_SPEAKING = "SPEAKING";

async function sendToElevenLabs(text, ws, streamSid, onDone, getState, setState) {
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
      setState(STATE_LISTENING);
      if (onDone) onDone();
      return;
    }

    if (getState() !== STATE_SPEAKING) {
      console.log("Interrupted before audio sent (Twilio), skipping playback");
      if (onDone) onDone();
      return;
    }

    const audioBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString("base64");

    if (getState() !== STATE_SPEAKING) {
      console.log("Interrupted after fetch (Twilio), skipping playback");
      if (onDone) onDone();
      return;
    }

    ws.send(JSON.stringify({
      event: "media",
      streamSid: streamSid,
      media: { payload: base64Audio }
    }));

    const durationMs = Math.max(1500, (text.split(" ").length / 3) * 1000);
    setTimeout(() => {
      if (getState() === STATE_SPEAKING) {
        setState(STATE_LISTENING);
        console.log("Kelly done speaking (Twilio)");
      }
      if (onDone) onDone();
    }, durationMs);

  } catch (err) {
    console.error("Eleven Labs error:", err.message);
    setState(STATE_LISTENING);
    if (onDone) onDone();
  }
}

async function sendToElevenLabsWeb(text, ws, onDone, getState, setState) {
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
      setState(STATE_LISTENING);
      if (onDone) onDone();
      return;
    }

    if (getState() !== STATE_SPEAKING) {
      console.log("Interrupted before audio sent (Web), skipping playback");
      if (onDone) onDone();
      return;
    }

    const audioBuffer = await response.arrayBuffer();

    if (getState() !== STATE_SPEAKING) {
      console.log("Interrupted after fetch (Web), skipping playback");
      if (onDone) onDone();
      return;
    }

    ws.send(audioBuffer);

    const durationMs = Math.max(1500, (text.split(" ").length / 3) * 1000);
    setTimeout(() => {
      if (getState() === STATE_SPEAKING) {
        setState(STATE_LISTENING);
        console.log("Kelly done speaking (Web)");
      }
      if (onDone) onDone();
    }, durationMs);

  } catch (err) {
    console.error("Eleven Labs web error:", err.message);
    setState(STATE_LISTENING);
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
  let state = STATE_LISTENING;
  let sessionReady = false;
  let responseInProgress = false;
  let thinkingTimeout = null;

  const getState = () => state;
  const setState = (newState) => {
    console.log("State change (Twilio):", state, "->", newState);
    state = newState;
  };

  let callData = {
    phoneNumber: null,
    address: null,
    source: "PHONE",
    leadSent: false
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
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 900,
        },
      },
    }));
  });

  openaiWs.on("message", async (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (e) {
      return;
    }

    if (data.type === "session.updated" && !sessionReady) {
      sessionReady = true;
      console.log("Session ready (Twilio), sending response.create");
      responseInProgress = true;
      setState(STATE_THINKING);
      openaiWs.send(JSON.stringify({ type: "response.create" }));
      return;
    }

    if (data.type === "input_audio_buffer.speech_started") {
      console.log("User started speaking (Twilio) - interrupting Kelly");

      if (thinkingTimeout) {
        clearTimeout(thinkingTimeout);
        thinkingTimeout = null;
      }

      if (streamSid && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          event: "clear",
          streamSid: streamSid
        }));
      }

      setState(STATE_LISTENING);
      responseInProgress = false;
      return;
    }

    if (data.type === "input_audio_buffer.speech_stopped") {
      console.log("User stopped speaking (Twilio)");
      if (state === STATE_LISTENING) {
        setState(STATE_THINKING);

        thinkingTimeout = setTimeout(() => {
          if (state === STATE_THINKING) {
            console.log("Thinking timeout (Twilio) - resetting to LISTENING");
            setState(STATE_LISTENING);
            responseInProgress = false;
          }
        }, 5000);
      }
      return;
    }

    if (data.type === "response.done" && data.response) {
      if (thinkingTimeout) {
        clearTimeout(thinkingTimeout);
        thinkingTimeout = null;
      }

      const content = data.response.output?.[0]?.content?.[0];
      if (content && content.type === "text" && content.text && streamSid) {
        console.log("AI Response (Twilio):", content.text);

        if (state !== STATE_THINKING) {
          console.log("State is not THINKING (Twilio), skipping response");
          responseInProgress = false;
          return;
        }

        setState(STATE_SPEAKING);

        setTimeout(async () => {
          if (state !== STATE_SPEAKING) {
            console.log("Interrupted during delay (Twilio), skipping");
            responseInProgress = false;
            return;
          }

          await sendToElevenLabs(content.text, ws, streamSid, () => {
            responseInProgress = false;
          }, getState, setState);
        }, 350);
      } else {
        responseInProgress = false;
        setState(STATE_LISTENING);
      }
    }
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
      if (state === STATE_SPEAKING || state === STATE_THINKING) return;
      if (openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: data.media.payload,
        }));
      }
    }
  });

  ws.on("close", () => {
    console.log("Twilio disconnected");
    if (thinkingTimeout) clearTimeout(thinkingTimeout);
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

  let state = STATE_LISTENING;
  let sessionReady = false;
  let responseInProgress = false;
  let thinkingTimeout = null;

  const getState = () => state;
  const setState = (newState) => {
    console.log("State change (Web):", state, "->", newState);
    state = newState;
  };

  let callData = {
    phoneNumber: null,
    address: null,
    source: "WEB",
    leadSent: false
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
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 900,
        },
      },
    }));
  });

  openaiWs.on("message", async (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (e) {
      return;
    }

    if (data.type === "session.updated" && !sessionReady) {
      sessionReady = true;
      console.log("Session ready (Web), sending response.create");
      responseInProgress = true;
      setState(STATE_THINKING);
      openaiWs.send(JSON.stringify({ type: "response.create" }));
      return;
    }

    if (data.type === "input_audio_buffer.speech_started") {
      console.log("User started speaking (Web) - interrupting Kelly");

      if (thinkingTimeout) {
        clearTimeout(thinkingTimeout);
        thinkingTimeout = null;
      }

      setState(STATE_LISTENING);
      responseInProgress = false;
      return;
    }

    if (data.type === "input_audio_buffer.speech_stopped") {
      console.log("User stopped speaking (Web)");
      if (state === STATE_LISTENING) {
        setState(STATE_THINKING);

        thinkingTimeout = setTimeout(() => {
          if (state === STATE_THINKING) {
            console.log("Thinking timeout (Web) - resetting to LISTENING");
            setState(STATE_LISTENING);
            responseInProgress = false;
          }
        }, 5000);
      }
      return;
    }

    if (data.type === "response.done" && data.response) {
      if (thinkingTimeout) {
        clearTimeout(thinkingTimeout);
        thinkingTimeout = null;
      }

      const content = data.response.output?.[0]?.content?.[0];
      if (content && content.type === "text" && content.text) {
        console.log("AI Response (Web):", content.text);

        if (state !== STATE_THINKING) {
          console.log("State is not THINKING (Web), skipping response");
          responseInProgress = false;
          return;
        }

        setState(STATE_SPEAKING);

        setTimeout(async () => {
          if (state !== STATE_SPEAKING) {
            console.log("Interrupted during delay (Web), skipping");
            responseInProgress = false;
            return;
          }

          await sendToElevenLabsWeb(content.text, ws, () => {
            responseInProgress = false;
          }, getState, setState);
        }, 350);
      } else {
        responseInProgress = false;
        setState(STATE_LISTENING);
      }
    }
  });

  ws.on("message", async (message) => {
    if (!Buffer.isBuffer(message)) {
      let data;
      try {
        data = JSON.parse(message.toString());
      } catch (e) {
        return;
      }

      if (data.type === "typed_data") {
        console.log("Typed data received:", data);

        if (data.phoneNumber && !callData.phoneNumber) {
          callData.phoneNumber = data.phoneNumber.trim();
          console.log("Phone typed:", callData.phoneNumber);
          await sendTelegram("📞 PHONE TYPED (WEB):\n" + callData.phoneNumber);
        }

        if (data.address && !callData.address) {
          callData.address = data.address.trim();
          console.log("Address typed:", callData.address);
          await sendTelegram("📍 ADDRESS TYPED (WEB):\n" + callData.address);
        }

        if (callData.phoneNumber && callData.address && !callData.leadSent) {
          callData.leadSent = true;
          await sendTelegram("🚨 COMPLETE LEAD (WEB):\n\n📞 " + callData.phoneNumber + "\n📍 " + callData.address);
        }

        return;
      }
      return;
    }

    if (state === STATE_SPEAKING || state === STATE_THINKING) return;

    if (openaiWs.readyState === WebSocket.OPEN) {
      const base64Audio = message.toString("base64");
      openaiWs.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: base64Audio,
      }));
    }
  });

  ws.on("close", () => {
    console.log("Web browser disconnected");
    if (thinkingTimeout) clearTimeout(thinkingTimeout);
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
