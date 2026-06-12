FROM oven/bun:1.3.10 AS runtime

# install base dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  ca-certificates \
  curl \
  git \
  gnupg \
  tar \
  xz-utils \
  && rm -rf /var/lib/apt/lists/*

# install kubectl and helm
RUN set -eux; \
  KUBECTL_VERSION="$(curl -fsSL https://dl.k8s.io/release/stable.txt)"; \
  curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl; \
  chmod +x /usr/local/bin/kubectl; \
  curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-4 | bash

# install node.js (yes) for github copilot sdk
RUN curl https://nodejs.org/dist/v24.14.0/node-v24.14.0-linux-x64.tar.xz -o node.tar.xz && \
  tar -xf node.tar.xz -C /usr/local --strip-components=1 && \
  rm node.tar.xz

# install nix
RUN curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | \
  sh -s -- install linux --init none --no-confirm --extra-conf "trusted-users = $(whoami)"

ENV PATH="/root/.nix-profile/bin:/nix/var/nix/profiles/default/bin:${PATH}"

# install devenv for project-local tooling in engineer workspaces
RUN nix profile install \
  --extra-experimental-features 'nix-command flakes' \
  --accept-flake-config \
  github:cachix/devenv/latest

# prefetch the project devenv shell closure so engineer runtime containers do not
# download common tooling on the first project command.
WORKDIR /opt/reside-devenv-cache
COPY devenv.nix devenv.yaml devenv.lock bun.lock ./
RUN devenv shell -- true
