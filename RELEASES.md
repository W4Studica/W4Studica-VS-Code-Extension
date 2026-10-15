# GitHub Release Binary Contract (schemaVersion 1 / 2)

This document defines the file format shared by the extension and its published releases. Attach each component's ZIP and `w4studica.json` to the corresponding **GradleRIO and allwpilib repositories**. Do not use GitHub's automatically generated source archives.

The two manifests must have the same `wpilibVersion`. The `version` is the component's actual Maven version and must exactly match the version in its Maven repository. Use a pinned version that distinguishes it from upstream (for example, `2027.0.0-alpha-7-w4.1`). Never replace a ZIP for a version that has already been published; publish a new version instead.

## GradleRIO repository

```json
{
  "schemaVersion": 1,
  "component": "gradlerio",
  "version": "2027.0.0-alpha-7-w4.1",
  "wpilibVersion": "2027.0.0-alpha-7-w4.1",
  "archive": "w4studica-gradlerio-2027.0.0-alpha-7-w4.1.zip",
  "sha256": "64-character SHA-256 of the ZIP file",
  "mavenPath": "maven"
}
```

Include GradleRIO's JARs, POMs, Gradle module metadata, and **plugin marker POM** in the ZIP's `maven/` directory.

```text
maven/org/wpilib/GradleRIO/<version>/...
maven/org/wpilib/GradleRIO/org.wpilib.GradleRIO.gradle.plugin/<version>/...
```

Include the plugin's transitive dependencies in the same Maven repository, or download them from public repositories during the first offline-save operation.

## allwpilib repository

```json
{
  "schemaVersion": 1,
  "component": "allwpilib",
  "version": "2027.0.0-alpha-7-w4.1",
  "wpilibVersion": "2027.0.0-alpha-7-w4.1",
  "archive": "w4studica-allwpilib-2027.0.0-alpha-7-w4.1.zip",
  "sha256": "64-character SHA-256 of the ZIP file",
  "mavenPath": "maven",
  "vmxScript": "vmx.gradle"
}
```

```text
maven/                         # WPILib Java/JNI/C++ headers and binaries, POMs, module metadata
vmx.gradle                     # copied from release/vmx.gradle by the packaging tool
vmx/include/                   # public VMX extension and Studica API headers (preserve directory structure)
vmx/linuxarm64/
  libhalsim_vmx.so
  libhalsim_vmxd.so             # for the debug HAL; kept separate to avoid loading a second HAL
  libhalsim_vmx_studica.so
  libstudica_drivers.so
  ...                          # any additional required runtime .so files
```

Include artifacts for SystemCore, linuxarm64, and the development computer's desktop platform in `maven/`. The extension routes only WPILib group `org.wpilib` and its subgroups at the manifest's `wpilibVersion` exclusively to this repository. This prevents a missing WPILib module from silently falling back to upstream. External dependencies such as OpenCV retain their own versions and are downloaded during the first offline-save operation.

`vmx.gradle` deploys the prebuilt extension, backend, and shared Studica libraries, and links the prebuilt library for C++. The same runtime is deployed for Java. Fetch `libvmxpi_hal_cpp.so` and `VMXPi.h` from the SDK on the robot image; do not include them in the ZIP. Build the binaries and headers against the WPILib release and pinned robot image so their ABIs match. Include existing source and third-party license notices required for public distribution.

## Packaging already-built outputs

Use the standard-library-only Python tool in the extension repository. It does not compile code or upload anything to GitHub.

```sh
python3 tools/package_release.py gradlerio \
  --version 2027.0.0-alpha-7-w4.1 \
  --wpilib-version 2027.0.0-alpha-7-w4.1 \
  --maven /path/to/published-gradlerio-maven \
  --output /path/to/output/gradlerio

python3 tools/package_release.py allwpilib \
  --version 2027.0.0-alpha-7-w4.1 \
  --wpilib-version 2027.0.0-alpha-7-w4.1 \
  --maven /path/to/published-allwpilib-maven \
  --vmx /path/to/prebuilt-vmx \
  --output /path/to/output/allwpilib
```

Attach each generated ZIP and manifest to the release in its corresponding repository. ZIPs must use ZIP32 stored/deflate format; the extension rejects ZIP64, symlinks, and duplicate paths. Split files larger than 4 GiB or introduce a platform-specific distribution design.

Before a public release is available, the extension displays an installation-unavailable message. The install algorithm and ZIP validation can be tested with fixtures, but verify that the published binaries run on a robot separately after publishing the release.

## Large releases (schemaVersion 2)

By default, the packaging tool splits each ZIP's input into parts no larger than 1400 MiB to stay within GitHub's per-file attachment limit and ZIP32's range. Each ZIP can be extracted independently, and the archive paths do not overlap.

The primary ZIP uses the existing `archive` and `sha256` fields. When additional ZIPs are present, set `schemaVersion` to `2` and add the following field. This requires extension version 2.0.1 or later.

```json
"additionalArchives": [
  { "archive": "w4studica-allwpilib-VERSION-part2.zip", "sha256": "<64-character SHA-256>" }
]
```

Attach every ZIP and the manifest to the same GitHub release. The extension verifies each SHA-256, extracts all archives into one temporary installation directory, and marks the installation complete only after everything succeeds. If an additional file is missing, a checksum fails, or paths conflict, the extension removes the temporary installation. Releases with a single ZIP continue to use schemaVersion 1.
