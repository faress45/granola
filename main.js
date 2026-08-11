const { app, Tray, Menu, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { exec } = require('child_process');
const { OpenAI } = require('openai');
require('dotenv').config();

let tray = null;
let hiddenWindow = null;
let isRecording = false;

// Setup directories
const desktopDir = app.getPath('desktop');
const notesDir = path.join(desktopDir, 'registration');
if (!fs.existsSync(notesDir)) fs.mkdirSync(notesDir, { recursive: true });

app.on('ready', () => {
  // Create hidden renderer window for Web Audio API capturing
  hiddenWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  hiddenWindow.loadFile('renderer.html');

  // Setup Tray
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Granola Meeting Notes');
  updateTrayMenu();
});

function createTrayIcon() {
  const { nativeImage } = require('electron');
  // Load the physical icon.png file we downloaded
  return nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
}

function updateTrayMenu() {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: isRecording ? '⏹️ Stop Recording' : '🔴 Start Recording',
      click: async () => {
        if (isRecording) {
          hiddenWindow.webContents.send('stop-recording');
        } else {
          // Get primary screen ID to capture system audio loopback
          const sources = await desktopCapturer.getSources({ types: ['screen'] });
          const screenId = sources[0].id;
          hiddenWindow.webContents.send('start-recording', screenId);
        }
        isRecording = !isRecording;
        updateTrayMenu();
        tray.setTitle(isRecording ? ' Recording...' : '');
      }
    },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' }
  ]);
  tray.setContextMenu(contextMenu);
}

// Receive the raw WebM buffer from the hidden window
ipcMain.on('save-audio', async (event, arrayBuffer) => {
  const timestamp = new Date().toISOString().replace(/T/, '-').replace(/:/g, '').slice(0, 15);
  const baseFilename = path.join(notesDir, `Meeting_Notes_${timestamp}`);
  const webmPath = `${baseFilename}.webm`;
  const wavPath = `${baseFilename}.wav`;
  const mdPath = `${baseFilename}.md`;

  tray.setTitle(' Processing...');

  // Save raw WebM
  fs.writeFileSync(webmPath, Buffer.from(arrayBuffer));

  // Convert to 16kHz Mono WAV 
  ffmpeg(webmPath)
    .outputOptions(['-ar 16000', '-ac 1'])
    .save(wavPath)
    .on('end', async () => {
      fs.unlinkSync(webmPath); // Clean up intermediate WebM
      await processMeeting(wavPath, mdPath);
      tray.setTitle('');
    });
});

async function processMeeting(wavPath, mdPath) {
  try {
    const transcript = await transcribeAudio(wavPath);
    const summary = await summarizeTranscript(transcript);
    
    const markdownContent = `
# Meeting Notes (${new Date().toLocaleString()})

## Summary
${summary}

---
## Full Transcript
${transcript}
`;
    fs.writeFileSync(mdPath, markdownContent.trim());
    
    // Create the clickable notification
    const { Notification, shell } = require('electron');
    const successNotif = new Notification({ 
      title: 'Registration Saved', 
      body: 'Notes saved to your desktop! Click here to open the file.' 
    });

    // Opens the .md file when you click the pop-up
    successNotif.on('click', () => {
      shell.openPath(mdPath); 
    });

    successNotif.show();
  } catch (error) {
    console.error(error);
    new (require('electron').Notification)({ title: 'Error Processing Meeting', body: error.message }).show();
  }
}

async function transcribeAudio(wavPath) {
  const whisperExe = process.env.WHISPER_CPP_EXE;
  const whisperModel = process.env.WHISPER_CPP_MODEL;

  // 1. Offline Execution
  if (whisperExe && whisperModel && fs.existsSync(whisperExe) && fs.existsSync(whisperModel)) {
    return new Promise((resolve, reject) => {
      const cmd = `"${whisperExe}" -m "${whisperModel}" -f "${wavPath}" -otxt -nt`;
      exec(cmd, (error) => {
        if (error) return reject(error);
        const txtPath = `${wavPath}.txt`;
        const text = fs.readFileSync(txtPath, 'utf8');
        fs.unlinkSync(txtPath);
        resolve(text);
      });
    });
  }

  // 2. API Fallback
  let clientOptions = {};
  if (process.env.GROQ_API_KEY) {
    clientOptions = { apiKey: process.env.GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1" };
  } else if (process.env.OPENAI_API_KEY) {
    clientOptions = { apiKey: process.env.OPENAI_API_KEY };
  } else {
    throw new Error('No Whisper CLI configured and no API keys found.');
  }

  const openai = new OpenAI(clientOptions);
  const response = await openai.audio.transcriptions.create({
    file: fs.createReadStream(wavPath),
    model: process.env.GROQ_API_KEY ? "whisper-large-v3" : "whisper-1",
  });
  return response.text;
}

async function summarizeTranscript(transcript) {
  let clientOptions = {};
  
  if (process.env.LOCAL_LLM_URL) {
    clientOptions = { baseURL: process.env.LOCAL_LLM_URL, apiKey: "not-needed" };
  } else if (process.env.GROQ_API_KEY) {
    clientOptions = { apiKey: process.env.GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1" };
  } else if (process.env.OPENAI_API_KEY) {
    clientOptions = { apiKey: process.env.OPENAI_API_KEY };
  } else {
    throw new Error('No LLM URL or API keys configured.');
  }

  const model = process.env.LOCAL_LLM_URL ? "local-model" : (process.env.GROQ_API_KEY ? "llama-3.3-70b-versatile" : "gpt-4o");
  const openai = new OpenAI(clientOptions);

  const completion = await openai.chat.completions.create({
    model: model,
    messages: [
      {
        role: "system",
        content: "You are an expert executive assistant. Analyze the following meeting transcript. Provide exactly three sections:\n1. A 5-bullet summary of the core discussion.\n2. Decisions made.\n3. Action items with owners.\nFormat the output in strict Markdown."
      },
      {
        role: "user",
        content: `Transcript:\n${transcript}`
      }
    ]
  });

  return completion.choices[0].message.content;
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});