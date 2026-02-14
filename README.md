# voice-prompter

Local, privacy-first teleprompter that can follow your voice (Speech Recognition) and optionally accept commands from a phone remote on the same Wi-Fi.

## What You Get

- Voice tracking: highlights/advances words as you speak (low-latency with interim results).
- Auto-scroll mode (fixed speed).
- Pop-out prompter view (for a second monitor).
- Mirror mode (for teleprompter rigs).
- Phone remote (Start/Stop, reset, word/sentence nudges, speed).

## Requirements

- Node.js 18+.
- For voice tracking: Chrome / Edge recommended (Firefox/Safari often do not support Web Speech).

## Run (Local/LAN)

```bash
cd /home/soso/voice-prompter
npm install
npm start
```

Open the URL printed in the terminal (for example `http://localhost:32177/app`).

If the port is already in use, the server will automatically try the next uncommon port and print the new URL.

Force a specific port:

```bash
PORT=45678 npm start
```

Dev mode (auto-restart on file changes):

```bash
npm run dev
```

## How To Use

1. Open `/app`.
2. Paste or type your script on the left.
3. Pick a mode:
   - Voice Tracking: press Start and read normally; the highlight should follow your speech.
   - Auto-Scroll: press Start and adjust Scroll Speed.
4. Controls:
   - Space: Start/Stop
   - Left/Right: nudge a word
   - PgUp/PgDn: jump by sentence
5. Phone remote:
   - Click "Open Remote" to show a QR code/link.
   - Open it on your phone (same Wi-Fi). The remote controls the desktop prompter.

## Privacy Notes

- Your script stays in your browser (localStorage) and is not uploaded by this app.
- Depending on your browser/OS, Speech Recognition may require an internet connection and may send audio to a speech service.
- The phone remote is a WebSocket connection to your own server (typically on your LAN).

## Troubleshooting

- "EADDRINUSE" / port conflict: run `npm start` and use the URL it prints (it will pick another port), or set `PORT=...`.
- "Voice Unsupported": use Auto-Scroll mode, or switch to Chrome/Edge.
- "It's still running old code": hard refresh (`Ctrl+Shift+R`) or open an incognito window (service worker caching).
- Remote won't connect: make sure you opened a LAN IP URL (not `localhost`) and the phone is on the same Wi-Fi.

## License

MIT. See `LICENSE`.
