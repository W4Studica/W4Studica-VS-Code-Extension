import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { deflateRawSync } from 'zlib';
import { Readable } from 'stream';
import { Response } from 'node-fetch';
import { configureBuild, configureProject, configureSettings, detectTarget, extractSystemcoreHostCalls, ProjectState, projectStorageDir, readState } from '../../project';
import { Candidate, candidateDownloadSize, findInstallation, Installation, installComponent, Manifest, validateManifest } from '../../releases';
import { atomicWrite, exists, inside, io, writeTransaction } from '../../files';
import { extractZip } from '../../archive';
import { runGradle, saveOffline } from '../../offline';

const systemcore = `// SystemCore robot
plugins { id 'cpp'; id 'org.wpilib.GradleRIO' version '2027.0.0-alpha-7' }
// systemcoreDebug and wpi.platforms.systemcore in comments must survive.
def label = "wpi.platforms.systemcore { }"
deploy { targets {
  robot(getTargetTypeClass('SystemCore')) {
    team = project.wpilib.getTeamNumber()
    useCustomSystemcoreHostName('robot.local')
    artifacts { wpilibCpp(getArtifactTypeClass('WPILibNativeArtifact')) { } }
  }
} }
def deployArtifact = deploy.targets.robot.artifacts.wpilibCpp
model { components { program(NativeExecutableSpec) {
  targetPlatform wpi.platforms.systemcore
  targetPlatform wpi.platforms.desktop
  sources.cpp { source { srcDir 'src/main/cpp' }; exportedHeaders { srcDir 'src/main/include' } }
  deployArtifact.component = it
  wpi.cpp.deps.wpilib(it)
} } }
`;

function installed(component: 'gradlerio' | 'allwpilib') {
    return {
        repository: 'W4Studica/' + (component === 'gradlerio' ? 'GradleRIO' : 'allwpilib'),
        directory: path.resolve(os.tmpdir(), 'w4studica test', component),
        release: { tag_name: 'v2', draft: false, prerelease: false, assets: [] },
        manifest: { schemaVersion: 1, component, version: '2027.0.0-alpha-7-w4.2', wpilibVersion: '2027.0.0-alpha-7-w4.2',
            archive: 'bundle.zip', sha256: 'a'.repeat(64), mavenPath: 'maven', ...(component === 'allwpilib' ? { vmxScript: 'vmx.gradle' } : {}) } as Manifest
    };
}
const installation: Installation = { gradlerio: installed('gradlerio'), allwpilib: installed('allwpilib') };

// Test ZIP writer; no CRC is needed by our reader (the release's SHA-256 authenticates the full archive).
function zip(entries: { name: string; content: string; symlink?: boolean; declared?: number }[]): Buffer {
    const locals: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name);
        const data = Buffer.from(entry.content);
        const compressed = deflateRawSync(data);
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(8, 8);
        header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(entry.declared === undefined ? data.length : entry.declared, 22);
        header.writeUInt16LE(name.length, 26);
        locals.push(header, name, compressed);
        const record = Buffer.alloc(46);
        record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(8, 10);
        record.writeUInt32LE(compressed.length, 20); record.writeUInt32LE(entry.declared === undefined ? data.length : entry.declared, 24);
        record.writeUInt16LE(name.length, 28); record.writeUInt32LE(entry.symlink ? 0xa0000000 : 0, 38); record.writeUInt32LE(offset, 42);
        central.push(record, name);
        offset += header.length + name.length + compressed.length;
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

