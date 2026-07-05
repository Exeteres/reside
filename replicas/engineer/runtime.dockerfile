RUN apt-get update && apt-get install -y --no-install-recommends \
  rclone \
  && rm -rf /var/lib/apt/lists/*
