# GURU LIVE TRANSLATOR

A two-person **Malayalam ↔ English** real-time faithful translation and interpretation application.

Designed specifically for private rooms where:
- **PERSON A**: Malayalam speaker (മലയാളം സംസാരിക്കുന്നയാൾ)
- **PERSON B**: English speaker

---

## Core Principle: Faithful Interpreter

This is **NOT** a general-purpose conversational chatbot. The AI functions strictly as a **FAITHFUL INTERPRETER**:
- **Never answers questions** (e.g. if the speaker asks "What is the date?", it translates "What is the date?", it does not answer).
- **Preserves meaning, tone, and intent** without embellishment or censorship.
- **Spiritual Terminology Preservation**: Terms such as *Gurudev, Guruthva, sadhana, diksha, atma, Paramatma, moksha, guru seva* are never casually substituted with unrelated English words.
- **Phonetic Roman Transliteration**: Every Malayalam text is paired with an authentic Roman/Latin transliteration for pronunciation assistance.

---

## 3 Communication Modes

1. **Text Mode**:
   - Realtime synchronized chat room.
   - Dual-language card displays: Original text, Roman transliteration, and Faithful translation.
   - Audio speaker button with auto-play and replay capabilities.
2. **Push-to-Talk Voice Mode**:
   - Hold microphone button to speak in Malayalam or English.
   - Server-side speech transcription (OpenAI Whisper).
   - Instant translation and automatic playback.
3. **Live Simultaneous Interpreter Mode**:
   - Hands-free continuous two-way live translation.

---

## Architecture & Security

- **Server-Side Security**: OpenAI API keys and credentials are kept strictly on the Node.js server (`server.ts`) and **never exposed to client-side code or browser JavaScript**.
- **Realtime Synchronization**: Authoritative server WebSocket engine (`/ws`) synchronizes rooms, participant presence, and message history without page refreshes.
- **Resilience**: Server automatically utilizes OpenAI with server-side AI fallback.

---

## Environment Variables

Configure your environment variables in `.env` (refer to `.env.example`):

```bash
# OpenAI API Key (Required for primary translation, Whisper transcription, and OpenAI TTS)
OPENAI_API_KEY="sk-..."

# Server Port
PORT=3000
```

---

## How to Test Two Devices in the Same Room

### Direct URL Format:
```
https://<YOUR-APP-URL>/room/ABC123
```
or locally:
```
http://localhost:3000/room/ABC123
```

### Step-by-Step Two-Device Testing:
1. Open the application on **Device A** (Host):
   - You can enter or generate a custom room code like `ABC123` (or click **Generate New Code**).
   - Select **Person A (Malayalam Speaker)**.
   - Click **Enter Live Translation Room**.
   - Click **"Share Room"** (or **"Copy Room Link"**) — this copies the exact `/room/ABC123` URL.
2. Open the URL directly on **Device B** (Android phone, iPhone, tablet, or another browser window):
   - Paste or open: `https://<YOUR-APP-URL>/room/ABC123`
   - The room loads immediately (no "Page Not Found"). The room ID `ABC123` is automatically extracted from the path.
   - Select **Person B (English Speaker)** and enter display name.
   - Click **Enter Live Translation Room**.
3. Send a message from either device:
   - Notice the original Malayalam, the authentic Roman transliteration, and the English translation appear on both screens simultaneously without refresh!
   - Real-time WebSocket connection reconnects automatically if the page is refreshed or mobile network shifts.
