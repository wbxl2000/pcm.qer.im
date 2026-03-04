(function () {
    class AppController {
        constructor() {
            this.mode = 'wavesurfer'; // 默认新版
            this.webaudio = null;
            this.wavesurfer = null;
            this.htmlAudio = document.getElementById('htmlAudio');
            this.canvas = document.getElementById('waveformCanvas');
            this.ctx = this.canvas.getContext('2d');
            this.currentTimeEl = document.getElementById('currentTime');
            this.durationEl = document.getElementById('duration');
            this.fileInfo = document.getElementById('fileInfo');
            this.fileNameDisplay = document.getElementById('fileNameDisplay');
            this.wavePoints = [];
            this.data = { rawPcm: null, wavUrl: null, fileUrl: null, fileType: null, fileName: '' };
            
            // 文件列表
            this.fileList = [];
            this.currentFileIndex = -1;

            this._bindUI();
            // 先确保可见性，避免在 display:none 时创建 wavesurfer 导致宽度为 0
            this._applyVisibility();
            this._initPlayers();
            this._bindControls();
            this._bindModeButtons();
            this._bindHtmlAudioEvents();
        }

        _bindUI() {
            this.canvas.width = this.canvas.offsetWidth;
            this.canvas.height = this.canvas.offsetHeight;
            document.getElementById('playButton').addEventListener('click', () => this.togglePlay());
            document.getElementById('stopButton').addEventListener('click', () => this.stop());
            document.getElementById('fileInput').addEventListener('change', (e) => this._onFiles(e));
            document.getElementById('loadSampleButton').addEventListener('click', () => this._loadSample());
            this.canvas.addEventListener('click', (e) => this._onSeekClick(e));
            
            // 文件列表事件
            document.getElementById('clearFileList').addEventListener('click', () => this._clearFileList());
            document.getElementById('fileList').addEventListener('click', (e) => {
                const item = e.target.closest('.file-list-item');
                if (item) this._switchFile(parseInt(item.dataset.index, 10));
            });
        }

        _initPlayers() {
            this.webaudio = new WebAudioPlayer({
                onTimeUpdate: (t) => this._onTime(t),
                onStateChange: (evt) => this._onState(evt),
            });
            this.wavesurfer = new WaveSurferPlayer({
                container: document.getElementById('wsWaveform'),
                onTimeUpdate: (t) => this._onTime(t),
                onStateChange: (evt) => this._onState(evt),
            });

            // 从 localStorage 恢复设置
            this._loadSettings();

            // 绑定参数选择器
            const sampleRateSelect = document.getElementById('sampleRateSelect');
            const bitDepthSelect = document.getElementById('bitDepthSelect');
            const channelsSelect = document.getElementById('channelsSelect');
            const endiannessSelect = document.getElementById('endiannessSelect');
            if (sampleRateSelect) sampleRateSelect.addEventListener('change', (e) => {
                this.webaudio.config.sampleRate = parseInt(e.target.value, 10);
                this._saveSettings();
                if (this.data.rawPcm) this._refreshFromConfig();
            });
            if (bitDepthSelect) bitDepthSelect.addEventListener('change', (e) => {
                const val = e.target.value;
                if (val === '32f') {
                    this.webaudio.config.bitDepth = 32;
                    this.webaudio.config.sampleFormat = 'float';
                } else {
                    this.webaudio.config.bitDepth = parseInt(val, 10);
                    this.webaudio.config.sampleFormat = 'int';
                }
                this._saveSettings();
                if (this.data.rawPcm) this._refreshFromConfig();
            });
            if (channelsSelect) channelsSelect.addEventListener('change', (e) => {
                this.webaudio.config.channels = parseInt(e.target.value, 10);
                this._saveSettings();
                if (this.data.rawPcm) this._refreshFromConfig();
            });
            if (endiannessSelect) endiannessSelect.addEventListener('change', (e) => {
                this.webaudio.config.endianness = e.target.value;
                this._saveSettings();
                if (this.data.rawPcm) this._refreshFromConfig();
            });

            // 转换按钮
            const convertMp3Btn = document.getElementById('convertButton');
            const convertWavBtn = document.getElementById('convertWavButton');
            const convertPcmBtn = document.getElementById('convertPcmButton');
            if (convertMp3Btn) convertMp3Btn.addEventListener('click', () => this._convertToMp3());
            if (convertWavBtn) convertWavBtn.addEventListener('click', () => this._convertToWav());
            if (convertPcmBtn) convertPcmBtn.addEventListener('click', () => this._convertToPcm());
        }

        _bindControls() { this._applyVisibility(); }

        _bindModeButtons() {
            const container = document.getElementById('modeSwitch');
            const syncActive = () => {
                if (!container) return;
                const buttons = container.querySelectorAll('.mode-btn');
                buttons.forEach(button => {
                    const modeValue = button.getAttribute('data-mode');
                    if (modeValue === this.mode) button.classList.add('active');
                    else button.classList.remove('active');
                });
            };
            const switchTo = (next) => {
                if (!next || next === this.mode) return;
                const currentTime = this._getCurrentTime();
                this.stop();
                this.mode = next;
                this._applyVisibility();
                this._setCurrentTime(currentTime);
                syncActive();
            };
            if (container) {
                container.addEventListener('click', (e) => {
                    const btn = e.target.closest('.mode-btn');
                    if (!btn) return;
                    switchTo(btn.getAttribute('data-mode'));
                });
                syncActive();
            }
        }

        _applyVisibility() {
            const wsContainer = document.getElementById('wsWaveform');
            if (wsContainer) wsContainer.style.display = this.mode === 'wavesurfer' ? 'block' : 'none';
            this.canvas.style.display = this.mode === 'wavesurfer' ? 'none' : 'block';
        }

        _bindHtmlAudioEvents() {
            if (!this.htmlAudio) return;
            const onTime = () => { if (this.mode === 'element') this._onTime(this.htmlAudio.currentTime || 0); };
            const onPlay = () => { if (this.mode === 'element') this._resetPlayButton('pause'); };
            const onPause = () => { if (this.mode === 'element') this._resetPlayButton('play'); };
            const onEnded = () => { if (this.mode === 'element') this.stop(); };
            this.htmlAudio.addEventListener('timeupdate', onTime);
            this.htmlAudio.addEventListener('play', onPlay);
            this.htmlAudio.addEventListener('pause', onPause);
            this.htmlAudio.addEventListener('ended', onEnded);
        }

        _syncSelectorsFromConfig() {
            const sampleRateSelect = document.getElementById('sampleRateSelect');
            const bitDepthSelect = document.getElementById('bitDepthSelect');
            const channelsSelect = document.getElementById('channelsSelect');
            const endiannessSelect = document.getElementById('endiannessSelect');
            if (sampleRateSelect) sampleRateSelect.value = String(this.webaudio.config.sampleRate);
            if (bitDepthSelect) {
                const bitVal = (this.webaudio.config.bitDepth === 32 && this.webaudio.config.sampleFormat === 'float') ? '32f' : String(this.webaudio.config.bitDepth);
                bitDepthSelect.value = bitVal;
            }
            if (channelsSelect) channelsSelect.value = String(this.webaudio.config.channels);
            if (endiannessSelect) endiannessSelect.value = String(this.webaudio.config.endianness || 'little');
        }

        _saveSettings() {
            const settings = {
                sampleRate: this.webaudio.config.sampleRate,
                bitDepth: this.webaudio.config.bitDepth,
                channels: this.webaudio.config.channels,
                endianness: this.webaudio.config.endianness,
                sampleFormat: this.webaudio.config.sampleFormat
            };
            try {
                localStorage.setItem('pcm_player_settings', JSON.stringify(settings));
            } catch (e) { /* ignore */ }
        }

        _loadSettings() {
            try {
                const saved = localStorage.getItem('pcm_player_settings');
                if (saved) {
                    const settings = JSON.parse(saved);
                    if (settings.sampleRate) this.webaudio.config.sampleRate = settings.sampleRate;
                    if (settings.bitDepth) this.webaudio.config.bitDepth = settings.bitDepth;
                    if (settings.channels) this.webaudio.config.channels = settings.channels;
                    if (settings.endianness) this.webaudio.config.endianness = settings.endianness;
                    if (settings.sampleFormat) this.webaudio.config.sampleFormat = settings.sampleFormat;
                }
            } catch (e) { /* ignore */ }
            // 始终同步 UI 和 config，确保一致性
            this._syncSelectorsFromConfig();
        }

        _getSavedSetting(key) {
            try {
                const saved = localStorage.getItem('pcm_player_settings');
                if (saved) return JSON.parse(saved)[key];
            } catch (e) { /* ignore */ }
            return null;
        }

        async _onFiles(event) {
            const files = Array.from(event.target.files);
            if (!files.length) return;
            // 过滤有效文件
            const validFiles = files.filter(f => /\.(pcm|mp3|wav)$/i.test(f.name));
            if (!validFiles.length) return;
            // 添加到文件列表
            for (const file of validFiles) {
                const ext = file.name.toLowerCase().split('.').pop();
                this.fileList.push({ file, name: file.name, type: ext });
            }
            this._renderFileList();
            // 自动加载第一个新添加的文件
            await this._switchFile(this.fileList.length - validFiles.length);
        }

        async _loadFile(file) {
            this.stop();
            this.fileNameDisplay.textContent = file.name;
            this.fileNameDisplay.removeAttribute('data-i18n');
            this.fileNameDisplay.classList.remove('no-file');
            this.data.fileName = file.name;
            const ext = file.name.toLowerCase().split('.').pop();
            if (ext === 'mp3' || ext === 'wav') {
                if (this.data.fileUrl) URL.revokeObjectURL(this.data.fileUrl);
                const url = URL.createObjectURL(file);
                this.data.fileUrl = url;
                this.data.fileType = ext;
                this.data.originalFile = file; // 保存原始文件用于转换
                // 解析文件头获取原始参数（不受 Web Audio API 重采样影响）
                this.data.originalParams = await Utils.parseAudioHeader(file);
                await this.wavesurfer.loadUrl(url);
                // 优先使用原始参数，fallback 到解码后参数
                const audioParams = this.data.originalParams || this.wavesurfer.getAudioParams();
                this._updateFileInfo(ext.toUpperCase(), file.size, this.wavesurfer.getDuration(), audioParams);
                this._syncSelectorsForNonPcm(audioParams);
                this._drawFromAudioElement(url);
                if (this.htmlAudio) this.htmlAudio.src = url;
                document.getElementById('convertButton').disabled = true;
                document.getElementById('convertWavButton').disabled = true;
                document.getElementById('convertPcmButton').disabled = false; // MP3/WAV 可以转 PCM
            } else {
                const arrayBuffer = await file.arrayBuffer();
                // PCM 文件：启用参数选择器
                this._enableSelectors();

                // DHAV 容器检测和剥离
                let pcmBuffer = arrayBuffer;
                const dhavResult = Utils.stripDHAV(arrayBuffer);
                let configChanged = false;

                if (dhavResult) {
                    pcmBuffer = dhavResult.pcmData;
                    this.webaudio.config.sampleRate = dhavResult.sampleRate;
                    this.webaudio.config.bitDepth = 16;
                    this.webaudio.config.channels = dhavResult.channels;
                    this.webaudio.config.endianness = 'little';
                    configChanged = true;
                } else {
                    // 尝试从文件名解析参数（支持多种格式）
                    const parsed = Utils.parseParamsFromFileName(file.name);
                    if (parsed.sampleRate) { this.webaudio.config.sampleRate = parsed.sampleRate; configChanged = true; }
                    if (parsed.bitDepth) { this.webaudio.config.bitDepth = parsed.bitDepth; configChanged = true; }
                    if (parsed.channels) { this.webaudio.config.channels = parsed.channels; configChanged = true; }
                    if (parsed.endianness) { this.webaudio.config.endianness = parsed.endianness; configChanged = true; }
                }

                // 样例文件特判（覆盖）
                if (/qlx_13sec/i.test(file.name)) {
                    this.webaudio.config.sampleRate = 24000;
                    this.webaudio.config.bitDepth = 16;
                    this.webaudio.config.channels = 2;
                    configChanged = true;
                }

                // config 有变化时同步到 UI
                if (configChanged) this._syncSelectorsFromConfig();

                // 自动检测位深度和 int/float 格式
                const detected = Utils.detectBitDepth(pcmBuffer, this.webaudio.config.endianness);
                if (detected) {
                    const isSame = detected.bitDepth === this.webaudio.config.bitDepth
                        && detected.sampleFormat === this.webaudio.config.sampleFormat;
                    if (!isSame) {
                        const label = detected.bitDepth === 32
                            ? `${detected.bitDepth}bit-${detected.sampleFormat}`
                            : `${detected.bitDepth}bit`;
                        if (!configChanged) {
                            // 没有来自文件名/DHAV 的参数，静默应用
                            this.webaudio.config.bitDepth = detected.bitDepth;
                            this.webaudio.config.sampleFormat = detected.sampleFormat;
                            this._syncSelectorsFromConfig();
                        } else if (confirm(window.t('detectFormatConfirm').replace('{0}', label))) {
                            this.webaudio.config.bitDepth = detected.bitDepth;
                            this.webaudio.config.sampleFormat = detected.sampleFormat;
                            this._syncSelectorsFromConfig();
                        }
                    }
                }
                this.webaudio.loadPCM(pcmBuffer);
                this.data.rawPcm = pcmBuffer;
                this.data.fileType = 'pcm';
                const header = Utils.createWavHeader(
                    this.data.rawPcm.byteLength,
                    this.webaudio.config.channels,
                    this.webaudio.config.sampleRate,
                    this.webaudio.config.bitDepth,
                    this.webaudio.config.sampleFormat
                );
                const wavBlob = new Blob([header, pcmBuffer], { type: 'audio/wav' });
                if (this.data.wavUrl) URL.revokeObjectURL(this.data.wavUrl);
                const url = URL.createObjectURL(wavBlob);
                this.data.wavUrl = url;
                await this.wavesurfer.loadUrl(url);
                this._updateFileInfo('PCM', arrayBuffer.byteLength, this.webaudio.data.audioBuffer.duration, {
                    sampleRate: this.webaudio.config.sampleRate,
                    channels: this.webaudio.config.channels,
                    bitDepth: this.webaudio.config.bitDepth
                });
                this._drawFromBuffer(this.webaudio.data.audioBuffer.getChannelData(0));
                if (this.htmlAudio) this.htmlAudio.src = url;
                document.getElementById('convertButton').disabled = false;
                document.getElementById('convertWavButton').disabled = false;
                document.getElementById('convertPcmButton').disabled = true; // PCM 不需要转 PCM
            }
            document.getElementById('playButton').disabled = false;
            document.getElementById('stopButton').disabled = false;
        }

        _renderFileList() {
            const container = document.getElementById('fileListContainer');
            const list = document.getElementById('fileList');
            if (this.fileList.length === 0) {
                container.classList.remove('show');
                return;
            }
            container.classList.add('show');
            list.innerHTML = this.fileList.map((item, idx) => `
                <div class="file-list-item ${idx === this.currentFileIndex ? 'active' : ''}" data-index="${idx}">
                    <svg class="file-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v6h7v10H6z"/></svg>
                    <span class="file-name">${item.name}</span>
                    <span class="file-type ${item.type}">${item.type.toUpperCase()}</span>
                </div>
            `).join('');
        }

        async _switchFile(index) {
            if (index < 0 || index >= this.fileList.length) return;
            this.currentFileIndex = index;
            this._renderFileList();
            await this._loadFile(this.fileList[index].file);
        }

        _clearFileList() {
            this.fileList = [];
            this.currentFileIndex = -1;
            this._renderFileList();
        }

        async _loadSample() {
            const button = document.getElementById('loadSampleButton');
            const original = button.innerHTML;
            const setLoading = () => { button.classList.add('loading'); button.innerHTML = original + '<div class="loading-spinner"></div>'; };
            const setNormal = () => { button.classList.remove('loading'); button.innerHTML = original; };
            setLoading();
            try {
                const resp = await fetch('./qlx_13sec.pcm');
                const buf = await resp.arrayBuffer();
                this._enableSelectors(); // PCM 文件启用选择器
                this.webaudio.config.sampleRate = 24000;
                this.webaudio.config.endianness = Utils.detectSystemEndianness();
                this.webaudio.config.bitDepth = 16;
                this.webaudio.config.channels = 2;
                this._syncSelectorsFromConfig();
                this.webaudio.loadPCM(buf);
                this.data.rawPcm = buf;
                this.data.fileType = 'pcm';
                const header = Utils.createWavHeader(
                    this.data.rawPcm.byteLength,
                    this.webaudio.config.channels,
                    this.webaudio.config.sampleRate,
                    this.webaudio.config.bitDepth,
                    this.webaudio.config.sampleFormat
                );
                const wavBlob = new Blob([header, buf], { type: 'audio/wav' });
                if (this.data.wavUrl) URL.revokeObjectURL(this.data.wavUrl);
                const url = URL.createObjectURL(wavBlob);
                this.data.wavUrl = url;
                await this.wavesurfer.loadUrl(url);
                this.fileNameDisplay.textContent = 'qlx_13sec.pcm';
                this.fileNameDisplay.removeAttribute('data-i18n');
                this.fileNameDisplay.classList.remove('no-file');
                this._updateFileInfo('PCM', buf.byteLength, this.webaudio.data.audioBuffer.duration);
                this._drawFromBuffer(this.webaudio.data.audioBuffer.getChannelData(0));
                document.getElementById('convertButton').disabled = false;
                document.getElementById('convertWavButton').disabled = false;
                if (this.htmlAudio) this.htmlAudio.src = url;
                const playBtn = document.getElementById('playButton');
                const stopBtn = document.getElementById('stopButton');
                if (playBtn) playBtn.disabled = false;
                if (stopBtn) stopBtn.disabled = false;
            } finally {
                setNormal();
            }
        }

        togglePlay() {
            if (this.mode === 'wavesurfer') {
                if (this.wavesurfer.state && this.wavesurfer.state.isPlaying) {
                    this.wavesurfer.pause();
                } else {
                    this.wavesurfer.play();
                }
            } else if (this.mode === 'webaudio') {
                if (!this.webaudio.state.isPlaying) this.webaudio.play();
                else this.webaudio.pause();
            } else if (this.mode === 'element') {
                if (this.htmlAudio) this.htmlAudio.paused ? this.htmlAudio.play() : this.htmlAudio.pause();
            }
        }

        stop() {
            if (this.mode === 'wavesurfer') this.wavesurfer.stop();
            if (this.mode === 'webaudio') this.webaudio.stop();
            if (this.mode === 'element' && this.htmlAudio) { this.htmlAudio.pause(); try { this.htmlAudio.currentTime = 0; } catch (_) {} }
            this._renderProgress(0);
            this._setCurrentTime(0);
            this._resetPlayButton('play');
        }

        _getCurrentTime() {
            if (this.mode === 'wavesurfer') return this.wavesurfer.state.currentTime || 0;
            if (this.mode === 'webaudio') return this.webaudio.state.currentTime || 0;
            if (this.mode === 'element' && this.htmlAudio) return this.htmlAudio.currentTime || 0;
            return 0;
        }

        _setCurrentTime(t) {
            if (this.mode === 'wavesurfer') this.wavesurfer.seek(t);
            if (this.mode === 'webaudio') this.webaudio.seek(t);
            if (this.mode === 'element' && this.htmlAudio) this.htmlAudio.currentTime = t;
            this._renderProgress(t);
            this.currentTimeEl.textContent = Utils.formatTime(t);
        }

        _onTime(t) {
            this.currentTimeEl.textContent = Utils.formatTime(t);
            this._renderProgress(t);
        }

        _onState(evt) {
            if (evt.type === 'loaded' && typeof evt.duration === 'number') {
                this.durationEl.textContent = Utils.formatTime(evt.duration);
                this._resetPlayButton('play');
                const playBtn = document.getElementById('playButton');
                const stopBtn = document.getElementById('stopButton');
                if (playBtn) playBtn.disabled = false;
                if (stopBtn) stopBtn.disabled = false;
            }
            if (evt.type === 'play') this._resetPlayButton('pause');
            if (evt.type === 'pause' || evt.type === 'stop') this._resetPlayButton('play');
        }

        _resetPlayButton(state) {
            const btn = document.getElementById('playButton');
            if (state === 'pause') {
                btn.innerHTML = `
                    <svg class="icon" viewBox="0 0 24 24">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                    <span data-i18n="pause">${window.t('pause')}</span>
                `;
            } else {
                btn.innerHTML = `
                    <svg class="icon" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                    </svg>
                    <span data-i18n="play">${window.t('play')}</span>
                `;
            }
        }

        _updateFileInfo(type, size, duration, audioParams) {
            let html = `
                <span class="file-tag type">${type}</span>
                <span class="file-tag size">${(size / 1024).toFixed(2)} KB</span>
                <span class="file-tag duration">${Utils.formatTime(duration)}</span>
            `;
            if (type === 'PCM') {
                const bitLabel = this.webaudio.config.bitDepth === 32
                    ? `${this.webaudio.config.bitDepth}bit-${this.webaudio.config.sampleFormat === 'float' ? 'float' : 'int'}`
                    : `${this.webaudio.config.bitDepth}bit`;
                html += `
                    <span class="file-tag sample-rate">${this.webaudio.config.sampleRate}Hz</span>
                    <span class="file-tag channels">${this.webaudio.config.channels}ch</span>
                    <span class="file-tag bit-depth">${bitLabel}</span>
                `;
            } else if (audioParams) {
                // MP3/WAV 显示从文件解码获取的参数
                html += `
                    <span class="file-tag sample-rate">${audioParams.sampleRate}Hz</span>
                    <span class="file-tag channels">${audioParams.channels}ch</span>
                `;
            }
            this.fileInfo.innerHTML = html;
            this.durationEl.textContent = Utils.formatTime(duration);
        }

        // MP3/WAV 加载后更新选择器显示并禁用（仅供参考，不可编辑）
        _syncSelectorsForNonPcm(audioParams) {
            const sampleRateSelect = document.getElementById('sampleRateSelect');
            const bitDepthSelect = document.getElementById('bitDepthSelect');
            const channelsSelect = document.getElementById('channelsSelect');
            const endiannessSelect = document.getElementById('endiannessSelect');
            
            if (audioParams) {
                // 更新显示值（尽可能匹配，否则保持原值）
                if (sampleRateSelect) {
                    const srOption = Array.from(sampleRateSelect.options).find(o => parseInt(o.value) === audioParams.sampleRate);
                    if (srOption) sampleRateSelect.value = srOption.value;
                }
                if (channelsSelect) {
                    channelsSelect.value = String(audioParams.channels);
                }
            }
            // 禁用所有选择器（MP3/WAV 参数由文件决定）
            if (sampleRateSelect) sampleRateSelect.disabled = true;
            if (bitDepthSelect) bitDepthSelect.disabled = true;
            if (channelsSelect) channelsSelect.disabled = true;
            if (endiannessSelect) endiannessSelect.disabled = true;
        }

        // PCM 加载后启用选择器
        _enableSelectors() {
            const sampleRateSelect = document.getElementById('sampleRateSelect');
            const bitDepthSelect = document.getElementById('bitDepthSelect');
            const channelsSelect = document.getElementById('channelsSelect');
            const endiannessSelect = document.getElementById('endiannessSelect');
            if (sampleRateSelect) sampleRateSelect.disabled = false;
            if (bitDepthSelect) bitDepthSelect.disabled = false;
            if (channelsSelect) channelsSelect.disabled = false;
            if (endiannessSelect) endiannessSelect.disabled = false;
        }

        _onSeekClick(e) {
            if (!this.wavePoints.length) return;
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const x = (e.clientX - rect.left) * scaleX;
            const pt = this.wavePoints.reduce((c, p) => Math.abs(p.x - x) < Math.abs(c.x - x) ? p : c);
            this._setCurrentTime(pt.time);
        }

        _drawFromAudioElement(url) {
            // 仅用于画布展示：不解码，绘空网格
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            Utils.drawGrid(this.ctx, this.canvas.width, this.canvas.height);
            this.wavePoints = [];
        }

        _drawFromBuffer(pcmData) {
            const width = this.canvas.width;
            const height = this.canvas.height;
            const centerY = height / 2;
            const step = Math.ceil(pcmData.length / width);
            this.ctx.clearRect(0, 0, width, height);
            Utils.drawGrid(this.ctx, width, height);
            this.wavePoints = [];
            // 峰值包络
            for (let i = 0; i < width; i++) {
                const start = i * step;
                let maxAbs = 0;
                for (let j = 0; j < step && start + j < pcmData.length; j++) {
                    const v = Math.abs(pcmData[start + j]);
                    if (v > maxAbs) maxAbs = v;
                }
                const amp = maxAbs * centerY * 0.95;
                this.wavePoints.push({ x: i, time: (start / pcmData.length) * (this.webaudio.data.audioBuffer ? this.webaudio.data.audioBuffer.duration : 0) });
                this.ctx.beginPath();
                this.ctx.strokeStyle = '#2196F3';
                this.ctx.lineWidth = 2;
                this.ctx.moveTo(i, Math.max(centerY - amp, 0));
                this.ctx.lineTo(i, Math.min(centerY + amp, height));
                this.ctx.stroke();
            }
        }

        _renderProgress(currentTime) {
            const width = this.canvas.width;
            const height = this.canvas.height;
            const duration = this._getDuration();
            if (!duration) return;
            const x = width * (currentTime / duration);
            // 重绘网格与波形
            this.ctx.clearRect(0, 0, width, height);
            Utils.drawGrid(this.ctx, width, height);
            // 重绘波形（简单：仅保留垂直线渲染，避免存两份）
            if (this.webaudio.data.audioBuffer && this.mode !== 'wavesurfer') this._drawFromBuffer(this.webaudio.data.audioBuffer.getChannelData(0));
            // 进度线
            this.ctx.beginPath();
            this.ctx.strokeStyle = '#1976D2';
            this.ctx.lineWidth = 2;
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, height);
            this.ctx.stroke();
        }

        _getDuration() {
            if (this.mode === 'wavesurfer') return this.wavesurfer.getDuration();
            if (this.mode === 'webaudio') return this.webaudio.data.audioBuffer ? this.webaudio.data.audioBuffer.duration : 0;
            if (this.mode === 'element' && this.htmlAudio && !isNaN(this.htmlAudio.duration)) return this.htmlAudio.duration;
            return 0;
        }

        _refreshFromConfig() {
            if (!this.data.rawPcm) return;
            this.webaudio.loadPCM(this.data.rawPcm);
            const header = Utils.createWavHeader(
                this.data.rawPcm.byteLength,
                this.webaudio.config.channels,
                this.webaudio.config.sampleRate,
                this.webaudio.config.bitDepth,
                this.webaudio.config.sampleFormat
            );
            const wavBlob = new Blob([header, this.data.rawPcm], { type: 'audio/wav' });
            if (this.data.wavUrl) URL.revokeObjectURL(this.data.wavUrl);
            const url = URL.createObjectURL(wavBlob);
            this.data.wavUrl = url;
            this.wavesurfer.loadUrl(url);
            if (this.htmlAudio) this.htmlAudio.src = url;
            this._updateFileInfo('PCM', this.data.rawPcm.byteLength, this.webaudio.data.audioBuffer.duration);
            this._drawFromBuffer(this.webaudio.data.audioBuffer.getChannelData(0));
            this._setCurrentTime(0);
        }

        async _convertToMp3() {
            if (!this.webaudio || !this.webaudio.data.audioBuffer) { alert(window.t('alertLoadPcm')); return; }
            const button = document.getElementById('convertButton');
            const original = button.innerHTML;
            const setLoading = () => { button.classList.add('loading'); button.disabled = true; button.innerHTML = '<div class="loading-spinner"></div>' + window.t('converting'); };
            const setNormal = () => { button.classList.remove('loading'); button.disabled = false; button.innerHTML = original; };
            setLoading();
            try {
                // 动态加载 lamejs
                await new Promise((resolve, reject) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
                    s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
                });

                const audioBuffer = this.webaudio.data.audioBuffer;
                const sampleRate = audioBuffer.sampleRate;
                const numChannels = Math.min(2, audioBuffer.numberOfChannels || this.webaudio.config.channels || 1);
                const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, 128);

                const leftF32 = audioBuffer.getChannelData(0);
                const rightF32 = numChannels > 1 ? audioBuffer.getChannelData(1) : null;

                const floatTo16 = (f32) => {
                    const out = new Int16Array(f32.length);
                    for (let i = 0; i < f32.length; i++) {
                        let s = Math.max(-1, Math.min(1, f32[i]));
                        out[i] = s < 0 ? (s * 32768) : (s * 32767);
                    }
                    return out;
                };

                const leftI16 = floatTo16(leftF32);
                const rightI16 = rightF32 ? floatTo16(rightF32) : null;

                const blockSize = 1152;
                const mp3Data = [];
                for (let i = 0; i < leftI16.length; i += blockSize) {
                    const leftChunk = leftI16.subarray(i, i + blockSize);
                    if (numChannels === 2 && rightI16) {
                        const rightChunk = rightI16.subarray(i, i + blockSize);
                        const buf = encoder.encodeBuffer(leftChunk, rightChunk);
                        if (buf.length > 0) mp3Data.push(buf);
                    } else {
                        const buf = encoder.encodeBuffer(leftChunk);
                        if (buf.length > 0) mp3Data.push(buf);
                    }
                }
                const end = encoder.flush();
                if (end.length > 0) mp3Data.push(end);

                const blob = new Blob(mp3Data, { type: 'audio/mp3' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = (this.data.fileName || 'audio').replace(/\.[^/.]+$/, '') + '.mp3';
                a.style.display = 'none'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 2000);
            } catch (e) {
                alert(window.t('alertMp3Fail') + e.message);
            } finally {
                setNormal();
            }
        }

        async _convertToWav() {
            if (!this.data.rawPcm) { alert(window.t('alertLoadPcm')); return; }
            const button = document.getElementById('convertWavButton');
            const original = button.innerHTML;
            const setLoading = () => { button.classList.add('loading'); button.disabled = true; button.innerHTML = '<div class="loading-spinner"></div>' + window.t('converting'); };
            const setNormal = () => { button.classList.remove('loading'); button.disabled = false; button.innerHTML = original; };
            setLoading();
            try {
                const header = Utils.createWavHeader(
                    this.webaudio.data.audioBuffer.length * this.webaudio.config.channels * (this.webaudio.config.bitDepth / 8),
                    this.webaudio.config.channels,
                    this.webaudio.config.sampleRate,
                    this.webaudio.config.bitDepth,
                    this.webaudio.config.sampleFormat
                );
                const blob = new Blob([header, this.data.rawPcm], { type: 'audio/wav' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = (this.data.fileName || 'audio').replace(/\.[^/.]+$/, '') + '.wav';
                a.style.display = 'none'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 2000);
            } catch (e) {
                alert(window.t('alertWavFail') + e.message);
            } finally {
                setNormal();
            }
        }

        async _convertToPcm() {
            if (!this.data.originalFile) { alert(window.t('alertLoadMp3Wav')); return; }
            const button = document.getElementById('convertPcmButton');
            const originalHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg><span data-i18n="convertPcm">' + window.t('convertPcm') + '</span>';
            const setLoading = () => { button.classList.add('loading'); button.disabled = true; button.innerHTML = '<div class="loading-spinner"></div>' + window.t('converting'); };
            const setNormal = () => { button.classList.remove('loading'); button.disabled = false; button.innerHTML = originalHTML; };
            setLoading();
            let audioContext = null;
            try {
                // 读取文件并解码
                const arrayBuffer = await this.data.originalFile.arrayBuffer();
                // 使用原始采样率创建 AudioContext，避免重采样
                const originalSampleRate = this.data.originalParams?.sampleRate;
                const ctxOptions = originalSampleRate ? { sampleRate: originalSampleRate } : {};
                audioContext = new (window.AudioContext || window.webkitAudioContext)(ctxOptions);
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                
                // WAV 有 bitDepth，MP3 没有则固定 16bit
                const bitDepth = this.data.originalParams?.bitDepth || 16;
                const isLE = this.webaudio.config.endianness !== 'big'; // little-endian by default
                const channels = audioBuffer.numberOfChannels;
                const sampleRate = audioBuffer.sampleRate;
                const length = audioBuffer.length;
                const bytesPerSample = bitDepth / 8;
                
                // 创建 PCM 数据
                const pcmData = new ArrayBuffer(length * channels * bytesPerSample);
                const view = new DataView(pcmData);
                
                for (let i = 0; i < length; i++) {
                    for (let ch = 0; ch < channels; ch++) {
                        const sample = audioBuffer.getChannelData(ch)[i];
                        const offset = (i * channels + ch) * bytesPerSample;
                        
                        switch (bitDepth) {
                            case 8:
                                // 8bit PCM 标准为无符号格式 (0-255)
                                view.setUint8(offset, Math.max(0, Math.min(255, Math.round((sample + 1) * 128))));
                                break;
                            case 16:
                                view.setInt16(offset, Math.max(-32768, Math.min(32767, Math.round(sample * 32768))), isLE);
                                break;
                            case 24: {
                                const val = Math.max(-8388608, Math.min(8388607, Math.round(sample * 8388608)));
                                if (isLE) {
                                    view.setUint8(offset, val & 0xFF);
                                    view.setUint8(offset + 1, (val >> 8) & 0xFF);
                                    view.setUint8(offset + 2, (val >> 16) & 0xFF);
                                } else {
                                    view.setUint8(offset, (val >> 16) & 0xFF);
                                    view.setUint8(offset + 1, (val >> 8) & 0xFF);
                                    view.setUint8(offset + 2, val & 0xFF);
                                }
                                break;
                            }
                            case 32:
                                view.setInt32(offset, Math.max(-2147483648, Math.min(2147483647, Math.round(sample * 2147483647))), isLE);
                                break;
                        }
                    }
                }
                
                const blob = new Blob([pcmData], { type: 'application/octet-stream' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                // 文件名包含参数信息
                const baseName = (this.data.fileName || 'audio').replace(/\.[^/.]+$/, '');
                a.href = url;
                a.download = `${baseName}_${sampleRate}Hz_${bitDepth}bit_${channels}ch.pcm`;
                a.style.display = 'none'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 2000);
            } catch (e) {
                alert(window.t('alertPcmFail') + e.message);
            } finally {
                if (audioContext) audioContext.close();
                setNormal();
            }
        }
    }

    window.addEventListener('load', () => {
        window.app = new AppController();
    });
})();


