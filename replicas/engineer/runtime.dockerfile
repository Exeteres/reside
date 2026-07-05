RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  ripgrep \
  rclone \
  && curl -fsSL https://github.com/SigNoz/signoz-mcp-server/releases/latest/download/signoz-mcp-server_linux_amd64.tar.gz \
    | tar -xz -C /usr/local/bin --strip-components=2 signoz-mcp-server_linux_amd64/bin/signoz-mcp-server \
  && chmod +x /usr/local/bin/signoz-mcp-server \
  && apt-get purge -y --auto-remove curl \
  && rm -rf /var/lib/apt/lists/*
