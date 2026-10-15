# W4Studica VS Code Extension

WPILib 2027 로봇 프로젝트에서 **미리 빌드한 GitHub Releases의 GradleRIO와 allwpilib**을 설치하고, SystemCore / VMX 타깃을 전환합니다. 사용자의 PC에서 두 저장소를 clone하거나 WPILib 자체를 빌드하지 않습니다.

## 메뉴

VS Code 편집기 오른쪽 위 아이콘 또는 명령 팔레트의 `W4Studica`에서 실행합니다.

| 명령 | 동작 |
|---|---|
| `Change the deploy target to VMX (from SystemCore)` | 설치한 릴리즈를 연결하고 `VmxPi`, `linuxarm64`, VMX 실행 라이브러리를 설정합니다. |
| `Change the deploy target to SystemCore (from VMX)` | VMX 설정을 제거하고 SystemCore 플랫폼과 JNI 구성을 복원합니다. W4Studica 릴리즈 연결은 유지합니다. |
| `Update W4Studica Version` | 두 GitHub 저장소에서 호환되는 최신 릴리즈 조합을 찾아 다운로드하고 프로젝트 버전을 고정합니다. |
| `Save W4Studica Offline` | 툴체인·프로젝트 의존성을 준비하고, 온라인 빌드와 강제 오프라인 재빌드가 성공하면 이후 wrapper 실행에 오프라인 모드를 적용합니다. |

기존 `Update WPILib Version`과 `Verify the Project's build.gradle file` 명령은 제거했습니다.

## 사용 순서

1. WPILib **2027 Groovy 프로젝트**를 엽니다. JDK와 GitHub에 접근할 인터넷 연결이 필요합니다.
2. `Update W4Studica Version` 또는 VMX 전환을 실행합니다. 두 저장소에 [릴리즈 형식](RELEASES.md)을 갖춘 바이너리가 먼저 게시되어 있어야 합니다.
3. VMX에서는 로봇에 Robot-Manager와 VMX HAL을 설치합니다. 배포할 때 사용할 `VMX_USER`, `VMX_PASSWORD`는 VS Code 프로세스의 환경변수로 전달합니다. 사용자명 기본값은 `ubuntu`이며 확장은 비밀번호를 파일에 기록하지 않습니다.
4. 인터넷에 연결된 상태에서 `Save W4Studica Offline`을 실행합니다. C++ VMX 프로젝트는 처음에 로봇에서 SDK를 받아야 하므로 로봇에도 접속할 수 있어야 합니다.
5. 준비가 끝나면 `./gradlew build`, `./gradlew deploy` 또는 기존 WPILib 확장의 wrapper 기반 명령을 사용합니다. Windows에서는 `gradlew.bat`를 사용합니다.

VMX의 채널 매핑과 Driver Station enable/disable 로직은 로봇 프로젝트에서 설정합니다. 전환 명령은 자동으로 모터를 활성화하지 않습니다. Studica API를 직접 사용하는 C++ 코드에서는 `wpilibvmx::SharedVMX()`와 Titan의 `StudicaTitan` / `TitanEnableGuard`를 사용해야 합니다.

## 릴리즈와 프로젝트 파일

기본 GitHub 저장소는 각각 `W4Studica/GradleRIO`, `W4Studica/allwpilib`입니다. 설정의 `w4studica.gradleRIORepository`, `w4studica.allwpilibRepository`에서 바꿀 수 있습니다. `w4studica.includePrereleases` 기본값은 `true`입니다.

각 저장소의 최근 30개 릴리즈 안에서 `wpilibVersion`이 일치하는 조합을 선택합니다. 안정 버전만 원하면 prerelease 옵션을 끕니다. 릴리즈 태그 이름은 서로 달라도 됩니다. ZIP은 SHA-256을 검사한 뒤 VS Code의 W4Studica 전역 저장소에 보관합니다. 파일을 받거나 검증하는 데 실패하면 기존 Gradle 설정을 바꾸지 않습니다. 타깃 전환은 이미 설치된 조합을 재사용하므로 GitHub 연결이 필요 없습니다.

