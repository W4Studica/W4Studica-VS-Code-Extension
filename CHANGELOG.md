# Changelog

## 2.0.3

- Keep VMX SDK fetching out of ordinary `build` tasks; refresh existing projects to fetch the SDK only during deploy.
- Update the saved VMX integration script when users run Update W4Studica Version, without rewriting their robot source build.gradle.

## 2.0.2

- Keep VMX username and password defaults inside GradleRIO; remove stale generated settings from project build.gradle files.
- Preserve existing Gradle build files by editing only the relevant target declarations and exact legacy settings.

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
