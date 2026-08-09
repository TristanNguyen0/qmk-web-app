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
