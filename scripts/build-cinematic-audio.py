"""Build sample-based cinematic banks from Kenney CC0 archives (see AUDIO_CREDITS.md).
Usage: python scripts/build-cinematic-audio.py /path/to/audio-source
Requires ffmpeg, NumPy and SciPy. No oscillator-generated sound effects.
The source directory contains scifi/Audio and impacts/Audio from the archives.
"""
import sys, re, json, subprocess, hashlib
from pathlib import Path
import numpy as np
from scipy import signal

ROOT=Path(sys.argv[1]); OUT=Path('public/assets/audio'); OUT.mkdir(parents=True,exist_ok=True)
SR=44100; cache={}
GUN_CUES={'weapon.blaster.fire','weapon.burst.fire','weapon.burst.sub'}

def sample(pack,name,v,rate=1):
    files=sorted((ROOT/pack/'Audio').glob(name+'*.ogg'))
    if not files: raise ValueError((pack,name))
    f=files[v%len(files)]
    if f not in cache:
        data=subprocess.check_output(['ffmpeg','-v','error','-i',str(f),'-ac','1','-ar',str(SR),'-f','f32le','-'])
        x=np.frombuffer(data,dtype='<f4').copy(); active=np.flatnonzero(abs(x)>max(abs(x))*.006)
        if len(active): x=x[max(0,active[0]-44):]
        cache[f]=x
    x=cache[f]
    if rate!=1: x=signal.resample_poly(x,1000,int(rate*1000))
    return x

