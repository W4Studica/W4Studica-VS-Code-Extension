# Changelog

## 2.0.1

- 대용량 GitHub 릴리즈의 여러 ZIP을 각각 검증하고 하나의 설치로 저장합니다 (manifest schema 2).

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
