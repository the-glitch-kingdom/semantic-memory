# Manifest tooling notes

- Added scan_manifests.py to the manifest tooling. It checks that each deployment manifest lists only approved images.
- It prints one line per problem and a summary at the end.
- Exits non-zero when it finds a manifest with an unapproved image.
