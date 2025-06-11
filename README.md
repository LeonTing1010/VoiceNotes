# VoiceNotes - Obsidian Voice Recording Plugin

🎤 Quickly convert voice recordings to text notes in Obsidian

## 📢 Current Status

**Simplified Version**: Supports OpenAI Whisper transcription service only. Stable and easy to use.

## Features

- **One-Click Recording**: Start recording quickly via Ribbon icon or command palette
- **Real-time Transcription**: High-quality voice-to-text using OpenAI Whisper API
- **Auto Insert**: Transcription results automatically inserted at cursor position in current note
- **Multi-format Support**: Supports WebM, WAV, MP3, OGG and other audio formats
- **Error Handling**: Comprehensive network and API error handling

## Installation

### Manual Installation

1. Download the latest `main.js`, `manifest.json` and `styles.css` files
2. Create a `voice-notes` folder in your Obsidian plugins directory
3. Copy the files to that folder
4. Enable the "VoiceNotes" plugin in Obsidian settings

### Developer Installation

1. Clone this repository to your Obsidian plugins folder
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the plugin
4. Enable the plugin in Obsidian

## Usage

### 1. Configure API Key

First-time setup requires OpenAI API Key configuration:

1. Go to Obsidian Settings > Plugin Options > VoiceNotes
2. Enter your OpenAI API Key
3. Enable transcription if desired

### 2. Start Recording

- **Method 1**: Click the microphone icon in the left Ribbon area
- **Method 2**: Use command palette (Ctrl/Cmd + P), search for "VoiceNotes: Start Recording"

### 3. Recording & Transcription

- The plugin will record audio and save it to your current note's folder
- If transcription is enabled, it will automatically transcribe the audio using OpenAI Whisper
- Transcription results will be inserted into your current note
- Interface shows recording status and duration

## API Costs

This plugin uses OpenAI Whisper API, costs are borne by the user:
- Whisper API pricing: $0.006 per minute of audio
- Supports multiple languages including Chinese, English, etc.

## System Requirements

- Obsidian 0.15.0 or higher
- Device with microphone support
- Internet connection (for API calls)

## Privacy

- Audio data is only sent to OpenAI servers during transcription
- API Key is securely stored locally
- No user data is collected

## Troubleshooting

### Cannot Access Microphone
1. Check browser/system microphone permissions
2. Ensure no other applications are using the microphone

### Transcription Failure
1. Check internet connection
2. Verify OpenAI API Key is valid
3. Confirm API account has sufficient balance

### Poor Transcription Quality
1. Ensure relatively quiet environment
2. Maintain appropriate speaking distance and volume
3. Speak clearly

## Support

If you find this plugin helpful, consider supporting development:

[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/lt1010/3)

## License

MIT License
