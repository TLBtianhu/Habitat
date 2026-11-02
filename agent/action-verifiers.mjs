// 动作核验器：只读证据，不重复执行副作用；pending/缺证据不是失败，也不是成功。

export async function voiceSpeakChecks(write, result, { voice }) {
  const utteranceId = result?.utterance?.id || write.data?.refs?.utteranceId;
  if (!utteranceId) return [{ name: 'utterance_accepted', ok: false, evidence: result?.voiceError || 'missing utterance id' }];
  let utterance;
  try { utterance = await voice.getUtterance(utteranceId); }
  catch (error) {
    return [
      { name: 'utterance_accepted', ok: true, evidence: `utterance:${utteranceId}` },
      { name: 'synthesis', ok: null, evidence: null },
      { name: 'playback', ok: null, evidence: null },
    ];
  }
  return [
    { name: 'utterance_accepted', ok: true, evidence: `utterance:${utteranceId}` },
    {
      name: 'synthesis',
      ok: utterance.status === 'ready' ? true : utterance.status === 'error' ? false : null,
      evidence: utterance.status === 'ready' ? `hash:${utterance.hash};bytes:${utterance.bytes || 0}` : utterance.error || utterance.status,
    },
    {
      name: 'playback',
      ok: utterance.playback?.state === 'completed' ? true : utterance.playback?.state === 'failed' ? false : null,
      evidence: utterance.playback ? `${utterance.playback.state}:${utterance.playback.at}` : 'not_observed',
    },
  ];
}

export async function outletStartChecks(write, result, {
  outletStatus,
  readPipeline,
  playlistExists = () => false,
  waitMs = 15000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const instanceId = result?.instanceId || write.data?.refs?.instanceId;
  if (!instanceId) return [{ name: 'accepted', ok: false, evidence: result?.error || 'missing instanceId' }];
  const started = Date.now();
  let status;
  let pipeline = null;
  do {
    status = await outletStatus();
    const current = status.hls || {};
    if (current.instanceId !== instanceId) {
      return [
        { name: 'accepted', ok: true, evidence: `instance:${instanceId}` },
        { name: 'process', ok: null, evidence: 'instance changed or not visible yet' },
      ];
    }
    if (current.state === 'failed') {
      return [
        { name: 'accepted', ok: true, evidence: `instance:${instanceId}` },
        { name: 'process', ok: false, evidence: `state:failed;exit:${current.exitCode}` },
      ];
    }
    try { pipeline = readPipeline(); } catch { pipeline = null; }
    const outputReady = pipeline?.instanceId === instanceId && pipeline.framesOut > 0 && playlistExists();
    if (current.running && outputReady) break;
    if (Date.now() - started >= waitMs) break;
    await sleep(250);
  } while (true);
  const current = status.hls || {};
  const validPipeline = pipeline?.instanceId === instanceId;
  return [
    { name: 'accepted', ok: true, evidence: `instance:${instanceId}` },
    { name: 'process', ok: current.running === true, evidence: `state:${current.state};pid:${current.pid || 0}` },
    { name: 'capture', ok: validPipeline && !!pipeline.captureId ? true : null, evidence: validPipeline ? pipeline.captureId : null },
    {
      name: 'output',
      ok: validPipeline && pipeline.framesOut > 0 && playlistExists() ? true : null,
      evidence: validPipeline ? `frames:${pipeline.framesOut || 0};seq:${pipeline.frameSeq || 0}` : 'stale_or_missing_pipeline_status',
    },
    {
      name: 'audio_capture',
      optional: true,
      ok: validPipeline && !!pipeline.audioCaptureId,
      evidence: validPipeline ? (pipeline.audioCaptureId || 'not_observed') : 'stale_or_missing_pipeline_status',
    },
  ];
}

export async function outletStopChecks(write, result, {
  outletStatus,
  readPipeline,
  desktopCaptures,
  audioStatus,
} = {}) {
  const instanceId = result?.instanceId || write.data?.refs?.instanceId;
  const status = await outletStatus();
  const current = status.hls || {};
  let pipeline = null;
  try { pipeline = readPipeline(); } catch {}
  let desktop = null;
  let audio = null;
  try { desktop = await desktopCaptures(); } catch {}
  try { audio = await audioStatus(); } catch {}
  const pipelineStopped = pipeline?.instanceId === instanceId && pipeline.state === 'stopped' && !pipeline.captureId && !pipeline.audioCaptureId;
  const desktopClosed = Array.isArray(desktop) && !desktop.some((capture) => capture.consumer === 'hls' && capture.instanceId === instanceId);
  const audioClosed = Array.isArray(audio?.captures) && !audio.captures.some((capture) => capture.consumer === 'hls' && capture.instanceId === instanceId);
  return [
    {
      name: 'stop_confirmed',
      ok: result?.stopped === true || result?.alreadyStopped === true,
      evidence: result?.error || `instance:${instanceId};exit:${result?.exitCode ?? 'unknown'}`,
    },
    { name: 'process_stopped', ok: current.running === false, evidence: `state:${current.state};instance:${current.instanceId || 'none'}` },
    { name: 'pipeline_closed', ok: pipelineStopped ? true : null, evidence: pipelineStopped ? 'capture references cleared' : 'pipeline stop evidence unavailable' },
    { name: 'desktop_capture_closed', ok: desktopClosed ? true : null, evidence: desktop ? `captures:${desktop.length}` : null },
    { name: 'audio_capture_closed', ok: audioClosed ? true : null, evidence: audio ? `captures:${audio.captures?.length || 0}` : null },
  ];
}
