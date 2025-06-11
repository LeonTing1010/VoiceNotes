import { App, Plugin, PluginSettingTab, Setting, Notice, requestUrl } from 'obsidian';

interface VoiceNotesSettings {
	openaiApiKey: string;
	enableTranscription: boolean;
}

const DEFAULT_SETTINGS: VoiceNotesSettings = {
	openaiApiKey: '',
	enableTranscription: false,
};

// Simplified recording state management
class RecordingState {
	isRecording: boolean = false;
	mediaRecorder: MediaRecorder | null = null;
	stream: MediaStream | null = null;
	audioChunks: Blob[] = [];
	startTime: number = 0;
	mimeType: string = 'audio/webm';
}

// Settings page
class VoiceNotesSettingTab extends PluginSettingTab {
	plugin: VoiceNotesPlugin;

	constructor(app: App, plugin: VoiceNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'VoiceNotes Settings' });

		// OpenAI API Key setting
		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Enter your OpenAI API Key')
			.addText(text => text
				.setPlaceholder('sk-...')
				.setValue(this.plugin.settings.openaiApiKey)
				.onChange(async (value) => {
					this.plugin.settings.openaiApiKey = value;
					await this.plugin.saveSettings();
				}));

		// Enable transcription setting
		new Setting(containerEl)
			.setName('Enable Voice Transcription')
			.setDesc('When enabled, will use OpenAI Whisper API to automatically transcribe audio content')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableTranscription)
				.onChange(async (value) => {
					this.plugin.settings.enableTranscription = value;
					await this.plugin.saveSettings();
				}));
	}
}

export default class VoiceNotesPlugin extends Plugin {
	settings: VoiceNotesSettings;
	recordingState: RecordingState = new RecordingState();
	statusBarItem: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		// Create status bar item
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.setText('🎤 VoiceNotes');
		this.statusBarItem.style.cursor = 'pointer';
		this.statusBarItem.addEventListener('click', () => {
			this.toggleRecording();
		});

		// Add ribbon icon
		this.addRibbonIcon('microphone', 'VoiceNotes: Recording', () => {
			this.toggleRecording();
		});

		// Add command
		this.addCommand({
			id: 'toggle-recording',
			name: 'Start/Stop Recording',
			callback: () => {
				this.toggleRecording();
			}
		});

