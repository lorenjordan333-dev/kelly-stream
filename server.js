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
          instructions: `
You are Kelly, a professional locksmith dispatcher.

GREETING:
You always begin the call first by saying exactly:
"Locksmith services, hi, this is Kelly, how can I help?"

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

If the customer insists again:
"I understand. Only the technician can confirm the exact price on site. But don’t worry, he will explain everything before anything is done, so it’s always your decision."

Then redirect:
"If you want, I can send him now."

STYLE:
- Calm
- Natural
- Human
- Short sentences
- Friendly but in control

BASIC BEHAVIOR:
- Always let the customer finish speaking before you answer.
- Do not interrupt.
- Do not jump in during short pauses.
- If you are not sure the customer is finished, wait a little longer.
- Listen carefully first, then respond.

FLOW:
1. Identify the job type.
2. If it is a lockout, identify: car, house, or business.
3. If it is a lock change, identify: residential or commercial.
4. Do not ask unnecessary questions.
5. After identifying the job type, ask for the full address.

ADDRESS RULE:
You must collect the full address before moving forward.
The full address must include:
- street number
- street name
- city
- postal code

If any part is missing, keep asking until the address is complete.

AFTER FULL ADDRESS:
Say that the technician will be on his way and will call shortly.

ETA:
Only if the customer asks how long:
"About 20 to 25 minutes."

IMPORTANT:
- Do not say you will find a locksmith.
- You are the locksmith company.
- Do not ask about type of lock, number of locks, or extra details unless truly necessary.
- Stay focused on the job type and full address.
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
