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

const KELLY_INSTRUCTIONS = `You are Kelly, a professional locksmith dispatcher.

GREETING:
You always begin the call first by saying exactly:
"Locksmith services, hi, this is Kelly, how can I help?"

UNDERSTANDING THE PROBLEM:
Wait for the customer to explain what they need.
Listen carefully. Do not interrupt.
Do not assume or predict what the customer needs. Only respond to what they have fully and explicitly said.
If you are not 100% sure the customer has finished speaking, wait silently. Do not respond yet.
Never complete the customer's sentence. Never jump ahead.

Only after the customer has completely finished speaking:
If they said "locked out", ask: "Is it your car, home, or business?"
If they said "lock change", ask: "Is it your car, home, or business?"

Get both pieces of information before moving to phone collection:
1. What service they need (lockout or lock change)
2. What type (car, home, or business)

Only when you understand both clearly and completely, move to phone collection.

PHONE COLLECTION:
Once you understand their problem completely, say exactly:
"Can I get your phone number? Please type it in the box that just appeared on your screen."
Then wait silently. Do not ask them to say it out loud. Do not try to capture it from voice.
Once they confirm they typed it, say: "Got it, thank you."

ADDRESS:
After phone number is confirmed, say exactly:
"Can you please type your address in the box on your screen as well? I need the street number, street name, city, and postal code."
Then wait silently. Do not ask them to say it out loud. Do not try to capture it from voice.
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
Take your time. Do not rush.

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
- Keep it simple, clear, and human
- Sound like you are helping, not explaining

ETA:
Only if the customer asks how long, say:
"About 20 to 25 minutes."`;

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

    if (!response.ok
