// 新版：基于 WaveSurfer 的播放实现
(function () {
    class WaveSurferPlayer {
        constructor(options = {}) {
            this.container = options.container || document.getElementById('wsWaveform');
            this.ws = null;
            this.state = { isPlaying: false, currentTime: 0, pausedAt: 0 };
            this.onTimeUpdate = options.onTimeUpdate || (() => {});
            this.onStateChange = options.onStateChange || (() => {});
            this._ensure();
        }

        _ensure() {
            if (this.ws || !this.container || !window.WaveSurfer) return;
            this.ws = window.WaveSurfer.create({
                container: this.container,
                waveColor: '#2196F3',
                progressColor: '#1976D8',
                height: 160,
                barWidth: 2,
                barGap: 1,
                barRadius: 2,
                barHeight: 0.6,
            });
            this.ws.on('ready', (duration) => {
                this.state.isPlaying = false;
                this.state.currentTime = 0;
                this.state.pausedAt = 0;
                this.onStateChange({ type: 'loaded', duration: duration || this.getDuration() });
            });
            this.ws.on('timeupdate', (t) => {
                this.state.currentTime = t || 0;
                this.onTimeUpdate(this.state.currentTime);
            });
            this.ws.on('play', () => {
                this.state.isPlaying = true;
                this.onStateChange({ type: 'play' });
            });
            this.ws.on('pause', () => {
                this.state.isPlaying = false;
                this.state.pausedAt = this.ws.getCurrentTime();
                this.onStateChange({ type: 'pause' });
            });
            this.ws.on('finish', () => {
                this.state.isPlaying = false;
                this.state.currentTime = 0;
                this.state.pausedAt = 0;
                this.onStateChange({ type: 'stop' });
            });
            this.ws.on('seeking', (t) => {
                this.state.currentTime = t || 0;
                this.state.pausedAt = this.state.currentTime;
                this.onTimeUpdate(this.state.currentTime);
            });
            this.ws.on('interaction', (t) => {
                this.state.currentTime = t || 0;
                this.state.pausedAt = this.state.currentTime;
                this.onTimeUpdate(this.state.currentTime);
            });
        }

        async loadUrl(url) {
            this._ensure();
            if (!this.ws) return;
            this.ws.load(url);
            await new Promise((resolve) => this.ws.once('ready', resolve));
        }

        play(startAt = null) {
            this._ensure();
            if (!this.ws) return;
            if (startAt != null) this.ws.setTime(startAt);
            this.ws.play();
        }

        pause() {
            if (this.ws) this.ws.pause();
        }

        stop() {
            if (!this.ws) return;
            this.ws.pause();
            this.ws.setTime(0);
            this.state.isPlaying = false;
            this.state.currentTime = 0;
            this.state.pausedAt = 0;
            this.onStateChange({ type: 'stop' });
        }

        seek(time) {
            if (!this.ws) return;
            this.ws.setTime(time);
            this.state.currentTime = time;
            this.state.pausedAt = time;
            this.onTimeUpdate(time);
        }

        getDuration() {
            return this.ws ? this.ws.getDuration() : 0;
        }

        // 获取音频参数（从解码后的 AudioBuffer）
        getAudioParams() {
            if (!this.ws) return null;
            const decodedData = this.ws.getDecodedData();
            if (!decodedData) return null;
            return {
                sampleRate: decodedData.sampleRate,
                channels: decodedData.numberOfChannels,
                duration: decodedData.duration
            };
        }
    }

    window.WaveSurferPlayer = WaveSurferPlayer;
})();


