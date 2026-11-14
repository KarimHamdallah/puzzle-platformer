"""
Cuts the game's sound effects out of downloaded recordings (kept outside the repo, see the asset list):
  sniper_shot.wav : the loudest Mosin Nagant shot (Gunshot Sounds, Tabasco / Vincent Sevedge, CC-BY 3.0)
  gun_shot.wav    : one short SKS shot, for the machine gun's bursts (same pack)
  bolt.wav        : a rifle reload (Gun reload sounds, SpringySpringo, CC0)

Each clip: mono, starts just before the shot's attack, fades out (cuts the field recording's background
noise), gets some drive (soft saturation) and low end for weight, normalised to -1 dBFS.

Usage: python -I tools/cut_sfx.py <gunshot-sounds dir> <gun-reload dir> <out dir>
"""
import os
import sys
import wave

import numpy as np


def load(path):
    w = wave.open(path)
    rate = w.getframerate()
    ch = w.getnchannels()
    data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    if ch == 2:
        data = data.reshape(-1, 2).mean(axis=1)
    return data, rate


def save(path, data, rate):
    data = np.clip(data, -1, 1)
    w = wave.open(path, 'wb')
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    w.writeframes((data * 32767).astype(np.int16).tobytes())
    w.close()


def envelope(x, rate, ms=4):
    n = max(1, int(rate * ms / 1000))
    return np.convolve(np.abs(x), np.ones(n) / n, mode='same')


def loudest_onset(x, rate):
    """Start of the loudest shot: the first sample before its peak where the envelope rises above 10%."""
    env = envelope(x, rate)
    peak = int(np.argmax(env))
    i = peak
    while i > 0 and env[i] > env[peak] * 0.1:
        i -= 1
    return max(0, i - int(rate * 0.003))


def lowpass(x, rate, hz):
    a = np.exp(-2 * np.pi * hz / rate)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def shape(x, rate, length, tail_from, drive, weight):
    """Cut `length` s, fade from `tail_from` s to the end, add drive + low end, normalise."""
    x = x[:int(length * rate)].copy()
    t = np.arange(len(x)) / rate
    fade = np.where(t < tail_from, 1.0, np.exp(-(t - tail_from) / ((length - tail_from) / 4)))
    x *= fade
    x /= np.max(np.abs(x)) + 1e-9
    y = np.tanh(drive * x) / np.tanh(drive)
    y += weight * lowpass(x, rate, 160)
    y *= fade
    return y / (np.max(np.abs(y)) + 1e-9) * 0.89


def main():
    shots_dir, reload_dir, out = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out, exist_ok=True)

    mosin, rate = load(os.path.join(shots_dir, 'mosin.wav'))
    start = loudest_onset(mosin, rate)
    save(os.path.join(out, 'sniper_shot.wav'), shape(mosin[start:], rate, 1.6, 0.25, 2.2, 0.6), rate)

    sks, rate2 = load(os.path.join(shots_dir, 'sks.wav'))
    start = loudest_onset(sks, rate2)
    save(os.path.join(out, 'gun_shot.wav'), shape(sks[start:], rate2, 0.26, 0.06, 2.6, 0.5), rate2)

    bolt, rate3 = load(os.path.join(reload_dir, 'gunreload1.wav'))
    env = envelope(bolt, rate3)
    first = int(np.argmax(env > np.max(env) * 0.08))
    bolt = bolt[max(0, first - int(rate3 * 0.01)):]
    save(os.path.join(out, 'bolt.wav'), shape(bolt, rate3, min(1.2, len(bolt) / rate3), 0.9, 1.2, 0.0) * 0.8, rate3)


if __name__ == '__main__':
    main()
