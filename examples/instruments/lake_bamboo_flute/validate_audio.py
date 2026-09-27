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
    events = [(0.2,52,55,.8),(1.6,59,82,2.8),(5,64,105,.8),(6.6,86,88,.7)]
    runs = [('default',{},events,11)]
    for key,_,lo,hi,_,_ in CONTROLS:
        runs.extend([(key+'_min',{key:lo},events,11),(key+'_max',{key:hi},events,11)])
    runs.append(('velocity',{},[(.2+i*2,62,v,.9) for i,v in enumerate([24,48,80,127])],9))
    runs.append(('retrigger_chord',{},[(.2+i*.125,62,90,.09) for i in range(12)]+
                 [(2.3,n,110,1.2) for n in [62,65,69,72]],6))
    phrase=[(.2,59,72,.85),(1.08,60,87,.25),(1.36,59,82,1.1),
            (2.7,57,93,1.1),(3.84,59,78,.28),(4.16,60,86,.5),
            (4.7,59,70,1.1),(6.2,52,52,.8),(7.2,64,92,.7),
            (8,65,108,.4),(8.5,64,84,1.5)]
    runs.extend([('reference_phrase',{},phrase,12),('original_phrase',{},phrase,12)])
    velocities = [40, 64, 80, 92, 100, 116, 127]
    blowing_notes = [(.2+i*3,59,v,2) for i,v in enumerate(velocities)]
    runs.append(('blowing_dynamics',{},blowing_notes,22))
    runs.append(('blowing_dynamics_no_air',{'flute_breath':0},blowing_notes,22))
    runs.append(('blowing_registers',{},[(.2+i*3,n,v,2) for i,(n,v) in enumerate(
        [(52,92),(52,116),(64,92),(64,116),(76,92),(76,116)])],19))
    connected = [(.2+i*.8,n,v,.8) for i,(n,v) in enumerate(zip(
        [59,62,64,67,65,64,62,59], [50,65,92,116,96,68,100,60]))]
    connected[-1] = (*connected[-1][:3],1.6)
    runs.extend([('legato_phrase',{},connected,9),
                 ('separated_phrase',{},[(t,n,v,d-.08) for t,n,v,d in connected],9)])
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
        code=(HERE/'work/original.orc').read_text() if name=='original_phrase' else orc
        for key,value in settings.items():
            code=re.sub(r'chnset [^,]+, "'+channels[key]+'"',f'chnset {value}, "{channels[key]}"',code)
        source = '1' if name == 'original_phrase' else 'vcs_instr_1'
        code+=f'\nconnect "{source}", "left", "999", "left"\nconnect "{source}", "right", "999", "right"\ninstr 999\naL inleta "left"\naR inleta "right"\nouts aL,aR\nendin\n'
        csd=HERE/'work'/f'{name}.csd';wav=HERE/'auditions'/f'{name}.wav'
        csd.write_text(f'<CsoundSynthesizer>\n<CsOptions>\n-d -m0 -W -f -o{wav} -F{midi}\n</CsOptions>\n<CsInstruments>\n{code}\n</CsInstruments>\n<CsScore>\ni 999 0 {duration}\nf 0 {duration}\ne\n</CsScore>\n</CsoundSynthesizer>')
        result=subprocess.run(['csound',str(csd)],capture_output=True,text=True)
        (HERE/'work'/f'{name}.log').write_text(result.stdout+result.stderr)
        assert result.returncode==0, result.stderr
    dump(HERE/'validation/auditions.json', runs)
    print(f'Rendered {len(runs)} MIDI auditions, including every control extreme and a matched before/after phrase.')


