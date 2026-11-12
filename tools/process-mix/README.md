# GBFM mix-processing presets

The standalone `gbpm` CLI is maintained in [OpenSound](https://github.com/planetaryescape/opensound/tree/main/tools/gbpm). GBFM does not compile or publish Rust binaries.

This directory retains GBFM-owned intro audio, cover art and job files:

```text
tools/process-mix/
  assets/covers/
  intro.wav
  jobs/
  output/
```

Install `gbpm` using OpenSound's instructions, then run a local job:

```sh
gbpm --job tools/process-mix/jobs/gb66.json
```

The legacy `install.sh` URL delegates to OpenSound's installer. Before the first OpenSound binary release, build the CLI from the OpenSound source checkout instead. Historical GBFM binary releases remain available; new GBFM application releases do not carry CLI assets.

GBFM jobs supply `introPath`, `album` and `genre` explicitly. The generic binary has no embedded intro or branded defaults. Relative paths are resolved against the job JSON file, so `../intro.wav` retains the existing overlay. Output remains ignored by Git.
