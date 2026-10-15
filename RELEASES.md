# GitHub Releases 바이너리 계약 (schemaVersion 1 / 2)

이 문서는 확장과 앞으로 게시할 릴리즈가 공유하는 파일 형식입니다. **GradleRIO와 allwpilib 각각의 저장소**에 해당 구성 요소의 ZIP과 `w4studica.json`을 첨부합니다. 자동 생성된 GitHub source archive는 사용하지 않습니다.

두 manifest의 `wpilibVersion`은 같아야 합니다. `version`은 해당 구성 요소의 실제 Maven 버전이며, Maven 저장소 안의 버전과 정확히 일치해야 합니다. 기존 upstream과 구분되는 고정 버전(예: `2027.0.0-alpha-7-w4.1`)을 권장합니다. 게시한 버전의 ZIP은 변경하지 말고 새 버전을 게시합니다.

## GradleRIO 저장소

```json
{
  "schemaVersion": 1,
  "component": "gradlerio",
  "version": "2027.0.0-alpha-7-w4.1",
  "wpilibVersion": "2027.0.0-alpha-7-w4.1",
  "archive": "w4studica-gradlerio-2027.0.0-alpha-7-w4.1.zip",
  "sha256": "ZIP 파일의 64자리 SHA-256",
  "mavenPath": "maven"
}
```

ZIP의 `maven/`에 GradleRIO의 JAR, POM, Gradle module metadata와 **플러그인 marker POM**을 포함합니다.

```text
maven/org/wpilib/GradleRIO/<version>/...
maven/org/wpilib/GradleRIO/org.wpilib.GradleRIO.gradle.plugin/<version>/...
```

플러그인의 전이 의존성은 같은 Maven 저장소에 포함하거나 최초 오프라인 저장 시 공개 저장소에서 받아야 합니다.

## allwpilib 저장소

```json
{
  "schemaVersion": 1,
  "component": "allwpilib",
  "version": "2027.0.0-alpha-7-w4.1",
  "wpilibVersion": "2027.0.0-alpha-7-w4.1",
  "archive": "w4studica-allwpilib-2027.0.0-alpha-7-w4.1.zip",
  "sha256": "ZIP 파일의 64자리 SHA-256",
  "mavenPath": "maven",
  "vmxScript": "vmx.gradle"
}
```

```text
maven/                         # WPILib Java/JNI/C++ 헤더·바이너리, POM, module metadata
vmx.gradle                     # release/vmx.gradle을 패키징 도구가 복사
vmx/include/                   # VMX 확장 및 Studica API의 공개 헤더 (디렉터리 구조 유지)
vmx/linuxarm64/
  libhalsim_vmx.so
  libhalsim_vmxd.so             # debug HAL용; release HAL을 중복 로드하지 않도록 분리
  libhalsim_vmx_studica.so
  libstudica_drivers.so
  ...                          # 필요한 추가 .so 런타임 파일
```

`maven/`에는 사용하는 SystemCore, linuxarm64, 개발 PC의 데스크톱 플랫폼용 산출물을 포함합니다. 확장은 WPILib 그룹 `org.wpilib` 및 하위 그룹 중 manifest의 `wpilibVersion`과 같은 버전만 이 저장소에 독점 연결하므로 누락된 WPILib 모듈이 upstream으로 조용히 대체되지 않습니다. OpenCV 등의 외부 의존성은 별도 버전을 유지하며 최초 오프라인 저장 시 다운로드합니다.

`vmx.gradle`은 미리 빌드한 확장·백엔드·Studica 공유 라이브러리를 배포하고, C++에 prebuilt library를 연결합니다. Java에도 같은 런타임을 배포합니다. `libvmxpi_hal_cpp.so`와 `VMXPi.h`는 로봇 이미지에서 SDK로 가져오며 ZIP에 포함하지 않습니다. 바이너리·헤더의 ABI는 이 릴리즈의 WPILib 및 고정 로봇 이미지와 맞춰 빌드해야 합니다. 공개 배포에 필요한 기존 소스·제3자 라이선스 고지도 포함합니다.

## 이미 빌드한 결과를 패키징

확장 저장소의 표준 라이브러리 전용 Python 도구를 사용합니다. 이 도구는 컴파일·GitHub 업로드를 수행하지 않습니다.

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

생성된 ZIP과 manifest를 각각 대응하는 저장소의 릴리즈에 첨부합니다. ZIP은 ZIP32 stored/deflate 형식이어야 하며 ZIP64, symlink, 중복 경로는 확장에서 거부합니다. 4 GiB 이상 파일은 분할하거나 플랫폼별 배포 설계를 추가해야 합니다.

공개 릴리즈가 준비되기 전에는 확장이 설치 불가 메시지를 표시합니다. 설치 알고리즘과 ZIP 검증은 fixture로 테스트할 수 있지만 실제 배포 바이너리의 로봇 구동 검증은 릴리즈 게시 후 별도로 수행해야 합니다.

## 대용량 릴리즈 (schemaVersion 2)

패키징 도구는 각 ZIP의 입력 크기를 기본 1400 MiB 이하로 나누어 GitHub의 단일 첨부 파일 한도와 ZIP32 범위를 지킵니다. 각 ZIP은 독립적으로 압축 해제할 수 있으며 파일 경로가 겹치지 않습니다.

주 ZIP은 기존 `archive`와 `sha256` 필드를 사용합니다. 추가 ZIP이 있으면 `schemaVersion`을 `2`로 설정하고 다음 필드를 추가합니다. 확장 2.0.1 이상이 필요합니다.

```json
"additionalArchives": [
  { "archive": "w4studica-allwpilib-VERSION-part2.zip", "sha256": "<64자리 SHA-256>" }
]
```

모든 ZIP과 manifest를 같은 GitHub 릴리즈에 첨부해야 합니다. 확장은 각 파일의 SHA-256을 확인한 뒤 하나의 임시 설치 폴더에 풀고, 전체 설치가 성공한 뒤에만 완료 상태로 저장합니다. 추가 파일의 누락, 체크섬 오류 또는 경로 충돌이 있으면 임시 설치를 제거합니다. 단일 ZIP 릴리즈는 계속 schemaVersion 1을 사용합니다.