suite('Project conversion', () => {
    test('VMX conversion preserves robot sources, target references, comments and desktop simulation', () => {
        const converted = configureBuild(systemcore, installation, 'vmx');
        assert.strictEqual(detectTarget(converted), 'vmx');
        assert.ok(converted.includes('deploy.targets.robot.artifacts.wpilibCpp'));
        assert.ok(converted.includes('wpi.platforms.linuxarm64'));
        assert.ok(converted.includes('wpi.platforms.desktop'));
        assert.ok(converted.includes('src/main/include'));
        assert.ok(converted.includes('// systemcoreDebug and wpi.platforms.systemcore'));
        assert.ok(converted.includes('"wpi.platforms.systemcore { }"'));
        assert.ok(converted.indexOf('username =') < converted.indexOf('team ='));
        assert.ok(converted.includes("username = System.getenv('VMX_USER') ?: 'ubuntu'"));
        assert.ok(converted.includes("System.getenv('VMX_PASSWORD') ?: 'password'"));
        assert.ok(!converted.includes('BEGIN W4Studica connection'));
        assert.ok(!converted.includes('END W4Studica connection'));
        assert.ok(!converted.includes('W4Studica original host'));
        assert.ok(converted.includes("apply from: new File(System.getProperty('user.home'), 'wpilib/2027/W4Studica/w4studica.gradle')"));
        assert.ok(!converted.includes('exclusiveContent'));
        assert.ok(!converted.includes('w4studicaBundleRoot'));
    });
    test('SystemCore return restores custom hostname and keeps edits made while on VMX', () => {
        const vmx = configureBuild(systemcore, installation, 'vmx')
            .replace("username = System.getenv('VMX_USER') ?: 'ubuntu'\npassword = System.getenv('VMX_PASSWORD') ?: 'password'",
                "// BEGIN W4Studica connection\nusername = System.getenv('VMX_USER') ?: 'ubuntu'\npassword = System.getenv('VMX_PASSWORD') ?: 'password'\n// END W4Studica connection")
            + '\ndef customUserSetting = 42\n';
        const restored = configureBuild(vmx, installation, 'systemcore', extractSystemcoreHostCalls(systemcore));
        assert.strictEqual(detectTarget(restored), 'systemcore');
        assert.ok(restored.includes("useCustomSystemcoreHostName('robot.local')"));
        assert.ok(restored.includes('customUserSetting = 42'));
        assert.ok(!restored.includes('VMX_USER'));
        assert.ok(!restored.includes('VMX_PASSWORD'));
        assert.ok(!restored.includes('BEGIN W4Studica connection'));
        assert.ok(!restored.includes('W4Studica original host'));
        assert.ok(restored.includes("apply from: new File(System.getProperty('user.home'), 'wpilib/2027/W4Studica/w4studica.gradle')"));
        assert.ok(!restored.includes('wpi.platforms.linuxarm64'));
    });
    test('Java JNI configurations switch in both directions', () => {
        const java = systemcore.replace("id 'cpp'", "id 'java'") + '\ndependencies { systemcoreDebug wpi.java.deps.wpilibJniDebug(wpi.platforms.systemcore); systemcoreRelease wpi.java.deps.wpilibJniRelease(wpi.platforms.systemcore) }';
        const vmx = configureBuild(java, installation, 'vmx');
        assert.ok(vmx.includes('vmxDebug wpi.java'));
        assert.ok(vmx.includes('vmxRelease wpi.java'));
        assert.ok(configureBuild(vmx, installation, 'systemcore', extractSystemcoreHostCalls(java)).includes('systemcoreRelease wpi.java'));
    });
    test('updates replace managed blocks without duplicating VMX configuration', () => {
        let text = configureBuild(systemcore, installation, 'vmx');
        const first = text;
        for (let i = 0; i < 3; i++) { text = configureBuild(text, installation, 'vmx'); }
        assert.strictEqual(text, first);
        assert.strictEqual(text.split("username = System.getenv('VMX_USER') ?: 'ubuntu'").length, 2);
        assert.strictEqual(text.split("wpilib/2027/W4Studica/w4studica.gradle").length, 2);
    });
    test('CRLF saves preserve target round trips and replace managed settings', () => {
        const crlf = (text: string) => text.replace(/\r?\n/g, '\r\n');
        const vmx = crlf(configureBuild(systemcore, installation, 'vmx'));
        const updated = configureBuild(vmx, installation, 'vmx');
        assert.strictEqual(updated.split("username = System.getenv('VMX_USER') ?: 'ubuntu'").length, 2);
        assert.strictEqual(updated.split("wpilib/2027/W4Studica/w4studica.gradle").length, 2);
        const restored = configureBuild(crlf(updated), installation, 'systemcore', extractSystemcoreHostCalls(systemcore));
        assert.strictEqual(detectTarget(restored), 'systemcore');
        assert.ok(!restored.includes('VMX_PASSWORD'));
        assert.ok(restored.includes("apply from: new File(System.getProperty('user.home'), 'wpilib/2027/W4Studica/w4studica.gradle')"));
        assert.ok(restored.includes("useCustomSystemcoreHostName('robot.local')"));
        assert.ok(!restored.includes('W4Studica original host'));
        assert.ok(!restored.includes('// BEGIN W4Studica libraries'));
        const settings = crlf(configureSettings("rootProject.name = 'Robot'\r\n", installation));
        assert.strictEqual(configureSettings(settings, installation).split('BEGIN W4Studica plugin repositories').length, 2);
    });
    test('existing settings keep root name and plugin repositories, local release repositories come first', () => {
        const original = "pluginManagement { repositories { mavenCentral() } }\nrootProject.name = 'Robot'";
        const result = configureSettings(configureSettings(original, installation), installation);
        assert.strictEqual(result.split('BEGIN W4Studica plugin repositories').length, 2);
        assert.ok(result.indexOf('/maven') < result.indexOf('mavenCentral()'));
        assert.ok(result.includes("rootProject.name = 'Robot'"));
    });
    test('unsupported legacy and ambiguous multi-target projects fail before conversion', () => {
        assert.throws(() => configureBuild(systemcore.replace('org.wpilib.GradleRIO', 'com.kauailabs.wsr.GradleRIO'), installation, 'vmx'), /2027/);
        assert.throws(() => detectTarget(systemcore + systemcore), /exactly one/);
        assert.throws(() => configureSettings("pluginManagement { includeBuild('../GradleRIO') }", installation), /includeBuild/);
        const missing = { ...installation, allwpilib: { ...installation.allwpilib, manifest: { ...installation.allwpilib.manifest, vmxScript: undefined } } };
        assert.throws(() => configureBuild(systemcore, missing, 'vmx'), /vmxScript/);
    });
    test('restores wrappers edited by the earlier project-local cache implementation', () => {
        const shell = '#!/bin/sh\n# W4Studica Gradle home\nset -- "$@" --gradle-user-home "$APP_HOME/.w4studica/gradle-home"\nexec "$JAVACMD" "$@"\n';
        assert.strictEqual(require('../../project').restoreWrapper(shell, false), '#!/bin/sh\nexec "$JAVACMD" "$@"\n');
        const windows = '@rem W4Studica Gradle home\r\n"%JAVA_EXE%" -jar "%APP_HOME%\\gradle\\wrapper\\gradle-wrapper.jar" %* --gradle-user-home "%APP_HOME%\\.w4studica\\gradle-home"\r\n';
        assert.ok(!require('../../project').restoreWrapper(windows, true).includes('.w4studica'));
    });
});