# Category recipes use actual impacts, engine textures and energy recordings.
# Dry transient + weight + texture + decorrelated room reflections.
def recipe(id):
    # pack, source, rate, amplitude, offset seconds; duration and room wetness
    f=lambda name,rate=1,amp=1,delay=0: ('scifi',name,rate,amp,delay)
    i=lambda name,rate=1,amp=1,delay=0: ('impacts',name,rate,amp,delay)
    if id.startswith('weapon.') or id.startswith('enemy.shot.'):
        if id in GUN_CUES:
            # Pressure crack, low punch and a restrained bolt/clack. No laser
            # or thruster layer: sustained pitched energy reads as buzzing.
            burst=id!='weapon.blaster.fire'
            return [f('explosionCrunch',1.9 if burst else 1.55,.72),
                    i('impactPunch_heavy',.95 if burst else .78,.60),
                    i('impactMetal_light',1.3,.16,.032)],.24 if burst else .36,.025
        if any(s in id for s in ['ready','cycle','reject']):
            return [i('impactPlate_light',.85,.7),f('doorClose',1.3,.22,.035)],.26,.05
        if 'cannon' in id or 'charged.release' in id or 'boss' in id:
            return [f('explosionCrunch',.75,.7),f('lowFrequency_explosion',.7,.8),f('thrusterFire',1,.15,.06)],2.3,.13
        if 'shotgun' in id:
            return [f('explosionCrunch',1.2,.55),i('impactMetal_heavy',.8,.6),f('thrusterFire',1.4,.15)],1.1,.10
        if 'lightning' in id:
            return [f('forceField',.72,.7),i('impactGlass_heavy',1,.15,.02),f('thrusterFire',1.1,.17)],.9,.09
        if any(s in id for s in ['homing','missile']):
            return [f('thrusterFire',1.35,.7),i('impactPlate_medium',.8,.5),f('spaceEngineSmall',1,.1,.08)],1.25,.09
        if 'acid' in id: return [f('slime',.8,.8),f('thrusterFire',1.5,.12)],.8,.08
        if 'bouncer' in id: return [f('forceField',.8,.7),i('impactPlate_medium',.6,.5)],.85,.08
        # Avoid the source library's deliberately retro laser set.
        rapid='burst' in id or 'basic' in id or 'fan' in id
        return [f('laserLarge',.65 if not rapid else .83,.35),i('impactPlate_medium',.7,.65),f('thrusterFire',1.8,.14)],.48 if rapid else .66,.07
    if id.startswith(('impact.','crash.','destroy.','move.')):
        if 'shield' in id or 'nebula' in id:
            return [f('forceField',.65,.7),f('spaceEngineLow',1,.18)],.95 if 'break' in id else .65,.10
        if 'lightning' in id: return [f('forceField',1.2,.7),i('impactGlass_medium',.7,.25)],.65,.09
        if id.startswith('destroy.') or 'explosion' in id:
            if 'glass' in id: return [i('impactGlass_heavy',.75,.8),i('impactMining',.8,.3,.08)],1.2,.14
            if 'metal' in id: return [i('impactMetal_heavy',.65,.7),i('impactPlate_heavy',.8,.4,.1)],1.35,.16
            if 'rock' in id: return [i('impactMining',.7,.85),f('explosionCrunch',1,.32)],1.0,.12
            if 'plastic' in id: return [i('impactPlank_medium',.7,.8),i('impactGeneric_light',.7,.2,.04)],.8,.09
            if 'bubble' in id: return [f('slime',.6,.8),f('forceField',1,.12)],1.05,.10
            major=id in ['destroy.player','destroy.dragon'] or 'heavy' in id or 'kamikaze' in id
            return [f('explosionCrunch',.6 if major else .85,.7),f('lowFrequency_explosion',.65,.65),i('impactMetal_heavy',.65,.3,.16)],2.7 if major else 1.35,.17
        if 'glass' in id: return [i('impactGlass_medium',.78,.85),i('impactPlate_light',1,.15)],.55,.07
        if 'rock' in id or 'shard' in id: return [i('impactMining',.75,.85),i('impactPunch_heavy',.7,.25)],.65,.07
        if 'plastic' in id: return [i('impactPlank_medium',.75,.85)],.4,.06
        if 'player' in id: return [i('impactMetal_heavy',.62,.8),f('lowFrequency_explosion',1.2,.28)],.95,.10
        return [i('impactPlate_medium',.78,.75),i('impactMetal_light',.9,.25,.025)],.55,.07
    if id.startswith(('ui.','poi.module','poi.reject','poi.purchase','poi.sell','poi.scrap')):
        rate=1.25 if any(s in id for s in ['nav','pick','stow']) else .8
        return [i('impactPlate_light',rate,.8),f('doorClose',1.65,.10,.028)],.19 if 'nav' in id else .31,.035
    if id.startswith('pickup.'):
        return [i('impactGlass_light',.8,.5),f('forceField',1.4,.23,.03)],.55 if 'health' in id else .38,.07
    if id in ['poi.dock','poi.undock','poi.repair']:
        return [f('doorOpen' if 'undock' in id else 'doorClose',.72,.85),f('spaceEngineLow',1,.16,.1),i('impactMetal_medium',.8,.18,.42)],1.5,.12
    if id.startswith(('status.','bubble.','snitch.','rival.steal')):
        return [f('slime' if 'bubble' in id or 'corrosion' in id else 'forceField',.7,.65),f('spaceEngineLow',1,.18)],.9,.09
    # Scanner, rift, boss and wave cues: expansive energy/pressure textures,
    # not major-scale arcade jingles.
    major=id in ['boss.death','boss.intro','portal.transit','dragon.arrive']
    return [f('spaceEngineLarge',.8,.45),f('forceField',.55,.4,.04),f('lowFrequency_explosion',.8,.35,.08)],2.8 if major else 1.65,.15

