"""Prepare full-resolution video views for the same image reconstruction engine."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--frames", type=int, default=48)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    args = parser.parse_args()
    video = args.video.resolve(strict=True)
    if args.output.exists() or not 20 <= args.frames <= 100:
        raise ValueError("NEW_OUTPUT_AND_20_TO_100_FRAMES_REQUIRED")
    if video.stat().st_size > 128*1024*1024 or video.suffix.lower() not in {".mp4", ".webm"}:
        raise ValueError("VIDEO_PROFILE_UNSUPPORTED")
    demuxer = "mov" if video.suffix.lower()==".mp4" else "matroska"
    input_args = ["-protocol_whitelist", "file", "-format_whitelist", demuxer, "-i", str(video)]
    result = subprocess.run([args.ffprobe,"-v","error",*input_args,"-show_entries","stream=codec_name,codec_type,width,height,start_time:format=duration","-of","json"], capture_output=True, check=True, timeout=15)
    metadata = json.loads(result.stdout)
    streams = metadata.get("streams", [])
    visual = [stream for stream in streams if stream.get("codec_type")=="video"]
    audio = [stream for stream in streams if stream.get("codec_type")=="audio"]
    if len(visual)!=1 or len(audio)>1 or len(streams)!=len(visual)+len(audio):
        raise ValueError("VIDEO_STREAMS_UNSUPPORTED")
    visual=visual[0]
    allowed = {".mp4": {"h264"}, ".webm": {"vp8", "vp9"}}[video.suffix.lower()]
    duration = float(metadata["format"]["duration"])
    if visual["codec_name"] not in allowed or min(visual["width"],visual["height"])<1080 or max(visual["width"],visual["height"])>4096 or not 1<=duration<=300:
        raise ValueError("VIDEO_CAPTURE_PROFILE_UNSUPPORTED")
    output=args.output.resolve()
    images=output/"images"
    images.mkdir(parents=True)
    report={"schemaVersion":"video-reconstruction-views.v1","status":"PROCESSING","sourceSha256":hashlib.sha256(video.read_bytes()).hexdigest(),"sourceBytes":video.stat().st_size,"durationSeconds":duration,"width":visual["width"],"height":visual["height"],"warnings":["CAPTURE_COVERAGE_UNVERIFIED","SCALE_UNVERIFIED","NO_TRANSCRIPTION"],"frames":[]}
    try:
        subprocess.run([args.ffmpeg,"-nostdin","-v","error","-xerror","-threads","2",*input_args,"-map","0:v:0","-map","0:a?","-f","null","-"],check=True,timeout=90,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        sampled=subprocess.run([args.ffmpeg,"-nostdin","-v","info","-threads","2",*input_args,"-an","-vf",f"setpts=PTS-STARTPTS,select='gte(t,selected_n*{duration/args.frames})',showinfo","-frames:v",str(args.frames),"-fps_mode","passthrough",str(images/"frame-%03d.png")],check=True,timeout=90,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        timestamps=[float(value) for value in re.findall(rb"Parsed_showinfo[^\n]*\bn:\s*\d+[^\n]*\bpts_time:([\d.e+-]+)",sampled.stderr)][:args.frames]
        total=0
        for index,path in enumerate(sorted(images.glob("*.png"))):
            data=path.read_bytes()
            total+=len(data)
            if len(data)>25*1024*1024 or total>1024*1024*1024 or index>=len(timestamps):
                raise ValueError("FRAME_OUTPUT_LIMIT_OR_TIMING_INVALID")
            report["frames"].append({"name":path.name,"timestampSeconds":timestamps[index],"sourceTimestampSeconds":timestamps[index]+float(visual.get("start_time",0)),"sha256":hashlib.sha256(data).hexdigest(),"bytes":len(data)})
        times=[frame["timestampSeconds"] for frame in report["frames"]]
        if not 20<=len(times)<=100 or any(t<0 or t>duration or i>0 and t<=times[i-1] for i,t in enumerate(times)) or times[-1]<duration*.9:
            raise ValueError("INSUFFICIENT_TEMPORAL_COVERAGE")
        if len({frame["sha256"] for frame in report["frames"]})<20:
            raise ValueError("INSUFFICIENT_DISTINCT_VIEWS")
        report["status"]="REVIEW_REQUIRED"
    except Exception as error:
        report["status"]="REJECTED"
        report["failure"]=str(error)
        raise
    finally:
        (output/"video-views.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"status":report["status"],"frames":len(report["frames"]),"output":str(output)}))


if __name__=="__main__":
    main()
