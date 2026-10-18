"""RVC's PyTorch network with frame salience retained, never a replacement F0 estimator."""
from pathlib import Path
import hashlib
import urllib.request

import numpy as np

MODEL_URL = "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.pt"
MODEL_SHA256 = "6d62215f4306e3ca278246188607209f09af3dc77ed4232efdd069798c4ec193"
SAMPLE_RATE = 16000
HOP = 160


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def fetch_model(path: Path) -> None:
    """Explicit download command; inference never downloads assets implicitly."""
    if path.exists():
        if sha256(path) != MODEL_SHA256:
            raise ValueError(f"Existing model has a different SHA256: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    import tempfile

    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
    try:
        with urllib.request.urlopen(MODEL_URL, timeout=60) as response, temporary.open("wb") as output:
            import shutil

            shutil.copyfileobj(response, output)
        if sha256(temporary) != MODEL_SHA256:
            raise ValueError("Downloaded RMVPE checkpoint failed SHA256 verification")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def decode_salience(salience: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """RVC nine-bin local weighted cents decoding; max sigmoid salience is confidence."""
    confidence = salience.max(axis=1)
    centers = salience.argmax(axis=1)
    indices = centers[:, None] + np.arange(-4, 5)
    valid = (indices >= 0) & (indices < 360)
    indices = np.clip(indices, 0, 359)
    weights = np.take_along_axis(salience, indices, axis=1) * valid
    cents = 20 * indices + 1997.3794084376191
    averaged = np.sum(weights * cents, axis=1) / np.maximum(weights.sum(axis=1), 1e-12)
    f0 = 10 * 2 ** (averaged / 1200)
    f0[confidence == 0] = 0
    return f0, confidence


def infer_pitch(audio: np.ndarray, model_path: Path, device: str = "cpu") -> tuple[np.ndarray, np.ndarray]:
    import torch
    from torch.nn import functional as F
    from .vendor.rmvpe import E2E, MelSpectrogram

    if sha256(model_path) != MODEL_SHA256:
        raise ValueError("Use the verified RVC rmvpe.pt checkpoint; SHA256 does not match")
    if device != "cpu" and not device.startswith("cuda"):
        raise ValueError("Supported PyTorch devices are cpu and cuda[:index]")
    torch.set_num_threads(min(torch.get_num_threads(), 4))
    model = E2E(4, 1, (2, 2))
    model.load_state_dict(torch.load(model_path, map_location="cpu", weights_only=True))
    model = model.float().eval().to(device)
    extractor = MelSpectrogram(False, 128, SAMPLE_RATE, 1024, HOP, None, 30, 8000).to(device)
    # Overlapped chunks bound memory. Discard one second of context at each internal seam.
    output = []
    total = int(np.ceil(len(audio) / HOP))
    with torch.inference_mode():
        for start in range(0, total, 2000):
            end = min(total, start + 2000)
            left, right = max(0, start - 100), min(total, end + 100)
            chunk = audio[left * HOP:right * HOP]
            if len(chunk) < 1024:
                chunk = np.pad(chunk, (0, 1024 - len(chunk)))
            tensor = torch.from_numpy(chunk.astype(np.float32)).to(device).unsqueeze(0)
            mel = extractor(tensor, center=True)
            frames = mel.shape[-1]
            hidden = model(F.pad(mel, (0, (-frames) % 32)))[:, :frames]
            output.append(hidden[0, start-left:end-left].cpu().numpy())
    return decode_salience(np.concatenate(output))
