# Docker Image Publishing and Retention

The repository publishes its root `Dockerfile` to GitHub Container Registry (GHCR). Each release image supports `linux/amd64` and `linux/arm64`; Docker selects the appropriate platform when pulling it.

## Publish a Release

Merge both workflow files into the default branch before publishing the first tag. GitHub runs the tag workflow from the tagged commit, and the cleanup workflow must exist on the default branch for its completion and scheduled triggers to work.

Push a new tag that contains the workflows, for example:

```bash
git tag v1.2.3
git push origin v1.2.3
```

The [Publish Docker image workflow](../.github/workflows/docker-publish.yml) builds both platforms with QEMU and Docker Buildx, then publishes:

- `ghcr.io/thomassresearch/orchestron:v1.2.3`
- `ghcr.io/thomassresearch/orchestron:latest`

Every pushed Git tag is eligible, including prerelease tags. `latest` follows the last successfully published build, including prereleases; it does not select the highest semantic version. Tag names are preserved when valid Docker tags; Docker's metadata action replaces unsupported characters such as `/` with `-`. Prefer Docker-compatible release tags such as `v1.2.3` to avoid naming collisions. Tag deletion does not publish an image.

The image namespace is derived from the lowercase GitHub repository name, so a fork publishes to its own GHCR package. Both workflows use the built-in `GITHUB_TOKEN`; no Docker Hub account or registry password secret is needed.

## Pull and Run

```bash
docker pull ghcr.io/thomassresearch/orchestron:latest
docker volume create orchestron_data
docker run --rm --name orchestron \
  -p 8000:8000 \
  -e VISUALCSOUND_DEFAULT_RTMIDI_MODULE=null \
  -v orchestron_data:/app/backend/data \
  ghcr.io/thomassresearch/orchestron:latest
```

Open `http://localhost:8000/client`. Replace `latest` with a retained release tag to use that release. For external MIDI and local Compose builds, see the [Docker installation guide](../INSTALL.docker.md).

GHCR initially creates packages with private visibility. To allow anonymous pulls, change the package visibility to public in its GitHub package settings. For private images, authenticate Docker to GHCR with an account that has package read access.

## Keep the Two Newest Images

The [Clean up Docker images workflow](../.github/workflows/docker-cleanup.yml) runs after a successful publish, daily at 03:23 UTC, and manually from the repository's Actions tab. Failed or canceled publishing runs do not trigger deletion through the completion event.

Cleanup keeps the two newest tagged image versions by GHCR's last-updated timestamp, rather than sorting their tag names. Multiple tags pointing to the same image, such as `v1.2.3` and `latest`, count as one image. Older tagged images and unreferenced untagged images are deleted. Architecture and attestation manifests needed by either retained image are preserved, including manifests shared with older images. The package UI can therefore show more than two manifest entries even though only two release images remain. Git tags and GitHub releases are unaffected.

Publishing and cleanup share a concurrency group with `queue: max`, so cleanup cannot delete uploads while these workflows are publishing. GitHub permits up to 100 pending runs in that group. Keep other publishers of this package under the same lock to avoid races.

To preview cleanup, select **Clean up Docker images → Run workflow** and leave **Preview deletions without removing images** enabled. Disable it to apply cleanup manually. Automatic runs apply cleanup. The action also checks retained multi-platform manifests and reports missing children as warnings in the workflow log.

## GitHub Permissions

Publishing requests `contents: read` and `packages: write`; cleanup requests `packages: write`. Repository or organization policy must permit those workflow permissions and the actions referenced by the workflows. All action references are pinned to commit SHAs.

The repository must have **Admin** access to the container package for deletion. Packages first published by this repository's `GITHUB_TOKEN` normally grant that access automatically. For an existing or manually created package, check **Package settings → Manage Actions access** and grant this repository **Admin** access. The source label on published images links the package to the repository.

If cleanup fails with a permission error, check that package access before rerunning it. GitHub also restricts deletion of public package versions with more than 5,000 downloads; such versions may require GitHub Support and cannot always be removed automatically.

## References

- [Docker multi-platform GitHub Actions builds](https://docs.docker.com/build/ci/github-actions/multi-platform/)
- [GHCR cleanup action and retention rules](https://github.com/dataaxiom/ghcr-cleanup-action)
- [GitHub package deletion permissions](https://docs.github.com/en/packages/learn-github-packages/deleting-and-restoring-a-package)
- [GitHub workflow concurrency queues](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
