FROM oven/bun:1.3.0-alpine@sha256:37e6b1cbe053939bccf6ae4507977ed957eaa6e7f275670b72ad6348e0d2c11f

WORKDIR /app

# copy root workspace files
COPY package.json bun.lock bunfig.toml tsconfig.base.json /app/

# copy package.json for included package and install dependencies
COPY packages/utils/package.json /app/packages/utils/package.json
COPY apps/operator/package.json /app/apps/operator/package.json
RUN bun install --filter @reside/operator --ignore-scripts

# copy source code
COPY packages/utils/ /app/packages/utils/
COPY apps/operator/ /app/apps/operator/

# set working directory
WORKDIR /app/apps/operator

# final command
CMD ["bun", "src/main.ts"]
