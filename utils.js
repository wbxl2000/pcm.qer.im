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

        // 创建 WAV 头（little-endian）
        // dataLength: PCM 数据字节数
        // channels: 声道数
        // sampleRate: 采样率
        // bitDepth: 位深（8/16/24/32）
        // sampleFormat: 'int' | 'float'（32-bit 时区分 PCM 整数与 IEEE 浮点）
        createWavHeader(dataLength, channels, sampleRate, bitDepth, sampleFormat) {
            const header = new ArrayBuffer(44);
            const view = new DataView(header);
            const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };

            const bytesPerSample = Math.max(1, Math.floor(bitDepth / 8));
            const blockAlign = channels * bytesPerSample;
            const byteRate = sampleRate * blockAlign;
            const audioFormat = (bitDepth === 32 && sampleFormat === 'float') ? 3 : 1;

            // RIFF chunk descriptor
            writeStr(0, 'RIFF');
            view.setUint32(4, 36 + dataLength, true); // ChunkSize
            writeStr(8, 'WAVE');

            // fmt subchunk
            writeStr(12, 'fmt ');
            view.setUint32(16, 16, true); // Subchunk1Size
            view.setUint16(20, audioFormat, true); // AudioFormat: 1=PCM, 3=IEEE Float
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

        // 检测数据是否为 DHAV 容器格式（大华监控设备私有格式）
        isDHAV(arrayBuffer) {
            if (!arrayBuffer || arrayBuffer.byteLength < 4) return false;
            const u8 = new Uint8Array(arrayBuffer, 0, 4);
            return u8[0] === 0x44 && u8[1] === 0x48
                && u8[2] === 0x41 && u8[3] === 0x56; // "DHAV"
        },

        // DHAV 采样率查找表（索引 → Hz，来自 FFmpeg dhav.c）
        _dhavSampleRates: [8000, 4000, 8000, 11025, 16000, 20000, 22050, 32000, 44100, 48000, 96000, 192000, 64000],

        // 解析 DHAV 帧头扩展区（ext），提取音频参数
        // ext 区域位于固定头（24 字节）之后，长度由 byte[22] 指定
        _parseDHAVExt(view, extStart, extEnd) {
            const result = { channels: 1, sampleRate: 8000 };
            let pos = extStart;
            while (pos + 2 <= extEnd) {
                const tag = view.getUint8(pos);
                const len = view.getUint8(pos + 1);
                if (len === 0 || pos + 2 + len > extEnd) break;
                // tag 0x83 / 0x8c: 音频参数（channels 在 +2，sampleRate index 在 +4）
                if ((tag === 0x83 || tag === 0x8c) && len >= 3) {
                    result.channels = view.getUint8(pos + 2) + 1;
                    if (len >= 5) {
                        const srIdx = view.getUint8(pos + 4);
                        if (srIdx < this._dhavSampleRates.length) {
                            result.sampleRate = this._dhavSampleRates[srIdx];
                        }
                    }
                }
                pos += 2 + len;
            }
            return result;
        },

        // 从 DHAV 容器中提取所有音频帧的负载
        // 帧结构（参考 FFmpeg dhav.c）：
        //   +0:  "DHAV" (4B)
        //   +4:  type (1B, 0xf0=音频)
        //   +5:  subtype (1B)
        //   +6:  channel (1B)
        //   +7:  frame_subnumber (1B)
        //   +8:  frame_number (4B LE)
        //   +12: frame_length (4B LE, 含帧头+负载+帧尾)
        //   +16: date (4B)
        //   +20: timestamp (2B)
        //   +22: ext_length (1B)
        //   +23: padding (1B)
        //   +24: 扩展区 (ext_length 字节)
        //   +24+ext_length: 音频数据
        //   尾部 8B: "dhav" + length
        // 返回 { pcmData, frameCount, sampleRate, channels } 或 null
        stripDHAV(arrayBuffer) {
            if (!this.isDHAV(arrayBuffer)) return null;
            const view = new DataView(arrayBuffer);
            const u8 = new Uint8Array(arrayBuffer);
            const chunks = [];
            let offset = 0;
            let frameCount = 0;
            let sampleRate = 8000;
            let channels = 1;
            const fixedHeaderLen = 24;
            const footerLen = 8;

            while (offset + fixedHeaderLen <= arrayBuffer.byteLength) {
                // 验证帧头 "DHAV"
                if (u8[offset] !== 0x44 || u8[offset + 1] !== 0x48
                    || u8[offset + 2] !== 0x41 || u8[offset + 3] !== 0x56) break;

                const type = u8[offset + 4];
                const frameLen = view.getUint32(offset + 12, true);

                if (frameLen < fixedHeaderLen + footerLen || offset + frameLen > arrayBuffer.byteLength) break;

                // 验证帧尾 "dhav"
                const footerStart = offset + frameLen - footerLen;
                if (u8[footerStart] !== 0x64 || u8[footerStart + 1] !== 0x68
                    || u8[footerStart + 2] !== 0x61 || u8[footerStart + 3] !== 0x76) break;

                // type 0xf0 = 音频帧
                if (type === 0xf0) {
                    const extLen = u8[offset + 22];
                    const audioStart = offset + fixedHeaderLen + extLen;
                    const audioLen = frameLen - fixedHeaderLen - extLen - footerLen;

                    if (audioLen > 0) {
                        // 从扩展区解析音频参数（仅首个有效音频帧）
                        if (frameCount === 0 && extLen > 0) {
                            const ext = this._parseDHAVExt(view, offset + fixedHeaderLen, offset + fixedHeaderLen + extLen);
                            sampleRate = ext.sampleRate;
                            channels = ext.channels;
                        }
                        chunks.push(new Uint8Array(arrayBuffer, audioStart, audioLen));
                        frameCount++;
                    }
                }

                offset += frameLen;
            }

            if (frameCount === 0) return null;

            const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0);
            const result = new Uint8Array(totalBytes);
            let pos = 0;
            for (const chunk of chunks) {
                result.set(chunk, pos);
                pos += chunk.byteLength;
            }

            return { pcmData: result.buffer, frameCount, sampleRate, channels };
        },

        // 检测 32-bit PCM 数据是 Int32 还是 Float32
        // 策略：采样最多 1000 个非零样本，结合值域和指数分布综合判断
        detect32BitFormat(arrayBuffer, endianness) {
            if (!arrayBuffer || arrayBuffer.byteLength < 4) return 'int';
            const isLE = endianness === 'little';
            const view = new DataView(arrayBuffer);
            const totalSamples = Math.floor(arrayBuffer.byteLength / 4);
            if (totalSamples === 0) return 'int';

            // 跳过前导零样本，从第一个非零位置开始检测
            let startIdx = 0;
            for (let i = 0; i < totalSamples; i++) {
                if (view.getUint32(i * 4, isLE) !== 0) { startIdx = i; break; }
                if (i === totalSamples - 1) return 'int'; // 全零数据
            }

            const sampleCount = Math.min(1000, totalSamples - startIdx);
            let floatInRange = 0;
            let floatNonZero = 0;
            let exponentInAudioRange = 0;

            for (let i = 0; i < sampleCount; i++) {
                const offset = (startIdx + i) * 4;
                const raw = view.getUint32(offset, isLE);
                if (raw === 0) { floatInRange++; continue; }
                const f = view.getFloat32(offset, isLE);

                if (isFinite(f) && Math.abs(f) <= 1.5) {
                    floatInRange++;
                }
                if (isFinite(f) && f !== 0) {
                    floatNonZero++;
                    // IEEE 754 指数：真正的 float 音频数据指数通常在 -1 ~ -25 范围
                    // （对应 |value| 在 ~3e-8 到 1.0 之间）
                    const biasedExp = (raw >>> 23) & 0xFF;
                    const exp = biasedExp - 127;
                    if (exp >= -25 && exp <= 0) {
                        exponentInAudioRange++;
                    }
                }
            }

            const nonZeroCount = Math.max(1, floatNonZero);
            const inRangeRatio = floatInRange / sampleCount;
            const expRatio = exponentInAudioRange / nonZeroCount;

            // 值域 >90% 落在 [-1.5, 1.5] 且指数集中在音频范围 → float
            if (inRangeRatio > 0.9 && expRatio > 0.8 && floatNonZero > sampleCount * 0.01) {
                return 'float';
            }

            return 'int';
        },

        // 自动检测 PCM 数据的位深度和格式
        // 返回 { bitDepth, sampleFormat } 或 null（无法判断）
        detectBitDepth(arrayBuffer, endianness) {
            if (!arrayBuffer || arrayBuffer.byteLength < 16) return null;
            const isLE = endianness === 'little';
            const view = new DataView(arrayBuffer);
            const totalBytes = arrayBuffer.byteLength;

            // 找第一个非零字节区域
            const u8 = new Uint8Array(arrayBuffer);
            let nonZeroStart = 0;
            for (let i = 0; i < totalBytes; i++) {
                if (u8[i] !== 0) { nonZeroStart = i; break; }
                if (i === totalBytes - 1) return null;
            }

            // === 32-bit float 检测（特征最明显）===
            const floatResult = this.detect32BitFormat(arrayBuffer, endianness);
            if (floatResult === 'float') {
                return { bitDepth: 32, sampleFormat: 'float' };
            }

            // === 区分 16-bit 与 32-bit int ===
            // 策略1: 按 32-bit float 解读时 NaN/Infinity 的比例
            //   真正的 16-bit 数据按 4 字节解读会产生大量无效浮点数
            //   真正的 32-bit int 数据按 4 字节解读几乎不会产生 NaN
            // 策略2: 按 16-bit 解读时相邻样本大跳变的比例
            //   32-bit 数据按 16-bit 解读，高低字节对交替出现，~40-50% 大跳变
            //   真正 16-bit 音频大跳变比例通常 < 5%

            const start4 = Math.floor(nonZeroStart / 4) * 4;
            const sampleCount4 = Math.min(2000, Math.floor((totalBytes - start4) / 4));
            if (sampleCount4 < 100) return null;

            let nonFiniteCount = 0;
            for (let i = 0; i < sampleCount4; i++) {
                const f = view.getFloat32(start4 + i * 4, isLE);
                if (!isFinite(f)) nonFiniteCount++;
            }
            const nonFiniteRatio = nonFiniteCount / sampleCount4;

            const start2 = Math.floor(nonZeroStart / 2) * 2;
            const sampleCount2 = Math.min(4000, Math.floor((totalBytes - start2) / 2));
            let bigJumps = 0;
            let prev = view.getInt16(start2, isLE) / 32768.0;
            for (let i = 1; i < sampleCount2; i++) {
                const cur = view.getInt16(start2 + i * 2, isLE) / 32768.0;
                if (Math.abs(cur - prev) > 0.5) bigJumps++;
                prev = cur;
            }
            const bigJumpRatio = bigJumps / sampleCount2;

            // 16-bit 数据按 float 解读会产生大量 nonFinite（>5%），
            // 且按 16-bit 解读时跳变少（<10%）→ 判定为 16-bit
            // 32-bit int 数据按 float 解读几乎无 nonFinite（<1%），
            // 且按 16-bit 解读时跳变多（>25%）→ 判定为 32-bit int
            if (nonFiniteRatio < 0.01 && bigJumpRatio > 0.25) {
                return { bitDepth: 32, sampleFormat: 'int' };
            }

            // 无法确定时不改变
            return null;
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

