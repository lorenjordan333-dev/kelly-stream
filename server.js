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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message })
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

app.get("/voice", (req, res) => { res.send("OK"); });

app.post("/voice", (req, res) => {
  console.log("VOICE HIT");
  const host = req.headers["x-forwarded-host"] || req.headers.host || "kelly-stream-production.up.railway.app";
  const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://' + host + '/stream" /></Connect></Response>';
  res.set("Content-Type", "text/xml");
  res.status(200).send(twiml);
});

app.post("/voice-test", (req, res) => { console.log("voice-test hit"); res.send("ok"); });

app.post("/lead", async (req, res) => {
  const { phoneNumber, address } = req.body;
  console.log("Lead received:", phoneNumber, address);
  if (!phoneNumber && !address) return res.status(400).json({ error: "No data received" });
  let message = "🚨 NEW LEAD (WEB):\n\n";
  if (phoneNumber) message += "📞 " + phoneNumber + "\n";
  if (address) message += "📍 " + address;
  await sendTelegram(message);
  res.status(200).json({ success: true });
});

const server = http.createServer(app);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY;

const KELLY_INSTRUCTIONS = `You are Kelly, a professional locksmith dispatcher.

GREETING:
You always begin the call first by saying exactly:
"Locksmith services, hi, this is Kelly, how can I help?"
Then stop. Wait completely. Do not say anything else until the customer has fully finished speaking.


UNDERSTANDING THE PROBLEM:
Never assume the customer has a problem until they tell you. If they just say hello or ask how you are, respond naturally first.
Listen carefully to everything the customer says. Do not interrupt. Do not assume. Do not predict.
You must never guess or infer the service type. You must never move forward based on a partial sentence or a single word.
Wait until the customer has fully and completely finished their entire explanation before you respond.

Only respond after the customer finishes speaking.
Do not interrupt.

After understanding the problem, be supportive and reassuring.
Make them feel they are in good hands and you will take care of it.

Then ask if it is for a car, home, or business.

Get both pieces of information before moving to phone collection:
1. What service they need (lockout or lock change) - must be explicitly stated by customer
2. What type (car, home, or business) - must be explicitly stated by customer

Only when you have both clearly confirmed, move to phone collection.

PHONE COLLECTION:
Once you understand their problem completely, say exactly:
"Can I get your phone number? Please type it in the box that just appeared on your screen."
Then wait silently. Do not ask them to say it out loud. Do not try to capture it from voice.
Once they confirm they typed it, say: "Got it, thank you."

ADDRESS:
After phone number is confirmed, say exactly:
"Can you please type your address in the box on your screen as well? I need the street number, street name, city, and postal code."
Do not ask them to say it out loud. Do not try to capture it from voice.
Once they confirm they typed it, say: "Perfect, thank you."

AFTER ADDRESS:
Once the address is confirmed, say exactly:
"The technician will be on the way and will call you shortly."

CORRECTION RULE:
If the customer says no, that is wrong, you made a mistake, or anything negative about your last response:
Stop immediately.
Apologize briefly.
Ask them to clarify.
Do not continue to the next step until corrected.

WAITING RULE:
Always wait for the customer to finish speaking completely before responding.
Never interrupt.
Never assume. Never predict. Never jump ahead.
Never move to the next question until the current one is fully answered.

LANGUAGE — HIGHEST PRIORITY:
Detect the language of the customer from their very first word.
If they speak French, respond in French immediately and stay in French for the entire call.
If they speak English, respond in English and stay in English for the entire call.
Never switch languages. Never respond in English if the customer spoke French.

PRICING:
If the customer asks for the price, first say:
"The technician will let you know on site depending on the lock. He will explain everything before starting anything."
If the customer insists, say:
"The service call is 45, and then it depends on the work. The technician will confirm everything with you before starting."

STYLE:
- Speak like a real human on the phone, not like reading a script
- Be friendly, relaxed, and easy to talk to
- Use natural conversational fillers like "yeah", "sure", "no worries", "okay"
- Keep it simple, clear, and human
- Sound like you are helping, not explaining

ETA:
Only if the customer asks how long, say:
"About 20 to 25 minutes."`;

const STATE_LISTENING = "LISTENING";
const STATE_THINKING = "THINKING";
const STATE_SPEAKING = "SPEAKING";