프로젝트의 `settings.gradle`에는 로컬 플러그인 저장소를, `build.gradle`에는 고정 버전과 라이브러리 저장소를 연결합니다. 기존 소스·타깃 이름·데스크톱 시뮬레이션 설정을 보존하고, 관리 블록만 갱신합니다. 최초 Gradle 파일은 `.w4studica/backup/`에 보관합니다. `.w4studica/`는 Git에서 제외되며 이 PC에서만 사용하는 절대 경로와 캐시를 포함합니다. 다른 PC에서는 확장으로 다시 설치해야 합니다.

2020 RoboRIO 프로젝트의 자동 마이그레이션, Kotlin DSL, 여러 deploy 타깃이 있는 프로젝트는 지원하지 않습니다. `settings.gradle`에 소스 빌드를 위한 `includeBuild`가 있으면 바이너리 릴리즈 연결 전에 해제해야 합니다.

## 오프라인 저장

의존성 저장 위치는 `.w4studica/gradle-home/`입니다. 확장이 Unix / Windows wrapper에 이 경로를 지정하고, 이 전용 캐시의 Gradle 자동 정리를 비활성화합니다. VMX SDK는 `.w4studica/vmx-sdk/`에 캐시하며, `clean` 뒤에는 GradleRIO의 빌드 SDK 경로로 복원합니다. C++ 툴체인은 GradleRIO가 관리하는 PC의 툴체인 설치 위치를 사용합니다.

저장 명령은 다음을 순서대로 수행합니다.

1. C++이면 대상 툴체인 설치 작업을 별도 실행합니다.
2. 프로젝트의 resolve 가능한 의존성 구성을 모두 다운로드합니다. 누락된 구성은 실패로 처리합니다.
3. 온라인 `build`를 실행합니다.
4. `--offline --rerun-tasks build`로 실제 재빌드를 확인합니다.
5. 모두 성공하면 `.w4studica/offline` 완료 파일을 기록하고 이후 Gradle wrapper 실행을 오프라인으로 설정합니다.

버전·타깃을 바꾸면 오프라인 완료 상태를 해제합니다. 의존성이나 vendor 라이브러리를 추가한 경우에도 인터넷 연결 후 `Save W4Studica Offline`을 다시 실행합니다. 실패한 저장은 완료로 표시하지 않습니다. wrapper 대신 별도 Gradle 설치를 직접 호출하면 이 설정이 적용되지 않습니다. Gradle의 오프라인 모드는 저장소 의존성 조회를 막으며 임의의 사용자 작업이 직접 수행하는 네트워크 요청까지 차단하지는 않습니다. 로봇으로의 deploy에는 로컬 네트워크 연결이 필요합니다.

참고: [Gradle dependency cache / offline mode](https://docs.gradle.org/current/userguide/dependency_caching.html), [Gradle cache cleanup](https://docs.gradle.org/current/userguide/directory_layout.html#dir:gradle_user_home).

## 개발

```sh
npm ci --ignore-scripts
npm test
```

테스트는 VS Code나 로봇을 실행하지 않고 타깃 왕복 전환, 릴리즈 조합 선택·설치, ZIP·체크섬 검증, 실패 시 복구, 오프라인 완료 조건을 검증합니다. `F5`로 Extension Development Host에서 메뉴를 확인할 수 있습니다.

POSIX 환경에서 실제 Gradle/JDK를 사용하는 통합 테스트는 `node tools/smoke_offline.js /path/to/gradle`로 실행합니다. 테스트용 HTTP Maven 저장소에서 의존성을 받은 다음 서버를 종료하고 `clean build`가 저장된 의존성과 자동 오프라인 모드로 성공하는지 확인합니다.

`node_modules`, `out`, `.vsix`는 생성물이므로 저장소에 포함하지 않습니다. 배포 패키지는 별도로 `npx @vscode/vsce package`로 생성합니다.
