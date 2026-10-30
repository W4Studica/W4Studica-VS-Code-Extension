import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent
VERSION = 'test-license-1'


class ReleaseLicenseTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.maven = self.root / 'maven'
        self.maven.mkdir()
        self.output = self.root / 'output'
        self.vmx = self.root / 'vmx'
        (self.vmx / 'include').mkdir(parents=True)
        (self.vmx / 'linuxarm64').mkdir()
        for name in ['libhalsim_studica.so', 'libhalsim_studicad.so', 'libhalsim_ds_relay.so', 'libhalsim_ds_relayd.so',
                     'libstudica_hardware.so', 'libstudica.so', 'libstudica_drivers.so']:
            (self.vmx / 'linuxarm64' / name).write_bytes(b'fixture')
        (self.vmx / 'licenses').mkdir()
        for source, name in [('LICENSE.md', 'WPILib-LICENSE.md'),
                             ('ThirdPartyNotices.txt', 'WPILib-ThirdPartyNotices.txt'),
                             ('studica/drivers/LICENSE', 'Studica-LICENSE'),
                             ('studica/drivers/SOURCE.txt', 'Studica-SOURCE.txt')]:
            shutil.copyfile(WORKSPACE / 'allwpilib' / source, self.vmx / 'licenses' / name)
        implementation = self.maven / 'org/wpilib/GradleRIO' / VERSION
        implementation.mkdir(parents=True)
        (implementation / f'GradleRIO-{VERSION}.jar').write_bytes(b'x' * 700_000)
        (implementation / f'GradleRIO-{VERSION}.pom').write_text('fixture')
        marker = self.maven / 'org/wpilib/GradleRIO/org.wpilib.GradleRIO.gradle.plugin' / VERSION
        marker.mkdir(parents=True)
        (marker / f'org.wpilib.GradleRIO.gradle.plugin-{VERSION}.pom').write_text('fixture')
        (self.maven / 'another-artifact.jar').write_bytes(b'y' * 700_000)

    def package(self, component, source=None):
        command = [sys.executable, str(ROOT / 'tools/package_release.py'), component,
                   '--version', VERSION, '--wpilib-version', VERSION,
                   '--maven', str(self.maven), '--output', str(self.output),
                   '--archive-size-mib', '1']
        if source is not None:
            command += ['--source-dir', str(source)]
        if component == 'allwpilib':
            command += ['--vmx', str(self.vmx)]
        return subprocess.run(command, capture_output=True, text=True, timeout=15)

    def check_parts(self, component, expected_notice):
        result = self.package(component)
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((self.output / 'w4studica.json').read_text())
        self.assertEqual(manifest['schemaVersion'], 2)
        parts = [manifest] + manifest['additionalArchives']
        paths = set()
        for part in parts:
            path = self.output / part['archive']
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), part['sha256'])
            with zipfile.ZipFile(path) as archive:
                names = archive.namelist()
                self.assertTrue(set(names).isdisjoint(paths), 'installer requires disjoint paths across parts')
                paths.update(names)
                contents = [archive.read(name) for name in names if name.startswith('licenses/')]
                self.assertIn(expected_notice, contents, 'each part must carry component license text')
                self.assertLessEqual(sum(info.file_size for info in archive.infolist()), 1024 * 1024)
                if component == 'allwpilib':
                    self.assertTrue(any('Studica-LICENSE' in name or name.endswith('studica/drivers/LICENSE')
                                        for name in names))
        return paths

    def test_gradlerio_parts_carry_mit_without_duplicate_paths(self):
        self.check_parts('gradlerio', (WORKSPACE / 'GradleRIO/LICENSE').read_bytes())

    def test_wpilib_parts_carry_bsd_and_studica_apache_notices(self):
        paths = self.check_parts('allwpilib', (WORKSPACE / 'allwpilib/LICENSE.md').read_bytes())
        self.assertIn('vmx/licenses/Studica-LICENSE', paths)
        self.assertIn('licenses/W4Studica-extension-LICENSE', paths)
        self.assertIn('vmx.gradle', paths)

    def test_missing_runtime_notice_blocks_packaging(self):
        (self.vmx / 'licenses/Studica-LICENSE').unlink()
        result = self.package('allwpilib')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('VMX runtime license notice is missing', result.stderr)
        self.assertFalse(self.output.exists())

    def test_missing_component_license_blocks_packaging(self):
        result = self.package('gradlerio', self.root)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Component license notice is missing', result.stderr)
        self.assertFalse(self.output.exists())

    def test_hal_sdk_remains_excluded(self):
        (self.vmx / 'include/VMXPi.h').write_text('fixture, not a real SDK header')
        result = self.package('allwpilib')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Do not redistribute', result.stderr)
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
