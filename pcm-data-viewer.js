// PCM 数据查看器：Hex View + Sample Table + Frame Sequence，虚拟滚动
(function () {
    const ROW_HEIGHT = 28;
    const HEX_BYTES_PER_ROW = 16;
    const BUFFER_ROWS = 5;
    const VIEWPORT_HEIGHT = 300;
    const HIGHLIGHT_THROTTLE = 200;

    // 帧序列总览：每 N 个采样帧合并为一个方块（自适应）
    const SEQ_ITEM_WIDTH = 6;   // px
    const SEQ_ITEM_GAP = 1;     // px
    const SEQ_MIN_HEIGHT = 8;
    const SEQ_MAX_HEIGHT = 48;

    // 声道颜色（用于 hex 视图帧边界区分）
    const CH_COLORS = ['#2196F3', '#4CAF50', '#FF9800', '#E91E63'];

    class PcmDataViewer {
        constructor(container) {
            this.container = container;
            this.rawBuffer = null;
            this.config = null;
            this.totalSamples = 0;
            this.bytesPerSample = 0;
            this.bytesPerFrame = 0;
            this.viewMode = 'hex';
            this.highlightSampleIndex = -1;
            this._collapsed = false;
            this._lastHighlightTime = 0;
            this._rafId = null;
            this._view = null;
            this._seqData = null;      // 帧序列总览数据缓存
            this._showAmplitude = true; // 总览条是否按振幅显示高度
            this._init();
        }

        _init() {
            if (!this.container) return;
            this._body = this.container.querySelector('#dataViewerBody');
            this._scroll = this.container.querySelector('#dataViewerScroll');
            this._content = this.container.querySelector('#dataViewerContent');
            this._statsEl = this.container.querySelector('#dataViewerStats');
            this._toggleBtn = this.container.querySelector('#dataViewerToggle');
            this._modeSwitch = this.container.querySelector('.view-mode-switch');
            this._seqContainer = this.container.querySelector('#frameSequenceContent');
            this._seqPanel = this.container.querySelector('#frameSequencePanel');
            this._frameInfoEl = this.container.querySelector('#frameInfoDisplay');
            this._ampToggle = this.container.querySelector('#ampToggle');
            this._anatomyEl = this.container.querySelector('#frameAnatomy');
            this._timeAxisEl = this.container.querySelector('#seqTimeAxis');

            // 折叠
            const titleEl = this.container.querySelector('.data-viewer-title');
            if (titleEl) {
                titleEl.style.cursor = 'pointer';
                titleEl.addEventListener('click', () => this._toggleCollapse());
            }

            // 视图切换
            if (this._modeSwitch) {
                this._modeSwitch.addEventListener('click', (e) => {
                    const btn = e.target.closest('.view-mode-btn');
                    if (!btn) return;
                    const mode = btn.getAttribute('data-view');
                    if (mode && mode !== this.viewMode) this.setViewMode(mode);
                });
            }

            // 虚拟滚动
            if (this._scroll) {
                this._scroll.addEventListener('scroll', () => this._onScroll());
            }

            // 振幅开关
            if (this._ampToggle) {
                this._ampToggle.addEventListener('change', () => {
                    this._showAmplitude = this._ampToggle.checked;
                    this._renderSequence();
                });
            }

            // 帧序列点击联动
            if (this._seqContainer) {
                this._seqContainer.addEventListener('click', (e) => {
                    const item = e.target.closest('.dv-seq-item');
                    if (!item) return;
                    const idx = parseInt(item.dataset.sampleStart, 10);
                    if (!isNaN(idx)) this.scrollToSample(idx);
                });
                // 帧序列 tooltip
                this._seqContainer.addEventListener('mouseover', (e) => this._onSeqHover(e));
                this._seqContainer.addEventListener('mouseout', () => this._hideTooltip());
                this._seqContainer.addEventListener('mousemove', (e) => this._moveTooltip(e));
            }

            // 帧导航按钮
            const prevBtn = this.container.querySelector('#framePrev');
            const nextBtn = this.container.querySelector('#frameNext');
            if (prevBtn) prevBtn.addEventListener('click', () => this._navigateFrame(-1));
            if (nextBtn) nextBtn.addEventListener('click', () => this._navigateFrame(1));

            // tooltip
            this._tooltip = document.createElement('div');
            this._tooltip.className = 'data-viewer-tooltip';
            this._tooltip.style.display = 'none';
            document.body.appendChild(this._tooltip);

            if (this._content) {
                this._content.addEventListener('mouseover', (e) => this._onHover(e));
                this._content.addEventListener('mouseout', () => this._hideTooltip());
                this._content.addEventListener('mousemove', (e) => this._moveTooltip(e));
            }
        }

        load(arrayBuffer, config) {
            this.rawBuffer = arrayBuffer;
            this.config = { ...config };
            this._view = new DataView(arrayBuffer);
            this.bytesPerSample = this.config.bitDepth / 8;
            this.bytesPerFrame = this.bytesPerSample * this.config.channels;
            this.totalSamples = Math.floor(arrayBuffer.byteLength / this.bytesPerFrame);
            this.highlightSampleIndex = -1;
            this._seqData = null;
            if (this._scroll) this._scroll.scrollTop = 0;
            const headerEl = this.container.querySelector('.dv-table-header-fixed');
            if (headerEl) headerEl._channels = null;
            this._updateStats();
            this._buildSequenceData();
            this._renderSequence();
            this._renderFrameAnatomy();
            this._renderTimeAxis();
            this._render();
        }

        clear() {
            this.rawBuffer = null;
            this.config = null;
            this._view = null;
            this.totalSamples = 0;
            this._seqData = null;
            if (this._content) this._content.innerHTML = '';
            if (this._statsEl) this._statsEl.textContent = '';
            if (this._seqContainer) this._seqContainer.innerHTML = '';
            if (this._frameInfoEl) this._frameInfoEl.textContent = '';
        }

        setViewMode(mode) {
            this.viewMode = mode;
            if (this._modeSwitch) {
                this._modeSwitch.querySelectorAll('.view-mode-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.getAttribute('data-view') === mode);
                });
            }
            if (this._scroll) this._scroll.scrollTop = 0;
            this._render();
        }

        scrollToSample(sampleIndex) {
            if (!this.rawBuffer || !this._scroll) return;
            sampleIndex = Math.max(0, Math.min(sampleIndex, this.totalSamples - 1));
            const row = this._sampleToRow(sampleIndex);
            const scrollTarget = row * ROW_HEIGHT - VIEWPORT_HEIGHT / 2 + ROW_HEIGHT / 2;
            this._scroll.scrollTop = Math.max(0, scrollTarget);
            this.highlightSampleIndex = sampleIndex;
            this._render();
            this._updateFrameInfo(sampleIndex);
            this._highlightSeqItem(sampleIndex);
        }

        highlightSample(sampleIndex) {
            const now = Date.now();
            if (now - this._lastHighlightTime < HIGHLIGHT_THROTTLE) return;
            this._lastHighlightTime = now;
            this.highlightSampleIndex = sampleIndex;
            this._render();
            this._highlightSeqItem(sampleIndex);
        }

        // -- 帧序列总览 --

        _buildSequenceData() {
            if (!this.rawBuffer || !this._seqContainer) return;
            // 根据容器宽度计算每个方块代表多少个采样帧
            const containerWidth = this._seqContainer.clientWidth || 600;
            const maxItems = Math.floor(containerWidth / (SEQ_ITEM_WIDTH + SEQ_ITEM_GAP));
            const samplesPerBlock = Math.max(1, Math.ceil(this.totalSamples / maxItems));
            const blockCount = Math.ceil(this.totalSamples / samplesPerBlock);

            const blocks = [];
            const little = this.config.endianness === 'little';
            const channels = this.config.channels;
            let globalMaxAbs = 0;

            for (let b = 0; b < blockCount; b++) {
                const startSample = b * samplesPerBlock;
                const endSample = Math.min(startSample + samplesPerBlock, this.totalSamples);
                let maxAbs = 0;
                const chMaxAbs = new Array(channels).fill(0);
                // 采样：为性能考虑，大块中只取少量样本
                const step = Math.max(1, Math.floor((endSample - startSample) / 32));
                for (let s = startSample; s < endSample; s += step) {
                    const offset = s * this.bytesPerFrame;
                    for (let ch = 0; ch < channels; ch++) {
                        const chOffset = offset + ch * this.bytesPerSample;
                        let val = 0;
                        switch (this.config.bitDepth) {
                            case 8: val = Math.abs(this._view.getInt8(chOffset) / 128.0); break;
                            case 16: val = Math.abs(this._view.getInt16(chOffset, little) / 32768.0); break;
                            case 24: {
                                const b1 = this._view.getUint8(chOffset);
                                const b2 = this._view.getUint8(chOffset + 1);
                                const b3 = this._view.getUint8(chOffset + 2);
                                let raw = little ? (b3 << 16) | (b2 << 8) | b1 : (b1 << 16) | (b2 << 8) | b3;
                                if (raw & 0x800000) raw |= ~0xFFFFFF;
                                val = Math.abs(raw / 8388608.0);
                                break;
                            }
                            case 32:
                                if (this.config.sampleFormat === 'float') {
                                    val = Math.abs(this._view.getFloat32(chOffset, little));
                                } else {
                                    val = Math.abs(this._view.getInt32(chOffset, little) / 2147483648.0);
                                }
                                break;
                        }
                        if (val > chMaxAbs[ch]) chMaxAbs[ch] = val;
                        if (val > maxAbs) maxAbs = val;
                    }
                }
                if (maxAbs > globalMaxAbs) globalMaxAbs = maxAbs;
                blocks.push({ startSample, endSample, maxAbs, chMaxAbs, count: endSample - startSample });
            }

            this._seqData = { blocks, samplesPerBlock, globalMaxAbs };
        }

        _renderSequence() {
            if (!this._seqContainer || !this._seqData) return;
            const { blocks, globalMaxAbs } = this._seqData;
            const frag = document.createDocumentFragment();
            const showAmp = this._showAmplitude;
            const channels = this.config.channels;
            const multiCh = channels > 1;

            blocks.forEach((block) => {
                const item = document.createElement('div');
                item.className = 'dv-seq-item';
                item.dataset.sampleStart = block.startSample;

                const totalH = showAmp && globalMaxAbs > 0
                    ? SEQ_MIN_HEIGHT + (block.maxAbs / globalMaxAbs) * (SEQ_MAX_HEIGHT - SEQ_MIN_HEIGHT)
                    : SEQ_MIN_HEIGHT;
                item.style.height = totalH + 'px';

                if (multiCh && showAmp && globalMaxAbs > 0) {
                    // 堆叠柱状图：每个声道按各自振幅占比分段
                    item.style.display = 'flex';
                    item.style.flexDirection = 'column-reverse';
                    item.style.backgroundColor = 'transparent';
                    const chSum = block.chMaxAbs.reduce((a, b) => a + b, 0) || 1;
                    for (let ch = 0; ch < channels; ch++) {
                        const seg = document.createElement('div');
                        seg.className = 'dv-seq-ch-seg';
                        const pct = (block.chMaxAbs[ch] / chSum) * 100;
                        seg.style.height = pct + '%';
                        seg.style.backgroundColor = CH_COLORS[ch % CH_COLORS.length];
                        item.appendChild(seg);
                    }
                } else if (multiCh) {
                    // 不显示振幅时，均分声道色段
                    item.style.display = 'flex';
                    item.style.flexDirection = 'column-reverse';
                    item.style.backgroundColor = 'transparent';
                    for (let ch = 0; ch < channels; ch++) {
                        const seg = document.createElement('div');
                        seg.className = 'dv-seq-ch-seg';
                        seg.style.height = (100 / channels) + '%';
                        seg.style.backgroundColor = CH_COLORS[ch % CH_COLORS.length];
                        item.appendChild(seg);
                    }
                } else {
                    // 单声道：保持振幅着色
                    const ratio = globalMaxAbs > 0 ? block.maxAbs / globalMaxAbs : 0;
                    item.style.backgroundColor = this._amplitudeColor(ratio);
                }

                frag.appendChild(item);
            });

            this._seqContainer.innerHTML = '';
            this._seqContainer.style.setProperty('--content-height', showAmp ? '70px' : '30px');
            this._seqContainer.appendChild(frag);

            if (this._seqPanel) this._seqPanel.style.display = '';
        }

        _renderFrameAnatomy() {
            const el = this._anatomyEl;
            if (!el || !this.config) return;
            el.innerHTML = '';
            const { bitDepth, channels, endianness, sampleFormat } = this.config;
            const bytesPerSample = bitDepth / 8;
            const bytesPerFrame = bytesPerSample * channels;

            const wrapper = document.createElement('div');
            wrapper.className = 'dv-anatomy-row';

            // 标题：1 Frame = X Bytes
            const titleSpan = document.createElement('span');
            titleSpan.className = 'dv-anatomy-title';
            titleSpan.textContent = `1 Frame = ${bytesPerFrame} Byte${bytesPerFrame > 1 ? 's' : ''}`;
            wrapper.appendChild(titleSpan);

            // 声道方块
            const blocksDiv = document.createElement('div');
            blocksDiv.className = 'dv-anatomy-blocks';
            const unitW = 28; // 每字节宽度 px
            const isLittle = endianness === 'little';

            for (let ch = 0; ch < channels; ch++) {
                const chBlock = document.createElement('div');
                chBlock.className = 'dv-anatomy-ch';
                chBlock.style.width = (bytesPerSample * unitW) + 'px';
                chBlock.style.borderColor = CH_COLORS[ch % CH_COLORS.length];
                chBlock.style.backgroundColor = CH_COLORS[ch % CH_COLORS.length] + '18';

                // 声道标签
                const chLabel = document.createElement('div');
                chLabel.className = 'dv-anatomy-ch-label';
                chLabel.style.color = CH_COLORS[ch % CH_COLORS.length];
                chLabel.textContent = channels > 1 ? `CH${ch}` : 'CH0';
                chBlock.appendChild(chLabel);

                // 字节序标注
                const byteRow = document.createElement('div');
                byteRow.className = 'dv-anatomy-byte-row';
                for (let b = 0; b < bytesPerSample; b++) {
                    const bLabel = document.createElement('span');
                    bLabel.className = 'dv-anatomy-byte-label';
                    if (bitDepth === 8) {
                        bLabel.textContent = 'B0';
                    } else if (isLittle) {
                        bLabel.textContent = b === 0 ? 'Lo' : b === bytesPerSample - 1 ? 'Hi' : `B${b}`;
                    } else {
                        bLabel.textContent = b === 0 ? 'Hi' : b === bytesPerSample - 1 ? 'Lo' : `B${bytesPerSample - 1 - b}`;
                    }
                    byteRow.appendChild(bLabel);
                }
                chBlock.appendChild(byteRow);
                blocksDiv.appendChild(chBlock);
            }
            wrapper.appendChild(blocksDiv);

            // 参数标签 pills
            const tagsDiv = document.createElement('div');
            tagsDiv.className = 'dv-anatomy-tags';
            const formatStr = sampleFormat === 'float' ? `${bitDepth}bit float` : `${bitDepth}bit`;
            const endStr = isLittle ? 'LE' : 'BE';
            const chStr = channels === 1 ? 'Mono' : channels === 2 ? 'Stereo' : `${channels}ch`;
            [formatStr, chStr, endStr].forEach(text => {
                const pill = document.createElement('span');
                pill.className = 'dv-anatomy-tag';
                pill.textContent = text;
                tagsDiv.appendChild(pill);
            });
            wrapper.appendChild(tagsDiv);

            el.appendChild(wrapper);
        }

        _renderTimeAxis() {
            const el = this._timeAxisEl;
            if (!el || !this.config || !this._seqData) return;
            el.innerHTML = '';
            const duration = this.totalSamples / this.config.sampleRate;
            if (duration <= 0) return;

            // 选择合适的刻度间距
            const intervals = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300];
            const targetTicks = 8;
            let interval = intervals[intervals.length - 1];
            for (let i = 0; i < intervals.length; i++) {
                if (duration / intervals[i] <= targetTicks * 1.5) { interval = intervals[i]; break; }
            }

            const frag = document.createDocumentFragment();
            for (let t = 0; t <= duration; t += interval) {
                const pct = (t / duration) * 100;
                if (pct > 100) break;
                const tick = document.createElement('span');
                tick.className = 'dv-time-tick';
                tick.style.left = pct + '%';
                tick.textContent = t < 1 ? t.toFixed(2) + 's' : t < 10 ? t.toFixed(1) + 's' : Math.round(t) + 's';
                frag.appendChild(tick);
            }
            // 末尾标注总时长
            const endTick = document.createElement('span');
            endTick.className = 'dv-time-tick dv-time-tick-end';
            endTick.style.left = '100%';
            endTick.textContent = duration < 1 ? duration.toFixed(3) + 's' : duration.toFixed(1) + 's';
            frag.appendChild(endTick);

            el.appendChild(frag);
        }

        _amplitudeColor(ratio) {
            // 低振幅蓝色，中振幅绿色，高振幅红色
            if (ratio < 0.01) return '#e0e0e0';
            if (ratio < 0.33) {
                const t = ratio / 0.33;
                return `rgb(${Math.round(33 + t * (76 - 33))}, ${Math.round(150 + t * (175 - 150))}, ${Math.round(243 - t * (243 - 80))})`;
            }
            if (ratio < 0.66) {
                const t = (ratio - 0.33) / 0.33;
                return `rgb(${Math.round(76 + t * (255 - 76))}, ${Math.round(175 - t * (175 - 152))}, ${Math.round(80 - t * (80 - 0))})`;
            }
            const t = (ratio - 0.66) / 0.34;
            return `rgb(${Math.round(255 - t * (255 - 244))}, ${Math.round(152 - t * (152 - 67))}, ${Math.round(t * 54)})`;
        }

        _highlightSeqItem(sampleIndex) {
            if (!this._seqContainer || !this._seqData) return;
            const { samplesPerBlock } = this._seqData;
            const blockIdx = Math.floor(sampleIndex / samplesPerBlock);
            const items = this._seqContainer.querySelectorAll('.dv-seq-item');
            items.forEach((el, i) => {
                el.classList.toggle('selected', i === blockIdx);
            });
        }

        _onSeqHover(e) {
            const item = e.target.closest('.dv-seq-item');
            if (!item) { this._hideTooltip(); return; }
            const startSample = parseInt(item.dataset.sampleStart, 10);
            if (isNaN(startSample) || !this._seqData) return;
            const { samplesPerBlock } = this._seqData;
            const endSample = Math.min(startSample + samplesPerBlock, this.totalSamples);
            const blockIdx = Math.floor(startSample / samplesPerBlock);
            const block = this._seqData.blocks[blockIdx];

            let html = `<div>Frame #${startSample} - #${endSample - 1}</div>`;
            html += `<div>${endSample - startSample} samples</div>`;
            if (block) {
                if (block.chMaxAbs && this.config.channels > 1) {
                    block.chMaxAbs.forEach((v, i) => {
                        const label = i === 0 ? 'L' : i === 1 ? 'R' : `CH${i}`;
                        html += `<div style="color:${CH_COLORS[i % CH_COLORS.length]}">Peak ${label}: ${v.toFixed(4)}</div>`;
                    });
                } else {
                    html += `<div>Peak: ${block.maxAbs.toFixed(4)}</div>`;
                }
            }
            const startTime = startSample / this.config.sampleRate;
            const endTime = endSample / this.config.sampleRate;
            html += `<div>Time: ${startTime.toFixed(3)}s - ${endTime.toFixed(3)}s</div>`;
            const startOffset = startSample * this.bytesPerFrame;
            const endOffset = endSample * this.bytesPerFrame;
            html += `<div>Bytes: 0x${startOffset.toString(16).padStart(8, '0')} - 0x${endOffset.toString(16).padStart(8, '0')}</div>`;
            this._tooltip.innerHTML = html;
            this._tooltip.style.display = 'block';
        }

        _updateFrameInfo(sampleIndex) {
            if (!this._frameInfoEl || !this.rawBuffer) return;
            const data = this._getSampleAt(sampleIndex);
            if (!data) return;
            const time = (sampleIndex / this.config.sampleRate).toFixed(4);
            let info = `Frame #${sampleIndex}  |  ${time}s  |  Offset: 0x${data.offset.toString(16).padStart(8, '0')}`;
            data.channels.forEach((ch, i) => {
                const label = this.config.channels > 1 ? (i === 0 ? ' L' : ' R') : '';
                info += `  |  ${label}: ${ch.normalized.toFixed(6)}`;
            });
            this._frameInfoEl.textContent = info;
        }

        _navigateFrame(delta) {
            if (!this.rawBuffer) return;
            let idx = this.highlightSampleIndex + delta;
            if (idx < 0) idx = 0;
            if (idx >= this.totalSamples) idx = this.totalSamples - 1;
            this.scrollToSample(idx);
        }

        // -- 私有方法 --

        _toggleCollapse() {
            this._collapsed = !this._collapsed;
            if (this._body) this._body.style.display = this._collapsed ? 'none' : '';
            if (this._toggleBtn) this._toggleBtn.textContent = this._collapsed ? '▶' : '▼';
        }

        _getTotalRows() {
            if (!this.rawBuffer) return 0;
            if (this.viewMode === 'hex') return Math.ceil(this.rawBuffer.byteLength / HEX_BYTES_PER_ROW);
            return this.totalSamples;
        }

        _sampleToRow(sampleIndex) {
            if (this.viewMode === 'hex') return Math.floor((sampleIndex * this.bytesPerFrame) / HEX_BYTES_PER_ROW);
            return sampleIndex;
        }

        _onScroll() {
            if (this._rafId) return;
            this._rafId = requestAnimationFrame(() => { this._rafId = null; this._render(); });
        }

        _render() {
            if (!this.rawBuffer || !this._scroll || !this._content) return;
            const totalRows = this._getTotalRows();
            const totalHeight = totalRows * ROW_HEIGHT;
            const scrollTop = this._scroll.scrollTop;
            const viewportRows = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT);
            const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
            const endRow = Math.min(totalRows, Math.floor(scrollTop / ROW_HEIGHT) + viewportRows + BUFFER_ROWS);

            const fragment = document.createDocumentFragment();
            if (this.viewMode === 'hex') {
                for (let row = startRow; row < endRow; row++) fragment.appendChild(this._createHexRow(row));
            } else {
                for (let row = startRow; row < endRow; row++) fragment.appendChild(this._createTableRow(row));
            }

            const topPad = startRow * ROW_HEIGHT;
            const bottomPad = Math.max(0, totalHeight - endRow * ROW_HEIGHT);
            this._content.innerHTML = '';
            this._content.style.paddingTop = topPad + 'px';
            this._content.style.paddingBottom = bottomPad + 'px';
            this._content.appendChild(fragment);
            this._updateTableHeader();
        }

        _updateTableHeader() {
            let headerEl = this.container.querySelector('.dv-table-header-fixed');
            if (this.viewMode === 'table' && this.rawBuffer) {
                if (!headerEl) {
                    headerEl = document.createElement('div');
                    headerEl.className = 'dv-table-header-fixed';
                    this._scroll.parentNode.insertBefore(headerEl, this._scroll);
                }
                if (!headerEl.hasChildNodes() || headerEl._channels !== this.config.channels) {
                    headerEl.innerHTML = '';
                    headerEl.appendChild(this._createTableHeader());
                    headerEl._channels = this.config.channels;
                }
                headerEl.style.display = '';
            } else if (headerEl) {
                headerEl.style.display = 'none';
            }
        }

        // -- Hex 视图（带帧边界颜色编码）--

        _createHexRow(row) {
            const offset = row * HEX_BYTES_PER_ROW;
            const rowDiv = document.createElement('div');
            rowDiv.className = 'dv-hex-row';

            // 高亮行
            if (this.highlightSampleIndex >= 0) {
                const hlStart = this.highlightSampleIndex * this.bytesPerFrame;
                const hlEnd = hlStart + this.bytesPerFrame;
                if (offset < hlEnd && offset + HEX_BYTES_PER_ROW > hlStart) rowDiv.classList.add('highlight');
            }

            // 偏移量
            const offsetSpan = document.createElement('span');
            offsetSpan.className = 'dv-hex-offset';
            offsetSpan.textContent = offset.toString(16).padStart(8, '0');
            rowDiv.appendChild(offsetSpan);

            // hex 字节
            const bytesDiv = document.createElement('div');
            bytesDiv.className = 'dv-hex-bytes';
            const channels = this.config.channels;

            for (let j = 0; j < HEX_BYTES_PER_ROW; j++) {
                const byteSpan = document.createElement('span');
                byteSpan.className = 'dv-hex-byte';
                const pos = offset + j;

                if (pos < this.rawBuffer.byteLength) {
                    const byte = this._view.getUint8(pos);
                    byteSpan.textContent = byte.toString(16).padStart(2, '0');
                    byteSpan.dataset.pos = pos;

                    // 帧边界颜色编码
                    const posInFrame = pos % this.bytesPerFrame;
                    const chIndex = Math.floor(posInFrame / this.bytesPerSample);
                    byteSpan.style.color = CH_COLORS[chIndex % CH_COLORS.length];

                    // 帧边界标记：每个帧的第一个字节左侧加分隔
                    if (posInFrame === 0 && j > 0) {
                        byteSpan.classList.add('frame-start');
                    }

                    if (byte === 0) byteSpan.classList.add('zero');

                    // 高亮当前播放位置字节
                    if (this.highlightSampleIndex >= 0) {
                        const hlStart = this.highlightSampleIndex * this.bytesPerFrame;
                        const hlEnd = hlStart + this.bytesPerFrame;
                        if (pos >= hlStart && pos < hlEnd) byteSpan.classList.add('active');
                    }
                } else {
                    byteSpan.textContent = '  ';
                    byteSpan.classList.add('empty');
                }
                bytesDiv.appendChild(byteSpan);
            }
            rowDiv.appendChild(bytesDiv);

            // 右侧归一化值
            const valuesDiv = document.createElement('div');
            valuesDiv.className = 'dv-hex-values';
            const firstSample = Math.floor(offset / this.bytesPerFrame);
            const lastByte = Math.min(offset + HEX_BYTES_PER_ROW, this.rawBuffer.byteLength);
            const lastSample = Math.floor((lastByte - 1) / this.bytesPerFrame);
            const vals = [];
            for (let s = firstSample; s <= lastSample && s < this.totalSamples; s++) {
                const data = this._getSampleAt(s);
                if (data) vals.push(data.channels.map(ch => ch.normalized.toFixed(3)).join(' '));
            }
            valuesDiv.textContent = vals.join(' | ');
            rowDiv.appendChild(valuesDiv);

            return rowDiv;
        }

        // -- Table 视图 --

        _createTableHeader() {
            const header = document.createElement('div');
            header.className = 'dv-table-row dv-table-header';
            if (this.config.channels > 1) header.classList.add('dv-table-row-multichannel');
            const cols = this.config.channels > 1
                ? ['#', 'Offset', 'Hex', 'Raw L', 'Raw R', 'Float L', 'Float R']
                : ['#', 'Offset', 'Hex', 'Raw', 'Float'];
            cols.forEach(col => {
                const cell = document.createElement('span');
                cell.className = 'dv-table-cell dv-table-head-cell';
                cell.textContent = col;
                header.appendChild(cell);
            });
            return header;
        }

        _createTableRow(sampleIndex) {
            const data = this._getSampleAt(sampleIndex);
            const row = document.createElement('div');
            row.className = 'dv-table-row';
            if (this.config.channels > 1) row.classList.add('dv-table-row-multichannel');
            if (sampleIndex === this.highlightSampleIndex) row.classList.add('highlight');

            const idxCell = document.createElement('span');
            idxCell.className = 'dv-table-cell dv-col-index';
            idxCell.textContent = String(sampleIndex);
            row.appendChild(idxCell);

            const offCell = document.createElement('span');
            offCell.className = 'dv-table-cell dv-col-offset';
            offCell.textContent = '0x' + (data ? data.offset : 0).toString(16).padStart(8, '0');
            row.appendChild(offCell);

            const hexCell = document.createElement('span');
            hexCell.className = 'dv-table-cell dv-col-hex';
            if (data) hexCell.textContent = Array.from(data.rawBytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
            row.appendChild(hexCell);

            if (this.config.channels > 1) {
                for (let ch = 0; ch < this.config.channels; ch++) {
                    const rawCell = document.createElement('span');
                    rawCell.className = 'dv-table-cell dv-col-raw';
                    if (data && data.channels[ch]) rawCell.textContent = String(data.channels[ch].rawValue);
                    row.appendChild(rawCell);
                }
                for (let ch = 0; ch < this.config.channels; ch++) {
                    const floatCell = document.createElement('span');
                    floatCell.className = 'dv-table-cell dv-col-float';
                    if (data && data.channels[ch]) floatCell.textContent = data.channels[ch].normalized.toFixed(6);
                    row.appendChild(floatCell);
                }
            } else {
                const rawCell = document.createElement('span');
                rawCell.className = 'dv-table-cell dv-col-raw';
                if (data && data.channels[0]) rawCell.textContent = String(data.channels[0].rawValue);
                row.appendChild(rawCell);
                const floatCell = document.createElement('span');
                floatCell.className = 'dv-table-cell dv-col-float';
                if (data && data.channels[0]) floatCell.textContent = data.channels[0].normalized.toFixed(6);
                row.appendChild(floatCell);
            }
            return row;
        }

        // -- 样本解析 --

        _getSampleAt(index) {
            if (!this.rawBuffer || !this._view || index < 0 || index >= this.totalSamples) return null;
            const offset = index * this.bytesPerFrame;
            if (offset + this.bytesPerFrame > this.rawBuffer.byteLength) return null;
            const rawBytes = new Uint8Array(this.rawBuffer, offset, this.bytesPerFrame);
            const little = this.config.endianness === 'little';
            const channels = [];
            for (let ch = 0; ch < this.config.channels; ch++) {
                const chOffset = offset + ch * this.bytesPerSample;
                let rawValue = 0, normalized = 0;
                switch (this.config.bitDepth) {
                    case 8: rawValue = this._view.getInt8(chOffset); normalized = rawValue / 128.0; break;
                    case 16: rawValue = this._view.getInt16(chOffset, little); normalized = rawValue / 32768.0; break;
                    case 24: {
                        const b1 = this._view.getUint8(chOffset), b2 = this._view.getUint8(chOffset + 1), b3 = this._view.getUint8(chOffset + 2);
                        rawValue = little ? (b3 << 16) | (b2 << 8) | b1 : (b1 << 16) | (b2 << 8) | b3;
                        if (rawValue & 0x800000) rawValue |= ~0xFFFFFF;
                        normalized = rawValue / 8388608.0; break;
                    }
                    case 32:
                        if (this.config.sampleFormat === 'float') { normalized = this._view.getFloat32(chOffset, little); rawValue = normalized; }
                        else { rawValue = this._view.getInt32(chOffset, little); normalized = rawValue / 2147483648.0; }
                        break;
                }
                channels.push({ rawValue, normalized });
            }
            return { offset, rawBytes, channels };
        }

        // -- 统计信息 --

        _updateStats() {
            if (!this._statsEl || !this.rawBuffer) return;
            const totalBytes = this.rawBuffer.byteLength;
            const totalLabel = window.t ? window.t('totalSamples') : 'Total Samples';
            const bytesLabel = window.t ? window.t('totalBytes') : 'Total Bytes';
            const durationLabel = window.t ? window.t('duration') : 'Duration';
            const bytesPerFrameLabel = `${this.bytesPerFrame}B/frame`;
            const duration = (this.totalSamples / this.config.sampleRate).toFixed(3);
            this._statsEl.textContent = `${totalLabel}: ${this.totalSamples.toLocaleString()}  |  ${bytesLabel}: ${totalBytes.toLocaleString()}  |  ${bytesPerFrameLabel}  |  ${durationLabel}: ${duration}s`;
        }

        // -- Tooltip --

        _onHover(e) {
            const byteEl = e.target.closest('.dv-hex-byte');
            if (!byteEl || byteEl.classList.contains('empty')) { this._hideTooltip(); return; }
            const pos = parseInt(byteEl.dataset.pos, 10);
            if (isNaN(pos)) return;
            const byte = this._view.getUint8(pos);
            const sampleIndex = Math.floor(pos / this.bytesPerFrame);
            const posInFrame = pos % this.bytesPerFrame;
            const chIndex = Math.floor(posInFrame / this.bytesPerSample);
            const byteInSample = posInFrame % this.bytesPerSample;
            const data = this._getSampleAt(sampleIndex);

            let html = `<div>Byte: 0x${byte.toString(16).padStart(2, '0')} (${byte})</div>`;
            html += `<div>Bin: ${byte.toString(2).padStart(8, '0')}</div>`;
            html += `<div>Offset: 0x${pos.toString(16).padStart(8, '0')}</div>`;
            html += `<div style="margin-top:4px; border-top:1px solid rgba(255,255,255,0.2); padding-top:4px">`;
            html += `Frame #${sampleIndex}`;
            if (this.config.channels > 1) html += ` | Ch ${chIndex === 0 ? 'L' : 'R'}`;
            html += ` | Byte ${byteInSample + 1}/${this.bytesPerSample}`;
            html += `</div>`;
            if (data) {
                data.channels.forEach((ch, i) => {
                    const label = this.config.channels > 1 ? (i === 0 ? 'L' : 'R') + ': ' : '';
                    html += `<div>${label}${ch.normalized.toFixed(6)}</div>`;
                });
            }
            this._tooltip.innerHTML = html;
            this._tooltip.style.display = 'block';
        }

        _moveTooltip(e) {
            if (this._tooltip.style.display === 'none') return;
            this._tooltip.style.left = (e.clientX + 12) + 'px';
            this._tooltip.style.top = (e.clientY - 10) + 'px';
        }

        _hideTooltip() { this._tooltip.style.display = 'none'; }
    }

    window.PcmDataViewer = PcmDataViewer;
})();
