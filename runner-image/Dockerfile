FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates wget \
  && install -m 0755 -d /etc/apt/keyrings \
  && wget -q -O /etc/apt/keyrings/acton.asc https://apt.acton-lang.io/acton.gpg \
  && chmod a+r /etc/apt/keyrings/acton.asc \
  && echo "deb [signed-by=/etc/apt/keyrings/acton.asc] http://aptip.acton-lang.io/ tip main" > /etc/apt/sources.list.d/acton.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends acton \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

CMD ["runacton", "main.act"]
