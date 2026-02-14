# voice-prompter

Local, privacy-first teleprompter that can follow your voice (Speech Recognition) and optionally accept commands from a phone remote on the same Wi-Fi.

## Run

```bash
cd /home/soso/voice-prompter
npm install
npm start
```

Open the URL printed in the terminal (defaults to `http://localhost:32177/app`).

Override the port:

```bash
PORT=45678 npm start
```

## Notes

- Voice tracking relies on the Web Speech API and works best in Chrome / Edge.
- Depending on your browser, Speech Recognition may require an internet connection and may send audio to a speech service.
- Phone remote requires the desktop and phone to reach the same server URL (use a LAN IP link shown in the Remote modal).
