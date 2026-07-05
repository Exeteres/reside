RUN apt-get update && apt-get install -y --no-install-recommends \
  ripgrep \
  rclone \
  && rm -rf /var/lib/apt/lists/*