async function sendToElevenLabs(text, ws, streamSid, onDone, getState, setState) {
  console.log("Sending to Eleven Labs:", text);
  const voiceId = "3sfGn775ryaDXhFWHwBg";
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + voiceId + "?output_format=ulaw_8000", {
      method: "POST",
      headers: { "xi-api-key": ELEVEN_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.6, use_speaker_boost: true }
      })
    });
    if (!response.ok) { console.error("Eleven Labs error:", response.status); setState(STATE_LISTENING); if (onDone) onDone(); return; }
    if (getState() !== STATE_SPEAKING) { console.log("Interrupted before audio sent (Twilio), skipping"); if (onDone) onDone(); return; }
    const audioBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString("base64");
    if (getState() !== STATE_SPEAKING) { console.log("Interrupted after fetch (Twilio), skipping"); if (onDone) onDone(); return; }
    ws.send(JSON.stringify({ event: "media", streamSid: streamSid, media: { payload: base64Audio } }));
    const durationMs = Math.max(1500, (text.split(" ").length / 3) * 1000);
    setTimeout(() => {
      if (getState() === STATE_SPEAKING) { setState(STATE_LISTENING); console.log("Kelly done speaking (Twilio)"); }
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
  const voiceId = "3sfGn775ryaDXhFWHwBg";
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + voiceId + "?output_format=mp3_44100_128", {
      method: "POST",
      headers: { "xi-api-key": ELEVEN_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.6, use_speaker_boost: true }
      })
    });
    if (!response.ok) { console.error("Eleven Labs web error:", response.status); setState(STATE_LISTENING); if (onDone) onDone(); return; }
    if (getState() !== STATE_SPEAKING) { console.log("Interrupted before audio sent (Web), skipping"); if (onDone) onDone(); return; }
    const audioBuffer = await response.arrayBuffer();
    if (getState() !== STATE_SPEAKING) { console.log("Interrupted after fetch (Web), skipping"); if (onDone) onDone(); return; }
    ws.send(audioBuffer);
    const durationMs = Math.max(1500, (text.split(" ").length / 6) * 1000);
    console.log("Audio sent to frontend (Web), waiting " + durationMs + "ms");
    setTimeout(() => {
      if (getState() === STATE_SPEAKING) { setState(STATE_LISTENING); console.log("Kelly done speaking (Web)"); }
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
    wssTwilio.handleUpgrade(request, socket, head, (ws) => { wssTwilio.emit("connection", ws, request); });
  } else if (pathname === "/web-stream") {
    wssWeb.handleUpgrade(request, socket, head, (ws) => { wssWeb.emit("connection", ws, request); });
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
  let greetingDone = false; // KEY: tracks if greeting finished and customer spoke at least once
  let customerSpokeOnce = false;
  const getState = () => state;
  const setState = (newState) => { console.log("State change (Twilio):", state, "->", newState); state = newState; };
  let callData = { phoneNumber: null, address: null, source: "PHONE", leadSent: false };

  const openaiWs = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview", {
    headers: { Authorization: "Bearer " + OPENAI_API_KEY, "OpenAI-Beta": "realtime=v1" }
  });

  openaiWs.on("open", () => {
    console.log("OpenAI connected (Twilio)");
    openaiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        instructions: KELLY_INSTRUCTIONS,
        modalities: ["text"],
        input_audio_format: "g711_ulaw",
        turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 600 },
      },
    }));
  });

  openaiWs.on("message", async (message) => {
    let data;
    try { data = JSON.parse(message.toString()); } catch (e) { return; }

    if (data.type === "session.updated" && !sessionReady) {
      sessionReady = true;
      console.log("Session ready (Twilio), sending greeting response.create");
      responseInProgress = true;
      setState(STATE_THINKING);
      openaiWs.send(JSON.stringify({ type: "response.create" }));
      return;
    }

    if (data.type === "input_audio_buffer.speech_started") {
      console.log("User started speaking (Twilio)");
      if (state === STATE_LISTENING) {
        console.log("Already LISTENING (Twilio), ignoring interrupt");
        return;
      }
      console.log("Interrupting Kelly (Twilio)");
      if (thinkingTimeout) { clearTimeout(thinkingTimeout); thinkingTimeout = null; }
      if (streamSid && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: "clear", streamSid: streamSid }));
      }
      setState(STATE_LISTENING);
      responseInProgress = false;
      return;
    }

    if (data.type === "input_audio_buffer.speech_stopped") {
      console.log("User stopped speaking (Twilio)");
      if (state === STATE_LISTENING) {
        // Only respond if greeting is done
        if (!greetingDone) {
          console.log("Greeting not done yet (Twilio), ignoring customer speech");
          return;
        }
        customerSpokeOnce = true;
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
      if (thinkingTimeout) { clearTimeout(thinkingTimeout); thinkingTimeout = null; }
      const content = data.response.output?.[0]?.content?.[0];
      if (content && content.type === "text" && content.text && streamSid) {
        console.log("AI Response (Twilio):", content.text);
        if (state !== STATE_THINKING) { console.log("State is not THINKING (Twilio), skipping"); responseInProgress = false; return; }
        setState(STATE_SPEAKING);

        // Mark greeting as done after first response plays
        setTimeout(async () => {
          if (state !== STATE_SPEAKING) { responseInProgress = false; return; }
          await sendToElevenLabs(content.text, ws, streamSid, () => {
            responseInProgress = false;
            if (!greetingDone) {
              greetingDone = true;
              console.log("Greeting done (Twilio) - now listening for customer");
            }
          }, getState, setState);
        }, 350);
      } else {
        responseInProgress = false;
        setState(STATE_LISTENING);
        if (!greetingDone) {
          greetingDone = true;
          console.log("Greeting done (Twilio) - now listening for customer");
        }
      }
    }
  });

  ws.on("message", (message) => {
    let data;
    try { data = JSON.parse(message.toString()); } catch (e) { return; }
    if (data.event === "start") { streamSid = data.start.streamSid; console.log("Stream started:", streamSid); return; }
    if (data.event === "media") {
      if (state === STATE_SPEAKING || state === STATE_THINKING) return;
      if (openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: data.media.payload }));
      }
    }
  });

  ws.on("close", () => {
    console.log("Twilio disconnected");
    if (thinkingTimeout) clearTimeout(thinkingTimeout);
    if (callData.phoneNumber) sendTelegram("⚠️ CALL ENDED (PHONE):\n" + callData.phoneNumber);
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
  let greetingDone = false; // KEY: tracks if greeting finished and customer spoke at least once
  let customerSpokeOnce = false;
  const getState = () => state;
  const setState = (newState) => { console.log("State change (Web):", state, "->", newState); state = newState; };
  let callData = { phoneNumber: null, address: null, source: "WEB", leadSent: false };

  const openaiWs = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview", {
    headers: { Authorization: "Bearer " + OPENAI_API_KEY, "OpenAI-Beta": "realtime=v1" }
  });

  openaiWs.on("open", () => {
    console.log("OpenAI connected (Web)");
    openaiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        instructions: KELLY_INSTRUCTIONS,
        modalities: ["text"],
        input_audio_format: "pcm16",
        turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 600 },
      },
    }));
  });

  openaiWs.on("message", async (message) => {
    let data;
    try { data = JSON.parse(message.toString()); } catch (e) { return; }

    if (data.type === "session.updated" && !sessionReady) {
      sessionReady = true;
      console.log("Session ready (Web), sending greeting response.create");
      responseInProgress = true;
      setState(STATE_THINKING);
      openaiWs.send(JSON.stringify({ type: "response.create" }));
      return;
    }

    if (data.type === "input_audio_buffer.speech_started") {
      console.log("User started speaking (Web)");
      if (state === STATE_LISTENING) {
        console.log("Already LISTENING (Web), ignoring interrupt");
        return;
      }
      console.log("Interrupting Kelly (Web)");
      if (thinkingTimeout) { clearTimeout(thinkingTimeout); thinkingTimeout = null; }
      setState(STATE_LISTENING);
      responseInProgress = false;
      return;
    }

    if (data.type === "input_audio_buffer.speech_stopped") {
      console.log("User stopped speaking (Web)");
      if (state === STATE_LISTENING) {
        // Only respond if greeting is done
        if (!greetingDone) {
          console.log("Greeting not done yet (Web), ignoring customer speech");
          return;
        }
        customerSpokeOnce = true;
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
      if (thinkingTimeout) { clearTimeout(thinkingTimeout); thinkingTimeout = null; }
      const content = data.response.output?.[0]?.content?.[0];
      if (content && content.type === "text" && content.text) {
        console.log("AI Response (Web):", content.text);
        if (state !== STATE_THINKING) { console.log("State is not THINKING (Web), skipping"); responseInProgress = false; return; }
        setState(STATE_SPEAKING);

        setTimeout(async () => {
          if (state !== STATE_SPEAKING) { responseInProgress = false; return; }
          await sendToElevenLabsWeb(content.text, ws, () => {
            responseInProgress = false;
            if (!greetingDone) {
              greetingDone = true;
              console.log("Greeting done (Web) - now listening for customer");
            }
          }, getState, setState);
        }, 350);
      } else {
        responseInProgress = false;
        setState(STATE_LISTENING);
        if (!greetingDone) {
          greetingDone = true;
          console.log("Greeting done (Web) - now listening for customer");
        }
      }
    }
  });

  ws.on("message", async (message) => {
    if (!Buffer.isBuffer(message)) {
      let data;
      try { data = JSON.parse(message.toString()); } catch (e) { return; }
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
      openaiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64Audio }));
    }
  });

  ws.on("close", () => {
    console.log("Web browser disconnected");
    if (thinkingTimeout) clearTimeout(thinkingTimeout);
    if (callData.phoneNumber) sendTelegram("⚠️ CALL ENDED (WEB):\n" + callData.phoneNumber);
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
