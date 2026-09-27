"""Analyze public reference downloads; originals remain outside the repository.

Usage: audio-Python compare_recordings.py /tmp/bamboo-flute-comparison
Input filenames and source URLs are documented in README.md. Analysis downmixes
and resamples copies to 22050 Hz; source audio is never modified or redistributed.
"""
import json
from pathlib import Path
import sys
import numpy as np
import librosa
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy.ndimage import gaussian_filter1d
from scipy.signal import periodogram

HERE=Path(__file__).resolve().parent
CACHE=Path(sys.argv[1])
N=1024; HOP=44; SR=22050


def analyze(path,start,end,lo,hi):
    y,_=librosa.load(path,sr=SR,mono=True,offset=max(0,start-.15),duration=end-start+.3)
    S=abs(librosa.stft(y,n_fft=N,hop_length=HOP))**2
    f=librosa.fft_frequencies(sr=SR,n_fft=N)
    t=np.arange(S.shape[1])*HOP/SR+start-.15
    band=np.flatnonzero((f>2*lo)&(f<2*hi))
    idx=band[S[band].argmax(axis=0)]
    a,b,c=[np.log(np.maximum(S[idx+k,np.arange(len(idx))],1e-30)) for k in [-1,0,1]]
    denom=a-2*b+c
    offset=np.divide(.5*(a-c),denom,out=np.zeros_like(denom),where=abs(denom)>1e-12)
    f0=(idx+offset)*SR/N/2
    # Follow the stronger octave ridge, then measure both bands. Wide 90 Hz
    # integration accommodates pitch motion and the 46 ms Hann main lobe.
    bands=np.array([np.sum(S*(abs(f[:,None]-h*f0[None,:])<45),axis=0) for h in [1,2]])
    valid=(t>=start)&(t<=end)
    bands=bands[:,valid];S=S[:,valid];t=t[valid];f0=f0[valid]
    ratio=10*np.log10(np.maximum(bands[1],1e-30)/np.maximum(bands[0],1e-30))
    db=10*np.log10(np.maximum(bands,1e-30));detrend=db-gaussian_filter1d(db,.2*SR/HOP,axis=1)
    fm,ps=periodogram(detrend[1],fs=SR/HOP);mb=(fm>3)&(fm<30)
    peaks=np.argsort(ps[mb])[-3:][::-1]
    row=dict(seconds=[start,end],lower_ridge_median_hz=float(np.median(f0)),
        octave_over_lower_db_p10_p50_p90=np.percentile(ratio,[10,50,90]).tolist(),
        upper_envelope_modulation_peaks_hz=fm[mb][peaks].tolist(),
        detrended_envelope_correlation=float(np.corrcoef(detrend)[0,1]))
    return t,f,S,bands,row


regions=[
 ('Riley Lee: normal ro',CACHE/'unsw_ro.wav',.30,2.3,280,320),
 ('Miki Ex. 1.29: rough transition',CACHE/'miki_techniques.mp3',11.5,13.3,470,560),
 ('Same phrase: settled upper tone',CACHE/'miki_techniques.mp3',13.8,15.8,460,510),
]
fig,axs=plt.subplots(2,3,figsize=(15,7),layout='constrained')
rows=[]
for col,(label,path,start,end,lo,hi) in enumerate(regions):
    t,f,S,B,row=analyze(path,start,end,lo,hi);row.update(label=label,file=path.name);rows.append(row)
    ax=axs[0,col]
    ax.pcolormesh(t,f,10*np.log10(np.maximum(S/S.max(),1e-9)),vmin=-55,vmax=0,cmap='magma',shading='auto',rasterized=True)
    ax.set(ylim=(150,2300),title=label,ylabel='Frequency (Hz)',xlabel='Time in original recording (s)')
    ax=axs[1,col]
    for b,color,title in zip(B,['#1575b8','#cf6b09'],['Lower component','Octave component']):
        ax.plot(t,10*np.log10(np.maximum(b/B.max(),1e-9)),color=color,label=title,lw=1.2)
    ax.set(ylim=(-65,2),ylabel='Band power (dB, relative within excerpt)',xlabel='Time in original recording (s)');ax.grid(alpha=.2)
    ax.legend(fontsize=9,loc='lower left')
fig.suptitle('Bamboo flute: simultaneous components, uneven trading, then upper-register stability',fontsize=15)
fig.savefig(HERE/'reference_comparison.png',dpi=150);plt.close(fig)

flute=HERE.parent
regions=[
 ('Previous patch: nearly exclusive transfer',flute/'revisions/2026-09-26-pressure-switch/auditions/blowing_dynamics.wav'),
 ('Revised patch: overlap and irregular exchange',flute/'auditions/blowing_dynamics.wav'),
]
fig,axs=plt.subplots(2,1,figsize=(12,6),layout='constrained',sharex=True,sharey=True)
for ax,(label,path) in zip(axs,regions):
    t,f,S,B,row=analyze(path,9.25,11.19,235,260);row.update(label=label,file=str(path.relative_to(flute)),midi_note=59,velocity=92);rows.append(row)
    for b,color,title in zip(B,['#1575b8','#cf6b09'],['Played-pitch component','Octave component']):
        ax.plot(t-9.2,10*np.log10(np.maximum(b/B.max(),1e-9)),color=color,label=title,lw=1.4)
    ax.set(ylim=(-70,2),title=label,ylabel='Band power (dB, relative within note)');ax.grid(alpha=.2);ax.legend(loc='lower right')
axs[-1].set_xlabel('Seconds after note-on — B3, MIDI velocity 92, held for 2 seconds')
fig.savefig(HERE/'patch_comparison.png',dpi=150);plt.close(fig)
(HERE/'comparison_measurements.json').write_text(json.dumps(dict(
    method=dict(sample_rate=SR,hann_samples=N,hop_samples=HOP,band_half_width_hz=45,amplitude_normalization='Plots only, one shared reference per excerpt',caveat='Harmonic-band energy does not uniquely identify oscillation modes or player technique.'),segments=rows),indent=2)+'\n')
print('Wrote reference_comparison.png, patch_comparison.png and comparison_measurements.json')