suite('Command menu', () => {
    test('exposes the four requested commands and removes legacy commands', async () => {
        const manifest = JSON.parse(await io.readFile(path.resolve(__dirname, '../../../package.json'), 'utf8'));
        const titles = manifest.contributes.commands.map((command: { title: string }) => command.title);
        for (const title of ['Change the deploy target to VMX (from SystemCore)', 'Change the deploy target to SystemCore (from VMX)',
            'Update W4Studica Version', 'Save W4Studica Offline']) { assert.ok(titles.includes(title)); }
        assert.ok(!manifest.activationEvents.some((event: string) => /updateWPILib|checkGradleStatus/.test(event)));
    });
});

suite('Release and archive validation', () => {
    let temp: string;
    setup(async () => { temp = await io.mkdtemp(path.join(os.tmpdir(), 'w4studica-')); });
    teardown(async () => { await io.rm(temp, { recursive: true }); });
    test('rejects invalid manifests and traversal paths', () => {
        assert.throws(() => validateManifest({}, 'gradlerio'), /Invalid/);
        assert.throws(() => validateManifest({ ...installation.allwpilib.manifest, mavenPath: '../outside' }, 'allwpilib'), /escapes/);
        for (const name of ['../outside', '/absolute', 'C:\\escape', '..\\escape']) { assert.throws(() => inside(temp, name)); }
    });
    test('extracts deflated Maven files and rejects traversal, symlinks, duplicates and expansion mismatches', async () => {
        const archive = path.join(temp, 'bundle.zip');
        await io.writeFile(archive, zip([{ name: 'maven/lib.pom', content: 'pom' }]));
        await extractZip(archive, path.join(temp, 'good'));
        assert.strictEqual(await io.readFile(path.join(temp, 'good/maven/lib.pom'), 'utf8'), 'pom');
        for (const [index, entries] of [
            [{ name: '../escape', content: 'x' }],
            [{ name: 'link', content: '../escape', symlink: true }],
            [{ name: 'same', content: 'a' }, { name: 'same', content: 'b' }],
            [{ name: 'small', content: 'much too big', declared: 1 }]
        ].entries()) {
            await io.writeFile(archive, zip(entries));
            await assert.rejects(extractZip(archive, path.join(temp, 'bad' + index)));
        }
    });
    test('selects compatible releases from both repos and honours prerelease setting', async () => {
        const repos = { gradlerio: 'W4Studica/GradleRIO', allwpilib: 'W4Studica/allwpilib' };
        const makeRelease = (tag: string, prerelease = false) => ({ tag_name: tag, draft: false, prerelease, assets: [{ name: 'w4studica.json', browser_download_url: 'https://github.com/test/repo/releases/download/' + tag + '/w4studica.json' }] });
        const request = async (url: string) => {
            if (url.includes('/GradleRIO/releases')) { return [makeRelease('new', true), makeRelease('old')]; }
            if (url.includes('/allwpilib/releases')) { return [makeRelease('wpilib')]; }
            const component = url.includes('/wpilib/') ? 'allwpilib' : 'gradlerio';
            return { ...installed(component).manifest, wpilibVersion: url.includes('/new/') ? 'unmatched' : 'compatible' };
        };
        const result = await findInstallation(repos, true, request);
        assert.strictEqual(result.gradlerio.release.tag_name, 'old');
        assert.strictEqual(result.allwpilib.release.tag_name, 'wpilib');
        assert.strictEqual((await findInstallation(repos, false, request)).gradlerio.release.tag_name, 'old');
        await assert.rejects(findInstallation(repos, false, async () => []), /No compatible/);
    });
    test('installs only checksum-verified complete archives, caches locally, rejects a bad checksum', async () => {
        const manifest = installation.gradlerio.manifest;
        const pom = 'maven/org/wpilib/GradleRIO/org.wpilib.GradleRIO.gradle.plugin/' + manifest.version + '/org.wpilib.GradleRIO.gradle.plugin-' + manifest.version + '.pom';
        const implementation = 'maven/org/wpilib/GradleRIO/' + manifest.version + '/GradleRIO-' + manifest.version;
        const archive = zip([{ name: pom, content: '<project/>' }, { name: implementation + '.pom', content: '<project/>' }, { name: implementation + '.jar', content: 'fixture' }]);
        const candidate: Candidate = { ...installed('gradlerio'), manifest: { ...manifest, sha256: createHash('sha256').update(archive).digest('hex') },
            release: { ...installed('gradlerio').release, assets: [{ name: 'bundle.zip', size: archive.length, browser_download_url: 'https://github.com/W4Studica/GradleRIO/releases/download/v2/bundle.zip' }] } };
        assert.strictEqual(candidateDownloadSize(candidate), archive.length);
        let calls = 0;
        const updates: { transferred: number; total: number; cached?: boolean }[] = [];
        const download = async () => { calls++; return new Response(Readable.from([archive])); };
        const result = await installComponent(candidate, temp, () => undefined, download, update => updates.push(update));
        assert.ok(await exists(path.join(result.directory, '.complete')));
        assert.ok(updates.some(update => update.total === archive.length && update.transferred === archive.length));
        await installComponent(candidate, temp, () => undefined, download, update => updates.push(update));
        assert.ok(updates.some(update => update.cached));
        assert.strictEqual(calls, 1);
        await assert.rejects(installComponent({ ...candidate, manifest: { ...manifest, sha256: 'b'.repeat(64) } }, temp, () => undefined, download), /SHA-256/);
    });
    test('multi-archive releases verify every part and never cache an incomplete installation', async () => {
        const first = zip([{ name: 'maven/one.pom', content: 'one' }]);
        const second = zip([{ name: 'maven/two.pom', content: 'two' }]);
        const manifest = validateManifest({ ...installation.allwpilib.manifest, schemaVersion: 2, vmxScript: undefined,
            archive: 'one.zip', sha256: createHash('sha256').update(first).digest('hex'),
            additionalArchives: [{ archive: 'two.zip', sha256: createHash('sha256').update(second).digest('hex') }] }, 'allwpilib');
        const candidate: Candidate = { ...installation.allwpilib, manifest,
            release: { ...installation.allwpilib.release, assets: ['one.zip', 'two.zip'].map(name => ({ name,
                browser_download_url: 'https://github.com/W4Studica/allwpilib/releases/download/v2/' + name })) } };
        const download = async (url: string) => new Response(Readable.from(url.endsWith('one.zip') ? first : second));
        await assert.rejects(installComponent(candidate, temp, () => undefined, async url =>
            url.endsWith('two.zip') ? new Response('missing', { status: 404 }) : download(url)), /HTTP 404/);
        assert.deepStrictEqual(await io.readdir(path.join(temp, 'releases')), []);
        const result = await installComponent(candidate, temp, () => undefined, download);
        assert.strictEqual(await io.readFile(path.join(result.directory, 'maven/two.pom'), 'utf8'), 'two');
        await assert.rejects(installComponent({ ...candidate, manifest: { ...manifest,
            additionalArchives: [{ archive: 'two.zip', sha256: 'b'.repeat(64) }] } }, temp, () => undefined, download), /SHA-256/);
        const overlapping = zip([{ name: 'maven/one.pom', content: 'overwrite' }]);
        await assert.rejects(installComponent({ ...candidate, manifest: { ...manifest,
            additionalArchives: [{ archive: 'two.zip', sha256: createHash('sha256').update(overlapping).digest('hex') }] } }, temp, () => undefined,
        async url => new Response(Readable.from(url.endsWith('one.zip') ? first : overlapping))), /EEXIST/);
        assert.strictEqual(await io.readFile(path.join(result.directory, 'maven/one.pom'), 'utf8'), 'one');
        assert.throws(() => validateManifest({ ...manifest, additionalArchives: [{ archive: 'ONE.zip', sha256: manifest.sha256 }] }, 'allwpilib'), /duplicate/);
        assert.throws(() => validateManifest({ ...manifest, schemaVersion: 1 }, 'allwpilib'), /schema version 2/);
    });
});

