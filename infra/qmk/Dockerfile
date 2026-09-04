# Build image for the pinned QMK revision.
#
# claude.md § Build isolation: "Use a trusted, versioned build image matching the
# pinned QMK toolchain. Record its digest with the build."
#
# The QMK source is NOT baked in. It is mounted read-only at /qmk at run time so a
# single verified checkout is shared by every build and can never be mutated
# (docs/adr/0003-generated-keymaps-live-in-an-external-userspace.md).
#
# Base pinned by digest, not tag, so the toolchain cannot drift under us.
FROM qmkfm/qmk_cli@sha256:b7d7fa8fb4432b569931de5ad59098cb788f440ed61a62c5126746b71aee0f4a

# Security refresh of the pinned base. This digest is already upstream's newest
# publication (qmkfm/qmk_cli:1.2.0 == :latest, 2026-03-28), so there is no newer base
# to move to, and it carries fixable HIGH/CRITICAL OS findings that ci-matrix.yml's
# `scan` job gates on. Refreshing here is the only lever that is not "loosen the
# gate", which docs/runbooks/ci-runner.md rules out explicitly.
#
# This does not drift the compiler: the AVR/ARM cross-toolchain in this image is not
# dpkg-managed (`dpkg -l` lists no gcc-avr / arm-none-eabi package), so `apt-get
# upgrade` cannot touch it. What it does move is ~53 Debian 13-updates point releases
# — openssl, gnutls, python3.13, util-linux and friends.
#
# `gh` is the GitHub CLI. Nothing in a firmware build uses it, and after the upgrade
# it is the only remaining source of findings (golang.org/x/mod, no fixed release
# published), so it is removed rather than carried.
#
# The trade-off is deliberate: this layer is not byte-reproducible across rebuilds the
# way the digest-pinned base is. Rebuilds are human-run events recorded in
# infra/qmk/manifest.json's buildImage tag and digest, so what a given build used
# stays exactly identified — see docs/runbooks/ci-runner.md.
USER root
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get -y upgrade \
    && DEBIAN_FRONTEND=noninteractive apt-get -y purge gh \
    && DEBIAN_FRONTEND=noninteractive apt-get -y autoremove --purge \
    && rm -rf /var/lib/apt/lists/*

# Pillow ships in the QMK CLI's uv-managed tool environment (not a declared qmk_cli
# dependency) and is the last non-OS source of fixable HIGH findings.
RUN /opt/uv/tools/qmk/bin/python -m pip install --no-cache-dir --upgrade 'pillow>=12.3.0'

# The container runs unprivileged. UID/GID are fixed so the host can pre-create
# workspace mounts with matching ownership.
ARG BUILDER_UID=2000
ARG BUILDER_GID=2000
RUN groupadd --gid ${BUILDER_GID} builder \
    && useradd --uid ${BUILDER_UID} --gid ${BUILDER_GID} --create-home --shell /usr/sbin/nologin builder

# Catalog extraction runs in this same image so discovery and compilation always
# see one QMK python environment (docs/adr/0002).
COPY extract/extract_catalog.py /opt/qmk-web-app/extract_catalog.py
COPY scripts/container-entrypoint.sh /opt/qmk-web-app/entrypoint.sh
RUN chmod 0555 /opt/qmk-web-app/extract_catalog.py /opt/qmk-web-app/entrypoint.sh

# QMK writes user config into $HOME; give it a writable home that is not the
# read-only source tree.
ENV HOME=/home/builder \
    QMK_HOME=/qmk \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

USER builder
WORKDIR /workspace

ENTRYPOINT ["/opt/qmk-web-app/entrypoint.sh"]
