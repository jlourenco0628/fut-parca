FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN python3 -m venv /opt/fut-parca-python \
    && /opt/fut-parca-python/bin/pip install --no-cache-dir -r requirements.txt

COPY . ./
RUN mkdir -p /var/data \
    && node --check server.mjs \
    && python3 -m py_compile pdf_report.py

ENV FUT_PARCA_PYTHON=/opt/fut-parca-python/bin/python \
    FUT_PARCA_DATA_PATH=/var/data/fut-parca.sqlite \
    FUT_PARCA_TRUST_PROXY=1

EXPOSE 10000
CMD ["node", "server.mjs"]
