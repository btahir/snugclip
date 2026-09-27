// @snugclip/engine-ffmpeg — the Node Engine over the user's own ffmpeg/ffprobe.
export { FfmpegEngine, type FfOutput, type FfmpegEngineOptions } from './engine.js';
export { detectFfmpeg, installHint, parseList, clearDetectCache, candidates, type FfmpegInfo, type DetectOptions } from './detect.js';
export { mapFfprobe, clockwiseRotation, containerName, parseRate, type FfprobeJson } from './probe-map.js';
export { buildArgs, buildCapabilities, pickEncoders, videoFilter, frameDims, parseProgress, parseSummary, TWO_PASS, type EncoderId } from './encoders.js';
export { run, killAllChildren } from './run.js';
export { compressFiles, planFiles, probeFiles, expandInputs, outputPathFor, VIDEO_EXTENSIONS, type RunnerOptions, type PlanResult, type ProbeResult } from './runner.js';
