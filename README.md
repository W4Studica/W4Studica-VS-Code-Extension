# W4Studica VS Code Extension

For WPILib 2027 robot projects, this extension installs **prebuilt GradleRIO and allwpilib releases from GitHub** and switches between the SystemCore and VMX targets. Users do not need to clone either repository or build WPILib themselves.

## Commands

Run commands from the W4Studica icon in the upper-right corner of the VS Code editor or from the `W4Studica` command palette category.

| Command | Behavior |
|---|---|
| `Change the deploy target to VMX (from SystemCore)` | Connects the installed release and configures `VmxPi`, `linuxarm64`, and the VMX runtime libraries. |
| `Change the deploy target to SystemCore (from VMX)` | Removes the VMX configuration and restores the SystemCore platform and JNI configuration. The W4Studica release remains connected. |
| `Update W4Studica Version` | Finds the newest compatible release pair in the two GitHub repositories, downloads them, and pins their versions in the project. |
| `Save W4Studica Offline` | Prepares toolchains and project dependencies, then enables offline mode for later wrapper runs only after both an online build and a forced offline rebuild succeed. |

The old `Update WPILib Version` and `Verify the Project's build.gradle file` commands have been removed.

## Getting started

1. Open a WPILib **2027 Groovy project**. You need a JDK and an Internet connection to access GitHub.
2. Run `Update W4Studica Version` or switch to the VMX target. The matching binaries must already be published in both repositories using the [release format](RELEASES.md).
3. For VMX, install Robot-Manager and the VMX HAL on the robot. Pass `VMX_USER` and `VMX_PASSWORD` to the VS Code process as environment variables for deployment. The default username is `ubuntu`; the extension never writes the password to a file.
4. While online, run `Save W4Studica Offline`. C++ VMX projects must initially fetch the SDK from the robot, so the robot must also be reachable.
5. Once setup is complete, use `./gradlew build`, `./gradlew deploy`, or the existing WPILib extension's wrapper-based commands. On Windows, use `gradlew.bat`.

Configure VMX channel mappings and Driver Station enable/disable logic in the robot project. Switching targets does not enable motors automatically. C++ code that calls the Studica API directly must use `wpilibvmx::SharedVMX()` and Titan's `StudicaTitan` / `TitanEnableGuard` helpers.

## Releases and project files

The default GitHub repositories are `W4Studica/GradleRIO` and `W4Studica/allwpilib`. Change them with the `w4studica.gradleRIORepository` and `w4studica.allwpilibRepository` settings. `w4studica.includePrereleases` defaults to `true`.

The extension searches the 30 most recent releases in each repository and selects a pair with matching `wpilibVersion` values. Turn off the prerelease setting to use stable releases only. The release tags do not have to match. After verifying their SHA-256 checksums, the extension stores the ZIPs in VS Code's global W4Studica storage. If download or verification fails, the existing Gradle configuration is left unchanged. Target switching reuses the already installed release pair and does not require GitHub access.

The project `settings.gradle` is configured to use the local plugin repository, and `build.gradle` is configured with the pinned versions and library repositories. The extension preserves existing source files, target names, and desktop simulation settings while updating only its managed blocks. It backs up the original Gradle files under `.w4studica/backup/`. Git ignores `.w4studica/`; it contains absolute paths and caches specific to this computer. On another computer, install the releases again with the extension.

Automatic migration of 2020 RoboRIO projects, Kotlin DSL, and projects with multiple deploy targets are not supported. If `settings.gradle` contains an `includeBuild` for a source build, disable it before connecting a binary release.

## Offline storage

Dependencies are stored in `.w4studica/gradle-home/`. The extension points Unix and Windows wrappers to this directory and disables Gradle's automatic cleanup of this dedicated cache. The VMX SDK is cached in `.w4studica/vmx-sdk/` and restored to GradleRIO's build SDK path after `clean`. C++ toolchains use the installation location managed by GradleRIO on the development computer.

The save command performs these steps in order:

1. For C++ projects, run the target toolchain installation task separately.
2. Download every resolvable dependency configuration in the project. Missing configurations cause the operation to fail.
3. Run an online `build`.
4. Verify a real rebuild with `--offline --rerun-tasks build`.
5. If all steps succeed, write the `.w4studica/offline` completion marker and configure later Gradle wrapper runs to use offline mode.

Changing the version or target clears the offline completion state. If you add dependencies or vendor libraries, reconnect to the Internet and run `Save W4Studica Offline` again. A failed save is never marked complete. These settings do not apply when you invoke a separate Gradle installation directly instead of the wrapper. Gradle offline mode prevents dependency lookups in repositories, but it does not block arbitrary network requests made by user tasks. Deploying to the robot still requires a local network connection.

See [Gradle dependency cache and offline mode](https://docs.gradle.org/current/userguide/dependency_caching.html) and [Gradle cache cleanup](https://docs.gradle.org/current/userguide/directory_layout.html#dir:gradle_user_home).

## Development

```sh
npm ci --ignore-scripts
npm test
```

Tests run without starting VS Code or a robot. They cover target switching in both directions, release-pair selection and installation, ZIP and checksum validation, recovery after failures, and offline completion conditions. Press `F5` to inspect the commands in the Extension Development Host.

On POSIX systems, run the integration test with a real Gradle/JDK using `node tools/smoke_offline.js /path/to/gradle`. It downloads dependencies from a test HTTP Maven repository, shuts the server down, and verifies that `clean build` succeeds using the saved dependencies and automatic offline mode.

`node_modules`, `out`, and `.vsix` files are generated artifacts and are not checked into the repository. Create a distributable package separately with `npx @vscode/vsce package`.
