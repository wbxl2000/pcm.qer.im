# PCM 播放疑难案例

## 案例一：DHAV 容器伪装为 PCM

**测试文件**：[dahua.pcm](../dahua.pcm)（8000Hz / 16bit / 单声道）

**现象**：播放出嗒嗒嗒杂音，听不清人声。VLC 可正常播放。

**原因**：文件并非纯 PCM 数据，而是大华（Dahua）监控设备的 **DHAV 私有容器格式**。文件以 `DHAV`（`0x44484156`）魔数开头，内部由多个帧组成，每帧包含帧头、音频负载和 `dhav` 帧尾。直接当 PCM 播放时，帧头/帧尾的二进制数据被当作音频样本，产生杂音。

**帧结构**：

```
[DHAV magic 4B][headerLen 4B LE][...][totalLen 4B LE at +12][...header padding...]
[audio payload: totalLen - headerLen - 8 bytes]
[dhav footer 8B]
```

**解决方式**：播放器自动检测 `DHAV` 魔数，遍历所有帧提取音频负载，拼接为纯 PCM 数据后播放，并自动设置参数为 8000Hz / 16bit / 单声道 / 小端序。

**手动处理**：也可用 ffmpeg 提前转换：

```bash
mv input.pcm input.dav
ffmpeg -i input.dav -vn -acodec pcm_s16le -f s16le output.pcm
```

---

## 案例二：Int32 与 Float32 混淆

**测试文件**：[float.pcm](../float.pcm)（48000Hz / 双声道 / 32bit / 小端序）

**现象**：播放出刺啦刺啦的噪音。

**原因**：文件实际存储的是 **32-bit IEEE Float**（值域 [-1.0, 1.0]），但被当作 **32-bit 有符号整数** 解码。Int32 解码会将浮点位模式解释为上亿的整数值，归一化后得到错误的波形。

**鉴别方法**：取非零区域的 4 字节样本，分别按 Float32 和 Int32 解读：
- Float32 值在 [-1.5, 1.5] 范围内 → 数据是 Float32
- Int32 值在数亿级别 → 数据不是 Int32

**解决方式**：播放器在 32-bit 模式下自动采样数据，跳过前导零区域，统计按 Float32 解读时值域是否合理（>90% 在 [-1.5, 1.5] 内），自动切换为正确的格式。

同时，生成 WAV blob 供波形显示时，Float32 数据使用 `AudioFormat=3`（IEEE Float）而非 `AudioFormat=1`（PCM 整数），避免浏览器解码器误读。
