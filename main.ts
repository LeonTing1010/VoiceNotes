import { App, Plugin, PluginSettingTab, Setting, Notice, requestUrl } from 'obsidian';

interface VoiceNotesSettings {
	openaiApiKey: string;
	enableTranscription: boolean;
}

const DEFAULT_SETTINGS: VoiceNotesSettings = {
	openaiApiKey: '',
	enableTranscription: false,
};

// 简化的录音状态管理
class RecordingState {
	isRecording: boolean = false;
	mediaRecorder: MediaRecorder | null = null;
	stream: MediaStream | null = null;
	audioChunks: Blob[] = [];
	startTime: number = 0;
	mimeType: string = 'audio/webm';
}

// 设置页面
class VoiceNotesSettingTab extends PluginSettingTab {
	plugin: VoiceNotesPlugin;

	constructor(app: App, plugin: VoiceNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'VoiceNotes 设置' });

		// OpenAI API Key 设置
		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('请输入您的 OpenAI API Key')
			.addText(text => text
				.setPlaceholder('sk-...')
				.setValue(this.plugin.settings.openaiApiKey)
				.onChange(async (value) => {
					this.plugin.settings.openaiApiKey = value;
					await this.plugin.saveSettings();
				}));

		// 启用转录设置
		new Setting(containerEl)
			.setName('启用语音转录')
			.setDesc('开启后将使用 OpenAI Whisper API 自动转录录音内容')
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

		// 创建状态栏项目
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.setText('🎤 VoiceNotes');
		this.statusBarItem.style.cursor = 'pointer';
		this.statusBarItem.addEventListener('click', () => {
			this.toggleRecording();
		});

		// 添加功能区图标
		this.addRibbonIcon('microphone', 'VoiceNotes: 录音', () => {
			this.toggleRecording();
		});

		// 添加命令
		this.addCommand({
			id: 'toggle-recording',
			name: '开始/停止录音',
			callback: () => {
				this.toggleRecording();
			}
		});

		// 添加设置页面
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
			new Notice('已经在录音中...');
			return;
		}

		try {
			// 获取麦克风权限
			const stream = await navigator.mediaDevices.getUserMedia({ 
				audio: {
					echoCancellation: false,
					noiseSuppression: false,
					autoGainControl: false,
					sampleRate: 44100,
					channelCount: 1
				} 
			});

			// 检测支持的音频格式
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

			// 初始化录音状态
			this.recordingState = new RecordingState();
			this.recordingState.isRecording = true;
			this.recordingState.startTime = Date.now();
			this.recordingState.stream = stream;
			this.recordingState.mimeType = selectedFormat.mimeType;

			// 创建 MediaRecorder
			this.recordingState.mediaRecorder = new MediaRecorder(stream, {
				mimeType: selectedFormat.mimeType,
				audioBitsPerSecond: 64000
			});

			// 收集音频数据
			this.recordingState.mediaRecorder.ondataavailable = (event) => {
				if (event.data && event.data.size > 0) {
					this.recordingState.audioChunks.push(event.data);
				}
			};

			// 录音停止时的处理
			this.recordingState.mediaRecorder.onstop = () => {
				this.processRecording();
			};

			// 开始录音
			this.recordingState.mediaRecorder.start(1000);
			
			// 更新状态栏
			this.updateStatusBar();
			new Notice('🔴 开始录音...');

		} catch (error) {
			console.error('录音启动失败:', error);
			new Notice(`无法访问麦克风: ${error.message}`);
		}
	}

	stopRecording() {
		if (!this.recordingState.isRecording) {
			return;
		}

		this.recordingState.isRecording = false;

		// 停止录音
		if (this.recordingState.mediaRecorder) {
			this.recordingState.mediaRecorder.stop();
		}

		// 清理音频流
		if (this.recordingState.stream) {
			this.recordingState.stream.getTracks().forEach(track => track.stop());
		}

		// 更新状态栏
		this.statusBarItem?.setText('🎤 VoiceNotes');
		new Notice('🛑 录音已停止');
	}

	async processRecording() {
		if (this.recordingState.audioChunks.length === 0) {
			new Notice('❌ 录音数据为空');
			return;
		}

		// 创建音频文件
		const audioBlob = new Blob(this.recordingState.audioChunks, { 
			type: this.recordingState.mimeType 
		});

		// 1. 保存音频文件到笔记
		const audioLink = await this.saveAudioFile(audioBlob);
		if (audioLink) {
			this.insertTextToEditor(`### 语音笔记\n${audioLink}\n\n`);
		}

		// 2. 如果启用了转录，则进行转录
		if (this.settings.enableTranscription && this.settings.openaiApiKey) {
			new Notice('🔄 正在转录...');
			try {
				const transcription = await this.transcribeAudio(audioBlob);
				if (transcription) {
					this.insertTextToEditor(`**转录内容:**\n${transcription}\n\n`);
					new Notice('✅ 转录完成');
				}
			} catch (error) {
				console.error('转录失败:', error);
				new Notice(`❌ 转录失败: ${error.message}`);
			}
		}

		// 清理状态
		this.recordingState.audioChunks = [];
	}

	async saveAudioFile(audioBlob: Blob): Promise<string | null> {
		try {
			// 确定文件扩展名
			let extension = '.webm';
			if (audioBlob.type.includes('webm')) extension = '.webm';
			else if (audioBlob.type.includes('mp3') || audioBlob.type.includes('mpeg')) extension = '.mp3';
			else if (audioBlob.type.includes('wav')) extension = '.wav';
			else if (audioBlob.type.includes('ogg')) extension = '.ogg';

			// 生成文件名
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const filename = `voice-note-${timestamp}${extension}`;

			// 获取当前文件的目录
			let folderPath = '';
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				folderPath = activeFile.parent?.path || '';
			}

			// 构建完整路径
			const audioFilePath = folderPath ? `${folderPath}/${filename}` : filename;

			// 保存文件
			const arrayBuffer = await audioBlob.arrayBuffer();
			await this.app.vault.createBinary(audioFilePath, arrayBuffer);

			// 返回 markdown 链接
			return `![${filename}](${audioFilePath})`;

		} catch (error) {
			console.error('保存音频文件失败:', error);
			new Notice(`❌ 保存音频文件失败: ${error.message}`);
			return null;
		}
	}

	async transcribeAudio(audioBlob: Blob): Promise<string> {
		if (!this.settings.openaiApiKey) {
			throw new Error('OpenAI API Key 未配置');
		}

		// 创建多部分表单数据边界
		const boundary = '----formdata-obsidian-' + Math.random().toString(36);
		
		// 确定文件名
		let filename = 'audio.webm';
		if (audioBlob.type.includes('webm')) filename = 'audio.webm';
		else if (audioBlob.type.includes('mp3') || audioBlob.type.includes('mpeg')) filename = 'audio.mp3';
		else if (audioBlob.type.includes('wav')) filename = 'audio.wav';
		else if (audioBlob.type.includes('ogg')) filename = 'audio.ogg';

		// 手动构建多部分表单数据
		const audioArrayBuffer = await audioBlob.arrayBuffer();
		const audioBytes = new Uint8Array(audioArrayBuffer);
		
		const textEncoder = new TextEncoder();
		const formParts: Uint8Array[] = [];
		
		// 添加文件字段
		formParts.push(textEncoder.encode(`--${boundary}\r\n`));
		formParts.push(textEncoder.encode(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`));
		formParts.push(textEncoder.encode(`Content-Type: ${audioBlob.type}\r\n\r\n`));
		formParts.push(audioBytes);
		formParts.push(textEncoder.encode('\r\n'));
		
		// 添加模型字段
		formParts.push(textEncoder.encode(`--${boundary}\r\n`));
		formParts.push(textEncoder.encode(`Content-Disposition: form-data; name="model"\r\n\r\n`));
		formParts.push(textEncoder.encode('whisper-1\r\n'));
		
		// 添加语言字段
		formParts.push(textEncoder.encode(`--${boundary}\r\n`));
		formParts.push(textEncoder.encode(`Content-Disposition: form-data; name="language"\r\n\r\n`));
		formParts.push(textEncoder.encode('zh\r\n'));
		
		// 结束边界
		formParts.push(textEncoder.encode(`--${boundary}--\r\n`));
		
		// 计算总长度并合并所有部分
		const totalLength = formParts.reduce((sum, part) => sum + part.length, 0);
		const formDataBuffer = new Uint8Array(totalLength);
		let offset = 0;
		for (const part of formParts) {
			formDataBuffer.set(part, offset);
			offset += part.length;
		}

		// 使用 Obsidian 的 requestUrl 方法发送请求
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
				throw new Error('转录结果格式无效');
			}

		} catch (error) {
			console.error('OpenAI API 错误:', error);
			
			// 处理不同类型的错误
			let errorMessage = '转录失败';
			if (error.status === 401) {
				errorMessage = 'API Key 无效或未授权';
			} else if (error.status === 429) {
				errorMessage = 'API 请求频率超限，请稍后重试';
			} else if (error.status === 403) {
				errorMessage = 'API 访问被拒绝，请检查 API Key 权限';
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
			new Notice('❌ 没有活跃的笔记页面');
			return;
		}

		const view = activeLeaf.view;
		if (view.getViewType() !== 'markdown') {
			new Notice('❌ 当前页面不是 Markdown 笔记');
			return;
		}

		const editor = (view as any).editor;
		if (!editor) {
			new Notice('❌ 无法找到编辑器');
			return;
		}

		try {
			const cursor = editor.getCursor();
			const textToInsert = text.trim() + '\n';
			editor.replaceRange(textToInsert, cursor);
			editor.setCursor(cursor.line + textToInsert.split('\n').length - 1, 0);
		} catch (error) {
			console.error('插入文本失败:', error);
			new Notice(`❌ 插入文本失败: ${error.message}`);
		}
	}

	updateStatusBar() {
		if (!this.statusBarItem) return;

		if (this.recordingState.isRecording) {
			const duration = Math.floor((Date.now() - this.recordingState.startTime) / 1000);
			this.statusBarItem.setText(`🔴 录音中 ${duration}s`);
			
			// 每秒更新一次
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