suite('Offline and atomic project operations', () => {
    let temp: string;
    let w4Home: string;
    setup(async () => { temp = await io.mkdtemp(path.join(os.tmpdir(), 'w4studica project ')); });
    setup(async () => { w4Home = await io.mkdtemp(path.join(os.tmpdir(), 'w4studica home ')); });
    teardown(async () => { await io.rm(temp, { recursive: true }); await io.rm(w4Home, { recursive: true }); });
    test('writes project state and backup, invalidates offline on switch, leaves source files intact', async () => {
        await io.mkdir(installation.allwpilib.directory, { recursive: true });
        await io.writeFile(path.join(installation.allwpilib.directory, 'vmx.gradle'), "def sdkCache = file('.w4studica/vmx-sdk')\n");
        await atomicWrite(path.join(temp, '.w4studica/gradle-home/caches/modules-2/test-cache'), 'cached dependency');
        await io.writeFile(path.join(temp, 'build.gradle'), systemcore);
        await io.writeFile(path.join(temp, 'gradlew'), '#!/bin/sh\nexec "$JAVACMD" "$@"\n', { mode: 0o755 });
        await atomicWrite(path.join(temp, 'src/main/cpp/main.cpp'), '// user robot');
        await configureProject(temp, installation, 'vmx', w4Home, path.join(w4Home, 'gradle-home'));
        assert.strictEqual((await io.stat(path.join(temp, 'gradlew'))).mode & 0o777, 0o755);
        const state = (await readState(temp, w4Home))!;
        assert.strictEqual(state.target, 'vmx');
        assert.deepStrictEqual(state.systemcoreHostCalls, ["useCustomSystemcoreHostName('robot.local')"]);
        const vmxBuild = await io.readFile(path.join(temp, 'build.gradle'), 'utf8');
        assert.ok(vmxBuild.includes("username = System.getenv('VMX_USER') ?: 'ubuntu'"));
        assert.ok(vmxBuild.includes("password = System.getenv('VMX_PASSWORD') ?: 'password'"));
        assert.ok(!vmxBuild.includes('BEGIN W4Studica connection'));
        assert.ok(!vmxBuild.includes('W4Studica original host'));
        assert.strictEqual(await io.readFile(path.join(state.projectStorageDir, 'backup/build.gradle'), 'utf8'), systemcore);
        assert.ok((await io.readFile(path.join(state.projectStorageDir, 'vmx.gradle'), 'utf8')).includes("new File(w4studicaProjectStorage, 'vmx-sdk')"));
        assert.strictEqual(await io.readFile(path.join(w4Home, 'gradle-home/caches/modules-2/test-cache'), 'utf8'), 'cached dependency');
        assert.ok(!await exists(path.join(temp, '.w4studica')));
        await atomicWrite(path.join(state.projectStorageDir, 'offline'), '{}');
        await configureProject(temp, installation, 'systemcore', w4Home, path.join(w4Home, 'gradle-home'));
        assert.ok(!await exists(path.join(state.projectStorageDir, 'offline')));
        const restoredBuild = await io.readFile(path.join(temp, 'build.gradle'), 'utf8');
        assert.ok(restoredBuild.includes("useCustomSystemcoreHostName('robot.local')"));
        assert.ok(!restoredBuild.includes('VMX_USER'));
        assert.strictEqual(await io.readFile(path.join(temp, 'src/main/cpp/main.cpp'), 'utf8'), '// user robot');
    });
    test('failed preparation never changes build.gradle', async () => {
        await io.writeFile(path.join(temp, 'build.gradle'), systemcore);
        await io.writeFile(path.join(temp, 'settings.gradle'), "includeBuild('../GradleRIO')");
        await assert.rejects(configureProject(temp, installation, 'vmx', w4Home, path.join(w4Home, 'gradle-home')), /includeBuild/);
        assert.strictEqual(await io.readFile(path.join(temp, 'build.gradle'), 'utf8'), systemcore);
        assert.ok(!await exists(path.join(projectStorageDir(temp, w4Home), 'config.json')));
    });
    test('transaction restores an earlier write if a later parent is unwritable', async () => {
        const good = path.join(temp, 'good');
        await io.writeFile(good, 'before');
        const parent = path.join(temp, 'parent');
        await io.writeFile(parent, 'file, not directory');
        await assert.rejects(writeTransaction(new Map([[good, 'after'], [path.join(parent, 'child'), 'fail']])));
        assert.strictEqual(await io.readFile(good, 'utf8'), 'before');
    });
    test('marks offline ready only after successful online resolution, build and forced offline build', async () => {
        const state: ProjectState = { schemaVersion: 2, target: 'vmx', installation, projectStorageDir: projectStorageDir(temp, w4Home) };
        const calls: { args: string[]; online: boolean }[] = [];
        await saveOffline(temp, state, () => undefined, async (_root, args, online) => { calls.push({ args, online }); });
        assert.strictEqual(calls.length, 3);
        assert.deepStrictEqual(calls.map(c => c.online), [true, true, false]);
        assert.ok(calls[2].args.includes('--offline') && calls[2].args.includes('--rerun-tasks'));
        assert.ok(await exists(path.join(state.projectStorageDir, 'offline')));
        await assert.rejects(saveOffline(temp, state, () => undefined, async () => { throw new Error('Missing dependency'); }), /Missing dependency/);
        assert.ok(!await exists(path.join(state.projectStorageDir, 'offline')));
    });
    test('runs Unix wrapper in a path with spaces and reports build failure', async function () {
        if (process.platform === 'win32') { this.skip(); }
        await io.writeFile(path.join(temp, 'gradlew'), '#!/bin/sh\n[ "$W4STUDICA_ONLINE" = 1 ] && [ "$1" = build ]\n');
        await runGradle(temp, ['build'], true, () => undefined);
        await assert.rejects(runGradle(temp, ['build'], false, () => undefined), /Gradle failed/);
    });
});
