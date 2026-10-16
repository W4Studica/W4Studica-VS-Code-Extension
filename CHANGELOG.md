# Changelog

## 2.0.1

- Replacement build: handle CRLF-managed Gradle blocks when updating releases or switching back to SystemCore.
- Add regression coverage for CRLF target round trips and settings updates.

- Verify each ZIP in large GitHub releases and install all parts as one version (manifest schema 2).

- Scope local Maven routing to the selected WPILib version so external dependencies keep resolving normally.
- Package/select separate release and debug VMX extensions to avoid loading two HAL instances.
- Preserve GradleRIO's SDK paths and restore SDK files from the offline cache after `clean`.
- Add a real release-ZIP C++/Java consumer build and offline smoke harness.

## 2.0.0

- Replace legacy 2020 plugin updates with compatible prebuilt GitHub Releases from GradleRIO and allwpilib.
- Add SystemCore ↔ VMX target switching for WPILib 2027 Groovy projects.
- Add verified offline dependency saving with a dedicated persistent Gradle cache.
- Remove the old WPILib update and build.gradle verification commands.
- Remove checked-in dependencies, compiled output, obsolete VSIX and template files.
