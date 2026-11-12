# Mix Processing

GBFM uses the standalone [OpenSound gbpm CLI](https://github.com/planetaryescape/opensound/tree/main/tools/gbpm) to prepare audio files before upload. The application does not invoke it, and GBFM releases do not build or distribute Rust binaries.

The CLI reads a job JSON file and uses FFmpeg to produce an MP3 with cover art/metadata, or an MP4 with a still image. FFmpeg must be installed separately.

## GBFM presets

GBFM owns the files under `tools/process-mix/assets/covers/`, `tools/process-mix/intro.wav` and `tools/process-mix/jobs/`. Keep branding here rather than inside the generic binary.

Copy `tools/process-mix/jobs/_template.json`, update the source media paths and tracklist, then run:

```sh
gbpm --job tools/process-mix/jobs/gb66.json
```

All relative paths are resolved against the job file. The presets explicitly set `introPath`, `album` and `genre`; omitting these fields in OpenSound means no intro overlay or branded metadata defaults.

The intro overlays the start of the source audio rather than being prepended. Successful runs print the final output path; generated media stays in the Git-ignored `output/` directory.

## Installation and releases

Use OpenSound's installation/build instructions. The legacy GBFM installer delegates there. An OpenSound binary release must exist before that installer can download a binary; source builds are available from the OpenSound checkout.

Old GBFM release assets are retained, but the GBFM application release pipeline no longer builds or attaches CLI binaries. CLI releases and platform support are maintained independently in OpenSound.
