"""Render with repository Python; analyze/plot with the patch skill audio Python."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from build_flute import CONTROLS, HERE, ROOT, dump


def render():
    import mido
    orc = (HERE/'work/flute.orc').read_text()
    channels = {c[0]: re.search(r'i_'+c[0]+r'_iout_\d+ chnget "([^"]+)"', orc)[1] for c in CONTROLS}
    events = [(0.2,57,55,.6),(1.4,62,82,1.4),(3.4,69,105,.8),(5,86,88,.7)]
    runs = [('default',{},events,8)]
    for key,_,lo,hi,_,_ in CONTROLS:
        runs.extend([(key+'_min',{key:lo},events,8),(key+'_max',{key:hi},events,8)])
    runs.append(('velocity',{},[(.2+i*2,62,v,.9) for i,v in enumerate([24,48,80,127])],9))
    runs.append(('retrigger_chord',{},[(.2+i*.125,62,90,.09) for i in range(12)]+
                 [(2.3,n,110,1.2) for n in [62,65,69,72]],6))
    (HERE/'auditions').mkdir(exist_ok=True)
    for name,settings,notes,duration in runs:
        mid=mido.MidiFile(ticks_per_beat=480);track=mido.MidiTrack();mid.tracks.append(track)
        track.append(mido.MetaMessage('set_tempo',tempo=500000))
        seq=[]
        for start,note,velocity,length in notes:
            seq += [(round(start*960),1,note,velocity),(round((start+length)*960),0,note,0)]
        last=0
        for time,on,note,velocity in sorted(seq):
            track.append(mido.Message('note_on' if on else 'note_off',note=note,velocity=velocity,channel=0,time=time-last));last=time
        track.append(mido.MetaMessage('end_of_track',time=max(0,round(duration*960)-last)))
        midi=HERE/'work'/f'{name}.mid';mid.save(midi)
        code=orc
        for key,value in settings.items():
            code=re.sub(r'chnset [^,]+, "'+channels[key]+'"',f'chnset {value}, "{channels[key]}"',code)
        code+='\nconnect "1", "left", "999", "left"\nconnect "1", "right", "999", "right"\ninstr 999\naL inleta "left"\naR inleta "right"\nouts aL,aR\nendin\n'
        csd=HERE/'work'/f'{name}.csd';wav=HERE/'auditions'/f'{name}.wav'
        csd.write_text(f'<CsoundSynthesizer>\n<CsOptions>\n-d -m0 -W -f -o{wav} -F{midi}\n</CsOptions>\n<CsInstruments>\n{code}\n</CsInstruments>\n<CsScore>\ni 999 0 {duration}\nf 0 {duration}\ne\n</CsScore>\n</CsoundSynthesizer>')
        result=subprocess.run(['csound',str(csd)],capture_output=True,text=True)
        (HERE/'work'/f'{name}.log').write_text(result.stdout+result.stderr)
        assert result.returncode==0, result.stderr
    dump(HERE/'validation/auditions.json', runs)
    print('Rendered 13 MIDI auditions, including every control extreme.')


def analyze():
    import numpy as np
    import soundfile as sf
    sys.path.insert(0,str(ROOT/'integrations/skills/orchestron-patch-creator/scripts'))
    from render_spectrograms import Settings, analyze_audio, render_images
    report=[];montage=[]
    db=lambda x:float(20*np.log10(max(float(x),1e-12)))
    for name,settings,events,duration in json.loads((HERE/'validation/auditions.json').read_text()):
        x,sr=sf.read(HERE/'auditions'/f'{name}.wav',always_2d=True)
        assert sr==48000 and x.shape[1]==2 and np.isfinite(x).all()
        peak=db(abs(x).max());tail=db(abs(x[-4800:]).max())
        assert peak < -1 and tail < -75 and db(np.sqrt((x*x).mean())) > -65
        assert abs(x.mean())<.001
        report.append(dict(name=name,peak_dbfs=peak,tail_dbfs=tail,settings=settings))
        montage.append(x)
        if name=='velocity':
            levels=[db(np.sqrt((x[int((.35+i*2)*sr):int((.95+i*2)*sr)]**2).mean())) for i in range(4)]
            assert all(b>a+2 for a,b in zip(levels,levels[1:])),levels
        if name=='default':
            for start,note,_,length in events:
                data=x[int((start+.16)*sr):int((start+min(length-.03,.5))*sr),0]
                freq=np.fft.rfftfreq(len(data),1/sr)[np.argmax(abs(np.fft.rfft(data*np.hanning(len(data)))))]
                expected=440*2**((note-69)/12)
                assert abs(1200*np.log2(freq/expected))<30,(note,freq)
    combined=np.concatenate(montage)
    source=HERE/'auditions/Flute_validation.wav';sf.write(source,combined,48000,subtype='FLOAT')
    settings=Settings(n_fft=4096,hop_length=1024,vmin=-95,vmax=-15)
    images=render_images(analyze_audio(combined,48000,settings),settings,source,HERE/'validation')
    dump(HERE/'validation/audio.json',dict(passed=True,spectrograms_inspected=False,
        patch_sha256=hashlib.sha256((HERE/'Lake_Bamboo_Flute.patch.json').read_bytes()).hexdigest(),
        auditions=report,velocity_rms_dbfs=levels,images=[str(p) for p in images],
        listening='Not performed; numerical and visual verification only.'))
    print(json.dumps(report));print([str(p) for p in images])


if __name__=='__main__':
    {'render':render,'analyze':analyze}[sys.argv[1]]()
