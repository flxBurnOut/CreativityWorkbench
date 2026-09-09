import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { ServiceError } from './errors.mjs';
import { shotSource, audioSource, composeSource, validateVideo } from './output-contract.mjs';

export function mediaCommand(binary, args, { signal, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, signal, windowsHide: true, shell: false, stdio: ['ignore','pipe','pipe'] });
    let out = '', err = ''; const timer = setTimeout(() => child.kill(), 180000);
    child.stdout.on('data', b => { if (out.length < 200000) out += b; });
    child.stderr.on('data', b => { err = (err + b).slice(-20000); });
    child.on('error', () => { clearTimeout(timer); reject(new ServiceError(503, 'media_unavailable', '视频处理程序无法启动或已取消，请检查 FFmpeg 配置。')); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(out); else reject(new ServiceError(400, 'invalid_media', '音视频无法处理，请检查文件、时长或字幕字体。' + (err.includes('No such filter') ? ' 当前 FFmpeg 缺少必要滤镜。' : ''))); });
  });
}
const binaries = env => ({ encoder: env.FFMPEG_PATH || ffmpegPath, probe: env.FFPROBE_PATH || ffprobe.path });
export async function withMediaDirectory(repository, action) {
  await repository.initialize();
  const base = resolve(repository.root, 'render'); const dir = join(base, randomUUID()); await mkdir(dir);
  try { return await action(dir); }
  finally { const target = resolve(dir); if (target.startsWith(base + sep) && target !== base) await rm(target, { recursive: true, force: true }); }
}
export async function probeMedia(path, { env = process.env, signal } = {}) {
  const value = await mediaCommand(binaries(env).probe, ['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',path], { signal });
  const data = JSON.parse(value); const video = data.streams?.find(s => s.codec_type === 'video');
  const duration = Number(data.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 125 || (video && (!video.width || !video.height || video.width * video.height > 3840 * 2160))) throw new ServiceError(400, 'invalid_media', '媒体须在 120 秒左右以内，分辨率不得超过 4K。');
  return { duration, width: video?.width, height: video?.height, videoCodec: video?.codec_name, audio: data.streams?.some(s => s.codec_type === 'audio') || false };
}
export async function importMedia(bytes, kind, repository, options = {}) {
  const video = kind === 'mp4';
  if (!Buffer.isBuffer(bytes) || bytes.length > 128 * 1024 * 1024 || bytes.length < 12 || (video ? bytes.toString('ascii',4,8) !== 'ftyp' : !(bytes.toString('ascii',0,4) === 'RIFF' || bytes.toString('ascii',0,3) === 'ID3' || bytes[0] === 0xff || bytes.toString('ascii',4,8) === 'ftyp'))) throw new ServiceError(400, 'invalid_media', '请选择有效 MP4 视频或 WAV / MP3 / M4A 音频，文件小于 128 MB。');
  return withMediaDirectory(repository, async dir => {
    const input = join(dir, 'input.bin'); await writeFile(input, bytes); const info = await probeMedia(input, options);
    if (video ? !info.videoCodec : !info.audio) throw new ServiceError(400, 'invalid_media', '文件没有所需的视频或音频轨道。');
    const output = join(dir, 'result.' + kind);
    await mediaCommand(binaries(options.env || process.env).encoder, ['-nostdin','-v','error','-xerror','-protocol_whitelist','file,pipe','-i',input,...(video ? ['-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart'] : ['-map','0:a:0','-vn','-ac','2','-ar','48000','-c:a','pcm_s16le']),'-fs','134217728',output], { signal: options.signal });
    const decoded = await probeMedia(output, options);
    if (Math.abs(decoded.duration-info.duration)>0.25) throw new ServiceError(400,'invalid_media','媒体实际解码时长与原文件不一致，或规范化文件超过容量，请检查原文件。');
    const stored = await repository.putOutput(await readFile(output), kind); return { ...stored, ...decoded, source: '用户导入文件' };
  });
}
const stamp = sec => { const ms = Math.round(sec * 1000); return [Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60].map(n => String(n).padStart(2,'0')).join(':') + ',' + String(ms%1000).padStart(3,'0'); };
export function subtitles(shots) { let time = 0, count = 0; return shots.map(s => { const start = time; time += s.duration; return s.subtitle.trim() ? `${++count}\n${stamp(start)} --> ${stamp(time)}\n${s.subtitle.replace(/\r/g,'').replace(/\n\s*\n/g,'\n').replace(/[<>]/g,'')}\n` : ''; }).filter(Boolean).join('\n'); }
export async function composeVideo(task, repository, options) {
  const v = validateVideo(task.snapshot.video);
  const warnings = [];
  if (!v.shots.length) throw new ServiceError(400,'invalid_input','请先生成并采用分镜。');
  for (const s of v.shots) {
    if (!s.clip || s.clip.source !== shotSource(s,v.ratio,task.snapshot)) throw new ServiceError(400,'stale_clip',`镜头「${s.title}」缺少当前依据的视频（含文化、美术与首帧）；历史文件仍保留，请核对后生成或重新导入。`);
    if (s.narration.trim() && (!s.audio || s.audio.source !== audioSource(s,task.snapshot))) throw new ServiceError(400,'missing_audio',`镜头「${s.title}」需要匹配当前旁白、声音要求与时长的配音文件，可通过 WorkBuddy 生成或导入。`);
  }
  return withMediaDirectory(repository, async dir => {
    const encode = (args) => mediaCommand(binaries(options.env).encoder,['-nostdin','-v','error',...args],{ signal: options.signal, cwd: dir });
    const [w,h] = v.ratio === '9:16' ? [720,1280] : [1280,720];
    for (let i = 0; i < v.shots.length; i++) {
      const s = v.shots[i]; const input = `input-${i}.mp4`; await writeFile(join(dir,input), await repository.output(s.clip.fileId));
      const clip = await probeMedia(join(dir,input),options);
      if (clip.duration + 0.15 < s.duration) throw new ServiceError(400,'short_clip',`镜头「${s.title}」实际只有 ${clip.duration.toFixed(1)} 秒，请缩短分镜时长或重新生成。`);
      if (clip.duration > s.duration + 0.15) warnings.push(`镜头「${s.title}」原片 ${clip.duration.toFixed(1)} 秒，合成按分镜从开头截取 ${s.duration} 秒；原片仍保留。`);
      const inputs = ['-protocol_whitelist','file,pipe','-i',input]; let audioMap; let audioFilter;
      if (s.audio && s.narration.trim()) {
        const name=`audio-${i}.wav`; await writeFile(join(dir,name), await repository.output(s.audio.fileId));
        const audio = await probeMedia(join(dir,name),options);
        if (audio.duration > s.duration + 0.05) throw new ServiceError(400,'long_audio',`镜头「${s.title}」的配音超过镜头时长，请缩短旁白或延长镜头。`);
        inputs.push('-i',name); audioMap='1:a:0';
        if (v.keepAudio && clip.audio) { audioFilter='[0:a]volume=0.35[original];[original][1:a]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95,apad[mixed]'; audioMap='[mixed]'; }
      } else if (v.keepAudio && clip.audio) audioMap='0:a:0';
      else { inputs.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo'); audioMap='1:a:0'; }
      await encode([...inputs,...(audioFilter?['-filter_complex',audioFilter]:[]),'-map','0:v:0','-map',audioMap,'-vf',`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p`,...(audioFilter?[]:['-af','apad']),'-t',String(s.duration),'-c:v','libx264','-preset','fast','-crf','20','-c:a','aac','-ar','48000','-ac','2',`part-${i}.mp4`]);
    }
    await writeFile(join(dir,'concat.txt'),v.shots.map((_,i)=>`file 'part-${i}.mp4'`).join('\n'));
    await encode(['-f','concat','-safe','1','-i','concat.txt','-c','copy','joined.mp4']);
    const srt = subtitles(v.shots); await writeFile(join(dir,'captions.srt'),srt);
    const duration = v.shots.reduce((n,s)=>n+s.duration,0); const inputs=['-i','joined.mp4'];
    if (v.music) { await writeFile(join(dir,'music.wav'),await repository.output(v.music.fileId)); inputs.push('-stream_loop','-1','-i','music.wav'); }
    const filters=[];
    if (v.music) filters.push('[1:a]volume=0.15[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]');
    if (v.burnSubtitles && srt) filters.push("[0:v]subtitles=captions.srt:force_style='Fontname=Microsoft YaHei,Fontsize=22,Outline=1,MarginV=30'[v]");
    await encode([...inputs,...(filters.length?['-filter_complex',filters.join(';')]:[]),'-map',v.burnSubtitles&&srt?'[v]':'0:v','-map',v.music?'[a]':'0:a','-t',String(duration),'-c:v',v.burnSubtitles&&srt?'libx264':'copy',...(v.burnSubtitles&&srt?['-preset','fast','-crf','20']:[]),'-c:a','aac','-movflags','+faststart','final.mp4']);
    const result = await repository.putOutput(await readFile(join(dir,'final.mp4')),'mp4');
    const caption = await repository.putOutput(Buffer.from(srt),'srt');
    return { warnings, videoFinal: { ...result, subtitleFileId: caption.fileId, duration, source: composeSource(v,task.snapshot), taskId: task.id } };
  });
}
