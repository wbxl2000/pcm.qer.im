// 通用工具集合：提供时间格式化、WAV 头生成、网格绘制、文件名推断与端序检测
(function () {
    const Utils = {
        // 将秒格式化为 00:00 或 00:00:00
        formatTime(seconds) {
            if (!isFinite(seconds) || seconds < 0) seconds = 0;
            const total = Math.floor(seconds);
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            const s = total % 60;
            const pad = (n) => String(n).padStart(2, '0');
            return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
        },

        // 在画布上绘制浅色网格，便于观察波形
        drawGrid(ctx, width, height) {
            if (!ctx) return;
            const gridX = Math.max(25, Math.floor(width / 20));
            const gridY = Math.max(20, Math.floor(height / 8));
            ctx.save();
            ctx.strokeStyle = '#eee';
            ctx.lineWidth = 1;

            // 垂直网格
            for (let x = 0; x <= width; x += gridX) {
                ctx.beginPath();
                ctx.moveTo(x + 0.5, 0);
                ctx.lineTo(x + 0.5, height);
                ctx.stroke();
            }
            // 水平网格
            for (let y = 0; y <= height; y += gridY) {
                ctx.beginPath();
                ctx.moveTo(0, y + 0.5);
                ctx.lineTo(width, y + 0.5);
                ctx.stroke();
            }

            // 中心线
            ctx.strokeStyle = '#ddd';
            ctx.beginPath();
            ctx.moveTo(0, height / 2 + 0.5);
            ctx.lineTo(width, height / 2 + 0.5);
            ctx.stroke();
            ctx.restore();
        },

        // 创建 WAV 头（PCM，little-endian）
        // dataLength: PCM 数据字节数
        // channels: 声道数
        // sampleRate: 采样率
        // bitDepth: 位深（8/16/24/32）
        createWavHeader(dataLength, channels, sampleRate, bitDepth) {
            const header = new ArrayBuffer(44);
            const view = new DataView(header);
            const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };

            const bytesPerSample = Math.max(1, Math.floor(bitDepth / 8));
            const blockAlign = channels * bytesPerSample;
            const byteRate = sampleRate * blockAlign;

            // RIFF chunk descriptor
            writeStr(0, 'RIFF');
            view.setUint32(4, 36 + dataLength, true); // ChunkSize
            writeStr(8, 'WAVE');

            // fmt subchunk
            writeStr(12, 'fmt ');
            view.setUint32(16, 16, true); // Subchunk1Size (PCM)
            view.setUint16(20, 1, true);  // AudioFormat = 1 (PCM)
            view.setUint16(22, channels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, byteRate, true);
            view.setUint16(32, blockAlign, true);
            view.setUint16(34, bitDepth, true);

            // data subchunk
            writeStr(36, 'data');
            view.setUint32(40, dataLength, true);

            return header;
        },

        // 根据文件名推断采样率（支持如 8000/16000/24000/44100/48000 或 8k/16k/24k/44.1k/48k 等）
        detectSampleRateFromFileName(name) {
            if (!name) return null;
            const lower = String(name).toLowerCase();
            // 优先匹配 44100、48000、24000 等纯数字
            const exact = lower.match(/(?<!\d)(8000|11025|16000|22050|24000|32000|44100|48000|96000)(?!\d)/);
            if (exact) return parseInt(exact[1], 10);
            // 匹配 8k/16k/24k/44.1k/48k
            const k = lower.match(/(8|11\.025|16|22\.05|24|32|44\.1|48|96)k(?!\d)/);
            if (k) {
                const map = { '8': 8000, '11.025': 11025, '16': 16000, '22.05': 22050, '24': 24000, '32': 32000, '44.1': 44100, '48': 48000, '96': 96000 };
                return map[k[1]] || null;
            }
            return null;
        },

        // 根据文件名推断端序（匹配 little/le, big/be）
        detectEndiannessFromFileName(name) {
            if (!name) return null;
            const lower = String(name).toLowerCase();
            if (/(little|\ble\b|_le\b|\ble_)/.test(lower)) return 'little';
            if (/(big|\bbe\b|_be\b|\bbe_)/.test(lower)) return 'big';
            return null;
        },

        // 从文件名解析完整参数（整合所有解析逻辑）
        parseParamsFromFileName(name) {
            try {
                if (!name) return {};
                const lower = String(name).toLowerCase();
                const result = {};
                
                // 有效值白名单
                const validSampleRates = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 96000];
                const validBitDepths = [8, 16, 24, 32];
                
                // 采样率：支持 _44100Hz 和 44100hz 格式，fallback 到原有逻辑
                const srMatch = lower.match(/[_\-]?(\d+)hz/i);
                if (srMatch) {
                    const sr = parseInt(srMatch[1], 10);
                    if (validSampleRates.includes(sr)) result.sampleRate = sr;
                }
                if (!result.sampleRate) {
                    const sr = this.detectSampleRateFromFileName(name);
                    if (sr) result.sampleRate = sr;
                }
                
                // 位深度：支持 _16bit 和 16bit 格式
                const bitMatch = lower.match(/[_\-]?(\d+)bit/i);
                if (bitMatch) {
                    const bd = parseInt(bitMatch[1], 10);
                    if (validBitDepths.includes(bd)) result.bitDepth = bd;
                }
                
                // 声道数：支持 _2ch / 2ch / _mono / mono / _stereo / stereo（限制 1-8）
                const chMatch = lower.match(/[_\-]?(\d+)ch/i);
                if (chMatch) {
                    const ch = parseInt(chMatch[1], 10);
                    if (ch >= 1 && ch <= 8) result.channels = ch;
                } else if (/[_\-]?mono/.test(lower)) {
                    result.channels = 1;
                } else if (/[_\-]?stereo/.test(lower)) {
                    result.channels = 2;
                }
                
                // 端序：复用原有逻辑
                const endianness = this.detectEndiannessFromFileName(name);
                if (endianness) result.endianness = endianness;
                
                return result;
            } catch (e) {
                console.warn('parseParamsFromFileName failed:', e);
                return {};
            }
        },

        // 检测系统端序
        detectSystemEndianness() {
            const buf = new ArrayBuffer(4);
            const u32 = new Uint32Array(buf);
            const u8 = new Uint8Array(buf);
            u32[0] = 0x01020304;
            return u8[0] === 0x04 ? 'little' : 'big';
        },

        // 解析 WAV 文件头，获取音频参数
        parseWavHeader(arrayBuffer) {
            try {
                if (!arrayBuffer || arrayBuffer.byteLength < 44) return null;
                const view = new DataView(arrayBuffer);
                const readStr = (offset, len) => {
                    let s = '';
                    for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
                    return s;
                };
                if (readStr(0, 4) !== 'RIFF' || readStr(8, 4) !== 'WAVE') return null;
                // 查找 fmt 块
                let offset = 12;
                while (offset < arrayBuffer.byteLength - 8) {
                    const chunkId = readStr(offset, 4);
                    const chunkSize = view.getUint32(offset + 4, true);
                    if (chunkId === 'fmt ' && offset + 24 <= arrayBuffer.byteLength) {
                        return {
                            channels: view.getUint16(offset + 10, true),
                            sampleRate: view.getUint32(offset + 12, true),
                            bitDepth: view.getUint16(offset + 22, true)
                        };
                    }
                    offset += 8 + chunkSize;
                    if (chunkSize === 0) break; // 防止死循环
                }
                return null;
            } catch (e) {
                console.warn('parseWavHeader failed:', e);
                return null;
            }
        },

        // 解析 MP3 帧头，获取采样率（简化版，只解析第一个有效帧）
        parseMp3Header(arrayBuffer) {
            try {
                if (!arrayBuffer || arrayBuffer.byteLength < 10) return null;
                const data = new Uint8Array(arrayBuffer);
                const sampleRates = [
                    [11025, 12000, 8000],   // MPEG 2.5
                    null,                    // reserved
                    [22050, 24000, 16000],  // MPEG 2
                    [44100, 48000, 32000]   // MPEG 1
                ];
                // 跳过 ID3v2 标签
                let offset = 0;
                if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) { // "ID3"
                    const size = ((data[6] & 0x7f) << 21) | ((data[7] & 0x7f) << 14) | 
                                 ((data[8] & 0x7f) << 7) | (data[9] & 0x7f);
                    offset = 10 + size;
                }
                // 查找帧同步（0xFF 0xE0+）
                for (let i = offset; i < Math.min(data.length - 4, 16384); i++) {
                    if (data[i] === 0xFF && (data[i + 1] & 0xE0) === 0xE0) {
                        const version = (data[i + 1] >> 3) & 0x03;
                        const srIndex = (data[i + 2] >> 2) & 0x03;
                        const channelMode = (data[i + 3] >> 6) & 0x03;
                        if (srIndex === 3 || !sampleRates[version]) continue;
                        return {
                            sampleRate: sampleRates[version][srIndex],
                            channels: channelMode === 3 ? 1 : 2
                        };
                    }
                }
                return null;
            } catch (e) {
                console.warn('parseMp3Header failed:', e);
                return null;
            }
        },

        // 统一接口：解析音频文件头
        async parseAudioHeader(file) {
            try {
                if (!file || !file.name) return null;
                const ext = file.name.toLowerCase().split('.').pop();
                const buffer = await file.slice(0, 16384).arrayBuffer(); // 只读前 16KB
                if (ext === 'wav') return this.parseWavHeader(buffer);
                if (ext === 'mp3') return this.parseMp3Header(buffer);
                return null;
            } catch (e) {
                console.warn('parseAudioHeader failed:', e);
                return null;
            }
        }
    };

    window.Utils = Utils;
})();

