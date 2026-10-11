# Build the browser target, then serve it. Two stages: the toolchain layer is
# large and changes rarely, so Docker caches it and a page-only change rebuilds
# in seconds. The runner has no toolchain of its own -- jobs run in a
# node:20-bookworm container -- so everything the build needs is installed here.
#
# Build from the repository root:
#   docker build -f tools/deploy/Dockerfile -t melee-web:<sha> .

FROM debian:bookworm AS build

# disc_lower.cpp is built against LLVM 22's LibTooling. It rewrites
# scalar_storage_order("big-endian") struct access into explicit byte-swapped
# loads and stores; Clang does not implement that attribute and there is no GCC
# for wasm, so this pass is how the game code compiles at all. GCC is the
# lowering oracle: test_disc_lower.py requires identical values and bytes
# natively and as wasm.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg lsb-release make ninja-build \
      python3 python3-venv xz-utils gcc g++ \
 && curl -fsSL https://apt.llvm.org/llvm.sh -o /tmp/llvm.sh \
 && bash /tmp/llvm.sh 22 \
 && apt-get install -y --no-install-recommends \
      libclang-22-dev libclang-cpp22-dev llvm-22-dev \
 && rm -rf /var/lib/apt/lists/* /tmp/llvm.sh

# CMakeLists.txt requires 3.25. Bookworm ships 3.25.1, but pin the version so a
# base image update cannot move it.
ARG CMAKE_VERSION=3.31.6
RUN curl -fsSL "https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/cmake-${CMAKE_VERSION}-linux-x86_64.tar.gz" \
    | tar -xz -C /usr/local --strip-components=1

ENV LLVM_ROOT=/usr/lib/llvm-22
ENV MELEE_EMSDK=/opt/emsdk

# The pinned SDK comes from tools/browser/common.py. Copy only what the install
# reads, so a source change does not invalidate this layer.
COPY tools/browser/common.py tools/browser/setup_sdk.py /src/tools/browser/
WORKDIR /src
RUN python3 tools/browser/setup_sdk.py

COPY . /src
RUN python3 tools/browser/build.py --jobs "$(nproc)"

# serve.mjs imports only node builtins, so the serving stage needs no install
# step and no package manifest.
FROM node:22-alpine

WORKDIR /app
COPY tools/browser/serve.mjs tools/browser/signal.mjs ./tools/
COPY --from=build /src/build/browser/runtime/platforms/browser/ ./dist/

# Record what is served. A page that cannot name its own commit cannot be told
# apart from a stale one, which is how a dead link survived on the board.
ARG GIT_COMMIT=unknown
ARG GIT_BRANCH=unknown
RUN printf '{\n  "commit": "%s",\n  "branch": "%s"\n}\n' "$GIT_COMMIT" "$GIT_BRANCH" > ./dist/deployed.json

# Bind every interface inside the container. The published port stays on the
# host loopback, and the tailnet proxy is the only thing in front of it.
ENV MELEE_BIND=0.0.0.0
ENV PORT=8099
EXPOSE 8099

USER node
CMD ["node", "tools/serve.mjs", "dist"]
