# LiveTalking (Apache-2.0) built from source. The repository's own Dockerfile is
# outdated (CUDA 11.6 / PyTorch 1.12); this follows its README instead:
# Python 3.12, PyTorch 2.9.1, CUDA 12.8.  UNTESTED here: needs a GPU host.
FROM nvidia/cuda:12.8.0-cudnn-runtime-ubuntu24.04

ARG LIVETALKING_REF=main
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ffmpeg libgl1 libglib2.0-0 python3 python3-venv python3-pip build-essential pkg-config \
      libavdevice-dev libavfilter-dev libopus-dev libvpx-dev libsrtp2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN git clone https://github.com/lipku/LiveTalking.git . \
 && git checkout ${LIVETALKING_REF}

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir torch==2.9.1 torchvision==0.24.1 torchaudio==2.9.1 \
      --index-url https://download.pytorch.org/whl/cu128 \
 && pip install --no-cache-dir -r requirements.txt

EXPOSE 8010
CMD ["python", "app.py"]
