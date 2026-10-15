#!/usr/bin/env python3
"""Package already-built Maven repositories; this script does not compile or publish."""
import argparse
import hashlib
import json
import re
import shutil
import tempfile
import zipfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('component', choices=['gradlerio', 'allwpilib'])
    parser.add_argument('--version', required=True)
    parser.add_argument('--wpilib-version', required=True)
    parser.add_argument('--maven', type=Path, required=True)
    parser.add_argument('--vmx', type=Path, help='Prebuilt VMX folder with include/ and linuxarm64/')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--archive-size-mib', type=int, default=1400,
                        help='Maximum input size per independent ZIP (default: 1400 MiB)')
    args = parser.parse_args()
    if not 0 < args.archive_size_mib <= 1800:
        parser.error('--archive-size-mib must be between 1 and 1800')
    for value in [args.version, args.wpilib_version]:
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.+\-]*', value):
            parser.error('Invalid version')
    if not args.maven.is_dir():
        parser.error('--maven must be a prebuilt Maven repository directory')
    if args.component == 'gradlerio':
        marker = args.maven / 'org/wpilib/GradleRIO/org.wpilib.GradleRIO.gradle.plugin' / args.version / f'org.wpilib.GradleRIO.gradle.plugin-{args.version}.pom'
        if not marker.is_file():
            parser.error('GradleRIO plugin marker POM is missing')
        implementation = args.maven / 'org/wpilib/GradleRIO' / args.version / f'GradleRIO-{args.version}'
        if not Path(str(implementation) + '.jar').is_file() or not Path(str(implementation) + '.pom').is_file():
            parser.error('GradleRIO implementation JAR or POM is missing')
    if args.component == 'allwpilib' and not args.vmx:
        parser.error('allwpilib needs --vmx containing the prebuilt runtime and headers')
    if args.vmx:
        if not (args.vmx / 'include').is_dir():
            parser.error('VMX include/ directory is missing')
        for library in ['libhalsim_vmx.so', 'libhalsim_vmxd.so', 'libhalsim_vmx_studica.so', 'libstudica_drivers.so']:
            if not (args.vmx / 'linuxarm64' / library).is_file():
                parser.error('Missing VMX runtime: ' + library)
        if list(args.vmx.rglob('libvmxpi_hal*')) or list(args.vmx.rglob('VMXPi.h')):
            parser.error('Do not redistribute image-specific VMX HAL libraries or headers')
    args.output.mkdir(parents=True, exist_ok=True)
    name = f'w4studica-{args.component}-{args.version}'
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        shutil.copytree(args.maven, root / 'maven', symlinks=False)
        if args.vmx:
            shutil.copytree(args.vmx, root / 'vmx', symlinks=False)
            shutil.copyfile(Path(__file__).resolve().parent.parent / 'release/vmx.gradle', root / 'vmx.gradle')
        limit = args.archive_size_mib * 1024 * 1024
        groups, size = [[]], 0
        for file in sorted(p for p in root.rglob('*') if p.is_file()):
            length = file.stat().st_size
            if length > limit:
                parser.error('One Maven artifact exceeds the archive size limit: ' + file.name)
            if size + length > limit:
                groups.append([])
                size = 0
            groups[-1].append(file)
            size += length
        for old in args.output.glob(name + '*.zip'):
            old.unlink()
        archives = []
        for index, files in enumerate(groups):
            archive = args.output / (name + (f'-part{index + 1}' if index else '') + '.zip')
            with zipfile.ZipFile(archive, 'w', allowZip64=False) as output:
                for file in files:
                    compression = zipfile.ZIP_STORED if file.suffix in ['.zip', '.jar'] else zipfile.ZIP_DEFLATED
                    output.write(file, file.relative_to(root), compress_type=compression)
            with archive.open('rb') as stream:
                checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
            archives.append(dict(archive=archive.name, sha256=checksum))
    manifest = dict(schemaVersion=2 if len(archives) > 1 else 1, component=args.component, version=args.version,
                    wpilibVersion=args.wpilib_version, **archives[0], mavenPath='maven')
    if len(archives) > 1:
        manifest['additionalArchives'] = archives[1:]
    if args.vmx:
        manifest['vmxScript'] = 'vmx.gradle'
    (args.output / 'w4studica.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Upload {len(archives)} ZIP archive(s) and w4studica.json to the {args.component} GitHub release.')


if __name__ == '__main__':
    main()
