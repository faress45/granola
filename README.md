# Local Meeting Notes App

A local, telemetry-free menu bar app for Windows that records your meetings (mic + system audio), transcribes them, and generates a structured summary.

## Prerequisites

1. **Node.js** (v18+)
2. **FFmpeg**: Must be installed and added to your Windows PATH. (Used to convert WebM audio to 16kHz WAV for Whisper).
   - *Install via Winget*: `winget install ffmpeg`
3. *(Optional)* **Whisper.cpp**: For fully offline transcription.
   - Download the pre-compiled Windows binary from the [whisper.cpp releases](https://github.com/ggerganov/whisper.cpp).
   - Download a medium model (e.g., `ggml-medium.bin`).

## Installation

1. Run `npm install` to install dependencies.
2. Rename `.env.example` to `.env` and configure your API keys and local paths.
3. Run `npm start` to run the app in development mode.
4. Run `npm run make` to build the `.exe` for Windows.

## Windows Permissions
- **Microphone**: Windows will prompt you to allow the app access to your microphone upon the first recording. Ensure "Allow desktop apps to access your microphone" is enabled in Windows Privacy settings.
- **Screen/System Audio**: The app captures the primary display's audio loopback to get system sound. It happens silently in the background.

## Where are my notes?
Everything saves to `C:\Users\<YourUsername>\MeetingNotes\`.