def analyze():
    import numpy as np
    import soundfile as sf
    import librosa
    from scipy.signal import butter, hilbert, sosfiltfilt
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
        assert all(np.sqrt((channel*channel).mean()) > 1e-5 for channel in x.T)
        report.append(dict(name=name,peak_dbfs=peak,tail_dbfs=tail,settings=settings))
        montage.append(x)
        if name=='velocity':
            levels=[db(np.sqrt((x[int((.35+i*2)*sr):int((.95+i*2)*sr)]**2).mean())) for i in range(4)]
            assert all(b>a+2 for a,b in zip(levels,levels[1:])),levels
        if name=='default':
            for start,note,_,length in events:
                data=x[int((start+.16)*sr):int((start+min(length-.03,.5))*sr),0]
                expected=440*2**((note-69)/12)
                # A bamboo flute may have an overtone louder than its fundamental.
                spectrum=abs(np.fft.rfft(data*np.hanning(len(data))))
                frequencies=np.fft.rfftfreq(len(data),1/sr)
                band=(frequencies>expected*.96)&(frequencies<expected*1.04)
                freq=frequencies[band][np.argmax(spectrum[band])]
                assert abs(1200*np.log2(freq/expected))<30,(note,freq)
    def segment(name, start, end):
        x, sr = sf.read(HERE/'auditions'/f'{name}.wav', always_2d=True)
        return x[int(start*sr):int(end*sr), 0]

    def spectrum(name, start=2, end=4.1):
        x = segment(name, start, end)
        power = (abs(librosa.stft(x, n_fft=8192, hop_length=1024))**2).mean(axis=1)
        freq = librosa.fft_frequencies(sr=48000, n_fft=8192)
        fundamental = 440*2**((59-69)/12)
        partials = [power[abs(freq-h*fundamental)<20].sum() for h in range(1, 8)]
        harmonic = np.zeros(len(freq), dtype=bool)
        for h in range(1, 35):
            harmonic |= abs(freq-h*fundamental)<25
        air = power[(freq>700)&(freq<7000)&~harmonic].sum()/power[freq<7000].sum()
        return dict(partials_db=[float(10*np.log10(p/partials[0])) for p in partials],
                    interharmonic_db=float(10*np.log10(air)))

    def pitch_variation(name):
        x = segment(name, 2, 4.1)
        band = sosfiltfilt(butter(3, [205, 290], btype='bandpass', fs=48000, output='sos'), x)
        instantaneous = np.diff(np.unwrap(np.angle(hilbert(band))))*48000/(2*np.pi)
        instantaneous = np.convolve(instantaneous, np.ones(512)/512, 'valid')[2400:-2400]
        return float(np.std(1200*np.log2(instantaneous/(440*2**((59-69)/12)))))

    responses = {}
    for label, interval in [('attack', (.21, .28)), ('release', (4.6, 4.9))]:
        responses[label] = {side: db(np.sqrt((segment(f'flute_{label}_{side}', *interval)**2).mean()))
                            for side in ('min', 'max')}
    responses['breath'] = {side:spectrum('flute_breath_'+side)['interharmonic_db'] for side in ('min', 'max')}
    responses['tone'] = {side:spectrum('flute_tone_'+side)['interharmonic_db'] for side in ('min', 'max')}
    responses['vibrato'] = {side:pitch_variation('flute_vibrato_'+side) for side in ('min', 'max')}
    assert responses['attack']['min'] > responses['attack']['max'] + 6
    assert responses['release']['max'] > responses['release']['min'] + 20
    assert responses['breath']['max'] > responses['breath']['min'] + 10
    assert responses['tone']['max'] > responses['tone']['min'] + 6
    assert responses['vibrato']['max'] > responses['vibrato']['min'] + 4
    comparison = {name:spectrum(name, .4, .8) for name in ('original_phrase','reference_phrase')}
    def mode_measurement(name, start, note, window):
        x = segment(name, start+window[0], start+window[1])
        power = abs(np.fft.rfft(x*np.hanning(len(x))))**2
        frequencies = np.fft.rfftfreq(len(x),1/48000)
        f0 = 440*2**((note-69)/12)
        ground = power[abs(frequencies-f0)<25].sum()
        octave = power[abs(frequencies-2*f0)<25].sum()
        ratio = float(10*np.log10(max(octave,1e-25)/max(ground,1e-25)))
        register = 2 if ratio>0 else 1
        band = np.flatnonzero(abs(frequencies-register*f0)<25)
        index = band[np.argmax(power[band])]
        a,b,c = np.log(np.maximum(power[index-1:index+2],1e-30))
        peak = (index+.5*(a-c)/(a-2*b+c))*48000/len(x)
        assert abs(1200*np.log2(peak/(register*f0)))<30, (name,note,ratio,peak)
        return dict(octave_to_fundamental_db=ratio,dominant_hz=float(peak),dominant_component_harmonic=register)

    def overlap_measurement(name, start, note, window):
        x = segment(name, start+window[0], start+window[1])
        power = abs(librosa.stft(x, n_fft=2048, hop_length=128, center=False))**2
        freq = librosa.fft_frequencies(sr=48000,n_fft=2048)
        f0 = 440*2**((note-69)/12)
        ground = power[abs(freq-f0)<45].sum(axis=0)
        upper = power[abs(freq-2*f0)<45].sum(axis=0)
        ratios = 10*np.log10(np.maximum(upper,1e-25)/np.maximum(ground,1e-25))
        return dict(ratio_p10_p50_p90_db=[float(v) for v in np.percentile(ratios,[10,50,90])],
                    span_db=float(np.percentile(ratios,90)-np.percentile(ratios,10)),
                    ground_dominance_fraction=float(np.mean(ratios<0)))

    dynamics = []
    for i, velocity in enumerate([40,64,80,92,100,116,127]):
        start=.2+i*3
        early=segment('blowing_dynamics',start+.008,start+.037)
        early_tone=segment('blowing_dynamics_no_air',start+.008,start+.037)
        assert db(np.sqrt((early**2).mean())) > -65
        assert db(abs(early_tone).max()) < -100, (velocity,'tone started before air attack')
        attack=mode_measurement('blowing_dynamics',start,59,(.10,.50))
        settled=mode_measurement('blowing_dynamics',start,59,(.95,1.6))
        overlap=overlap_measurement('blowing_dynamics_no_air',start,59,(.10,.60))
        stable=overlap_measurement('blowing_dynamics_no_air',start,59,(.95,1.6))
        if velocity<=64:
            assert attack['octave_to_fundamental_db'] < 0 and settled['octave_to_fundamental_db'] < 0
        elif velocity==80:
            assert settled['octave_to_fundamental_db'] < 0
        elif velocity<=100:
            assert attack['octave_to_fundamental_db'] > settled['octave_to_fundamental_db']+3
            assert settled['octave_to_fundamental_db'] < 0
            assert overlap['span_db'] > 4, (velocity,overlap)
        else:
            assert attack['octave_to_fundamental_db'] > 3 and settled['octave_to_fundamental_db'] > 6
        # The lower component remains measurable, and the strongest blow settles.
        assert settled['octave_to_fundamental_db'] < 35
        if velocity==127:
            assert stable['span_db'] < 3 and overlap['span_db'] > stable['span_db']+3
        dynamics.append(dict(velocity=velocity,air_attack_rms_dbfs=db(np.sqrt((early**2).mean())),
                             early_tone_peak_dbfs=db(abs(early_tone).max()),attack=attack,settled=settled,
                             attack_overlap=overlap,settled_overlap=stable))
    register_checks=[]
    for i,(note,velocity) in enumerate([(52,92),(52,116),(64,92),(64,116),(76,92),(76,116)]):
        start=.2+i*3
        attack=mode_measurement('blowing_registers',start,note,(.10,.50))
        settled=mode_measurement('blowing_registers',start,note,(.95,1.6))
        assert attack['octave_to_fundamental_db'] > settled['octave_to_fundamental_db']+3 if velocity==92 else attack['octave_to_fundamental_db']>3
        assert settled['octave_to_fundamental_db'] < 0 if velocity==92 else settled['octave_to_fundamental_db']>6
        register_checks.append(dict(note=note,velocity=velocity,attack=attack,settled=settled))
    combined=np.concatenate(montage)
    source=HERE/'auditions/Flute_validation.wav';sf.write(source,combined,48000,subtype='FLOAT')
    settings=Settings(n_fft=4096,hop_length=1024,vmin=-95,vmax=-15)
    images=render_images(analyze_audio(combined,48000,settings),settings,source,HERE/'validation')
    # Detailed paired plots use the same analysis scale as the reference recording.
    detail_settings=Settings(n_fft=4096,hop_length=256,fmax=14000)
    for name in ('original_phrase','reference_phrase','blowing_dynamics','blowing_registers','legato_phrase','separated_phrase'):
        path=HERE/'auditions'/f'{name}.wav'
        audio,sr=sf.read(path,always_2d=True)
        images.extend(render_images(analyze_audio(audio,sr,detail_settings),detail_settings,path,HERE/'validation'))
    legato, sr = sf.read(HERE/'auditions/legato_phrase.wav', always_2d=True)
    separated, _ = sf.read(HERE/'auditions/separated_phrase.wav', always_2d=True)
    sf.write(HERE/'auditions/Legato_vs_separated.wav', np.concatenate([legato, np.zeros((24000,2)), separated]), sr, subtype='FLOAT')
    dump(HERE/'validation/audio.json',dict(passed=True,spectrograms_inspected=False,
        patch_sha256=hashlib.sha256((HERE/'Lake_Bamboo_Flute.patch.json').read_bytes()).hexdigest(),
        auditions=report,velocity_rms_dbfs=levels,controller_responses=responses,
        controller_units={'attack':'early RMS dBFS','release':'late RMS dBFS',
                          'breath':'interharmonic power dB relative to total below 7 kHz',
                          'tone':'interharmonic power dB relative to total below 7 kHz',
                          'vibrato':'sustained pitch standard deviation in cents'},
        matched_phrase_comparison=comparison,blowing_dynamics=dynamics,register_checks=register_checks,
        images=[str(p) for p in images],
        listening='Not performed; numerical and visual verification only.'))
    print(json.dumps(report));print([str(p) for p in images])


if __name__=='__main__':
    {'render':render,'analyze':analyze}[sys.argv[1]]()