		// Add settings page
		this.addSettingTab(new VoiceNotesSettingTab(this.app, this));
	}

	onunload() {
		if (this.recordingState.isRecording) {
			this.stopRecording();
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	toggleRecording() {
		if (this.recordingState.isRecording) {
			this.stopRecording();
		} else {
			this.startRecording();
		}
	}

	async startRecording() {
		if (this.recordingState.isRecording) {
			new Notice('Already recording...');
			return;
		}

		try {
			// Get microphone permission
			const stream = await navigator.mediaDevices.getUserMedia({ 
				audio: {
					echoCancellation: false,
					noiseSuppression: false,
					autoGainControl: false,
					sampleRate: 44100,
					channelCount: 1
				} 
			});

			// Detect supported audio formats
			const formatOptions = [
				{ mimeType: 'audio/webm;codecs=opus', ext: '.webm' },
				{ mimeType: 'audio/webm', ext: '.webm' },
				{ mimeType: 'audio/mpeg', ext: '.mp3' },
				{ mimeType: 'audio/wav', ext: '.wav' },
				{ mimeType: 'audio/ogg;codecs=opus', ext: '.ogg' }
			];

			let selectedFormat = { mimeType: 'audio/webm', ext: '.webm' };
			for (const format of formatOptions) {
				if (MediaRecorder.isTypeSupported(format.mimeType)) {
					selectedFormat = format;
					break;
				}
			}

			// Initialize recording state
			this.recordingState = new RecordingState();
			this.recordingState.isRecording = true;
			this.recordingState.startTime = Date.now();
			this.recordingState.stream = stream;
			this.recordingState.mimeType = selectedFormat.mimeType;

			// Create MediaRecorder
			this.recordingState.mediaRecorder = new MediaRecorder(stream, {
				mimeType: selectedFormat.mimeType,
				audioBitsPerSecond: 64000
			});

			// Collect audio data
			this.recordingState.mediaRecorder.ondataavailable = (event) => {
				if (event.data && event.data.size > 0) {
					this.recordingState.audioChunks.push(event.data);
				}
			};

			// Handle recording stop
			this.recordingState.mediaRecorder.onstop = () => {
				this.processRecording();
			};

			// Start recording
			this.recordingState.mediaRecorder.start(1000);
			
			// Update status bar
			this.updateStatusBar();
			new Notice('🔴 Recording started...');

		} catch (error) {
			console.error('Failed to start recording:', error);
			new Notice(`Cannot access microphone: ${error.message}`);
		}
	}

	stopRecording() {
		if (!this.recordingState.isRecording) {
			return;
		}

		this.recordingState.isRecording = false;

		// Stop recording
		if (this.recordingState.mediaRecorder) {
			this.recordingState.mediaRecorder.stop();
		}

		// Clean up audio stream
		if (this.recordingState.stream) {
			this.recordingState.stream.getTracks().forEach(track => track.stop());
		}

		// Update status bar
		this.statusBarItem?.setText('🎤 VoiceNotes');
		new Notice('🛑 Recording stopped');
	}

	async processRecording() {
		if (this.recordingState.audioChunks.length === 0) {
			new Notice('❌ Recording data is empty');
			return;
		}

		// Create audio file
		const audioBlob = new Blob(this.recordingState.audioChunks, { 
			type: this.recordingState.mimeType 
		});

		// 1. Save audio file to note
		const audioLink = await this.saveAudioFile(audioBlob);
		if (audioLink) {
			this.insertTextToEditor(`### Voice Note\n${audioLink}\n\n`);
		}

		// 2. If transcription is enabled, perform transcription
		if (this.settings.enableTranscription && this.settings.openaiApiKey) {
			new Notice('🔄 Transcribing...');
			try {
				const transcription = await this.transcribeAudio(audioBlob);
				if (transcription) {
					this.insertTextToEditor(`**Transcription:**\n${transcription}\n\n`);
					new Notice('✅ Transcription completed');
				}
			} catch (error) {
				console.error('Transcription failed:', error);
				new Notice(`❌ Transcription failed: ${error.message}`);
			}
		}

		// Clean up state
		this.recordingState.audioChunks = [];
	}

	async saveAudioFile(audioBlob: Blob): Promise<string | null> {
		try {
			// Determine file extension
			let extension = '.webm';
			if (audioBlob.type.includes('webm')) extension = '.webm';
			else if (audioBlob.type.includes('mp3') || audioBlob.type.includes('mpeg')) extension = '.mp3';
			else if (audioBlob.type.includes('wav')) extension = '.wav';
			else if (audioBlob.type.includes('ogg')) extension = '.ogg';

			// Generate filename
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const filename = `voice-note-${timestamp}${extension}`;

			// Get current file directory
			let folderPath = '';
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				folderPath = activeFile.parent?.path || '';
			}

			// Build full path
			const audioFilePath = folderPath ? `${folderPath}/${filename}` : filename;

			// Save file
			const arrayBuffer = await audioBlob.arrayBuffer();
			await this.app.vault.createBinary(audioFilePath, arrayBuffer);

			// Return markdown link
			return `![${filename}](${audioFilePath})`;

		} catch (error) {
			console.error('Failed to save audio file:', error);
			new Notice(`❌ Failed to save audio file: ${error.message}`);
			return null;
		}
	}

	async transcribeAudio(audioBlob: Blob): Promise<string> {
		if (!this.settings.openaiApiKey) {
			throw new Error('OpenAI API Key not configured');
		}

		// Create multipart form data boundary
		const boundary = '----formdata-obsidian-' + Math.random().toString(36);
		
		// Determine filename
		let filename = 'audio.webm';
		if (audioBlob.type.includes('webm')) filename = 'audio.webm';
		else if (audioBlob.type.includes('mp3') || audioBlob.type.includes('mpeg')) filename = 'audio.mp3';
		else if (audioBlob.type.includes('wav')) filename = 'audio.wav';
		else if (audioBlob.type.includes('ogg')) filename = 'audio.ogg';

		// Manually build multipart form data
		const audioArrayBuffer = await audioBlob.arrayBuffer();
		const audioBytes = new Uint8Array(audioArrayBuffer);
		
		const textEncoder = new TextEncoder();
		const formParts: Uint8Array[] = [];
		
		// Add file field
		formParts.push(textEncoder.encode(`--${boundary}\r\n`));
		formParts.push(textEncoder.encode(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`));
		formParts.push(textEncoder.encode(`Content-Type: ${audioBlob.type}\r\n\r\n`));
		formParts.push(audioBytes);
		formParts.push(textEncoder.encode('\r\n'));
		
		// Add model field
		formParts.push(textEncoder.encode(`--${boundary}\r\n`));
		formParts.push(textEncoder.encode(`Content-Disposition: form-data; name="model"\r\n\r\n`));
		formParts.push(textEncoder.encode('whisper-1\r\n'));
		
		// Add language field
		formParts.push(textEncoder.encode(`--${boundary}\r\n`));
		formParts.push(textEncoder.encode(`Content-Disposition: form-data; name="language"\r\n\r\n`));
		formParts.push(textEncoder.encode('zh\r\n'));
		
		// End boundary
		formParts.push(textEncoder.encode(`--${boundary}--\r\n`));
		
		// Calculate total length and merge all parts
		const totalLength = formParts.reduce((sum, part) => sum + part.length, 0);
		const formDataBuffer = new Uint8Array(totalLength);
		let offset = 0;
		for (const part of formParts) {
			formDataBuffer.set(part, offset);
			offset += part.length;
		}

		// Use Obsidian's requestUrl method to send request
		try {
			const response = await requestUrl({
				url: 'https://api.openai.com/v1/audio/transcriptions',
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.settings.openaiApiKey}`,
					'Content-Type': `multipart/form-data; boundary=${boundary}`
				},
				body: formDataBuffer.buffer
			});

			if (response.json && response.json.text) {
				return response.json.text.trim();
			} else {
				throw new Error('Invalid transcription result format');
			}

		} catch (error) {
			console.error('OpenAI API error:', error);
			
			// Handle different types of errors
			let errorMessage = 'Transcription failed';
			if (error.status === 401) {
				errorMessage = 'Invalid API Key or unauthorized';
			} else if (error.status === 429) {
				errorMessage = 'API request rate limit exceeded, please try again later';
			} else if (error.status === 403) {
				errorMessage = 'API access denied, please check API Key permissions';
			} else if (error.message) {
				errorMessage = error.message;
			}
			
			throw new Error(errorMessage);
		}
	}

	insertTextToEditor(text: string) {
		if (!text || text.trim() === '') {
			return;
		}

		const activeLeaf = this.app.workspace.activeLeaf;
		if (!activeLeaf) {
			new Notice('❌ No active note page');
			return;
		}

		const view = activeLeaf.view;
		if (view.getViewType() !== 'markdown') {
			new Notice('❌ Current page is not a Markdown note');
			return;
		}

		const editor = (view as any).editor;
		if (!editor) {
			new Notice('❌ Cannot find editor');
			return;
		}

		try {
			const cursor = editor.getCursor();
			const textToInsert = text.trim() + '\n';
			editor.replaceRange(textToInsert, cursor);
			editor.setCursor(cursor.line + textToInsert.split('\n').length - 1, 0);
		} catch (error) {
			console.error('Failed to insert text:', error);
			new Notice(`❌ Failed to insert text: ${error.message}`);
		}
	}

	updateStatusBar() {
		if (!this.statusBarItem) return;

		if (this.recordingState.isRecording) {
			const duration = Math.floor((Date.now() - this.recordingState.startTime) / 1000);
			this.statusBarItem.setText(`🔴 Recording ${duration}s`);
			
			// Update every second
			setTimeout(() => {
				if (this.recordingState.isRecording) {
					this.updateStatusBar();
				}
			}, 1000);
		} else {
			this.statusBarItem.setText('🎤 VoiceNotes');
		}
	}
}