ids=sorted(set(re.findall(r"(?:a\.register|chip|shardBreak|clear)\('([^']+)'",Path('engine/systems/SfxRegistry.ts').read_text())))
banks={k:[] for k in ['weapons','impacts','world','interface']}; manifests={k:{} for k in banks}; offsets={k:0 for k in banks}
for id in ids:
    group='weapons' if id.startswith(('weapon.','enemy.')) else 'impacts' if id.startswith(('impact.','crash.','destroy.')) else 'interface' if id.startswith(('ui.','poi.','pickup.')) else 'world'
    layers,duration,wet=recipe(id)
    for v in range(3):
        n=round(duration*SR); out=np.zeros(n); rng=np.random.default_rng(int.from_bytes(hashlib.sha256((id+str(v)).encode()).digest()[:4],'little'))
        for pack,name,rate,amp,delay in layers:
            x=sample(pack,name,v,rate*(1+(v-1)*.022)); offset=round((delay+(rng.uniform(0,.008) if delay else 0))*SR)
            if id in GUN_CUES:
                # Fast pressure decay and tightly damped metal prevent ringing
                # from accumulating when the three burst rounds overlap.
                decay=(.035 if name=='impactMetal_light' else .045 if 'burst' in id else .070)
                x=x*np.exp(-np.arange(len(x))/(SR*decay))
            length=min(len(x),n-offset)
            if length>0: out[offset:offset+length]+=x[:length]*amp
        # Early reflections spread texture through the tail without a metallic
        # feedback comb; each tap has a different lowpass and delay.
        dry=out.copy()
        for t,g,cut in [(.043,1,2800),(.079,.7,2200),(.131,.5,1700),(.211,.3,1300),(.337,.18,900)]:
            d=round((t+rng.uniform(-.004,.004))*SR)
            if d<n:
                echo=signal.sosfilt(signal.butter(2,cut,fs=SR,output='sos'),dry[:-d])
                out[d:]+=echo*wet*g
        # Body, not piercing digital fizz. Keep real transient texture.
        cutoff=1800 if group=='impacts' else 5200
        out=signal.sosfilt(signal.butter(2,cutoff,fs=SR,output='sos'),out)
        out=signal.sosfilt(signal.butter(2,32,fs=SR,btype='highpass',output='sos'),out)
        out=out if id in GUN_CUES else np.tanh(out*1.2)
        # Remove input latency but retain room/body decay. Length caps are
        # authored per event, not a blanket 250ms crop.
        active=np.flatnonzero(abs(out)>max(abs(out))*.008)
        if len(active): out=np.pad(out[max(0,active[0]-44):],(0,max(0,active[0]-44)))
        attack=min(22 if id in GUN_CUES else 88,len(out)); release=min(round(.065*SR),len(out)//3)
        out[:attack]*=np.linspace(0,1,attack);out[-release:]*=np.linspace(1,0,release)
        peak=max(abs(out));out*=.48/max(peak,1e-6)
        start=offsets[group]; manifests[group].setdefault(id,[]).append([start/SR,len(out)/SR])
        banks[group].append(out.astype('<f4'));banks[group].append(np.zeros(round(.08*SR),dtype='<f4'));offsets[group]+=len(out)+round(.08*SR)

# Seamless, sample-based beds preserve throttle/charge/distance control.
loop_sources = {
    'move.thrust': ('spaceEngineLow', 0.9, 1100),
    'weapon.charge.loop': ('engineCircular', 0.85, 700),
    'portal.idle': ('spaceEngineLow', 0.7, 140),
    'poi.station.idle': ('spaceEngineLarge', 1.0, 650),
    'snitch.near': ('forceField', 0.55, 420),
    'status.disable.loop': ('engineCircular', 0.65, 350),
    'bubble.drain': ('spaceEngineSmall', 0.8, 240),
}
for id,(name,rate,cutoff) in loop_sources.items():
    x=sample('scifi',name,1,rate)
    x=np.tile(x,int(np.ceil(4.2*SR/len(x))))[:round(4.2*SR)]
    x=signal.sosfilt(signal.butter(3,cutoff,fs=SR,output='sos'),x)
    x=signal.sosfilt(signal.butter(2,30,fs=SR,btype='highpass',output='sos'),x)
    # Join end to start over 200ms, then begin playback after that head.
    cross=round(.2*SR); weight=np.linspace(0,1,cross)
    out=np.concatenate([x[cross:-cross],x[-cross:]*(1-weight)+x[:cross]*weight])
    out*=.48/max(max(abs(out)),1e-6)
    start=offsets['world']; manifests['world'][id]=[[start/SR,len(out)/SR]]
    banks['world'].extend([out.astype('<f4'),np.zeros(round(.08*SR),dtype='<f4')]);offsets['world']+=len(out)+round(.08*SR)

manifest=[]
for group,chunks in banks.items():
    raw=np.concatenate(chunks)
    path=OUT/(group+'.mp3')
    subprocess.run(['ffmpeg','-y','-v','error','-f','f32le','-ar',str(SR),'-ac','1','-i','pipe:0','-codec:a','libmp3lame','-b:a','192k',str(path)],input=raw.tobytes(),check=True)
    manifest.append({'file':path.name,'frames':len(raw),'sampleRate':SR,'cues':manifests[group]})
    print(group,round(len(raw)/SR,1),'seconds',path.stat().st_size,'bytes')
Path('engine/systems/CinematicBank.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(len(ids),'IDs,',len(ids)*3,'takes')
