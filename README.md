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
3. For VMX, install Robot-Manager and the VMX HAL on the robot. The VMX connection fallback credentials are always username `lvuser` and password `password` (`install.sh` also creates an `admin` account for interactive SSH).
4. While online, run `Save W4Studica Offline`. C++ VMX projects must initially fetch the SDK from the robot, so the robot must also be reachable.
5. Once setup is complete, use `./gradlew build`, `./gradlew deploy`, or the existing WPILib extension's wrapper-based commands. On Windows, use `gradlew.bat`.

Configure VMX channel mappings and Driver Station enable/disable logic in the robot project. Switching targets does not enable motors automatically. Use `wpi::studica::Titan` for Titan control; it owns the shared VMX connection, enable keepalive and watchdog. Low-level `wpi::studica::drivers` classes are exposed through `wpi/studica/drivers/<Device>.hpp`; pass `wpi::studica::SharedVMX()` to VMX-backed drivers.

## Releases and project files

The default GitHub repositories are `W4Studica/GradleRIO` and `W4Studica/allwpilib`. Change them with the `w4studica.gradleRIORepository` and `w4studica.allwpilibRepository` settings. `w4studica.includePrereleases` defaults to `true`.

The extension searches the 30 most recent releases in each repository and selects a pair with matching `wpilibVersion` values. Turn off the prerelease setting to use stable releases only. The release tags do not have to match. After verifying their SHA-256 checksums, the extension stores the ZIPs under `~/wpilib/2027/W4Studica/`. Downloads show percent complete and an estimated remaining time. If download or verification fails, the existing Gradle configuration is left unchanged. Target switching reuses the already installed release pair and does not require GitHub access.

The extension configures the local GradleRIO plugin repository in `settings.gradle`. In `build.gradle`, it only updates the GradleRIO version, the deploy target, the fixed VMX credentials, and one short W4Studica script line. Release files, project settings, SDK cache, offline status, and backups are kept under `~/wpilib/2027/W4Studica/`, outside robot projects. No W4Studica folders or Gradle caches are created in the project. Existing `.w4studica` data from earlier extension versions is moved to the global location the next time the project is reconnected.

Automatic migration of 2020 RoboRIO projects, Kotlin DSL, and projects with multiple deploy targets are not supported. If `settings.gradle` contains an `includeBuild` for a source build, disable it before connecting a binary release.

## Offline storage

Gradle uses its normal per-user dependency cache. The VMX SDK is cached under the WPILib 2027 W4Studica project data directory and restored to GradleRIO's build SDK path after `clean`. C++ toolchains use the installation location managed by GradleRIO on the development computer.

The save command performs these steps in order:

1. For C++ projects, run the target toolchain installation task separately.
2. Download every resolvable dependency configuration in the project. Missing configurations cause the operation to fail.
3. Run an online `build`.
4. Verify a real rebuild with `--offline --rerun-tasks build`.
5. If all steps succeed, write the global offline completion marker. The W4Studica Gradle script enables offline mode on later project builds.

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

## License

W4Studica contributions: [MIT](LICENSE). Inherited material and dependencies: [ThirdPartyNotices.txt](ThirdPartyNotices.txt). The original extension has no declared license; this is not a blanket relicensing of its code or assets.
