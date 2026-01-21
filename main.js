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
                this.webaudio.config.bitDepth = parseInt(e.target.value, 10);
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
            if (convertMp3Btn) convertMp3Btn.addEventListener('click', () => this._convertToMp3());
            if (convertWavBtn) convertWavBtn.addEventListener('click', () => this._convertToWav());
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
            if (bitDepthSelect) bitDepthSelect.value = String(this.webaudio.config.bitDepth);
            if (channelsSelect) channelsSelect.value = String(this.webaudio.config.channels);
            if (endiannessSelect) endiannessSelect.value = String(this.webaudio.config.endianness || 'little');
        }

        _saveSettings() {
            const settings = {
                sampleRate: this.webaudio.config.sampleRate,
                bitDepth: this.webaudio.config.bitDepth,
                channels: this.webaudio.config.channels,
                endianness: this.webaudio.config.endianness
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
            this.fileNameDisplay.classList.remove('no-file');
            this.data.fileName = file.name;
            const ext = file.name.toLowerCase().split('.').pop();
            if (ext === 'mp3' || ext === 'wav') {
                if (this.data.fileUrl) URL.revokeObjectURL(this.data.fileUrl);
                const url = URL.createObjectURL(file);
                this.data.fileUrl = url;
                this.data.fileType = ext;
                await this.wavesurfer.loadUrl(url);
                this._updateFileInfo(ext.toUpperCase(), file.size, this.wavesurfer.getDuration());
                this._drawFromAudioElement(url);
                if (this.htmlAudio) this.htmlAudio.src = url;
                document.getElementById('convertButton').disabled = true;
                document.getElementById('convertWavButton').disabled = true;
            } else {
                const arrayBuffer = await file.arrayBuffer();
                // 样例文件特判（覆盖当前设置）
                if (/qlx_13sec/i.test(file.name)) {
                    this.webaudio.config.sampleRate = 24000;
                    this.webaudio.config.bitDepth = 32;
                    this._syncSelectorsFromConfig();
                }
                // 其他文件直接使用当前 UI 上的设置（已从 localStorage 恢复或用户手动修改）
                this.webaudio.loadPCM(arrayBuffer);
                this.data.rawPcm = arrayBuffer;
                this.data.fileType = 'pcm';
                const header = Utils.createWavHeader(
                    this.data.rawPcm.byteLength,
                    this.webaudio.config.channels,
                    this.webaudio.config.sampleRate,
                    this.webaudio.config.bitDepth
                );
                const wavBlob = new Blob([header, arrayBuffer], { type: 'audio/wav' });
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
                this.webaudio.config.sampleRate = 24000;
                this.webaudio.config.endianness = Utils.detectSystemEndianness();
                this.webaudio.config.bitDepth = 32; // qlx_13sec 默认 32bit
                this._syncSelectorsFromConfig();
                this.webaudio.loadPCM(buf);
                this.data.rawPcm = buf;
                this.data.fileType = 'pcm';
                const header = Utils.createWavHeader(
                    this.data.rawPcm.byteLength,
                    this.webaudio.config.channels,
                    this.webaudio.config.sampleRate,
                    this.webaudio.config.bitDepth
                );
                const wavBlob = new Blob([header, buf], { type: 'audio/wav' });
                if (this.data.wavUrl) URL.revokeObjectURL(this.data.wavUrl);
                const url = URL.createObjectURL(wavBlob);
                this.data.wavUrl = url;
                await this.wavesurfer.loadUrl(url);
                this.fileNameDisplay.textContent = 'qlx_13sec.pcm';
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
                    暂停
                `;
            } else {
                btn.innerHTML = `
                    <svg class="icon" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                    </svg>
                    播放
                `;
            }
        }

        _updateFileInfo(type, size, duration) {
            let html = `
                <span class="file-tag type">${type}</span>
                <span class="file-tag size">${(size / 1024).toFixed(2)} KB</span>
                <span class="file-tag duration">${Utils.formatTime(duration)}</span>
            `;
            if (type === 'PCM') {
                html += `
                    <span class="file-tag sample-rate">${this.webaudio.config.sampleRate}Hz</span>
                    <span class="file-tag channels">${this.webaudio.config.channels}ch</span>
                    <span class="file-tag bit-depth">${this.webaudio.config.bitDepth}bit</span>
                `;
            }
            this.fileInfo.innerHTML = html;
            this.durationEl.textContent = Utils.formatTime(duration);
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
                this.webaudio.config.bitDepth
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
            if (!this.webaudio || !this.webaudio.data.audioBuffer) { alert('请先加载 PCM 文件'); return; }
            const button = document.getElementById('convertButton');
            const original = button.innerHTML;
            const setLoading = () => { button.classList.add('loading'); button.disabled = true; button.innerHTML = '<div class="loading-spinner"></div>转换中...'; };
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
                alert('MP3 转换失败: ' + e.message);
            } finally {
                setNormal();
            }
        }

        async _convertToWav() {
            if (!this.data.rawPcm) { alert('请先加载 PCM 文件'); return; }
            const button = document.getElementById('convertWavButton');
            const original = button.innerHTML;
            const setLoading = () => { button.classList.add('loading'); button.disabled = true; button.innerHTML = '<div class="loading-spinner"></div>转换中...'; };
            const setNormal = () => { button.classList.remove('loading'); button.disabled = false; button.innerHTML = original; };
            setLoading();
            try {
                const header = Utils.createWavHeader(
                    this.webaudio.data.audioBuffer.length * this.webaudio.config.channels * (this.webaudio.config.bitDepth / 8),
                    this.webaudio.config.channels,
                    this.webaudio.config.sampleRate,
                    this.webaudio.config.bitDepth
                );
                const blob = new Blob([header, this.data.rawPcm], { type: 'audio/wav' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = (this.data.fileName || 'audio').replace(/\.[^/.]+$/, '') + '.wav';
                a.style.display = 'none'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 2000);
            } catch (e) {
                alert('WAV 转换失败: ' + e.message);
            } finally {
                setNormal();
            }
        }
    }

    window.addEventListener('load', () => {
        window.app = new AppController();
    });
})();


